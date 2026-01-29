# Configuration Guide

This guide covers all configuration options for Linear Autopilot.

## Environment Variables

Configure these in your `.env` file or system environment.

### Required

| Variable         | Description                                            | Example         |
| ---------------- | ------------------------------------------------------ | --------------- |
| `LINEAR_API_KEY` | Linear API key for reading tickets and updating status | `lin_api_xxxxx` |

### Recommended

| Variable                     | Description                                          | Default | Example     |
| ---------------------------- | ---------------------------------------------------- | ------- | ----------- |
| `GITHUB_TOKEN`               | GitHub token for creating PRs                        | -       | `ghp_xxxxx` |
| `LINEAR_POLLING_INTERVAL_MS` | Polling interval in milliseconds (0 = webhooks only) | `0`     | `30000`     |

### Optional

| Variable                   | Description                                | Default          | Example                       |
| -------------------------- | ------------------------------------------ | ---------------- | ----------------------------- |
| `PORT`                     | HTTP server port                           | `3000`           | `8080`                        |
| `LOG_LEVEL`                | Logging level (debug, info, warn, error)   | `info`           | `debug`                       |
| `LOG_FILE`                 | Path to write logs (in addition to stdout) | -                | `/var/log/autopilot.log`      |
| `LINEAR_WEBHOOK_SECRET`    | Secret for validating Linear webhooks      | -                | `whsec_xxxxx`                 |
| `COVERAGE_THRESHOLD`       | Minimum code coverage percentage required  | `0`              | `70`                          |
| `AGENT_STUCK_THRESHOLD_MS` | Time before agent is considered stuck      | `600000`         | `900000`                      |
| `TENANTS_CONFIG_PATH`      | Custom path to tenants.json                | `./tenants.json` | `/etc/autopilot/tenants.json` |

### Example `.env` File

```bash
# Required
LINEAR_API_KEY=lin_api_AbCdEf123456

# Recommended
GITHUB_TOKEN=ghp_XyZ789AbCdEf
LINEAR_POLLING_INTERVAL_MS=30000

# Optional
PORT=3000
LOG_LEVEL=info
LOG_FILE=/var/log/linear-autopilot.log
LINEAR_WEBHOOK_SECRET=whsec_your_secret_here
COVERAGE_THRESHOLD=70
AGENT_STUCK_THRESHOLD_MS=600000
```

## Tenant Configuration

Configure teams and repositories in `tenants.json`.

### Schema

```typescript
interface TenantConfig {
  name: string; // Display name
  linearTeamId: string; // Linear team UUID
  repoPath: string; // Absolute path to repository
  maxConcurrentAgents: number; // Max parallel agents
  githubRepo: string; // "org/repo" format
  notifications?: NotificationConfig[]; // Optional notifications
}
```

### Fields

| Field                 | Required | Description                                                                                       |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `name`                | Yes      | Human-readable name for the tenant (shown in dashboard and notifications)                         |
| `linearTeamId`        | Yes      | UUID of the Linear team (see [Getting Started](./getting-started.md#finding-your-linear-team-id)) |
| `repoPath`            | Yes      | Absolute filesystem path to the repository                                                        |
| `maxConcurrentAgents` | Yes      | Maximum number of agents that can run simultaneously for this tenant                              |
| `githubRepo`          | Yes      | GitHub repository in `org/repo` or `user/repo` format                                             |
| `notifications`       | No       | Array of notification provider configurations                                                     |

### Single Tenant Example

```json
{
  "tenants": [
    {
      "name": "my-team",
      "linearTeamId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "repoPath": "/home/user/projects/my-app",
      "maxConcurrentAgents": 2,
      "githubRepo": "myorg/my-app"
    }
  ]
}
```

### Multi-Tenant Example

```json
{
  "tenants": [
    {
      "name": "frontend",
      "linearTeamId": "team-uuid-1",
      "repoPath": "/repos/frontend",
      "maxConcurrentAgents": 2,
      "githubRepo": "myorg/frontend",
      "notifications": [
        { "type": "slack", "config": { "webhookUrl": "https://hooks.slack.com/..." } }
      ]
    },
    {
      "name": "backend",
      "linearTeamId": "team-uuid-2",
      "repoPath": "/repos/backend",
      "maxConcurrentAgents": 3,
      "githubRepo": "myorg/backend",
      "notifications": [
        { "type": "discord", "config": { "webhookUrl": "https://discord.com/api/webhooks/..." } }
      ]
    },
    {
      "name": "mobile",
      "linearTeamId": "team-uuid-3",
      "repoPath": "/repos/mobile-app",
      "maxConcurrentAgents": 1,
      "githubRepo": "myorg/mobile-app"
    }
  ]
}
```

## Notifications

Configure notifications in the `notifications` array for each tenant.

### When Notifications Are Sent

| Event             | Description                                    |
| ----------------- | ---------------------------------------------- |
| `agent-started`   | Agent begins working on a ticket               |
| `agent-completed` | Agent successfully finishes and creates PR     |
| `agent-failed`    | Agent encounters an error                      |
| `agent-stuck`     | Agent hasn't made progress (exceeds threshold) |
| `pr-created`      | Pull request is created                        |

### Available Providers

#### Slack

```json
{
  "type": "slack",
  "config": {
    "webhookUrl": "https://hooks.slack.com/services/T00/B00/XXX"
  }
}
```

**Setup:** Create an [Incoming Webhook](https://api.slack.com/messaging/webhooks) in your Slack workspace.

#### Discord

```json
{
  "type": "discord",
  "config": {
    "webhookUrl": "https://discord.com/api/webhooks/123456789/abcdef"
  }
}
```

**Setup:** In Discord, go to Server Settings → Integrations → Webhooks → New Webhook.

#### Google Chat

```json
{
  "type": "gchat",
  "config": {
    "webhookUrl": "https://chat.googleapis.com/v1/spaces/XXX/messages?key=YYY&token=ZZZ"
  }
}
```

**Setup:** In Google Chat, go to Space settings → Integrations → Webhooks.

#### Email (Resend)

```json
{
  "type": "email",
  "config": {
    "provider": "resend",
    "apiKey": "re_xxxxx",
    "to": "team@example.com"
  }
}
```

**Setup:** Get an API key from [Resend](https://resend.com/).

#### Email (SendGrid)

```json
{
  "type": "email",
  "config": {
    "provider": "sendgrid",
    "apiKey": "SG.xxxxx",
    "to": "team@example.com"
  }
}
```

**Setup:** Get an API key from [SendGrid](https://sendgrid.com/).

#### SMS (Twilio)

```json
{
  "type": "sms",
  "config": {
    "accountSid": "ACxxxxx",
    "authToken": "xxxxx",
    "from": "+15551234567",
    "to": "+15559876543"
  }
}
```

**Setup:** Get credentials from [Twilio Console](https://console.twilio.com/).

#### WhatsApp (Twilio)

```json
{
  "type": "whatsapp",
  "config": {
    "accountSid": "ACxxxxx",
    "authToken": "xxxxx",
    "from": "+15551234567",
    "to": "+15559876543"
  }
}
```

**Setup:** Enable WhatsApp in your [Twilio Console](https://console.twilio.com/).

### Multiple Providers

You can configure multiple notification providers per tenant:

```json
{
  "notifications": [
    {
      "type": "slack",
      "config": { "webhookUrl": "https://hooks.slack.com/..." }
    },
    {
      "type": "email",
      "config": {
        "provider": "resend",
        "apiKey": "re_xxxxx",
        "to": "alerts@example.com"
      }
    }
  ]
}
```

## Validation Pipeline

The validation pipeline runs automatically before creating PRs.

### Steps

| Step      | Command            | Runs When                     |
| --------- | ------------------ | ----------------------------- |
| Tests     | `npm test`         | Always                        |
| Lint      | `npm run lint`     | Script exists in package.json |
| TypeCheck | `npx tsc --noEmit` | tsconfig.json exists          |
| Coverage  | Check threshold    | `COVERAGE_THRESHOLD` > 0      |

### Coverage Threshold

Set `COVERAGE_THRESHOLD` to require minimum code coverage:

```bash
# Require 70% coverage
COVERAGE_THRESHOLD=70
```

If coverage falls below the threshold, the agent will fail and the ticket will be requeued.

## Constants

These are hardcoded but can be modified in `src/constants.ts`:

| Constant                           | Value    | Description                          |
| ---------------------------------- | -------- | ------------------------------------ |
| `MAX_RETRIES`                      | `3`      | Maximum retry attempts per ticket    |
| `SPAWNER_POLL_INTERVAL_MS`         | `2000`   | How often spawner checks queue       |
| `SPAWNER_HEALTH_CHECK_INTERVAL_MS` | `60000`  | How often to check for stuck agents  |
| `STUCK_THRESHOLD_MS`               | `600000` | Time (10min) before agent is "stuck" |
| `VALIDATION_TIMEOUT_MS`            | `300000` | Timeout (5min) for validation steps  |

## File Storage

Linear Autopilot creates these files in each managed repository:

```
your-repo/
└── .linear-autopilot/
    ├── memory.json    # Cross-session learning data
    └── costs.json     # Token usage and cost records
```

Add `.linear-autopilot/` to your `.gitignore` if you don't want to commit these files.

## Linear Label

By default, Linear Autopilot looks for tickets with the `agent-ready` label.

To use a different label, modify `AGENT_READY_LABEL` in `src/watcher/index.ts`:

```typescript
const AGENT_READY_LABEL = 'agent-ready'; // Change this
```

## API Endpoints

| Endpoint                | Method | Description                                      |
| ----------------------- | ------ | ------------------------------------------------ |
| `/health`               | GET    | Health check (uptime, queue size, active agents) |
| `/webhook/linear`       | POST   | Linear webhook receiver                          |
| `/dashboard`            | GET    | HTML dashboard                                   |
| `/dashboard/api/status` | GET    | JSON status overview                             |
| `/dashboard/api/agents` | GET    | Active agent details                             |
| `/dashboard/api/queue`  | GET    | Queued tickets                                   |
| `/dashboard/api/costs`  | GET    | Cost records                                     |
