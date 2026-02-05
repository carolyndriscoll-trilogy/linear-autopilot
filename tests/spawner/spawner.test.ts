// tests/spawner/spawner.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import { createMockTicket, createMockTenant } from '../utils/fixtures';
import type { QueuedTicket } from '../../src/spawner/queue';

// --- Mock all external dependencies before importing spawner ---

const mockUpdateTicketStatus = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockAddComment = jest
  .fn<(...args: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
jest.mock('../../src/linear', () => ({
  updateTicketStatus: mockUpdateTicketStatus,
  addComment: mockAddComment,
}));

const mockNotify = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockCreateAgentStartedEvent = jest.fn().mockReturnValue({ type: 'agent-started' });
const mockCreateAgentCompletedEvent = jest.fn().mockReturnValue({ type: 'agent-completed' });
const mockCreateAgentFailedEvent = jest.fn().mockReturnValue({ type: 'agent-failed' });
const mockCreateAgentStuckEvent = jest.fn().mockReturnValue({ type: 'agent-stuck' });
const mockCreatePrCreatedEvent = jest.fn().mockReturnValue({ type: 'pr-created' });
jest.mock('../../src/notifications', () => ({
  notify: mockNotify,
  createAgentStartedEvent: mockCreateAgentStartedEvent,
  createAgentCompletedEvent: mockCreateAgentCompletedEvent,
  createAgentFailedEvent: mockCreateAgentFailedEvent,
  createAgentStuckEvent: mockCreateAgentStuckEvent,
  createPrCreatedEvent: mockCreatePrCreatedEvent,
}));

const mockBuildAutopilotPrompt = jest.fn().mockReturnValue('test prompt');
jest.mock('../../src/prompts', () => ({
  buildAutopilotPrompt: mockBuildAutopilotPrompt,
}));

const mockUpdateMemory = jest.fn();
jest.mock('../../src/memory', () => ({
  updateMemory: mockUpdateMemory,
}));

const mockValidate = jest.fn<
  (...args: unknown[]) => Promise<{
    passed: boolean;
    results: Array<{ name: string; passed: boolean; output: string }>;
    totalDuration: number;
  }>
>();
const mockFormatValidationSummary = jest.fn().mockReturnValue('Validation summary');
jest.mock('../../src/validation', () => ({
  validate: mockValidate,
  formatValidationSummary: mockFormatValidationSummary,
}));

const mockRecordUsage = jest.fn();
jest.mock('../../src/tracking', () => ({
  recordUsage: mockRecordUsage,
}));

const mockRecordCompletion = jest.fn();
jest.mock('../../src/dashboard', () => ({
  recordCompletion: mockRecordCompletion,
}));

const mockExecFileSync = jest.fn<(...args: unknown[]) => string>();

function createMockChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: jest.Mock;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

let mockSpawnInstance: ReturnType<typeof createMockChildProcess>;

const mockSpawn = jest.fn().mockImplementation(() => {
  mockSpawnInstance = createMockChildProcess();
  return mockSpawnInstance;
});

jest.mock('child_process', () => ({
  spawn: mockSpawn,
  execFileSync: mockExecFileSync,
}));

// Import after mocks are set up
import { spawner } from '../../src/spawner/index';
import { ticketQueue } from '../../src/spawner/queue';

// Helper: create a QueuedTicket and invoke the private spawnAgent directly
async function spawnAgentDirectly(
  ticket = createMockTicket(),
  tenant = createMockTenant(),
  attempts = 0
): Promise<{ item: QueuedTicket; spawnPromise: Promise<void> }> {
  const item: QueuedTicket = {
    ticket,
    tenant,
    enqueuedAt: new Date(),
    attempts,
  };
  // Access private method
  const spawnPromise = (
    spawner as unknown as { spawnAgent(item: QueuedTicket): Promise<void> }
  ).spawnAgent(item);
  // Wait a tick for the spawn to be called
  await Promise.resolve();
  return { item, spawnPromise };
}

// Helper: complete the mock child process
function completeAgent(exitCode: number, output = '') {
  if (output) {
    mockSpawnInstance.stdout.emit('data', Buffer.from(output));
  }
  mockSpawnInstance.emit('close', exitCode);
}

describe('Spawner', () => {
  const ticket = createMockTicket();
  const tenant = createMockTenant();

  beforeEach(() => {
    ticketQueue.clear();
    spawner.stop();
    mockValidate.mockResolvedValue({
      passed: true,
      results: [{ name: 'tests', passed: true, output: 'ok' }],
      totalDuration: 1000,
    });
    mockExecFileSync.mockReturnValue('abc123 some commit\n');
    mockRecordUsage.mockReturnValue(null);
  });

  describe('getActiveCount', () => {
    it('should return 0 when no agents are active', () => {
      expect(spawner.getActiveCount()).toBe(0);
    });

    it('should return 0 for a specific tenant when no agents are active', () => {
      expect(spawner.getActiveCount('team-123')).toBe(0);
    });
  });

  describe('canSpawnForTenant', () => {
    it('should return true when under concurrency limit', () => {
      expect(spawner.canSpawnForTenant(tenant)).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('should start and stop without errors', () => {
      spawner.start();
      expect(spawner.getStatus().active).toBe(0);
      spawner.stop();
    });

    it('should not start twice', () => {
      spawner.start();
      spawner.start(); // no-op
      spawner.stop();
    });
  });

  describe('getStatus', () => {
    it('should return queue and agent status', () => {
      ticketQueue.enqueue(ticket, tenant);
      const status = spawner.getStatus();

      expect(status.active).toBe(0);
      expect(status.queued).toBe(1);
      expect(status.agents).toEqual([]);
    });
  });

  describe('getActiveAgents', () => {
    it('should return empty array when no agents are active', () => {
      expect(spawner.getActiveAgents()).toEqual([]);
    });
  });

  describe('agent lifecycle - success path', () => {
    it('should process a ticket through the full success path', async () => {
      mockExecFileSync
        .mockReturnValueOnce('abc123 some commit\n') // git log
        .mockReturnValueOnce('') // git push
        .mockReturnValueOnce('https://github.com/org/repo/pull/42\n'); // gh pr create

      const { spawnPromise } = await spawnAgentDirectly(ticket, tenant);

      // Verify spawn was called
      expect(mockSpawn).toHaveBeenCalled();

      // Simulate Claude Code completing successfully
      completeAgent(0, 'Tokens: 1000 input, 500 output');
      await spawnPromise;

      // Verify ticket was moved to In Progress
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(ticket, 'In Progress');

      // Verify agent started notification
      expect(mockCreateAgentStartedEvent).toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalled();

      // Verify validation was run
      expect(mockValidate).toHaveBeenCalledWith(tenant.repoPath, undefined);

      // Verify PR was created
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['pr', 'create']),
        expect.any(Object)
      );

      // Verify ticket moved to In Review
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(ticket, 'In Review');

      // Verify completion was recorded
      expect(mockRecordCompletion).toHaveBeenCalled();

      // Verify token usage was recorded
      expect(mockRecordUsage).toHaveBeenCalled();

      // Verify memory was updated with success
      expect(mockUpdateMemory).toHaveBeenCalledWith(
        tenant.repoPath,
        expect.objectContaining({ success: true })
      );

      // Agent should be cleaned up
      expect(spawner.getActiveCount()).toBe(0);
    });

    it('should mark ticket as Done when no commits on branch', async () => {
      mockExecFileSync.mockReturnValueOnce(''); // git log returns empty

      const t = createMockTicket({ identifier: 'NO-COMMITS-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);

      completeAgent(0);
      await spawnPromise;

      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'NO-COMMITS-1' }),
        'Done'
      );
    });

    it('should include ticket title in PR title', async () => {
      const t = createMockTicket({ identifier: 'PR-1', title: 'Add feature' });
      mockExecFileSync
        .mockReturnValueOnce('abc123 commit\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('https://github.com/org/repo/pull/99\n');

      const { spawnPromise } = await spawnAgentDirectly(t, tenant);
      completeAgent(0);
      await spawnPromise;

      expect(mockExecFileSync).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--title', 'PR-1: Add feature']),
        expect.any(Object)
      );
    });
  });

  describe('agent lifecycle - failure path', () => {
    it('should handle Claude Code failure and requeue', async () => {
      const t = createMockTicket({ identifier: 'FAIL-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);

      completeAgent(1);
      await spawnPromise;

      // Verify failure handling
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'FAIL-1' }),
        'Backlog'
      );

      expect(mockAddComment).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'FAIL-1' }),
        expect.stringContaining('Autopilot failed')
      );

      expect(mockCreateAgentFailedEvent).toHaveBeenCalled();

      // Verify ticket was requeued
      expect(ticketQueue.size()).toBe(1);

      // Verify memory updated with error
      expect(mockUpdateMemory).toHaveBeenCalledWith(
        tenant.repoPath,
        expect.objectContaining({ success: false })
      );
    });

    it('should handle validation failure as failure', async () => {
      mockValidate.mockResolvedValueOnce({
        passed: false,
        results: [{ name: 'tests', passed: false, output: 'FAIL' }],
        totalDuration: 500,
      });

      const t = createMockTicket({ identifier: 'VALFAIL-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);

      completeAgent(0); // Claude succeeds but validation fails
      await spawnPromise;

      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'VALFAIL-1' }),
        'Backlog'
      );

      expect(mockAddComment).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'VALFAIL-1' }),
        expect.stringContaining('Autopilot failed')
      );
    });

    it('should handle spawn error', async () => {
      const t = createMockTicket({ identifier: 'SPAWN-ERR-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);

      mockSpawnInstance.emit('error', new Error('spawn ENOENT'));
      await spawnPromise;

      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'SPAWN-ERR-1' }),
        'Backlog'
      );
    });

    it('should include attempt count in failure comment', async () => {
      const t = createMockTicket({ identifier: 'ATTEMPT-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant, 1); // 2nd attempt

      completeAgent(1);
      await spawnPromise;

      expect(mockAddComment).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'ATTEMPT-1' }),
        expect.stringContaining('attempt 2/3')
      );
    });
  });

  describe('branch name sanitization', () => {
    it('should use sanitized lowercase branch name', async () => {
      const t = createMockTicket({ identifier: 'ABC-123' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);

      expect(mockBuildAutopilotPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ branchName: 'abc-123' })
      );

      completeAgent(1);
      await spawnPromise;
    });
  });

  describe('PR creation', () => {
    it('should handle PR creation failure gracefully', async () => {
      mockExecFileSync
        .mockReturnValueOnce('abc123 commit\n') // git log
        .mockImplementationOnce(() => {
          throw new Error('push failed');
        }); // git push fails

      const t = createMockTicket({ identifier: 'PRFAIL-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);

      completeAgent(0);
      await spawnPromise;

      // PR creation failed, ticket should still be marked Done
      expect(mockUpdateTicketStatus).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: 'PRFAIL-1' }),
        'Done'
      );
    });

    it('should add comment with PR URL on success', async () => {
      mockExecFileSync
        .mockReturnValueOnce('abc123 commit\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('https://github.com/org/repo/pull/42\n');

      const { spawnPromise } = await spawnAgentDirectly(ticket, tenant);
      completeAgent(0);
      await spawnPromise;

      expect(mockAddComment).toHaveBeenCalledWith(
        ticket,
        expect.stringContaining('https://github.com/org/repo/pull/42')
      );
    });
  });

  describe('cleanup after agent', () => {
    it('should remove agent from active list after success', async () => {
      const { spawnPromise } = await spawnAgentDirectly(ticket, tenant);
      expect(spawner.getActiveCount()).toBe(1);

      completeAgent(0);
      await spawnPromise;

      expect(spawner.getActiveCount()).toBe(0);
    });

    it('should remove agent from active list after failure', async () => {
      const t = createMockTicket({ identifier: 'CLEANUP-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);
      expect(spawner.getActiveCount()).toBe(1);

      completeAgent(1);
      await spawnPromise;

      expect(spawner.getActiveCount()).toBe(0);
    });

    it('should call branch cleanup on failure', async () => {
      const t = createMockTicket({ identifier: 'BRANCH-CLEAN-1' });
      const { spawnPromise } = await spawnAgentDirectly(t, tenant);

      completeAgent(1);
      await spawnPromise;

      // Should have called git checkout main and git branch -D
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['checkout', 'main'],
        expect.any(Object)
      );
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'git',
        ['branch', '-D', 'branch-clean-1'],
        expect.any(Object)
      );
    });
  });

  describe('getModifiedFiles', () => {
    it('should handle git diff failure gracefully', async () => {
      mockExecFileSync
        .mockReturnValueOnce('abc123 commit\n') // git log
        .mockReturnValueOnce('') // git push
        .mockReturnValueOnce('https://github.com/org/repo/pull/1\n') // gh pr create
        .mockImplementationOnce(() => {
          throw new Error('not a git repo');
        }); // git diff fails

      const { spawnPromise } = await spawnAgentDirectly(ticket, tenant);
      completeAgent(0);
      await spawnPromise;

      // Memory should still be updated (with empty modifiedFiles)
      expect(mockUpdateMemory).toHaveBeenCalledWith(
        tenant.repoPath,
        expect.objectContaining({
          modifiedFiles: [],
          success: true,
        })
      );
    });
  });

  describe('token tracking', () => {
    it('should record usage from Claude Code output', async () => {
      const { spawnPromise } = await spawnAgentDirectly(ticket, tenant);

      completeAgent(0, 'Tokens: 5000 input, 2000 output');
      await spawnPromise;

      expect(mockRecordUsage).toHaveBeenCalledWith(
        tenant.repoPath,
        ticket.identifier,
        expect.stringContaining('Tokens: 5000 input, 2000 output'),
        tenant.name
      );
    });
  });
});
