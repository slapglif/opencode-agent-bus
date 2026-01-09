---
name: agent-message-bus
description: Use when coordinating between multiple agents, sending messages across sessions, or implementing multi-agent workflows - provides patterns for pub/sub, request/response, and broadcast communication
---

# Agent Message Bus

A multi-agent communication system for OpenCode that enables agents to send and receive messages across sessions.

## Quick Start

### 1. Register Your Agent

```
bus_register_agent(
  agent_id="my-agent",
  session_id="<your-session-id>",
  metadata={"capabilities": ["code-review", "testing"]}
)
```

### 2. Subscribe to Channels

```
bus_subscribe(agent_id="my-agent", session_id="<session>", channel="global")
bus_subscribe(agent_id="my-agent", session_id="<session>", channel="coordination")
```

### 3. Send Messages

```
bus_send(
  channel="global",
  agent_id="my-agent",
  session_id="<session>",
  content="Task completed: code review done"
)
```

### 4. Receive Messages

```
bus_receive(channel="global", agent_id="my-agent", limit=10)
```

## Message Patterns

### Broadcast (One-to-Many)

Send updates to all listening agents:

```
bus_send(channel="status", agent_id="worker-1", session_id="...",
         content='{"status": "processing", "task": "build-123"}')
```

### Request-Response (Ask and Wait)

Send a request and collect responses:

```
# Send request
response = bus_request(channel="reviewers", agent_id="coordinator",
                       session_id="...", content="Need code review for PR #42")

# Later, check for responses
bus_get_responses(correlation_id=response.correlation_id)
```

Other agents respond:

```
bus_respond(correlation_id="<from-request>", agent_id="reviewer-1",
            session_id="...", content="I can review, ETA 10 mins")
```

### Direct Messaging

Create a channel for specific agents:

```
bus_create_channel(name="agent-a-to-agent-b", description="Private channel")
bus_send(channel="agent-a-to-agent-b", ...)
```

## Default Channels

| Channel | Purpose |
|---------|---------|
| `global` | Broadcast to all agents |
| `coordination` | Task assignment and orchestration |
| `status` | Agent heartbeats and status updates |
| `errors` | Error reporting and alerts |

## Best Practices

1. **Always register first** - Call `bus_register_agent` at session start
2. **Use heartbeats** - Call `bus_heartbeat` periodically for long tasks
3. **Acknowledge messages** - Call `bus_acknowledge` after processing
4. **Set appropriate TTL** - Use shorter TTL for ephemeral messages
5. **Use structured content** - JSON for complex data

## Integration with Subagents

When spawning subagents:

```
# Parent agent creates a task channel
bus_create_channel(name="task-123", ttl_seconds=1800)

# Spawn subagent with instructions to listen
# Subagent registers and subscribes to "task-123"

# Parent sends task
bus_send(channel="task-123", content='{"task": "run tests", "files": [...]}')

# Subagent reports back
bus_send(channel="task-123", content='{"result": "pass", "tests": 42}')
```

## Troubleshooting

**Messages not received?**
- Verify subscription: Did you call `bus_subscribe`?
- Check TTL: Has the message expired?
- Verify channel name: Exact match required

**Agent not showing in list?**
- Call `bus_register_agent` first
- Check `active_within_seconds` parameter
- Send heartbeats for long-running tasks
