import express, { Router, Request, Response } from 'express';
import { spawner } from '../spawner';
import { ticketQueue } from '../spawner/queue';
import { getAllTenants } from '../config/tenants';
import { getCostSummary, CostRecord } from '../tracking';

interface CompletionRecord {
  ticketId: string;
  tenant: string;
  completedAt: string;
  duration: number;
  prUrl?: string;
}

// In-memory storage for recent completions (for dashboard display)
const recentCompletions: CompletionRecord[] = [];
const MAX_COMPLETIONS = 50;
const startTime = Date.now();

export function recordCompletion(
  ticketId: string,
  tenant: string,
  duration: number,
  prUrl?: string
): void {
  recentCompletions.push({
    ticketId,
    tenant,
    completedAt: new Date().toISOString(),
    duration,
    prUrl,
  });

  // Keep only last N completions
  if (recentCompletions.length > MAX_COMPLETIONS) {
    recentCompletions.shift();
  }
}

export function getRecentCompletions(count: number = 20): CompletionRecord[] {
  return recentCompletions.slice(-count);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${seconds % 60}s`;
}

export function createDashboardRouter(): Router {
  const router = express.Router();

  // API endpoints
  router.get('/api/status', (_req: Request, res: Response) => {
    const status = spawner.getStatus();
    const tenants = getAllTenants();

    // Aggregate costs across all tenants
    let totalCost = 0;
    let totalTokens = { input: 0, output: 0 };

    for (const tenant of tenants) {
      const summary = getCostSummary(tenant.repoPath);
      totalCost += summary.totalCost;
      totalTokens.input += summary.totalTokens.input;
      totalTokens.output += summary.totalTokens.output;
    }

    res.json({
      queueSize: status.queued,
      activeAgents: status.active,
      recentCompletions: getRecentCompletions(20),
      uptime: formatUptime(Date.now() - startTime),
      uptimeMs: Date.now() - startTime,
      totalCost: Math.round(totalCost * 100) / 100,
      totalTokens,
    });
  });

  router.get('/api/agents', (_req: Request, res: Response) => {
    const agents = spawner.getActiveAgents();
    const now = Date.now();

    res.json(
      agents.map((agent) => ({
        ticketId: agent.ticket.identifier,
        title: agent.ticket.title,
        tenant: agent.tenant.name,
        branchName: agent.branchName,
        startTime: agent.startedAt.toISOString(),
        duration: formatDuration(now - agent.startedAt.getTime()),
        durationMs: now - agent.startedAt.getTime(),
      }))
    );
  });

  router.get('/api/costs', (_req: Request, res: Response) => {
    const tenants = getAllTenants();
    const allCosts: Array<CostRecord & { repoPath: string }> = [];

    for (const tenant of tenants) {
      const summary = getCostSummary(tenant.repoPath);
      for (const record of summary.recentRecords) {
        allCosts.push({ ...record, repoPath: tenant.repoPath });
      }
    }

    // Sort by timestamp descending
    allCosts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json(allCosts.slice(0, 100));
  });

  router.get('/api/queue', (_req: Request, res: Response) => {
    const queue = ticketQueue.getAll();
    res.json(
      queue.map((item) => ({
        ticketId: item.ticket.identifier,
        title: item.ticket.title,
        tenant: item.tenant.name,
        enqueuedAt: item.enqueuedAt.toISOString(),
        attempts: item.attempts,
      }))
    );
  });

  // HTML Dashboard
  router.get('/', (_req: Request, res: Response) => {
    const status = spawner.getStatus();
    const agents = spawner.getActiveAgents();
    const completions = getRecentCompletions(20);
    const tenants = getAllTenants();
    const now = Date.now();

    // Aggregate costs
    let totalCost = 0;
    for (const tenant of tenants) {
      const summary = getCostSummary(tenant.repoPath);
      totalCost += summary.totalCost;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="30">
  <title>Linear Autopilot Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 20px; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #f8fafc; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; }
    h1 .dot { width: 12px; height: 12px; background: #22c55e; border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat { background: #1e293b; border-radius: 12px; padding: 20px; }
    .stat-label { font-size: 12px; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px; }
    .stat-value { font-size: 32px; font-weight: bold; color: #f8fafc; }
    .stat-value.cost { color: #22c55e; }
    .section { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .section h2 { color: #f8fafc; margin-bottom: 16px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #334155; }
    th { color: #94a3b8; font-size: 12px; text-transform: uppercase; }
    tr:hover { background: #334155; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .badge-blue { background: #1d4ed8; color: #fff; }
    .badge-green { background: #166534; color: #fff; }
    .badge-yellow { background: #854d0e; color: #fff; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .empty { color: #64748b; font-style: italic; }
    .footer { text-align: center; color: #64748b; font-size: 12px; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="container">
    <h1><span class="dot"></span> Linear Autopilot</h1>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Queue Size</div>
        <div class="stat-value">${status.queued}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Active Agents</div>
        <div class="stat-value">${status.active}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Completions</div>
        <div class="stat-value">${completions.length}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Total Cost</div>
        <div class="stat-value cost">$${totalCost.toFixed(2)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Uptime</div>
        <div class="stat-value">${formatUptime(now - startTime)}</div>
      </div>
    </div>

    <div class="section">
      <h2>Active Agents</h2>
      ${agents.length === 0
        ? '<p class="empty">No active agents</p>'
        : `<table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Title</th>
              <th>Tenant</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${agents.map(agent => `
              <tr>
                <td><span class="badge badge-blue">${agent.ticket.identifier}</span></td>
                <td>${agent.ticket.title}</td>
                <td>${agent.tenant.name}</td>
                <td>${formatDuration(now - agent.startedAt.getTime())}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      }
    </div>

    <div class="section">
      <h2>Recent Completions</h2>
      ${completions.length === 0
        ? '<p class="empty">No recent completions</p>'
        : `<table>
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Tenant</th>
              <th>Duration</th>
              <th>PR</th>
              <th>Completed</th>
            </tr>
          </thead>
          <tbody>
            ${completions.slice().reverse().map(c => `
              <tr>
                <td><span class="badge badge-green">${c.ticketId}</span></td>
                <td>${c.tenant}</td>
                <td>${formatDuration(c.duration)}</td>
                <td>${c.prUrl ? `<a href="${c.prUrl}" target="_blank">View PR</a>` : '-'}</td>
                <td>${new Date(c.completedAt).toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`
      }
    </div>

    <div class="footer">
      Auto-refreshes every 30 seconds
    </div>
  </div>
</body>
</html>`;

    res.type('html').send(html);
  });

  return router;
}
