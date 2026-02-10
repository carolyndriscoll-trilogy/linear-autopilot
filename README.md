# Linear Autopilot

Autonomous AI agents that implement your Linear tickets while you sleep.

![Dashboard](docs/dashboard.png)

Linear Autopilot watches your Linear board for tickets labeled `agent-ready`, spawns Claude Code agents to implement them, runs validation, creates pull requests, and notifies your team—all automatically.

## Features

- **Autonomous Implementation** — Claude Code agents work on tickets end-to-end: read requirements, write code, run tests, commit changes
- **Cross-Session Learning** — Agents remember codebase patterns, common errors, and which files to modify for similar tickets
- **Multi-Tenant Support** — Manage multiple teams and repositories from a single instance
- **Validation Pipeline** — Automatically runs tests, linting, type checking with custom validation scripts support
- **Smart Retries** — Failed tickets are requeued with exponential backoff (up to 3 attempts), with deadletter queue for persistent failures
- **Duplicate Prevention** — Tracks processed tickets to prevent re-processing across restarts
- **Real-Time Dashboard** — Monitor queue, active agents, completions, costs, and deadletter queue
- **Health Endpoint** — `/health` returns 503 when degraded (queue backlog, spawner stopped)
- **Flexible Notifications** — Slack, Discord, Email, SMS, WhatsApp, or Google Chat alerts with retry logic
- **Cost Tracking** — Track token usage and estimated costs per ticket (configurable pricing)
- **Rate Limiting** — Built-in rate limiting and retry logic for Linear API
- **Graceful Shutdown** — Waits for active agents to complete with configurable timeout
- **Structured Logging** — JSON logs with context for easy debugging and monitoring
- **Docker Ready** — Deploy anywhere with included Dockerfile and docker-compose

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Linear    │────▶│  Autopilot  │────▶│ Claude Code │────▶│   GitHub    │
│  (webhook)  │     │  (spawner)  │     │   (agent)   │     │    (PR)     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │ Validation  │
                    │ (test/lint) │
                    └─────────────┘
```

1. Add the trigger label to a Linear ticket (default: `agent-ready`, configurable per-tenant)
2. Autopilot picks up the ticket via webhook or polling
3. A Claude Code agent implements the changes on a feature branch
4. Validation runs (tests, lint, typecheck, coverage)
5. If validation passes, a PR is created and the ticket moves to "In Review"
6. Your team gets notified via your configured channels

## Quick Start

### Prerequisites

- Node.js 18+
- [Claude Code CLI](https://github.com/anthropics/claude-code) installed and authenticated
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated
- Linear API key

### Setup

```bash
git clone https://github.com/carolyndriscoll-trilogy/linear-autopilot.git
cd linear-autopilot
npm install
npm run setup   # Interactive setup wizard
npm run dev     # Start in development mode
```

Open http://localhost:3000/dashboard to view the dashboard.

### Tenant Configuration

Create a `tenants.json` file:

```json
[
  {
    "name": "my-project",
    "linearTeamId": "TEAM_UUID",
    "repoPath": "/path/to/repo",
    "githubRepo": "owner/repo",
    "maxConcurrentAgents": 2,
    "triggerLabel": "agent-ready",
    "validation": {
      "steps": [
        { "name": "tests", "command": "npm", "args": ["test"] },
        { "name": "lint", "command": "npm", "args": ["run", "lint"] },
        { "name": "typecheck", "command": "npm", "args": ["run", "typecheck"] }
      ],
      "timeoutMs": 300000
    },
    "notifications": [
      { "type": "slack", "config": { "webhookUrl": "https://hooks.slack.com/..." } }
    ]
  }
]
```

## Documentation

| Document                                   | Description                            |
| ------------------------------------------ | -------------------------------------- |
| [Getting Started](docs/getting-started.md) | Installation and first-time setup      |
| [Configuration](docs/configuration.md)     | All configuration options              |
| [Architecture](docs/architecture.md)       | System design and component overview   |
| [Features](docs/features.md)               | How each feature is implemented        |
| [Deployment](docs/deployment.md)           | Docker, Railway, and Fly.io deployment |
| [Security](SECURITY.md)                    | Security best practices                |
| [Contributing](CONTRIBUTING.md)            | How to contribute                      |

## Project Structure

```
src/
├── config/          # Environment and tenant configuration
├── dashboard/       # Web dashboard and API
├── linear/          # Linear API client with rate limiting
├── logger/          # Structured JSON logging
├── memory/          # Cross-session learning storage
├── notifications/   # Multi-provider notification system
├── prompts/         # Agent prompt templates
├── server/          # Express server and webhooks
├── spawner/         # Agent pool and queue management
├── tracking/        # Cost and token tracking
├── validation/      # Test/lint/typecheck pipeline
└── watcher/         # Webhook and polling handlers
```

## Environment Variables

| Variable                     | Default    | Description                                 |
| ---------------------------- | ---------- | ------------------------------------------- |
| `LINEAR_API_KEY`             | (required) | Linear API key                              |
| `LINEAR_WEBHOOK_SECRET`      | (required) | Webhook signature secret                    |
| `PORT`                       | `3000`     | Server port                                 |
| `LINEAR_POLLING_INTERVAL_MS` | `0`        | Polling interval (0 = webhook mode)         |
| `AGENT_TIMEOUT_MS`           | `1800000`  | Agent timeout (30 min)                      |
| `AGENT_STUCK_THRESHOLD_MS`   | `600000`   | Stuck detection threshold (10 min)          |
| `VALIDATION_TIMEOUT_MS`      | `300000`   | Validation timeout (5 min)                  |
| `SHUTDOWN_TIMEOUT_MS`        | `60000`    | Graceful shutdown timeout (60s)             |
| `SIGKILL_GRACE_MS`           | `5000`     | SIGTERM to SIGKILL escalation (5s)          |
| `PROCESSED_RETENTION_MS`     | `86400000` | Duplicate prevention window (24h)           |
| `HEALTH_QUEUE_THRESHOLD`     | `50`       | Queue size for degraded health              |
| `COST_PER_M_INPUT_TOKENS`    | `3.00`     | Input token cost per million                |
| `COST_PER_M_OUTPUT_TOKENS`   | `15.00`    | Output token cost per million               |
| `LINEAR_STATE_CACHE_TTL_MS`  | `3600000`  | State cache TTL (1 hour)                    |
| `ALLOW_UNSIGNED_WEBHOOKS`    | `false`    | Allow webhooks without signature (dev only) |

## Development

```bash
npm run dev           # Start development server
npm test              # Run tests
npm run lint          # Run linter
npm run typecheck     # Type check
npm run setup -- --test  # Test the setup wizard
```

## License

MIT

---

Built with [Claude Code](https://github.com/anthropics/claude-code)
