#!/bin/bash

DB_NAME="irvpn"
DB_USER="root"

echo "======================================"
echo "      VPN Server Manager (MySQL)"
echo "======================================"
echo ""

echo "1) Insert new server"
echo "2) Update existing server"
read -p "Select option [1-2]: " OPTION

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
    read -p "OutlinePort: " OutlinePort
    read -p "Status (ACTIVE/INACTIVE): " Status

    SQL="UPDATE vpn_servers SET "

    [[ ! -z "$ServerName" ]] && SQL+="ServerName='$ServerName',"
    [[ ! -z "$ServerAlias" ]] && SQL+="ServerAlias='$ServerAlias',"
    [[ ! -z "$Country" ]] && SQL+="Country='$Country',"
    [[ ! -z "$City" ]] && SQL+="City='$City',"
    [[ ! -z "$PublicURLInternational" ]] && SQL+="PublicURLInternational='$PublicURLInternational',"
    [[ ! -z "$PublicURLIran" ]] && SQL+="PublicURLIran='$PublicURLIran',"
    [[ ! -z "$WireGuardPort" ]] && SQL+="WireGuardPort=$WireGuardPort,"
    [[ ! -z "$OutlinePort" ]] && SQL+="OutlinePort=$OutlinePort,"
    [[ ! -z "$Status" ]] && SQL+="Status='$Status',"

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
        insert_server
        ;;
    2)
        update_server
        ;;
    *)
        echo "❌ Invalid option"
        ;;
esac
