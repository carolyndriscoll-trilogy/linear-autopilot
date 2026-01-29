# Getting Started

This guide will help you set up Linear Autopilot to automatically implement your Linear tickets.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** ([download](https://nodejs.org/))
- **Claude Code CLI** installed and authenticated ([instructions](https://github.com/anthropics/claude-code))
- **GitHub CLI** (`gh`) authenticated ([instructions](https://cli.github.com/))
- **Linear API key** ([get one here](https://linear.app/settings/api))

### Verify Prerequisites

```bash
# Check Node.js version
node --version  # Should be 18.x or higher

# Check Claude Code CLI
claude --version

# Check GitHub CLI
gh auth status
```

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/carolyndriscoll-trilogy/linear-autopilot.git
cd linear-autopilot
npm install
```

### 2. Run the Setup Wizard

The easiest way to configure Linear Autopilot:

```bash
npm run setup
```

This interactive wizard will:

- Check that prerequisites are installed
- Create your `.env` file with API keys
- Create your `tenants.json` with team configuration

### 3. Manual Configuration (Alternative)

If you prefer manual setup:

```bash
# Copy example files
cp .env.example .env
cp tenants.example.json tenants.json

# Edit with your values
nano .env
nano tenants.json
```

## Finding Your Linear Team ID

Your Linear team ID is a UUID. Find it in one of two ways:

### From the URL

1. Go to [Linear](https://linear.app)
2. Click on your team in the sidebar
3. Look at the URL:
   ```
   https://linear.app/your-workspace/team/TEAM_ID/active
   ```
4. Copy the `TEAM_ID` (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

### From Linear Settings

1. Go to Settings → Teams
2. Click on your team
3. The ID is displayed in the team settings

## Configuration Files

### `.env` - Environment Variables

```bash
# Required
LINEAR_API_KEY=lin_api_xxxxx

# Optional but recommended
GITHUB_TOKEN=ghp_xxxxx
LINEAR_POLLING_INTERVAL_MS=30000  # Check every 30 seconds

# Optional
PORT=3000
LOG_LEVEL=info
```

### `tenants.json` - Team Configuration

```json
{
  "tenants": [
    {
      "name": "my-team",
      "linearTeamId": "your-team-uuid-here",
      "repoPath": "/absolute/path/to/your/repo",
      "maxConcurrentAgents": 2,
      "githubRepo": "your-org/your-repo",
      "notifications": []
    }
  ]
}
```

## Running

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### View the Dashboard

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard) in your browser.

## Your First Automated Ticket

1. **Create a ticket** in Linear with clear requirements
2. **Add the `agent-ready` label** to the ticket
3. **Watch the dashboard** - you'll see the ticket queued and processed
4. **Check Linear** - the ticket status will update as the agent works
5. **Review the PR** - once complete, a pull request will be created

## Webhook vs Polling Mode

Linear Autopilot can detect tickets in two ways:

### Polling Mode (Recommended for Getting Started)

- Works without a public URL
- Set `LINEAR_POLLING_INTERVAL_MS=30000` in `.env`
- Checks Linear every 30 seconds for new tickets

### Webhook Mode (Recommended for Production)

- Real-time ticket detection
- Requires a public URL
- Set up a webhook in Linear:
  1. Go to Settings → API → Webhooks
  2. Add webhook URL: `https://your-domain/webhook/linear`
  3. Copy the secret to `LINEAR_WEBHOOK_SECRET` in `.env`

## Adding Notifications

To receive Slack notifications when agents complete work:

```json
{
  "tenants": [
    {
      "name": "my-team",
      "notifications": [
        {
          "type": "slack",
          "config": {
            "webhookUrl": "https://hooks.slack.com/services/XXX/YYY/ZZZ"
          }
        }
      ]
    }
  ]
}
```

See [Configuration Guide](./configuration.md) for all notification options.

## Troubleshooting

### Agent Not Starting

- Verify Claude Code CLI is authenticated: `claude --version`
- Check `LINEAR_API_KEY` is valid
- Ensure repository paths in `tenants.json` are absolute paths

### No Tickets Being Picked Up

- Verify the `agent-ready` label exists in your Linear workspace
- Check that the ticket is in "Todo" or "Backlog" status
- Ensure `linearTeamId` matches your team's ID

### PR Creation Failing

- Verify GitHub CLI is authenticated: `gh auth status`
- Check `GITHUB_TOKEN` has `repo` permissions
- Ensure `githubRepo` format is `org/repo`

### View Logs

```bash
# Follow logs in real-time
npm run dev

# Or check the log file if configured
tail -f /path/to/logfile.json
```

## Next Steps

- [Configuration Guide](./configuration.md) - All configuration options
- [Architecture Overview](./architecture.md) - How the system works
- [Deployment Guide](./deployment.md) - Deploy to production
- [Security Guide](../SECURITY.md) - Security best practices
