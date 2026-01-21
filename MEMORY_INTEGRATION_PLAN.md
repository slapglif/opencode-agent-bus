# Memory Integration Implementation Plan

**Version:** 1.0  
**Date:** 2026-01-20  
**Status:** Planning Complete - Ready for Implementation

## Executive Summary

Transform agent-bus into memory-aware coordination platform by adding:
1. **Episodic Memory Queue** - Temporal event capture  
2. **Semantic Memory Queue** - Embedding-based understanding  
3. **Graphitti Integration** - Graph-based relationship tracking (optional)  
4. **Background Processing** - Non-blocking async workers  
5. **Memory Retrieval Tools** - 3 new MCP tools

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  Agent-Bus MCP Server                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │ MessageBus   │────────>│ Memory       │                  │
│  │ (bus.ts)     │         │ Integration  │                  │
│  └──────────────┘         │ Hook         │                  │
│        │                  └──────┬───────┘                  │
│        │                         │                           │
│        │    ┌────────────────────┴───────────────────┐      │
│        │    │                                         │      │
│        │    ▼                                         ▼      │
│  ┌─────┴─────────────┐                   ┌──────────────┐   │
│  │ Episodic Queue    │                   │ Semantic     │   │
│  │ (episodic-queue.ts│                   │ Queue        │   │
│  │                   │                   │ (semantic-   │   │
│  │ - Raw events      │                   │  queue.ts)   │   │
│  │ - Temporal        │                   │              │   │
│  │ - Full context    │                   │ - Embeddings │   │
│  └─────────┬─────────┘                   │ - Gemini API │   │
│            │                             └──────┬───────┘   │
│            │                                    │            │
│            │         ┌──────────────────────────┘            │
│            │         │                                       │
│            ▼         ▼                                       │
│  ┌─────────────────────────────────────┐                    │
│  │  Memory Storage Layer               │                    │
│  │  (memory-storage.ts)                │                    │
│  │                                     │                    │
│  │  - SQLite backend (default)         │                    │
│  │  - Abstraction for extensibility    │                    │
│  └──────────────┬──────────────────────┘                    │
│                 │                                            │
│                 ▼                                            │
│  ┌─────────────────────────────────────┐                    │
│  │  SQLite Database                    │                    │
│  │                                     │                    │
│  │  Tables:                            │                    │
│  │  - episodic_memories                │                    │
│  │  - semantic_memories                │                    │
│  │  - embeddings_cache                 │                    │
│  │  - memory_relationships (optional)  │                    │
│  └─────────────────────────────────────┘                    │
│                                                               │
│  ┌─────────────────────────────────────┐                    │
│  │  Background Workers                 │                    │
│  │  (memory-processor.ts)              │                    │
│  │                                     │                    │
│  │  - Process episodic queue (1s)      │                    │
│  │  - Process semantic queue (5s)      │                    │
│  │  - Batch embeddings (efficiency)    │                    │
│  │  - Error handling + retry           │                    │
│  └─────────────────────────────────────┘                    │
│                                                               │
│  ┌─────────────────────────────────────┐                    │
│  │  Gemini Embeddings                  │                    │
│  │  (gemini-embeddings.ts)             │                    │
│  │                                     │                    │
│  │  - @google/generative-ai SDK        │                    │
│  │  - Batch processing (10 items)      │                    │
│  │  - Rate limiting (60 req/min)       │                    │
│  │  - Cache results                    │                    │
│  └─────────────────────────────────────┘                    │
│                                                               │
│  ┌─────────────────────────────────────┐                    │
│  │  Graphitti Adapter (Optional)       │                    │
│  │  (graphitti-adapter.ts)             │                    │
│  │                                     │                    │
│  │  - Graph storage of agent comms     │                    │
│  │  - Relationship tracking            │                    │
│  │  - Only if installed                │                    │
│  └─────────────────────────────────────┘                    │
│                                                               │
│  ┌─────────────────────────────────────┐                    │
│  │  New MCP Tools                      │                    │
│  │                                     │                    │
│  │  - bus_memory_search                │                    │
│  │  - bus_memory_recall                │                    │
│  │  - bus_memory_graph_query (opt)     │                    │
│  └─────────────────────────────────────┘                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema Extensions

### New Tables

```sql
-- Episodic Memory: Raw temporal events
CREATE TABLE IF NOT EXISTS episodic_memories (
  id TEXT PRIMARY KEY,
  message_id TEXT,  -- References messages(id)
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT DEFAULT 'message',  -- message, subscribe, register, etc.
  content TEXT NOT NULL,
  context TEXT,  -- JSON: {subscriptions, agent_metadata, etc.}
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

-- Semantic Memory: Embedding-based understanding
CREATE TABLE IF NOT EXISTS semantic_memories (
  id TEXT PRIMARY KEY,
  episodic_memory_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding_vector TEXT,  -- JSON array of floats
  embedding_model TEXT DEFAULT 'embedding-001',
  tags TEXT,  -- JSON array: ["coordination", "consensus", etc.]
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (episodic_memory_id) REFERENCES episodic_memories(id)
);

-- Embedding Cache: Avoid redundant API calls
CREATE TABLE IF NOT EXISTS embeddings_cache (
  id TEXT PRIMARY KEY,
  content_hash TEXT UNIQUE NOT NULL,  -- SHA-256 of content
  embedding_vector TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT DEFAULT (datetime('now'))
);

-- Memory Relationships: Graph connections (optional - for Graphitti)
CREATE TABLE IF NOT EXISTS memory_relationships (
  id TEXT PRIMARY KEY,
  source_memory_id TEXT NOT NULL,
  target_memory_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,  -- followed_by, caused_by, related_to, etc.
  strength REAL DEFAULT 1.0,
  metadata TEXT,  -- JSON
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_memory_id) REFERENCES episodic_memories(id),
  FOREIGN KEY (target_memory_id) REFERENCES episodic_memories(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_episodic_agent ON episodic_memories(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_episodic_channel ON episodic_memories(channel, created_at);
CREATE INDEX IF NOT EXISTS idx_semantic_content ON semantic_memories(content);
CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON embeddings_cache(content_hash);
CREATE INDEX IF NOT EXISTS idx_relationships_source ON memory_relationships(source_memory_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON memory_relationships(target_memory_id);
```

## Implementation Phases

### Phase 1: Core Memory Infrastructure (Files 1-3)

**Goal:** Create foundation for memory storage without breaking existing functionality.

#### File 1: `src/memory/memory-storage.ts`
```typescript
// Abstraction layer for storage backends
export interface MemoryStorage {
  storeEpisodicMemory(memory: EpisodicMemory): Promise<void>;
  storeSemanticMemory(memory: SemanticMemory): Promise<void>;
  searchMemories(query: MemoryQuery): Promise<Memory[]>;
  getMemoryById(id: string): Promise<Memory | null>;
}

// SQLite implementation (default)
export class SQLiteMemoryStorage implements MemoryStorage { /* ... */ }
```

#### File 2: `src/memory/episodic-queue.ts`
```typescript
export class EpisodicMemoryQueue {
  private queue: EpisodicMemory[] = [];
  private isProcessing = false;
  
  async enqueue(message: BusMessage, context: AgentContext): Promise<void> {
    // Non-blocking: just add to in-memory queue
  }
  
  async processQueue(): Promise<void> {
    // Background worker: batch insert to SQLite
  }
}
```

#### File 3: `src/memory/semantic-queue.ts`
```typescript
export class SemanticMemoryQueue {
  private queue: SemanticMemoryTask[] = [];
  
  async enqueue(message: BusMessage): Promise<void> {
    // Queue for embedding generation
  }
  
  async processQueue(): Promise<void> {
    // Batch: generate embeddings, store results
  }
}
```

**Acceptance Criteria:**
- ✅ All files compile without errors
- ✅ Database schema created successfully
- ✅ Queues can enqueue without blocking
- ✅ Storage abstraction works with SQLite

**Verification:**
```bash
npm run build
npm run test -- tests/memory-storage.test.ts
```

---

### Phase 2: Gemini Embeddings Integration (File 4)

**Goal:** Add embedding generation capability with caching and rate limiting.

#### File 4: `src/embeddings/gemini-embeddings.ts`
```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiEmbeddings {
  private genAI: GoogleGenerativeAI;
  private cache: Map<string, number[]> = new Map();
  private rateLimiter: RateLimiter;
  
  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.rateLimiter = new RateLimiter(60, 60000); // 60 req/min
  }
  
  async generateBatch(texts: string[]): Promise<number[][]> {
    // Batch processing with caching
    // Check cache first, only generate for new content
    // Respect rate limits
  }
  
  async generate(text: string): Promise<number[]> {
    // Single text embedding (uses batch internally)
  }
}
```

**Dependencies to add:**
```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0"
  }
}
```

**Acceptance Criteria:**
- ✅ Gemini SDK integrated correctly
- ✅ Batch processing works (10 items at a time)
- ✅ Caching prevents redundant API calls
- ✅ Rate limiting prevents 429 errors
- ✅ Graceful fallback if API key missing

**Verification:**
```bash
# Set API key
export GEMINI_API_KEY="your-key-here"

# Run test
npm test -- tests/gemini-embeddings.test.ts
```

---

### Phase 3: Graphitti Integration (Optional) (File 5)

**Goal:** Add graph-based memory relationships if Graphitti is installed.

#### File 5: `src/memory/graphitti-adapter.ts`
```typescript
// Optional dependency - check at runtime
let Graphitti: any = null;
try {
  Graphitti = require('graphitti');
} catch {
  // Not installed - adapter will be disabled
}

export class GraphittiAdapter {
  private enabled: boolean;
  private client: any;
  
  constructor(config?: GraphittiConfig) {
    this.enabled = Graphitti !== null && config?.endpoint !== undefined;
    if (this.enabled) {
      this.client = new Graphitti.Client(config.endpoint);
    }
  }
  
  async storeRelationship(source: string, target: string, type: string) {
    if (!this.enabled) return;
    // Store agent communication graph
  }
  
  async queryGraph(query: GraphQuery): Promise<GraphNode[]> {
    if (!this.enabled) throw new Error('Graphitti not installed');
    // Query relationships
  }
}
```

**Dependencies (peerDependency):**
```json
{
  "peerDependencies": {
    "graphitti": "^1.0.0"
  },
  "peerDependenciesMeta": {
    "graphitti": {
      "optional": true
    }
  }
}
```

**Acceptance Criteria:**
- ✅ Works when Graphitti installed
- ✅ Gracefully disabled when not installed
- ✅ No hard dependency (optional)
- ✅ Graph queries return valid results

**Verification:**
```bash
# Test without Graphitti
npm test -- tests/graphitti-adapter.test.ts

# Test with Graphitti
npm install graphitti
npm test -- tests/graphitti-adapter.test.ts
```

---

### Phase 4: Background Processing Workers (File 6)

**Goal:** Non-blocking queue processing using setInterval pattern from scheduler.ts.

#### File 6: `src/workers/memory-processor.ts`
```typescript
export class MemoryProcessor {
  private episodicQueue: EpisodicMemoryQueue;
  private semanticQueue: SemanticMemoryQueue;
  private episodicInterval: NodeJS.Timeout | null = null;
  private semanticInterval: NodeJS.Timeout | null = null;
  
  start(): void {
    // Process episodic queue every 1 second (fast)
    this.episodicInterval = setInterval(() => {
      this.episodicQueue.processQueue().catch(console.error);
    }, 1000);
    
    // Process semantic queue every 5 seconds (batched)
    this.semanticInterval = setInterval(() => {
      this.semanticQueue.processQueue().catch(console.error);
    }, 5000);
  }
  
  stop(): void {
    // Graceful shutdown
    if (this.episodicInterval) clearInterval(this.episodicInterval);
    if (this.semanticInterval) clearInterval(this.semanticInterval);
  }
}
```

**Acceptance Criteria:**
- ✅ Workers start without blocking main thread
- ✅ Processes queues at correct intervals
- ✅ Error handling doesn't crash workers
- ✅ Graceful shutdown works
- ✅ Zero impact on message bus performance

**Verification:**
```bash
# Performance test: send 1000 messages, measure latency
npm test -- tests/performance.test.ts

# Expected: <10ms latency impact
```

---

### Phase 5: Memory Retrieval MCP Tools (Files 7-8)

**Goal:** Expose memory search capabilities via 3 new MCP tools.

#### File 7: `src/tools/memory-tools.ts`
```typescript
export const memoryTools: Tool[] = [
  {
    name: 'bus_memory_search',
    description: 'Search agent memories using episodic and/or semantic memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        memory_type: { 
          type: 'string', 
          enum: ['episodic', 'semantic', 'both'],
          description: 'Type of memory to search'
        },
        agent_id: { type: 'string', description: 'Filter by agent' },
        channel: { type: 'string', description: 'Filter by channel' },
        time_range: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' }
          }
        },
        limit: { type: 'number', default: 10 }
      },
      required: ['query']
    }
  },
  {
    name: 'bus_memory_recall',
    description: 'Retrieve full context for a specific memory',
    inputSchema: {
      type: 'object',
      properties: {
        memory_id: { type: 'string', description: 'Memory ID to recall' }
      },
      required: ['memory_id']
    }
  },
  {
    name: 'bus_memory_graph_query',
    description: 'Query agent communication graph (requires Graphitti)',
    inputSchema: {
      type: 'object',
      properties: {
        source_agent: { type: 'string' },
        target_agent: { type: 'string' },
        topic: { type: 'string' },
        relationship_type: { type: 'string' }
      }
    }
  }
];

export async function handleMemorySearch(args: any): Promise<MemorySearchResult[]> {
  // Implementation
}

export async function handleMemoryRecall(args: any): Promise<MemoryContext> {
  // Implementation
}

export async function handleMemoryGraphQuery(args: any): Promise<GraphQueryResult[]> {
  // Implementation (requires Graphitti)
}
```

#### File 8: Update `src/mcp-server/index.ts`
```typescript
// Add imports
import { memoryTools, handleMemorySearch, handleMemoryRecall, handleMemoryGraphQuery } from '../tools/memory-tools.js';
import { MemoryProcessor } from '../workers/memory-processor.js';

// Initialize memory system
const memoryProcessor = new MemoryProcessor(db, config);
memoryProcessor.start();

// Add memory tools to tools array
const tools: Tool[] = [
  // ... existing tools ...
  ...memoryTools
];

// Add handlers in CallToolRequestSchema
case 'bus_memory_search':
  return handleMemorySearch(args);
case 'bus_memory_recall':
  return handleMemoryRecall(args);
case 'bus_memory_graph_query':
  return handleMemoryGraphQuery(args);
```

**Acceptance Criteria:**
- ✅ All 3 tools registered in MCP server
- ✅ bus_memory_search returns relevant results
- ✅ bus_memory_recall retrieves full context
- ✅ bus_memory_graph_query works when Graphitti installed
- ✅ Graceful error when Graphitti not installed

**Verification:**
```bash
# Test memory tools
npm test -- tests/memory-tools.test.ts

# Integration test
npm test -- tests/memory-integration.test.ts
```

---

### Phase 6: Hook Memory into Message Flow (File 9)

**Goal:** Integrate memory capture into existing bus.ts without breaking anything.

#### File 9: Update `src/mcp-server/bus.ts`
```typescript
import { EpisodicMemoryQueue } from '../memory/episodic-queue.js';
import { SemanticMemoryQueue } from '../memory/semantic-queue.js';

export class MessageBus {
  private db: Database.Database;
  private episodicQueue?: EpisodicMemoryQueue;
  private semanticQueue?: SemanticMemoryQueue;
  
  constructor(db: Database.Database, config?: BusConfig) {
    this.db = db;
    
    // Initialize memory queues if enabled
    if (config?.memory?.enabled) {
      this.episodicQueue = new EpisodicMemoryQueue(db, config.memory);
      this.semanticQueue = new SemanticMemoryQueue(db, config.memory);
    }
  }
  
  sendMessage(...): Message {
    // Existing implementation
    const message = /* ... create message ... */;
    
    // Memory integration hook (non-blocking)
    if (this.episodicQueue) {
      this.episodicQueue.enqueue(message, this.getAgentContext(senderAgent, senderSession))
        .catch(err => console.error('Memory queue error:', err));
    }
    if (this.semanticQueue) {
      this.semanticQueue.enqueue(message)
        .catch(err => console.error('Semantic queue error:', err));
    }
    
    return message;
  }
  
  private getAgentContext(agentId: string, sessionId: string): AgentContext {
    const agent = this.getAgent(agentId, sessionId);
    return {
      subscriptions: agent?.subscribed_channels || '[]',
      metadata: agent?.metadata || '{}'
    };
  }
}
```

**Acceptance Criteria:**
- ✅ Messages queued for memory without blocking
- ✅ Existing bus functionality unchanged
- ✅ Memory capture can be disabled via config
- ✅ Error in memory queue doesn't crash bus
- ✅ All existing tests still pass

**Verification:**
```bash
# Regression test: ensure existing functionality works
npm test -- tests/bus.test.ts

# Memory integration test
npm test -- tests/memory-integration.test.ts
```

---

### Phase 7: Configuration System (File 10)

**Goal:** Make memory integration fully configurable.

#### File 10: Update `src/mcp-server/config.ts`
```typescript
export interface AgentBusConfig {
  // ... existing config ...
  
  memory?: {
    enabled: boolean;
    episodic: {
      enabled: boolean;
      storage: 'sqlite' | 'postgres' | 'memory';
    };
    semantic: {
      enabled: boolean;
      embeddings: {
        provider: 'gemini';
        model: 'embedding-001';
        apiKey: string;
        batchSize: number;
      };
    };
    graphitti?: {
      enabled: boolean;
      endpoint: string;
    };
    privacy: {
      excludeChannels?: string[];
      requireOptIn?: boolean;
    };
  };
}
```

**Example config file:** `~/.config/opencode/agent-bus/config.json`
```json
{
  "memory": {
    "enabled": true,
    "episodic": {
      "enabled": true,
      "storage": "sqlite"
    },
    "semantic": {
      "enabled": true,
      "embeddings": {
        "provider": "gemini",
        "model": "embedding-001",
        "apiKey": "your-gemini-api-key-here",
        "batchSize": 10
      }
    },
    "privacy": {
      "excludeChannels": ["private-channel"]
    }
  }
}
```

**Acceptance Criteria:**
- ✅ Config file loaded on startup
- ✅ Memory can be enabled/disabled
- ✅ Channel exclusions work
- ✅ Graceful fallback to defaults

---

### Phase 8: Testing & Documentation (Files 11-14)

**Goal:** Comprehensive test coverage and user documentation.

#### File 11: `tests/memory-storage.test.ts`
```typescript
import { describe, it, expect } from 'node:test';
import { SQLiteMemoryStorage } from '../src/memory/memory-storage.js';

describe('MemoryStorage', () => {
  it('stores episodic memory', async () => {
    // Test implementation
  });
  
  it('stores semantic memory', async () => {
    // Test implementation
  });
  
  it('searches memories by text', async () => {
    // Test implementation
  });
});
```

#### File 12: `tests/memory-integration.test.ts`
```typescript
describe('Memory Integration', () => {
  it('captures messages to episodic queue', async () => {
    // Send message, verify it's queued
  });
  
  it('generates embeddings for semantic memory', async () => {
    // Send message, wait for processing, verify embedding stored
  });
  
  it('retrieves memories via bus_memory_search', async () => {
    // Search for previously stored message
  });
});
```

#### File 13: `MEMORY_INTEGRATION.md`
- Architecture overview
- Configuration guide
- API reference for new tools
- Usage examples
- Privacy considerations
- Performance characteristics

#### File 14: Update `README.md`
Add memory features section:
```markdown
## Memory Features (New!)

The agent-bus now includes persistent memory capabilities:

- **Episodic Memory**: Captures temporal events and context
- **Semantic Memory**: Embedding-based understanding using Gemini
- **Graph Memory**: Optional relationship tracking via Graphitti
- **Memory Search**: Query past agent communications

See [MEMORY_INTEGRATION.md](MEMORY_INTEGRATION.md) for full documentation.
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Regression tests, memory is opt-in |
| Performance degradation | Non-blocking queues, background processing |
| Gemini API rate limits | Batch processing, caching, rate limiter |
| Storage growth | Auto-cleanup after TTL, configurable retention |
| Missing API key | Graceful fallback, disable semantic memory |
| Graphitti not installed | Runtime detection, optional dependency |

## Performance Targets

- Message send latency: <10ms impact
- Episodic queue processing: <1s delay
- Semantic queue processing: <5s delay
- Embedding batch: 10 items per API call
- Database size: <100MB for 10K messages

## Dependencies to Add

```json
{
  "dependencies": {
    "@google/generative-ai": "^0.21.0"
  },
  "peerDependencies": {
    "graphitti": "^1.0.0"
  },
  "peerDependenciesMeta": {
    "graphitti": {
      "optional": true
    }
  }
}
```

## Rollout Strategy

1. **Phase 1-3**: Core infrastructure (no user impact)
2. **Phase 4**: Background workers (opt-in beta)
3. **Phase 5-6**: Memory tools + integration (alpha testing)
4. **Phase 7-8**: Configuration + docs (production ready)

## Success Criteria

- ✅ All existing tests pass
- ✅ 3 new MCP tools work correctly
- ✅ Episodic memory captures all events
- ✅ Semantic embeddings generated successfully
- ✅ Graphitti optional dependency works
- ✅ Performance impact <10ms
- ✅ Build succeeds without errors
- ✅ Documentation complete

## Next Steps

1. Review this plan
2. Get user confirmation
3. Begin Phase 1 implementation
4. Verify each phase before proceeding
