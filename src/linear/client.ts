import { getConfig } from '../config';
import { getStateId } from './states';
import {
  LinearTicket,
  LinearIssueResponse,
  LinearMutationResponse,
} from './types';

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const config = getConfig();

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': config.linearApiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  return (await response.json()) as T;
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
        }
      }
    `,
    { id: ticketId }
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.issue) {
    throw new Error(`Ticket ${ticketId} not found`);
  }

  return data.data.issue;
}

export async function updateTicketStatus(ticketId: string, stateName: string): Promise<void> {
  const stateId = await getStateId(stateName);

  const data = await graphql<LinearMutationResponse>(
    `
      mutation UpdateIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }
    `,
    { id: ticketId, stateId }
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.issueUpdate?.success) {
    throw new Error(`Failed to update ticket ${ticketId} to ${stateName}`);
  }
}

export async function addComment(ticketId: string, body: string): Promise<void> {
  const ticket = await fetchTicket(ticketId);

  const data = await graphql<LinearMutationResponse>(
    `
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `,
    { issueId: ticket.id, body }
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.commentCreate?.success) {
    throw new Error(`Failed to add comment to ${ticketId}`);
  }
}

export async function createLabel(name: string, color: string): Promise<string> {
  const config = getConfig();

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
    { teamId: config.linearTeamId, name, color }
  );

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.issueLabelCreate?.success || !data.data.issueLabelCreate.issueLabel) {
    throw new Error(`Failed to create label ${name}`);
  }

  return data.data.issueLabelCreate.issueLabel.id;
}
