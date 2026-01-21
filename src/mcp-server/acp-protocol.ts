/**
 * Agent Coordination Protocol (ACP) v1.0
 * 
 * A standardized protocol for multi-agent coordination using the message bus.
 * This module provides the ACP specification template and helper functions.
 */

export interface ACPMessage {
  type: ACPMessageType;
  from_agent: string;
  from_session: string;
  to_agent?: string;  // Optional: for direct messages
  timestamp: string;
  correlation_id?: string;
  payload: any;
}

export type ACPMessageType =
  | 'STATUS_UPDATE'
  | 'TASK_REQUEST'
  | 'TASK_ACCEPTED'
  | 'TASK_REJECTED'
  | 'TASK_COMPLETE'
  | 'HELP_REQUEST'
  | 'HELP_RESPONSE'
  | 'CONSENSUS_REQUEST'
  | 'CONSENSUS_RESPONSE'
  | 'ROLE_TRANSFER';

export type AgentRole = 'coordinator' | 'worker' | 'observer';

export type ConsensusVote = 'AGREE' | 'DISAGREE' | 'SUGGEST_CHANGES';

export interface ConsensusRequest {
  proposal: string;
  proposal_data?: any;
  voting_deadline?: string;
  required_votes?: number;
  quorum?: number;
}

export interface ConsensusResponse {
  vote: ConsensusVote;
  reason?: string;
  suggestions?: string;
}

export const ACP_PROTOCOL_TEMPLATE = `
# Agent Coordination Protocol (ACP) v1.0

## Overview

The Agent Coordination Protocol (ACP) provides a standardized framework for multi-agent coordination, consensus building, and task handoff automation using the message bus.

## Core Concepts

### 1. Agent Roles

Agents can assume one or more of the following roles:

- **Coordinator**: Orchestrates tasks, makes decisions, manages workflows
- **Worker**: Executes tasks assigned by coordinators
- **Observer**: Monitors activity without actively participating

Roles can be transferred dynamically via the ROLE_TRANSFER message type.

### 2. Message Types

ACP defines 10 standardized message types:

| Type | Purpose | Payload Structure |
|------|---------|-------------------|
| \`STATUS_UPDATE\` | Report agent status | \`{status: string, progress?: number, metadata?: object}\` |
| \`TASK_REQUEST\` | Request another agent to perform work | \`{task_id: string, description: string, requirements: object}\` |
| \`TASK_ACCEPTED\` | Acknowledge task acceptance | \`{task_id: string, estimated_completion?: string}\` |
| \`TASK_REJECTED\` | Decline task assignment | \`{task_id: string, reason: string}\` |
| \`TASK_COMPLETE\` | Report task completion | \`{task_id: string, result: any, artifacts?: object}\` |
| \`HELP_REQUEST\` | Request assistance | \`{issue: string, context: object, urgency: 'low'|'medium'|'high'}\` |
| \`HELP_RESPONSE\` | Respond to help request | \`{can_assist: boolean, response: string}\` |
| \`CONSENSUS_REQUEST\` | Request consensus vote | \`{proposal: string, voting_deadline: string, quorum?: number}\` |
| \`CONSENSUS_RESPONSE\` | Cast consensus vote | \`{vote: 'AGREE'|'DISAGREE'|'SUGGEST_CHANGES', reason?: string}\` |
| \`ROLE_TRANSFER\` | Transfer role to another agent | \`{new_role: string, from_agent: string, to_agent: string}\` |

### 3. Communication Patterns

#### Pattern 1: Polling Loop with Exponential Backoff

Workers should poll for tasks using exponential backoff to reduce load:

\`\`\`
poll_interval = initial_interval (e.g., 5 seconds)
max_interval = 120 seconds

while true:
    messages = bus_receive(channel="coordination")
    
    if messages.length > 0:
        process_messages(messages)
        poll_interval = initial_interval  // Reset on activity
    else:
        poll_interval = min(poll_interval * 1.5, max_interval)  // Exponential backoff
    
    sleep(poll_interval)
\`\`\`

#### Pattern 2: Request-Response with Timeout

Use correlation IDs for request-response patterns with timeouts:

\`\`\`
request = bus_request(
    channel="coordination",
    content=JSON.stringify({
        type: "TASK_REQUEST",
        payload: {task_id: "task-123", ...}
    }),
    ttl_seconds=300
)

// Wait for responses with timeout
responses = await_responses(request.correlation_id, timeout=60)

if responses.length == 0:
    handle_timeout()
\`\`\`

### 4. Consensus Protocol

For decisions requiring multiple agent agreement:

#### Step 1: Coordinator Sends Consensus Request

\`\`\`
bus_request_consensus(
    proposal="Adopt new caching strategy for API responses",
    agents=["worker-1", "worker-2", "worker-3"],
    quorum=2,
    voting_deadline="2026-01-21T10:00:00Z"
)
\`\`\`

#### Step 2: Workers Cast Votes

\`\`\`
bus_send(
    channel="coordination",
    content=JSON.stringify({
        type: "CONSENSUS_RESPONSE",
        correlation_id: "...",
        payload: {
            vote: "AGREE",
            reason: "Improves performance, low implementation cost"
        }
    })
)
\`\`\`

#### Step 3: Coordinator Tallies Results

Once quorum is reached or deadline passes:

- **AGREE majority**: Implement proposal
- **DISAGREE majority**: Reject proposal
- **SUGGEST_CHANGES majority**: Iterate on proposal

### 5. Task Handoff Automation

ACP provides automated task handoff workflow:

#### Coordinator → Worker Handoff

1. **Coordinator creates task** via \`bus_orchestrate(command='create_task')\`
2. **Coordinator assigns task** with \`TASK_REQUEST\` message
3. **Worker polls**, discovers task, sends \`TASK_ACCEPTED\`
4. **Worker executes**, sends periodic \`STATUS_UPDATE\`
5. **Worker completes**, sends \`TASK_COMPLETE\` with result
6. **Coordinator verifies**, approves via \`bus_orchestrate(command='approve_result')\`

#### Worker → Coordinator Escalation

If worker encounters blocking issues:

1. **Worker sends** \`HELP_REQUEST\` with issue details
2. **Coordinator (or other workers) send** \`HELP_RESPONSE\`
3. **Worker retries** or **transfers task** via \`ROLE_TRANSFER\`

### 6. File Sharing Integration

Use bus file transfer for task artifacts:

\`\`\`
// Worker uploads result file
file_id = bus_upload_file(
    agent_id="worker-1",
    file_name="analysis-results.json",
    file_data=base64_encode(data),
    content_type="application/json",
    recipients=["coordinator"]
)

// Include file_id in TASK_COMPLETE message
bus_send(content=JSON.stringify({
    type: "TASK_COMPLETE",
    payload: {
        task_id: "task-123",
        result_file_id: file_id
    }
}))
\`\`\`

### 7. Error Handling

All agents must handle:

- **Message TTL expiration**: Retry or escalate
- **Unresponsive agents**: Timeout and reassign
- **Conflicting messages**: Use correlation_id and timestamps
- **Invalid message format**: Log to \`errors\` channel

Standard error message format:

\`\`\`json
{
  "type": "ERROR",
  "error_code": "TASK_TIMEOUT",
  "message": "Task task-123 exceeded timeout of 300 seconds",
  "context": {
    "task_id": "task-123",
    "assigned_agent": "worker-1",
    "timeout_seconds": 300
  }
}
\`\`\`

### 8. Example Complete Workflow

**Scenario**: Coordinator needs 3 workers to analyze different datasets

\`\`\`typescript
// 1. Coordinator registers and announces role
bus_register_agent(agent_id="coordinator", session_id="...")
bus_send(channel="status", content=JSON.stringify({
    type: "STATUS_UPDATE",
    payload: {status: "active", role: "coordinator"}
}))

// 2. Coordinator creates tasks
const tasks = ["dataset-A", "dataset-B", "dataset-C"].map(dataset => {
    return bus_orchestrate({
        command: 'create_task',
        title: \`Analyze \${dataset}\`,
        agent_id: 'coordinator',
        description: JSON.stringify({dataset})
    })
})

// 3. Coordinator sends TASK_REQUEST messages
tasks.forEach(task => {
    bus_send(channel="coordination", content=JSON.stringify({
        type: "TASK_REQUEST",
        payload: {
            task_id: task.id,
            description: task.description,
            requirements: {timeout: 300}
        }
    }))
})

// 4. Workers poll and accept
// (Worker side)
const messages = bus_receive(channel="coordination")
for (const msg of messages) {
    const data = JSON.parse(msg.content)
    if (data.type === "TASK_REQUEST") {
        // Accept task
        bus_send(channel="coordination", content=JSON.stringify({
            type: "TASK_ACCEPTED",
            correlation_id: msg.correlation_id,
            payload: {
                task_id: data.payload.task_id,
                estimated_completion: new Date(Date.now() + 60000).toISOString()
            }
        }))
        
        // Execute task
        const result = await execute_analysis(data.payload.task_id)
        
        // Report completion
        bus_send(channel="coordination", content=JSON.stringify({
            type: "TASK_COMPLETE",
            correlation_id: msg.correlation_id,
            payload: {
                task_id: data.payload.task_id,
                result: result
            }
        }))
        
        bus_orchestrate({
            command: 'submit_result',
            task_id: data.payload.task_id,
            agent_id: 'worker-1',
            result_data: JSON.stringify(result)
        })
    }
}

// 5. Coordinator collects results and approves
const results = bus_receive(channel="coordination")
results.forEach(msg => {
    const data = JSON.parse(msg.content)
    if (data.type === "TASK_COMPLETE") {
        bus_orchestrate({
            command: 'approve_result',
            task_id: data.payload.task_id,
            agent_id: data.from_agent,
            approval_notes: "Result verified"
        })
    }
})
\`\`\`

## Best Practices

1. **Always include message type** in content JSON for ACP compliance
2. **Use correlation IDs** for multi-step workflows
3. **Send heartbeats** during long-running tasks
4. **Implement exponential backoff** for polling
5. **Set appropriate TTLs** (short for ephemeral, long for decisions)
6. **Handle all error cases** with graceful degradation
7. **Document agent capabilities** in registration metadata
8. **Use consensus** for multi-agent decisions
9. **Upload large artifacts** via file transfer, not message content
10. **Monitor the \`errors\` channel** for system-wide issues

## Quick Reference: ACP Message Templates

### Status Update
\`\`\`json
{
  "type": "STATUS_UPDATE",
  "from_agent": "worker-1",
  "from_session": "session-123",
  "timestamp": "2026-01-20T10:00:00Z",
  "payload": {
    "status": "processing",
    "progress": 0.45,
    "current_task": "task-123"
  }
}
\`\`\`

### Task Request
\`\`\`json
{
  "type": "TASK_REQUEST",
  "from_agent": "coordinator",
  "from_session": "session-456",
  "to_agent": "worker-1",
  "timestamp": "2026-01-20T10:00:00Z",
  "correlation_id": "req_abc123",
  "payload": {
    "task_id": "task-123",
    "description": "Analyze dataset-A for anomalies",
    "requirements": {
      "timeout_seconds": 300,
      "memory_limit_mb": 2048
    }
  }
}
\`\`\`

### Consensus Request
\`\`\`json
{
  "type": "CONSENSUS_REQUEST",
  "from_agent": "coordinator",
  "from_session": "session-789",
  "timestamp": "2026-01-20T10:00:00Z",
  "correlation_id": "consensus_xyz",
  "payload": {
    "proposal": "Migrate to new API version 2.0",
    "voting_deadline": "2026-01-20T12:00:00Z",
    "quorum": 3,
    "proposal_data": {
      "breaking_changes": ["auth", "pagination"],
      "migration_effort": "2 hours"
    }
  }
}
\`\`\`

## Version History

- **v1.0** (2026-01-20): Initial release with 10 message types, consensus protocol, and task handoff automation
`;

/**
 * Get the ACP protocol template
 */
export function getACPProtocolTemplate(): string {
  return ACP_PROTOCOL_TEMPLATE;
}

/**
 * Validate ACP message structure
 */
export function validateACPMessage(message: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!message.type) {
    errors.push('Missing required field: type');
  }
  
  const validTypes: ACPMessageType[] = [
    'STATUS_UPDATE', 'TASK_REQUEST', 'TASK_ACCEPTED', 'TASK_REJECTED',
    'TASK_COMPLETE', 'HELP_REQUEST', 'HELP_RESPONSE',
    'CONSENSUS_REQUEST', 'CONSENSUS_RESPONSE', 'ROLE_TRANSFER'
  ];
  
  if (message.type && !validTypes.includes(message.type)) {
    errors.push(`Invalid message type: ${message.type}`);
  }
  
  if (!message.from_agent) {
    errors.push('Missing required field: from_agent');
  }
  
  if (!message.from_session) {
    errors.push('Missing required field: from_session');
  }
  
  if (!message.timestamp) {
    errors.push('Missing required field: timestamp');
  }
  
  if (!message.payload) {
    errors.push('Missing required field: payload');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create an ACP-compliant message
 */
export function createACPMessage(
  type: ACPMessageType,
  fromAgent: string,
  fromSession: string,
  payload: any,
  options?: {
    toAgent?: string;
    correlationId?: string;
  }
): ACPMessage {
  return {
    type,
    from_agent: fromAgent,
    from_session: fromSession,
    to_agent: options?.toAgent,
    timestamp: new Date().toISOString(),
    correlation_id: options?.correlationId,
    payload
  };
}
