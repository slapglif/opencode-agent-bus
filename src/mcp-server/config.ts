import { join } from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

export interface ServerInfo {
  id: string;
  url: string;
  connected_at?: string;
}

export interface RegistryConfig {
  url: string;
  enabled: boolean;
  fallback_to_local: boolean;
  api_key?: string;
}

export interface BusConfig {
  registry?: RegistryConfig;
  last_server?: ServerInfo;
  public_channel_registry?: string;
  local_only_mode: boolean;
}

const DEFAULT_CONFIG: BusConfig = {
  local_only_mode: true,
  registry: {
    url: '',
    enabled: false,
    fallback_to_local: true
  }
};

export class ConfigManager {
  private configPath: string;
  private config: BusConfig;

  constructor(configDir?: string) {
    const dir = configDir ?? join(homedir(), '.config', 'opencode', 'agent-bus');
    
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.configPath = join(dir, 'config.json');
    this.config = this.load();
  }

  private load(): BusConfig {
    if (!existsSync(this.configPath)) {
      this.save(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }

    try {
      const data = readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(data) as BusConfig;
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (error) {
      console.error('Failed to load config, using defaults:', error);
      return DEFAULT_CONFIG;
    }
  }

  private save(config: BusConfig): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      this.config = config;
    } catch (error) {
      console.error('Failed to save config:', error);
      throw new Error(`Config save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getConfig(): BusConfig {
    return { ...this.config };
  }

  updateRegistry(registry: Partial<RegistryConfig>): void {
    this.config.registry = {
      ...DEFAULT_CONFIG.registry!,
      ...this.config.registry,
      ...registry
    };
    this.save(this.config);
  }

  setLastServer(server: ServerInfo): void {
    this.config.last_server = {
      ...server,
      connected_at: new Date().toISOString()
    };
    this.save(this.config);
  }

  setPublicChannelRegistry(name: string): void {
    this.config.public_channel_registry = name;
    this.save(this.config);
  }

  setLocalOnlyMode(enabled: boolean): void {
    this.config.local_only_mode = enabled;
    this.save(this.config);
  }

  isRegistryEnabled(): boolean {
    return this.config.registry?.enabled === true && !this.config.local_only_mode;
  }

  getRegistryUrl(): string | null {
    return this.config.registry?.url || null;
  }

  getLastServer(): ServerInfo | null {
    return this.config.last_server || null;
  }

  getPublicChannelRegistry(): string | null {
    return this.config.public_channel_registry || null;
  }

  reset(): void {
    this.save(DEFAULT_CONFIG);
  }
}
