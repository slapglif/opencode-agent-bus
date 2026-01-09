import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

// We'll test the database and bus logic directly
// since testing MCP server requires more infrastructure

describe('Message Bus', () => {
  let tempDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-bus-test-'));
    db = new Database(join(tempDir, 'test.db'));

    // Initialize schema
    db.exec(`
      CREATE TABLE channels (
        name TEXT PRIMARY KEY,
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        message_ttl_seconds INTEGER DEFAULT 3600
      );

      CREATE TABLE agents (
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        subscribed_channels TEXT DEFAULT '[]',
        last_seen TEXT DEFAULT (datetime('now')),
        metadata TEXT DEFAULT '{}',
        PRIMARY KEY (agent_id, session_id)
      );

      CREATE TABLE messages (
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
        acknowledged_by TEXT
      );

      INSERT INTO channels (name, description) VALUES ('global', 'Test channel');
    `);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('should create channel', () => {
    const stmt = db.prepare('INSERT INTO channels (name, description) VALUES (?, ?)');
    stmt.run('test-channel', 'A test channel');

    const channel = db.prepare('SELECT * FROM channels WHERE name = ?').get('test-channel') as { name: string; description: string };
    assert.equal(channel.name, 'test-channel');
    assert.equal(channel.description, 'A test channel');
  });

  test('should register agent', () => {
    const stmt = db.prepare('INSERT INTO agents (agent_id, session_id, metadata) VALUES (?, ?, ?)');
    stmt.run('agent-1', 'session-1', '{"role": "worker"}');

    const agent = db.prepare('SELECT * FROM agents WHERE agent_id = ?').get('agent-1') as { agent_id: string; session_id: string };
    assert.equal(agent.agent_id, 'agent-1');
    assert.equal(agent.session_id, 'session-1');
  });

  test('should send and receive message', () => {
    // Send
    const sendStmt = db.prepare(`
      INSERT INTO messages (id, channel, sender_agent, sender_session, content)
      VALUES (?, ?, ?, ?, ?)
    `);
    sendStmt.run('msg-1', 'global', 'agent-1', 'session-1', 'Hello world');

    // Receive
    const messages = db.prepare('SELECT * FROM messages WHERE channel = ?').all('global') as { content: string }[];
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'Hello world');
  });

  test('should acknowledge message', () => {
    // Create message
    db.prepare(`
      INSERT INTO messages (id, channel, sender_agent, sender_session, content)
      VALUES (?, ?, ?, ?, ?)
    `).run('msg-2', 'global', 'agent-1', 'session-1', 'Test');

    // Acknowledge
    db.prepare(`
      UPDATE messages SET acknowledged_at = datetime('now'), acknowledged_by = ?
      WHERE id = ?
    `).run('agent-2', 'msg-2');

    // Verify
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get('msg-2') as { acknowledged_at: string | null; acknowledged_by: string };
    assert.ok(msg.acknowledged_at);
    assert.equal(msg.acknowledged_by, 'agent-2');
  });

  test('should filter unacknowledged messages', () => {
    // Create two messages
    db.prepare(`INSERT INTO messages (id, channel, sender_agent, sender_session, content) VALUES (?, ?, ?, ?, ?)`).run('msg-3', 'global', 'a', 's', 'Unacked');
    db.prepare(`INSERT INTO messages (id, channel, sender_agent, sender_session, content, acknowledged_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run('msg-4', 'global', 'a', 's', 'Acked');

    // Query unacknowledged
    const unacked = db.prepare('SELECT * FROM messages WHERE channel = ? AND acknowledged_at IS NULL').all('global') as { id: string }[];
    assert.equal(unacked.length, 1);
    assert.equal(unacked[0].id, 'msg-3');
  });
});
