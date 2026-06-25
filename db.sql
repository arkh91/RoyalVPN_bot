
CREATE TABLE accounts (
    UserID INT PRIMARY KEY,  -- Telegram ID
    FirstName VARCHAR(50),
    LastName VARCHAR(50),
    Username VARCHAR(50),
    CurrentBalance DECIMAL(10,2) DEFAULT 0.00,
    CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE payments (
    PaymentID INT AUTO_INCREMENT PRIMARY KEY,
    UserID INT,
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
    UserID INT,
    UsedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (UserID) REFERENCES accounts(UserID) ON DELETE CASCADE
);


CREATE TABLE UserKeys (
    UserID INT,
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

