# Deployment Guide

This guide covers deploying Linear Autopilot to various environments.

## Prerequisites

- Node.js 20+
- Docker (for containerized deployments)
- Claude Code CLI installed and authenticated
- GitHub CLI (`gh`) authenticated
- Linear API key

## Local Development

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# Create tenants.json with your team configuration
cat > tenants.json << 'EOF'
{
  "tenants": [
    {
      "name": "my-team",
      "linearTeamId": "your-team-id",
      "repoPath": "/path/to/your/repo",
      "maxConcurrentAgents": 2,
      "githubRepo": "org/repo"
    }
  ]
}
EOF

# Run in development mode
npm run dev

# Or build and run
npm run build
npm start
```

## Local Docker

```bash
# Build the image
docker build -t linear-autopilot .

# Create required files
cp .env.example .env
# Edit .env with your API keys

# Create tenants.json (see example above)

# Create data directory
mkdir -p data

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Mounting Repositories

For the agent to work on your code, you need to mount the repositories into the container. Update `docker-compose.yml`:

```yaml
volumes:
  - ./tenants.json:/app/tenants.json:ro
  - ./data:/app/data
  # Add your repos:
  - /home/user/projects/my-app:/repos/my-app
  - /home/user/projects/other-app:/repos/other-app
```

Then update `tenants.json` to use the container paths:

```json
{
  "tenants": [
    {
      "name": "my-team",
      "linearTeamId": "abc123",
      "repoPath": "/repos/my-app",
      "maxConcurrentAgents": 2,
      "githubRepo": "org/my-app"
    }
  ]
}
```

## Railway

Railway provides easy Docker deployments with persistent volumes.

1. **Create a new project** on [Railway](https://railway.app)

2. **Connect your GitHub repository** or deploy from Docker

3. **Add environment variables** in the Railway dashboard:
   - `LINEAR_API_KEY`
   - `LINEAR_WEBHOOK_SECRET` (optional)
   - `GITHUB_TOKEN`
   - `PORT` (Railway sets this automatically)

4. **Add a volume** for persistent data:
   - Mount path: `/app/data`

5. **Create tenants.json** as a Railway config file or mount it

6. **Deploy**:

   ```bash
   railway up
   ```

7. **Set up webhooks** (optional):
   - Get your Railway URL
   - Create a webhook in Linear pointing to `https://your-app.railway.app/webhook/linear`

### Railway Configuration

Create a `railway.json` if you need custom settings:

```json
{
  "build": {
    "builder": "DOCKERFILE"
  },
  "deploy": {
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

## Fly.io

Fly.io provides global edge deployment with persistent volumes.

1. **Install Fly CLI**:

   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login**:

   ```bash
   fly auth login
   ```

3. **Create fly.toml**:

   ```toml
   app = "linear-autopilot"
   primary_region = "sjc"

   [build]
     dockerfile = "Dockerfile"

   [env]
     PORT = "3000"
     NODE_ENV = "production"

   [http_service]
     internal_port = 3000
     force_https = true
     auto_stop_machines = false
     auto_start_machines = true
     min_machines_running = 1

   [[services]]
     protocol = "tcp"
     internal_port = 3000

     [[services.ports]]
       port = 80
       handlers = ["http"]

     [[services.ports]]
       port = 443
       handlers = ["tls", "http"]

     [services.concurrency]
       type = "connections"
       hard_limit = 25
       soft_limit = 20

     [[services.http_checks]]
       interval = 30000
       grace_period = 10s
       method = "get"
       path = "/health"
       protocol = "http"
       timeout = 5000

   [mounts]
     source = "autopilot_data"
     destination = "/app/data"
   ```

4. **Create the app**:

   ```bash
   fly apps create linear-autopilot
   ```

5. **Create a volume**:

   ```bash
   fly volumes create autopilot_data --size 1 --region sjc
   ```

6. **Set secrets**:

   ```bash
   fly secrets set LINEAR_API_KEY=lin_api_xxx
   fly secrets set GITHUB_TOKEN=ghp_xxx
   fly secrets set LINEAR_WEBHOOK_SECRET=your_secret
   ```

7. **Deploy**:

   ```bash
   fly deploy
   ```

8. **Check status**:
   ```bash
   fly status
   fly logs
   ```

### Accessing the Dashboard

After deployment, access the dashboard at:

- Railway: `https://your-app.railway.app/dashboard`
- Fly.io: `https://linear-autopilot.fly.dev/dashboard`

## Webhooks vs Polling

Linear Autopilot supports two modes for detecting new tickets:

### Webhook Mode (Recommended)

- Real-time ticket detection
- Lower API usage
- Requires public URL

Set `LINEAR_POLLING_INTERVAL_MS=0` and configure a webhook in Linear:

- URL: `https://your-domain/webhook/linear`
- Events: Issue updates

### Polling Mode

- Works without public URL
- Higher API usage
- Configurable interval

Set `LINEAR_POLLING_INTERVAL_MS=30000` (30 seconds) in your environment.

## Health Monitoring

The `/health` endpoint returns:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "queue": 2,
  "activeAgents": 1,
  "agents": ["PROJ-123"]
}
```

Configure your monitoring service to check this endpoint.

## Troubleshooting

### Agent Not Starting

- Check Claude Code CLI is installed and authenticated
- Verify `LINEAR_API_KEY` is valid
- Check repository paths in `tenants.json`

### PR Creation Failing

- Verify `GITHUB_TOKEN` has repo permissions
- Check `gh` CLI is authenticated
- Ensure `githubRepo` in tenants.json matches the format `org/repo`

### Webhook Not Receiving Events

- Verify `LINEAR_WEBHOOK_SECRET` matches the Linear webhook config
- Check the webhook URL is publicly accessible
- Review Linear webhook delivery logs

### Logs

- Local: Check console output
- Docker: `docker-compose logs -f`
- Railway: View in dashboard or `railway logs`
- Fly.io: `fly logs`
