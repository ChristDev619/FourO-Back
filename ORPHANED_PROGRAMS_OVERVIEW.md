# Orphaned Programs - Overview & Automated Monitoring

## Problem Statement

**Orphaned Programs** are programs in the database that have no associated jobs. These programs exist in the `Programs` table but have no corresponding records in the `Jobs` table where `job.programId = program.id`.

### SQL Query to Identify Orphaned Programs

```sql
SELECT p.*
FROM aquafinaflexibleserverdb.programs p
LEFT JOIN aquafinaflexibleserverdb.jobs j
  ON j.programId = p.id
WHERE j.id IS NULL;
```

### Impact

- **Data Quality**: Orphaned programs clutter the database and may indicate incomplete data entry or system issues
- **Reporting Accuracy**: These programs may appear in reports but have no actual production data
- **User Confusion**: Users may see programs that appear to have no activity
- **Storage**: Unnecessary data accumulation over time

## Solution: Automated Monitoring & Notification

### Implementation

1. **Automated Worker**: A background worker runs every 5 days to check for orphaned programs
2. **Email Notification**: When orphaned programs are detected, an email is automatically sent to the Business Analyst (BA)
3. **Action Required**: BA reviews the list and decides on appropriate action (delete, assign jobs, or investigate)

### Worker Details

- **File**: `worker/orphanedProgramsWorker.js`
- **Schedule**: Every 5 days (configurable via cron expression)
- **Email Recipient**: Configured via `BA_EMAIL` environment variable
- **Email Subject**: "FourO Alert: Orphaned Programs Detected"

### Email Content

The email includes:
- **Count**: Total number of orphaned programs found
- **Program IDs**: Comma-separated list of program IDs
- **Program Details**: Table showing program number, name, start date, end date, and line ID
- **Action Required**: Instructions for BA to review and take appropriate action

### Configuration

Add to `.env` file:
```
BA_EMAIL=ba@company.com
ORPHANED_PROGRAMS_CHECK_SCHEDULE=0 0 */5 * *  # Every 5 days at midnight UTC
```

### Manual Execution

The worker can also be triggered manually for immediate checks:
```bash
node worker/orphanedProgramsWorker.js --manual
```

## Next Steps for BA

When receiving the email notification:

1. **Review the list** of orphaned program IDs
2. **Verify** if these programs should have jobs assigned
3. **Investigate** why jobs were not created (data entry issue, system bug, etc.)
4. **Take Action**:
   - If programs should have jobs: Create missing jobs
   - If programs are obsolete: Delete them using the provided SQL query
   - If investigation needed: Document findings and escalate

## SQL for Deletion (Use with Caution)

⚠️ **WARNING**: Always backup before deletion!

```sql
START TRANSACTION;

DELETE p
FROM aquafinaflexibleserverdb.programs p
LEFT JOIN aquafinaflexibleserverdb.jobs j
  ON j.programId = p.id
WHERE j.id IS NULL;

-- Review affected rows, then:
-- COMMIT;  (to save changes)
-- ROLLBACK;  (to undo)
```

## Monitoring & Logging

- Worker logs all checks to application logs
- Email sends tracked in Application Insights
- Failed checks are logged with error details
- Worker runs independently and doesn't affect API performance

