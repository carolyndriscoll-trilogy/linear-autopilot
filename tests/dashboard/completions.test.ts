import { recordCompletion, getRecentCompletions } from '../../src/dashboard';

// Mock fs operations
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

describe('Dashboard Completions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('recordCompletion', () => {
    it('should record a completion with all fields', () => {
      recordCompletion('TICKET-123', 'test-tenant', 60000, 'https://github.com/org/repo/pull/1');

      const completions = getRecentCompletions(10);
      const latest = completions[completions.length - 1];

      expect(latest.ticketId).toBe('TICKET-123');
      expect(latest.tenant).toBe('test-tenant');
      expect(latest.duration).toBe(60000);
      expect(latest.prUrl).toBe('https://github.com/org/repo/pull/1');
      expect(latest.completedAt).toBeDefined();
    });

    it('should record a completion without prUrl', () => {
      recordCompletion('TICKET-456', 'another-tenant', 30000);

      const completions = getRecentCompletions(10);
      const latest = completions[completions.length - 1];

      expect(latest.ticketId).toBe('TICKET-456');
      expect(latest.prUrl).toBeUndefined();
    });

    it('should accumulate multiple completions', () => {
      const initialCount = getRecentCompletions(100).length;

      recordCompletion('A-1', 'tenant', 1000);
      recordCompletion('A-2', 'tenant', 2000);
      recordCompletion('A-3', 'tenant', 3000);

      const completions = getRecentCompletions(100);
      expect(completions.length).toBe(initialCount + 3);
    });
  });

  describe('getRecentCompletions', () => {
    it('should return specified count of completions', () => {
      // Add several completions
      for (let i = 0; i < 5; i++) {
        recordCompletion(`TEST-${i}`, 'tenant', 1000 * i);
      }

      const completions = getRecentCompletions(3);
      expect(completions.length).toBeLessThanOrEqual(3);
    });

    it('should return most recent completions', () => {
      recordCompletion('OLD-1', 'tenant', 1000);
      recordCompletion('NEW-1', 'tenant', 2000);

      const completions = getRecentCompletions(1);
      expect(completions[0].ticketId).toBe('NEW-1');
    });

    it('should default to 20 completions', () => {
      const completions = getRecentCompletions();
      expect(completions.length).toBeLessThanOrEqual(20);
    });
  });
});
