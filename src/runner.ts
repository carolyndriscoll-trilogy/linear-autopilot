import { spawn } from 'child_process';

const LINEAR_API_KEY = process.env.LINEAR_API_KEY;

interface LinearTicket {
  identifier: string;
  title: string;
  description: string | null;
}

interface LinearApiResponse {
  data?: {
    issue?: LinearTicket;
  };
  errors?: Array<{ message: string }>;
}

async function fetchLinearTicket(ticketId: string): Promise<LinearTicket> {
  if (!LINEAR_API_KEY) {
    throw new Error('LINEAR_API_KEY environment variable is required');
  }

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': LINEAR_API_KEY,
    },
    body: JSON.stringify({
      query: `
        query GetIssue($id: String!) {
          issue(id: $id) {
            identifier
            title
            description
          }
        }
      `,
      variables: { id: ticketId },
    }),
  });

  const data = (await response.json()) as LinearApiResponse;

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.issue) {
    throw new Error(`Ticket ${ticketId} not found`);
  }

  return data.data.issue;
}

function buildPrompt(ticket: LinearTicket, repoPath: string): string {
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

function runClaudeCode(prompt: string, repoPath: string): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting Claude Code in ${repoPath}`);
    console.log(`${'='.repeat(60)}\n`);

    const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
      cwd: repoPath,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let output = '';
    let errorOutput = '';

    claude.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    claude.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      errorOutput += text;
      process.stderr.write(text);
    });

    claude.on('close', (code) => {
      resolve({
        success: code === 0,
        output: output + errorOutput,
      });
    });

    claude.on('error', (err) => {
      console.error('Failed to spawn Claude Code:', err.message);
      resolve({
        success: false,
        output: err.message,
      });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: ts-node src/runner.ts <ticket-id> <repo-path>');
    console.error('Example: ts-node src/runner.ts JLS-46 /path/to/repo');
    process.exit(1);
  }

  const [ticketId, repoPath] = args;

  console.log(`\nLinear Autopilot Runner`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Ticket: ${ticketId}`);
  console.log(`Repo:   ${repoPath}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    console.log(`Fetching ticket ${ticketId} from Linear...`);
    const ticket = await fetchLinearTicket(ticketId);
    console.log(`Found: ${ticket.title}\n`);

    const prompt = buildPrompt(ticket, repoPath);

    const result = await runClaudeCode(prompt, repoPath);

    console.log(`\n${'='.repeat(60)}`);
    if (result.success) {
      console.log(`✓ SUCCESS: Claude Code completed successfully`);
    } else {
      console.log(`✗ FAILURE: Claude Code exited with errors`);
    }
    console.log(`${'='.repeat(60)}\n`);

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`\n✗ ERROR: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
