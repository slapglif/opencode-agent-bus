# Blocking Send Features - Agent-Bus MCP Server

## Overview

Two powerful coordination features added to agent-bus that prevent message spam and enable synchronous communication patterns:

1. **Unacked Message Blocking** - Prevents agents from sending new messages if they have unacknowledged messages from other agents
2. **Blocking Send Options** - Allows agents to wait for acknowledgment or response before continuing

## Feature 1: Unacked Message Blocking

### Problem Solved
Prevents agents from "blind spam" - sending messages without reading/acknowledging messages from other agents. This ensures proper turn-taking and message processing in coordination protocols.

### How It Works

**Before every `bus_send` call:**
1. Check agent's subscribed channels for unacknowledged messages
2. Filter to only messages from **external agents** (not self)
3. If any exist → **BLOCK** the send with detailed error message
4. If none exist → Allow send to proceed

### Block Response Format

**IMPORTANT**: This is NOT an error - it's expected blocking behavior!

```json
{
  "success": false,
  "blocked": true,
  "block_reason": "UNACKED_MESSAGES_PENDING",
  "message": "Send blocked: You have 2 unacknowledged message(s) from other agents in channels: coordination. This is EXPECTED blocking behavior (not an error). Read and acknowledge them first using bus_receive and bus_acknowledge, or use force_send=true to bypass this check.",
  "unacked_messages": {
    "count": 2,
    "channels": ["coordination"],
    "oldest_message_age_seconds": 42
  },
  "guidance": "This is not an error to fix. This is the blocking send feature preventing message spam. Read your pending messages with bus_receive, acknowledge them with bus_acknowledge, then retry sending."
}
```

**Key Fields:**
- `success: false` - Send was blocked
- `blocked: true` - **THIS FLAG DISTINGUISHES BLOCKING FROM ACTUAL ERRORS**
- `block_reason` - Why it was blocked (always `UNACKED_MESSAGES_PENDING` for this feature)
- `guidance` - Explicit instructions on what to do next

### Bypassing the Check

Use `force_send: true` when you legitimately need to send without reading:

```javascript
bus_send({
  channel: "coordination",
  agent_id: "my_agent",
  session_id: "session_123",
  content: JSON.stringify({ type: "URGENT", message: "Emergency!" }),
  force_send: true  // ⚠️ Bypasses unacked check
})
```

### Implementation Details

**New Methods in `bus.ts`:**

```typescript
hasUnackedExternalMessages(agentId: string, channels: string[]): boolean
```
Returns `true` if agent has any unacknowledged messages from other agents.

```typescript
getUnackedExternalMessages(agentId: string, channels: string[]): { 
  count: number; 
  oldest_age_seconds: number | null; 
  channels: string[] 
}
```
Returns detailed information about unacknowledged messages.

## Feature 2: Blocking Send Options

### Problem Solved
Enables synchronous request-response patterns where the sender needs to wait for acknowledgment or response before continuing execution.

### wait_for_ack Option

Blocks until the sent message is acknowledged by another agent (or timeout).

**Use Case**: Ensure message was received and processed before continuing.

```javascript
const result = await bus_send({
  channel: "coordination",
  agent_id: "coordinator",
  session_id: "session_123",
  content: JSON.stringify({ type: "TASK_ASSIGNMENT", task_id: "task_001" }),
  wait_for_ack: true,
  wait_timeout_ms: 30000  // Wait up to 30 seconds
})

// Response includes acknowledgment status
{
  "success": true,
  "message": { ... },
  "wait_for_ack_result": {
    "acknowledged": true,
    "timeout_ms": 30000,
    "message": "Message was acknowledged"
  }
}
```

### wait_for_response Option

Blocks until a response is received (automatically uses request-response pattern with correlation_id).

**Use Case**: Synchronous RPC-style communication between agents.

```javascript
const result = await bus_send({
  channel: "coordination",
  agent_id: "agent1",
  session_id: "session_123",
  content: JSON.stringify({ type: "REQUEST", question: "What is status?" }),
  wait_for_response: true,
  wait_timeout_ms: 5000  // Wait up to 5 seconds
})

// Response includes the reply
{
  "success": true,
  "message": { ... },
  "wait_for_response_result": {
    "received": true,
    "timeout_ms": 5000,
    "response": {
      "id": "msg_...",
      "content": "{\"type\":\"RESPONSE\",\"status\":\"all good\"}",
      "correlation_id": "msg_...",
      ...
    },
    "message": "Response received"
  }
}
```

### Implementation Details

**New Methods in `bus.ts`:**

```typescript
async waitForAck(
  messageId: string, 
  timeoutMs: number = 30000, 
  pollIntervalMs: number = 500
): Promise<boolean>
```
Polls database every 500ms until message is acknowledged or timeout.

```typescript
async waitForResponse(
  correlationId: string, 
  timeoutMs: number = 30000, 
  pollIntervalMs: number = 500
): Promise<Message | null>
```
Polls database every 500ms until response received or timeout.

## Updated bus_send Tool Schema

```typescript
{
  name: 'bus_send',
  description: 'Send a message to a channel. Blocks if unacknowledged external messages exist (unless force_send=true). Optionally waits for acknowledgment or response.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      agent_id: { type: 'string' },
      session_id: { type: 'string' },
      content: { type: 'string' },
      priority: { type: 'number' },         // Default: 0
      ttl_seconds: { type: 'number' },      // Default: 3600
      force_send: { type: 'boolean' },      // NEW - Default: false
      wait_for_ack: { type: 'boolean' },    // NEW - Default: false
      wait_for_response: { type: 'boolean' }, // NEW - Default: false
      wait_timeout_ms: { type: 'number' },  // NEW - Default: 30000
      format: { type: 'string', enum: ['json', 'toon'] }
    },
    required: ['channel', 'agent_id', 'session_id', 'content']
  }
}
```

## Usage Patterns

### Pattern 1: Normal Send (with automatic blocking)

```javascript
// Automatically blocks if unacked messages exist
bus_send({
  channel: "coordination",
  agent_id: "my_agent",
  session_id: "session_123",
  content: JSON.stringify({ type: "STATUS_UPDATE", status: "working" })
})
```

### Pattern 2: Urgent Send (bypass blocking)

```javascript
// Force send despite unacked messages
bus_send({
  channel: "coordination",
  agent_id: "my_agent",
  session_id: "session_123",
  content: JSON.stringify({ type: "EMERGENCY", alert: "System failure!" }),
  force_send: true
})
```

### Pattern 3: Confirmed Delivery

```javascript
// Wait for acknowledgment before proceeding
const result = await bus_send({
  channel: "coordination",
  agent_id: "coordinator",
  session_id: "session_123",
  content: JSON.stringify({ type: "DEPLOY_COMMAND", version: "v2.0" }),
  wait_for_ack: true,
  wait_timeout_ms: 10000
})

if (result.wait_for_ack_result.acknowledged) {
  console.log("Deployment command acknowledged");
} else {
  console.log("Timeout waiting for acknowledgment");
}
```

### Pattern 4: Synchronous Request-Response

```javascript
// Send request and wait for response (RPC-style)
const result = await bus_send({
  channel: "coordination",
  agent_id: "client",
  session_id: "session_123",
  content: JSON.stringify({ 
    type: "QUERY", 
    query: "SELECT * FROM status" 
  }),
  wait_for_response: true,
  wait_timeout_ms: 5000
})

if (result.wait_for_response_result.received) {
  const response = JSON.parse(result.wait_for_response_result.response.content);
  console.log("Query result:", response);
} else {
  console.log("Timeout waiting for response");
}
```

## Testing

**Test Suite**: `test-blocking-send.js`

**Coverage:**
- ✅ Unacked message blocking (prevents send)
- ✅ Force send bypass (allows send despite unacked)
- ✅ Normal send after acknowledging all messages
- ✅ wait_for_response with actual response timing

**Run Tests:**
```bash
cd /home/mikeb/work/acp/opencode-agent-bus
node test-blocking-send.js
```

**Expected Output:**
```
🎉 ALL TESTS PASSED!

✅ Tests Passed: 8
❌ Tests Failed: 0
📈 Success Rate: 100.0%
```

## Performance Considerations

### Polling Overhead
- Default poll interval: 500ms
- Configurable via method parameters (not exposed in tool schema)
- Database queries are indexed and fast

### Timeout Defaults
- `wait_for_ack`: 30 seconds (configurable)
- `wait_for_response`: 30 seconds (configurable)
- Set shorter timeouts for low-latency requirements
- Set longer timeouts for high-latency or async workflows

### Blocking Behavior
- `wait_for_ack` and `wait_for_response` block the **MCP server request handler**
- Other agents can continue working (parallel execution)
- Consider timeouts carefully to avoid deadlocks

## Migration Guide

### Existing Code Compatibility

**Good news**: Existing `bus_send` calls work unchanged! All new parameters are optional.

**Before (still works):**
```javascript
bus_send({
  channel: "coordination",
  agent_id: "agent1",
  session_id: "session1",
  content: JSON.stringify({ message: "Hello" })
})
```

**After (with new features):**
```javascript
// Now automatically blocked if unacked messages exist!
// To restore old behavior, add force_send: true
bus_send({
  channel: "coordination",
  agent_id: "agent1",
  session_id: "session1",
  content: JSON.stringify({ message: "Hello" }),
  force_send: true  // Optional: restore old behavior
})
```

### Breaking Change

⚠️ **Behavior Change**: `bus_send` now blocks by default if unacknowledged external messages exist.

**If your agents relied on blind-send behavior:**
1. Add `force_send: true` to restore old behavior, OR
2. Update agents to acknowledge messages before sending (recommended)

## Benefits

1. **Prevents Message Pile-ups**: Agents must process messages before sending new ones
2. **Improved Coordination Quality**: Forces proper turn-taking in agent conversations
3. **Synchronous Patterns**: Enables RPC-style request-response when needed
4. **Visibility**: Clear error messages guide agents to read pending messages
5. **Flexibility**: Bypass available via `force_send` for legitimate urgent cases

## Files Modified

| File | Changes | Lines Added |
|------|---------|-------------|
| `src/mcp-server/bus.ts` | Added 4 new methods | +85 |
| `src/mcp-server/index.ts` | Updated SendMessageSchema and bus_send handler | +50 |
| `src/mcp-server/unacked-checker.ts` | Created by background agent (compatible) | +116 |
| `test-blocking-send.js` | Comprehensive test suite | +280 |

## Implementation Date

**Completed**: 2026-01-21 05:49 UTC  
**Implemented by**: Sisyphus (Coordinator) + Background Agent (bg_2cf90439)  
**Tests**: 8/8 passing (100%)  
**Build Status**: TypeScript compilation SUCCESS
