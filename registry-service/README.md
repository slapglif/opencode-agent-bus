# Agent Bus Registry Service

Central registry for discovering and managing distributed agent bus servers.

## Quick Start

```bash
cd ~/work/acp/opencode-agent-bus/registry-service
./start.sh
```

## API Endpoints

### Health Check
```bash
curl http://localhost:3456/api/v1/health
```

### List Servers
```bash
curl http://localhost:3456/api/v1/servers
```

### Register Server
```bash
curl -X POST http://localhost:3456/api/v1/servers/register \
  -H "Content-Type: application/json" \
  -d '{"url":"wss://bus.example.com","region":"us-east","capabilities":["pub-sub"]}'
```

### List Public Channels
```bash
curl http://localhost:3456/api/v1/channels/public
```

### Publish Channel
```bash
curl -X POST http://localhost:3456/api/v1/channels/publish \
  -H "Content-Type: application/json" \
  -d '{"name":"my-channel","description":"My channel","server_id":"server-123","registry_name":"my-team"}'
```

## Management

**Start:** `./start.sh`  
**Stop:** `./stop.sh`  
**Logs:** `tail -f logs/registry.log`

## Configuration

Default port: **3456**  
Change in `start.sh`: `PORT=3456 bun run server.js`

## Deployment Options

### Local (Current)
Running on localhost:3456 with nohup

### Cloudflare Tunnel
Expose via cloudflared to registry.ai-smith.net

### Cloudflare Workers
Deploy worker version (see `src/index.ts` and `wrangler.toml`)

### AWS Lambda
Package as Lambda function with API Gateway

## Client Configuration

Update agent-bus clients to use registry:

```json
{
  "registry": {
    "url": "https://registry.ai-smith.net/api/v1",
    "enabled": true,
    "fallback_to_local": true
  }
}
```
