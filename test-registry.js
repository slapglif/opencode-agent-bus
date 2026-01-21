const { ConfigManager } = require('./dist/mcp-server/config.js');
const { RegistryClient } = require('./dist/mcp-server/registry-client.js');

async function testRegistryDiscovery() {
  console.log('🔍 Testing Registry Discovery\n');
  
  const configManager = new ConfigManager();
  const config = configManager.getConfig();
  
  console.log('📋 Current Config:');
  console.log(JSON.stringify(config, null, 2));
  console.log('');
  
  if (!config.registry?.enabled) {
    console.log('❌ Registry is disabled in config');
    return;
  }
  
  const registryUrl = config.registry.url;
  console.log(`🌐 Connecting to registry: ${registryUrl}\n`);
  
  const client = new RegistryClient(registryUrl);
  
  console.log('🏥 Checking registry health...');
  const healthy = await client.healthCheck();
  console.log(`   Status: ${healthy ? '✅ Healthy' : '❌ Unhealthy'}\n`);
  
  if (!healthy) {
    console.log('❌ Registry is not responding');
    return;
  }
  
  console.log('📡 Discovering servers...');
  const servers = await client.discoverServers();
  console.log(`   Found ${servers.length} server(s)\n`);
  
  if (servers.length > 0) {
    console.log('🖥️  Available Servers:');
    servers.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.id}`);
      console.log(`      URL: ${s.url}`);
      console.log(`      Region: ${s.region}`);
      console.log(`      Status: ${s.status}`);
      console.log(`      Latency: ${s.latency_ms}ms`);
      console.log(`      Capacity: ${s.capacity.current}/${s.capacity.max}`);
      console.log(`      Capabilities: ${s.capabilities.join(', ')}`);
      console.log('');
    });
    
    console.log('🎯 Selecting best server...');
    const best = client.selectBestServer(servers);
    if (best) {
      console.log(`   Selected: ${best.id} (${best.url})\n`);
      
      configManager.setLastServer({
        id: best.id,
        url: best.url
      });
      console.log('💾 Saved as last_server in config\n');
    }
  } else {
    console.log('⚠️  No servers registered in registry');
    console.log('   Falling back to local mode\n');
  }
  
  console.log('🔍 Discovering public channels...');
  const channels = await client.discoverChannels();
  console.log(`   Found ${channels.length} channel(s)\n`);
  
  if (channels.length > 0) {
    console.log('📢 Public Channels:');
    channels.forEach((c, i) => {
      console.log(`   ${i + 1}. ${c.name} - ${c.description}`);
      console.log(`      Server: ${c.server_id}`);
      console.log(`      Subscribers: ${c.subscriber_count}`);
      console.log('');
    });
  }
  
  console.log('✅ Registry discovery test complete!');
}

testRegistryDiscovery().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
