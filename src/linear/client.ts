import { getConfig } from '../config';
import { getStateId } from './states';
import { logger } from '../logger';
import {
  LinearTicket,
  LinearIssueResponse,
  LinearMutationResponse,
} from './types';

// Rate limiting: 100 requests per minute
const RATE_LIMIT_WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 100;
const requestTimestamps: number[] = [];

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();

  // Remove timestamps outside the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }

  // Check if we're at the limit
  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldestRequest = requestTimestamps[0];
    const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestRequest);

    if (waitTime > 0) {
      logger.debug('Rate limit reached, waiting', { waitMs: waitTime });
      await sleep(waitTime);
    }
  }

  // Record this request
  requestTimestamps.push(Date.now());
}

interface GraphQLResponse {
  errors?: Array<{ message: string }>;
}

async function graphql<T extends GraphQLResponse>(
  query: string,
  variables: Record<string, unknown>,
  operationName?: string
): Promise<T> {
  const config = getConfig();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Wait for rate limit
      await waitForRateLimit();

      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.linearApiKey,
        },
        body: JSON.stringify({ query, variables }),
      });

      // Check for HTTP errors that should trigger retry
      if (response.status >= 500 || response.status === 429) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as T;

      // Check for rate limit errors in response
      if (data.errors?.some((e) => e.message.toLowerCase().includes('rate limit'))) {
        throw new Error('Rate limit exceeded');
      }

      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn('Linear API request failed, retrying', {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          delayMs,
          error: lastError.message,
          operation: operationName,
        });
        await sleep(delayMs);
      }
    }
  }

  logger.error('Linear API request failed after all retries', {
    operation: operationName,
    error: lastError?.message,
  });
  throw lastError;
}

export async function fetchTicket(ticketId: string): Promise<LinearTicket> {
  const data = await graphql<LinearIssueResponse>(
    `
      query GetIssue($id: String!) {
        issue(id: $id) {
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
    `,
    { id: ticketId },
    'GetIssue'
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.issue) {
    throw new Error(`Ticket ${ticketId} not found`);
  }

  return data.data.issue;
}

export async function updateTicketStatus(ticket: LinearTicket, stateName: string): Promise<void> {
  const stateId = await getStateId(ticket.team.id, stateName);

  const data = await graphql<LinearMutationResponse>(
    `
      mutation UpdateIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }
    `,
    { id: ticket.identifier, stateId },
    'UpdateIssue'
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.issueUpdate?.success) {
    throw new Error(`Failed to update ${ticket.identifier} to ${stateName}`);
  }
}

export async function addComment(ticket: LinearTicket, body: string): Promise<void> {
  const data = await graphql<LinearMutationResponse>(
    `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `,
    { issueId: ticket.id, body },
    'CreateComment'
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.commentCreate?.success) {
    throw new Error(`Failed to add comment to ${ticket.identifier}`);
  }
}

export async function createLabel(teamId: string, name: string, color: string): Promise<string> {
  const data = await graphql<LinearMutationResponse>(
    `
      mutation CreateLabel($teamId: String!, $name: String!, $color: String!) {
        issueLabelCreate(input: { teamId: $teamId, name: $name, color: $color }) {
          success
          issueLabel {
            id
          }
        }
      }
    `,
    { teamId, name, color },
    'CreateLabel'
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.issueLabelCreate?.success || !data.data.issueLabelCreate.issueLabel) {
    throw new Error(`Failed to create label ${name}`);
  }

  return data.data.issueLabelCreate.issueLabel.id;
}
