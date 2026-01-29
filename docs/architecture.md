# Architecture Overview

This document describes the system architecture of Linear Autopilot, how components interact, and the flow of data through the system.

## System Diagram

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                    Linear Autopilot                          │
                                    │                                                              │
┌─────────────┐                     │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│   Linear    │──── Webhook ───────────▶   Watcher   │───▶│    Queue    │───▶│   Spawner   │     │
│    API      │     or Polling      │  └─────────────┘    └─────────────┘    └──────┬──────┘     │
└─────────────┘                     │                                               │            │
       ▲                            │                                               ▼            │
       │                            │                                        ┌─────────────┐     │
       │ Update status              │                                        │ Claude Code │     │
       │ Add comments               │                                        │    CLI      │     │
       │                            │                                        └──────┬──────┘     │
       │                            │                                               │            │
       │                            │  ┌─────────────┐    ┌─────────────┐          │            │
       └────────────────────────────── │   Linear    │◀───│ Validation  │◀─────────┘            │
                                    │  │   Client    │    │  Pipeline   │                       │
                                    │  └─────────────┘    └─────────────┘                       │
                                    │         │                 │                               │
                                    │         ▼                 ▼                               │
                                    │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
                                    │  │    Rate     │    │   Memory    │    │    Cost     │   │
                                    │  │   Limiter   │    │   System    │    │  Tracking   │   │
                                    │  └─────────────┘    └─────────────┘    └─────────────┘   │
                                    │                                                          │
                                    │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
                                    │  │  Dashboard  │    │Notifications│    │   Logger    │   │
                                    │  │    API      │    │   System    │    │             │   │
                                    │  └─────────────┘    └─────────────┘    └─────────────┘   │
                                    │                                                          │
                                    └─────────────────────────────────────────────────────────────┘
                                                │                    │
                                                ▼                    ▼
                                    ┌─────────────────┐    ┌─────────────────┐
                                    │     GitHub      │    │  Slack/Discord  │
                                    │  (PR Creation)  │    │  Email/SMS/etc  │
                                    └─────────────────┘    └─────────────────┘
```

## Core Components

### 1. Server (`src/server/index.ts`)

The entry point that initializes all components and starts the Express server.

**Responsibilities:**

- Validates configuration (API keys, tenants)
- Initializes the spawner and watcher
- Sets up HTTP routes for webhooks, dashboard, and health checks
- Handles graceful shutdown

**Startup Sequence:**

1. Validate `LINEAR_API_KEY` exists
2. Load and validate `tenants.json`
3. Start the Spawner (agent pool manager)
4. Start the PollingWatcher (if polling mode enabled)
5. Mount Express routes
6. Listen on configured PORT

### 2. Watcher (`src/watcher/index.ts`)

Monitors Linear for tickets with the `agent-ready` label.

**Two Modes:**

| Mode    | Trigger               | Best For                             |
| ------- | --------------------- | ------------------------------------ |
| Webhook | HTTP POST from Linear | Production, real-time                |
| Polling | Timer-based API calls | Development, firewalled environments |

**Webhook Flow:**

1. Receive POST to `/webhook/linear`
2. Verify HMAC-SHA256 signature
3. Check if `agent-ready` label was added
4. Fetch full ticket details via GraphQL
5. Queue ticket for processing

### 3. Queue (`src/spawner/queue.ts`)

FIFO queue managing tickets waiting to be processed.

**Data Structure:**

```typescript
interface QueuedTicket {
  ticket: LinearTicket;
  tenant: TenantConfig;
  enqueuedAt: Date;
  attempts: number; // For retry tracking
}
```

**Operations:**

- `enqueue()` - Add ticket (prevents duplicates)
- `dequeue()` - Get next ticket
- `peek()` - View next without removing
- `requeue()` - Re-add failed ticket with incremented attempts

### 4. Spawner (`src/spawner/index.ts`)

The heart of the system - manages Claude Code agent lifecycle.

**Key Responsibilities:**

- Maintains map of active agents per tenant
- Enforces per-tenant concurrency limits
- Spawns Claude Code CLI processes
- Handles success (validation → PR) and failure (retry/notify)
- Detects stuck agents

**Agent Lifecycle:**

```
Queue → Spawn → Running → Success → Validation → PR → Done
                  │
                  └─── Failure → Notify → Requeue (if attempts < 3)
```

### 5. Linear Client (`src/linear/client.ts`)

GraphQL client for Linear API with built-in resilience.

**Features:**

- Rate limiting (100 requests/minute sliding window)
- Exponential backoff on 429/5xx errors
- Automatic retries (up to 3 attempts)
- State management (fetching/caching workflow states)

### 6. Validation Pipeline (`src/validation/index.ts`)

Runs quality checks before creating PRs.

**Steps (in order):**

1. `npm test` - Run test suite
2. `npm run lint` - Lint check (if script exists)
3. `npx tsc --noEmit` - Type check (if tsconfig.json exists)
4. Coverage check (if COVERAGE_THRESHOLD set)

**Behavior:**

- Each step has 5-minute timeout
- Failure at any step aborts pipeline
- Results included in PR description

### 7. Memory System (`src/memory/index.ts`)

Persistent learning across agent sessions.

**What It Tracks:**

- Error patterns (categorized by type)
- File modification patterns by ticket keywords
- Validation failure history
- Success/failure rates

**Storage:** `.linear-autopilot/memory.json` per repository

### 8. Notifications (`src/notifications/`)

Multi-provider notification dispatch system.

**Architecture:**

```
Event → notify() → Provider Router → [Slack, Discord, Email, SMS, ...]
                        │
                        └─ Uses tenant's configured notifications[]
```

**Supported Events:**

- agent-started, agent-completed, agent-failed
- agent-stuck, pr-created

### 9. Dashboard (`src/dashboard/`)

Real-time monitoring web interface.

**API Endpoints:**
| Endpoint | Returns |
|----------|---------|
| `/dashboard` | HTML dashboard |
| `/dashboard/api/status` | Queue size, agents, costs |
| `/dashboard/api/agents` | Active agent details |
| `/dashboard/api/queue` | Queued tickets |
| `/dashboard/api/costs` | Cost records |

### 10. Cost Tracking (`src/tracking/index.ts`)

Estimates and records API costs per ticket.

**How It Works:**

1. Parses Claude Code output for token counts
2. Applies pricing: $3/1M input, $15/1M output
3. Stores in `.linear-autopilot/costs.json`
4. Aggregates for dashboard display

### 11. Logger (`src/logger/index.ts`)

Structured JSON logging system.

**Features:**

- Multiple log levels (debug, info, warn, error)
- Context injection (ticketId, tenant, etc.)
- Dual output: stdout + optional file
- Child loggers with preset context

## Data Flow

### Happy Path: Ticket → PR

```
1. Linear webhook fires (agent-ready label added)
         ↓
2. Watcher verifies signature, fetches ticket
         ↓
3. Queue.enqueue(ticket, tenant)
         ↓
4. Spawner.processQueue() picks up ticket
         ↓
5. Check canSpawnForTenant() - respects concurrency limit
         ↓
6. Update Linear ticket → "In Progress"
         ↓
7. Send "agent-started" notification
         ↓
8. Build prompt with memory context
         ↓
9. Spawn Claude Code CLI process
         ↓
10. Claude implements changes, commits to feature branch
         ↓
11. Parse output, record token usage
         ↓
12. Run validation pipeline (test, lint, typecheck)
         ↓
13. Push branch, create PR via GitHub CLI
         ↓
14. Update Linear ticket → "In Review"
         ↓
15. Send "pr-created" notification
         ↓
16. Update memory with learnings
```

### Failure Path: Retry Logic

```
1. Agent fails (validation fails or Claude errors)
         ↓
2. Clean up feature branch
         ↓
3. Send "agent-failed" notification
         ↓
4. Add error comment to Linear ticket
         ↓
5. Update Linear ticket → "Backlog"
         ↓
6. Record failure in memory
         ↓
7. Check attempt count
         ↓
    ┌─── attempts < 3 ───┐
    ↓                    ↓
Requeue ticket      Drop ticket
(back of queue)     (log warning)
```

## Configuration

### Environment Variables

See [Configuration Guide](./configuration.md) for full details.

### Multi-Tenant Setup

Each tenant is isolated with:

- Own Linear team ID
- Own repository path
- Own concurrency limit
- Own notification config
- Own GitHub repo target

```json
{
  "tenants": [
    { "name": "team-a", "linearTeamId": "...", "repoPath": "/repos/a", ... },
    { "name": "team-b", "linearTeamId": "...", "repoPath": "/repos/b", ... }
  ]
}
```

## File Storage

Linear Autopilot creates these files in each managed repository:

```
your-repo/
└── .linear-autopilot/
    ├── memory.json    # Cross-session learning data
    └── costs.json     # Token usage and cost records
```

## Error Handling

| Component     | Strategy                                    |
| ------------- | ------------------------------------------- |
| Linear API    | Rate limit + exponential backoff            |
| Claude Code   | Capture exit code, retry on failure         |
| Validation    | Timeout after 5 min, abort on first failure |
| Notifications | Fire-and-forget, log failures               |
| Queue         | Requeue with attempt tracking               |

## Security Boundaries

- Webhook signatures verified via HMAC-SHA256
- API keys stored in environment variables only
- Agents run in repository directory (consider sandboxing)
- PR review required before merge (branch protection recommended)

See [Security Guide](../SECURITY.md) for detailed security practices.
