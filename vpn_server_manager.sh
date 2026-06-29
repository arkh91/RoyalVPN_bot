#!/bin/bash

DB_NAME="irvpn"
DB_USER="root"

echo "======================================"
echo "      VPN Server Manager (MySQL)"
echo "======================================"
echo ""

echo "1) View all servers"
echo "2) Insert new server"
echo "3) Update existing server"
read -p "Select option [1-3]: " OPTION

# -----------------------------
# COMMON INPUT FUNCTION
# -----------------------------
ask() {
    local var_name=$1
    local prompt=$2

    read -p "$prompt: " value

    if [[ -z "$value" ]]; then
        echo "❌ Error: $prompt is required"
        exit 1
    fi

    eval "$var_name=\"$value\""
}

# -----------------------------
# VIEW ALL SERVERS
# -----------------------------
view_servers() {

    echo ""
    echo "=== All Servers ==="
    echo ""

    mysql -u "$DB_USER" -D "$DB_NAME" --vertical -e \
        "SELECT ServerID, ServerName, ServerAlias, Country, City,
                PublicURLInternational, PublicURLIran,
                WireGuardPort, OutlinePort,
                IPAddress, APIKey, BearerToken,
                MaxUsers, CurrentUsers, Status,
                CreatedAt, UpdatedAt
         FROM vpn_servers
         ORDER BY ServerID;"

    if [[ $? -ne 0 ]]; then
        echo "❌ Failed to fetch servers. Check MySQL connection."
    fi
}

# -----------------------------
# INSERT SERVER
# -----------------------------
insert_server() {

    echo ""
    echo "=== Insert New Server ==="

    ask ServerName "ServerName"
    ask ServerAlias "ServerAlias"
    ask Country "Country"
    ask City "City"
    ask PublicURLInternational "PublicURLInternational"
    ask PublicURLIran "PublicURLIran"
    ask WireGuardPort "WireGuardPort"
    ask OutlinePort "OutlinePort (or 0 for NULL)"

    if [[ "$OutlinePort" == "0" ]]; then
        OutlinePort="NULL"
    fi

    ask IPAddress "IPAddress (or type NULL)"
    ask APIKey "APIKey (or type NULL)"
    ask BearerToken "BearerToken (or type NULL)"
    ask MaxUsers "MaxUsers"

    SQL="INSERT INTO vpn_servers (
        ServerName, ServerAlias, Country, City,
        PublicURLInternational, PublicURLIran,
        WireGuardPort, OutlinePort,
        IPAddress, APIKey, BearerToken,
        MaxUsers, CurrentUsers, Status
    ) VALUES (
        '$ServerName',
        '$ServerAlias',
        '$Country',
        '$City',
        '$PublicURLInternational',
        '$PublicURLIran',
        $WireGuardPort,
        $OutlinePort,
        NULLIF('$IPAddress','NULL'),
        NULLIF('$APIKey','NULL'),
        NULLIF('$BearerToken','NULL'),
        $MaxUsers,
        0,
        'ACTIVE'
    );"

    mysql -u "$DB_USER" -D "$DB_NAME" -e "$SQL"

    if [[ $? -eq 0 ]]; then
        echo "✅ Server inserted successfully!"
    else
        echo "❌ Insert failed. Check SQL or MySQL connection."
    fi
}

# -----------------------------
# UPDATE SERVER
# -----------------------------
update_server() {

    echo ""
    echo "=== Update Server ==="

    ask ServerID "ServerID to update"

    # Check if exists
    EXISTS=$(mysql -u "$DB_USER" -D "$DB_NAME" -sse \
        "SELECT COUNT(*) FROM vpn_servers WHERE ServerID=$ServerID;")

    if [[ "$EXISTS" -eq 0 ]]; then
        echo "❌ Error: ServerID $ServerID not found"
        exit 1
    fi

    echo "Leave empty if you don't want to change a field"
    echo ""

    read -p "ServerName: " ServerName
    read -p "ServerAlias: " ServerAlias
    read -p "Country: " Country
    read -p "City: " City
    read -p "PublicURLInternational: " PublicURLInternational
    read -p "PublicURLIran: " PublicURLIran
    read -p "WireGuardPort: " WireGuardPort
    read -p "OutlinePort (or 0 for NULL): " OutlinePort
    read -p "IPAddress (or type NULL): " IPAddress
    read -p "APIKey (or type NULL): " APIKey
    read -p "BearerToken (or type NULL): " BearerToken
    read -p "MaxUsers: " MaxUsers
    read -p "Status (ACTIVE/INACTIVE/MAINTENANCE/FULL): " Status

    if [[ "$OutlinePort" == "0" ]]; then
        OutlinePort="NULL"
    fi

    SQL="UPDATE vpn_servers SET "

    [[ ! -z "$ServerName" ]] && SQL+="ServerName='$ServerName',"
    [[ ! -z "$ServerAlias" ]] && SQL+="ServerAlias='$ServerAlias',"
    [[ ! -z "$Country" ]] && SQL+="Country='$Country',"
    [[ ! -z "$City" ]] && SQL+="City='$City',"
    [[ ! -z "$PublicURLInternational" ]] && SQL+="PublicURLInternational='$PublicURLInternational',"
    [[ ! -z "$PublicURLIran" ]] && SQL+="PublicURLIran='$PublicURLIran',"
    [[ ! -z "$WireGuardPort" ]] && SQL+="WireGuardPort=$WireGuardPort,"
    [[ ! -z "$OutlinePort" ]] && SQL+="OutlinePort=$OutlinePort,"
    [[ ! -z "$IPAddress" ]] && SQL+="IPAddress=NULLIF('$IPAddress','NULL'),"
    [[ ! -z "$APIKey" ]] && SQL+="APIKey=NULLIF('$APIKey','NULL'),"
    [[ ! -z "$BearerToken" ]] && SQL+="BearerToken=NULLIF('$BearerToken','NULL'),"
    [[ ! -z "$MaxUsers" ]] && SQL+="MaxUsers=$MaxUsers,"
    [[ ! -z "$Status" ]] && SQL+="Status='$Status',"

    # If nothing was entered, there's no SET clause yet — bail out cleanly
    if [[ "$SQL" == "UPDATE vpn_servers SET " ]]; then
        echo "ℹ️  No fields entered — nothing to update."
        return
    fi

    # remove trailing comma
    SQL=${SQL%,}

    SQL+=" WHERE ServerID=$ServerID;"

    mysql -u "$DB_USER" -D "$DB_NAME" -e "$SQL"

    if [[ $? -eq 0 ]]; then
        echo "✅ Server updated successfully!"
    else
        echo "❌ Update failed"
    fi
}

# -----------------------------
# MAIN
# -----------------------------
case $OPTION in
    1)
        view_servers
        ;;
    2)
        insert_server
        ;;
    3)
        update_server
        ;;
    *)
        echo "❌ Invalid option"
        ;;
esac
