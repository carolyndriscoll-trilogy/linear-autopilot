// Dashboard HTML template
// Extracted for maintainability and XSS safety

import { formatDuration } from '../utils';

interface DashboardData {
  queueSize: number;
  activeCount: number;
  completionsCount: number;
  totalCost: number;
  uptime: string;
  agents: Array<{
    ticketId: string;
    ticketTitle: string;
    tenantName: string;
    duration: string;
  }>;
  completions: Array<{
    ticketId: string;
    tenant: string;
    duration: number;
    prUrl?: string;
    completedAt: string;
  }>;
}

// Escape HTML to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderAgentsTable(agents: DashboardData['agents']): string {
  if (agents.length === 0) {
    return '<p class="empty">No active agents</p>';
  }

  const rows = agents
    .map(
      (agent) => `
      <tr>
        <td><span class="badge badge-blue">${escapeHtml(agent.ticketId)}</span></td>
        <td>${escapeHtml(agent.ticketTitle)}</td>
        <td>${escapeHtml(agent.tenantName)}</td>
        <td>${escapeHtml(agent.duration)}</td>
      </tr>`
    )
    .join('');

  return `<table>
    <thead>
      <tr>
        <th>Ticket</th>
        <th>Title</th>
        <th>Tenant</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderCompletionsTable(completions: DashboardData['completions']): string {
  if (completions.length === 0) {
    return '<p class="empty">No recent completions</p>';
  }

  const rows = completions
    .slice()
    .reverse()
    .map(
      (c) => `
      <tr>
        <td><span class="badge badge-green">${escapeHtml(c.ticketId)}</span></td>
        <td>${escapeHtml(c.tenant)}</td>
        <td>${formatDuration(c.duration)}</td>
        <td>${c.prUrl ? `<a href="${escapeHtml(c.prUrl)}" target="_blank" rel="noopener">View PR</a>` : '-'}</td>
        <td>${new Date(c.completedAt).toLocaleString()}</td>
      </tr>`
    )
    .join('');

  return `<table>
    <thead>
      <tr>
        <th>Ticket</th>
        <th>Tenant</th>
        <th>Duration</th>
        <th>PR</th>
        <th>Completed</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function renderDashboard(data: DashboardData): string {
  return `<!DOCTYPE html>
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
        <div class="stat-value">${data.queueSize}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Active Agents</div>
        <div class="stat-value">${data.activeCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Completions</div>
        <div class="stat-value">${data.completionsCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Total Cost</div>
        <div class="stat-value cost">$${data.totalCost.toFixed(2)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Uptime</div>
        <div class="stat-value">${escapeHtml(data.uptime)}</div>
      </div>
    </div>

    <div class="section">
      <h2>Active Agents</h2>
      ${renderAgentsTable(data.agents)}
    </div>

    <div class="section">
      <h2>Recent Completions</h2>
      ${renderCompletionsTable(data.completions)}
    </div>

    <div class="footer">
      Auto-refreshes every 30 seconds
    </div>
  </div>
</body>
</html>`;
}
