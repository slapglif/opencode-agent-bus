import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

export interface Message {
  id: string;
  channel: string;
  sender_agent: string;
  sender_session: string;
  content: string;
  message_type: 'broadcast' | 'direct' | 'request' | 'response';
  correlation_id: string | null;
  priority: number;
  created_at: string;
  expires_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export interface Agent {
  agent_id: string;
  session_id: string;
  subscribed_channels: string;
  last_seen: string;
  metadata: string;
}

export interface Channel {
  name: string;
  description: string;
  created_at: string;
  message_ttl_seconds: number;
}

export function initializeDatabase(): Database.Database {
  const dataDir = join(homedir(), '.config', 'opencode', 'agent-bus');

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = join(dataDir, 'messages.db');
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  // Enable foreign key enforcement
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS channels (
      name TEXT PRIMARY KEY,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      message_ttl_seconds INTEGER DEFAULT 3600
    );

    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      subscribed_channels TEXT DEFAULT '[]',
      last_seen TEXT DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}',
      PRIMARY KEY (agent_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      sender_agent TEXT NOT NULL,
      sender_session TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'broadcast' CHECK(message_type IN ('broadcast', 'direct', 'request', 'response')),
      correlation_id TEXT,
      priority INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      FOREIGN KEY (channel) REFERENCES channels(name)
    );

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

    CREATE TABLE IF NOT EXISTS message_recipients (
      message_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      PRIMARY KEY (message_id, agent_id),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

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

    CREATE TABLE IF NOT EXISTS orch_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      input_data TEXT,
      context TEXT,
      tags TEXT,
      priority INTEGER DEFAULT 0,
      timeout_seconds INTEGER DEFAULT 3600,
      max_retries INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      deadline_at TEXT,
      status TEXT DEFAULT 'created'
    );

    CREATE TABLE IF NOT EXISTS orch_assignments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      assigned_at TEXT DEFAULT (datetime('now')),
      accepted_at TEXT,
      started_at TEXT,
      submitted_at TEXT,
      approved_at TEXT,
      status TEXT DEFAULT 'assigned',
      blocking INTEGER DEFAULT 1,
      FOREIGN KEY (task_id) REFERENCES orch_tasks(id)
    );

    CREATE TABLE IF NOT EXISTS orch_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      dependency_type TEXT DEFAULT 'required',
      trigger_rule TEXT DEFAULT 'all_success',
      PRIMARY KEY (task_id, depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS orch_results (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      result_data TEXT,
      artifacts TEXT,
      execution_metrics TEXT,
      submitted_at TEXT DEFAULT (datetime('now')),
      approved INTEGER DEFAULT 0,
      approval_notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_correlation ON messages(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_agent, sender_session);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);
    CREATE INDEX IF NOT EXISTS idx_dlq_retry ON dead_letter_queue(next_retry_at) WHERE resolved_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_recipients_agent ON message_recipients(agent_id);
    CREATE INDEX IF NOT EXISTS idx_files_uploader ON file_transfers(uploader_agent);
    CREATE INDEX IF NOT EXISTS idx_files_expires ON file_transfers(expires_at);
    CREATE INDEX IF NOT EXISTS idx_recurring_next ON recurring_messages(next_send_at) WHERE enabled = 1;
    CREATE INDEX IF NOT EXISTS idx_health_server ON health_metrics(server_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_orch_tasks_status ON orch_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_orch_assignments_agent ON orch_assignments(agent_id, status);

    -- Create default channels
    INSERT OR IGNORE INTO channels (name, description) VALUES
      ('global', 'Global broadcast channel for all agents'),
      ('coordination', 'Agent coordination and task assignment'),
      ('status', 'Agent status updates and heartbeats'),
      ('errors', 'Error reporting and alerts');
  `);

  return db;
}

export function generateMessageId(): string {
  return `msg_${randomUUID()}`;
}
