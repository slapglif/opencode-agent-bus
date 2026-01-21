const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const servers = [];
const channels = [];

app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/api/v1/servers', (req, res) => {
  const now = Date.now();
  const activeServers = servers.map(s => ({
    ...s,
    status: isHealthy(s.last_seen, now) ? s.status : 'offline'
  }));
  res.json({ servers: activeServers });
});

app.post('/api/v1/servers/register', (req, res) => {
  const { url, region, capabilities } = req.body;
  const id = `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const newServer = {
    id,
    url,
    region,
    status: 'healthy',
    latency_ms: 0,
    capacity: { current: 0, max: 500 },
    capabilities,
    last_seen: new Date().toISOString(),
  };

  servers.push(newServer);
  res.json({ id, success: true });
});

app.get('/api/v1/channels/public', (req, res) => {
  const serverId = req.query.server_id;
  const filtered = serverId 
    ? channels.filter(c => c.server_id === serverId)
    : channels;
  res.json({ channels: filtered });
});

app.post('/api/v1/channels/publish', (req, res) => {
  const { name, description, server_id, registry_name } = req.body;
  
  const newChannel = {
    name,
    description,
    server_id,
    public: true,
    subscriber_count: 0,
  };

  const existing = channels.findIndex(c => c.name === name && c.server_id === server_id);
  if (existing >= 0) {
    channels[existing] = newChannel;
  } else {
    channels.push(newChannel);
  }

  res.json({ success: true });
});

function isHealthy(lastSeen, now) {
  const threshold = 5 * 60 * 1000;
  return now - new Date(lastSeen).getTime() < threshold;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Agent Bus Registry running on port ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/v1/health`);
});
