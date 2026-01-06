# 📚 Offline Sync Plugin Documentation

Welcome to the Offline Sync Plugin documentation! This directory contains all documentation related to the plugin.

---

## 📖 Documentation Index

### 🚀 Getting Started

- **[REPLICA_SETUP_GUIDE.md](./REPLICA_SETUP_GUIDE.md)** - Complete guide for setting up a Replica (Ship) system
- **[MASTER_SETUP_SUMMARY.md](./MASTER_SETUP_SUMMARY.md)** - Quick reference for Master setup

### 🧪 Testing

- **[TEST_SCENARIOS.md](./TEST_SCENARIOS.md)** - Comprehensive test scenarios and test cases covering:
  - Basic connectivity tests
  - Offline scenario tests
  - Online sync tests
  - Conflict resolution tests
  - Data integrity tests
  - Edge case tests
  - Performance tests
  - Error handling tests
  - Bi-directional sync tests
  - Reconnection tests

### 🌊 Understanding Offline Sync

- **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)** - Detailed explanation of how offline sync works, including:
  - Offline-first architecture
  - Sync queue mechanism
  - Connectivity monitoring
  - Conflict detection & resolution
  - Real-world examples

### 🏗️ Technical Design

- **[HIGH_LEVEL_DESIGN.md](./HIGH_LEVEL_DESIGN.md)** - High-level architecture and design decisions
- **[LOW_LEVEL_DESIGN.md](./LOW_LEVEL_DESIGN.md)** - Detailed technical implementation

---

## 🎯 Quick Navigation

### For Replica Administrators
1. Start with **[REPLICA_SETUP_GUIDE.md](./REPLICA_SETUP_GUIDE.md)**
2. Understand offline capabilities: **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)**
3. Test your setup: **[TEST_SCENARIOS.md](./TEST_SCENARIOS.md)**

### For Master Administrators
1. Quick setup: **[MASTER_SETUP_SUMMARY.md](./MASTER_SETUP_SUMMARY.md)**
2. Share **[REPLICA_SETUP_GUIDE.md](./REPLICA_SETUP_GUIDE.md)** with replica administrators
3. Understand conflict resolution: **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)** (Conflict section)
4. Test system: **[TEST_SCENARIOS.md](./TEST_SCENARIOS.md)**

### For Developers
1. Architecture overview: **[HIGH_LEVEL_DESIGN.md](./HIGH_LEVEL_DESIGN.md)**
2. Implementation details: **[LOW_LEVEL_DESIGN.md](./LOW_LEVEL_DESIGN.md)**
3. How it works: **[OFFLINE_SYNC_EXPLAINED.md](./OFFLINE_SYNC_EXPLAINED.md)**
4. Test scenarios: **[TEST_SCENARIOS.md](./TEST_SCENARIOS.md)**

---

## 📋 Document Descriptions

### REPLICA_SETUP_GUIDE.md
**Purpose:** Step-by-step guide for setting up a replica system  
**Audience:** Replica administrators, ship operators  
**Contents:**
- Prerequisites
- Installation steps
- Configuration
- Network setup
- Troubleshooting
- Monitoring

### MASTER_SETUP_SUMMARY.md
**Purpose:** Quick reference for master setup  
**Audience:** Master administrators  
**Contents:**
- Quick setup steps
- Kafka configuration
- Firewall setup
- Information to share with replicas

### OFFLINE_SYNC_EXPLAINED.md
**Purpose:** Comprehensive explanation of offline sync functionality  
**Audience:** All users (administrators, developers)  
**Contents:**
- How offline sync works
- Sync queue mechanism
- Connectivity monitoring
- Conflict detection & resolution
- Real-world examples
- Best practices

### HIGH_LEVEL_DESIGN.md
**Purpose:** Architecture and design decisions  
**Audience:** Developers, architects  
**Contents:**
- System architecture
- Design patterns
- Component interactions
- Data flow

### LOW_LEVEL_DESIGN.md
**Purpose:** Detailed technical implementation  
**Audience:** Developers  
**Contents:**
- Service implementations
- Database schemas
- API specifications
- Code structure

### TEST_SCENARIOS.md
**Purpose:** Comprehensive test scenarios and test cases  
**Audience:** Testers, QA, Administrators, Developers  
**Contents:**
- Basic connectivity tests
- Offline scenario tests (internet disconnection, extended offline)
- Online sync tests (create, update, delete)
- Conflict resolution tests
- Data integrity tests
- Edge case tests (large content, special characters, rapid operations)
- Performance tests
- Error handling tests
- Bi-directional sync tests
- Reconnection tests
- Test checklist and results template

---

## 🔗 Related Documentation

- **[Plugin README](../README.md)** - Main plugin documentation
- **[Database README](../database/README.md)** - Database setup and migrations

---

## 📞 Need Help?

- Check the troubleshooting sections in the setup guides
- Review the conflict resolution section in OFFLINE_SYNC_EXPLAINED.md
- Consult the technical design documents for implementation details

---

**Last Updated:** 2024

