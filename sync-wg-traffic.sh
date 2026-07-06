#!/bin/bash
# =============================================================================
# sync-wg-traffic.sh
# Polls every ACTIVE WireGuard server, collects per-peer traffic stats
# via SSH, and updates the wg_clients table in MySQL.
#
# Reads DB credentials directly from your Node.js db.js file.
#
# Usage:
#   ./sync-wg-traffic.sh                        # normal run
#   ./sync-wg-traffic.sh --debug                # verbose, no DB writes
#   DB_JS=/path/to/db.js ./sync-wg-traffic.sh   # custom db.js location
# =============================================================================

set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# LOCATE db.js
# Searches common locations relative to this script, or use DB_JS env var.
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_db_js() {
    # Explicit override always wins
    if [[ -n "${DB_JS:-}" ]]; then
        echo "$DB_JS"
        return
    fi

    # Common locations to search
    local candidates=(
        "${SCRIPT_DIR}/db.js"
        "${SCRIPT_DIR}/../db.js"
        "${SCRIPT_DIR}/../config/db.js"
        "${SCRIPT_DIR}/../src/db.js"
        "/root/RoyalVPN_bot/db.js"
        "/opt/vpnbot/db.js"
    )

    for path in "${candidates[@]}"; do
        if [[ -f "$path" ]]; then
            echo "$path"
            return
        fi
    done

    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# PARSE db.js
# Handles both single and double quoted values, with or without trailing comma.
# Works with:
#   host: 'localhost',
#   host: "localhost",
#   host: 'localhost'    (no comma)
# ─────────────────────────────────────────────────────────────────────────────
parse_db_js() {
    local js_file="$1"
    local key="$2"
    # Match:  key: 'value'  or  key: "value"
    grep -oP "${key}:\s*['\"]\\K[^'\"]*(?=['\"])" "$js_file" 2>/dev/null | head -1
}

load_db_credentials() {
    local js_file
    js_file=$(find_db_js)

    if [[ -z "$js_file" ]]; then
        echo "ERROR: Cannot find db.js. Set the path with: DB_JS=/path/to/db.js" >&2
        echo "ERROR: Searched in: ${SCRIPT_DIR}, ${SCRIPT_DIR}/../, ${SCRIPT_DIR}/../config/, /root/RoyalVPN_bot/" >&2
        exit 1
    fi

    if [[ ! -r "$js_file" ]]; then
        echo "ERROR: db.js found at '$js_file' but is not readable." >&2
        exit 1
    fi

    DB_HOST=$(parse_db_js "$js_file" "host")
    DB_USER=$(parse_db_js "$js_file" "user")
    DB_PASS=$(parse_db_js "$js_file" "password")
    DB_NAME=$(parse_db_js "$js_file" "database")
    DB_PORT=$(parse_db_js "$js_file" "port")

    # Fallbacks for optional fields
    DB_HOST="${DB_HOST:-127.0.0.1}"
    DB_PORT="${DB_PORT:-3306}"

    # Validate required fields were actually parsed
    local missing=()
    [[ -z "$DB_HOST" ]] && missing+=("host")
    [[ -z "$DB_USER" ]] && missing+=("user")
    [[ -z "$DB_PASS" ]] && missing+=("password")
    [[ -z "$DB_NAME" ]] && missing+=("database")

    if [[ "${#missing[@]}" -gt 0 ]]; then
        echo "ERROR: Could not parse these fields from '$js_file': ${missing[*]}" >&2
        echo "ERROR: Make sure they follow the format:  key: 'value'  or  key: \"value\"" >&2
        exit 1
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] DB credentials loaded from: $js_file"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] DB → host:${DB_HOST} port:${DB_PORT} db:${DB_NAME} user:${DB_USER}"
}

# ─────────────────────────────────────────────────────────────────────────────
# SSH CONFIG
# ─────────────────────────────────────────────────────────────────────────────
SSH_USER="${SSH_USER:-wg-monitor}"
SSH_PORT="${SSH_PORT:-22}"
SSH_KEY="${SSH_KEY:-/root/.ssh/wg_monitor_key}"
SSH_TIMEOUT="${SSH_TIMEOUT:-10}"


# ─────────────────────────────────────────────────────────────────────────────
# DEBUG MODE
# ─────────────────────────────────────────────────────────────────────────────
DEBUG=0
[[ "${1:-}" == "--debug" ]] && DEBUG=1

# ─────────────────────────────────────────────────────────────────────────────
# LOCK FILE (skipped in debug mode)
# ─────────────────────────────────────────────────────────────────────────────
LOCK_FILE="/var/run/sync-wg-traffic.lock"

acquire_lock() {
    [[ "$DEBUG" -eq 1 ]] && return
    if [ -e "$LOCK_FILE" ]; then
        OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            log "ERROR" "Another instance already running (PID $OLD_PID). Exiting."
            exit 1
        else
            log "WARN" "Stale lock file found. Removing."
            rm -f "$LOCK_FILE"
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

release_lock() {
    [[ "$DEBUG" -eq 1 ]] && return
    rm -f "$LOCK_FILE"
}

# ─────────────────────────────────────────────────────────────────────────────
# MYSQL TEMP CONFIG FILE
# Credentials written to a chmod 600 temp file → never visible in 'ps aux',
# no "password on command line" warning.
# ─────────────────────────────────────────────────────────────────────────────
MYSQL_CNF=""

setup_mysql_cnf() {
    MYSQL_CNF=$(mktemp /tmp/.wg-sync-mysql-XXXXXX.cnf)
    chmod 600 "$MYSQL_CNF"
    cat > "$MYSQL_CNF" << EOF
[client]
host     = ${DB_HOST}
port     = ${DB_PORT}
user     = ${DB_USER}
password = ${DB_PASS}
database = ${DB_NAME}
EOF
}

cleanup() {
    [[ -n "$MYSQL_CNF" && -f "$MYSQL_CNF" ]] && rm -f "$MYSQL_CNF"
    release_lock
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────
LOG_FILE="${LOG_FILE:-/var/log/sync-wg-traffic.log}"

log() {
    local level="$1"; shift
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*"
    echo "$msg" >&2                                                      # stderr — never captured by $()
    [[ "$DEBUG" -eq 0 ]] && echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

dbg() {
    [[ "$DEBUG" -eq 1 ]] && echo "  [DBG] $*" >&2                       # stderr only
}

# ─────────────────────────────────────────────────────────────────────────────
# DB HELPERS
# ─────────────────────────────────────────────────────────────────────────────
db_query() {
    mysql --defaults-extra-file="$MYSQL_CNF" --silent --skip-column-names -e "$1" 2>&1
}

db_exec() {
    if [[ "$DEBUG" -eq 1 ]]; then
        echo "  [DBG] SQL (skipped in debug mode):"
        echo "$1" | head -30
        return 0
    fi
    mysql --defaults-extra-file="$MYSQL_CNF" --silent --skip-column-names -e "$1" 2>&1
}

# ─────────────────────────────────────────────────────────────────────────────
# SSH HELPER
# ─────────────────────────────────────────────────────────────────────────────
ssh_run() {
    local host="$1"
    ssh \
        -T \
        -n \
        -i "$SSH_KEY" \
        -p "$SSH_PORT" \
        -o ConnectTimeout="$SSH_TIMEOUT" \
        -o StrictHostKeyChecking=no \
        -o BatchMode=yes \
        -o LogLevel=ERROR \
        "${SSH_USER}@${host}"
}

# ─────────────────────────────────────────────────────────────────────────────
# LOCAL IP DETECTION
# Returns 0 (true) if the given IP belongs to this machine.
# Used to skip SSH and run wg show locally when the target is US08 itself.
# ─────────────────────────────────────────────────────────────────────────────
LOCAL_IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$')

is_local_ip() {
    local ip="$1"
    echo "$LOCAL_IPS" | grep -qF "$ip"
}

get_wg_dump() {
    local server_name="$1"
    local server_ip="$2"

    if is_local_ip "$server_ip"; then
        log "INFO" "  Target is local machine — running wg show directly (no SSH)."
        wg show wg0 dump 2>/dev/null
    else
        ssh_run "$server_ip"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Unix timestamp → MySQL datetime string
# ─────────────────────────────────────────────────────────────────────────────
unix_to_mysql_dt() {
    date -d "@${1}" '+%Y-%m-%d %H:%M:%S.000' 2>/dev/null || echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# FUNCTION: sql_update_active_peer
#
# Builds the UPDATE statement for a peer that EXISTS in the wg dump.
# Called for every matched peer — active or idle.
# is_active = 1 if peer exists in wg and is not expired/suspended.
# Handshake timestamp is recorded for reference but does not affect active status.
#
# Args: cid new_rx new_tx wg_rx wg_tx hs_sql new_is_active total_new now_mysql
# ─────────────────────────────────────────────────────────────────────────────
sql_update_active_peer() {
    local cid="$1" new_rx="$2" new_tx="$3" wg_rx="$4" wg_tx="$5"
    local hs_sql="$6" new_is_active="$7" total_new="$8" now_mysql="$9"

    echo "
UPDATE wg_clients SET
    rx_bytes         = ${new_rx},
    tx_bytes         = ${new_tx},
    last_rx_snapshot = ${wg_rx},
    last_tx_snapshot = ${wg_tx},
    last_handshake   = ${hs_sql},
    is_active        = ${new_is_active},
    last_poll_at     = '${now_mysql}',
    is_expired       = CASE
                           WHEN max_data_limit IS NOT NULL
                            AND ${total_new} >= max_data_limit THEN 1
                           ELSE is_expired
                       END
WHERE client_id = ${cid};"
}

# ─────────────────────────────────────────────────────────────────────────────
# FUNCTION: sql_delete_orphan_peer
#
# Builds the UPDATE for a peer that EXISTS in DB but is MISSING from wg dump.
# This means it was removed from WireGuard outside of the bot.
# Sets is_deleted = 1 so the bot permanently ignores it going forward.
#
# Args: cid now_mysql
# ─────────────────────────────────────────────────────────────────────────────
sql_delete_orphan_peer() {
    local cid="$1" now_mysql="$2"

    echo "
UPDATE wg_clients SET
    is_active    = 0,
    is_deleted   = 1,
    last_poll_at = '${now_mysql}'
WHERE client_id = ${cid};"
}


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
main() {
    # Step 1 — Load credentials from db.js
    load_db_credentials

    # Step 2 — Write temp MySQL config file
    setup_mysql_cnf

    # Step 3 — Acquire run lock
    acquire_lock

    [[ "$DEBUG" -eq 1 ]] && log "INFO" "========== DEBUG MODE — no DB writes =========="
    log "INFO" "========== sync-wg-traffic start =========="

    # ── Fetch all ACTIVE servers ──────────────────────────────────────────────
    SERVERS=$(db_query "
        SELECT ServerName, IPAddress
        FROM vpn_servers
        WHERE Status = 'ACTIVE'
          AND IPAddress IS NOT NULL
          AND IPAddress != ''
        ORDER BY ServerID;
    ") || { log "ERROR" "Failed to query vpn_servers."; exit 1; }

    if [[ -z "$SERVERS" ]]; then
        log "INFO" "No active servers found. Nothing to do."
        exit 0
    fi

    log "INFO" "Found $(echo "$SERVERS" | wc -l) active server(s)."

    NOW_MYSQL=$(date '+%Y-%m-%d %H:%M:%S.000')
    NOW_TS=$(date +%s)

    # ── Loop over each server ─────────────────────────────────────────────────
    while IFS=$'\t' read -r SERVER_NAME SERVER_IP; do
        [[ -z "$SERVER_NAME" || -z "$SERVER_IP" ]] && continue

        log "INFO" "──── Server: $SERVER_NAME ($SERVER_IP) ────"

        # ── Get wg dump — local if this is US08, SSH otherwise ───────────────
        RAW_DUMP=$(get_wg_dump "$SERVER_NAME" "$SERVER_IP") || true

        if [[ -z "$RAW_DUMP" ]]; then
            if is_local_ip "$SERVER_IP"; then
                log "WARN" "  No output from local wg show. Is wg0 running? Try: wg show wg0 dump"
            else
                log "WARN" "  No output from $SERVER_IP. SSH failed or wg not running."
                log "WARN" "  Check: ssh -T -i $SSH_KEY ${SSH_USER}@${SERVER_IP}"
            fi
            continue
        fi

        # ── Validate first line is the interface row (exactly 4 tab fields) ───
        # If sudo prints a warning it appears first — detect and strip it.
        FIRST_LINE=$(echo "$RAW_DUMP" | head -1)
        FIELD_COUNT=$(echo "$FIRST_LINE" | awk -F'\t' '{print NF}')

        if [[ "$FIELD_COUNT" -ne 4 ]]; then
            log "WARN" "  First line has $FIELD_COUNT tab-fields (expected 4 for interface row)."
            log "WARN" "  Possible sudo noise: [$FIRST_LINE]"
            RAW_DUMP=$(echo "$RAW_DUMP" | awk -F'\t' 'NF==4{found=1} found{print}')
            FIRST_LINE=$(echo "$RAW_DUMP" | head -1)
            FIELD_COUNT=$(echo "$FIRST_LINE" | awk -F'\t' '{print NF}')
            if [[ "$FIELD_COUNT" -ne 4 ]]; then
                log "ERROR" "  Cannot find valid interface row. Skipping $SERVER_NAME."
                continue
            fi
        fi

        dbg "Interface row: $FIRST_LINE"

        # Skip interface row — remainder is peer lines
        PEER_LINES=$(echo "$RAW_DUMP" | tail -n +2)

        if [[ -z "$PEER_LINES" ]]; then
            log "INFO" "  No peers on $SERVER_NAME."
            continue
        fi

        log "INFO" "  Got $(echo "$PEER_LINES" | wc -l) peer(s) from wg dump."

        # ── Load all wg_clients for this server in one DB query ───────────────
        declare -A CLIENT_MAP
        declare -A SEEN_IN_DUMP

        DB_CLIENTS=$(db_query "
            SELECT public_key,
                   client_id,
                   COALESCE(rx_bytes, 0),
                   COALESCE(tx_bytes, 0),
                   COALESCE(last_rx_snapshot, 0),
                   COALESCE(last_tx_snapshot, 0),
                   is_active,
                   is_expired,
                   is_suspended,
                   is_deleted
            FROM wg_clients
            WHERE server_name = '${SERVER_NAME}'
              AND is_deleted = 0;
        ") || { log "ERROR" "  DB query failed for $SERVER_NAME. Skipping."; unset CLIENT_MAP SEEN_IN_DUMP; continue; }

        if [[ -z "$DB_CLIENTS" ]]; then
            log "WARN" "  No clients in DB for server_name='${SERVER_NAME}'."
            log "WARN" "  Verify server_name in wg_clients matches ServerName in vpn_servers exactly (case-sensitive)."
            unset CLIENT_MAP SEEN_IN_DUMP
            continue
        fi

        while IFS=$'\t' read -r PK CID DB_RX DB_TX SNAP_RX SNAP_TX IS_ACT IS_EXP IS_SUSP IS_DEL; do
            [[ -z "$PK" ]] && continue
            CLIENT_MAP["$PK"]="${CID}|${DB_RX}|${DB_TX}|${SNAP_RX}|${SNAP_TX}|${IS_ACT}|${IS_EXP}|${IS_SUSP}|${IS_DEL}"
        done <<< "$DB_CLIENTS"

        log "INFO" "  Loaded ${#CLIENT_MAP[@]} client(s) from DB."

        # ── Process each peer line from wg dump ───────────────────────────────
        SQL_BATCH=""
        UPDATED_COUNT=0
        SKIPPED_COUNT=0

        while IFS=$'\t' read -r PUBKEY PRESHARED ENDPOINT ALLOWED_IPS LAST_HS_UNIX WG_RX WG_TX KEEPALIVE; do
            [[ -z "$PUBKEY" ]] && continue

            SEEN_IN_DUMP["$PUBKEY"]=1

            dbg "PUBKEY      : ${PUBKEY:0:30}…"
            dbg "ALLOWED_IPS : $ALLOWED_IPS"
            dbg "LAST_HS     : $LAST_HS_UNIX"
            dbg "WG_RX/TX    : ${WG_RX:-0} / ${WG_TX:-0}"

            if [[ -z "${CLIENT_MAP[$PUBKEY]+_}" ]]; then
                log "WARN" "  !! Peer ${PUBKEY:0:20}… exists in WireGuard but NOT in wg_clients — orphan on wg side, skipping."
                (( SKIPPED_COUNT++ )) || true
                continue
            fi

            IFS='|' read -r CID DB_RX DB_TX SNAP_RX SNAP_TX IS_ACT IS_EXP IS_SUSP IS_DEL \
                <<< "${CLIENT_MAP[$PUBKEY]}"

            # Sanitise — default anything non-numeric to 0
            for var in WG_RX WG_TX SNAP_RX SNAP_TX DB_RX DB_TX LAST_HS_UNIX; do
                [[ "${!var}" =~ ^[0-9]+$ ]] || printf -v "$var" '%s' '0'
            done

            # ── Delta traffic (handles counter reset when wg restarts) ─────────
            if [[ "$WG_RX" -ge "$SNAP_RX" ]]; then
                DELTA_RX=$(( WG_RX - SNAP_RX ))
            else
                log "INFO" "  [${PUBKEY:0:20}…] RX counter reset (${SNAP_RX}→${WG_RX})"
                DELTA_RX=$WG_RX
            fi

            if [[ "$WG_TX" -ge "$SNAP_TX" ]]; then
                DELTA_TX=$(( WG_TX - SNAP_TX ))
            else
                log "INFO" "  [${PUBKEY:0:20}…] TX counter reset (${SNAP_TX}→${WG_TX})"
                DELTA_TX=$WG_TX
            fi

            NEW_RX=$(( DB_RX + DELTA_RX ))
            NEW_TX=$(( DB_TX + DELTA_TX ))
            TOTAL_NEW=$(( NEW_RX + NEW_TX ))

            # ── is_active logic ───────────────────────────────────────────────
            # A peer is active simply because it EXISTS in the wg dump and
            # is neither expired nor suspended. Handshake age is irrelevant —
            # an idle peer is still a valid, connectable peer.
            HS_SQL="NULL"
            ACTIVE_REASON=""

            # Record last_handshake timestamp if available (informational only)
            if [[ "$LAST_HS_UNIX" =~ ^[0-9]+$ ]] && [[ "$LAST_HS_UNIX" -gt 0 ]]; then
                HS_DT=$(unix_to_mysql_dt "$LAST_HS_UNIX")
                [[ -n "$HS_DT" ]] && HS_SQL="'${HS_DT}'"
            fi

            if [[ "$IS_EXP" -eq 1 ]]; then
                NEW_IS_ACTIVE=0
                ACTIVE_REASON="expired"
            elif [[ "$IS_SUSP" -eq 1 ]]; then
                NEW_IS_ACTIVE=0
                ACTIVE_REASON="suspended"
            else
                NEW_IS_ACTIVE=1
                ACTIVE_REASON="exists in wg"
            fi

            log "INFO" "  [${PUBKEY:0:20}…] +RX:${DELTA_RX}B +TX:${DELTA_TX}B | active:${NEW_IS_ACTIVE} (${ACTIVE_REASON})"

            SQL_BATCH+=$(sql_update_active_peer \
                "$CID" "$NEW_RX" "$NEW_TX" "$WG_RX" "$WG_TX" \
                "$HS_SQL" "$NEW_IS_ACTIVE" "$TOTAL_NEW" "$NOW_MYSQL")
            (( UPDATED_COUNT++ )) || true

        done <<< "$PEER_LINES"

        # ── Peers in DB but missing from wg dump → deleted from wg outside bot ──
        # Sets is_deleted = 1 AND is_active = 0 regardless of previous state.
        DELETED_COUNT=0
        for PK in "${!CLIENT_MAP[@]}"; do
            if [[ -z "${SEEN_IN_DUMP[$PK]+_}" ]]; then
                IFS='|' read -r CID _ _ _ _ IS_ACT _ _ IS_DEL <<< "${CLIENT_MAP[$PK]}"
                # Only update if not already marked deleted
                if [[ "$IS_DEL" -eq 0 ]]; then
                    SQL_BATCH+=$(sql_delete_orphan_peer "$CID" "$NOW_MYSQL")
                    log "WARN" "  [${PK:0:20}…] in DB but not in wg dump → is_deleted=1 is_active=0"
                    (( DELETED_COUNT++ )) || true
                fi
            fi
        done

        # ── Execute all SQL for this server in one transaction ─────────────────
        if [[ -n "$SQL_BATCH" ]]; then
            RESULT=$(db_exec "START TRANSACTION; ${SQL_BATCH} COMMIT;") || {
                log "ERROR" "  Transaction failed for $SERVER_NAME: $RESULT"
                db_exec "ROLLBACK;" 2>/dev/null || true
                unset CLIENT_MAP SEEN_IN_DUMP
                continue
            }
            log "INFO" "  ✓ Done — updated:${UPDATED_COUNT} deleted:${DELETED_COUNT} skipped:${SKIPPED_COUNT}"
        else
            log "INFO" "  No updates needed for $SERVER_NAME."
        fi

        unset CLIENT_MAP SEEN_IN_DUMP

    done <<< "$SERVERS"

    log "INFO" "========== sync-wg-traffic done =========="
}

main "$@"
