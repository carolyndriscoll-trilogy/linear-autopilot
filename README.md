# Linear Autopilot

Autonomous AI agents that implement your Linear tickets while you sleep.

![Dashboard](docs/dashboard.png)

Linear Autopilot watches your Linear board for tickets labeled `agent-ready`, spawns Claude Code agents to implement them, runs validation, creates pull requests, and notifies your team—all automatically.

## Features

- **Autonomous Implementation** — Claude Code agents work on tickets end-to-end: read requirements, write code, run tests, commit changes
- **Cross-Session Learning** — Agents remember codebase patterns, common errors, and which files to modify for similar tickets
- **Multi-Tenant Support** — Manage multiple teams and repositories from a single instance
- **Validation Pipeline** — Automatically runs tests, linting, type checking, and coverage checks before creating PRs
- **Smart Retries** — Failed tickets are requeued with exponential backoff (up to 3 attempts)
- **Real-Time Dashboard** — Monitor queue, active agents, completions, and costs at a glance
- **Flexible Notifications** — Slack, Discord, Email, SMS, WhatsApp, or Google Chat alerts
- **Cost Tracking** — Track token usage and estimated costs per ticket
- **Rate Limiting** — Built-in rate limiting and retry logic for Linear API
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

1. Add the `agent-ready` label to a Linear ticket
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

For detailed setup instructions, see the [Getting Started Guide](docs/getting-started.md).

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
