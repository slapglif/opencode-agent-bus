import type Database from 'better-sqlite3';
import { generateMessageId, type Message, type Agent, type Channel } from './database.js';

export class MessageBus {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // Channel operations
  createChannel(name: string, description: string = '', ttlSeconds: number = 3600): Channel {
    const stmt = this.db.prepare(`
      INSERT INTO channels (name, description, message_ttl_seconds)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET description = ?, message_ttl_seconds = ?
    `);
    stmt.run(name, description, ttlSeconds, description, ttlSeconds);
    return this.getChannel(name)!;
  }

  getChannel(name: string): Channel | null {
    const stmt = this.db.prepare('SELECT * FROM channels WHERE name = ?');
    return stmt.get(name) as Channel | null;
  }

  listChannels(): Channel[] {
    const stmt = this.db.prepare('SELECT * FROM channels ORDER BY name');
    return stmt.all() as Channel[];
  }

  // Agent operations
  registerAgent(agentId: string, sessionId: string, metadata: Record<string, unknown> = {}): Agent {
    const stmt = this.db.prepare(`
      INSERT INTO agents (agent_id, session_id, metadata, last_seen)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(agent_id, session_id) DO UPDATE SET
        last_seen = datetime('now'),
        metadata = ?
    `);
    const metaJson = JSON.stringify(metadata);
    stmt.run(agentId, sessionId, metaJson, metaJson);
    return this.getAgent(agentId, sessionId)!;
  }

  getAgent(agentId: string, sessionId: string): Agent | null {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE agent_id = ? AND session_id = ?');
    return stmt.get(agentId, sessionId) as Agent | null;
  }

  listAgents(activeWithinSeconds: number = 300): Agent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM agents
      WHERE datetime(last_seen) > datetime('now', '-' || ? || ' seconds')
      ORDER BY last_seen DESC
    `);
    return stmt.all(activeWithinSeconds) as Agent[];
  }

  subscribeToChannel(agentId: string, sessionId: string, channel: string): void {
    const agent = this.getAgent(agentId, sessionId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not registered`);
    }

    const channels = JSON.parse(agent.subscribed_channels) as string[];
    if (!channels.includes(channel)) {
      channels.push(channel);
      const stmt = this.db.prepare('UPDATE agents SET subscribed_channels = ? WHERE agent_id = ? AND session_id = ?');
      stmt.run(JSON.stringify(channels), agentId, sessionId);
    }
  }

  unsubscribeFromChannel(agentId: string, sessionId: string, channel: string): void {
    const agent = this.getAgent(agentId, sessionId);
    if (!agent) return;

    const channels = JSON.parse(agent.subscribed_channels) as string[];
    const filtered = channels.filter(c => c !== channel);
    const stmt = this.db.prepare('UPDATE agents SET subscribed_channels = ? WHERE agent_id = ? AND session_id = ?');
    stmt.run(JSON.stringify(filtered), agentId, sessionId);
  }

  // Message operations
  sendMessage(
    channel: string,
    senderAgent: string,
    senderSession: string,
    content: string,
    options: {
      messageType?: 'broadcast' | 'direct' | 'request' | 'response';
      correlationId?: string;
      priority?: number;
      ttlSeconds?: number;
    } = {}
  ): Message {
    const id = generateMessageId();
    const channelInfo = this.getChannel(channel);

    if (!channelInfo) {
      // Auto-create channel if it doesn't exist
      this.createChannel(channel);
    }

    const ttl = options.ttlSeconds ?? channelInfo?.message_ttl_seconds ?? 3600;
    const expiresAt = ttl > 0 ? `datetime('now', '+${ttl} seconds')` : null;

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, channel, sender_agent, sender_session, content, message_type, correlation_id, priority, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${expiresAt ? expiresAt : 'NULL'})
    `);

    stmt.run(
      id,
      channel,
      senderAgent,
      senderSession,
      content,
      options.messageType ?? 'broadcast',
      options.correlationId ?? null,
      options.priority ?? 0
    );

    return this.getMessage(id)!;
  }

  getMessage(id: string): Message | null {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    return stmt.get(id) as Message | null;
  }

  getMessages(
    channel: string,
    options: {
      limit?: number;
      since?: string;
      unacknowledgedOnly?: boolean;
      excludeSender?: string;
    } = {}
  ): Message[] {
    let query = 'SELECT * FROM messages WHERE channel = ?';
    const params: (string | number)[] = [channel];

    if (options.since) {
      query += ' AND datetime(created_at) > datetime(?)';
      params.push(options.since);
    }

    if (options.unacknowledgedOnly) {
      query += ' AND acknowledged_at IS NULL';
    }

    if (options.excludeSender) {
      query += ' AND sender_agent != ?';
      params.push(options.excludeSender);
    }

    // Exclude expired messages
    query += ' AND (expires_at IS NULL OR datetime(expires_at) > datetime("now"))';

    query += ' ORDER BY priority DESC, created_at ASC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Message[];
  }

  acknowledgeMessage(messageId: string, acknowledgedBy: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE messages
      SET acknowledged_at = datetime('now'), acknowledged_by = ?
      WHERE id = ? AND acknowledged_at IS NULL
    `);
    const result = stmt.run(acknowledgedBy, messageId);
    return result.changes > 0;
  }

  // Request-response pattern
  sendRequest(
    channel: string,
    senderAgent: string,
    senderSession: string,
    content: string,
    ttlSeconds: number = 60
  ): Message {
    const correlationId = generateMessageId();
    return this.sendMessage(channel, senderAgent, senderSession, content, {
      messageType: 'request',
      correlationId,
      ttlSeconds
    });
  }

  sendResponse(
    correlationId: string,
    senderAgent: string,
    senderSession: string,
    content: string
  ): Message {
    // Find the original request to get the channel
    const stmt = this.db.prepare('SELECT channel FROM messages WHERE correlation_id = ? OR id = ?');
    const original = stmt.get(correlationId, correlationId) as { channel: string } | undefined;

    if (!original) {
      throw new Error(`No request found with correlation ID: ${correlationId}`);
    }

    return this.sendMessage(original.channel, senderAgent, senderSession, content, {
      messageType: 'response',
      correlationId
    });
  }

  getResponses(correlationId: string): Message[] {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE correlation_id = ? AND message_type = 'response'
      ORDER BY created_at ASC
    `);
    return stmt.all(correlationId) as Message[];
  }

  // Cleanup
  cleanupExpiredMessages(): number {
    const stmt = this.db.prepare(`
      DELETE FROM messages
      WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')
    `);
    const result = stmt.run();
    return result.changes;
  }

  cleanupInactiveAgents(inactiveSeconds: number = 3600): number {
    const stmt = this.db.prepare(`
      DELETE FROM agents
      WHERE datetime(last_seen) < datetime('now', '-' || ? || ' seconds')
    `);
    const result = stmt.run(inactiveSeconds);
    return result.changes;
  }
}
