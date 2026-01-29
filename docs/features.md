# Feature Implementation Guide

This document details how each feature in Linear Autopilot is implemented, including source file locations, key functions, and technical details.

## Table of Contents

1. [Autonomous Implementation](#1-autonomous-implementation)
2. [Cross-Session Learning](#2-cross-session-learning)
3. [Multi-Tenant Support](#3-multi-tenant-support)
4. [Validation Pipeline](#4-validation-pipeline)
5. [Smart Retries](#5-smart-retries)
6. [Real-Time Dashboard](#6-real-time-dashboard)
7. [Flexible Notifications](#7-flexible-notifications)
8. [Cost Tracking](#8-cost-tracking)
9. [Rate Limiting](#9-rate-limiting)
10. [Structured Logging](#10-structured-logging)

---

## 1. Autonomous Implementation

**What it does:** Claude Code agents work on tickets end-to-end: read requirements, write code, run tests, commit changes.

### Source Files

| File                   | Purpose                    |
| ---------------------- | -------------------------- |
| `src/spawner/index.ts` | Agent lifecycle management |
| `src/prompts.ts`       | Prompt construction        |

### Key Functions

```typescript
// src/spawner/index.ts

class Spawner {
  // Spawns a Claude Code agent for a ticket
  private async spawnAgent(item: QueuedTicket): Promise<void>; // Line 126

  // Executes the Claude CLI process
  private runClaudeCode(
    prompt: string,
    repoPath: string
  ): Promise<{ success: boolean; output: string }>; // Line 186

  // Checks if tenant has capacity for more agents
  canSpawnForTenant(tenant: TenantConfig): boolean; // Line 48
}
```

### How It Works

1. **Queue Processing** (`processQueue()` at line 110)
   - Runs every 2 seconds (SPAWNER_POLL_INTERVAL_MS)
   - Checks if queue has items and tenant has capacity

2. **Agent Spawning** (`spawnAgent()` at line 126)
   - Updates ticket status to "In Progress"
   - Builds prompt with ticket details and memory context
   - Spawns Claude CLI: `claude -p --dangerously-skip-permissions <prompt>`

3. **Process Management** (`runClaudeCode()` at line 186)

   ```typescript
   const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
     cwd: repoPath,
     stdio: ['inherit', 'pipe', 'pipe'],
   });
   ```

   - Captures stdout/stderr for logging and cost parsing
   - Returns success based on exit code

4. **Completion Handling**
   - Success: Run validation → Create PR → Update ticket
   - Failure: Cleanup branch → Notify → Requeue

---

## 2. Cross-Session Learning

**What it does:** Agents remember codebase patterns, common errors, and which files to modify for similar tickets.

### Source Files

| File                  | Purpose                       |
| --------------------- | ----------------------------- |
| `src/memory/index.ts` | Memory system core            |
| `src/prompts.ts`      | Memory injection into prompts |

### Key Functions

```typescript
// src/memory/index.ts

// Load memory from disk
function getMemory(repoPath: string): RepoMemory; // Line 77

// Save memory to disk
function saveMemory(repoPath: string, memory: RepoMemory): void; // Line 104

// Update memory with session learnings
function updateMemory(repoPath: string, session: SessionLearnings): void; // Line 171

// Categorize errors by type
function categorizeError(errorMessage: string): ErrorCategory; // Line 139

// Format memory for inclusion in prompt
function formatMemoryForPrompt(memory: RepoMemory): string; // Line 294

// Suggest relevant files based on ticket title
function getRelevantFiles(memory: RepoMemory, ticketTitle: string): string[]; // Line 352
```

### Data Structures

```typescript
interface RepoMemory {
  patterns: string[]; // Learned patterns to follow
  commonErrors: string[]; // Raw error messages (legacy)
  categorizedErrors: CategorizedError[]; // Errors by category
  filePatterns: FilePattern[]; // Which files for which keywords
  validationHistory: ValidationHistory[]; // Which steps fail often
  successfulTickets: number;
  failedTickets: number;
}

type ErrorCategory =
  | 'type_error'
  | 'test_failure'
  | 'lint_error'
  | 'build_error'
  | 'runtime_error'
  | 'unknown';
```

### How It Works

1. **Storage**: `.linear-autopilot/memory.json` in each repository

2. **Learning from Sessions** (`updateMemory()`)
   - Records errors with categorization
   - Tracks modified files linked to ticket keywords
   - Records validation step failures
   - Updates success/failure counts

3. **Prompt Injection** (`formatMemoryForPrompt()`)

   ```
   **Session history:** 8/10 tickets completed successfully (80%)

   **Errors to avoid (by category):**
     type_error:
       - Property 'foo' does not exist (seen 3x)
     test_failure:
       - Expected true but got false

   **Validation steps that often fail:**
     - lint: failed 5x (common cause: unused imports...)
   ```

4. **File Suggestions** (`getRelevantFiles()`)
   - Extracts keywords from ticket title
   - Matches against previous file patterns
   - Returns list of likely-relevant files

---

## 3. Multi-Tenant Support

**What it does:** Manage multiple teams and repositories from a single instance.

### Source Files

| File                    | Purpose                      |
| ----------------------- | ---------------------------- |
| `src/config/tenants.ts` | Tenant configuration loading |
| `src/spawner/index.ts`  | Per-tenant agent management  |

### Key Functions

```typescript
// src/config/tenants.ts

function getAllTenants(): TenantConfig[]; // Line 47
function getTenantByTeamId(teamId: string): TenantConfig | undefined; // Line 51
function reloadTenants(): void; // Line 56
```

### Data Structure

```typescript
interface TenantConfig {
  name: string; // Display name
  linearTeamId: string; // Linear team UUID
  repoPath: string; // Absolute path to repository
  maxConcurrentAgents: number; // Concurrency limit
  githubRepo: string; // "org/repo" format
  notifications?: NotificationConfig[];
}
```

### How It Works

1. **Configuration** (`tenants.json`)

   ```json
   {
     "tenants": [
       {
         "name": "frontend-team",
         "linearTeamId": "abc-123",
         "repoPath": "/repos/frontend",
         "maxConcurrentAgents": 2,
         "githubRepo": "myorg/frontend"
       },
       {
         "name": "backend-team",
         "linearTeamId": "def-456",
         "repoPath": "/repos/backend",
         "maxConcurrentAgents": 3,
         "githubRepo": "myorg/backend"
       }
     ]
   }
   ```

2. **Per-Tenant Agent Tracking** (`src/spawner/index.ts`)

   ```typescript
   getActiveCount(tenantId?: string): number {
     return Array.from(this.activeAgents.values())
       .filter(a => a.tenant.linearTeamId === tenantId).length;
   }

   canSpawnForTenant(tenant: TenantConfig): boolean {
     return this.getActiveCount(tenant.linearTeamId) < tenant.maxConcurrentAgents;
   }
   ```

3. **Isolated Resources**
   - Each tenant has separate memory file
   - Each tenant has separate cost tracking
   - Notifications configured per tenant

---

## 4. Validation Pipeline

**What it does:** Automatically runs tests, linting, type checking, and coverage checks before creating PRs.

### Source Files

| File                         | Purpose                  |
| ---------------------------- | ------------------------ |
| `src/validation/index.ts`    | Validation orchestration |
| `src/validation/pipeline.ts` | Step execution           |

### Key Functions

```typescript
// src/validation/index.ts

async function validate(repoPath: string): Promise<ValidationSummary>; // Line 166

async function runTests(repoPath: string): Promise<ValidationResult>; // Line 80
async function runLint(repoPath: string): Promise<ValidationResult>; // Line 93
async function runTypeCheck(repoPath: string): Promise<ValidationResult>; // Line 106
async function checkCoverage(repoPath: string): Promise<ValidationResult>; // Line 119

function formatValidationSummary(summary: ValidationSummary): string; // Line 200
```

### Validation Steps

| Step      | Command               | Condition                        |
| --------- | --------------------- | -------------------------------- |
| Tests     | `npm test`            | Always runs                      |
| Lint      | `npm run lint`        | If script exists in package.json |
| TypeCheck | `npx tsc --noEmit`    | If tsconfig.json exists          |
| Coverage  | Parse coverage output | If COVERAGE_THRESHOLD > 0        |

### How It Works

1. **Execution** (`validate()` at line 166)

   ```typescript
   const results: ValidationResult[] = [];
   results.push(await runTests(repoPath));
   if (hasLintScript(repoPath)) results.push(await runLint(repoPath));
   if (hasTsConfig(repoPath)) results.push(await runTypeCheck(repoPath));
   if (coverageThreshold > 0) results.push(await checkCoverage(repoPath));
   ```

2. **Step Execution** (each step)
   - Runs with `CI=true` environment variable
   - 5-minute timeout (VALIDATION_TIMEOUT_MS)
   - Captures last 5000 characters of output
   - Returns: `{ name, passed, output, duration }`

3. **PR Integration**
   - Validation results included in PR body
   - Formatted as checklist: ✅ tests, ✅ lint, ❌ typecheck

---

## 5. Smart Retries

**What it does:** Failed tickets are requeued with exponential backoff (up to 3 attempts).

### Source Files

| File                   | Purpose                  |
| ---------------------- | ------------------------ |
| `src/spawner/queue.ts` | Queue with retry support |
| `src/spawner/index.ts` | Failure handling         |
| `src/constants.ts`     | Retry configuration      |

### Key Functions

```typescript
// src/spawner/queue.ts

class TicketQueue {
  requeue(item: QueuedTicket): boolean  // Line 58
}

// src/spawner/index.ts
private async handleFailure(...): Promise<void>  // Line 326
```

### Configuration

```typescript
// src/constants.ts
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;
```

### How It Works

1. **Attempt Tracking** (`QueuedTicket.attempts`)

   ```typescript
   interface QueuedTicket {
     ticket: LinearTicket;
     tenant: TenantConfig;
     enqueuedAt: Date;
     attempts: number; // Incremented on each failure
   }
   ```

2. **Requeue Logic** (`requeue()` at line 58)

   ```typescript
   requeue(item: QueuedTicket): boolean {
     item.attempts++;
     if (item.attempts >= MAX_RETRIES) {
       logger.warn('Ticket exceeded max retries', { ticketId, attempts });
       return false;
     }
     this.queue.push(item);
     return true;
   }
   ```

3. **Failure Notification**
   - Shows attempt count: "Attempt 2/3"
   - Comments on Linear ticket with error details

---

## 6. Real-Time Dashboard

**What it does:** Monitor queue, active agents, completions, and costs at a glance.

### Source Files

| File                        | Purpose                         |
| --------------------------- | ------------------------------- |
| `src/dashboard/index.ts`    | API routes and data aggregation |
| `src/dashboard/template.ts` | HTML rendering                  |

### API Endpoints

```typescript
// src/dashboard/index.ts

GET / dashboard; // HTML dashboard (line 124)
GET / dashboard / api / status; // Overall status (line 50)
GET / dashboard / api / agents; // Active agents (line 76)
GET / dashboard / api / queue; // Queued tickets (line 110)
GET / dashboard / api / costs; // Cost records (line 93)
```

### Response Formats

```typescript
// GET /dashboard/api/status
{
  "uptime": 3600,
  "queue": { "size": 2, "oldest": "2024-01-15T10:00:00Z" },
  "agents": { "active": 1, "total": 3 },
  "costs": { "totalCost": 12.50, "totalTokens": 150000 }
}

// GET /dashboard/api/agents
[
  {
    "ticketId": "PROJ-123",
    "title": "Fix login bug",
    "tenant": "frontend-team",
    "branch": "proj-123",
    "startedAt": "2024-01-15T10:30:00Z",
    "runningFor": "5m 23s"
  }
]
```

### How It Works

1. **Completion Recording** (`recordCompletion()`)
   - Stores last 50 completions in memory
   - Each record: ticketId, tenant, duration, prUrl, timestamp

2. **Cost Aggregation**
   - Sums costs across all configured tenants
   - Reads from each tenant's `.linear-autopilot/costs.json`

3. **Auto-Refresh**
   - HTML includes `<meta http-equiv="refresh" content="30">`
   - Or use API endpoints with custom polling

---

## 7. Flexible Notifications

**What it does:** Slack, Discord, Email, SMS, WhatsApp, or Google Chat alerts.

### Source Files

| File                               | Purpose                  |
| ---------------------------------- | ------------------------ |
| `src/notifications/index.ts`       | Notification dispatch    |
| `src/notifications/formatter.ts`   | Message formatting       |
| `src/notifications/providers/*.ts` | Provider implementations |

### Key Functions

```typescript
// src/notifications/index.ts

async function notify(event: NotificationEvent): Promise<void>  // Line 66

// Event factory helpers
function createAgentStartedEvent(...)   // Line 86
function createAgentCompletedEvent(...) // Line 94
function createAgentFailedEvent(...)    // Line 103
function createAgentStuckEvent(...)     // Line 120
function createPrCreatedEvent(...)      // Line 135
```

### Providers

| Provider    | File                    | Required Config                         |
| ----------- | ----------------------- | --------------------------------------- |
| Slack       | `providers/slack.ts`    | `webhookUrl`                            |
| Discord     | `providers/discord.ts`  | `webhookUrl`                            |
| Google Chat | `providers/gchat.ts`    | `webhookUrl`                            |
| Email       | `providers/email.ts`    | `provider`, `apiKey`, `to`              |
| SMS         | `providers/sms.ts`      | `accountSid`, `authToken`, `from`, `to` |
| WhatsApp    | `providers/whatsapp.ts` | `accountSid`, `authToken`, `from`, `to` |

### How It Works

1. **Event Creation**

   ```typescript
   const event = createAgentCompletedEvent(ticket, tenant, branch, duration);
   await notify(event);
   ```

2. **Dispatch** (`notify()`)

   ```typescript
   const providers = tenant.notifications || [];
   await Promise.allSettled(providers.map((config) => sendToProvider(config, event)));
   ```

3. **Formatting** (`src/notifications/formatter.ts`)
   - `formatPlain()` - Plain text
   - `formatMarkdown()` - Markdown
   - `formatSlackBlocks()` - Slack Block Kit
   - `formatDiscordEmbed()` - Discord embeds

---

## 8. Cost Tracking

**What it does:** Track token usage and estimated costs per ticket.

### Source Files

| File                    | Purpose                      |
| ----------------------- | ---------------------------- |
| `src/tracking/index.ts` | Cost calculation and storage |

### Key Functions

```typescript
// src/tracking/index.ts

function recordUsage(repoPath: string, ticketId: string, output: string, tenant?: string): void; // Line 118
function parseTokenUsage(output: string): { input: number; output: number }; // Line 66
function calculateCost(tokens: { input: number; output: number }): number; // Line 112
function getCostSummary(repoPath: string): CostSummary; // Line 180
```

### Pricing

```typescript
// Claude 3.5 Sonnet pricing
const INPUT_COST_PER_1M = 3.0; // $3.00 per 1M input tokens
const OUTPUT_COST_PER_1M = 15.0; // $15.00 per 1M output tokens
```

### How It Works

1. **Token Parsing** (`parseTokenUsage()`)
   - Tries multiple regex patterns to extract tokens from Claude output
   - Patterns: "Tokens: X input, Y output", JSON format, etc.

2. **Cost Calculation**

   ```typescript
   const cost =
     (tokens.input / 1_000_000) * INPUT_COST_PER_1M +
     (tokens.output / 1_000_000) * OUTPUT_COST_PER_1M;
   ```

3. **Storage**
   - Saved to `.linear-autopilot/costs.json`
   - Keeps last 1000 records per repository

---

## 9. Rate Limiting

**What it does:** Built-in rate limiting and retry logic for Linear API.

### Source Files

| File                   | Purpose                           |
| ---------------------- | --------------------------------- |
| `src/linear/client.ts` | GraphQL client with rate limiting |

### Key Functions

```typescript
// src/linear/client.ts

async function waitForRateLimit(): Promise<void>; // Line 13
async function graphql<T>(query: string, variables?: object, operation?: string): Promise<T>; // Line 46
```

### Configuration

```typescript
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100; // 100 requests per minute
const MAX_RETRIES = 3;
```

### How It Works

1. **Token Bucket** (`waitForRateLimit()`)

   ```typescript
   const requestTimestamps: number[] = [];

   async function waitForRateLimit() {
     const now = Date.now();
     // Remove timestamps older than window
     while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
       requestTimestamps.shift();
     }
     // Wait if at limit
     if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
       const waitTime = requestTimestamps[0] + RATE_LIMIT_WINDOW_MS - now;
       await sleep(waitTime);
     }
     requestTimestamps.push(Date.now());
   }
   ```

2. **Retry Logic** (`graphql()`)
   - Retries on HTTP 429 (rate limit) or 5xx (server error)
   - Exponential backoff: 1s, 2s, 4s
   - Logs retry attempts

---

## 10. Structured Logging

**What it does:** JSON logs with context for easy debugging and monitoring.

### Source Files

| File                  | Purpose               |
| --------------------- | --------------------- |
| `src/logger/index.ts` | Logger implementation |

### Key Classes

```typescript
// src/logger/index.ts

class Logger {
  debug(message: string, context?: object): void;
  info(message: string, context?: object): void;
  warn(message: string, context?: object): void;
  error(message: string, context?: object): void;
  child(defaultContext: object): ChildLogger; // Line 95
}
```

### Configuration

| Env Variable | Default | Description          |
| ------------ | ------- | -------------------- |
| `LOG_LEVEL`  | `info`  | Minimum level to log |
| `LOG_FILE`   | -       | Optional file path   |

### Log Format

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "message": "Spawning agent",
  "context": {
    "ticketId": "PROJ-123",
    "tenant": "frontend-team",
    "branchName": "proj-123"
  }
}
```

### How It Works

1. **Level Filtering**

   ```typescript
   const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
   if (LOG_LEVELS[level] < LOG_LEVELS[configuredLevel]) return;
   ```

2. **Output**
   - Always writes to stdout
   - Optionally writes to LOG_FILE
   - JSON format for easy parsing

3. **Child Loggers**
   ```typescript
   const ticketLogger = logger.child({ ticketId: 'PROJ-123' });
   ticketLogger.info('Processing'); // Includes ticketId automatically
   ```

---

## Summary

| Feature                   | Implementation              | Key File                     |
| ------------------------- | --------------------------- | ---------------------------- |
| Autonomous Implementation | Process spawn + lifecycle   | `src/spawner/index.ts`       |
| Cross-Session Learning    | JSON persistence + patterns | `src/memory/index.ts`        |
| Multi-Tenant Support      | Config + per-tenant limits  | `src/config/tenants.ts`      |
| Validation Pipeline       | Sequential script execution | `src/validation/index.ts`    |
| Smart Retries             | Queue re-insertion          | `src/spawner/queue.ts`       |
| Real-Time Dashboard       | Express API + HTML          | `src/dashboard/index.ts`     |
| Flexible Notifications    | Provider pattern            | `src/notifications/index.ts` |
| Cost Tracking             | Token parsing + aggregation | `src/tracking/index.ts`      |
| Rate Limiting             | Token bucket algorithm      | `src/linear/client.ts`       |
| Structured Logging        | JSON + levels + context     | `src/logger/index.ts`        |
