# 🧪 API Testing Examples - Job Recalculation

Quick reference for testing the Job Recalculation API endpoints.

---

## 🔧 Setup

**Base URL (Local):** `http://localhost:8011/api`  
**Base URL (Azure):** `https://fouro-api-fggchubgdqf5c2bj.z03.azurefd.net/api`

---

## 📡 Endpoint 1: Single Job Recalculation

### Request

```http
POST /api/jobs/:id/recalculate
Content-Type: application/json
```

### cURL Example

```bash
# Replace :id with actual job ID
curl -X POST http://localhost:8011/api/jobs/123/recalculate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Success Response (200)

```json
{
  "success": true,
  "message": "Recalculation queued successfully for job \"Batch_2025_001\"",
  "jobId": 123,
  "jobName": "Batch_2025_001",
  "line": "Line 1",
  "sku": "SKU_ABC_500ML",
  "queueResult": {
    "queued": true,
    "bullJobId": "789",
    "timestamp": "2025-12-12T20:15:30.000Z"
  }
}
```

### Error Response (404) - Job Not Found

```json
{
  "success": false,
  "message": "Job with ID 123 not found"
}
```

### Error Response (400) - Invalid Job

```json
{
  "success": false,
  "message": "Job must have actual start and end times to recalculate aggregates",
  "jobId": 123
}
```

### Error Response (400) - Invalid ID

```json
{
  "success": false,
  "message": "Invalid job ID provided"
}
```

---

## 📡 Endpoint 2: Bulk Job Recalculation

### Request

```http
POST /api/jobs/bulk-recalculate
Content-Type: application/json

{
  "jobIds": [1, 2, 3, 4, 5]
}
```

### cURL Example

```bash
curl -X POST http://localhost:8011/api/jobs/bulk-recalculate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "jobIds": [1, 2, 3, 4, 5]
  }'
```

### Success Response (200) - All Successful

```json
{
  "success": true,
  "message": "Queued 5 of 5 jobs for recalculation",
  "summary": {
    "total": 5,
    "queued": 5,
    "failed": 0,
    "invalid": 0
  },
  "results": {
    "successful": [
      {
        "success": true,
        "jobId": 1,
        "jobName": "Batch_001",
        "line": "Line 1",
        "sku": "SKU_A",
        "result": {
          "queued": true,
          "bullJobId": "101",
          "timestamp": "2025-12-12T20:15:30.000Z"
        }
      },
      {
        "success": true,
        "jobId": 2,
        "jobName": "Batch_002",
        "line": "Line 2",
        "sku": "SKU_B",
        "result": {
          "queued": true,
          "bullJobId": "102",
          "timestamp": "2025-12-12T20:15:30.100Z"
        }
      }
      // ... more successful jobs
    ],
    "failed": []
  }
}
```

### Partial Success Response (200) - Some Failed

```json
{
  "success": true,
  "message": "Queued 3 of 5 jobs for recalculation",
  "summary": {
    "total": 5,
    "queued": 3,
    "failed": 1,
    "invalid": 1
  },
  "results": {
    "successful": [
      {
        "success": true,
        "jobId": 1,
        "jobName": "Batch_001",
        "line": "Line 1",
        "sku": "SKU_A",
        "result": {
          "queued": true,
          "bullJobId": "101"
        }
      }
      // ... more successful jobs
    ],
    "failed": [
      {
        "id": 4,
        "jobName": "Batch_004",
        "reason": "Missing actual start or end time"
      },
      {
        "id": 5,
        "jobName": "Unknown",
        "reason": "Job not found"
      }
    ]
  }
}
```

### Error Response (400) - Empty Array

```json
{
  "success": false,
  "message": "jobIds must be a non-empty array"
}
```

### Error Response (400) - Too Many Jobs

```json
{
  "success": false,
  "message": "Bulk recalculation limited to 50 jobs at once. Please select fewer jobs.",
  "limit": 50,
  "requested": 75
}
```

### Error Response (400) - Invalid Job IDs

```json
{
  "success": false,
  "message": "No valid job IDs provided"
}
```

### Error Response (404) - No Jobs Found

```json
{
  "success": false,
  "message": "No valid jobs found with provided IDs"
}
```

---

## 🧪 Postman Collection

### Collection Structure

```
Job Recalculation API
├── Single Job Recalculation
│   ├── Success Case
│   ├── Job Not Found
│   ├── Invalid Job (No Times)
│   └── Invalid ID
└── Bulk Job Recalculation
    ├── All Successful
    ├── Partial Success
    ├── Empty Array
    ├── Too Many Jobs
    └── No Jobs Found
```

### Environment Variables

```json
{
  "base_url": "http://localhost:8011/api",
  "auth_token": "YOUR_TOKEN_HERE",
  "test_job_id": "123",
  "test_job_ids": "[1, 2, 3, 4, 5]"
}
```

---

## 🔍 Testing Scenarios

### Scenario 1: Happy Path - Single Job

```bash
# 1. Get a valid job ID first
curl http://localhost:8011/api/jobs/getAll/paginated?limit=1&page=0

# 2. Extract job ID from response (e.g., 123)

# 3. Trigger recalculation
curl -X POST http://localhost:8011/api/jobs/123/recalculate

# 4. Check job status
curl http://localhost:8011/api/job-status/123

# Expected: Status changes from "pending" → "processing" → "completed"
```

### Scenario 2: Happy Path - Bulk

```bash
# 1. Get multiple job IDs
curl http://localhost:8011/api/jobs/getAll/paginated?limit=5&page=0

# 2. Extract job IDs (e.g., [1, 2, 3, 4, 5])

# 3. Trigger bulk recalculation
curl -X POST http://localhost:8011/api/jobs/bulk-recalculate \
  -H "Content-Type: application/json" \
  -d '{"jobIds": [1, 2, 3, 4, 5]}'

# 4. Check batch status
curl -X POST http://localhost:8011/api/job-status/batch \
  -H "Content-Type: application/json" \
  -d '{"jobIds": [1, 2, 3, 4, 5]}'
```

### Scenario 3: Error Handling - Invalid Job

```bash
# Try to recalculate a job without actual times
curl -X POST http://localhost:8011/api/jobs/999/recalculate

# Expected: 400 error with message about missing times
```

### Scenario 4: Error Handling - Too Many Jobs

```bash
# Try to recalculate 51 jobs (over limit)
curl -X POST http://localhost:8011/api/jobs/bulk-recalculate \
  -H "Content-Type: application/json" \
  -d '{"jobIds": [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51]}'

# Expected: 400 error with limit message
```

### Scenario 5: Real-time Updates

```bash
# 1. Open WebSocket connection (in browser console)
const ws = new WebSocket('ws://localhost:8011');
ws.onmessage = (event) => console.log('Received:', event.data);

# 2. Subscribe to job updates
ws.send(JSON.stringify({
  type: 'subscribe',
  jobId: 123,
  userId: 'your-user-id'
}));

# 3. Trigger recalculation (in another terminal)
curl -X POST http://localhost:8011/api/jobs/123/recalculate

# 4. Watch WebSocket messages in console
# Expected: Real-time status updates
```

---

## 📊 Response Time Benchmarks

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| Single Job Queue | < 100ms | Just queuing, not processing |
| Bulk Queue (10 jobs) | < 500ms | Parallel validation |
| Bulk Queue (50 jobs) | < 2s | Max allowed |
| Actual Processing | 5-30s | Depends on job size |

---

## 🔐 Authentication

If your API requires authentication, add the token:

### Header-based Auth

```bash
curl -X POST http://localhost:8011/api/jobs/123/recalculate \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

### Cookie-based Auth

```bash
curl -X POST http://localhost:8011/api/jobs/123/recalculate \
  -H "Content-Type: application/json" \
  -b "session=YOUR_SESSION_COOKIE"
```

---

## 🐛 Debugging Tips

### Check Job Exists

```bash
curl http://localhost:8011/api/jobs/123
```

### Check Job Has Valid Times

```bash
curl http://localhost:8011/api/jobs/123 | jq '.actualStartTime, .actualEndTime'
```

### Check Queue Status

```bash
# If you have queue monitoring endpoint
curl http://localhost:8011/api/queue/stats
```

### Check Redis Connection

```bash
# In backend terminal
redis-cli ping
# Expected: PONG
```

### Check WebSocket Connection

```javascript
// In browser console
const ws = new WebSocket('ws://localhost:8011');
ws.onopen = () => console.log('Connected');
ws.onerror = (error) => console.error('Error:', error);
ws.onclose = () => console.log('Disconnected');
```

---

## 📝 Sample Test Data

### Valid Job IDs (Example)

```json
{
  "single_job": 123,
  "bulk_jobs": [1, 2, 3, 4, 5],
  "large_bulk": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
}
```

### Invalid Job IDs (For Error Testing)

```json
{
  "non_existent": 99999,
  "invalid_format": "abc",
  "empty_array": [],
  "over_limit": [1, 2, 3, ..., 51]  // 51 jobs
}
```

---

## 🎯 Expected Behaviors

### ✅ Success Cases

1. **Single Job Recalculation**
   - Returns 200 status
   - Job is queued
   - Bull job ID returned
   - Status updates via WebSocket

2. **Bulk Recalculation**
   - Returns 200 status
   - All valid jobs queued
   - Detailed breakdown provided
   - Invalid jobs listed separately

### ❌ Error Cases

1. **Job Not Found**
   - Returns 404 status
   - Clear error message

2. **Invalid Job Data**
   - Returns 400 status
   - Explains what's missing

3. **Too Many Jobs**
   - Returns 400 status
   - Shows limit and requested count

4. **Invalid Input**
   - Returns 400 status
   - Describes validation error

---

## 🚀 Quick Test Script

Save this as `test-recalculation.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:8011/api"

echo "🧪 Testing Job Recalculation API"
echo "================================"

# Test 1: Single Job
echo "\n📝 Test 1: Single Job Recalculation"
curl -X POST "$BASE_URL/jobs/1/recalculate" \
  -H "Content-Type: application/json" \
  -w "\nStatus: %{http_code}\n"

# Test 2: Bulk Jobs
echo "\n📝 Test 2: Bulk Recalculation"
curl -X POST "$BASE_URL/jobs/bulk-recalculate" \
  -H "Content-Type: application/json" \
  -d '{"jobIds": [1, 2, 3]}' \
  -w "\nStatus: %{http_code}\n"

# Test 3: Invalid Job
echo "\n📝 Test 3: Invalid Job (Should Fail)"
curl -X POST "$BASE_URL/jobs/99999/recalculate" \
  -H "Content-Type: application/json" \
  -w "\nStatus: %{http_code}\n"

# Test 4: Empty Array
echo "\n📝 Test 4: Empty Array (Should Fail)"
curl -X POST "$BASE_URL/jobs/bulk-recalculate" \
  -H "Content-Type: application/json" \
  -d '{"jobIds": []}' \
  -w "\nStatus: %{http_code}\n"

echo "\n✅ Tests Complete!"
```

Run with:
```bash
chmod +x test-recalculation.sh
./test-recalculation.sh
```

---

## 📚 Additional Resources

- **Full Documentation:** `JOB_RECALCULATION_FEATURE.md`
- **Quick Start:** `QUICK_START_JOB_RECALCULATION.md`
- **Implementation Summary:** `IMPLEMENTATION_SUMMARY.md`

---

**Happy Testing! 🎉**

