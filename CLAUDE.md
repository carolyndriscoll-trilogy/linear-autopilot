# Linear Autopilot - Project Context

This file provides context for AI assistants working on this codebase.

## Overview

Linear Autopilot is an autonomous system that implements Linear tickets using Claude Code agents. When a ticket is labeled `agent-ready`, the system spawns a Claude Code process to implement the changes, runs validation, and creates a pull request.

## Architecture

```
Watcher → Queue → Spawner → Claude Code → Validation → PR
```

- **Watcher** (`src/watcher/`) - Monitors Linear for `agent-ready` labels via webhooks or polling
- **Queue** (`src/spawner/queue.ts`) - FIFO queue with retry support
- **Spawner** (`src/spawner/index.ts`) - Agent lifecycle management, respects per-tenant concurrency
- **Validation** (`src/validation/`) - Runs tests, lint, typecheck before PR creation
- **Memory** (`src/memory/`) - Persists learnings across sessions

## Key Files

| File                         | Purpose                       |
| ---------------------------- | ----------------------------- |
| `src/spawner/index.ts`       | Core agent spawning logic     |
| `src/memory/index.ts`        | Cross-session learning        |
| `src/validation/index.ts`    | Validation pipeline           |
| `src/notifications/index.ts` | Multi-provider notifications  |
| `src/linear/client.ts`       | Linear API with rate limiting |
| `src/config/tenants.ts`      | Multi-tenant configuration    |

## Code Style

- TypeScript with strict mode
- ESLint + Prettier for formatting
- Jest for testing (70% coverage minimum)
- Conventional commits (feat:, fix:, docs:, refactor:, test:, chore:)

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

## Common Tasks

### Adding a new notification provider

1. Create `src/notifications/providers/yourprovider.ts`
2. Implement `NotificationProvider` interface
3. Add to provider map in `src/notifications/index.ts`
4. Add tests in `tests/notifications/providers.test.ts`

### Adding a new validation step

1. Add function in `src/validation/index.ts`
2. Call it from `validate()` function
3. Add tests in `tests/validation/`

### Modifying the memory system

1. Update interfaces in `src/memory/index.ts`
2. Update `updateMemory()` to handle new data
3. Update `formatMemoryForPrompt()` for prompt inclusion
4. Maintain backwards compatibility with existing memory.json files

## Environment

- Node.js 18+
- Requires Claude Code CLI and GitHub CLI authenticated
- Configuration in `.env` and `tenants.json`

## Documentation

See `docs/` folder for:

- `architecture.md` - System design
- `features.md` - Feature implementations
- `configuration.md` - All config options
- `getting-started.md` - Setup guide
- `deployment.md` - Deployment instructions
