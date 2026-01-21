# Orchestration Test Plan

## Objective
Verify the complete orchestrator workflow: create → assign → accept → submit → approve

## Prerequisites
- MCP server running
- Orchestrator implemented
- Database schema deployed

## Test Cases

### 1. Create Task
**Input:**
```typescript
bus_orchestrate({
  command: 'create_task',
  title: 'Test Task Alpha',
  agent_id: 'orchestrator-test',
  description: 'Verify task creation works'
})
```

**Expected Output:**
```json
{
  "id": "task_xxxxx",
  "title": "Test Task Alpha",
  "status": "created",
  "created_by": "orchestrator-test"
}
```

**Verification:** Task appears in database with status='created'

### 2. Assign Task
**Input:**
```typescript
bus_orchestrate({
  command: 'assign_task',
  task_id: 'task_xxxxx',
  agent_id: 'worker-agent-001'
})
```

**Expected Output:**
```json
{
  "id": "assign_xxxxx",
  "task_id": "task_xxxxx",
  "agent_id": "worker-agent-001",
  "status": "assigned"
}
```

**Verification:** Assignment record created, agent receives notification

### 3. Accept Task
**Input:**
```typescript
bus_orchestrate({
  command: 'accept_task',
  task_id: 'task_xxxxx',
  agent_id: 'worker-agent-001'
})
```

**Expected Output:**
```json
{"success": true}
```

**Verification:** Assignment status='accepted', accepted_at timestamp set

### 4. Submit Result
**Input:**
```typescript
bus_orchestrate({
  command: 'submit_result',
  task_id: 'task_xxxxx',
  agent_id: 'worker-agent-001',
  result_data: JSON.stringify({
    output: 'Task completed successfully',
    metrics: {duration_ms: 1500}
  })
})
```

**Expected Output:**
```json
{
  "id": "result_xxxxx",
  "task_id": "task_xxxxx",
  "result_data": "...",
  "submitted_at": "2026-01-21..."
}
```

**Verification:** Result stored, assignment status='submitted'

### 5. Approve Result
**Input:**
```typescript
bus_orchestrate({
  command: 'approve_result',
  task_id: 'task_xxxxx',
  agent_id: 'worker-agent-001',
  approval_notes: 'Output verified, task complete'
})
```

**Expected Output:**
```json
{"success": true}
```

**Verification:**
- Result approved=1
- Assignment status='approved'
- Task status='completed'

### 6. List Tasks (TOON Format)
**Input:**
```typescript
bus_orchestrate({
  command: 'list_tasks',
  status: 'completed',
  format: 'toon'
})
```

**Expected Output:**
```
tasks[1]{id,title,status,created_by,created_at}:
  task_xxxxx,Test Task Alpha,completed,orchestrator-test,2026-01-21...
```

**Verification:** TOON format reduces output size by ~35%

## Success Criteria
- ALL 6 test cases pass
- No database errors
- Task lifecycle completes: created → assigned → accepted → submitted → approved → completed
- TOON formatting works correctly

## How to Execute
```bash
cd ~/work/acp/opencode-agent-bus
bun run build

# Test via MCP tools (requires MCP server running)
# Use the bus_orchestrate tool with each test case above
```

## Evidence Required
- Screenshot/output of each test case
- Database query showing final state
- TOON vs JSON comparison for token savings
