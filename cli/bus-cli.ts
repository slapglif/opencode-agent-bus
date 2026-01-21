#!/usr/bin/env node

import { Command } from 'commander';
import { initializeDatabase } from '../src/mcp-server/database.js';
import { MessageBus } from '../src/mcp-server/bus.js';
import { ConfigManager } from '../src/mcp-server/config.js';
import { RegistryClient } from '../src/mcp-server/registry-client.js';
import { FileTransferManager } from '../src/mcp-server/file-transfer.js';
import { MessageScheduler } from '../src/mcp-server/scheduler.js';
import { homedir } from 'os';
import { join } from 'path';

const program = new Command();
const db = initializeDatabase();
const bus = new MessageBus(db);
const configManager = new ConfigManager();
const fileManager = new FileTransferManager(db, join(homedir(), '.config', 'opencode', 'agent-bus', 'files'));
const scheduler = new MessageScheduler(db, bus);

program
  .name('agent-bus')
  .description('CLI tool for OpenCode Agent Bus')
  .version('1.0.0');

program
  .command('send')
  .description('Send a message to a channel')
  .argument('<channel>', 'Channel name')
  .argument('<message>', 'Message content')
  .option('-a, --agent <id>', 'Agent ID', 'cli-user')
  .option('-s, --session <id>', 'Session ID', `cli-${Date.now()}`)
  .option('-p, --priority <number>', 'Message priority', '0')
  .action((channel, message, options) => {
    const msg = bus.sendMessage(channel, options.agent, options.session, message, {
      priority: parseInt(options.priority)
    });
    console.log('✅ Message sent:', msg.id);
  });

program
  .command('receive')
  .description('Receive messages from a channel')
  .argument('<channel>', 'Channel name')
  .option('-a, --agent <id>', 'Agent ID', 'cli-user')
  .option('-l, --limit <number>', 'Max messages', '10')
  .action((channel, options) => {
    const messages = bus.getMessages(channel, {
      limit: parseInt(options.limit),
      excludeSender: options.agent
    });
    
    if (messages.length === 0) {
      console.log('📭 No messages');
      return;
    }
    
    console.log(`📬 Received ${messages.length} message(s):\n`);
    messages.forEach((m, i) => {
      console.log(`${i + 1}. [${m.sender_agent}] ${m.content}`);
      console.log(`   ID: ${m.id}`);
      console.log(`   Time: ${m.created_at}\n`);
    });
  });

program
  .command('dm')
  .description('Send a direct message to another agent')
  .argument('<to>', 'Recipient agent ID')
  .argument('<message>', 'Message content')
  .option('-a, --agent <id>', 'Your agent ID', 'cli-user')
  .option('-s, --session <id>', 'Session ID', `cli-${Date.now()}`)
  .action((to, message, options) => {
    const msg = bus.sendDirectMessage(options.agent, to, options.session, message);
    console.log(`✅ DM sent to ${to}:`, msg.id);
  });

program
  .command('channels')
  .description('List all channels')
  .action(() => {
    const channels = bus.listChannels();
    console.log(`📢 ${channels.length} channel(s):\n`);
    channels.forEach(c => {
      console.log(`  • ${c.name}`);
      console.log(`    ${c.description || 'No description'}`);
      console.log(`    Created: ${c.created_at}\n`);
    });
  });

program
  .command('agents')
  .description('List active agents')
  .option('-t, --time <seconds>', 'Active within seconds', '300')
  .action((options) => {
    const agents = bus.listAgents(parseInt(options.time));
    console.log(`👥 ${agents.length} active agent(s):\n`);
    agents.forEach(a => {
      const metadata = JSON.parse(a.metadata);
      console.log(`  • ${a.agent_id}`);
      console.log(`    Session: ${a.session_id}`);
      console.log(`    Last seen: ${a.last_seen}`);
      console.log(`    Channels: ${a.subscribed_channels}`);
      if (Object.keys(metadata).length > 0) {
        console.log(`    Metadata: ${JSON.stringify(metadata)}`);
      }
      console.log('');
    });
  });

program
  .command('upload')
  .description('Upload a file for sharing')
  .argument('<filepath>', 'Path to file')
  .option('-a, --agent <id>', 'Agent ID', 'cli-user')
  .option('-s, --session <id>', 'Session ID', `cli-${Date.now()}`)
  .option('-m, --mode <mode>', 'Access mode (private|channel|public)', 'private')
  .option('--allow <agents>', 'Comma-separated list of allowed agents')
  .action(async (filepath, options) => {
    const allowedAgents = options.allow ? options.allow.split(',') : [];
    const fileInfo = await fileManager.uploadFile(
      options.agent,
      options.session,
      filepath,
      options.mode,
      allowedAgents
    );
    console.log('✅ File uploaded:', fileInfo.id);
    console.log(`   Name: ${fileInfo.filename}`);
    console.log(`   Size: ${fileInfo.size_bytes} bytes`);
    console.log(`   Checksum: ${fileInfo.checksum_sha256}`);
  });

program
  .command('download')
  .description('Download a shared file')
  .argument('<file-id>', 'File ID')
  .argument('<destination>', 'Destination path')
  .option('-a, --agent <id>', 'Agent ID', 'cli-user')
  .action(async (fileId, destination, options) => {
    const success = await fileManager.downloadFile(fileId, options.agent, destination);
    if (success) {
      console.log('✅ File downloaded to:', destination);
    } else {
      console.log('❌ Download failed');
    }
  });

program
  .command('files')
  .description('List available files')
  .option('-a, --agent <id>', 'Agent ID', 'cli-user')
  .action((options) => {
    const files = fileManager.listFiles(options.agent);
    console.log(`📁 ${files.length} file(s):\n`);
    files.forEach(f => {
      console.log(`  • ${f.filename} (${f.id})`);
      console.log(`    Size: ${f.size_bytes} bytes`);
      console.log(`    Uploader: ${f.uploader_agent}`);
      console.log(`    Access: ${f.access_mode}`);
      console.log(`    Uploaded: ${f.uploaded_at}\n`);
    });
  });

program
  .command('schedule')
  .description('Schedule a recurring message')
  .argument('<channel>', 'Channel name')
  .argument('<message>', 'Message content')
  .argument('<schedule>', 'Schedule (interval:60 or at:2026-01-21T12:00:00Z)')
  .option('-a, --agent <id>', 'Agent ID', 'cli-user')
  .option('-s, --session <id>', 'Session ID', `cli-${Date.now()}`)
  .action((channel, message, schedule, options) => {
    const recurring = scheduler.createRecurring(
      channel,
      options.agent,
      options.session,
      message,
      schedule
    );
    console.log('✅ Scheduled message:', recurring.id);
    console.log(`   Next send: ${recurring.next_send_at}`);
  });

program
  .command('scheduled')
  .description('List scheduled messages')
  .option('-a, --agent <id>', 'Filter by agent ID')
  .action((options) => {
    const messages = scheduler.listScheduled(options.agent);
    console.log(`⏰ ${messages.length} scheduled message(s):\n`);
    messages.forEach(m => {
      console.log(`  • ${m.id}`);
      console.log(`    Channel: ${m.channel}`);
      console.log(`    Content: ${m.content_template}`);
      console.log(`    Schedule: ${m.schedule_cron || `interval:${m.schedule_interval_seconds}s`}`);
      console.log(`    Next send: ${m.next_send_at}`);
      console.log(`    Enabled: ${m.enabled ? 'Yes' : 'No'}\n`);
    });
  });

program
  .command('discover')
  .description('Discover servers from registry')
  .action(async () => {
    const config = configManager.getConfig();
    
    if (!config.registry?.enabled) {
      console.log('❌ Registry is disabled');
      console.log('   Enable in ~/.config/opencode/agent-bus/config.json');
      return;
    }
    
    const client = new RegistryClient(config.registry.url);
    const servers = await client.discoverServers();
    
    console.log(`🔍 Found ${servers.length} server(s):\n`);
    servers.forEach((s, i) => {
      console.log(`${i + 1}. ${s.id}`);
      console.log(`   URL: ${s.url}`);
      console.log(`   Region: ${s.region}`);
      console.log(`   Status: ${s.status}`);
      console.log(`   Capabilities: ${s.capabilities.join(', ')}\n`);
    });
    
    if (servers.length > 0) {
      const best = client.selectBestServer(servers);
      console.log(`🎯 Best server: ${best?.id} (${best?.url})`);
    }
  });

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = configManager.getConfig();
    console.log(JSON.stringify(config, null, 2));
  });

program.parse();
