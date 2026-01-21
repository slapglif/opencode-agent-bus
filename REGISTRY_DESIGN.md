# Agent Bus Registry Discovery - Design Document

## Overview

Enhance the agent-bus MCP server with automatic discovery and connection to distributed bus servers via a central registry service.

## Requirements

1. **Registry Discovery**: Query a domain-controlled registry for available bus servers
2. **Auto-Connect**: Connect to the last configured bus server on startup
3. **Public Channel Registry**: Accept and store a public channel registry name during configuration
4. **Fallback**: If registry is unreachable, use local-only mode

## Architecture

### Components

```
┌──────────────────────────────────────────────────────────────┐
│                    Registry Service                           │
│              (registry.yourdomain.com)                        │
├──────────────────────────────────────────────────────────────┤
│  - List available bus servers                                │
│  - Health status for each server                             │
│  - Public channel directory                                  │
│  - Server capabilities metadata                              │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   │ HTTPS REST API
                   │
        ┌──────────┴──────────┬──────────────┬────────────────┐
        │                     │              │                │
┌───────▼────────┐  ┌─────────▼──────┐  ┌───▼────────┐  ┌───▼────────┐
│  Bus Server 1  │  │  Bus Server 2  │  │  Bus Server│  │  Local Bus │
│  (us-east)     │  │  (eu-west)     │  │  (asia)    │  │  (fallback)│
└────────────────┘  └────────────────┘  └────────────┘  └────────────┘
```

### Registry Service API Endpoints

#### `GET /api/v1/servers`
List all registered bus servers
```json
{
  "servers": [
    {
      "id": "us-east-1",
      "url": "wss://bus-us-east.yourdomain.com",
      "region": "us-east",
      "status": "healthy",
      "latency_ms": 45,
      "capacity": {"current": 150, "max": 500},
      "capabilities": ["pub-sub", "request-response", "persistence"],
      "last_seen": "2026-01-21T01:15:00Z"
    }
  ]
}
```

#### `GET /api/v1/channels/public`
List public channels across all servers
```json
{
  "channels": [
    {
      "name": "global",
      "description": "Global broadcast",
      "server_id": "us-east-1",
      "public": true,
      "subscriber_count": 45
    }
  ]
}
```

#### `POST /api/v1/servers/register`
Register a new bus server (for server operators)
```json
{
  "url": "wss://my-bus.example.com",
  "region": "custom",
  "capabilities": ["pub-sub"]
}
```

### Client-Side Configuration

**New file**: `~/.config/opencode/agent-bus/config.json`

```json
{
  "registry": {
    "url": "https://registry.yourdomain.com/api/v1",
    "enabled": true,
    "fallback_to_local": true
  },
  "last_server": {
    "id": "us-east-1",
    "url": "wss://bus-us-east.yourdomain.com",
    "connected_at": "2026-01-21T01:00:00Z"
  },
  "public_channel_registry": "my-team-channels",
  "local_only_mode": false
}
```

### Database Schema Changes

**New table**: `public_channels`

```sql
CREATE TABLE IF NOT EXISTS public_channels (
  name TEXT PRIMARY KEY,
  registry_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  server_id TEXT,
  visibility TEXT DEFAULT 'private' CHECK(visibility IN ('private', 'public')),
  created_at TEXT DEFAULT (datetime('now')),
  synced_at TEXT
);
```

### New MCP Tools

1. **`bus_configure_registry`**
   - Set registry URL and public channel registry name
   - Enable/disable registry discovery

2. **`bus_discover_servers`**
   - Query registry for available servers
   - Return list with health status

3. **`bus_connect_to_server`**
   - Connect to a specific server by ID
   - Save as last_server in config

4. **`bus_publish_channel`**
   - Register a local channel with the public registry
   - Set visibility (public/private)

5. **`bus_discover_channels`**
   - Query public channel directory
   - Filter by registry name or server

## Implementation Plan

### Phase 1: Configuration & Storage
1. Create `src/mcp-server/config.ts` - Config file management
2. Create `src/mcp-server/registry-client.ts` - Registry HTTP client
3. Update database schema with `public_channels` table
4. Add config validation with Zod

### Phase 2: Registry Discovery
1. Implement `discoverServers()` - Query registry API
2. Implement `selectBestServer()` - Choose by latency/health
3. Add startup logic to auto-connect to last server
4. Implement fallback to local mode on failure

### Phase 3: Public Channel Registry
1. Implement `publishChannel()` - Register channel with registry
2. Implement `discoverChannels()` - Query public channels
3. Add sync logic to keep public channels updated
4. Add privacy controls

### Phase 4: MCP Tool Endpoints
1. Add 5 new tools to `index.ts`
2. Add Zod schemas for validation
3. Implement handlers
4. Update tool documentation

### Phase 5: Testing & Docs
1. Unit tests for registry client
2. Integration tests with mock registry
3. Update README with registry setup
4. Add configuration guide

## Configuration Flow

```
1. User runs: bus_configure_registry({
     registry_url: "https://registry.example.com/api/v1",
     public_channel_registry: "my-team"
   })

2. On next server start:
   - Load config from ~/.config/opencode/agent-bus/config.json
   - Query registry.example.com/api/v1/servers
   - Select server (last_server or best available)
   - Connect to selected server
   - Sync public channels if registry name is set

3. If registry fails:
   - Fallback to local SQLite bus
   - Log warning
   - Continue operation in local-only mode
```

## Migration Strategy

- **Backward Compatible**: Existing deployments continue to work in local-only mode
- **Opt-In**: Registry discovery is disabled by default
- **Graceful Degradation**: If registry is unreachable, use local bus
- **No Breaking Changes**: All existing tools remain unchanged

## Security Considerations

1. **Registry Authentication**: Optional API key for private registries
2. **TLS Required**: Registry must use HTTPS
3. **Server Verification**: Validate server certificates
4. **Channel Privacy**: Default to private channels
5. **Access Control**: Registry can enforce access policies

## Future Enhancements

- **Multi-Registry Support**: Connect to multiple registries
- **Server-Side Filtering**: Registry-side channel search
- **Health Monitoring**: Client-side server health checks
- **Automatic Failover**: Switch servers on connection loss
- **Encryption**: End-to-end encryption for messages
