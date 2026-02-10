import { categorizeError, formatMemoryForPrompt, getRelevantFiles } from '../../src/memory';
import type { RepoMemory } from '../../src/memory';

describe('Memory', () => {
  describe('categorizeError', () => {
    it('should categorize type errors', () => {
      expect(categorizeError('Type error: string is not assignable to number')).toBe('type_error');
      expect(categorizeError('TypeError: Cannot read property')).toBe('type_error');
      expect(categorizeError("Property 'foo' is not assignable to type")).toBe('type_error');
    });

    it('should categorize test failures', () => {
      expect(categorizeError('Test failed: expected true but got false')).toBe('test_failure');
      expect(categorizeError('Test assertion failed')).toBe('test_failure');
      expect(categorizeError('FAIL tests/foo.test.ts')).toBe('test_failure');
    });

    it('should categorize lint errors', () => {
      expect(categorizeError('ESLint: no-unused-vars')).toBe('lint_error');
      expect(categorizeError('Lint error on line 42')).toBe('lint_error');
      expect(categorizeError('Prettier formatting issue')).toBe('lint_error');
    });

    it('should categorize build errors', () => {
      expect(categorizeError('Build failed with errors')).toBe('build_error');
      expect(categorizeError('tsc exited with code 1')).toBe('build_error');
      expect(categorizeError('Compile error in module')).toBe('build_error');
    });

    it('should categorize runtime errors', () => {
      expect(categorizeError('RuntimeError: undefined is not a function')).toBe('runtime_error');
      expect(categorizeError('Cannot read property of undefined')).toBe('runtime_error');
      expect(categorizeError('null pointer exception')).toBe('runtime_error');
    });

    it('should return unknown for unrecognized errors', () => {
      expect(categorizeError('Something went wrong')).toBe('unknown');
      expect(categorizeError('Random error message')).toBe('unknown');
    });
  });

  describe('formatMemoryForPrompt', () => {
    it('should return empty string for empty memory', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      expect(formatMemoryForPrompt(memory)).toBe('');
    });

    it('should include success rate when tickets exist', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [],
        validationHistory: [],
        successfulTickets: 8,
        failedTickets: 2,
      };

      const result = formatMemoryForPrompt(memory);
      expect(result).toContain('8/10');
      expect(result).toContain('80%');
    });

    it('should include patterns when present', () => {
      const memory: RepoMemory = {
        patterns: ['Always run tests before committing', 'Use TypeScript strict mode'],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = formatMemoryForPrompt(memory);
      expect(result).toContain('Patterns to follow');
      expect(result).toContain('Always run tests before committing');
      expect(result).toContain('Use TypeScript strict mode');
    });

    it('should include categorized errors grouped by category', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [
          { category: 'type_error', message: 'Type mismatch', count: 3, lastSeen: '2024-01-01' },
          { category: 'test_failure', message: 'Test timeout', count: 1, lastSeen: '2024-01-01' },
        ],
        filePatterns: [],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = formatMemoryForPrompt(memory);
      expect(result).toContain('Errors to avoid');
      expect(result).toContain('type_error');
      expect(result).toContain('Type mismatch');
      expect(result).toContain('seen 3x');
    });

    it('should include validation trouble spots', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [],
        validationHistory: [
          { step: 'tests', failureCount: 5, lastFailure: '2024-01-01', commonCauses: ['Timeout'] },
          { step: 'lint', failureCount: 1, lastFailure: '2024-01-01', commonCauses: [] },
        ],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = formatMemoryForPrompt(memory);
      expect(result).toContain('Validation steps that often fail');
      expect(result).toContain('tests');
      expect(result).toContain('failed 5x');
      // lint should not appear (only 1 failure, threshold is 2)
      expect(result).not.toContain('lint:');
    });

    it('should include file structure when present', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: 'src/\n  components/\n  utils/',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = formatMemoryForPrompt(memory);
      expect(result).toContain('Project structure');
      expect(result).toContain('src/');
    });
  });

  describe('getRelevantFiles', () => {
    it('should return empty array when no keywords match', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [
          { ticketKeywords: ['auth', 'login'], commonFiles: ['src/auth.ts'], count: 1 },
        ],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = getRelevantFiles(memory, 'Add new dashboard feature');
      expect(result).toEqual([]);
    });

    it('should return matching files based on keywords', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [
          {
            ticketKeywords: ['auth', 'login', 'session'],
            commonFiles: ['src/auth.ts', 'src/session.ts'],
            count: 5,
          },
        ],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = getRelevantFiles(memory, 'Fix login bug');
      expect(result).toContain('src/auth.ts');
      expect(result).toContain('src/session.ts');
    });

    it('should return empty array for empty title', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = getRelevantFiles(memory, '');
      expect(result).toEqual([]);
    });

    it('should limit results to 10 files', () => {
      const memory: RepoMemory = {
        patterns: [],
        commonErrors: [],
        fileStructure: '',
        lastUpdated: new Date(),
        categorizedErrors: [],
        filePatterns: [
          {
            ticketKeywords: ['test'],
            commonFiles: Array.from({ length: 15 }, (_, i) => `file${i}.ts`),
            count: 1,
          },
        ],
        validationHistory: [],
        successfulTickets: 0,
        failedTickets: 0,
      };

      const result = getRelevantFiles(memory, 'Add test coverage');
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });
});
