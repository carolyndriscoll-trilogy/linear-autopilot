// tests/utils/fixtures.ts
import { LinearTicket } from '../../src/linear/types';
import { TenantConfig, NotificationConfig } from '../../src/config/tenants';
import {
  PrCreatedEvent,
  AgentStartedEvent,
  AgentCompletedEvent,
  AgentFailedEvent,
  AgentStuckEvent,
} from '../../src/notifications/types';

/**
 * Test fixtures and factories for Linear Autopilot tests
 */

export function createMockTicket(overrides: Partial<LinearTicket> = {}): LinearTicket {
  return {
    id: 'issue-123',
    identifier: 'ABC-123',
    title: 'Test Issue',
    description: 'This is a test issue description',
    state: { id: 'state-1', name: 'Backlog' },
    team: { id: 'team-123', name: 'Test Team' },
    ...overrides,
  };
}

export function createMockTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    name: 'test-tenant',
    linearTeamId: 'team-123',
    repoPath: '/tmp/test-repo',
    maxConcurrentAgents: 2,
    githubRepo: 'org/repo',
    notifications: [],
    ...overrides,
  };
}

export function createMockNotificationConfig(
  type: 'slack' | 'discord' | 'email' | 'sms' | 'whatsapp' | 'gchat' = 'slack',
  config: Record<string, string> = {}
): NotificationConfig {
  const defaults: Record<string, Record<string, string>> = {
    slack: { webhookUrl: 'https://hooks.slack.com/services/xxx/yyy/zzz' },
    discord: { webhookUrl: 'https://discord.com/api/webhooks/xxx/yyy' },
    email: { to: 'test@example.com', apiKey: 'test-key', provider: 'resend' },
    sms: { to: '+1234567890', accountSid: 'sid', authToken: 'token', from: '+0987654321' },
    whatsapp: { to: '+1234567890', accountSid: 'sid', authToken: 'token', from: '+0987654321' },
    gchat: { webhookUrl: 'https://chat.googleapis.com/v1/spaces/xxx/messages' },
  };

  return {
    type,
    config: { ...defaults[type], ...config },
  };
}

export function createAgentStartedEvent(
  ticket: LinearTicket = createMockTicket(),
  tenant: TenantConfig = createMockTenant(),
  branchName = 'feature/ABC-123-test-issue'
): AgentStartedEvent {
  return {
    type: 'agent-started',
    ticket,
    tenant,
    branchName,
    timestamp: new Date(),
  };
}

export function createAgentCompletedEvent(
  ticket: LinearTicket = createMockTicket(),
  tenant: TenantConfig = createMockTenant(),
  branchName = 'feature/ABC-123-test-issue',
  duration = 120000
): AgentCompletedEvent {
  return {
    type: 'agent-completed',
    ticket,
    tenant,
    branchName,
    duration,
    timestamp: new Date(),
  };
}

export function createAgentFailedEvent(
  ticket: LinearTicket = createMockTicket(),
  tenant: TenantConfig = createMockTenant(),
  branchName = 'feature/ABC-123-test-issue',
  error = 'Test error message',
  attempt = 1,
  maxAttempts = 3
): AgentFailedEvent {
  return {
    type: 'agent-failed',
    ticket,
    tenant,
    branchName,
    error,
    attempt,
    maxAttempts,
    timestamp: new Date(),
  };
}

export function createAgentStuckEvent(
  ticket: LinearTicket = createMockTicket(),
  tenant: TenantConfig = createMockTenant(),
  branchName = 'feature/ABC-123-test-issue',
  runningFor = 3600000,
  lastActivity?: string
): AgentStuckEvent {
  return {
    type: 'agent-stuck',
    ticket,
    tenant,
    branchName,
    runningFor,
    lastActivity,
    timestamp: new Date(),
  };
}

export function createPrCreatedEvent(
  ticket: LinearTicket = createMockTicket(),
  tenant: TenantConfig = createMockTenant(),
  branchName = 'feature/ABC-123-test-issue',
  prUrl = 'https://github.com/org/repo/pull/1'
): PrCreatedEvent {
  return {
    type: 'pr-created',
    ticket,
    tenant,
    branchName,
    prUrl,
    timestamp: new Date(),
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('waitFor timeout');
}
