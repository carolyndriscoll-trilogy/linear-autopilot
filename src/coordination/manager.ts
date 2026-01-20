// src/coordination/manager.ts
// High-level coordination manager for linear-autopilot agents

import { mcpAgentMail, FileReservation } from './mcp-client';
import { LinearTicket } from '../linear/types';
import { TenantConfig } from '../config/tenants';
import { logger } from '../logger';

export interface AgentContext {
  agentName: string;
  projectKey: string;
  ticket: LinearTicket;
  tenant: TenantConfig;
  reservedPaths: string[];
}

/**
 * Generate a unique agent name for a ticket
 */
export function getAgentName(ticket: LinearTicket): string {
  return `autopilot-${ticket.identifier.toLowerCase()}`;
}

/**
 * Get the project key from a tenant (uses repo path as unique identifier)
 */
export function getProjectKey(tenant: TenantConfig): string {
  return tenant.repoPath;
}

/**
 * Coordination manager for multi-agent scenarios
 */
class CoordinationManager {
  private activeAgents = new Map<string, AgentContext>();

  /**
   * Check if coordination is available
   */
  isEnabled(): boolean {
    return mcpAgentMail.isEnabled();
  }

  /**
   * Register an agent before starting work on a ticket
   */
  async registerAgent(ticket: LinearTicket, tenant: TenantConfig): Promise<AgentContext> {
    const agentName = getAgentName(ticket);
    const projectKey = getProjectKey(tenant);

    if (!this.isEnabled()) {
      // Return a basic context even without MCP
      const ctx: AgentContext = {
        agentName,
        projectKey,
        ticket,
        tenant,
        reservedPaths: [],
      };
      this.activeAgents.set(agentName, ctx);
      return ctx;
    }

    try {
      await mcpAgentMail.registerAgent(projectKey, {
        name: agentName,
        program: 'linear-autopilot',
        model: 'claude-code',
        taskDescription: `Working on ${ticket.identifier}: ${ticket.title}`,
      });

      logger.info('Agent registered with MCP Agent Mail', {
        agentName,
        ticketId: ticket.identifier,
      });
    } catch (error) {
      logger.warn('Failed to register agent with MCP Agent Mail', {
        agentName,
        error: String(error),
      });
    }

    const ctx: AgentContext = {
      agentName,
      projectKey,
      ticket,
      tenant,
      reservedPaths: [],
    };

    this.activeAgents.set(agentName, ctx);
    return ctx;
  }

  /**
   * Check if files are available (not reserved by other agents)
   */
  async checkFilesAvailable(
    tenant: TenantConfig,
    paths: string[]
  ): Promise<{ available: boolean; conflicts: FileReservation[] }> {
    if (!this.isEnabled()) {
      return { available: true, conflicts: [] };
    }

    try {
      const conflicts = await mcpAgentMail.checkConflicts(getProjectKey(tenant), paths);
      return {
        available: conflicts.length === 0,
        conflicts,
      };
    } catch (error) {
      logger.warn('Failed to check file conflicts', { error: String(error) });
      return { available: true, conflicts: [] };
    }
  }

  /**
   * Reserve files for an agent before editing
   */
  async reserveFiles(
    ctx: AgentContext,
    paths: string[],
    reason?: string
  ): Promise<{ success: boolean; conflicts: FileReservation[] }> {
    if (!this.isEnabled()) {
      ctx.reservedPaths = paths;
      return { success: true, conflicts: [] };
    }

    try {
      const result = await mcpAgentMail.reserveFiles(ctx.projectKey, ctx.agentName, paths, {
        ttlSeconds: 3600, // 1 hour
        exclusive: true,
        reason: reason ?? `Working on ${ctx.ticket.identifier}`,
      });

      if (result.conflicts.length > 0) {
        logger.warn('File reservation conflicts detected', {
          agentName: ctx.agentName,
          conflicts: result.conflicts.map((c) => ({
            paths: c.paths,
            heldBy: c.agentName,
          })),
        });
        return { success: false, conflicts: result.conflicts };
      }

      ctx.reservedPaths = paths;
      logger.info('Files reserved', {
        agentName: ctx.agentName,
        paths,
      });

      return { success: true, conflicts: [] };
    } catch (error) {
      logger.warn('Failed to reserve files', { error: String(error) });
      ctx.reservedPaths = paths;
      return { success: true, conflicts: [] };
    }
  }

  /**
   * Reserve common project files (src directory by default)
   */
  async reserveProjectFiles(ctx: AgentContext): Promise<boolean> {
    // Reserve the entire src directory to prevent conflicts
    const paths = ['src/**/*'];

    const result = await this.reserveFiles(ctx, paths, `Implementing ${ctx.ticket.identifier}`);
    return result.success;
  }

  /**
   * Release all reservations for an agent
   */
  async releaseAgent(ctx: AgentContext): Promise<void> {
    if (!this.isEnabled()) {
      this.activeAgents.delete(ctx.agentName);
      return;
    }

    try {
      await mcpAgentMail.releaseReservations(ctx.projectKey, ctx.agentName);
      logger.info('Agent reservations released', { agentName: ctx.agentName });
    } catch (error) {
      logger.warn('Failed to release agent reservations', {
        agentName: ctx.agentName,
        error: String(error),
      });
    }

    this.activeAgents.delete(ctx.agentName);
  }

  /**
   * Notify other agents about completed work
   */
  async notifyCompletion(ctx: AgentContext, summary: string): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      await mcpAgentMail.broadcastToAgents(
        ctx.projectKey,
        ctx.agentName,
        `✅ Completed: ${ctx.ticket.identifier}`,
        `## ${ctx.ticket.title}\n\n${summary}\n\n---\n*This is an automated message from linear-autopilot*`
      );
    } catch (error) {
      logger.warn('Failed to send completion notification', { error: String(error) });
    }
  }

  /**
   * Notify other agents about a failure
   */
  async notifyFailure(ctx: AgentContext, errorMessage: string): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      await mcpAgentMail.broadcastToAgents(
        ctx.projectKey,
        ctx.agentName,
        `❌ Failed: ${ctx.ticket.identifier}`,
        `## ${ctx.ticket.title}\n\n**Error:** ${errorMessage}\n\n---\n*This is an automated message from linear-autopilot*`,
        true
      );
    } catch (error) {
      logger.warn('Failed to send failure notification', { error: String(error) });
    }
  }

  /**
   * Check inbox for messages from other agents
   */
  async checkInbox(ctx: AgentContext): Promise<string[]> {
    if (!this.isEnabled()) {
      return [];
    }

    try {
      const result = await mcpAgentMail.fetchInbox(ctx.projectKey, ctx.agentName, {
        urgentOnly: true,
        limit: 5,
      });

      return result.messages.map((m) => `From ${m.from}: ${m.subject}\n${m.body}`);
    } catch (error) {
      logger.warn('Failed to fetch inbox', { error: String(error) });
      return [];
    }
  }

  /**
   * Get all active agents for a tenant
   */
  getActiveAgentsForTenant(tenant: TenantConfig): AgentContext[] {
    const projectKey = getProjectKey(tenant);
    return Array.from(this.activeAgents.values()).filter((ctx) => ctx.projectKey === projectKey);
  }

  /**
   * Check if any agent is currently working on a tenant's repo
   */
  hasActiveAgent(tenant: TenantConfig): boolean {
    return this.getActiveAgentsForTenant(tenant).length > 0;
  }
}

// Singleton instance
export const coordination = new CoordinationManager();
