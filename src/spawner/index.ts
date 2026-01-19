import { spawn, execSync } from 'child_process';
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

const STUCK_THRESHOLD_MS = parseInt(process.env.AGENT_STUCK_THRESHOLD_MS || '600000', 10); // 10 min default

interface ActiveAgent {
  ticket: LinearTicket;
  tenant: TenantConfig;
  startedAt: Date;
  branchName: string;
  notifiedStuck: boolean;
}

class Spawner {
  private activeAgents: Map<string, ActiveAgent> = new Map();
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  getActiveCount(tenantId?: string): number {
    if (!tenantId) {
      return this.activeAgents.size;
    }
    return Array.from(this.activeAgents.values()).filter(
      (a) => a.tenant.linearTeamId === tenantId
    ).length;
  }

  canSpawnForTenant(tenant: TenantConfig): boolean {
    return this.getActiveCount(tenant.linearTeamId) < tenant.maxConcurrentAgents;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('Spawner started');
    this.pollInterval = setInterval(() => this.processQueue(), 2000);
    this.healthCheckInterval = setInterval(() => this.checkStuckAgents(), 60000);
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
    console.log('Spawner stopped');
  }

  async waitForActiveAgents(): Promise<void> {
    while (this.activeAgents.size > 0) {
      console.log(`Waiting for ${this.activeAgents.size} active agent(s) to finish...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  private async checkStuckAgents(): Promise<void> {
    const now = Date.now();

    for (const [ticketId, agent] of this.activeAgents) {
      const runningFor = now - agent.startedAt.getTime();

      if (runningFor > STUCK_THRESHOLD_MS && !agent.notifiedStuck) {
        console.warn(`Agent for ${ticketId} appears stuck (running for ${Math.round(runningFor / 60000)}m)`);

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
    const branchName = ticket.identifier.toLowerCase();
    const startTime = Date.now();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Spawning agent for ${ticket.identifier}: ${ticket.title}`);
    console.log(`Tenant: ${tenant.name} | Branch: ${branchName}`);
    console.log(`${'='.repeat(60)}\n`);

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

      const success = await this.runClaudeCode(prompt, tenant.repoPath);
      const duration = Date.now() - startTime;

      if (success) {
        await this.handleSuccess(ticket, tenant, branchName, duration);
      } else {
        await this.handleFailure(ticket, tenant, item, branchName, 'Claude Code exited with errors');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.handleFailure(ticket, tenant, item, branchName, message);
    } finally {
      this.activeAgents.delete(ticket.identifier);
    }
  }

  private runClaudeCode(prompt: string, repoPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const claude = spawn('claude', ['-p', '--dangerously-skip-permissions', prompt], {
        cwd: repoPath,
        stdio: ['inherit', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      claude.stdout?.on('data', (data: Buffer) => {
        process.stdout.write(data);
      });

      claude.stderr?.on('data', (data: Buffer) => {
        process.stderr.write(data);
      });

      claude.on('close', (code) => {
        resolve(code === 0);
      });

      claude.on('error', (err) => {
        console.error('Failed to spawn Claude Code:', err.message);
        resolve(false);
      });
    });
  }

  private async handleSuccess(
    ticket: LinearTicket,
    tenant: TenantConfig,
    branchName: string,
    duration: number
  ): Promise<void> {
    console.log(`\n✓ Agent completed ${ticket.identifier} successfully`);

    try {
      // Push branch and create PR
      const prUrl = await this.createPullRequest(tenant, branchName, ticket);

      if (prUrl) {
        // Notify: PR created
        await notify(createPrCreatedEvent(ticket, tenant, branchName, prUrl));

        // Add comment to Linear ticket with PR link
        await addComment(ticket, `✅ Implementation complete!\n\nPR: ${prUrl}`);

        // Move to In Review
        await updateTicketStatus(ticket, 'In Review');
        console.log(`✓ Created PR and moved ${ticket.identifier} to In Review`);
      } else {
        // No PR created (maybe no changes), just mark as done
        await updateTicketStatus(ticket, 'Done');
        console.log(`✓ Marked ${ticket.identifier} as Done (no PR needed)`);
      }

      // Notify: agent completed
      await notify(createAgentCompletedEvent(ticket, tenant, branchName, duration));

      // Update memory with success
      updateMemory(tenant.repoPath, {
        learnings: [`Completed ${ticket.identifier}: ${ticket.title}`],
      });
    } catch (error) {
      console.error(`Error in post-success handling: ${error}`);
      await updateTicketStatus(ticket, 'Done');
    }
  }

  private async handleFailure(
    ticket: LinearTicket,
    tenant: TenantConfig,
    item: QueuedTicket,
    branchName: string,
    errorMessage: string
  ): Promise<void> {
    console.log(`\n✗ Agent failed for ${ticket.identifier}: ${errorMessage}`);

    try {
      // Clean up any partial branch
      try {
        execSync('git checkout main && git branch -D ' + branchName, {
          cwd: tenant.repoPath,
          stdio: 'pipe',
        });
      } catch {
        // Ignore cleanup errors
      }

      // Notify: agent failed
      await notify(createAgentFailedEvent(
        ticket,
        tenant,
        branchName,
        errorMessage,
        item.attempts + 1,
        3
      ));

      // Add comment with error
      await addComment(
        ticket,
        `❌ Autopilot failed (attempt ${item.attempts + 1}/3)\n\nError: ${errorMessage}`
      );

      // Move back to Backlog
      await updateTicketStatus(ticket, 'Backlog');

      // Update memory with error
      updateMemory(tenant.repoPath, {
        errors: [errorMessage],
      });

      // Requeue for retry
      ticketQueue.requeue(item);
    } catch (error) {
      console.error(`Error in failure handling: ${error}`);
    }
  }

  private async createPullRequest(
    tenant: TenantConfig,
    branchName: string,
    ticket: LinearTicket
  ): Promise<string | null> {
    try {
      // Check if there are commits on the branch
      const diffResult = execSync(`git log main..${branchName} --oneline`, {
        cwd: tenant.repoPath,
        encoding: 'utf-8',
      }).trim();

      if (!diffResult) {
        console.log('No commits on branch, skipping PR creation');
        return null;
      }

      // Push branch to remote
      execSync(`git push -u origin ${branchName}`, {
        cwd: tenant.repoPath,
        stdio: 'pipe',
      });

      // Create PR using gh CLI
      const prBody = `## ${ticket.title}

${ticket.description || 'No description provided.'}

---
Linear: ${ticket.identifier}
🤖 Generated by Linear Autopilot`;

      const prResult = execSync(
        `gh pr create --repo ${tenant.githubRepo} --title "${ticket.identifier}: ${ticket.title}" --body "${prBody.replace(/"/g, '\\"')}" --head ${branchName} --base main`,
        {
          cwd: tenant.repoPath,
          encoding: 'utf-8',
        }
      ).trim();

      console.log(`Created PR: ${prResult}`);
      return prResult;
    } catch (error) {
      console.error(`Failed to create PR: ${error}`);
      return null;
    }
  }

  getStatus(): { active: number; queued: number; agents: string[] } {
    return {
      active: this.activeAgents.size,
      queued: ticketQueue.size(),
      agents: Array.from(this.activeAgents.keys()),
    };
  }

  getActiveAgents(): ActiveAgent[] {
    return Array.from(this.activeAgents.values());
  }
}

// Singleton instance
export const spawner = new Spawner();
