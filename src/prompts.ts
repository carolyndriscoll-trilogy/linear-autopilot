import { LinearTicket } from './linear';

export function buildTicketPrompt(ticket: LinearTicket, repoPath: string): string {
  const description = ticket.description || 'No description provided.';
  return `You are working on Linear ticket ${ticket.identifier}.

**Title:** ${ticket.title}

**Description:**
${description}

**Instructions:**
1. Read and understand the ticket requirements
2. Implement the changes needed to complete this ticket
3. Run the tests to verify your implementation
4. If tests fail, fix the issues and run tests again
5. Keep iterating until all tests pass
6. Once tests pass, commit your changes with a message that references ${ticket.identifier}

Work in the repository at: ${repoPath}

Begin implementing now.`;
}
