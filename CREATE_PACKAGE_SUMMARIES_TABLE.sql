-- Manual SQL Query to Create PackageSummaries Table

CREATE TABLE IF NOT EXISTS `PackageSummaries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Package Summary',
  `description` TEXT NULL,
  `summaryData` JSON NOT NULL COMMENT 'Stores all package summary data including years, packages, monthly data, and calculations',
  `userId` INT NULL,
  `isActive` TINYINT NOT NULL DEFAULT 1,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_package_summaries_is_active` (`isActive`),
  INDEX `idx_package_summaries_user_id` (`userId`),
  CONSTRAINT `fk_package_summaries_user`
    FOREIGN KEY (`userId`)
    REFERENCES `Users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

