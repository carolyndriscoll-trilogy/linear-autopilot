import { createHmac } from 'crypto';
import express, { Request, Response } from 'express';
import { getConfig } from '../config';
import { getTenantByTeamId, getAllTenants } from '../config/tenants';
import { fetchTicket, LinearTicket } from '../linear';
import { ticketQueue } from '../spawner/queue';

const AGENT_READY_LABEL = 'agent-ready';

interface LinearWebhookPayload {
  action: string;
  type: string;
  data: {
    id: string;
    identifier?: string;
    labelIds?: string[];
    teamId?: string;
  };
  updatedFrom?: {
    labelIds?: string[];
  };
}

interface LinearLabel {
  id: string;
  name: string;
}

interface LinearLabelsResponse {
  data?: {
    issueLabels: {
      nodes: LinearLabel[];
    };
  };
}

export function createWebhookRouter(): express.Router {
  const router = express.Router();

  router.post('/linear', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
    const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;

    if (webhookSecret) {
      const signature = req.headers['linear-signature'] as string;
      if (!verifyWebhookSignature(req.body, signature, webhookSecret)) {
        console.warn('Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    try {
      const payload = JSON.parse(req.body.toString()) as LinearWebhookPayload;
      await handleWebhookEvent(payload);
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ error: 'Processing failed' });
    }
  });

  return router;
}

function verifyWebhookSignature(body: Buffer, signature: string, secret: string): boolean {
  if (!signature) return false;

  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  const expectedSignature = hmac.digest('hex');

  return signature === expectedSignature;
}

async function handleWebhookEvent(payload: LinearWebhookPayload): Promise<void> {
  // We're looking for label added events on issues
  if (payload.type !== 'Issue') return;

  const issueId = payload.data.identifier || payload.data.id;

  // Check if agent-ready label was just added
  const currentLabels = payload.data.labelIds || [];
  const previousLabels = payload.updatedFrom?.labelIds || [];

  const wasLabelAdded = await checkAgentReadyLabelAdded(currentLabels, previousLabels);

  if (!wasLabelAdded) {
    return;
  }

  console.log(`Agent-ready label detected on ${issueId}`);

  // Fetch full ticket details
  const ticket = await fetchTicket(issueId);

  // Get tenant config for this team
  const tenant = getTenantByTeamId(ticket.team.id);

  if (!tenant) {
    console.warn(`No tenant config for team ${ticket.team.id} (${ticket.team.name}), skipping ${issueId}`);
    return;
  }

  // Queue the ticket
  ticketQueue.enqueue(ticket, tenant);
}

async function checkAgentReadyLabelAdded(
  currentLabelIds: string[],
  previousLabelIds: string[]
): Promise<boolean> {
  // Find labels that are new
  const newLabelIds = currentLabelIds.filter((id) => !previousLabelIds.includes(id));

  if (newLabelIds.length === 0) return false;

  // Fetch label names to check if any is "agent-ready"
  try {
    const config = getConfig();
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': config.linearApiKey,
      },
      body: JSON.stringify({
        query: `
          query GetLabels($ids: [String!]!) {
            issueLabels(filter: { id: { in: $ids } }) {
              nodes {
                id
                name
              }
            }
          }
        `,
        variables: { ids: newLabelIds },
      }),
    });

    const data = (await response.json()) as LinearLabelsResponse;
    const labels = data.data?.issueLabels?.nodes || [];

    return labels.some((label) => label.name.toLowerCase() === AGENT_READY_LABEL);
  } catch (error) {
    console.error('Error fetching labels:', error);
    return false;
  }
}

// Polling mode for environments where webhooks aren't available
export class PollingWatcher {
  private intervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastChecked: Map<string, Date> = new Map();

  constructor(intervalMs: number = 30000) {
    this.intervalMs = intervalMs;
  }

  start(): void {
    console.log(`Polling watcher started (interval: ${this.intervalMs}ms)`);
    this.poll(); // Initial poll
    this.pollTimer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('Polling watcher stopped');
  }

  private async poll(): Promise<void> {
    const tenants = getAllTenants();

    for (const tenant of tenants) {
      try {
        await this.pollTenant(tenant.linearTeamId);
      } catch (error) {
        console.error(`Error polling team ${tenant.linearTeamId}:`, error);
      }
    }
  }

  private async pollTenant(teamId: string): Promise<void> {
    const config = getConfig();
    const tenant = getTenantByTeamId(teamId);

    if (!tenant) return;

    // Fetch issues with agent-ready label
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': config.linearApiKey,
      },
      body: JSON.stringify({
        query: `
          query GetAgentReadyIssues($teamId: String!) {
            team(id: $teamId) {
              issues(filter: {
                labels: { name: { eq: "agent-ready" } }
                state: { name: { in: ["Todo", "Backlog"] } }
              }, first: 10) {
                nodes {
                  id
                  identifier
                  title
                  description
                  state { id name }
                  team { id name }
                }
              }
            }
          }
        `,
        variables: { teamId },
      }),
    });

    interface PollResponse {
      data?: {
        team?: {
          issues: {
            nodes: LinearTicket[];
          };
        };
      };
    }

    const data = (await response.json()) as PollResponse;
    const issues = data.data?.team?.issues?.nodes || [];

    for (const issue of issues) {
      // Skip if already queued or processed recently
      const lastCheck = this.lastChecked.get(issue.identifier);
      if (lastCheck && Date.now() - lastCheck.getTime() < this.intervalMs * 2) {
        continue;
      }

      this.lastChecked.set(issue.identifier, new Date());
      ticketQueue.enqueue(issue, tenant);
    }
  }
}
