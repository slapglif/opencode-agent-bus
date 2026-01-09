---
name: agent-coordination-patterns
description: Use when designing multi-agent workflows, implementing task distribution, or orchestrating parallel work - provides proven patterns for agent coordination
---

# Agent Coordination Patterns

Design patterns for coordinating multiple AI agents using the message bus.

## Pattern 1: Coordinator-Worker

One coordinator dispatches tasks to multiple workers.

### Setup

```
# Coordinator registers
bus_register_agent(agent_id="coordinator", session_id="...")
bus_create_channel(name="tasks", description="Task queue")
bus_create_channel(name="results", description="Task results")

# Workers register
bus_register_agent(agent_id="worker-1", session_id="...")
bus_subscribe(agent_id="worker-1", channel="tasks")
```

### Workflow

```
# Coordinator sends task
bus_send(channel="tasks", content='{"id": "task-1", "type": "test", "files": [...]}')

# Worker receives and processes
messages = bus_receive(channel="tasks")
# ... process task ...
bus_acknowledge(message_id="...", agent_id="worker-1")
bus_send(channel="results", content='{"task_id": "task-1", "status": "done"}')

# Coordinator collects results
results = bus_receive(channel="results")
```

## Pattern 2: Publish-Subscribe Events

Agents react to events without direct coordination.

### Setup

```
bus_create_channel(name="events/file-changed")
bus_create_channel(name="events/test-failed")
bus_create_channel(name="events/build-complete")
```

### Usage

```
# Publisher (e.g., file watcher agent)
bus_send(channel="events/file-changed", content='{"file": "src/main.ts"}')

# Subscribers react independently
# Test agent: re-runs relevant tests
# Lint agent: re-checks the file
# Doc agent: updates if API changed
```

## Pattern 3: Pipeline Processing

Chain of agents process data sequentially.

```
[Input] -> [Agent A: Parse] -> [Agent B: Validate] -> [Agent C: Transform] -> [Output]
```

### Setup

```
bus_create_channel(name="pipeline/stage-1")
bus_create_channel(name="pipeline/stage-2")
bus_create_channel(name="pipeline/stage-3")
bus_create_channel(name="pipeline/complete")
```

### Flow

```
# Stage 1 agent
input = bus_receive(channel="pipeline/stage-1")
result = process(input)
bus_send(channel="pipeline/stage-2", content=result)

# Stage 2 agent
input = bus_receive(channel="pipeline/stage-2")
result = validate(input)
bus_send(channel="pipeline/stage-3", content=result)

# ... etc
```

## Pattern 4: Competing Consumers

Multiple agents compete for tasks (load balancing).

```
# Multiple workers subscribe to same channel
# First to acknowledge gets the task

messages = bus_receive(channel="tasks", limit=1)
if messages:
    success = bus_acknowledge(message_id=messages[0].id, agent_id="worker-N")
    if success:
        # We got it, process
    else:
        # Another worker got it first
```

## Pattern 5: Saga (Long-Running Transaction)

Coordinate multi-step operations with compensation on failure.

```
# Create saga channel
bus_create_channel(name="saga-order-123")

# Step 1: Reserve inventory
bus_send(channel="saga-order-123", content='{"step": 1, "action": "reserve", "status": "pending"}')
# ... agent processes, updates status ...

# Step 2: Charge payment
bus_send(channel="saga-order-123", content='{"step": 2, "action": "charge", "status": "pending"}')

# If step fails, compensate
bus_send(channel="saga-order-123", content='{"step": 1, "action": "release", "status": "compensating"}')
```

## Anti-Patterns to Avoid

### Message Ping-Pong
Don't have agents endlessly reply to each other.

### No Acknowledgment
Always acknowledge messages you've processed.

### Infinite TTL
Set reasonable expiration times.

### Single Point of Failure
Don't make one agent critical to all operations.

## Monitoring

Check bus health:

```
# List active agents
bus_list_agents(active_within_seconds=60)

# Check channel activity
bus_receive(channel="status", limit=20)

# Review errors
bus_receive(channel="errors", limit=10)
```
