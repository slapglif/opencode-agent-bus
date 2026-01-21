# Claude Agent Instructions for OpenCode Agent Bus

## Package Management

**ALWAYS use Bun for this project:**
```bash
bun install
bun run build
bun test
```

**Never use npm/yarn** - this project is configured for Bun.

## Agent Bus MCP Commands

The agent bus provides orchestration capabilities via MCP tools. Use these to coordinate multi-agent workflows.

### Core Communication

```typescript
bus_register_agent({agent_id, session_id, metadata})
bus_subscribe({agent_id, session_id, channel})
bus_send({channel, agent_id, session_id, content, priority})
bus_receive({channel, agent_id, limit})
bus_request({channel, agent_id, session_id, content})
bus_respond({correlation_id, agent_id, session_id, content})
bus_get_responses({correlation_id})
```

### Task Orchestration

**Single tool with sub-commands for context efficiency:**

```typescript
bus_orchestrate({
  command: 'create_task',
  title: 'Task name',
  agent_id: 'creator-id',
  description: 'What to do',
  format: 'toon'
})

bus_orchestrate({
  command: 'assign_task',
  task_id: 'task_xxx',
  agent_id: 'worker-agent'
})

bus_orchestrate({
  command: 'accept_task',
  task_id: 'task_xxx',
  agent_id: 'worker-agent'
})

bus_orchestrate({
  command: 'submit_result',
  task_id: 'task_xxx',
  agent_id: 'worker-agent',
  result_data: JSON.stringify({...})
})

bus_orchestrate({
  command: 'approve_result',
  task_id: 'task_xxx',
  agent_id: 'worker-agent',
  approval_notes: 'Looks good!'
})

bus_orchestrate({
  command: 'list_tasks',
  status: 'assigned',
  format: 'toon'
})
```

## Creative Orchestration Patterns

### Pattern 1: Parallel Fan-Out (Deploy Pipeline)

**Problem**: Deploy a web app - frontend, backend, and tests can run in parallel.

```typescript
const deployWorkflow = async () => {
  const workflowId = 'deploy-app-v2';
  
  const buildFrontend = await bus_orchestrate({
    command: 'create_task',
    title: 'Build frontend',
    agent_id: 'orchestrator',
    description: 'Run bun build in packages/frontend'
  });
  
  const buildBackend = await bus_orchestrate({
    command: 'create_task', 
    title: 'Build backend',
    agent_id: 'orchestrator',
    description: 'Run bun build in packages/api'
  });
  
  const runTests = await bus_orchestrate({
    command: 'create_task',
    title: 'Run E2E tests',
    agent_id: 'orchestrator',
    description: 'Run playwright tests'
  });
  
  await Promise.all([
    bus_orchestrate({command: 'assign_task', task_id: buildFrontend.id, agent_id: 'build-agent-1'}),
    bus_orchestrate({command: 'assign_task', task_id: buildBackend.id, agent_id: 'build-agent-2'}),
    bus_orchestrate({command: 'assign_task', task_id: runTests.id, agent_id: 'test-agent'})
  ]);
  
  const allTasks = await bus_orchestrate({
    command: 'list_tasks',
    format: 'toon'
  });
};
```

**When to use**: Multiple independent tasks that can run simultaneously.

### Pattern 2: Sequential Pipeline (CI/CD)

**Problem**: Each stage depends on the previous one: test → build → deploy.

```typescript
const cicdPipeline = async () => {
  const testTask = await bus_orchestrate({
    command: 'create_task',
    title: 'Run tests',
    agent_id: 'orchestrator'
  });
  
  await bus_orchestrate({command: 'assign_task', task_id: testTask.id, agent_id: 'ci-agent'});
  
  await waitForCompletion(testTask.id);
  
  const buildTask = await bus_orchestrate({
    command: 'create_task',
    title: 'Build artifacts',
    agent_id: 'orchestrator'
  });
  
  await bus_orchestrate({command: 'assign_task', task_id: buildTask.id, agent_id: 'build-agent'});
  await waitForCompletion(buildTask.id);
  
  const deployTask = await bus_orchestrate({
    command: 'create_task',
    title: 'Deploy to staging',
    agent_id: 'orchestrator'
  });
  
  await bus_orchestrate({command: 'assign_task', task_id: deployTask.id, agent_id: 'deploy-agent'});
};

const waitForCompletion = async (taskId: string) => {
  while (true) {
    const status = await bus_orchestrate({command: 'get_status', task_id: taskId});
    if (status.status === 'completed') break;
    await sleep(5000);
  }
};
```

**When to use**: Tasks with strict ordering requirements.

### Pattern 3: Map-Reduce (Data Processing)

**Problem**: Process 1000 files - split into chunks, process in parallel, aggregate results.

```typescript
const mapReduceWorkflow = async (files: string[]) => {
  const chunkSize = 100;
  const chunks = chunkArray(files, chunkSize);
  
  const mapTasks = await Promise.all(
    chunks.map(async (chunk, i) => {
      const task = await bus_orchestrate({
        command: 'create_task',
        title: `Process chunk ${i}`,
        agent_id: 'orchestrator',
        description: JSON.stringify({files: chunk, operation: 'transform'})
      });
      
      await bus_orchestrate({
        command: 'assign_task',
        task_id: task.id,
        agent_id: `worker-${i % 5}`
      });
      
      return task.id;
    })
  );
  
  await Promise.all(mapTasks.map(waitForCompletion));
  
  const reduceTask = await bus_orchestrate({
    command: 'create_task',
    title: 'Aggregate results',
    agent_id: 'orchestrator',
    description: JSON.stringify({mapTaskIds: mapTasks})
  });
  
  await bus_orchestrate({command: 'assign_task', task_id: reduceTask.id, agent_id: 'reducer-agent'});
};
```

**When to use**: Large datasets that can be processed in parallel then combined.

### Pattern 4: Conditional Branching (Quality Gate)

**Problem**: Run tests - if they pass deploy to staging, if they fail notify team.

```typescript
const qualityGate = async () => {
  const testTask = await bus_orchestrate({
    command: 'create_task',
    title: 'Run integration tests',
    agent_id: 'orchestrator'
  });
  
  await bus_orchestrate({command: 'assign_task', task_id: testTask.id, agent_id: 'test-runner'});
  
  const result = await waitForResult(testTask.id);
  
  if (result.data.passed) {
    const deployTask = await bus_orchestrate({
      command: 'create_task',
      title: 'Deploy to staging',
      agent_id: 'orchestrator'
    });
    await bus_orchestrate({command: 'assign_task', task_id: deployTask.id, agent_id: 'deploy-agent'});
  } else {
    const notifyTask = await bus_orchestrate({
      command: 'create_task',
      title: 'Notify team of failure',
      agent_id: 'orchestrator',
      description: JSON.stringify({failures: result.data.failures})
    });
    await bus_orchestrate({command: 'assign_task', task_id: notifyTask.id, agent_id: 'notify-agent'});
  }
};
```

**When to use**: Workflows with decision points based on results.

### Pattern 5: Retry with Exponential Backoff

**Problem**: API integration that might fail - retry with increasing delays.

```typescript
const retryableTask = async (operation: string, maxRetries = 3) => {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    const task = await bus_orchestrate({
      command: 'create_task',
      title: `${operation} (attempt ${attempt + 1})`,
      agent_id: 'orchestrator'
    });
    
    await bus_orchestrate({command: 'assign_task', task_id: task.id, agent_id: 'api-worker'});
    
    const result = await waitForResult(task.id);
    
    if (result.data.success) {
      await bus_orchestrate({
        command: 'approve_result',
        task_id: task.id,
        agent_id: 'api-worker'
      });
      return result;
    }
    
    attempt++;
    if (attempt < maxRetries) {
      const backoffMs = Math.pow(2, attempt) * 1000;
      await sleep(backoffMs);
    }
  }
  
  throw new Error(`Task failed after ${maxRetries} attempts`);
};
```

**When to use**: Unreliable operations that might succeed on retry.

## Deep Dependency Management

### Complex Multi-Agent Flow

**Problem**: Research project with multiple stages, each requiring different specialized agents.

```typescript
const researchWorkflow = async (topic: string) => {
  const gatherData = await bus_orchestrate({
    command: 'create_task',
    title: 'Gather research data',
    agent_id: 'orchestrator',
    description: `Search academic papers on ${topic}`
  });
  await bus_orchestrate({command: 'assign_task', task_id: gatherData.id, agent_id: 'librarian'});
  
  await waitForCompletion(gatherData.id);
  const dataResult = await getResult(gatherData.id);
  
  const analyzeTasks = await Promise.all(
    ['statistical', 'qualitative', 'comparative'].map(async (method) => {
      const task = await bus_orchestrate({
        command: 'create_task',
        title: `${method} analysis`,
        agent_id: 'orchestrator',
        description: JSON.stringify({data: dataResult.data, method})
      });
      await bus_orchestrate({command: 'assign_task', task_id: task.id, agent_id: `${method}-analyst`});
      return task.id;
    })
  );
  
  await Promise.all(analyzeTasks.map(waitForCompletion));
  
  const synthesize = await bus_orchestrate({
    command: 'create_task',
    title: 'Synthesize findings',
    agent_id: 'orchestrator',
    description: JSON.stringify({analysisTasks: analyzeTasks})
  });
  await bus_orchestrate({command: 'assign_task', task_id: synthesize.id, agent_id: 'oracle'});
  
  await waitForCompletion(synthesize.id);
  
  const writeReport = await bus_orchestrate({
    command: 'create_task',
    title: 'Write final report',
    agent_id: 'orchestrator',
    description: JSON.stringify({synthesisTask: synthesize.id})
  });
  await bus_orchestrate({command: 'assign_task', task_id: writeReport.id, agent_id: 'document-writer'});
  
  return writeReport;
};
```

## Output Format: TOON vs JSON

**Always prefer TOON format** for array-heavy responses (18-40% token savings):

```typescript
bus_orchestrate({
  command: 'list_tasks',
  format: 'toon'
})
```

**TOON output:**
```
tasks[3]{id,title,status,created_at}:
  task_abc123,Build frontend,assigned,2026-01-21 02:00:00
  task_def456,Run tests,completed,2026-01-21 02:05:00
  task_ghi789,Deploy staging,in_progress,2026-01-21 02:10:00
```

**JSON output (default):**
```json
{
  "tasks": [
    {"id": "task_abc123", "title": "Build frontend", "status": "assigned", "created_at": "2026-01-21 02:00:00"},
    {"id": "task_def456", "title": "Run tests", "status": "completed", "created_at": "2026-01-21 02:05:00"},
    {"id": "task_ghi789", "title": "Deploy staging", "status": "in_progress", "created_at": "2026-01-21 02:10:00"}
  ]
}
```

## Best Practices

1. **Use TOON format** for lists to save context window
2. **Create tasks with clear titles** for debugging
3. **Always await acceptance** before starting work
4. **Submit results immediately** when done
5. **Track task IDs** for status checks
6. **Use bus_send** for notifications alongside orchestration
7. **Leverage parallelism** whenever tasks are independent
8. **Design for failure** - tasks can time out or be rejected

## Common Patterns Summary

| Pattern | Use Case | Agents Needed |
|---------|----------|---------------|
| **Fan-out** | Parallel independent tasks | 3+ workers |
| **Pipeline** | Sequential dependencies | 2+ workers |
| **Map-reduce** | Data processing at scale | N workers + 1 reducer |
| **Conditional** | Decision-based flows | 2+ workers + orchestrator |
| **Retry** | Unreliable operations | 1 worker + orchestrator |
| **Deep flow** | Research/complex analysis | 5+ specialized agents |

## Subagent Communication

When spawning subagents, ensure they:
1. **Register** with unique agent_id
2. **Subscribe** to relevant channels
3. **Poll for tasks** via bus_orchestrate list_tasks
4. **Accept tasks** before execution
5. **Submit results** with complete data
6. **Send heartbeats** during long operations

Example subagent initialization:
```typescript
await bus_register_agent({
  agent_id: 'worker-001',
  session_id: 'session-abc',
  metadata: {role: 'build', capabilities: ['typescript', 'react']}
});

await bus_subscribe({
  agent_id: 'worker-001',
  session_id: 'session-abc', 
  channel: 'orchestration'
});

const pendingTasks = await bus_orchestrate({
  command: 'list_tasks',
  status: 'assigned',
  format: 'toon'
});
```
