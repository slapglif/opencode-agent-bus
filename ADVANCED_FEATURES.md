# Advanced Agent Bus Features - Design Document

## Overview

This document details advanced messaging features for production-grade multi-agent coordination:

1. **Dead Letter Queue (DLQ)** - Undeliverable message handling
2. **Multi-Recipient Messaging** - Broadcast to specific agent groups
3. **Direct Messages (DM)** - Private agent-to-agent communication
4. **File Transfer Protocol** - Binary file exchange between agents
5. **Recurring Messages** - Scheduled/periodic message delivery
6. **Multi-Registry Support** - Connect to multiple registry servers
7. **Health Monitoring** - Real-time server health tracking
8. **Automatic Failover** - Seamless server switching
9. **End-to-End Encryption** - Secure message content

---

## 1. Dead Letter Queue (DLQ)

### Purpose
Capture and retry messages that fail delivery or processing.

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id TEXT PRIMARY KEY,
  original_message_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  sender_agent TEXT NOT NULL,
  sender_session TEXT NOT NULL,
  content TEXT NOT NULL,
  failure_reason TEXT NOT NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TEXT,
  failed_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (original_message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_dlq_retry ON dead_letter_queue(next_retry_at)
  WHERE resolved_at IS NULL;
```

### New Tools

**`bus_get_dead_letters`** - Query DLQ
```json
{
  "channel": "optional-filter",
  "limit": 50
}
```

**`bus_retry_dead_letter`** - Manually retry a failed message
```json
{
  "dlq_id": "dlq_abc123",
  "agent_id": "recovery-agent"
}
```

**`bus_resolve_dead_letter`** - Mark as resolved (no retry)
```json
{
  "dlq_id": "dlq_abc123",
  "resolution": "manual-fix-applied"
}
```

### Automatic Retry Logic

```typescript
setInterval(async () => {
  const toRetry = db.prepare(`
    SELECT * FROM dead_letter_queue
    WHERE resolved_at IS NULL
      AND retry_count < max_retries
      AND datetime(next_retry_at) <= datetime('now')
  `).all();

  for (const dlq of toRetry) {
    try {
      await retryMessage(dlq);
      markResolved(dlq.id);
    } catch (error) {
      incrementRetryCount(dlq.id);
    }
  }
}, 30000);
```

---

## 2. Multi-Recipient Messaging

### Purpose
Send a single message to multiple specific agents (not broadcast to entire channel).

### Message Type Extension

```typescript
interface Message {
  // ... existing fields
  recipients?: string[];  // Array of agent_ids
  recipient_mode: 'broadcast' | 'multi' | 'direct';
}
```

### Database Schema Update

```sql
CREATE TABLE IF NOT EXISTS message_recipients (
  message_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  delivered_at TEXT,
  read_at TEXT,
  PRIMARY KEY (message_id, agent_id),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_recipients_agent ON message_recipients(agent_id);
```

### New Tool

**`bus_send_multi`** - Send to multiple specific agents
```json
{
  "channel": "coordination",
  "agent_id": "orchestrator",
  "session_id": "session-123",
  "content": "Task assignment",
  "recipients": ["agent-1", "agent-2", "agent-3"]
}
```

### Delivery Tracking

**`bus_get_delivery_status`** - Check who received the message
```json
{
  "message_id": "msg_abc123"
}
```

Returns:
```json
{
  "recipients": [
    {"agent_id": "agent-1", "delivered_at": "2026-01-21T02:00:00Z", "read_at": null},
    {"agent_id": "agent-2", "delivered_at": "2026-01-21T02:00:05Z", "read_at": "2026-01-21T02:01:00Z"}
  ]
}
```

---

## 3. Direct Messages (DM)

### Purpose
Private 1:1 communication between agents.

### Implementation

DMs use a special channel naming convention: `dm:{agent1_id}:{agent2_id}` (alphabetically sorted).

### New Tool

**`bus_send_dm`** - Send direct message
```json
{
  "to_agent": "agent-2",
  "from_agent": "agent-1",
  "session_id": "session-123",
  "content": "Private coordination message"
}
```

Internally creates channel: `dm:agent-1:agent-2`

**`bus_list_dm_conversations`** - List all DM channels for an agent
```json
{
  "agent_id": "agent-1"
}
```

Returns active DM channels and unread counts.

---

## 4. File Transfer Protocol

### Purpose
Enable agents to share binary files (logs, generated code, datasets, images).

### Architecture

```
┌─────────────┐                    ┌──────────────┐
│  Agent A    │ ─── upload ──────> │ File Storage │
└─────────────┘                    │  (Local FS)  │
                                   └──────┬───────┘
                                          │
┌─────────────┐                          │
│  Agent B    │ <─── download ───────────┘
└─────────────┘
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS file_transfers (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploader_agent TEXT NOT NULL,
  uploader_session TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  access_mode TEXT DEFAULT 'private' CHECK(access_mode IN ('private', 'channel', 'public')),
  allowed_agents TEXT DEFAULT '[]',
  download_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_files_uploader ON file_transfers(uploader_agent);
CREATE INDEX IF NOT EXISTS idx_files_expires ON file_transfers(expires_at);
```

### Storage Location

Files stored at: `~/.config/opencode/agent-bus/files/<file_id>`

### New Tools

**`bus_upload_file`** - Upload a file for sharing
```json
{
  "agent_id": "agent-1",
  "session_id": "session-123",
  "filepath": "/path/to/file.txt",
  "access_mode": "channel",
  "allowed_agents": ["agent-2", "agent-3"],
  "ttl_seconds": 3600,
  "metadata": {"purpose": "test-results"}
}
```

Returns `file_id` and `checksum`.

**`bus_download_file`** - Download a shared file
```json
{
  "file_id": "file_abc123",
  "agent_id": "agent-2",
  "save_to": "/path/to/destination.txt"
}
```

**`bus_list_files`** - List available files
```json
{
  "agent_id": "agent-2",
  "channel": "optional-filter"
}
```

**`bus_delete_file`** - Remove a file
```json
{
  "file_id": "file_abc123",
  "agent_id": "uploader-agent"
}
```

### File Chunking (for large files)

Automatic chunking for files >10MB:
- Split into 5MB chunks
- Upload chunks separately
- Reassemble on download
- Resume failed transfers

### Security

- **Access Control**: Files are private by default
- **Virus Scanning**: Optional integration with ClamAV
- **Size Limits**: Default 100MB max per file, configurable
- **Quota**: Per-agent storage quota (default 1GB)
- **Checksum Verification**: SHA-256 validation on download

---

## 5. Recurring Messages

### Purpose
Schedule periodic or one-time future messages (cron-like for agents).

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS recurring_messages (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  sender_agent TEXT NOT NULL,
  sender_session TEXT NOT NULL,
  content_template TEXT NOT NULL,
  schedule_cron TEXT,
  schedule_interval_seconds INTEGER,
  next_send_at TEXT NOT NULL,
  last_sent_at TEXT,
  enabled BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_recurring_next ON recurring_messages(next_send_at)
  WHERE enabled = 1;
```

### New Tools

**`bus_create_recurring`** - Schedule a recurring message
```json
{
  "channel": "status",
  "agent_id": "monitor",
  "session_id": "session-123",
  "content": "Heartbeat ping",
  "schedule": "*/5 * * * *",
  "expires_at": "2026-12-31T23:59:59Z"
}
```

Schedule formats:
- **Cron**: `"*/5 * * * *"` (every 5 minutes)
- **Interval**: `"interval:60"` (every 60 seconds)
- **One-time**: `"at:2026-01-21T15:00:00Z"`

**`bus_list_recurring`** - List scheduled messages
**`bus_cancel_recurring`** - Cancel a recurring message
**`bus_pause_recurring`** - Temporarily pause
**`bus_resume_recurring`** - Resume paused message

### Scheduler

```typescript
setInterval(async () => {
  const toSend = db.prepare(`
    SELECT * FROM recurring_messages
    WHERE enabled = 1
      AND datetime(next_send_at) <= datetime('now')
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
  `).all();

  for (const recurring of toSend) {
    await bus.sendMessage(recurring.channel, recurring.sender_agent, 
      recurring.sender_session, recurring.content_template);
    updateNextSendTime(recurring);
  }
}, 10000);
```

---

## 6. Multi-Registry Support

### Purpose
Connect to multiple registry servers for redundancy and federation.

### Configuration Update

```json
{
  "registries": [
    {
      "id": "primary",
      "url": "https://registry-1.example.com/api/v1",
      "priority": 1,
      "enabled": true
    },
    {
      "id": "backup",
      "url": "https://registry-2.example.com/api/v1",
      "priority": 2,
      "enabled": true
    }
  ]
}
```

### Discovery Strategy

1. Query all enabled registries in parallel
2. Merge server lists (deduplicate by `id`)
3. Select best server across all registries
4. Fallback to next registry if primary fails

### New Tools

**`bus_add_registry`** - Add a new registry
**`bus_remove_registry`** - Remove a registry
**`bus_set_registry_priority`** - Change priority order

---

## 7. Health Monitoring

### Purpose
Real-time monitoring of bus server health and agent connectivity.

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS health_metrics (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now')),
  latency_ms INTEGER,
  status TEXT CHECK(status IN ('healthy', 'degraded', 'offline')),
  error_rate REAL,
  message_throughput INTEGER,
  active_agents INTEGER,
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_health_server ON health_metrics(server_id, timestamp);
```

### Monitoring Loop

```typescript
setInterval(async () => {
  for (const server of connectedServers) {
    const health = await checkServerHealth(server);
    recordHealthMetric(health);
    
    if (health.status === 'offline') {
      triggerFailover(server);
    }
  }
}, 15000);
```

### New Tools

**`bus_get_health_status`** - Current health of all servers
**`bus_get_health_history`** - Historical metrics
**`bus_set_health_threshold`** - Configure alerting thresholds

---

## 8. Automatic Failover

### Purpose
Seamlessly switch to backup servers when primary fails.

### Failover Logic

```typescript
async function triggerFailover(failedServer: BusServer) {
  const backup = await selectBackupServer(failedServer);
  
  if (!backup) {
    console.error('No backup servers available');
    activateLocalMode();
    return;
  }

  await migrateConnections(failedServer, backup);
  await resendUnacknowledgedMessages(failedServer, backup);
  
  configManager.setLastServer(backup);
  emit('server-switched', { from: failedServer.id, to: backup.id });
}
```

### Configuration

```json
{
  "failover": {
    "enabled": true,
    "max_retry_attempts": 3,
    "retry_delay_ms": 5000,
    "health_check_interval_ms": 15000,
    "unhealthy_threshold": 3
  }
}
```

### New Tools

**`bus_trigger_manual_failover`** - Force switch servers
**`bus_get_failover_history`** - View past failover events

---

## 9. End-to-End Encryption

### Purpose
Secure message content from sender to recipient.

### Architecture

- **Algorithm**: AES-256-GCM for message content, RSA-4096 for key exchange
- **Key Management**: Each agent has public/private key pair
- **Forward Secrecy**: Ephemeral keys for each message

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS agent_keys (
  agent_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  key_algorithm TEXT DEFAULT 'RSA-4096',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS encrypted_messages (
  message_id TEXT PRIMARY KEY,
  encrypted_content TEXT NOT NULL,
  encryption_metadata TEXT NOT NULL,
  recipient_keys TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
```

### Message Flow

```
1. Sender generates ephemeral AES key
2. Encrypts message content with AES
3. Encrypts AES key with recipient's public RSA key
4. Stores encrypted content + encrypted key
5. Recipient decrypts AES key with private RSA key
6. Decrypts message content with AES key
```

### New Tools

**`bus_generate_keypair`** - Generate agent's encryption keys
```json
{
  "agent_id": "agent-1",
  "algorithm": "RSA-4096"
}
```

**`bus_publish_public_key`** - Make public key discoverable
**`bus_get_public_key`** - Retrieve another agent's public key

**`bus_send_encrypted`** - Send encrypted message
```json
{
  "to_agent": "agent-2",
  "from_agent": "agent-1",
  "content": "sensitive data",
  "encrypt": true
}
```

### Security Notes

- Private keys stored in: `~/.config/opencode/agent-bus/keys/<agent_id>.pem`
- File permissions: `0600` (owner read/write only)
- Keys never transmitted, only public keys shared
- Optional passphrase protection for private keys

---

## Implementation Priority

### Phase 1 (Essential)
1. Dead Letter Queue
2. Direct Messages (DM)
3. Multi-Recipient Messaging

### Phase 2 (High Value)
4. File Transfer Protocol
5. Health Monitoring
6. Automatic Failover

### Phase 3 (Advanced)
7. Recurring Messages
8. Multi-Registry Support
9. End-to-End Encryption

---

## Testing Strategy

### Unit Tests
- Each feature has isolated unit tests
- Mock database and network calls
- Test failure scenarios

### Integration Tests
- Multi-agent coordination scenarios
- Failover simulation
- File transfer stress testing
- Encryption round-trip verification

### Load Tests
- 1000+ agents sending concurrent messages
- Large file transfers (100MB+)
- DLQ retry under high load
- Failover during peak traffic

---

## Backward Compatibility

All new features are **opt-in** and **backward compatible**:

- Existing deployments continue to work unchanged
- New fields in database are nullable or have defaults
- Old clients can communicate with new servers
- Graceful degradation when features unavailable
