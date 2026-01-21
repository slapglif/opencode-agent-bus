export interface Env {
  DB: D1Database;
  REGISTRY_KV: KVNamespace;
}

interface BusServer {
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

interface PublicChannel {
  name: string;
  description: string;
  server_id: string;
  public: boolean;
  subscriber_count: number;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/api/v1/health') {
        return jsonResponse({ status: 'healthy', timestamp: new Date().toISOString() }, corsHeaders);
      }

      if (path === '/api/v1/servers' && request.method === 'GET') {
        const servers = await getServers(env);
        return jsonResponse({ servers }, corsHeaders);
      }

      if (path === '/api/v1/servers/register' && request.method === 'POST') {
        const body = await request.json() as { url: string; region: string; capabilities: string[] };
        const server = await registerServer(env, body);
        return jsonResponse({ id: server.id, success: true }, corsHeaders);
      }

      if (path === '/api/v1/channels/public' && request.method === 'GET') {
        const serverId = url.searchParams.get('server_id');
        const channels = await getPublicChannels(env, serverId || undefined);
        return jsonResponse({ channels }, corsHeaders);
      }

      if (path === '/api/v1/channels/publish' && request.method === 'POST') {
        const body = await request.json() as {
          name: string;
          description: string;
          server_id: string;
          registry_name: string;
        };
        await publishChannel(env, body);
        return jsonResponse({ success: true }, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, corsHeaders, 404);
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        corsHeaders,
        500
      );
    }
  },
};

function jsonResponse(data: unknown, headers: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

async function getServers(env: Env): Promise<BusServer[]> {
  const stored = await env.REGISTRY_KV.get('servers', 'json');
  if (!stored) return [];
  
  const servers = stored as BusServer[];
  const now = Date.now();
  
  return servers.map(s => ({
    ...s,
    status: isHealthy(s.last_seen, now) ? s.status : 'offline'
  }));
}

async function registerServer(
  env: Env,
  data: { url: string; region: string; capabilities: string[] }
): Promise<BusServer> {
  const servers = await getServers(env);
  
  const id = `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const newServer: BusServer = {
    id,
    url: data.url,
    region: data.region,
    status: 'healthy',
    latency_ms: 0,
    capacity: { current: 0, max: 500 },
    capabilities: data.capabilities,
    last_seen: new Date().toISOString(),
  };

  servers.push(newServer);
  await env.REGISTRY_KV.put('servers', JSON.stringify(servers));

  return newServer;
}

async function getPublicChannels(env: Env, serverId?: string): Promise<PublicChannel[]> {
  const stored = await env.REGISTRY_KV.get('channels', 'json');
  if (!stored) return [];
  
  const channels = stored as PublicChannel[];
  return serverId ? channels.filter(c => c.server_id === serverId) : channels;
}

async function publishChannel(
  env: Env,
  data: { name: string; description: string; server_id: string; registry_name: string }
): Promise<void> {
  const channels = await getPublicChannels(env);
  
  const newChannel: PublicChannel = {
    name: data.name,
    description: data.description,
    server_id: data.server_id,
    public: true,
    subscriber_count: 0,
  };

  const existing = channels.findIndex(c => c.name === data.name && c.server_id === data.server_id);
  if (existing >= 0) {
    channels[existing] = newChannel;
  } else {
    channels.push(newChannel);
  }

  await env.REGISTRY_KV.put('channels', JSON.stringify(channels));
}

function isHealthy(lastSeen: string, now: number): boolean {
  const threshold = 5 * 60 * 1000;
  return now - new Date(lastSeen).getTime() < threshold;
}
