# 🎯 Master Setup Summary (For Your Reference)

Quick reference for setting up your system as Master.

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  YOUR SYSTEM (Master)                                   │
│                                                         │
│  ┌──────────────┐         ┌──────────────┐            │
│  │   Strapi     │◄───────►│    Kafka     │            │
│  │   (Master)   │         │  (Docker)    │            │
│  └──────────────┘         └──────┬───────┘            │
│                                  │ Port 9092          │
│                                  │ (Exposed)          │
└──────────────────────────────────┼─────────────────────┘
                                   │
                                   │ Network Connection
                                   │
┌──────────────────────────────────┼─────────────────────┐
│  FRIEND'S SYSTEM (Replica)        │                     │
│                                   │                     │
│  ┌──────────────┐                │                     │
│  │   Strapi     │────────────────┘                     │
│  │  (Replica)   │  Connects to YOUR Kafka             │
│  └──────────────┘  (No Kafka needed on replica!)      │
└─────────────────────────────────────────────────────────┘
```

**Key Points:**
- ✅ You run Kafka in Docker
- ✅ Your friend connects to YOUR Kafka (no Kafka needed on their side)
- ✅ Port 9092 must be accessible from network
- ⚠️ **Kafka MUST be running for sync to work** - it's the communication channel

---

## ⚠️ Critical: Kafka Availability

### What Happens When Kafka is Down?

**If you close Docker Kafka:**
- ❌ Replicas **cannot** sync to master (no communication channel)
- ✅ Replicas **continue working** locally (offline mode)
- ✅ All operations are **queued** in replica's `sync_queue` table
- ✅ **No data loss** - everything is saved locally

**When you restart Kafka:**
- ✅ Replicas **automatically detect** Kafka is back online
- ✅ Replicas **automatically reconnect** (no manual steps needed)
- ✅ All queued operations **automatically sync** to master
- ✅ Master receives all changes that happened while Kafka was down

### Best Practice

**Keep Kafka running continuously!**

```powershell
# Start Kafka and keep it running
docker-compose up -d kafka

# To auto-start Kafka on system boot, add to docker-compose.yml:
# restart: unless-stopped
```

**Why?**
- Kafka is the **communication channel** between master and replicas
- Without Kafka, replicas operate in offline mode (queued operations)
- When Kafka restarts, sync resumes automatically, but it's better to keep it running

### What Replicas Experience

**When Kafka is down:**
```
Replica Logs:
⚠️ Kafka producer connection deferred: Connection timeout
⚠️ Operating in offline mode - operations will be queued
✅ Content created successfully (saved locally)
📦 Operation queued for sync (will sync when Kafka is back)
```

**When Kafka restarts:**
```
Replica Logs:
✅ Kafka producer connected (replica mode)
🔄 Connectivity restored - starting sync
📤 Syncing 5 queued operations...
✅ All operations synced successfully
```

---

## 🔧 Quick Setup Steps

### 1. Find Your IP Address
```powershell
ipconfig
# Look for IPv4 Address (e.g., 192.168.1.100)
# Use the IP address from your local network adapter (not 127.0.0.1)
```

### 2. Update docker-compose.yml

**IMPORTANT:** Your Kafka runs in Docker and needs to be accessible from outside your machine.

Change line 23 from:
```yaml
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
```

To (replace `192.168.1.100` with YOUR actual IP address):
```yaml
KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://192.168.29.12:9092
```

**Why?** This tells Kafka to advertise itself using your IP address so external clients (your friend's replica) can connect to it.

### 3. Open Windows Firewall
```powershell
# Run PowerShell as Administrator
New-NetFirewallRule -DisplayName "Kafka" -Direction Inbound -LocalPort 9092 -Protocol TCP -Action Allow
```

**Note:** This allows external connections to port 9092 where Kafka is listening.

### 4. Start/Restart Kafka in Docker
```powershell
# Stop Kafka if running
docker-compose down

# Start Kafka with new configuration
docker-compose up -d kafka

# Verify it's running
docker ps | findstr kafka
```

**Expected output:** You should see the `kafka` container running.

**⚠️ IMPORTANT:** Keep Kafka running! If you stop Kafka:
- Replicas cannot sync (they'll queue operations locally)
- When you restart Kafka, replicas will automatically reconnect and sync

**For auto-restart on system boot**, add to your `docker-compose.yml`:
```yaml
services:
  kafka:
    restart: unless-stopped
    # ... other config
```

### 5. Master .env Configuration

```env
# Offline Sync - Master Mode
SYNC_MODE=master
SYNC_SHIP_ID=master

# Kafka (local)
KAFKA_BROKERS=localhost:9092

# Database
DATABASE_CLIENT=postgres
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=ship-master
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=root
```

### 6. Start Master
```powershell
npm run develop
```

---

## ✅ Verification

### Check Kafka is Accessible
```powershell
netstat -an | findstr 9092
# Should show: 0.0.0.0:9092
```

### Check Master Logs
Look for:
- `✅ Kafka producer connected (master mode)`
- `✅ Kafka consumer connected (master mode)`
- `📡 Subscribed to topic: ship-updates`

### When Replica Connects
You should see:
- `💓 Heartbeat from ship-001 - online`
- `[ShipTracker] ✅ New ship registered: ship-001`

---

## 📋 Information to Share with Friend

**IMPORTANT:** Your friend does NOT need to install or run Kafka. They will connect to YOUR Kafka running in Docker.

Share these details with your friend:

1. **Your IP Address**: `192.168.1.100` (example - use your actual IP from `ipconfig`)
2. **Kafka Port**: `9092` (already exposed from Docker)
3. **Ship ID**: `ship-001` (or let them choose a unique one)

**Example message to send:**
```
Hi! Here's what you need to connect:

- Master IP: 192.168.1.100
- Kafka Port: 9092
- Your Ship ID: ship-001

You don't need to install Kafka - just connect to mine!
Use the REPLICA_SETUP_GUIDE.md I shared with you.
```

---

## 🔍 Troubleshooting

### Ships Not Appearing

**Possible Causes:**
1. **Kafka is not running** (most common)
   - Check: `docker ps | findstr kafka`
   - Solution: Start Kafka: `docker-compose up -d kafka`
   - Note: Replicas will automatically reconnect when Kafka starts

2. **Firewall blocking port 9092**
   - Check: `netstat -an | findstr 9092`
   - Solution: Open firewall (see Step 3)

3. **Wrong IP address in docker-compose.yml**
   - Check: `KAFKA_ADVERTISED_LISTENERS` uses your actual IP (not localhost)
   - Solution: Update docker-compose.yml with correct IP

**Solutions:**
- ✅ Check if Kafka is running: `docker ps | findstr kafka`
- ✅ Check firewall allows port 9092
- ✅ Verify `KAFKA_ADVERTISED_LISTENERS` has your IP (not localhost)
- ✅ Check master logs for connection errors
- ✅ **Keep Kafka running** - replicas need it to sync

### Kafka Connection Issues

**If you restart Kafka:**
- ✅ Replicas will automatically detect Kafka is back
- ✅ Replicas will automatically reconnect (no manual steps)
- ✅ All queued operations from replicas will sync automatically

**Commands:**
- Restart Kafka: `docker-compose restart kafka`
- Check logs: `docker logs kafka`
- Verify IP address hasn't changed: `ipconfig`

**Best Practice:** Keep Kafka running continuously. Use `docker-compose up -d kafka` and add `restart: unless-stopped` to docker-compose.yml for auto-restart.

---

## 📞 Quick Commands

```powershell
# Check Kafka status
docker ps | findstr kafka

# View Kafka logs
docker logs kafka

# Restart Kafka
docker-compose restart kafka

# Check if port is open
netstat -an | findstr 9092
```

---

**Share `REPLICA_SETUP_GUIDE.md` with your friend!**

