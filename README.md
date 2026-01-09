# Agent Message Bus

A multi-agent communication plugin for **[OpenCode.ai](https://opencode.ai)** and **[Claude Code](https://claude.ai/claude-code)** that enables agents to send and receive messages across sessions, coordinate tasks, and work together on complex workflows.

## Features

- **Message Bus MCP Server** - Persistent message storage with SQLite
- **Multiple Communication Patterns** - Pub/sub, request/response, broadcast
- **Channel-Based Routing** - Organize messages by topic
- **Agent Registration** - Track active agents and their capabilities
- **Auto-Expiring Messages** - Configurable TTL for message cleanup
- **Cross-Platform** - Works with both OpenCode and Claude Code
- **Skills & Agents** - Documentation and monitoring tools included

## Quick Install

### One-Line Install

```bash
git clone https://github.com/slapglif/opencode-agent-bus.git ~/.local/share/agent-bus && cd ~/.local/share/agent-bus && ./install.sh
```

### Manual Install

```bash
# Clone the repository
git clone https://github.com/slapglif/opencode-agent-bus.git
cd opencode-agent-bus

# Run the installer (auto-detects OpenCode and Claude Code)
./install.sh
```

The installer will:
1. Build the MCP server
2. Detect which AI coding tools you have installed
3. Configure the MCP server for each tool
4. Symlink skills for easy access
5. Print next steps

### Install Options

```bash
./install.sh              # Auto-detect and install for detected tools
./install.sh opencode     # Install for OpenCode only
./install.sh claude       # Install for Claude Code only
./install.sh both         # Install for both tools
./install.sh uninstall    # Remove installation
```

### Restart Your Tool

After installation, restart OpenCode or Claude Code. The `bus_*` MCP tools will be available automatically.

## Quick Start

```
# Register your agent
bus_register_agent(agent_id="my-agent", session_id="session-123")

# Subscribe to channels
bus_subscribe(agent_id="my-agent", session_id="session-123", channel="global")

# Send a message
bus_send(channel="global", agent_id="my-agent", session_id="session-123",
         content="Hello from my-agent!")

# Receive messages
bus_receive(channel="global", agent_id="my-agent")
```

## Available Tools

| Tool | Description |
|------|-------------|
| `bus_register_agent` | Register an agent on the bus |
| `bus_subscribe` | Subscribe to a channel |
| `bus_unsubscribe` | Unsubscribe from a channel |
| `bus_send` | Send a message to a channel |
| `bus_receive` | Receive messages from a channel |
| `bus_acknowledge` | Acknowledge message receipt |
| `bus_request` | Send a request (for request/response pattern) |
| `bus_respond` | Respond to a request |
| `bus_get_responses` | Get responses to a request |
| `bus_list_channels` | List available channels |
| `bus_create_channel` | Create a new channel |
| `bus_list_agents` | List active agents |
| `bus_heartbeat` | Send a heartbeat/status update |

## Default Channels

- `global` - Broadcast to all agents
- `coordination` - Task assignment and orchestration
- `status` - Agent heartbeats and status updates
- `errors` - Error reporting and alerts

## Skills

Load skills for detailed documentation:

**OpenCode:**
```
use_skill agent-message-bus
use_skill agent-coordination-patterns
```

**Claude Code:**
```
/skill agent-message-bus
/skill agent-coordination-patterns
```

## Commands (OpenCode)

- `/bus-status [seconds]` - Check bus status and active agents
- `/bus-broadcast <message>` - Broadcast a message to all agents

## Agents (OpenCode)

- `@bus-monitor` - Monitor bus health and report status

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              AI Coding Tool Sessions                         │
├──────────────┬──────────────┬──────────────┬────────────────┤
│   Agent A    │   Agent B    │   Agent C    │    Agent D     │
│  (Session 1) │  (Session 2) │  (Session 3) │   (Session 4)  │
└──────┬───────┴──────┬───────┴──────┬───────┴───────┬────────┘
       │              │              │               │
       └──────────────┴──────┬───────┴───────────────┘
                             │
                    ┌────────┴────────┐
                    │  MCP Server     │
                    │  (agent-bus)    │
                    ├─────────────────┤
                    │    SQLite DB    │
                    │  - Messages     │
                    │  - Channels     │
                    │  - Agents       │
                    └─────────────────┘
```

## Data Storage

Messages are stored in SQLite at:
```
~/.config/opencode/agent-bus/messages.db
```

## Manual Configuration

### OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "agent-bus": {
      "type": "local",
      "command": ["node", "/path/to/opencode-agent-bus/dist/mcp-server/index.js"],
      "enabled": true
    }
  },
  "plugin": ["file:///path/to/opencode-agent-bus/.opencode/plugin/agent-bus.js"]
}
```

### Claude Code

Add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "agent-bus": {
      "command": "node",
      "args": ["/path/to/opencode-agent-bus/dist/mcp-server/index.js"]
    }
  }
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## License

MIT
