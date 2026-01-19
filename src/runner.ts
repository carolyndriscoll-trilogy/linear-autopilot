import { spawn } from 'child_process';
import { validateConfig, getConfig } from './config';
import { fetchTicket, updateTicketStatus } from './linear';
import { buildTicketPrompt } from './prompts';

function runClaudeCode(prompt: string, repoPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
      cwd: repoPath,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    claude.stdout?.on('data', (data: Buffer) => process.stdout.write(data));
    claude.stderr?.on('data', (data: Buffer) => process.stderr.write(data));
    claude.on('close', (code) => resolve(code === 0));
    claude.on('error', (err) => {
      console.error('Failed to spawn Claude Code:', err.message);
      resolve(false);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npm run runner <ticket-id> [repo-path]');
    process.exit(1);
  }

  validateConfig();
  const config = getConfig();
  const ticketId = args[0];
  const repoPath = args[1] || config.defaultRepoPath;

  if (!repoPath) {
    console.error('Error: No repo path provided and DEFAULT_REPO_PATH not set');
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Linear Autopilot | ${ticketId} | ${repoPath}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    const ticket = await fetchTicket(ticketId);
    console.log(`Ticket: ${ticket.title}\n`);

    const success = await runClaudeCode(buildTicketPrompt(ticket, repoPath), repoPath);

    console.log(`\n${'='.repeat(60)}`);
    if (success) {
      console.log(`✓ Claude Code completed`);
      await updateTicketStatus(ticket, 'Done');
      console.log(`✓ Marked ${ticket.identifier} as Done`);
    } else {
      console.log(`✗ Claude Code failed`);
    }
    console.log(`${'='.repeat(60)}\n`);
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error(`✗ ERROR: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
