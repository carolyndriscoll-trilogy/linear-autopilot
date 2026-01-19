// tests/linear/client.test.ts
import { describe, it, expect, jest, beforeEach, beforeAll, afterAll } from '@jest/globals';
import { createMockTicket } from '../utils/fixtures';

// Mock fetch globally
const mockFetch = jest.fn<typeof global.fetch>();
global.fetch = mockFetch;

// Store original env
const originalEnv = process.env;

describe('Linear Client', () => {
  beforeAll(() => {
    // Set up required environment variables
    process.env = {
      ...originalEnv,
      LINEAR_API_KEY: 'test-api-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // Reset modules to clear cached config
    jest.resetModules();
  });

  describe('fetchTicket', () => {
    it('should fetch an issue by ID', async () => {
      const mockIssue = createMockTicket();

      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              issue: mockIssue,
            },
          }),
          { status: 200 }
        )
      );

      const { fetchTicket } = await import('../../src/linear/client');
      const result = await fetchTicket('issue-123');

      expect(result.identifier).toBe('ABC-123');
      expect(result.title).toBe('Test Issue');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.linear.app/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'test-api-key',
          }),
        })
      );
    });

    it('should throw error for non-existent issues', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              issue: null,
            },
          }),
          { status: 200 }
        )
      );

      const { fetchTicket } = await import('../../src/linear/client');

      await expect(fetchTicket('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw error on GraphQL errors', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            errors: [{ message: 'Not authorized' }],
          }),
          { status: 200 }
        )
      );

      const { fetchTicket } = await import('../../src/linear/client');

      await expect(fetchTicket('issue-123')).rejects.toThrow('Linear API error');
    });
  });

  describe('addComment', () => {
    it('should add a comment to an issue', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              commentCreate: {
                success: true,
              },
            },
          }),
          { status: 200 }
        )
      );

      const { addComment } = await import('../../src/linear/client');
      const ticket = createMockTicket();

      await addComment(ticket, 'This is a test comment');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.linear.app/graphql',
        expect.objectContaining({
          body: expect.stringContaining('commentCreate'),
        })
      );
    });

    it('should throw error when comment creation fails', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              commentCreate: {
                success: false,
              },
            },
          }),
          { status: 200 }
        )
      );

      const { addComment } = await import('../../src/linear/client');
      const ticket = createMockTicket();

      await expect(addComment(ticket, 'Test comment')).rejects.toThrow('Failed to add comment');
    });
  });

  describe('createLabel', () => {
    it('should create a label and return its ID', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              issueLabelCreate: {
                success: true,
                issueLabel: {
                  id: 'label-123',
                },
              },
            },
          }),
          { status: 200 }
        )
      );

      const { createLabel } = await import('../../src/linear/client');
      const labelId = await createLabel('team-123', 'agent-ready', '#ff0000');

      expect(labelId).toBe('label-123');
    });

    it('should throw error when label creation fails', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              issueLabelCreate: {
                success: false,
              },
            },
          }),
          { status: 200 }
        )
      );

      const { createLabel } = await import('../../src/linear/client');

      await expect(createLabel('team-123', 'agent-ready', '#ff0000')).rejects.toThrow(
        'Failed to create label'
      );
    });
  });

  describe('retry logic', () => {
    it('should retry on 5xx errors with exponential backoff', async () => {
      // First two calls fail with 500, third succeeds
      mockFetch
        .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
        .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                issue: createMockTicket(),
              },
            }),
            { status: 200 }
          )
        );

      const { fetchTicket } = await import('../../src/linear/client');
      const result = await fetchTicket('issue-123');

      expect(result.identifier).toBe('ABC-123');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 15000); // Increase timeout due to retries

    it('should retry on 429 rate limit errors', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                issue: createMockTicket(),
              },
            }),
            { status: 200 }
          )
        );

      const { fetchTicket } = await import('../../src/linear/client');
      const result = await fetchTicket('issue-123');

      expect(result.identifier).toBe('ABC-123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should fail after max retries', async () => {
      // All calls fail with 500
      mockFetch.mockResolvedValue(new Response('Server Error', { status: 500 }));

      const { fetchTicket } = await import('../../src/linear/client');

      await expect(fetchTicket('issue-123')).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(4); // Initial + 3 retries
    }, 20000);

    it('should retry on rate limit error in response body', async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              errors: [{ message: 'Rate limit exceeded' }],
            }),
            { status: 200 }
          )
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                issue: createMockTicket(),
              },
            }),
            { status: 200 }
          )
        );

      const { fetchTicket } = await import('../../src/linear/client');
      const result = await fetchTicket('issue-123');

      expect(result.identifier).toBe('ABC-123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);
  });
});

describe('Linear States', () => {
  beforeAll(() => {
    process.env = {
      ...originalEnv,
      LINEAR_API_KEY: 'test-api-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    jest.resetModules();
  });

  describe('getStateId', () => {
    it('should fetch and cache states for a team', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              team: {
                states: {
                  nodes: [
                    { id: 'state-1', name: 'Backlog' },
                    { id: 'state-2', name: 'In Progress' },
                    { id: 'state-3', name: 'Done' },
                  ],
                },
              },
            },
          }),
          { status: 200 }
        )
      );

      const { getStateId } = await import('../../src/linear/states');
      const stateId = await getStateId('team-123', 'In Progress');

      expect(stateId).toBe('state-2');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should be case-insensitive for state names', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              team: {
                states: {
                  nodes: [{ id: 'state-1', name: 'In Progress' }],
                },
              },
            },
          }),
          { status: 200 }
        )
      );

      const { getStateId } = await import('../../src/linear/states');
      const stateId = await getStateId('team-123', 'in progress');

      expect(stateId).toBe('state-1');
    });

    it('should throw error for unknown state', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              team: {
                states: {
                  nodes: [
                    { id: 'state-1', name: 'Backlog' },
                    { id: 'state-2', name: 'Done' },
                  ],
                },
              },
            },
          }),
          { status: 200 }
        )
      );

      const { getStateId } = await import('../../src/linear/states');

      await expect(getStateId('team-123', 'Unknown State')).rejects.toThrow(
        'State "Unknown State" not found'
      );
    });

    it('should list available states in error message', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              team: {
                states: {
                  nodes: [
                    { id: 'state-1', name: 'Backlog' },
                    { id: 'state-2', name: 'Done' },
                  ],
                },
              },
            },
          }),
          { status: 200 }
        )
      );

      const { getStateId } = await import('../../src/linear/states');

      try {
        await getStateId('team-123', 'Unknown');
      } catch (e) {
        expect((e as Error).message).toContain('backlog');
        expect((e as Error).message).toContain('done');
      }
    });
  });

  describe('getAllStates', () => {
    it('should return all states as array', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              team: {
                states: {
                  nodes: [
                    { id: 'state-1', name: 'Backlog' },
                    { id: 'state-2', name: 'In Progress' },
                  ],
                },
              },
            },
          }),
          { status: 200 }
        )
      );

      const { getAllStates } = await import('../../src/linear/states');
      const states = await getAllStates('team-123');

      expect(states).toHaveLength(2);
      expect(states.map((s) => s.name)).toContain('backlog');
      expect(states.map((s) => s.name)).toContain('in progress');
    });
  });
});

describe('Config', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should throw error when LINEAR_API_KEY is missing', async () => {
    process.env = { ...originalEnv };
    delete process.env.LINEAR_API_KEY;

    const { getConfig } = await import('../../src/config');

    expect(() => getConfig()).toThrow('Missing required environment variable: LINEAR_API_KEY');
  });

  it('should return config when LINEAR_API_KEY is set', async () => {
    process.env = {
      ...originalEnv,
      LINEAR_API_KEY: 'my-api-key',
    };

    const { getConfig } = await import('../../src/config');
    const config = getConfig();

    expect(config.linearApiKey).toBe('my-api-key');
  });

  it('should include optional DEFAULT_REPO_PATH if set', async () => {
    process.env = {
      ...originalEnv,
      LINEAR_API_KEY: 'my-api-key',
      DEFAULT_REPO_PATH: '/path/to/repo',
    };

    const { getConfig } = await import('../../src/config');
    const config = getConfig();

    expect(config.defaultRepoPath).toBe('/path/to/repo');
  });
});
