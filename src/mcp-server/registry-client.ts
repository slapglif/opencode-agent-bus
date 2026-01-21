export interface BusServer {
  id: string;
  url: string;
  region: string;
  status: 'healthy' | 'degraded' | 'offline';
  latency_ms: number;
  capacity: {
    current: number;
    max: number;
  };
  capabilities: string[];
  last_seen: string;
}

export interface PublicChannel {
  name: string;
  description: string;
  server_id: string;
  public: boolean;
  subscriber_count: number;
}

export interface RegistryResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class RegistryClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(baseUrl: string, apiKey?: string, timeout: number = 5000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.timeout = timeout;
  }

  async discoverServers(): Promise<BusServer[]> {
    try {
      const response = await this.fetch<{ servers: BusServer[] }>('/servers');
      return response.data?.servers ?? [];
    } catch (error) {
      console.error('Failed to discover servers:', error);
      return [];
    }
  }

  async discoverChannels(serverId?: string): Promise<PublicChannel[]> {
    try {
      const url = serverId ? `/channels/public?server_id=${serverId}` : '/channels/public';
      const response = await this.fetch<{ channels: PublicChannel[] }>(url);
      return response.data?.channels ?? [];
    } catch (error) {
      console.error('Failed to discover channels:', error);
      return [];
    }
  }

  async registerServer(server: {
    url: string;
    region: string;
    capabilities: string[];
  }): Promise<boolean> {
    try {
      const response = await this.fetch<{ id: string }>('/servers/register', {
        method: 'POST',
        body: JSON.stringify(server)
      });
      return response.success;
    } catch (error) {
      console.error('Failed to register server:', error);
      return false;
    }
  }

  async publishChannel(channel: {
    name: string;
    description: string;
    server_id: string;
    registry_name: string;
  }): Promise<boolean> {
    try {
      const response = await this.fetch<{ success: boolean }>('/channels/publish', {
        method: 'POST',
        body: JSON.stringify(channel)
      });
      return response.success;
    } catch (error) {
      console.error('Failed to publish channel:', error);
      return false;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.fetch<{ status: string }>('/health');
      return response.success && response.data?.status === 'healthy';
    } catch (error) {
      return false;
    }
  }

  selectBestServer(servers: BusServer[]): BusServer | null {
    if (servers.length === 0) return null;

    const healthy = servers.filter(s => s.status === 'healthy');
    if (healthy.length === 0) return null;

    const sorted = healthy.sort((a, b) => {
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

  private async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<RegistryResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {})
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json() as T;
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return { success: false, error: 'Request timeout' };
        }
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Unknown error' };
    }
  }
}
