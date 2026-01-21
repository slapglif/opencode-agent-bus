---
name: agent-coordination-protocol
description: Use when implementing the Agent Coordination Protocol (ACP) for multi-agent coordination - provides standardized message types, consensus mechanisms, and task handoff automation workflows
---

# Agent Coordination Protocol (ACP) v1.0

Standardized protocol for multi-agent coordination using the message bus.

## Quick Start

### 1. Get the ACP Specification

```
bus_get_acp_protocol(format='markdown')
```

Returns the complete ACP v1.0 specification including:
- 10 standardized message types
- Consensus protocol
- Task handoff workflows
- Communication patterns
- Error handling
- Complete examples

### 2. Send ACP-Compliant Messages

All ACP messages must include these fields:

```json
{
  "type": "MESSAGE_TYPE",
  "from_agent": "your-agent-id",
  "from_session": "your-session-id",
  "timestamp": "2026-01-20T10:00:00Z",
  "payload": { ... }
}
```

### 3. Validate Messages

```
bus_validate_acp_message(message={
  "type": "STATUS_UPDATE",
  "from_agent": "worker-1",
  "from_session": "session-123",
  "timestamp": "2026-01-20T10:00:00Z",
  "payload": {"status": "processing"}
})
```

## ACP Message Types

### 1. STATUS_UPDATE
Report agent status and progress

```javascript
{
  "type": "STATUS_UPDATE",
  "from_agent": "worker-1",
  "from_session": "session-123",
  "timestamp": "2026-01-20T10:00:00Z",
  "payload": {
    "status": "processing",
    "progress": 0.65,
    "current_task": "task-456"
  }
}
```

### 2. TASK_REQUEST
Request another agent to perform work

```javascript
{
  "type": "TASK_REQUEST",
  "from_agent": "coordinator",
  "from_session": "session-789",
  "to_agent": "worker-1",
  "timestamp": "2026-01-20T10:00:00Z",
  "correlation_id": "req_abc123",
  "payload": {
    "task_id": "task-789",
    "description": "Analyze dataset for anomalies",
    "requirements": {
      "timeout_seconds": 300
    }
  }
}
```

### 3. TASK_ACCEPTED / TASK_REJECTED
Acknowledge or decline task assignment

```javascript
{
  "type": "TASK_ACCEPTED",
  "from_agent": "worker-1",
  "from_session": "session-123",
  "timestamp": "2026-01-20T10:00:05Z",
  "correlation_id": "req_abc123",
  "payload": {
    "task_id": "task-789",
    "estimated_completion": "2026-01-20T10:05:00Z"
  }
}
```

### 4. TASK_COMPLETE
Report task completion with results

```javascript
{
  "type": "TASK_COMPLETE",
  "from_agent": "worker-1",
  "from_session": "session-123",
  "timestamp": "2026-01-20T10:04:30Z",
  "correlation_id": "req_abc123",
  "payload": {
    "task_id": "task-789",
    "result": { ... },
    "artifacts": {
      "file_id": "file_xyz"
    }
  }
}
```

### 5. HELP_REQUEST / HELP_RESPONSE
Request and offer assistance

```javascript
{
  "type": "HELP_REQUEST",
  "from_agent": "worker-1",
  "from_session": "session-123",
  "timestamp": "2026-01-20T10:00:00Z",
  "correlation_id": "help_123",
  "payload": {
    "issue": "Dataset exceeds memory limits",
    "context": {
      "dataset_size_mb": 8192,
      "available_memory_mb": 4096
    },
    "urgency": "high"
  }
}
```

### 6. CONSENSUS_REQUEST / CONSENSUS_RESPONSE
Request and cast consensus votes

```javascript
{
  "type": "CONSENSUS_REQUEST",
  "from_agent": "coordinator",
  "from_session": "session-789",
  "timestamp": "2026-01-20T10:00:00Z",
  "correlation_id": "consensus_xyz",
  "payload": {
    "proposal": "Migrate to API v2.0",
    "voting_deadline": "2026-01-20T12:00:00Z",
    "quorum": 3,
    "proposal_data": {
      "breaking_changes": ["auth", "pagination"],
      "migration_effort_hours": 2
    }
  }
}
```

## Consensus Protocol

Use the automated consensus tool:

```
result = bus_request_consensus(
  agent_id="coordinator",
  session_id="session-789",
  proposal="Adopt new caching strategy",
  target_agents=["worker-1", "worker-2", "worker-3"],
  quorum=2,
  voting_deadline_seconds=120
)

// Returns correlation_id for tracking votes
correlation_id = result.correlation_id

// Poll for responses
votes = bus_get_responses(correlation_id=correlation_id)

// Tally results
agrees = votes.filter(v => JSON.parse(v.content).payload.vote === "AGREE")
disagrees = votes.filter(v => JSON.parse(v.content).payload.vote === "DISAGREE")
```

### Consensus Decision Rules

- **AGREE majority**: Implement proposal
- **DISAGREE majority**: Reject proposal
- **SUGGEST_CHANGES majority**: Iterate on proposal
- **Quorum not met**: Defer decision or extend deadline

## Task Handoff Workflow

Complete coordinator → worker → coordinator loop:

```
// 1. Coordinator creates task
task = bus_orchestrate({
  command: 'create_task',
  title: 'Analyze dataset-A',
  agent_id: 'coordinator',
  description: JSON.stringify({dataset: 'dataset-A'})
})

// 2. Coordinator sends TASK_REQUEST
bus_send(channel="coordination", content=JSON.stringify({
  type: "TASK_REQUEST",
  from_agent: "coordinator",
  from_session: "session-789",
  timestamp: new Date().toISOString(),
  payload: {
    task_id: task.id,
    description: "Analyze dataset-A for anomalies",
    requirements: {timeout_seconds: 300}
  }
}))

// 3. Worker polls, accepts task
messages = bus_receive(channel="coordination")
for (const msg of messages) {
  data = JSON.parse(msg.content)
  if (data.type === "TASK_REQUEST") {
    bus_send(channel="coordination", content=JSON.stringify({
      type: "TASK_ACCEPTED",
      from_agent: "worker-1",
      from_session: "session-123",
      timestamp: new Date().toISOString(),
      correlation_id: msg.correlation_id,
      payload: {
        task_id: data.payload.task_id,
        estimated_completion: new Date(Date.now() + 60000).toISOString()
      }
    }))
    
    bus_orchestrate({
      command: 'accept_task',
      task_id: data.payload.task_id,
      agent_id: 'worker-1'
    })
  }
}

// 4. Worker executes and sends STATUS_UPDATE
bus_send(channel="coordination", content=JSON.stringify({
  type: "STATUS_UPDATE",
  from_agent: "worker-1",
  from_session: "session-123",
  timestamp: new Date().toISOString(),
  payload: {
    status: "processing",
    progress: 0.5,
    current_task: task.id
  }
}))

// 5. Worker completes and sends TASK_COMPLETE
result = execute_analysis()
bus_send(channel="coordination", content=JSON.stringify({
  type: "TASK_COMPLETE",
  from_agent: "worker-1",
  from_session: "session-123",
  timestamp: new Date().toISOString(),
  correlation_id: msg.correlation_id,
  payload: {
    task_id: task.id,
    result: result
  }
}))

bus_orchestrate({
  command: 'submit_result',
  task_id: task.id,
  agent_id: 'worker-1',
  result_data: JSON.stringify(result)
})

// 6. Coordinator approves result
bus_orchestrate({
  command: 'approve_result',
  task_id: task.id,
  agent_id: 'worker-1',
  approval_notes: 'Result verified successfully'
})
```

## Polling with Exponential Backoff

Reduce bus load with smart polling:

```javascript
let poll_interval = 5000  // Start at 5 seconds
const max_interval = 120000  // Max 2 minutes

while (true) {
  const messages = bus_receive(channel="coordination")
  
  if (messages.length > 0) {
    process_messages(messages)
    poll_interval = 5000  // Reset on activity
  } else {
    poll_interval = Math.min(poll_interval * 1.5, max_interval)
  }
  
  await sleep(poll_interval)
  
  // Send heartbeat every few cycles
  bus_heartbeat(agent_id="worker-1", session_id="session-123")
}
```

## Role Transfer

Transfer coordinator/worker roles dynamically:

```javascript
bus_send(channel="coordination", content=JSON.stringify({
  type: "ROLE_TRANSFER",
  from_agent: "coordinator-1",
  from_session: "session-old",
  to_agent: "coordinator-2",
  timestamp: new Date().toISOString(),
  payload: {
    new_role: "coordinator",
    from_agent: "coordinator-1",
    to_agent: "coordinator-2",
    reason: "Coordinator-1 going offline for maintenance",
    active_tasks: ["task-123", "task-456"]
  }
}))
```

## Best Practices

1. **Always include timestamp** in ACP messages
2. **Use correlation IDs** for request-response patterns
3. **Validate messages** with `bus_validate_acp_message` before sending
4. **Send STATUS_UPDATE** during long-running tasks
5. **Implement exponential backoff** for polling
6. **Use HELP_REQUEST** for blocking issues
7. **Request consensus** for multi-agent decisions
8. **Upload large artifacts** via file transfer, reference in payload
9. **Handle all error cases** with fallbacks
10. **Monitor errors channel** for system-wide issues

## Common Patterns

### Pattern 1: Fan-Out with Consensus

```
1. Coordinator broadcasts TASK_REQUEST to multiple workers
2. Workers send TASK_ACCEPTED or TASK_REJECTED
3. Coordinator collects responses, selects workers based on availability
4. Selected workers execute in parallel
5. Workers send TASK_COMPLETE
6. Coordinator requests consensus on aggregated results
7. Implement decision based on consensus vote
```

### Pattern 2: Escalation Chain

```
1. Worker encounters blocker
2. Worker sends HELP_REQUEST with urgency=high
3. No response within timeout
4. Worker escalates via ROLE_TRANSFER to backup worker
5. Backup worker accepts transfer
6. Original worker sends STATUS_UPDATE with status=delegated
```

### Pattern 3: Distributed Consensus Decision

```
1. Coordinator sends CONSENSUS_REQUEST to all workers
2. Workers analyze proposal, send CONSENSUS_RESPONSE
3. Coordinator tallies votes (AGREE/DISAGREE/SUGGEST_CHANGES)
4. If SUGGEST_CHANGES majority, iterate proposal and re-vote
5. If AGREE majority, coordinator broadcasts implementation plan
6. Workers acknowledge plan, execute assigned portions
```

## Troubleshooting

**Messages not ACP-compliant?**
- Use `bus_validate_acp_message` to check structure
- Ensure all required fields are present
- Check message type is one of the 10 standard types

**Consensus not reaching quorum?**
- Increase `voting_deadline_seconds`
- Lower `quorum` requirement
- Check target agents are active via `bus_list_agents`

**Task handoff failing?**
- Verify workers are polling `coordination` channel
- Check task timeout hasn't expired
- Ensure worker sent TASK_ACCEPTED before executing

## See Also

- `agent-message-bus` skill - Basic bus usage
- `agent-coordination-patterns` skill - General patterns
- `bus_get_acp_protocol` - Full ACP specification
