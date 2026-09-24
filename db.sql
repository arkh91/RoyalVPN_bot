CREATE TABLE accounts (
    UserID BIGINT UNSIGNED PRIMARY KEY,  -- Telegram ID
    FirstName VARCHAR(50),
    LastName VARCHAR(50),
    Username VARCHAR(50),
    CurrentBalance DECIMAL(10,2) DEFAULT 0.00,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE payments (
    PaymentID INT AUTO_INCREMENT PRIMARY KEY,
    UserID BIGINT UNSIGNED,
    PaymentDate DATE,
    PaymentMethod VARCHAR(30),
    DigitalCurrencyAmount DECIMAL(20,8),
    Currency VARCHAR(10),
    AmountPaidInUSD DECIMAL(10,2),
    CurrentRateToUSD DECIMAL(20,8),
    Status BOOLEAN,  -- TRUE = Successful, FALSE = Failed
    Comments TEXT,
    FOREIGN KEY (UserID) REFERENCES accounts(UserID) ON DELETE CASCADE
);


CREATE TABLE visit (
    LogID INT AUTO_INCREMENT PRIMARY KEY,
    UserID BIGINT UNSIGNED,
    UsedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (UserID) REFERENCES accounts(UserID) ON DELETE CASCADE
);


CREATE TABLE UserKeys (
    UserID BIGINT UNSIGNED,
    FullKey VARCHAR(100) UNIQUE,
    GuiKey VARCHAR(100),
    ServerName VARCHAR(255),
    DataLimit INT,
    KeyUsage FLOAT DEFAULT 0,
    KeyNumber INT,
    IssuedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    ExpiredAt DATETIME,  -- You can calculate and insert this manually
    FOREIGN KEY (UserID) REFERENCES accounts(UserID) ON DELETE CASCADE
);

CREATE TABLE vpn_servers (
    ServerID INT AUTO_INCREMENT PRIMARY KEY,

    ServerName VARCHAR(50) NOT NULL,     -- Internal unique name: IR-Tehran-1
    ServerAlias VARCHAR(100) DEFAULT NULL, -- User-facing name: Tehran Premium

    Country VARCHAR(50) NOT NULL,
    City VARCHAR(50) NOT NULL,

    -- Routing endpoints
    PublicURLInternational VARCHAR(255) NOT NULL,
    PublicURLIran VARCHAR(255) NOT NULL,

    -- Network ports
    WireGuardPort INT DEFAULT 51820,
    OutlinePort INT DEFAULT NULL,

    -- Server address
    IPAddress VARCHAR(45),

    -- Security
    APIKey VARCHAR(255),
    BearerToken VARCHAR(255),

    -- Capacity
    MaxUsers INT DEFAULT 0,
    CurrentUsers INT DEFAULT 0,

    -- Operational state
    Status ENUM('ACTIVE','INACTIVE','MAINTENANCE','FULL') DEFAULT 'ACTIVE',

    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_country (Country),
    INDEX idx_city (City),
    INDEX idx_status (Status),
    INDEX idx_status_country (Status, Country),
    INDEX idx_alias (ServerAlias)
);

CREATE TABLE admins (
    AdminID BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    UserID BIGINT UNSIGNED NOT NULL,
    Username VARCHAR(255) DEFAULT NULL,
    Role ENUM('superadmin', 'admin', 'moderator') DEFAULT 'admin',
    AddedAt TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    IsActive TINYINT(1) DEFAULT 1,
    PRIMARY KEY (AdminID),
    UNIQUE KEY (UserID)
);


-- ============================================================================
-- MERGED-IN TABLES (reconstructed from `DESCRIBE` output, not present in the
-- original db.sql). Column types/defaults/keys match the DESCRIBE output
-- exactly. No FOREIGN KEY constraints were added automatically because
-- wg_clients.UserID is BIGINT UNSIGNED while accounts.UserID is INT --
-- see note below the table.
-- ============================================================================

-- Usage: stores each issued WireGuard client/peer config, its traffic
-- counters, and its lifecycle flags (active/expired/suspended/deleted).
-- One row per WireGuard peer, optionally linked to a bot user (UserID)
-- and always tied to a server_name (see vpn_servers.ServerName).
CREATE TABLE wg_clients (
    client_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    UserID            BIGINT UNSIGNED DEFAULT NULL,
    name              VARCHAR(100) NOT NULL,
    description       TEXT DEFAULT NULL,
    server_name       VARCHAR(100) NOT NULL,
    private_key       TEXT DEFAULT NULL,
    public_key        VARCHAR(44) NOT NULL,
    address           VARCHAR(45) NOT NULL,
    dns               VARCHAR(255) DEFAULT NULL,
    allowed_ips       VARCHAR(255) NOT NULL,
    endpoint          VARCHAR(255) DEFAULT NULL,
    is_active         TINYINT(1) NOT NULL DEFAULT 1,
    is_expired        TINYINT(1) NOT NULL DEFAULT 0,
    is_suspended      TINYINT(1) NOT NULL DEFAULT 0,
    is_deleted        TINYINT(1) NOT NULL DEFAULT 0,
    created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    last_handshake    DATETIME(3) DEFAULT NULL,
    expires_at        DATETIME(3) DEFAULT NULL,
    last_poll_at      DATETIME(3) DEFAULT NULL,
    rx_bytes          BIGINT UNSIGNED NOT NULL DEFAULT 0,
    tx_bytes          BIGINT UNSIGNED NOT NULL DEFAULT 0,
    -- Assumption: generated column adds rx_bytes + tx_bytes. DESCRIBE only
    -- confirms it is STORED GENERATED, not the exact expression; adjust if
    -- the real definition differs.
    total_bytes       BIGINT UNSIGNED GENERATED ALWAYS AS (rx_bytes + tx_bytes) STORED,
    last_rx_snapshot  BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_tx_snapshot  BIGINT UNSIGNED NOT NULL DEFAULT 0,
    max_data_limit    BIGINT UNSIGNED DEFAULT NULL,
    speed_limit_kbps  INT UNSIGNED DEFAULT NULL,
    created_by        VARCHAR(64) DEFAULT NULL,
    notes             TEXT DEFAULT NULL,
    PRIMARY KEY (client_id),
    UNIQUE KEY uq_wg_clients_public_key (public_key),
    KEY idx_wg_clients_userid (UserID),
    KEY idx_wg_clients_server_name (server_name),
    KEY idx_wg_clients_last_handshake (last_handshake),
    KEY idx_wg_clients_expires_at (expires_at),
    KEY idx_wg_clients_last_poll_at (last_poll_at),
    -- accounts.UserID was widened to BIGINT UNSIGNED, so this FK is now valid.
    FOREIGN KEY (UserID) REFERENCES accounts(UserID) ON DELETE SET NULL
);

-- Usage: reference/lookup table of countries (name, ISO code, flag,
-- continent) used to tag or filter VPN servers / clients by country.
CREATE TABLE countries (
    CountryID    INT NOT NULL AUTO_INCREMENT,
    CountryName  VARCHAR(100) NOT NULL,
    CountryCode  CHAR(2) NOT NULL,
    FlagEmoji    VARCHAR(10) DEFAULT NULL,
    FlagURL      VARCHAR(255) DEFAULT NULL,
    Continent    VARCHAR(50) DEFAULT NULL,
    IsActive     TINYINT(1) DEFAULT 1,
    CreatedAt    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (CountryID),
    UNIQUE KEY uq_countries_countrycode (CountryCode)
);
