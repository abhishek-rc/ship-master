# 🧪 Complete Test Scenarios Guide

This document provides comprehensive test scenarios for the Strapi Offline Sync plugin. Use this guide to verify all functionality works correctly.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Basic Connectivity Tests](#basic-connectivity-tests)
3. [Offline Scenario Tests](#offline-scenario-tests)
4. [Online Sync Tests](#online-sync-tests)
5. [Conflict Resolution Tests](#conflict-resolution-tests)
6. [Data Integrity Tests](#data-integrity-tests)
7. [Edge Case Tests](#edge-case-tests)
8. [Performance Tests](#performance-tests)
9. [Error Handling Tests](#error-handling-tests)
10. [Bi-Directional Sync Tests](#bi-directional-sync-tests)
11. [Reconnection Tests](#reconnection-tests)
12. [Test Checklist](#test-checklist)

---

## 🔧 Prerequisites

Before running any tests, ensure:

- ✅ Master system is running with Kafka
- ✅ Replica system is running and connected
- ✅ Both systems have database migrations applied
- ✅ Network connectivity between master and replica
- ✅ Access to Strapi admin panels on both systems
- ✅ Access to database (for verification)

### ⚠️ Important: Real Internet Disconnection Testing

**For offline scenario tests, use REAL internet disconnection methods:**
- ✅ **Disable WiFi** on your computer (most realistic)
- ✅ **Unplug network cable** (if using Ethernet)
- ✅ **Disable network adapter** (system-level disconnection)

**Do NOT use:**
- ❌ Firewall rules (not realistic for ship scenarios)
- ❌ Port blocking (doesn't simulate real network loss)

**Why?** Real internet disconnection simulates actual ship-at-sea scenarios where WiFi/network is physically unavailable. This tests the system's true offline capabilities.

### Test Environment Setup

**Master System:**
```bash
# Verify Kafka is running
docker ps | findstr kafka

# Check master status
curl http://localhost:1337/api/offline-sync/status
```

**Replica System:**
```bash
# Check replica status
curl http://localhost:1337/api/offline-sync/status

# Should show:
# {
#   "mode": "replica",
#   "shipId": "ship-001",
#   "connected": true
# }
```

---

## 🔌 Basic Connectivity Tests

### Test 1.1: Initial Connection

**Purpose:** Verify replica can connect to master's Kafka

**Steps:**

1. **Start replica system**
   ```bash
   npm run develop
   ```

2. **Check logs for connection messages:**
   ```
   ✅ Kafka producer connected (replica mode)
   ✅ Kafka consumer connected (replica mode)
   📡 Subscribed to topic: master-updates
   💓 Heartbeat sent
   ```

3. **Verify connection status:**
   ```bash
   curl http://localhost:1337/api/offline-sync/status
   ```
   
   Expected: `"connected": true`

4. **Check master logs:**
   - Master should show: `💓 Heartbeat from ship-001 - online`
   - Master should show: `[ShipTracker] ✅ New ship registered: ship-001`

**✅ Pass Criteria:**
- Replica connects successfully
- Master receives heartbeat
- Ship appears in master's dashboard

---

### Test 1.2: Network Connectivity Verification

**Purpose:** Verify network path to master's Kafka

**Steps:**

1. **Test network connectivity:**
   ```powershell
   # Windows
   Test-NetConnection -ComputerName <MASTER_IP> -Port 9092
   
   # Linux/Mac
   telnet <MASTER_IP> 9092
   # or
   nc -zv <MASTER_IP> 9092
   ```

2. **Expected:** Connection succeeds

**✅ Pass Criteria:**
- Port 9092 is accessible
- Network path is clear

---

## 🌊 Offline Scenario Tests

**⚠️ IMPORTANT: Use REAL Internet Disconnection for Testing**

For all offline scenario tests, use **real internet disconnection methods**:
- ✅ **Disable WiFi** on your computer (most realistic)
- ✅ **Unplug network cable** (if using Ethernet)
- ✅ **Disable network adapter** (system-level disconnection)

**Do NOT use firewall rules or port blocking** - these don't simulate real ship-at-sea scenarios where internet is physically unavailable.

---

### Test 2.1: Basic Offline Mode (Internet Disconnection)

**Purpose:** Verify replica works when internet is disconnected

**Prerequisites:**
- Replica is connected and online
- Master's Kafka is running

**Steps:**

1. **Verify initial online status:**
   ```bash
   curl http://localhost:1337/api/offline-sync/status
   ```
   Expected: `"connected": true`

2. **Disconnect internet (REAL SCENARIO - Choose one method):**
   - **Method 1 (WiFi):** Disable WiFi on your computer
     - Windows: Click WiFi icon → Turn off WiFi
     - Mac: Click WiFi icon → Turn WiFi Off
     - Linux: `nmcli radio wifi off`
   
   - **Method 2 (Ethernet):** Unplug network cable from your computer
     - Physically disconnect the Ethernet cable
   
   - **Method 3 (Network Adapter):** Disable network adapter
     - Windows: Control Panel → Network → Disable adapter
     - Mac: System Preferences → Network → Turn off
     - Linux: `sudo ifconfig <interface> down`
   
   **Note:** Use real internet disconnection - this simulates actual ship-at-sea scenarios!

3. **Wait 30-60 seconds** for connectivity monitor to detect

4. **Check status (should show offline):**
   ```bash
   curl http://localhost:1337/api/offline-sync/status
   ```
   Expected: `"connected": false`

5. **Create content while offline:**
   - Go to Strapi admin panel
   - Create a new article: "Test Article - Offline"
   - Save it

6. **Check logs:**
   ```
   ⚠️ Kafka producer connection deferred: Connection timeout
   ⚠️ Operating in offline mode - operations will be queued
   ✅ Content created successfully (saved locally)
   📦 Operation queued for sync (will sync when connection is restored)
   ```

7. **Verify content exists locally:**
   - Check Strapi admin panel - article should be visible
   - Check database - article should exist

8. **Check sync queue:**
   ```bash
   curl http://localhost:1337/api/offline-sync/queue/pending
   ```
   Expected: `{"pending": 1}`

9. **Create more content:**
   - Update the article
   - Create another article
   - Delete an article (if exists)

10. **Check queue again:**
    ```bash
    curl http://localhost:1337/api/offline-sync/queue/pending
    ```
    Expected: Pending count increases

**✅ Pass Criteria:**
- System detects offline status
- Content can be created/updated/deleted offline
- Operations are queued locally
- No errors occur
- Content is visible in local database

---

### Test 2.2: Extended Offline Period

**Purpose:** Test system behavior during long offline periods (hours/days)

**Steps:**

1. **Disconnect internet (REAL SCENARIO):**
   - **WiFi:** Disable WiFi on your computer
   - **Ethernet:** Unplug network cable from your computer
   - **Adapter:** Disable network adapter in system settings
   
   **Use the same method you used in Test 2.1 for consistency.**

2. **Create multiple content items over 15-30 minutes:**
   - Create 10 articles
   - Update 5 articles
   - Delete 3 articles
   - Total: ~18 operations

3. **Check queue periodically:**
   ```bash
   curl http://localhost:1337/api/offline-sync/queue/pending
   ```
   Expected: Count increases with each operation

4. **Verify all content exists locally:**
   - Check Strapi admin panel
   - All articles should be visible
   - Updates should be reflected

5. **Reconnect internet (REAL SCENARIO - Reverse the method you used):**
   - **If you disabled WiFi:** Re-enable WiFi
     - Windows: Click WiFi icon → Turn on WiFi
     - Mac: Click WiFi icon → Turn WiFi On
     - Linux: `nmcli radio wifi on`
   
   - **If you unplugged cable:** Plug network cable back in
     - Physically reconnect the Ethernet cable
   
   - **If you disabled adapter:** Re-enable network adapter
     - Windows: Control Panel → Network → Enable adapter
     - Mac: System Preferences → Network → Turn on
     - Linux: `sudo ifconfig <interface> up`

6. **Wait 30-60 seconds** for automatic sync

7. **Watch logs for sync:**
   ```
   ✅ Kafka producer connected (replica mode)
   🔄 Connectivity restored - starting sync
   📤 Syncing 18 queued operations...
   ✅ Operation synced successfully
   ... (repeats for each operation)
   ✅ All operations synced successfully
   ```

8. **Verify sync completion:**
   ```bash
   curl http://localhost:1337/api/offline-sync/queue/pending
   ```
   Expected: `{"pending": 0}`

9. **Verify on master:**
   - Ask master admin to check database
   - All 10 articles should exist
   - Updates should be applied
   - Deletes should be reflected

**✅ Pass Criteria:**
- System handles extended offline periods
- All operations queued correctly
- All operations sync successfully
- No data loss
- Master receives all changes

---

### Test 2.3: Intermittent Connectivity

**Purpose:** Test behavior with frequent connect/disconnect cycles

**Steps:**

1. **Create content while online**

2. **Disconnect internet** (disable WiFi or unplug cable) → Wait 30 seconds

3. **Create content while offline**

4. **Reconnect internet** (re-enable WiFi or plug cable back in) → Wait for sync

5. **Disconnect internet again** (disable WiFi or unplug cable) → Create more content

6. **Reconnect internet again** (re-enable WiFi or plug cable back in) → Wait for sync

7. **Repeat 3-5 times**

8. **Verify final state:**
   - All content exists on replica
   - All content exists on master
   - Queue is empty

**✅ Pass Criteria:**
- System handles intermittent connectivity
- No duplicate content
- All operations sync correctly
- No errors during cycles

---

## 📤 Online Sync Tests

### Test 3.1: Replica → Master Sync (Create)

**Purpose:** Verify content created on replica syncs to master

**Steps:**

1. **Ensure both systems are online**

2. **Create content on replica:**
   - Article title: "Replica Test Article 1"
   - Add some content
   - Save

3. **Check replica logs:**
   ```
   📨 Sending sync message: create api::article.article
   ✅ Operation synced successfully
   ```

4. **Wait 5-10 seconds**

5. **Verify on master:**
   - Check master database
   - Article should exist
   - Content should match

6. **Check master logs:**
   ```
   📨 Received sync message: ... from ship-001
   ✅ Created api::article.article: ...
   ```

**✅ Pass Criteria:**
- Content syncs to master
- Content matches on both sides
- Sync happens automatically

---

### Test 3.2: Replica → Master Sync (Update)

**Purpose:** Verify updates sync correctly

**Steps:**

1. **Create article on replica** (from Test 3.1)

2. **Wait for sync to master**

3. **Update article on replica:**
   - Change title to "Updated Title"
   - Modify content
   - Save

4. **Wait 5-10 seconds**

5. **Verify on master:**
   - Article title should be "Updated Title"
   - Content should match replica

**✅ Pass Criteria:**
- Updates sync correctly
- Changes appear on master
- No duplicate articles

---

### Test 3.3: Replica → Master Sync (Delete)

**Purpose:** Verify deletes sync correctly

**Steps:**

1. **Create article on replica**

2. **Wait for sync to master**

3. **Delete article on replica**

4. **Wait 5-10 seconds**

5. **Verify on master:**
   - Article should be deleted
   - Should not exist in database

**✅ Pass Criteria:**
- Delete operation syncs
- Article removed on master
- No orphaned records

---

### Test 3.4: Batch Operations Sync

**Purpose:** Verify multiple operations sync in correct order

**Steps:**

1. **Create 5 articles rapidly on replica**

2. **Update 3 of them**

3. **Delete 1**

4. **Wait for sync (may take 10-20 seconds)**

5. **Verify on master:**
   - All 5 articles exist
   - 3 updates applied
   - 1 delete applied
   - Total: 4 articles remain

**✅ Pass Criteria:**
- All operations sync
- Order is preserved
- Final state matches replica

---

## 📥 Master → Replica Sync Tests

### Test 4.1: Master → Replica Sync (Create)

**Purpose:** Verify content created on master syncs to replica

**Steps:**

1. **Ensure both systems are online**

2. **Create content on master:**
   - Article title: "Master Test Article 1"
   - Add content
   - Save

3. **Wait 5-10 seconds**

4. **Check replica logs:**
   ```
   📥 Received master update: create api::article.article
   ✅ Applied master update: ...
   ```

5. **Verify on replica:**
   - Check Strapi admin panel
   - Article should exist
   - Content should match master

**✅ Pass Criteria:**
- Content syncs to replica
- Content matches master
- Sync happens automatically

---

### Test 4.2: Master → Replica Sync (Update)

**Purpose:** Verify master updates sync to replica

**Steps:**

1. **Create article on master**

2. **Wait for sync to replica**

3. **Update article on master:**
   - Change title
   - Modify content
   - Save

4. **Wait 5-10 seconds**

5. **Verify on replica:**
   - Article should be updated
   - Changes should match master

**✅ Pass Criteria:**
- Updates sync correctly
- Changes appear on replica
- No duplicates

---

### Test 4.3: Master → Replica Sync (Delete)

**Purpose:** Verify master deletes sync to replica

**Steps:**

1. **Create article on master**

2. **Wait for sync to replica**

3. **Delete article on master**

4. **Wait 5-10 seconds**

5. **Verify on replica:**
   - Article should be deleted
   - Should not exist in database

**✅ Pass Criteria:**
- Delete syncs correctly
- Article removed on replica
- No orphaned records

---

## ⚔️ Conflict Resolution Tests

### Test 5.1: Concurrent Update Conflict

**Purpose:** Test conflict detection when same content modified on both sides

**Steps:**

1. **Create article on master:**
   - Title: "Conflict Test Article"
   - Content: "Original content"

2. **Wait for sync to replica**

3. **Update on replica (while online):**
   - Title: "Replica Updated Title"
   - Content: "Replica content"

4. **Immediately update on master (before replica syncs):**
   - Title: "Master Updated Title"
   - Content: "Master content"

5. **Wait for conflict detection**

6. **Check conflict logs:**
   ```
   ⚠️ Conflict detected: api::article.article / <documentId>
   📋 Conflict logged for resolution
   ```

7. **Check conflict queue:**
   ```bash
   curl http://localhost:1337/api/offline-sync/conflicts
   ```

8. **Resolve conflict** (on master admin panel):
   - Choose resolution strategy: `keep-master`, `keep-ship`, or `merge`
   - Apply resolution

9. **Verify resolution:**
   - Check both systems
   - Final state should match resolution choice

**✅ Pass Criteria:**
- Conflict detected correctly
- Conflict logged for resolution
- Resolution applies correctly
- Both systems match after resolution

---

### Test 5.2: Offline Conflict (Replica Offline)

**Purpose:** Test conflict when replica goes offline, master updates, then replica updates

**Steps:**

1. **Create article on master:**
   - Title: "Offline Conflict Test"

2. **Wait for sync to replica**

3. **Disconnect replica internet** (disable WiFi or unplug cable)

4. **Update on master:**
   - Title: "Master Updated While Replica Offline"

5. **Update on replica (offline):**
   - Title: "Replica Updated Offline"

6. **Reconnect replica internet** (re-enable WiFi or plug cable back in)

7. **Wait for sync and conflict detection**

8. **Check conflict logs**

9. **Resolve conflict**

10. **Verify final state**

**✅ Pass Criteria:**
- Conflict detected after reconnection
- Both changes preserved in conflict log
- Resolution works correctly

---

### Test 5.3: Conflict Resolution Strategies

**Purpose:** Test all three conflict resolution strategies

**Test 5.3.1: Keep Master**

**Steps:**

1. Create conflict (as in Test 5.1)

2. Resolve with `keep-master`

3. Verify:
   - Master version is kept
   - Replica matches master
   - Ship version discarded

**Test 5.3.2: Keep Ship**

**Steps:**

1. Create conflict

2. Resolve with `keep-ship`

3. Verify:
   - Ship version is kept
   - Master matches ship
   - Master version discarded

**Test 5.3.3: Merge**

**Steps:**

1. Create conflict

2. Resolve with `merge`

3. Verify:
   - Both changes combined
   - No data loss
   - Both systems match

**✅ Pass Criteria:**
- All strategies work correctly
- No data loss
- Both systems match after resolution

---

## 🔒 Data Integrity Tests

### Test 6.1: No Data Loss During Offline

**Purpose:** Verify no data is lost during offline periods

**Steps:**

1. **Create 10 articles while online**

2. **Note all article IDs/titles**

3. **Disconnect internet** (disable WiFi or unplug cable)

4. **Create 5 more articles**

5. **Update 3 existing articles**

6. **Delete 2 articles**

7. **Note all changes**

8. **Reconnect internet** (re-enable WiFi or plug cable back in)

9. **Wait for sync**

10. **Verify:**
    - All 10 original articles exist
    - 5 new articles exist
    - 3 updates applied
    - 2 deletes applied
    - Total: 13 articles (10 + 5 - 2)

**✅ Pass Criteria:**
- No data loss
- All operations preserved
- Final count matches expected

---

### Test 6.2: Database Consistency

**Purpose:** Verify database consistency across operations

**Steps:**

1. **Create article with relations:**
   - Article with author
   - Article with category
   - Article with tags

2. **Sync to master**

3. **Verify relations on master:**
   - Author relation exists
   - Category relation exists
   - Tags relations exist

4. **Update relations on replica**

5. **Sync to master**

6. **Verify relations updated**

**✅ Pass Criteria:**
- Relations sync correctly
- No broken references
- Data consistency maintained

---

### Test 6.3: Transaction Integrity

**Purpose:** Verify operations maintain transaction integrity

**Steps:**

1. **Create article with multiple fields**

2. **Update multiple fields simultaneously**

3. **Sync to master**

4. **Verify:**
   - All fields updated together
   - No partial updates
   - Data integrity maintained

**✅ Pass Criteria:**
- All fields sync together
- No partial updates
- Transaction integrity maintained

---

## 🎯 Edge Case Tests

### Test 7.1: Large Content Sync

**Purpose:** Test sync with large content (images, files, large text)

**Steps:**

1. **Create article with:**
   - Large text content (10,000+ characters)
   - Multiple images
   - File attachments

2. **Sync to master**

3. **Verify:**
   - All content syncs
   - Images upload correctly
   - Files transfer correctly
   - No truncation

**✅ Pass Criteria:**
- Large content syncs correctly
- No size limitations
- All files transfer

---

### Test 7.2: Special Characters

**Purpose:** Test sync with special characters and Unicode

**Steps:**

1. **Create article with:**
   - Special characters: `!@#$%^&*()`
   - Unicode: `中文 العربية русский`
   - Emojis: `🚢 🌊 📡`

2. **Sync to master**

3. **Verify:**
   - All characters preserved
   - Encoding correct
   - Display correct

**✅ Pass Criteria:**
- Special characters preserved
- Unicode handled correctly
- No encoding issues

---

### Test 7.3: Rapid Operations

**Purpose:** Test system under rapid operation load

**Steps:**

1. **Create 50 articles rapidly** (within 1 minute)

2. **Wait for sync**

3. **Verify:**
   - All operations queued
   - All operations synced
   - No errors
   - Order preserved

**✅ Pass Criteria:**
- System handles rapid operations
- All operations processed
- No errors or timeouts

---

### Test 7.4: Empty Operations

**Purpose:** Test edge cases with empty/null data

**Steps:**

1. **Create article with empty title**

2. **Create article with null fields**

3. **Sync to master**

4. **Verify:**
   - Empty values handled
   - Null values handled
   - No errors

**✅ Pass Criteria:**
- Empty values sync correctly
- Null values handled
- No errors

---

## ⚡ Performance Tests

### Test 8.1: Sync Speed

**Purpose:** Measure sync performance

**Steps:**

1. **Create 100 articles on replica**

2. **Record start time**

3. **Wait for sync completion**

4. **Record end time**

5. **Calculate:**
   - Total time
   - Operations per second
   - Average time per operation

**Expected:**
- 100 operations sync within 30-60 seconds
- ~2-3 operations per second

**✅ Pass Criteria:**
- Sync completes in reasonable time
- Performance meets expectations

---

### Test 8.2: Queue Management

**Purpose:** Test queue performance with large backlog

**Steps:**

1. **Disconnect internet** (disable WiFi or unplug cable)

2. **Create 500 articles** (while offline)

3. **Reconnect internet**

4. **Monitor sync:**
   - Queue processing
   - Memory usage
   - CPU usage

5. **Verify:**
   - All operations sync
   - No memory leaks
   - Performance stable

**✅ Pass Criteria:**
- Large queue processed correctly
- No performance degradation
- No memory leaks

---

## 🚨 Error Handling Tests

### Test 9.1: Invalid Data Handling

**Purpose:** Test system behavior with invalid data

**Steps:**

1. **Attempt to create article with invalid data:**
   - Missing required fields
   - Invalid field types
   - Invalid relations

2. **Verify:**
   - Errors caught
   - Error messages clear
   - System continues working

**✅ Pass Criteria:**
- Invalid data rejected
- Clear error messages
- System stability maintained

---

### Test 9.2: Network Timeout Handling

**Purpose:** Test behavior during network timeouts

**Steps:**

1. **Simulate slow network** (throttle connection)

2. **Create content**

3. **Verify:**
   - Operations retry
   - No data loss
   - Eventually syncs

**✅ Pass Criteria:**
- Retries work correctly
- No data loss
- Eventually succeeds

---

### Test 9.3: Master Unavailable

**Purpose:** Test behavior when master is temporarily unavailable

**Steps:**

1. **Stop master's Kafka** (temporarily)

2. **Create content on replica**

3. **Operations should queue**

4. **Restart master's Kafka**

5. **Verify sync resumes**

**✅ Pass Criteria:**
- Operations queue when master unavailable
- Sync resumes automatically
- No data loss

---

## 🔄 Bi-Directional Sync Tests

### Test 10.1: Simultaneous Updates

**Purpose:** Test bi-directional sync with simultaneous updates

**Steps:**

1. **Create article on master**

2. **Wait for sync to replica**

3. **Update on master:**
   - Change title to "Master Update"

4. **Simultaneously update on replica:**
   - Change title to "Replica Update"

5. **Wait for both syncs**

6. **Verify conflict detection**

7. **Resolve conflict**

**✅ Pass Criteria:**
- Both updates detected
- Conflict resolved correctly
- Final state consistent

---

### Test 10.2: Cascading Updates

**Purpose:** Test updates that trigger other updates

**Steps:**

1. **Create article with author**

2. **Update author name**

3. **Verify:**
   - Article updates
   - Author updates
   - Relations maintained

**✅ Pass Criteria:**
- Cascading updates work
- Relations maintained
- No broken references

---

## 🔌 Reconnection Tests

### Test 11.1: Automatic Reconnection

**Purpose:** Verify automatic reconnection after internet restored

**Steps:**

1. **Disconnect internet** (disable WiFi or unplug cable)

2. **Create content**

3. **Reconnect internet**

4. **Monitor logs:**
   ```
   ✅ Kafka producer connected (replica mode)
   🔄 Connectivity restored - starting sync
   📤 Syncing X queued operations...
   ```

5. **Verify:**
   - Reconnection happens automatically
   - No manual steps needed
   - Sync starts automatically

**✅ Pass Criteria:**
- Reconnection automatic
- No manual intervention
- Sync starts immediately

---

### Test 11.2: Reconnection Retry

**Purpose:** Test reconnection retry mechanism

**Steps:**

1. **Disconnect internet** (disable WiFi or unplug cable)

2. **Create content**

3. **Reconnect internet briefly** (re-enable WiFi or plug cable back in, then disconnect again before sync completes)

4. **Reconnect internet again** (re-enable WiFi or plug cable back in)

5. **Verify:**
   - System retries connection
   - Operations still queued
   - Eventually syncs

**✅ Pass Criteria:**
- Retry mechanism works
- No data loss during retries
- Eventually succeeds

---

### Test 11.3: Connection Stability

**Purpose:** Test system stability during connection changes

**Steps:**

1. **Perform multiple connect/disconnect cycles** (disable/enable WiFi or plug/unplug cable)

2. **Create content during each cycle**

3. **Verify:**
   - System remains stable
   - No crashes
   - All operations eventually sync

**✅ Pass Criteria:**
- System stable during cycles
- No crashes or errors
- All operations sync

---

## ✅ Test Checklist

Use this checklist to verify all tests pass:

### Basic Functionality
- [ ] Replica connects to master
- [ ] Heartbeat sends correctly
- [ ] Master receives heartbeats
- [ ] Ship appears in master dashboard

### Offline Scenarios
- [ ] System detects offline status
- [ ] Content can be created offline
- [ ] Content can be updated offline
- [ ] Content can be deleted offline
- [ ] Operations queue correctly
- [ ] No data loss during offline

### Online Sync
- [ ] Replica → Master sync works
- [ ] Master → Replica sync works
- [ ] Create operations sync
- [ ] Update operations sync
- [ ] Delete operations sync
- [ ] Batch operations sync

### Conflict Resolution
- [ ] Conflicts detected correctly
- [ ] Conflicts logged for resolution
- [ ] Keep-master strategy works
- [ ] Keep-ship strategy works
- [ ] Merge strategy works

### Data Integrity
- [ ] No data loss
- [ ] Relations sync correctly
- [ ] Transaction integrity maintained
- [ ] Database consistency maintained

### Edge Cases
- [ ] Large content syncs
- [ ] Special characters handled
- [ ] Rapid operations handled
- [ ] Empty/null values handled

### Performance
- [ ] Sync speed acceptable
- [ ] Large queues processed
- [ ] No memory leaks
- [ ] Performance stable

### Error Handling
- [ ] Invalid data rejected
- [ ] Network timeouts handled
- [ ] Master unavailable handled
- [ ] Errors logged correctly

### Reconnection
- [ ] Automatic reconnection works
- [ ] Retry mechanism works
- [ ] Connection stability maintained

---

## 📊 Test Results Template

Use this template to record test results:

```
Test Scenario: [Test Name]
Date: [Date]
Tester: [Name]
Environment: [Master IP, Replica ID, etc.]

Steps Performed:
1. [Step 1]
2. [Step 2]
...

Expected Results:
- [Expected result 1]
- [Expected result 2]
...

Actual Results:
- [Actual result 1]
- [Actual result 2]
...

Status: ✅ PASS / ❌ FAIL
Notes: [Any additional notes]
```

---

## 🐛 Troubleshooting During Tests

### Issue: Operations Not Syncing

**Check:**
1. Is replica connected? `curl http://localhost:1337/api/offline-sync/status`
2. Is master's Kafka running? `docker ps | findstr kafka`
3. Check logs for errors
4. Check sync queue: `curl http://localhost:1337/api/offline-sync/queue/pending`

### Issue: Conflicts Not Detected

**Check:**
1. Verify both systems modified same content
2. Check conflict logs: `curl http://localhost:1337/api/offline-sync/conflicts`
3. Verify conflict detection is enabled

### Issue: Reconnection Not Working

**Check:**
1. Verify internet is actually reconnected:
   - WiFi is enabled (if using WiFi)
   - Network cable is plugged in (if using Ethernet)
   - Network adapter is enabled
   - Can access other websites/services
2. Check connectivity monitor logs
3. Verify Kafka is accessible: `telnet <MASTER_IP> 9092` or `Test-NetConnection -ComputerName <MASTER_IP> -Port 9092`
4. Wait 30-60 seconds for automatic reconnection detection

---

## 📝 Notes

- Run tests in order for best results
- Some tests depend on previous tests
- Keep master's Kafka running during all tests
- Document any issues found
- Retest after fixes

---

**Last Updated:** [Date]
**Version:** 1.0

