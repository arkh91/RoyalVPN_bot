
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




