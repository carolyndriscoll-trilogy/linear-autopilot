// tests/setup.ts
// Global test setup

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise in tests

// Mock external services by default
jest.mock('../src/linear/client', () => ({
  LinearClient: jest.fn().mockImplementation(() => ({
    getIssue: jest.fn(),
    updateIssue: jest.fn(),
    addComment: jest.fn(),
  })),
}));

// Increase timeout for integration tests
jest.setTimeout(10000);

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Global teardown
afterAll(() => {
  jest.restoreAllMocks();
});
