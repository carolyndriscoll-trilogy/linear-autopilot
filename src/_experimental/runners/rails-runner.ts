// src/runners/rails-runner.ts
// claude-on-rails integration for Rails ticket implementation
// Requires: gem install claude-swarm, rails project with claude-on-rails setup

import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { LinearTicket } from '../linear/types';
import { TenantConfig } from '../config/tenants';
import { logger } from '../logger';

export interface RailsRunnerConfig {
  enabled: boolean;
  // Path to claude-swarm executable (default: claude-swarm)
  swarmPath: string;
  // Whether to auto-detect Rails projects
  autoDetect: boolean;
}

export interface RailsRunnerResult {
  success: boolean;
  output: string;
  agentActivity: AgentActivity[];
}

export interface AgentActivity {
  agent: string;
  action: string;
  timestamp: Date;
}

// Rails agent types from claude-on-rails
type RailsAgent =
  | 'architect'
  | 'models'
  | 'controllers'
  | 'views'
  | 'services'
  | 'tests'
  | 'devops';

/**
 * Check if a directory is a Rails project
 */
export function isRailsProject(repoPath: string): boolean {
  const indicators = [
    'config/application.rb',
    'config/routes.rb',
    'app/controllers/application_controller.rb',
  ];

  // Must have Rails indicators
  const hasRailsStructure = indicators.some((file) => existsSync(join(repoPath, file)));

  if (!hasRailsStructure) {
    return false;
  }

  // Check Gemfile for rails gem
  const gemfilePath = join(repoPath, 'Gemfile');
  if (existsSync(gemfilePath)) {
    try {
      const gemfile = readFileSync(gemfilePath, 'utf-8');
      return gemfile.includes("gem 'rails'") || gemfile.includes('gem "rails"');
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Check if claude-on-rails is set up in the project
 */
export function hasClaudeOnRailsSetup(repoPath: string): boolean {
  return (
    existsSync(join(repoPath, 'claude-swarm.yml')) || existsSync(join(repoPath, '.claude-on-rails'))
  );
}

/**
 * Initialize claude-on-rails in a Rails project
 * Runs: rails generate claude_on_rails:swarm
 */
export async function initializeClaudeOnRails(repoPath: string): Promise<boolean> {
  try {
    logger.info('Initializing claude-on-rails in project', { repoPath });

    execSync('rails generate claude_on_rails:swarm', {
      cwd: repoPath,
      stdio: 'pipe',
    });

    return true;
  } catch (error) {
    logger.error('Failed to initialize claude-on-rails', {
      repoPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Generate the prompt for claude-swarm based on the ticket
 */
function generateRailsPrompt(ticket: LinearTicket, branchName: string): string {
  const description = ticket.description || 'No description provided.';

  return `## Linear Ticket: ${ticket.identifier}

**Title:** ${ticket.title}

**Description:**
${description}

## Instructions

You are implementing a feature for this Rails application based on the ticket above.

1. First, create and checkout the branch: git checkout -b ${branchName}
2. Analyze the ticket requirements
3. Implement the feature following Rails conventions
4. Write comprehensive tests (RSpec or Minitest based on project)
5. Ensure all tests pass
6. Commit changes with message referencing ${ticket.identifier}

## Rules

- DO NOT commit to main branch
- DO NOT push to remote (the system handles PR creation)
- Follow existing code patterns and conventions
- Use Rails best practices (strong params, scopes, concerns, etc.)
- Write tests for all new functionality
- Update routes if adding new endpoints
- Run migrations if creating new ones

Begin by analyzing the ticket and determining which components need changes.`;
}

/**
 * Analyze ticket to determine which Rails agents are most relevant
 */
export function analyzeTicketForRailsAgents(ticket: LinearTicket): RailsAgent[] {
  const agents: RailsAgent[] = ['architect']; // Always start with architect
  const combined = `${ticket.title} ${ticket.description || ''}`.toLowerCase();

  // Model-related keywords
  if (
    combined.match(/model|database|migration|schema|association|relation|activerecord|table|column/)
  ) {
    agents.push('models');
  }

  // Controller-related keywords
  if (combined.match(/controller|endpoint|api|route|action|request|response|rest/)) {
    agents.push('controllers');
  }

  // View-related keywords
  if (combined.match(/view|template|partial|form|html|erb|haml|slim|frontend|ui|page|layout/)) {
    agents.push('views');
  }

  // Service-related keywords
  if (combined.match(/service|business logic|interactor|operation|command|job|worker|background/)) {
    agents.push('services');
  }

  // DevOps-related keywords
  if (combined.match(/deploy|docker|kubernetes|ci|cd|pipeline|infrastructure|config|environment/)) {
    agents.push('devops');
  }

  // Always include tests
  agents.push('tests');

  return [...new Set(agents)]; // Remove duplicates
}

/**
 * Run claude-swarm on a Rails ticket
 */
export async function runRailsSwarm(
  ticket: LinearTicket,
  tenant: TenantConfig,
  branchName: string,
  config: RailsRunnerConfig
): Promise<RailsRunnerResult> {
  const repoPath = tenant.repoPath;

  logger.info('Starting claude-on-rails swarm', {
    ticketId: ticket.identifier,
    tenant: tenant.name,
    repoPath,
  });

  // Verify it's a Rails project
  if (!isRailsProject(repoPath)) {
    return {
      success: false,
      output: 'Not a Rails project',
      agentActivity: [],
    };
  }

  // Check/initialize claude-on-rails setup
  if (!hasClaudeOnRailsSetup(repoPath)) {
    logger.info('claude-on-rails not set up, initializing...', { repoPath });
    const initialized = await initializeClaudeOnRails(repoPath);
    if (!initialized) {
      return {
        success: false,
        output: 'Failed to initialize claude-on-rails',
        agentActivity: [],
      };
    }
  }

  const prompt = generateRailsPrompt(ticket, branchName);
  const relevantAgents = analyzeTicketForRailsAgents(ticket);

  logger.info('Analyzed ticket for Rails agents', {
    ticketId: ticket.identifier,
    agents: relevantAgents,
  });

  return executeClaudeSwarm(config.swarmPath, repoPath, prompt);
}

/**
 * Execute the claude-swarm CLI
 */
function executeClaudeSwarm(
  swarmPath: string,
  cwd: string,
  prompt: string
): Promise<RailsRunnerResult> {
  return new Promise((resolve) => {
    // claude-swarm takes the prompt via stdin or as an argument
    const args = ['--non-interactive', '-p', prompt];

    logger.debug('Executing claude-swarm', { swarmPath, args, cwd });

    const swarm = spawn(swarmPath, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let output = '';
    const agentActivity: AgentActivity[] = [];

    swarm.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stdout.write(data);

      // Parse agent activity from output
      // claude-swarm outputs lines like: [architect] Analyzing requirements...
      const agentMatch = text.match(/\[(\w+)\]\s+(.+)/g);
      if (agentMatch) {
        for (const match of agentMatch) {
          const parsed = match.match(/\[(\w+)\]\s+(.+)/);
          if (parsed) {
            agentActivity.push({
              agent: parsed[1],
              action: parsed[2],
              timestamp: new Date(),
            });
          }
        }
      }
    });

    swarm.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stderr.write(data);
    });

    swarm.on('close', (code) => {
      logger.info('claude-swarm completed', {
        exitCode: code,
        agentActivityCount: agentActivity.length,
      });

      resolve({
        success: code === 0,
        output,
        agentActivity,
      });
    });

    swarm.on('error', (err) => {
      logger.error('Failed to spawn claude-swarm', { error: err.message });
      resolve({
        success: false,
        output: err.message,
        agentActivity,
      });
    });
  });
}

/**
 * Check if claude-swarm CLI is available
 */
export async function isClaudeSwarmAvailable(swarmPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(swarmPath, ['--version'], { stdio: 'pipe' });

    check.on('close', (code) => {
      resolve(code === 0);
    });

    check.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Get default Rails runner config
 */
export function getDefaultRailsConfig(): RailsRunnerConfig {
  return {
    enabled: process.env.RAILS_RUNNER_ENABLED === 'true',
    swarmPath: process.env.CLAUDE_SWARM_PATH || 'claude-swarm',
    autoDetect: process.env.RAILS_RUNNER_AUTO_DETECT !== 'false',
  };
}
