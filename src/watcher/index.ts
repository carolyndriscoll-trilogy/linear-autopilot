import { createHmac } from 'crypto';
import express, { Request, Response } from 'express';
import { getTenantByTeamId, getAllTenants } from '../config/tenants';
import { fetchTicket, graphql, LinearTicket } from '../linear';
import { ticketQueue } from '../spawner/queue';
import { logger } from '../logger';

const DEFAULT_TRIGGER_LABEL = 'agent-ready';

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
  errors?: Array<{ message: string }>;
  data?: {
    issueLabels: {
      nodes: LinearLabel[];
    };
  };
}

export function createWebhookRouter(): express.Router {
  const router = express.Router();

  router.post(
    '/linear',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;

      if (webhookSecret) {
        const signature = req.headers['linear-signature'] as string;
        if (!verifyWebhookSignature(req.body, signature, webhookSecret)) {
          logger.warn('Invalid webhook signature');
          res.status(401).json({ error: 'Invalid signature' });
          return;
        }
      }

      try {
        const payload = JSON.parse(req.body.toString()) as LinearWebhookPayload;
        await handleWebhookEvent(payload);
        res.status(200).json({ ok: true });
      } catch (error) {
        logger.error('Webhook processing error', { error: String(error) });
        res.status(500).json({ error: 'Processing failed' });
      }
    }
  );

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

  // Look up tenant early to get configurable trigger label
  const teamId = payload.data.teamId;
  const earlyTenant = teamId ? getTenantByTeamId(teamId) : undefined;
  const triggerLabel = earlyTenant?.triggerLabel || DEFAULT_TRIGGER_LABEL;

  // Check if the trigger label was just added
  const currentLabels = payload.data.labelIds || [];
  const previousLabels = payload.updatedFrom?.labelIds || [];

  const wasLabelAdded = await checkTriggerLabelAdded(currentLabels, previousLabels, triggerLabel);

  if (!wasLabelAdded) {
    return;
  }

  logger.info('Trigger label detected', { ticketId: issueId, triggerLabel });

  // Fetch full ticket details
  const ticket = await fetchTicket(issueId);

  // Resolve tenant (use early lookup or fetch from ticket's team)
  const tenant = earlyTenant || getTenantByTeamId(ticket.team.id);

  if (!tenant) {
    logger.warn('No tenant config for team, skipping', {
      teamId: ticket.team.id,
      teamName: ticket.team.name,
      ticketId: issueId,
    });
    return;
  }

  // Queue the ticket
  ticketQueue.enqueue(ticket, tenant);
}

async function checkTriggerLabelAdded(
  currentLabelIds: string[],
  previousLabelIds: string[],
  triggerLabel: string
): Promise<boolean> {
  // Find labels that are new
  const newLabelIds = currentLabelIds.filter((id) => !previousLabelIds.includes(id));

  if (newLabelIds.length === 0) return false;

  // Fetch label names to check if any matches the trigger label
  try {
    const data = await graphql<LinearLabelsResponse>(
      `
        query GetLabels($ids: [String!]!) {
          issueLabels(filter: { id: { in: $ids } }) {
            nodes {
              id
              name
            }
          }
        }
      `,
      { ids: newLabelIds },
      'GetLabels'
    );

    const labels = data.data?.issueLabels?.nodes || [];
    return labels.some((label) => label.name.toLowerCase() === triggerLabel.toLowerCase());
  } catch (error) {
    logger.error('Error fetching labels', { error: String(error) });
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
    logger.info('Polling watcher started', { intervalMs: this.intervalMs });
    this.poll(); // Initial poll
    this.pollTimer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Polling watcher stopped');
  }

  private async poll(): Promise<void> {
    const tenants = getAllTenants();

    for (const tenant of tenants) {
      try {
        await this.pollTenant(tenant.linearTeamId);
      } catch (error) {
        logger.error('Error polling team', { teamId: tenant.linearTeamId, error: String(error) });
      }
    }
  }

  private async pollTenant(teamId: string): Promise<void> {
    const tenant = getTenantByTeamId(teamId);

    if (!tenant) return;

    interface PollResponse {
      errors?: Array<{ message: string }>;
      data?: {
        team?: {
          issues: {
            nodes: LinearTicket[];
          };
        };
      };
    }

    const triggerLabel = tenant.triggerLabel || DEFAULT_TRIGGER_LABEL;

    // Fetch issues with trigger label (uses shared graphql with rate limiting & retries)
    const data = await graphql<PollResponse>(
      `
        query GetAgentReadyIssues($teamId: String!, $labelName: String!) {
          team(id: $teamId) {
            issues(
              filter: {
                labels: { name: { eq: $labelName } }
                state: { name: { in: ["Todo", "Backlog"] } }
              }
              first: 10
            ) {
              nodes {
                id
                identifier
                title
                description
                state {
                  id
                  name
                }
                team {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      { teamId, labelName: triggerLabel },
      'GetAgentReadyIssues'
    );

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
