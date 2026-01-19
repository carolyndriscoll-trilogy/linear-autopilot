import { spawn } from 'child_process';
import { validateConfig, getConfig } from './config';
import { fetchTicket, updateTicketStatus } from './linear';
import { buildTicketPrompt } from './prompts';
import { logger } from './logger';

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
      logger.error('Failed to spawn Claude Code', { error: err.message });
      resolve(false);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    logger.error('Usage: npm run runner <ticket-id> [repo-path]');
    process.exit(1);
  }

  validateConfig();
  const config = getConfig();
  const ticketId = args[0];
  const repoPath = args[1] || config.defaultRepoPath;

  if (!repoPath) {
    logger.error('No repo path provided and DEFAULT_REPO_PATH not set');
    process.exit(1);
  }

  logger.info('Linear Autopilot Runner starting', { ticketId, repoPath });

  try {
    const ticket = await fetchTicket(ticketId);
    logger.info('Fetched ticket', { ticketId: ticket.identifier, title: ticket.title });

    const success = await runClaudeCode(buildTicketPrompt(ticket, repoPath), repoPath);

    if (success) {
      logger.info('Claude Code completed successfully', { ticketId });
      await updateTicketStatus(ticket, 'Done');
      logger.info('Marked ticket as Done', { ticketId: ticket.identifier });
    } else {
      logger.error('Claude Code failed', { ticketId });
    }
    process.exit(success ? 0 : 1);
  } catch (error) {
    logger.error('Runner failed', { ticketId, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

main();
