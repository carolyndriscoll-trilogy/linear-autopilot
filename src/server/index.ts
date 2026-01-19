import express from 'express';
import { validateConfig } from '../config';
import { getAllTenants } from '../config/tenants';
import { createWebhookRouter, PollingWatcher } from '../watcher';
import { spawner } from '../spawner';
import { ticketQueue } from '../spawner/queue';

const PORT = parseInt(process.env.PORT || '3000', 10);
const POLLING_INTERVAL = parseInt(process.env.LINEAR_POLLING_INTERVAL_MS || '0', 10);

let pollingWatcher: PollingWatcher | null = null;
let isShuttingDown = false;

export async function startServer(): Promise<void> {
  // Validate configuration
  validateConfig();

  const tenants = getAllTenants();
  if (tenants.length === 0) {
    console.error('No tenants configured. Create a tenants.json file.');
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Linear Autopilot Server');
  console.log(`${'='.repeat(60)}`);
  console.log(`Tenants: ${tenants.map((t) => t.name).join(', ')}`);
  console.log(`Mode: ${POLLING_INTERVAL > 0 ? 'Polling' : 'Webhook'}`);
  console.log(`${'='.repeat(60)}\n`);

  const app = express();

  // Health check endpoint
  app.get('/health', (_req, res) => {
    const status = spawner.getStatus();
    res.json({
      status: isShuttingDown ? 'shutting_down' : 'healthy',
      uptime: process.uptime(),
      queue: status.queued,
      activeAgents: status.active,
      agents: status.agents,
      tenants: tenants.map((t) => ({
        name: t.name,
        teamId: t.linearTeamId,
        maxAgents: t.maxConcurrentAgents,
      })),
    });
  });

  // Webhook endpoints
  app.use('/webhook', createWebhookRouter());

  // Start the spawner
  spawner.start();

  // Start polling if configured
  if (POLLING_INTERVAL > 0) {
    pollingWatcher = new PollingWatcher(POLLING_INTERVAL);
    pollingWatcher.start();
  }

  // Start HTTP server
  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    if (POLLING_INTERVAL === 0) {
      console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/linear`);
    }
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n${signal} received, starting graceful shutdown...`);

    // Stop accepting new webhooks/polls
    if (pollingWatcher) {
      pollingWatcher.stop();
    }

    // Stop processing queue
    spawner.stop();

    // Wait for active agents to finish
    console.log('Waiting for active agents to complete...');
    await spawner.waitForActiveAgents();

    // Close HTTP server
    server.close(() => {
      console.log('HTTP server closed');
      console.log('Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit after 60 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 60000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Run if called directly
if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
