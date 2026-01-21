# Agent Bus Registry - Public Deployment

## ✅ Deployment Complete

The Agent Bus Registry is now publicly accessible via **Cloudflare Tunnel**.

### 🌐 Public URL
```
https://registry.ai-smith.net/api/v1
```

### 🔧 Infrastructure

**Cloudflare Tunnel**
- Tunnel ID: `f6a73eed-fa4d-493a-8e94-c1f5229583b9`
- Tunnel Name: `agent-bus-registry`
- Public Domain: `registry.ai-smith.net`
- Backend: `localhost:3456` (Express.js registry service)

**DNS Configuration**
- CNAME Record: `registry.ai-smith.net` → `f6a73eed-fa4d-493a-8e94-c1f5229583b9.cfargotunnel.com`
- Zone: `ai-smith.net`
- Proxied: Yes (Cloudflare CDN + SSL)

## 📁 File Locations

### Configuration Files
- **Tunnel Credentials**: `~/.cloudflared/f6a73eed-fa4d-493a-8e94-c1f5229583b9.json`
- **Tunnel Config**: `~/.cloudflared/config.yml`
- **Agent Bus Config**: `~/.config/opencode/agent-bus/config.json`

### Service Files
- **Registry Service**: `~/work/acp/opencode-agent-bus/registry-service/server.js`
- **Registry Logs**: `~/work/acp/opencode-agent-bus/registry-service/logs/registry.log`
- **Tunnel Logs**: `~/work/acp/opencode-agent-bus/registry-service/logs/tunnel.log`

### Process Management
- **Registry PID**: `~/work/acp/opencode-agent-bus/registry-service/registry.pid`
- **Tunnel PID**: `~/work/acp/opencode-agent-bus/registry-service/tunnel.pid`

## 🚀 Service Management

### Registry Service (Local Express.js)

```bash
cd ~/work/acp/opencode-agent-bus/registry-service

# Start
./start.sh

# Stop
./stop.sh

# Check status
curl http://localhost:3456/api/v1/health

# View logs
tail -f logs/registry.log
```

### Cloudflare Tunnel

```bash
cd ~/work/acp/opencode-agent-bus/registry-service

# Start tunnel
./start-tunnel.sh

# Stop tunnel
./stop-tunnel.sh

# View logs
tail -f logs/tunnel.log
```

### Start Both Services

```bash
cd ~/work/acp/opencode-agent-bus/registry-service
./start.sh          # Start registry
./start-tunnel.sh   # Start tunnel
```

### Stop Both Services

```bash
cd ~/work/acp/opencode-agent-bus/registry-service
./stop-tunnel.sh    # Stop tunnel
./stop.sh           # Stop registry
```

## 🧪 Testing

### Test Public Endpoint
```bash
# Health check
curl https://registry.ai-smith.net/api/v1/health

# List servers
curl https://registry.ai-smith.net/api/v1/servers

# List channels
curl https://registry.ai-smith.net/api/v1/channels/public
```

### Test Discovery via CLI
```bash
cd ~/work/acp/opencode-agent-bus
node dist/cli/cli/bus-cli.js discover
```

### Test Registration
```bash
curl -X POST https://registry.ai-smith.net/api/v1/servers/register \
  -H "Content-Type: application/json" \
  -d '{
    "url": "wss://my-bus.example.com",
    "region": "us-west",
    "capabilities": ["pub-sub", "request-response"]
  }'
```

## 📊 Current Status

### Services
- ✅ Registry Service: Running on `localhost:3456`
- ✅ Cloudflare Tunnel: Running (4 connections active)
- ✅ Public URL: https://registry.ai-smith.net ← **LIVE**

### Configuration
- ✅ Agent Bus configured to use public registry
- ✅ Fallback to local mode enabled
- ✅ Auto-discovery enabled

## 🔐 Security

### API Tokens Used
- `CF_API_TOKEN` - Used for DNS configuration (from `~/.bashrc`)
- `CF_TUNNEL_TOKEN` - Used for tunnel creation (from `~/.bashrc`)

### Tunnel Authentication
Tunnel authenticates using credentials file:
```
~/.cloudflared/f6a73eed-fa4d-493a-8e94-c1f5229583b9.json
```

This file contains the tunnel secret and should be kept secure.

## 🔄 Auto-Start on Boot (Optional)

To make services start automatically on boot, create systemd service files:

### Registry Service
```bash
# Create service file
sudo tee /etc/systemd/system/agent-bus-registry.service << EOF
[Unit]
Description=Agent Bus Registry Service
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER/work/acp/opencode-agent-bus/registry-service
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable agent-bus-registry
sudo systemctl start agent-bus-registry
```

### Cloudflare Tunnel
```bash
# Create service file
sudo tee /etc/systemd/system/cloudflared-agent-bus.service << EOF
[Unit]
Description=Cloudflare Tunnel for Agent Bus Registry
After=network.target

[Service]
Type=simple
User=$USER
ExecStart=/usr/bin/cloudflared tunnel --config /home/$USER/.cloudflared/config.yml run agent-bus-registry
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable cloudflared-agent-bus
sudo systemctl start cloudflared-agent-bus
```

## 🌍 Available Domains

You have 3 domains in your Cloudflare account:
1. **ai-smith.net** ← Currently used for registry
2. truecausekit.com
3. wastelinnq.com

Additional subdomains can be created for:
- Multiple bus instances
- Testing environments
- Regional deployments

## 📈 Next Steps

1. **Monitor Logs**: Keep an eye on tunnel and registry logs for any issues
2. **Test from Remote**: Try accessing the registry from another machine
3. **Register Real Servers**: Start registering actual message bus servers
4. **Setup Monitoring**: Consider adding uptime monitoring (e.g., UptimeRobot)
5. **Add SSL Verification**: Ensure all clients validate SSL certificates

## ⚠️ Troubleshooting

### Tunnel Not Connecting
```bash
# Check tunnel status
cd ~/work/acp/opencode-agent-bus/registry-service
cat tunnel.pid | xargs ps -p

# Restart tunnel
./stop-tunnel.sh
./start-tunnel.sh

# Check Cloudflare dashboard
# Visit: https://one.dash.cloudflare.com/
```

### Registry Not Responding
```bash
# Check registry process
cd ~/work/acp/opencode-agent-bus/registry-service
cat registry.pid | xargs ps -p

# Restart registry
./stop.sh
./start.sh

# Check local endpoint
curl http://localhost:3456/api/v1/health
```

### DNS Not Resolving
```bash
# Check DNS propagation
dig registry.ai-smith.net

# Expected output should show Cloudflare IPs
```

## 📞 Support

- **Cloudflare Dashboard**: https://dash.cloudflare.com/
- **Tunnel Status**: https://one.dash.cloudflare.com/
- **Project Issues**: https://github.com/slapglif/opencode-agent-bus/issues

---

**Deployment Date**: 2026-01-21  
**Deployed By**: Automated setup via CF API  
**Status**: ✅ Production Ready
