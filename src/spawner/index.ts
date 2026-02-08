import { spawn, execFileSync } from 'child_process';
import { ticketQueue, QueuedTicket } from './queue';
import { TenantConfig } from '../config/tenants';
import { LinearTicket, updateTicketStatus, addComment } from '../linear';
import { buildAutopilotPrompt } from '../prompts';
import { updateMemory } from '../memory';
import {
  notify,
  createAgentStartedEvent,
  createAgentCompletedEvent,
  createAgentFailedEvent,
  createAgentStuckEvent,
  createPrCreatedEvent,
} from '../notifications';
import { logger } from '../logger';
import { validate, formatValidationSummary } from '../validation';
import { recordUsage } from '../tracking';
import { recordCompletion } from '../dashboard';
import {
  STUCK_THRESHOLD_MS,
  AGENT_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  MAX_RETRIES,
  SPAWNER_POLL_INTERVAL_MS,
  SPAWNER_HEALTH_CHECK_INTERVAL_MS,
  SIGKILL_GRACE_MS,
} from '../constants';

function sanitizeBranchName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_/.]/g, '');
}

// Minimal environment for Claude subprocess — avoids leaking credentials
const ALLOWED_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LANG',
  'TERM',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'CLOUD_ML_REGION',
  'ANTHROPIC_MODEL',
  'GIT_AUTHOR_NAME',
  'GIT_AUTHOR_EMAIL',
  'GIT_COMMITTER_NAME',
  'GIT_COMMITTER_EMAIL',
];

function buildSubprocessEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_ENV_VARS) {
    if (process.env[key]) {
      env[key] = process.env[key] as string;
    }
  }
  // Include any explicitly allowlisted vars via config
  const extra = process.env.CLAUDE_SUBPROCESS_ENV_ALLOWLIST;
  if (extra) {
    for (const key of extra
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)) {
      if (process.env[key]) {
        env[key] = process.env[key] as string;
      }
    }
  }
  return env;
}

interface ActiveAgent {
  ticket: LinearTicket;
  tenant: TenantConfig;
  startedAt: Date;
  branchName: string;
  notifiedStuck: boolean;
}

type PrCreationResult =
  | { status: 'created'; url: string }
  | { status: 'no-commits' }
  | { status: 'failed'; error: string };

class Spawner {
  private activeAgents: Map<string, ActiveAgent> = new Map();
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  getActiveCount(tenantId?: string): number {
    if (!tenantId) {
      return this.activeAgents.size;
    }
    return Array.from(this.activeAgents.values()).filter((a) => a.tenant.linearTeamId === tenantId)
      .length;
  }

  canSpawnForTenant(tenant: TenantConfig): boolean {
    return this.getActiveCount(tenant.linearTeamId) < tenant.maxConcurrentAgents;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Spawner started');
    this.pollInterval = setInterval(() => {
      this.processQueue().catch((err) => {
        logger.error('processQueue failed', { error: String(err) });
      });
    }, SPAWNER_POLL_INTERVAL_MS);
    this.healthCheckInterval = setInterval(() => {
      this.checkStuckAgents().catch((err) => {
        logger.error('checkStuckAgents failed', { error: String(err) });
      });
    }, SPAWNER_HEALTH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info('Spawner stopped');
  }

  async waitForActiveAgents(): Promise<void> {
    while (this.activeAgents.size > 0) {
      logger.info('Waiting for active agents to finish', { count: this.activeAgents.size });
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  private async checkStuckAgents(): Promise<void> {
    const now = Date.now();

    for (const [ticketId, agent] of this.activeAgents) {
      const runningFor = now - agent.startedAt.getTime();

      if (runningFor > STUCK_THRESHOLD_MS && !agent.notifiedStuck) {
        logger.warn('Agent appears stuck', {
          ticketId,
          runningForMinutes: Math.round(runningFor / 60000),
          tenant: agent.tenant.name,
        });

        agent.notifiedStuck = true;

        const event = createAgentStuckEvent(
          agent.ticket,
          agent.tenant,
          agent.branchName,
          runningFor,
          'No progress detected'
        );
        await notify(event);
      }
    }
  }

  private async processQueue(): Promise<void> {
    if (ticketQueue.isEmpty()) return;

    const item = ticketQueue.peek();
    if (!item) return;

    if (!this.canSpawnForTenant(item.tenant)) {
      return;
    }

    const dequeued = ticketQueue.dequeue();
    if (!dequeued) return;

    await this.spawnAgent(dequeued);
  }

  private async spawnAgent(item: QueuedTicket): Promise<void> {
    const { ticket, tenant } = item;
    const branchName = sanitizeBranchName(ticket.identifier.toLowerCase());
    const startTime = Date.now();

    logger.info('Spawning agent', {
      ticketId: ticket.identifier,
      title: ticket.title,
      tenant: tenant.name,
      branchName,
    });

    this.activeAgents.set(ticket.identifier, {
      ticket,
      tenant,
      startedAt: new Date(),
      branchName,
      notifiedStuck: false,
    });

    try {
      // Update ticket to In Progress
      await updateTicketStatus(ticket, 'In Progress');

      // Notify: agent started
      await notify(createAgentStartedEvent(ticket, tenant, branchName));

      // Run Claude Code
      const prompt = buildAutopilotPrompt({
        ticket,
        repoPath: tenant.repoPath,
        branchName,
        includeMemory: true,
      });

      const result = await this.runClaudeCode(prompt, tenant.repoPath);
      const duration = Date.now() - startTime;

      // Record token usage for cost tracking
      recordUsage(tenant.repoPath, ticket.identifier, result.output, tenant.name);

      if (result.success) {
        await this.handleSuccess(ticket, tenant, item, branchName, duration);
      } else {
        const reason = result.timedOut
          ? `Claude Code timed out after ${Math.round(AGENT_TIMEOUT_MS / 60000)} minutes`
          : 'Claude Code exited with errors';
        await this.handleFailure(ticket, tenant, item, branchName, reason);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.handleFailure(ticket, tenant, item, branchName, message);
    } finally {
      this.activeAgents.delete(ticket.identifier);
    }
  }

  private runClaudeCode(
    prompt: string,
    repoPath: string
  ): Promise<{ success: boolean; output: string; timedOut?: boolean }> {
    return new Promise((resolve) => {
      const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
        cwd: repoPath,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: buildSubprocessEnv(),
      });

      let output = '';
      let resolved = false;

      claude.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        process.stdout.write(data);
      });

      claude.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        process.stderr.write(data);
      });

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          logger.error('Claude Code timed out', {
            timeoutMs: AGENT_TIMEOUT_MS,
          });
          claude.kill('SIGTERM');
          // Escalate to SIGKILL if process doesn't exit
          setTimeout(() => {
            if (!claude.killed) {
              logger.warn('Claude process did not exit after SIGTERM, sending SIGKILL');
              claude.kill('SIGKILL');
            }
          }, SIGKILL_GRACE_MS);
          resolve({ success: false, output, timedOut: true });
        }
      }, AGENT_TIMEOUT_MS);

      claude.on('close', (code) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({ success: code === 0, output });
        }
      });

      claude.on('error', (err) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          logger.error('Failed to spawn Claude Code', { error: err.message });
          resolve({ success: false, output });
        }
      });
    });
  }

  private async handleSuccess(
    ticket: LinearTicket,
    tenant: TenantConfig,
    item: QueuedTicket,
    branchName: string,
    duration: number
  ): Promise<void> {
    logger.info('Agent completed, running validation', {
      ticketId: ticket.identifier,
      tenant: tenant.name,
    });

    try {
      // Run validation before creating PR
      const validation = await validate(tenant.repoPath, tenant.validation);

      if (!validation.passed) {
        logger.warn('Validation failed', {
          ticketId: ticket.identifier,
          results: validation.results.map((r) => ({ name: r.name, passed: r.passed })),
        });
        await this.handleFailure(
          ticket,
          tenant,
          item,
          branchName,
          `Validation failed:\n${formatValidationSummary(validation)}`
        );
        return;
      }

      logger.info('Validation passed', {
        ticketId: ticket.identifier,
        duration: validation.totalDuration,
      });

      // Create PR and complete the ticket
      await this.completeTicketWithPR(ticket, tenant, branchName, duration, validation);
    } catch (error) {
      logger.error('Error in post-success handling', {
        ticketId: ticket.identifier,
        error: String(error),
      });
      await updateTicketStatus(ticket, 'Done');
    }
  }

  private async completeTicketWithPR(
    ticket: LinearTicket,
    tenant: TenantConfig,
    branchName: string,
    duration: number,
    validation: import('../validation').ValidationSummary
  ): Promise<void> {
    const prResult = await this.createPullRequest(tenant, branchName, ticket, validation);

    if (prResult.status === 'created') {
      await notify(createPrCreatedEvent(ticket, tenant, branchName, prResult.url));
      await addComment(
        ticket,
        `✅ Implementation complete!\n\nPR: ${prResult.url}\n\n${formatValidationSummary(validation)}`
      );
      await updateTicketStatus(ticket, 'In Review');
      logger.info('Created PR and moved ticket to In Review', {
        ticketId: ticket.identifier,
        prUrl: prResult.url,
      });
      recordCompletion(ticket.identifier, tenant.name, duration, prResult.url);
    } else if (prResult.status === 'no-commits') {
      await updateTicketStatus(ticket, 'Done');
      logger.info('Marked ticket as Done (no commits on branch)', { ticketId: ticket.identifier });
      recordCompletion(ticket.identifier, tenant.name, duration);
    } else {
      // PR creation failed — notify user and leave ticket for manual attention
      await addComment(
        ticket,
        `⚠️ Implementation complete but PR creation failed.\n\nBranch: \`${branchName}\`\nError: ${prResult.error}\n\nPlease create the PR manually or investigate the error.`
      );
      await notify(
        createAgentFailedEvent(
          ticket,
          tenant,
          branchName,
          `PR creation failed: ${prResult.error}`,
          1,
          1
        )
      );
      logger.error('PR creation failed, ticket needs manual attention', {
        ticketId: ticket.identifier,
        branchName,
        error: prResult.error,
      });
      // Don't record as completion since it needs attention
      return;
    }

    await notify(createAgentCompletedEvent(ticket, tenant, branchName, duration));

    // Get modified files for memory tracking
    const modifiedFiles = this.getModifiedFiles(tenant.repoPath, branchName);

    updateMemory(tenant.repoPath, {
      learnings: [`Completed ${ticket.identifier}: ${ticket.title}`],
      ticketTitle: ticket.title,
      modifiedFiles,
      validationResults: validation.results.map((r) => ({
        step: r.name,
        passed: r.passed,
        output: r.output,
      })),
      success: true,
    });
  }

  private getModifiedFiles(repoPath: string, branchName: string): string[] {
    try {
      const result = execFileSync('git', ['diff', '--name-only', `main...${branchName}`], {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: GIT_TIMEOUT_MS.local,
      });
      return result.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private async handleFailure(
    ticket: LinearTicket,
    tenant: TenantConfig,
    item: QueuedTicket,
    branchName: string,
    errorMessage: string
  ): Promise<void> {
    logger.error('Agent failed', {
      ticketId: ticket.identifier,
      error: errorMessage,
      tenant: tenant.name,
    });

    try {
      this.cleanupBranch(tenant.repoPath, branchName);

      await notify(
        createAgentFailedEvent(
          ticket,
          tenant,
          branchName,
          errorMessage,
          item.attempts + 1,
          MAX_RETRIES
        )
      );

      await addComment(
        ticket,
        `❌ Autopilot failed (attempt ${item.attempts + 1}/${MAX_RETRIES})\n\nError: ${errorMessage}`
      );

      await updateTicketStatus(ticket, 'Backlog');
      updateMemory(tenant.repoPath, {
        errors: [errorMessage],
        ticketTitle: ticket.title,
        success: false,
      });
      ticketQueue.requeue(item);
    } catch (error) {
      logger.error('Error in failure handling', {
        ticketId: ticket.identifier,
        error: String(error),
      });
    }
  }

  private cleanupBranch(repoPath: string, branchName: string): void {
    try {
      execFileSync('git', ['checkout', 'main'], {
        cwd: repoPath,
        stdio: 'pipe',
        timeout: GIT_TIMEOUT_MS.local,
      });
      execFileSync('git', ['branch', '-D', branchName], {
        cwd: repoPath,
        stdio: 'pipe',
        timeout: GIT_TIMEOUT_MS.local,
      });
    } catch {
      logger.debug('Branch cleanup skipped (branch may not exist)', { branchName });
    }
  }

  private async createPullRequest(
    tenant: TenantConfig,
    branchName: string,
    ticket: LinearTicket,
    validation?: import('../validation').ValidationSummary
  ): Promise<PrCreationResult> {
    try {
      // Check if there are commits on the branch
      const diffResult = execFileSync('git', ['log', `main..${branchName}`, '--oneline'], {
        cwd: tenant.repoPath,
        encoding: 'utf-8',
        timeout: GIT_TIMEOUT_MS.local,
      }).trim();

      if (!diffResult) {
        logger.debug('No commits on branch, skipping PR creation', { branchName });
        return { status: 'no-commits' };
      }

      // Push branch to remote
      execFileSync('git', ['push', '-u', 'origin', branchName], {
        cwd: tenant.repoPath,
        stdio: 'pipe',
        timeout: GIT_TIMEOUT_MS.push,
      });

      // Build validation section if available
      let validationSection = '';
      if (validation) {
        const checks = validation.results
          .map((r) => `- ${r.passed ? '✅' : '❌'} ${r.name}`)
          .join('\n');
        validationSection = `\n\n### Validation\n${checks}`;
      }

      // Create PR using gh CLI
      const prBody = `## ${ticket.title}

${ticket.description || 'No description provided.'}
${validationSection}

---
Linear: ${ticket.identifier}
🤖 Generated by Linear Autopilot`;

      const prResult = execFileSync(
        'gh',
        [
          'pr',
          'create',
          '--repo',
          tenant.githubRepo,
          '--title',
          `${ticket.identifier}: ${ticket.title}`,
          '--body',
          prBody,
          '--head',
          branchName,
          '--base',
          'main',
        ],
        {
          cwd: tenant.repoPath,
          encoding: 'utf-8',
          timeout: GIT_TIMEOUT_MS.ghPrCreate,
        }
      ).trim();

      logger.info('Created PR', { prUrl: prResult, branchName, ticketId: ticket.identifier });
      return { status: 'created', url: prResult };
    } catch (error) {
      const errorMessage = String(error);
      logger.error('Failed to create PR', {
        branchName,
        ticketId: ticket.identifier,
        error: errorMessage,
      });
      return { status: 'failed', error: errorMessage };
    }
  }

  getStatus(): { active: number; queued: number; agents: string[]; running: boolean } {
    return {
      active: this.activeAgents.size,
      queued: ticketQueue.size(),
      agents: Array.from(this.activeAgents.keys()),
      running: this.isRunning,
    };
  }

  getActiveAgents(): ActiveAgent[] {
    return Array.from(this.activeAgents.values());
  }
}

// Singleton instance
export const spawner = new Spawner();
