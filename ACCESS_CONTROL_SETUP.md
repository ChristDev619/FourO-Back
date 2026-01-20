# 🔐 Access Control Setup for Job Recalculation

## ✅ What I Updated

The JobRecalculation page now has **proper access control** integrated!

### Changes Made:
1. ✅ Added `useAccessControl("JobRecalculation")` hook
2. ✅ Recalculate buttons disabled for users without permission
3. ✅ Bulk recalculation hidden for users without permission
4. ✅ Warning message shown if user lacks permission
5. ✅ Admin role gets full access automatically

---

## 🎯 How Access Control Works

### Two Levels of Access:

#### 1. **Page Access** (Viewing)
- ✅ Controlled by NextAuth session
- ✅ Anyone logged in can view the page
- ✅ Already working!

#### 2. **Action Permissions** (Recalculation)
- ⚠️ Controlled by Access Levels (Levels table)
- ⚠️ Needs to be configured in database
- 📝 **YOU NEED TO SET THIS UP**

---

## 📝 Setup Instructions

### Option 1: Automatic (Admins Get Full Access)

**Good news:** If your user has `role: 'admin'` in the database, they automatically have full access! No setup needed.

```sql
-- Check if your user is admin
SELECT id, username, role FROM Users WHERE username = 'your_username';

-- If not admin, make them admin
UPDATE Users SET role = 'admin' WHERE username = 'your_username';
```

### Option 2: Manual (Configure via Access Levels Page)

Follow these steps to add JobRecalculation to access levels:

#### Step 1: Go to Access Levels Page
Navigate to: `/AccessLevels` in your frontend

#### Step 2: Edit or Create Access Level

**If creating new level:**
1. Click "Add New Level" button
2. Enter Level Name (e.g., "Developer", "Operator", etc.)

**If editing existing level:**
1. Click Edit icon on the level you want to modify

#### Step 3: Add JobRecalculation Page

In the "Page Access Control" section:

1. **Page Name:** `JobRecalculation` (exact match, case-sensitive!)
2. **Permissions:**
   - ✅ **Can Create** - Allows triggering recalculation (REQUIRED)
   - ⬜ **Can Edit** - Not used for this page
   - ⬜ **Can Delete** - Not used for this page

3. Click "Add" to add the page to the access list

#### Step 4: Save the Level
Click "Save" or "Update" to save the access level

#### Step 5: Assign Level to Users
Make sure users are assigned to this level in the Users table

```sql
-- Assign level to user
UPDATE Users SET levelId = <level_id> WHERE id = <user_id>;
```

---

## 🎨 Visual Guide

### Access Levels Dialog Structure:

```
┌────────────────────────────────────────────┐
│  Add New Access Level                      │
├────────────────────────────────────────────┤
│                                            │
│  Level Name: [Developer             ]     │
│                                            │
│  ┌──────────────────────────────────────┐ │
│  │ Page Access Control                  │ │
│  ├──────────────────────────────────────┤ │
│  │ Page Name: [JobRecalculation    ]   │ │
│  │ □ Can Create  □ Can Edit  □ Can Delete │
│  │              [Add]                   │ │
│  │                                      │ │
│  │ Current Pages:                       │ │
│  │ • JobRecalculation (Create: ✓)      │ │
│  │ • ProductionRun (Create: ✓ Edit: ✓) │ │
│  │ • ... more pages ...                 │ │
│  └──────────────────────────────────────┘ │
│                                            │
│              [Cancel]  [Save]              │
└────────────────────────────────────────────┘
```

---

## 🔍 Permission Meanings

| Permission | What It Means for JobRecalculation |
|------------|-------------------------------------|
| **Can Create** | ✅ **Required!** - Allows triggering recalculation (single & bulk) |
| **Can Edit** | ❌ Not used - No edit functionality on this page |
| **Can Delete** | ❌ Not used - No delete functionality on this page |

**Important:** You MUST enable "Can Create" for users to trigger recalculation!

---

## 🧪 Testing Access Control

### Test 1: Admin User (Should Work)
1. Login as admin user (`role: 'admin'`)
2. Go to `/JobRecalculation`
3. ✅ Recalculate buttons should be enabled
4. ✅ Can trigger single recalculation
5. ✅ Can trigger bulk recalculation

### Test 2: User With Permission (Should Work)
1. Login as regular user
2. Ensure user's level has "JobRecalculation" with "Can Create" ✓
3. Go to `/JobRecalculation`
4. ✅ Recalculate buttons should be enabled
5. ✅ Can trigger recalculations

### Test 3: User Without Permission (Should Block)
1. Login as regular user
2. Ensure user's level does NOT have "JobRecalculation" page
3. Go to `/JobRecalculation`
4. ✅ Can still view the page and list
5. ❌ Recalculate buttons should be disabled
6. ⚠️ Warning message should appear if jobs are selected

---

## 📊 Database Structure

### Relevant Tables:

```sql
-- Users table
Users
├── id
├── username
├── role (admin/user)
└── levelId (FK to Levels)

-- Levels table
Levels
├── id
├── name
└── accessList (JSON)
    └── [
          {
            "pageName": "JobRecalculation",
            "canCreate": true,
            "canEdit": false,
            "canDelete": false
          }
        ]

-- Example accessList JSON:
[
  {
    "pageName": "ProductionRun",
    "canCreate": true,
    "canEdit": true,
    "canDelete": false
  },
  {
    "pageName": "JobRecalculation",
    "canCreate": true,
    "canEdit": false,
    "canDelete": false
  }
]
```

---

## 🔧 Quick SQL Commands

### Check Current Access Levels:
```sql
SELECT id, name, accessList FROM Levels;
```

### Add JobRecalculation to Existing Level (Manual):
```sql
-- Get current accessList
SELECT id, name, accessList FROM Levels WHERE id = 1;

-- Update accessList (replace [...] with current array + new page)
UPDATE Levels 
SET accessList = '[
  {
    "pageName": "ProductionRun",
    "canCreate": true,
    "canEdit": true,
    "canDelete": false
  },
  {
    "pageName": "JobRecalculation",
    "canCreate": true,
    "canEdit": false,
    "canDelete": false
  }
]'
WHERE id = 1;
```

### Create New Developer Level:
```sql
INSERT INTO Levels (name, accessList, createdAt, updatedAt)
VALUES (
  'Developer',
  '[
    {
      "pageName": "JobRecalculation",
      "canCreate": true,
      "canEdit": false,
      "canDelete": false
    }
  ]',
  NOW(),
  NOW()
);
```

### Assign Level to User:
```sql
-- Get level ID
SELECT id FROM Levels WHERE name = 'Developer';

-- Assign to user
UPDATE Users SET levelId = <level_id> WHERE username = 'your_username';
```

---

## ⚡ Quick Setup (For Testing)

If you want to quickly test, just make your user an admin:

```sql
UPDATE Users SET role = 'admin' WHERE username = 'your_username';
```

Then logout and login again. You'll have full access immediately!

---

## 🚨 Important Notes

### Page Name Must Match Exactly!
- ✅ Correct: `JobRecalculation`
- ❌ Wrong: `jobrecalculation`
- ❌ Wrong: `Job Recalculation`
- ❌ Wrong: `JobRecalc`

The page name in the access level MUST match exactly what's passed to `useAccessControl("JobRecalculation")`

### Permission Required
- Users need **"Can Create"** permission for JobRecalculation
- Without it, they can view the page but cannot trigger recalculation
- Admin role bypasses all permission checks

### Session Required
- Users must be logged in (NextAuth session)
- Session provides user info and level data
- Access control checks happen client-side

---

## 🎯 Recommended Setup

### For Production Environment:

Create different access levels:

1. **Admin Level**
   - All pages with all permissions
   - OR just set user `role: 'admin'`

2. **Developer Level**
   - JobRecalculation (Create ✓)
   - ProductionRun (Create ✓, Edit ✓)
   - Dashboard viewing

3. **Operator Level**
   - ProductionRun (View only)
   - Dashboard viewing
   - NO JobRecalculation access

4. **Viewer Level**
   - Dashboard viewing only
   - NO recalculation or editing

---

## 📚 Related Files

- **Frontend Hook:** `app/(components)/utils/useAccessControl.js`
- **Page:** `app/JobRecalculation/page.js`
- **Access Levels Page:** `app/AccessLevels/page.js`
- **Backend Model:** `models/level.model.js`
- **Backend Controller:** `controllers/level.controller.js`

---

## ❓ FAQ

### Q: Can anyone access the page URL?
**A:** Yes, anyone logged in can access `/JobRecalculation`. They can view jobs but cannot trigger recalculation without permission.

### Q: What if I don't set up access levels?
**A:** Admin users will work fine. Regular users won't be able to trigger recalculation.

### Q: Do I need to restart the server?
**A:** No! Access levels are checked in real-time from the database.

### Q: How do I remove access?
**A:** Either remove the page from the user's level or set `canCreate: false`.

---

## ✅ Summary

**What You Need to Do:**

1. **Quick Way (Admin Users):**
   ```sql
   UPDATE Users SET role = 'admin' WHERE username = 'your_username';
   ```

2. **Proper Way (Access Levels):**
   - Go to `/AccessLevels` page
   - Add "JobRecalculation" page to your level
   - Enable "Can Create" permission
   - Assign level to users

**That's it!** Your JobRecalculation page now has proper access control! 🎉

---

**Version:** 1.0.0  
**Date:** December 12, 2025

