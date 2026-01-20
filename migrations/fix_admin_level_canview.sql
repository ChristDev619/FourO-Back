-- =====================================================
-- Fix Admin Level accessList - Add canView to Planning pages
-- =====================================================
-- This script updates the Admin level to explicitly include canView: true
-- for all Planning pages to ensure they show in the navbar
-- =====================================================

USE flexibleserverdb;

-- Update Admin level (id = 12) to add canView: true to all Planning pages
UPDATE `levels`
SET `accessList` = JSON_ARRAY(
    -- Existing pages with canView added
    JSON_OBJECT('canEdit', true, 'pageName', 'Locations', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Generators', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Machines', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Meters', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Users', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'AccessLevels', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Dashboard', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Reports', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Tariffs', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'TariffTypes', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Usage', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'ProductionRun', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'AdminDashboard', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'MissingMin', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Alarms', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'DownTimes', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Lines', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Programs', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Reasons', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Recipes', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Skus', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Statuses', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Tags', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Units', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'UserDashboard', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Profile', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'ProfileU', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'NpmNotes', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'test-correlation', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'Notifications', 'canCreate', true, 'canDelete', true, 'canView', true),
    -- Planning pages with canView: true
    JSON_OBJECT('canEdit', true, 'pageName', 'DemandForecast', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'SeasonalityData', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'MonthlyForecast', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'LineData', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'PackageTypes', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'PackageSummary', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'PlanningDashboard', 'canCreate', true, 'canDelete', true, 'canView', true),
    JSON_OBJECT('canEdit', true, 'pageName', 'TagConverter', 'canCreate', true, 'canDelete', true, 'canView', true)
)
WHERE `id` = 12 AND `name` = 'Admin';

-- Verify the update
SELECT 
    id,
    name,
    JSON_LENGTH(accessList) as accessListCount,
    JSON_EXTRACT(accessList, '$[*].pageName') as pageNames
FROM `levels`
WHERE `id` = 12;

