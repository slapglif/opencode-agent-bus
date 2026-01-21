import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ConfigManager } from './config.js';
import type { BusServer } from './registry-client.js';

export interface HealthMetric {
  id: string;
  server_id: string;
  timestamp: string;
  latency_ms: number;
  status: 'healthy' | 'degraded' | 'offline';
  error_rate: number;
  message_throughput: number;
  active_agents: number;
  metadata: string;
}

export type HealthStatus = 'healthy' | 'degraded' | 'offline';

export class HealthMonitor {
  private db: Database.Database;
  private configManager: ConfigManager;
  private connectedServers: Map<string, BusServer>;
  private monitoringInterval: NodeJS.Timeout | null;
  private readonly CHECK_INTERVAL_MS = 15000;
  private readonly UNHEALTHY_THRESHOLD = 3;
  private failureCount: Map<string, number>;

  constructor(db: Database.Database, configManager: ConfigManager) {
    this.db = db;
    this.configManager = configManager;
    this.connectedServers = new Map();
    this.monitoringInterval = null;
    this.failureCount = new Map();
    this.initializeSchema();
  }

  private initializeSchema(): void {
    this.db.exec(`
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
    `);
  }

  async checkServerHealth(serverId: string): Promise<HealthStatus> {
    const server = this.connectedServers.get(serverId);
    if (!server) {
      return 'offline';
    }

    const startTime = Date.now();
    
    try {
      const response = await fetch(`${server.url}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        this.incrementFailureCount(serverId);
        return this.determineStatus(latency, false);
      }

      this.resetFailureCount(serverId);
      return this.determineStatus(latency, true);
    } catch (error) {
      this.incrementFailureCount(serverId);
      console.error(`Health check failed for ${serverId}:`, error);
      return 'offline';
    }
  }

  private determineStatus(latency: number, isResponsive: boolean): HealthStatus {
    if (!isResponsive) {
      return 'offline';
    }
    if (latency > 1000) {
      return 'degraded';
    }
    return 'healthy';
  }

  private incrementFailureCount(serverId: string): void {
    const current = this.failureCount.get(serverId) || 0;
    this.failureCount.set(serverId, current + 1);
  }

  private resetFailureCount(serverId: string): void {
    this.failureCount.set(serverId, 0);
  }

  private getFailureCount(serverId: string): number {
    return this.failureCount.get(serverId) || 0;
  }

  recordMetric(
    serverId: string,
    latency: number,
    status: HealthStatus,
    errorRate: number,
    throughput: number,
    activeAgents: number
  ): void {
    const id = `health_${randomUUID()}`;
    const timestamp = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO health_metrics (
        id, server_id, timestamp, latency_ms, status,
        error_rate, message_throughput, active_agents, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      serverId,
      timestamp,
      latency,
      status,
      errorRate,
      throughput,
      activeAgents,
      JSON.stringify({})
    );
  }

  getHealthStatus(serverId?: string): HealthMetric[] {
    let query = `
      SELECT * FROM health_metrics
      WHERE timestamp >= datetime('now', '-1 hour')
    `;
    const params: string[] = [];

    if (serverId) {
      query += ` AND server_id = ?`;
      params.push(serverId);
    }

    query += ` ORDER BY timestamp DESC LIMIT 100`;

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as HealthMetric[];
  }

  getHealthHistory(serverId: string, limit: number = 100): HealthMetric[] {
    const stmt = this.db.prepare(`
      SELECT * FROM health_metrics
      WHERE server_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    return stmt.all(serverId, limit) as HealthMetric[];
  }

  async triggerFailover(failedServerId: string): Promise<boolean> {
    console.error(`Triggering failover from server: ${failedServerId}`);

    const availableServers = Array.from(this.connectedServers.values()).filter(
      s => s.id !== failedServerId && s.status === 'healthy'
    );

    if (availableServers.length === 0) {
      console.error('No backup servers available for failover');
      this.activateLocalMode();
      return false;
    }

    const backupServer = this.selectBackupServer(availableServers);
    if (!backupServer) {
      console.error('No suitable backup server found');
      this.activateLocalMode();
      return false;
    }

    try {
      this.configManager.setLastServer({
        id: backupServer.id,
        url: backupServer.url
      });

      console.error(`Failover successful: ${failedServerId} → ${backupServer.id}`);
      this.connectedServers.delete(failedServerId);
      
      return true;
    } catch (error) {
      console.error('Failover failed:', error);
      return false;
    }
  }

  private selectBackupServer(servers: BusServer[]): BusServer | null {
    if (servers.length === 0) return null;

    const sorted = servers.sort((a, b) => {
      const aCapacity = (a.capacity.max - a.capacity.current) / a.capacity.max;
      const bCapacity = (b.capacity.max - b.capacity.current) / b.capacity.max;
      
      const LATENCY_WEIGHT = 0.7;
      const CAPACITY_WEIGHT = 0.3;
      const aScore = (a.latency_ms * LATENCY_WEIGHT) + ((1 - aCapacity) * 1000 * CAPACITY_WEIGHT);
      const bScore = (b.latency_ms * LATENCY_WEIGHT) + ((1 - bCapacity) * 1000 * CAPACITY_WEIGHT);
      
      return aScore - bScore;
    });

    return sorted[0];
  }

  private activateLocalMode(): void {
    console.error('Activating local-only mode due to server failures');
    this.configManager.setLocalOnlyMode(true);
  }

  startMonitoring(): void {
    if (this.monitoringInterval) {
      return;
    }

    this.monitoringInterval = setInterval(async () => {
      for (const [serverId, server] of this.connectedServers) {
        const status = await this.checkServerHealth(serverId);
        
        this.recordMetric(
          serverId,
          server.latency_ms,
          status,
          0,
          0,
          0
        );

        if (status === 'offline' && this.getFailureCount(serverId) >= this.UNHEALTHY_THRESHOLD) {
          await this.triggerFailover(serverId);
        }
      }
    }, this.CHECK_INTERVAL_MS);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  addServer(server: BusServer): void {
    this.connectedServers.set(server.id, server);
  }

  removeServer(serverId: string): void {
    this.connectedServers.delete(serverId);
    this.failureCount.delete(serverId);
  }

  getConnectedServers(): BusServer[] {
    return Array.from(this.connectedServers.values());
  }
}
