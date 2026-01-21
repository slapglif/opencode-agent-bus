import type Database from 'better-sqlite3';
import type { Agent } from './database.js';

export interface UnackedSummary {
  count: number;
  channels: string[];
  oldest_message_age_seconds: number | null;
  summary: string;
}

/**
 * Check for unacknowledged messages for a specific agent across their subscribed channels.
 * 
 * @param agentId - The agent ID to check for unacknowledged messages
 * @param sessionId - The session ID of the agent
 * @param db - SQLite database instance
 * @returns UnackedSummary if there are unacknowledged messages, null otherwise
 */
export function checkUnackedMessages(
  agentId: string,
  sessionId: string,
  db: Database.Database
): UnackedSummary | null {
  const agentStmt = db.prepare('SELECT * FROM agents WHERE agent_id = ? AND session_id = ?');
  const agent = agentStmt.get(agentId, sessionId) as Agent | null;

  if (!agent) {
    return null;
  }

  let subscribedChannels: string[];
  try {
    subscribedChannels = JSON.parse(agent.subscribed_channels) as string[];
  } catch {
    subscribedChannels = [];
  }

  if (subscribedChannels.length === 0) {
    return null;
  }

  const placeholders = subscribedChannels.map(() => '?').join(',');
  const query = `
    SELECT 
      COUNT(*) as count,
      GROUP_CONCAT(DISTINCT channel) as channels,
      MIN(created_at) as oldest_created
    FROM messages 
    WHERE channel IN (${placeholders})
      AND acknowledged_at IS NULL
      AND sender_agent != ?
      AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
  `;

  const stmt = db.prepare(query);
  const params = [...subscribedChannels, agentId];
  const result = stmt.get(...params) as {
    count: number;
    channels: string | null;
    oldest_created: string | null;
  };

  if (!result || result.count === 0) {
    return null;
  }

  let oldestAgeSeconds: number | null = null;
  if (result.oldest_created) {
    const oldestDate = new Date(result.oldest_created.replace(' ', 'T') + 'Z');
    const nowDate = new Date();
    oldestAgeSeconds = Math.floor((nowDate.getTime() - oldestDate.getTime()) / 1000);
  }

  const channels = result.channels ? result.channels.split(',') : [];
  const summary = formatUnackedSummary(result.count, channels, oldestAgeSeconds);

  return {
    count: result.count,
    channels,
    oldest_message_age_seconds: oldestAgeSeconds,
    summary
  };
}

function formatUnackedSummary(
  count: number,
  channels: string[],
  ageSeconds: number | null
): string {
  const channelList = channels.length === 1
    ? `${channels[0]} channel`
    : `${channels.length} channels (${channels.join(', ')})`;

  let ageSummary = '';
  if (ageSeconds !== null) {
    ageSummary = ` (oldest: ${formatAge(ageSeconds)} ago)`;
  }

  return `You have ${count} unacknowledged message${count === 1 ? '' : 's'} in ${channelList}${ageSummary}`;
}

function formatAge(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  } else if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours}h`;
  } else {
    const days = Math.floor(seconds / 86400);
    return `${days}d`;
  }
}
