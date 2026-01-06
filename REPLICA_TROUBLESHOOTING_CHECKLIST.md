# 🔍 Replica Offline - Troubleshooting Checklist

**Problem:** Replica showing as "offline" on master dashboard

**Share this checklist with your friend to diagnose the issue!**

---

## ✅ Step 1: Verify Replica is Running

**On friend's system (replica):**

1. **Check if Strapi is running:**
   ```bash
   # Should see Strapi process running
   # Check terminal where Strapi was started
   ```

2. **Check Strapi logs for errors:**
   - Look for: `✅ Kafka producer connected (replica mode)`
   - Look for: `✅ Kafka consumer connected (replica mode)`
   - Look for: `💓 Heartbeat sent`

3. **Check replica status:**
   ```bash
   curl http://localhost:1337/api/offline-sync/status
   ```
   
   **Expected:**
   ```json
   {
     "mode": "replica",
     "shipId": "ship-001",
     "connected": true,
     "kafka": {
       "producer": true,
       "consumer": true
     }
   }
   ```

---

## ✅ Step 2: Verify .env Configuration

**On friend's system (replica):**

1. **Check `.env` file has correct settings:**
   ```env
   SYNC_MODE=replica
   SYNC_SHIP_ID=ship-001
   KAFKA_BROKERS=0.tcp.in.ngrok.io:16197
   ```

2. **Verify ngrok URL is EXACT:**
   - Must match EXACTLY what master provided
   - Check for typos
   - Check if ngrok URL changed (master needs to restart ngrok and share new URL)

3. **After changing .env, restart Strapi:**
   ```bash
   # Stop Strapi (Ctrl+C)
   # Start again:
   npm run develop
   ```

---

## ✅ Step 3: Test Network Connectivity

**On friend's system (replica):**

1. **Test connection to ngrok:**
   ```powershell
   # Windows:
   Test-NetConnection -ComputerName 0.tcp.in.ngrok.io -Port 16197
   
   # Linux/Mac:
   nc -zv 0.tcp.in.ngrok.io 16197
   ```

2. **Expected result:**
   - ✅ `TcpTestSucceeded : True` (Windows)
   - ✅ Connection successful (Linux/Mac)

3. **If connection fails:**
   - Check internet connection
   - Check firewall settings
   - Verify ngrok URL is correct
   - Ask master to verify ngrok is still running

---

## ✅ Step 4: Check Kafka Connection Logs

**On friend's system (replica):**

**Look for these messages in Strapi logs:**

✅ **Good signs:**
```
✅ Kafka producer connected (replica mode)
✅ Kafka consumer connected (replica mode)
📡 Subscribed to topic: master-updates
💓 Heartbeat sent
```

❌ **Bad signs:**
```
❌ Failed to connect Kafka producer: Connection timeout
❌ Kafka producer connection deferred: Connection timeout
⚠️ Operating in offline mode - operations will be queued
```

**If you see errors:**
- Kafka connection is failing
- Replica is in offline mode
- Heartbeats are not being sent
- Master cannot see replica

---

## ✅ Step 5: Verify Master Side

**On YOUR system (master):**

1. **Check ngrok is running:**
   - Is ngrok terminal still open?
   - Is ngrok showing `Session Status: online`?
   - Is forwarding URL still `0.tcp.in.ngrok.io:16197`?

2. **Check Kafka is running:**
   ```powershell
   docker ps | findstr kafka
   ```
   - Should show Kafka container running

3. **Check master logs for heartbeats:**
   - Look for: `💓 Heartbeat from ship-001 - online`
   - Look for: `[ShipTracker] ✅ New ship registered: ship-001`

4. **If no heartbeats received:**
   - Replica is not connecting to Kafka
   - Replica is not sending heartbeats
   - Network issue between replica and ngrok

---

## ✅ Step 6: Common Issues & Solutions

### Issue 1: Wrong ngrok URL in .env

**Symptom:** Connection timeout errors

**Solution:**
1. Ask master for current ngrok URL
2. Update `.env`: `KAFKA_BROKERS=<EXACT_NGROK_URL>`
3. Restart Strapi

---

### Issue 2: ngrok URL Changed

**Symptom:** Was working, now stopped

**Solution:**
1. Master restarted ngrok → URL changed
2. Ask master for new ngrok URL
3. Update `.env` with new URL
4. Master must update `docker-compose.yml` and restart Kafka
5. Restart Strapi

---

### Issue 3: Replica Not Sending Heartbeats

**Symptom:** Replica shows `connected: true` but master shows offline

**Check:**
1. Verify `SYNC_MODE=replica` in `.env`
2. Verify `SYNC_SHIP_ID` is set
3. Check logs for `💓 Heartbeat sent` messages
4. If no heartbeats, restart Strapi

---

### Issue 4: Network/Firewall Blocking

**Symptom:** Connection test fails

**Solution:**
1. Check internet connection
2. Check firewall allows outbound connections
3. Try from different network (mobile hotspot)
4. Verify ngrok URL is accessible

---

### Issue 5: Strapi Not Started in Replica Mode

**Symptom:** No Kafka connection messages

**Solution:**
1. Verify `.env` has `SYNC_MODE=replica`
2. Restart Strapi completely
3. Check logs for startup messages

---

## 📋 Quick Diagnostic Commands

**On friend's system (replica):**

```bash
# 1. Check status
curl http://localhost:1337/api/offline-sync/status

# 2. Test network
Test-NetConnection -ComputerName 0.tcp.in.ngrok.io -Port 16197

# 3. Check .env (verify these lines exist)
# SYNC_MODE=replica
# SYNC_SHIP_ID=ship-001
# KAFKA_BROKERS=0.tcp.in.ngrok.io:16197
```

**On YOUR system (master):**

```powershell
# 1. Check Kafka
docker ps | findstr kafka

# 2. Check ngrok (look at ngrok terminal)
# Should show: Session Status: online

# 3. Check master logs for heartbeats
# Look for: 💓 Heartbeat from ship-001
```

---

## 🎯 Expected Flow When Working

1. **Replica starts** → Connects to Kafka via ngrok
2. **Replica sends heartbeat** → Every 30 seconds
3. **Master receives heartbeat** → Registers/updates ship
4. **Master dashboard shows** → "1 ship online"

**If any step fails, replica shows as offline!**

---

## 📞 What to Share with Master

If troubleshooting doesn't work, share this info with master:

1. **Replica status output:**
   ```bash
   curl http://localhost:1337/api/offline-sync/status
   ```

2. **Network test result:**
   ```powershell
   Test-NetConnection -ComputerName 0.tcp.in.ngrok.io -Port 16197
   ```

3. **Strapi logs** (last 20-30 lines showing Kafka connection attempts)

4. **.env configuration** (hide passwords, just show Kafka settings):
   ```env
   SYNC_MODE=replica
   SYNC_SHIP_ID=ship-001
   KAFKA_BROKERS=0.tcp.in.ngrok.io:16197
   ```

---

**Most Common Issue:** Wrong ngrok URL or ngrok URL changed after restart!

