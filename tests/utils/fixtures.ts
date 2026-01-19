// tests/utils/fixtures.ts

/**
 * Test fixtures and factories for Linear Autopilot tests
 */

export const createMockIssue = (overrides: Partial<MockIssue> = {}): MockIssue => ({
  id: 'issue-123',
  identifier: 'ABC-123',
  title: 'Test Issue',
  description: 'This is a test issue description',
  state: { name: 'Backlog' },
  labels: { nodes: [] },
  team: { id: 'team-123', name: 'Test Team' },
  ...overrides,
});

export const createMockTenant = (overrides: Partial<MockTenant> = {}): MockTenant => ({
  name: 'test-tenant',
  linearTeamId: 'team-123',
  repoPath: '/tmp/test-repo',
  maxConcurrentAgents: 2,
  githubRepo: 'org/repo',
  notifications: [],
  ...overrides,
});

export const createMockWebhookPayload = (
  action: string,
  overrides: Partial<MockWebhookPayload> = {}
): MockWebhookPayload => ({
  action,
  type: 'Issue',
  createdAt: new Date().toISOString(),
  data: createMockIssue(),
  ...overrides,
});

export const createMockAgentResult = (
  overrides: Partial<MockAgentResult> = {}
): MockAgentResult => ({
  success: true,
  ticketId: 'ABC-123',
  branchName: 'feature/ABC-123-test-issue',
  prUrl: 'https://github.com/org/repo/pull/1',
  tokensUsed: 5000,
  costEstimate: 0.15,
  duration: 120000,
  ...overrides,
});

// Types for fixtures
interface MockIssue {
  id: string;
  identifier: string;
  title: string;
  description: string;
  state: { name: string };
  labels: { nodes: Array<{ name: string }> };
  team: { id: string; name: string };
}

interface MockTenant {
  name: string;
  linearTeamId: string;
  repoPath: string;
  maxConcurrentAgents: number;
  githubRepo: string;
  notifications: Array<{ type: string; config: Record<string, string> }>;
}

interface MockWebhookPayload {
  action: string;
  type: string;
  createdAt: string;
  data: MockIssue;
}

interface MockAgentResult {
  success: boolean;
  ticketId: string;
  branchName: string;
  prUrl?: string;
  error?: string;
  tokensUsed: number;
  costEstimate: number;
  duration: number;
}

/**
 * Wait for a condition to be true
 */
export const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('waitFor timeout');
};

/**
 * Create a mock Express request
 */
export const createMockRequest = (overrides: Record<string, any> = {}) => ({
  body: {},
  headers: {},
  params: {},
  query: {},
  ...overrides,
});

/**
 * Create a mock Express response
 */
export const createMockResponse = () => {
  const res: Record<string, any> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
};
