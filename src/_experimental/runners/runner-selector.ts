// src/runners/runner-selector.ts
// Intelligent runner selection based on tenant config and project detection

import { LinearTicket } from '../linear/types';
import { TenantConfig } from '../config/tenants';
import { logger } from '../logger';
import { analyzeTicketComplexity, isSwarmAvailable } from './swarm-runner';
import { isRailsProject, isClaudeSwarmAvailable, getDefaultRailsConfig } from './rails-runner';

export type RunnerType = 'claude-code' | 'swarm-sdk' | 'claude-on-rails';

export interface RunnerSelection {
  runner: RunnerType;
  reason: string;
}

export interface RunnerConfig {
  // Explicit runner type (overrides auto-detection)
  runnerType?: RunnerType;
  // SwarmSDK complexity threshold (0-10)
  swarmComplexityThreshold?: number;
  // Whether to auto-detect Rails projects
  autoDetectRails?: boolean;
}

/**
 * Select the appropriate runner for a ticket
 *
 * Priority:
 * 1. Explicit tenant runnerType config
 * 2. Rails project auto-detection (if enabled)
 * 3. Complexity-based SwarmSDK routing (if enabled)
 * 4. Default to claude-code
 */
export async function selectRunner(
  ticket: LinearTicket,
  tenant: TenantConfig,
  runnerConfig?: RunnerConfig
): Promise<RunnerSelection> {
  const config = runnerConfig || getRunnerConfigFromTenant(tenant);

  logger.debug('Selecting runner for ticket', {
    ticketId: ticket.identifier,
    tenant: tenant.name,
    config,
  });

  // 1. Explicit runner type takes precedence
  if (config.runnerType) {
    // Validate the runner is available
    const available = await isRunnerAvailable(config.runnerType, tenant.repoPath);
    if (available) {
      return {
        runner: config.runnerType,
        reason: `Configured runner type: ${config.runnerType}`,
      };
    }
    logger.warn('Configured runner not available, falling back', {
      configured: config.runnerType,
      tenant: tenant.name,
    });
  }

  // 2. Auto-detect Rails projects
  if (config.autoDetectRails !== false) {
    if (isRailsProject(tenant.repoPath)) {
      const swarmAvailable = await isClaudeSwarmAvailable(getDefaultRailsConfig().swarmPath);
      if (swarmAvailable) {
        return {
          runner: 'claude-on-rails',
          reason: 'Auto-detected Rails project with claude-swarm available',
        };
      }
      logger.debug('Rails project detected but claude-swarm not available', {
        tenant: tenant.name,
      });
    }
  }

  // 3. Complexity-based SwarmSDK routing
  const complexityThreshold = config.swarmComplexityThreshold ?? 6;
  if (complexityThreshold > 0) {
    const complexity = analyzeTicketComplexity(ticket);
    if (complexity >= complexityThreshold) {
      const swarmAvailable = await isSwarmAvailable('swarm');
      if (swarmAvailable) {
        return {
          runner: 'swarm-sdk',
          reason: `High complexity ticket (${complexity}/${complexityThreshold} threshold)`,
        };
      }
      logger.debug('Complex ticket but SwarmSDK not available', {
        ticketId: ticket.identifier,
        complexity,
      });
    }
  }

  // 4. Default to claude-code
  return {
    runner: 'claude-code',
    reason: 'Default runner',
  };
}

/**
 * Check if a specific runner is available
 */
async function isRunnerAvailable(runner: RunnerType, repoPath: string): Promise<boolean> {
  switch (runner) {
    case 'claude-code':
      // Claude Code is always available (it's the base requirement)
      return true;

    case 'swarm-sdk':
      return isSwarmAvailable('swarm');

    case 'claude-on-rails':
      // Must be a Rails project AND have claude-swarm
      if (!isRailsProject(repoPath)) {
        return false;
      }
      return isClaudeSwarmAvailable(getDefaultRailsConfig().swarmPath);

    default:
      return false;
  }
}

/**
 * Extract runner config from tenant configuration
 */
function getRunnerConfigFromTenant(tenant: TenantConfig): RunnerConfig {
  // TenantConfig may have runner-specific fields
  // This allows per-tenant runner configuration
  const tenantWithRunner = tenant as TenantConfig & {
    runnerType?: RunnerType;
    swarmComplexityThreshold?: number;
    autoDetectRails?: boolean;
  };

  return {
    runnerType: tenantWithRunner.runnerType,
    swarmComplexityThreshold: tenantWithRunner.swarmComplexityThreshold,
    autoDetectRails: tenantWithRunner.autoDetectRails,
  };
}

/**
 * Get a human-readable description of runner capabilities
 */
export function describeRunner(runner: RunnerType): string {
  switch (runner) {
    case 'claude-code':
      return 'Single-agent Claude Code for straightforward implementations';
    case 'swarm-sdk':
      return 'Multi-agent SwarmSDK team (planner/coder/reviewer) for complex tickets';
    case 'claude-on-rails':
      return 'Rails-specialized agent swarm (architect/models/controllers/views/services/tests/devops)';
    default:
      return 'Unknown runner';
  }
}
