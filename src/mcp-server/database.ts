import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, existsSync } from 'fs';

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
      message_type TEXT DEFAULT 'broadcast',
      correlation_id TEXT,
      priority INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      FOREIGN KEY (channel) REFERENCES channels(name)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_correlation ON messages(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_agents_session ON agents(session_id);

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
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
