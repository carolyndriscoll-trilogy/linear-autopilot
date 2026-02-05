import express from 'express';
import { validateConfig } from '../config';
import { getAllTenants } from '../config/tenants';
import { createWebhookRouter, PollingWatcher } from '../watcher';
import { spawner } from '../spawner';
import { logger } from '../logger';
import { createDashboardRouter } from '../dashboard';

const PORT = parseInt(process.env.PORT || '3000', 10);
const POLLING_INTERVAL = parseInt(process.env.LINEAR_POLLING_INTERVAL_MS || '0', 10);

let pollingWatcher: PollingWatcher | null = null;
let isShuttingDown = false;

export async function startServer(): Promise<void> {
  // Validate configuration
  validateConfig();

  const tenants = getAllTenants();
  if (tenants.length === 0) {
    logger.error('No tenants configured. Create a tenants.json file.');
    process.exit(1);
  }

  logger.info('Linear Autopilot Server starting', {
    tenants: tenants.map((t) => t.name),
    mode: POLLING_INTERVAL > 0 ? 'polling' : 'webhook',
    port: PORT,
  });

  if (!process.env.LINEAR_WEBHOOK_SECRET && POLLING_INTERVAL === 0) {
    if (process.env.ALLOW_UNSIGNED_WEBHOOKS === 'true') {
      logger.warn(
        'LINEAR_WEBHOOK_SECRET not set — webhook signature verification disabled. Do not use in production.'
      );
    } else {
      logger.warn(
        'LINEAR_WEBHOOK_SECRET not set — all webhooks will be rejected. Set LINEAR_WEBHOOK_SECRET or ALLOW_UNSIGNED_WEBHOOKS=true for local dev.'
      );
    }
  }

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

  // Dashboard
  app.use('/dashboard', createDashboardRouter());

  // Start the spawner
  spawner.start();

  // Start polling if configured
  if (POLLING_INTERVAL > 0) {
    pollingWatcher = new PollingWatcher(POLLING_INTERVAL);
    pollingWatcher.start();
  }

  // Start HTTP server
  const server = app.listen(PORT, () => {
    logger.info('Server listening', {
      port: PORT,
      dashboard: `http://localhost:${PORT}/dashboard`,
      healthEndpoint: `http://localhost:${PORT}/health`,
      webhookEndpoint:
        POLLING_INTERVAL === 0 ? `http://localhost:${PORT}/webhook/linear` : undefined,
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info('Graceful shutdown initiated', { signal });

    // Stop accepting new webhooks/polls
    if (pollingWatcher) {
      pollingWatcher.stop();
    }

    // Stop processing queue
    spawner.stop();

    // Wait for active agents to finish
    logger.info('Waiting for active agents to complete');
    await spawner.waitForActiveAgents();

    // Close HTTP server
    server.close(() => {
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit after 60 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 60000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Run if called directly
if (require.main === module) {
  startServer().catch((error) => {
    logger.error('Failed to start server', { error: String(error) });
    process.exit(1);
  });
}
