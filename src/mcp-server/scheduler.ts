import type Database from 'better-sqlite3';
import { MessageBus } from './bus.js';
import { generateMessageId } from './database.js';

export interface RecurringMessage {
  id: string;
  channel: string;
  sender_agent: string;
  sender_session: string;
  content_template: string;
  schedule_cron: string | null;
  schedule_interval_seconds: number | null;
  next_send_at: string;
  last_sent_at: string | null;
  enabled: number;
  created_at: string;
  expires_at: string | null;
  metadata: string;
}

export interface ScheduleConfig {
  type: 'cron' | 'interval' | 'one-time';
  value: string;
}

export class MessageScheduler {
  private db: Database.Database;
  private bus: MessageBus;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(db: Database.Database, bus: MessageBus) {
    this.db = db;
    this.bus = bus;
  }

  createRecurring(
    channel: string,
    agentId: string,
    sessionId: string,
    content: string,
    schedule: string,
    expiresAt?: string,
    metadata?: Record<string, unknown>
  ): RecurringMessage {
    const id = `rec_${generateMessageId().slice(4)}`;
    const scheduleConfig = this.parseSchedule(schedule);
    const nextSendAt = this.calculateNextSend(scheduleConfig, new Date());

    let scheduleCron: string | null = null;
    let scheduleIntervalSeconds: number | null = null;

    if (scheduleConfig.type === 'cron') {
      scheduleCron = scheduleConfig.value;
    } else if (scheduleConfig.type === 'interval') {
      scheduleIntervalSeconds = parseInt(scheduleConfig.value, 10);
    }

    const stmt = this.db.prepare(`
      INSERT INTO recurring_messages (
        id, channel, sender_agent, sender_session, content_template,
        schedule_cron, schedule_interval_seconds, next_send_at, expires_at, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      channel,
      agentId,
      sessionId,
      content,
      scheduleCron,
      scheduleIntervalSeconds,
      nextSendAt,
      expiresAt ?? null,
      JSON.stringify(metadata ?? {})
    );

    const result = this.getRecurringMessage(id);
    if (!result) throw new Error(`Failed to create recurring message: ${id}`);
    return result;
  }

  createScheduled(
    channel: string,
    agentId: string,
    sessionId: string,
    content: string,
    sendAt: string,
    metadata?: Record<string, unknown>
  ): RecurringMessage {
    const id = `rec_${generateMessageId().slice(4)}`;

    const stmt = this.db.prepare(`
      INSERT INTO recurring_messages (
        id, channel, sender_agent, sender_session, content_template,
        next_send_at, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      channel,
      agentId,
      sessionId,
      content,
      sendAt,
      JSON.stringify(metadata ?? {})
    );

    const result = this.getRecurringMessage(id);
    if (!result) throw new Error(`Failed to create scheduled message: ${id}`);
    return result;
  }

  listScheduled(agentId?: string, enabled?: boolean): RecurringMessage[] {
    let query = 'SELECT * FROM recurring_messages WHERE 1=1';
    const params: (string | number)[] = [];

    if (agentId !== undefined) {
      query += ' AND sender_agent = ?';
      params.push(agentId);
    }

    if (enabled !== undefined) {
      query += ' AND enabled = ?';
      params.push(enabled ? 1 : 0);
    }

    query += ' ORDER BY next_send_at ASC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as RecurringMessage[];
  }

  cancelScheduled(scheduleId: string, agentId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM recurring_messages
      WHERE id = ? AND sender_agent = ?
    `);
    const result = stmt.run(scheduleId, agentId);
    return result.changes > 0;
  }

  pauseScheduled(scheduleId: string, agentId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE recurring_messages
      SET enabled = 0
      WHERE id = ? AND sender_agent = ?
    `);
    const result = stmt.run(scheduleId, agentId);
    return result.changes > 0;
  }

  resumeScheduled(scheduleId: string, agentId: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE recurring_messages
      SET enabled = 1
      WHERE id = ? AND sender_agent = ?
    `);
    const result = stmt.run(scheduleId, agentId);
    return result.changes > 0;
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.intervalHandle = setInterval(() => {
      this.processScheduledMessages();
    }, 10000);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.isRunning = false;
  }

  private getRecurringMessage(id: string): RecurringMessage | null {
    const stmt = this.db.prepare('SELECT * FROM recurring_messages WHERE id = ?');
    return stmt.get(id) as RecurringMessage | null;
  }

  private parseSchedule(schedule: string): ScheduleConfig {
    if (schedule.startsWith('interval:')) {
      const seconds = schedule.slice(9);
      return { type: 'interval', value: seconds };
    }

    if (schedule.startsWith('at:')) {
      const timestamp = schedule.slice(3);
      return { type: 'one-time', value: timestamp };
    }

    return { type: 'cron', value: schedule };
  }

  private calculateNextSend(config: ScheduleConfig, from: Date): string {
    if (config.type === 'interval') {
      const seconds = parseInt(config.value, 10);
      const nextDate = new Date(from.getTime() + seconds * 1000);
      return this.toSQLiteDateTime(nextDate);
    }

    if (config.type === 'one-time') {
      return config.value;
    }

    if (config.type === 'cron') {
      const nextDate = this.parseCronNextDate(config.value, from);
      return this.toSQLiteDateTime(nextDate);
    }

    throw new Error(`Unknown schedule type: ${config.type}`);
  }

  private parseCronNextDate(cronExpr: string, from: Date): Date {
    const parts = cronExpr.split(' ');
    if (parts.length !== 5) {
      throw new Error(`Invalid cron expression: ${cronExpr}`);
    }

    const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;

    const current = new Date(from);
    current.setSeconds(0);
    current.setMilliseconds(0);

    const minuteInterval = this.parseCronField(minutePart);
    const hourInterval = this.parseCronField(hourPart);

    if (minuteInterval && !hourInterval) {
      const nextMinute = Math.ceil(current.getMinutes() / minuteInterval) * minuteInterval;
      if (nextMinute >= 60) {
        current.setHours(current.getHours() + 1);
        current.setMinutes(0);
      } else {
        current.setMinutes(nextMinute);
      }
      return current;
    }

    if (hourInterval && !minuteInterval) {
      const nextHour = Math.ceil(current.getHours() / hourInterval) * hourInterval;
      if (nextHour >= 24) {
        current.setDate(current.getDate() + 1);
        current.setHours(0);
      } else {
        current.setHours(nextHour);
      }
      current.setMinutes(0);
      return current;
    }

    if (minuteInterval && hourInterval) {
      current.setMinutes(Math.ceil(current.getMinutes() / minuteInterval) * minuteInterval);
      if (current.getMinutes() >= 60) {
        current.setHours(current.getHours() + 1);
        current.setMinutes(0);
      }
      return current;
    }

    const next = new Date(current);
    next.setMinutes(next.getMinutes() + 1);
    return next;
  }

  private parseCronField(field: string): number | null {
    if (field === '*') {
      return null;
    }

    if (field.startsWith('*/')) {
      return parseInt(field.slice(2), 10);
    }

    return null;
  }

  private toSQLiteDateTime(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 19);
  }

  private processScheduledMessages(): void {
    const stmt = this.db.prepare(`
      SELECT * FROM recurring_messages
      WHERE enabled = 1
        AND datetime(next_send_at) <= datetime('now')
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    `);

    const toSend = stmt.all() as RecurringMessage[];

    for (const recurring of toSend) {
      try {
        this.bus.sendMessage(
          recurring.channel,
          recurring.sender_agent,
          recurring.sender_session,
          recurring.content_template
        );

        const updateStmt = this.db.prepare(`
          UPDATE recurring_messages
          SET last_sent_at = datetime('now'), next_send_at = ?
          WHERE id = ?
        `);

        const scheduleConfig = this.getScheduleConfig(recurring);
        const nextSend = this.calculateNextSend(scheduleConfig, new Date());
        updateStmt.run(nextSend, recurring.id);
      } catch (error) {
        console.error(`Failed to send recurring message ${recurring.id}:`, error);
      }
    }
  }

  private getScheduleConfig(recurring: RecurringMessage): ScheduleConfig {
    if (recurring.schedule_interval_seconds !== null) {
      return { type: 'interval', value: recurring.schedule_interval_seconds.toString() };
    }

    if (recurring.schedule_cron !== null) {
      return { type: 'cron', value: recurring.schedule_cron };
    }

    return { type: 'one-time', value: recurring.next_send_at };
  }
}
