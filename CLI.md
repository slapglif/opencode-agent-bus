# Agent Bus CLI Tool

Command-line interface for interacting with the OpenCode Agent Bus outside of MCP context.

## Installation

```bash
cd ~/work/acp/opencode-agent-bus
npm install -g .
```

Or use directly:
```bash
node dist/cli/bus-cli.js [command]
```

## Commands

### Send Messages

**Send a message to a channel:**
```bash
agent-bus send <channel> <message> [options]

# Example
agent-bus send global "Hello everyone!" --agent my-bot --priority 5
```

**Send a direct message:**
```bash
agent-bus dm <to-agent> <message> [options]

# Example
agent-bus dm agent-2 "Private message" --agent agent-1
```

### Receive Messages

**Receive messages from a channel:**
```bash
agent-bus receive <channel> [options]

# Example
agent-bus receive global --limit 20 --agent my-bot
```

### Channels & Agents

**List all channels:**
```bash
agent-bus channels
```

**List active agents:**
```bash
agent-bus agents --time 600  # Active in last 600 seconds
```

### File Transfer

**Upload a file:**
```bash
agent-bus upload <filepath> [options]

# Examples
agent-bus upload ./data.json --mode public
agent-bus upload ./report.pdf --mode channel --allow agent1,agent2
```

**Download a file:**
```bash
agent-bus download <file-id> <destination>

# Example
agent-bus download file_abc123 ./downloaded.pdf
```

**List available files:**
```bash
agent-bus files --agent my-bot
```

### Scheduled Messages

**Schedule a recurring message:**
```bash
agent-bus schedule <channel> <message> <schedule>

# Examples
agent-bus schedule status "Heartbeat" "interval:60"
agent-bus schedule global "Daily update" "at:2026-01-22T09:00:00Z"
```

**List scheduled messages:**
```bash
agent-bus scheduled --agent my-bot
```

### Registry Discovery

**Discover servers from registry:**
```bash
agent-bus discover
```

**Show current configuration:**
```bash
agent-bus config
```

## Options

Most commands support these options:

- `--agent <id>` - Agent ID (default: cli-user)
- `--session <id>` - Session ID (default: cli-{timestamp})
- `--priority <number>` - Message priority (default: 0)
- `--limit <number>` - Result limit (default: 10)

## Examples

### Complete Workflow

```bash
# 1. List channels
agent-bus channels

# 2. Send a message
agent-bus send coordination "Task assignment: Review PR #123" --agent orchestrator

# 3. Check for responses
agent-bus receive coordination --agent reviewer

# 4. Send DM to specific agent
agent-bus dm code-reviewer "Please prioritize PR #123" --agent orchestrator

# 5. Upload supporting file
agent-bus upload ./pr-context.json --mode channel

# 6. Schedule recurring status update
agent-bus schedule status "System health check" "interval:300"

# 7. Discover available servers
agent-bus discover

# 8. List active agents
agent-bus agents
```

### Use with Scripts

```bash
#!/bin/bash

# Monitor channel and process messages
while true; do
  agent-bus receive alerts --agent monitor | while read msg; do
    echo "Alert received: $msg"
    # Process alert
  done
  sleep 5
done
```

## Advanced Usage

### Custom Agent Identity

```bash
export AGENT_ID="my-custom-agent"
export SESSION_ID="persistent-session-123"

agent-bus send global "Message from custom agent" --agent $AGENT_ID --session $SESSION_ID
```

### Batch Operations

```bash
# Send multiple messages
for i in {1..5}; do
  agent-bus send test "Message $i" --agent batch-sender
done

# Upload multiple files
for file in *.log; do
  agent-bus upload "$file" --mode private
done
```

## Database Location

The CLI connects to the same database as the MCP server:
- **Database**: `~/.config/opencode/agent-bus/messages.db`
- **Config**: `~/.config/opencode/agent-bus/config.json`
- **Files**: `~/.config/opencode/agent-bus/files/`

## Troubleshooting

**Command not found:**
```bash
# Use full path
node ~/work/acp/opencode-agent-bus/dist/cli/bus-cli.js --help
```

**Database errors:**
```bash
# Check database exists
ls -la ~/.config/opencode/agent-bus/messages.db

# Reinitialize if needed
rm ~/.config/opencode/agent-bus/messages.db
# Start MCP server once to recreate
```

**Registry connection issues:**
```bash
# Check registry status
curl http://localhost:3456/api/v1/health

# Disable registry in config
agent-bus config  # View current config
# Edit: ~/.config/opencode/agent-bus/config.json
# Set: "enabled": false
```
