# OpenCode Agent Message Bus

A multi-agent communication plugin for [OpenCode.ai](https://opencode.ai) that enables agents to send and receive messages across sessions, coordinate tasks, and work together on complex workflows.

## Features

- **Message Bus MCP Server** - Persistent message storage with SQLite
- **Multiple Communication Patterns** - Pub/sub, request/response, broadcast
- **Channel-Based Routing** - Organize messages by topic
- **Agent Registration** - Track active agents and their capabilities
- **Auto-Expiring Messages** - Configurable TTL for message cleanup
- **OpenCode Integration** - Native plugin with context injection
- **Skills & Agents** - Documentation and monitoring tools included

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/[user]/opencode-agent-bus.git
cd opencode-agent-bus
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the MCP Server

```bash
npm run build
```

### 4. Configure OpenCode

Add to your `opencode.json` (project or global):

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

Or symlink for convenience:

```bash
# Global plugin
mkdir -p ~/.config/opencode/plugin
ln -sf /path/to/opencode-agent-bus/.opencode/plugin/agent-bus.js ~/.config/opencode/plugin/agent-bus.js

# Global MCP config - add to ~/.config/opencode/opencode.json
```

### 5. Restart OpenCode

The agent bus will be available in your next session.

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

```
use_skill agent-message-bus
use_skill agent-coordination-patterns
```

## Commands

- `/bus-status [seconds]` - Check bus status and active agents
- `/bus-broadcast <message>` - Broadcast a message to all agents

## Agents

- `@bus-monitor` - Monitor bus health and report status

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenCode Sessions                       │
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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## License

MIT
