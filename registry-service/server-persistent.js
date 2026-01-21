const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const dbDir = path.join(process.env.HOME || process.env.USERPROFILE, '.config', 'opencode', 'agent-bus');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'registry.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    region TEXT,
    status TEXT DEFAULT 'healthy',
    latency_ms INTEGER DEFAULT 0,
    current_capacity INTEGER DEFAULT 0,
    max_capacity INTEGER DEFAULT 500,
    capabilities TEXT,
    last_seen TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    server_id TEXT NOT NULL,
    public INTEGER DEFAULT 1,
    subscriber_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(name, server_id)
  );

  CREATE INDEX IF NOT EXISTS idx_servers_last_seen ON servers(last_seen);
  CREATE INDEX IF NOT EXISTS idx_channels_server_id ON channels(server_id);
`);

const insertServer = db.prepare(`
  INSERT OR REPLACE INTO servers 
  (id, url, region, status, capabilities, last_seen)
  VALUES (?, ?, ?, 'healthy', ?, datetime('now'))
`);

const getServers = db.prepare(`
  SELECT * FROM servers 
  ORDER BY last_seen DESC
`);

const updateServerStatus = db.prepare(`
  UPDATE servers 
  SET status = ?, last_seen = datetime('now')
  WHERE id = ?
`);

const insertChannel = db.prepare(`
  INSERT OR REPLACE INTO channels 
  (name, description, server_id, public, subscriber_count)
  VALUES (?, ?, ?, 1, 0)
`);

const getChannels = db.prepare(`
  SELECT * FROM channels
  WHERE public = 1
  ORDER BY created_at DESC
`);

const getChannelsByServer = db.prepare(`
  SELECT * FROM channels
  WHERE server_id = ? AND public = 1
  ORDER BY created_at DESC
`);

function isHealthy(lastSeen) {
  const threshold = 5 * 60 * 1000; // 5 minutes
  const lastSeenTime = new Date(lastSeen).getTime();
  const now = Date.now();
  return now - lastSeenTime < threshold;
}

function getActiveServers() {
  const servers = getServers.all();
  return servers.map(s => ({
    id: s.id,
    url: s.url,
    region: s.region,
    status: isHealthy(s.last_seen) ? s.status : 'offline',
    latency_ms: s.latency_ms,
    capacity: {
      current: s.current_capacity,
      max: s.max_capacity
    },
    capabilities: s.capabilities ? JSON.parse(s.capabilities) : [],
    last_seen: s.last_seen
  }));
}

app.get('/api/v1/health', (req, res) => {
  const serverCount = db.prepare('SELECT COUNT(*) as count FROM servers').get();
  const channelCount = db.prepare('SELECT COUNT(*) as count FROM channels').get();
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    stats: {
      servers: serverCount.count,
      channels: channelCount.count,
      database: dbPath
    }
  });
});

app.get('/api/v1/servers', (req, res) => {
  const servers = getActiveServers();
  res.json({ servers });
});

app.post('/api/v1/servers/register', (req, res) => {
  const { url, region, capabilities } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }

  const id = `server-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const capsJson = JSON.stringify(capabilities || []);
  
  try {
    insertServer.run(id, url, region || 'default', capsJson);
    res.json({ id, success: true });
  } catch (error) {
    console.error('Failed to register server:', error);
    res.status(500).json({ error: 'Failed to register server' });
  }
});

app.post('/api/v1/servers/:id/heartbeat', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  try {
    updateServerStatus.run(status || 'healthy', id);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to update server status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

app.get('/api/v1/channels/public', (req, res) => {
  const serverId = req.query.server_id;
  
  try {
    const channels = serverId 
      ? getChannelsByServer.all(serverId)
      : getChannels.all();
    
    res.json({ channels });
  } catch (error) {
    console.error('Failed to get channels:', error);
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

app.post('/api/v1/channels/publish', (req, res) => {
  const { name, description, server_id } = req.body;
  
  if (!name || !server_id) {
    return res.status(400).json({ error: 'name and server_id are required' });
  }
  
  try {
    insertChannel.run(name, description || '', server_id);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to publish channel:', error);
    res.status(500).json({ error: 'Failed to publish channel' });
  }
});

setInterval(() => {
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24 hours
  const deleted = db.prepare('DELETE FROM servers WHERE last_seen < ?').run(threshold);
  if (deleted.changes > 0) {
    console.log(`Cleaned up ${deleted.changes} stale server(s)`);
  }
}, 60 * 60 * 1000); // Run every hour

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Agent Bus Registry (PERSISTENT) running on port ${PORT}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Health: http://localhost:${PORT}/api/v1/health`);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  db.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  db.close();
  process.exit(0);
});
