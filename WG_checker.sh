cd /root/RoyalVPN_bot

DB_HOST=$(grep -oP "host:\s*['\"]\K[^'\"]*" db.js | head -1)
DB_USER=$(grep -oP "user:\s*['\"]\K[^'\"]*" db.js | head -1)
DB_PASS=$(grep -oP "password:\s*['\"]\K[^'\"]*" db.js | head -1)
DB_NAME=$(grep -oP "database:\s*['\"]\K[^'\"]*" db.js | head -1)

mysql -h "${DB_HOST:-127.0.0.1}" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -N -e "
    SELECT ServerName, IPAddress FROM vpn_servers WHERE Status='ACTIVE';
" | while read -r NAME IP; do
    echo -n "  [$NAME] $IP ... "
    RESULT=$(ssh -T -n -i /root/.ssh/wg_monitor_key -o BatchMode=yes -o ConnectTimeout=5 \
        -o StrictHostKeyChecking=no wg-monitor@"$IP" 2>&1)
    if echo "$RESULT" | grep -q "^[A-Za-z0-9+/]\{43\}="; then
        echo "OK (dump received)"
    elif echo "$RESULT" | grep -qi "not available"; then
        echo "FAIL — wg-monitor exists but shell is still nologin (run: usermod -s /bin/bash wg-monitor)"
    elif echo "$RESULT" | grep -qi "permission denied"; then
        echo "FAIL — no wg-monitor account / key not installed (run: --add-monitor)"
    else
        echo "UNKNOWN — got: $(echo "$RESULT" | head -1)"
    fi
done
