// src/runners/swarm-runner.ts
// SwarmSDK integration for multi-agent ticket implementation
// Requires: gem install swarm_sdk

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { LinearTicket } from '../linear/types';
import { TenantConfig } from '../config/tenants';
import { logger } from '../logger';

export interface SwarmConfig {
  enabled: boolean;
  // Complexity threshold (0-10) - tickets above this use swarm
  complexityThreshold: number;
  // Path to swarm executable (default: swarm)
  swarmPath: string;
  // Model to use for agents
  model: string;
}

export interface SwarmResult {
  success: boolean;
  output: string;
  agentLogs: AgentLog[];
}

export interface AgentLog {
  agent: string;
  action: string;
  timestamp: Date;
}

/**
 * Generate a SwarmSDK YAML config for a ticket
 */
function generateSwarmConfig(
  ticket: LinearTicket,
  tenant: TenantConfig,
  branchName: string,
  model: string
): string {
  return `
swarm:
  name: "ticket-${ticket.identifier}"
  description: "Implement Linear ticket ${ticket.identifier}"

  agents:
    - name: "planner"
      role: "Technical Lead"
      model: "${model}"
      instructions: |
        You are a technical lead analyzing a ticket.
        Break down the requirements into clear implementation steps.
        Identify files that need to be modified.
        Hand off to the coder when analysis is complete.
      tools:
        - read_file
        - list_directory
        - delegate
      can_delegate_to:
        - coder

    - name: "coder"
      role: "Software Engineer"
      model: "${model}"
      instructions: |
        You are a software engineer implementing the ticket.
        Follow the plan from the planner.
        Write clean, tested code following existing patterns.
        Hand off to reviewer when implementation is complete.
      tools:
        - read_file
        - write_file
        - bash
        - delegate
      can_delegate_to:
        - reviewer
        - planner

    - name: "reviewer"
      role: "Code Reviewer"
      model: "${model}"
      instructions: |
        You are a code reviewer.
        Review the implementation for bugs, style issues, and test coverage.
        If issues found, delegate back to coder with specific feedback.
        If approved, run the test suite and report results.
      tools:
        - read_file
        - bash
        - delegate
      can_delegate_to:
        - coder

  workflow:
    entry_agent: "planner"
    max_iterations: 20

  context:
    ticket_id: "${ticket.identifier}"
    ticket_title: "${ticket.title}"
    branch_name: "${branchName}"
    repo_path: "${tenant.repoPath}"
    github_repo: "${tenant.githubRepo}"
`;
}

/**
 * Generate the initial prompt for the swarm
 */
function generateSwarmPrompt(ticket: LinearTicket, branchName: string): string {
  const description = ticket.description || 'No description provided.';

  return `
## Linear Ticket: ${ticket.identifier}

**Title:** ${ticket.title}

**Description:**
${description}

## Instructions

1. First, checkout the branch: git checkout -b ${branchName}
2. Analyze the codebase to understand existing patterns
3. Plan the implementation steps
4. Implement the changes
5. Run tests to verify
6. Commit changes with message referencing ${ticket.identifier}

## Rules

- DO NOT commit to main branch
- DO NOT push to remote (the system handles PR creation)
- Follow existing code patterns
- Write tests for new functionality

Begin by analyzing the ticket and creating an implementation plan.
`;
}

/**
 * Run a SwarmSDK team on a ticket
 */
export async function runSwarmTeam(
  ticket: LinearTicket,
  tenant: TenantConfig,
  branchName: string,
  config: SwarmConfig
): Promise<SwarmResult> {
  const swarmConfigPath = join(tenant.repoPath, '.swarm-ticket.yml');
  const swarmConfig = generateSwarmConfig(ticket, tenant, branchName, config.model);
  const prompt = generateSwarmPrompt(ticket, branchName);

  logger.info('Starting SwarmSDK team', {
    ticketId: ticket.identifier,
    tenant: tenant.name,
    configPath: swarmConfigPath,
  });

  try {
    // Write swarm config
    writeFileSync(swarmConfigPath, swarmConfig);

    // Run swarm CLI
    const result = await executeSwarm(config.swarmPath, swarmConfigPath, prompt, tenant.repoPath);

    return result;
  } finally {
    // Clean up config file
    if (existsSync(swarmConfigPath)) {
      try {
        unlinkSync(swarmConfigPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Execute the swarm CLI
 */
function executeSwarm(
  swarmPath: string,
  configPath: string,
  prompt: string,
  cwd: string
): Promise<SwarmResult> {
  return new Promise((resolve) => {
    const args = ['run', '-c', configPath, '-p', prompt, '--non-interactive'];

    logger.debug('Executing swarm', { swarmPath, args, cwd });

    const swarm = spawn(swarmPath, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let output = '';
    const agentLogs: AgentLog[] = [];

    swarm.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stdout.write(data);

      // Parse agent activity from output
      const agentMatch = text.match(/\[(\w+)\] (.+)/);
      if (agentMatch) {
        agentLogs.push({
          agent: agentMatch[1],
          action: agentMatch[2],
          timestamp: new Date(),
        });
      }
    });

    swarm.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      process.stderr.write(data);
    });

    swarm.on('close', (code) => {
      logger.info('Swarm completed', {
        exitCode: code,
        agentCount: agentLogs.length,
      });

      resolve({
        success: code === 0,
        output,
        agentLogs,
      });
    });

    swarm.on('error', (err) => {
      logger.error('Failed to spawn swarm', { error: err.message });
      resolve({
        success: false,
        output: err.message,
        agentLogs,
      });
    });
  });
}

/**
 * Analyze ticket complexity (simple heuristic)
 * Returns 0-10 score
 */
export function analyzeTicketComplexity(ticket: LinearTicket): number {
  let score = 0;
  const desc = (ticket.description || '').toLowerCase();
  const title = ticket.title.toLowerCase();
  const combined = `${title} ${desc}`;

  // Length-based complexity
  if (desc.length > 500) score += 2;
  if (desc.length > 1000) score += 1;

  // Keyword-based complexity
  const complexKeywords = [
    'refactor',
    'migrate',
    'redesign',
    'architecture',
    'multiple',
    'integration',
    'api',
    'database',
    'security',
    'performance',
    'scale',
    'system',
  ];

  const simpleKeywords = [
    'typo',
    'fix',
    'update',
    'change',
    'rename',
    'add comment',
    'documentation',
    'readme',
  ];

  for (const keyword of complexKeywords) {
    if (combined.includes(keyword)) score += 1;
  }

  for (const keyword of simpleKeywords) {
    if (combined.includes(keyword)) score -= 1;
  }

  // Clamp to 0-10
  return Math.max(0, Math.min(10, score));
}

/**
 * Check if SwarmSDK is available
 */
export async function isSwarmAvailable(swarmPath: string): Promise<boolean> {
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
