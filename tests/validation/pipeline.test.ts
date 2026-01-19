// tests/validation/pipeline.test.ts
import { describe, it, expect } from '@jest/globals';
import { formatValidationSummary, ValidationSummary, ValidationResult } from '../../src/validation';

describe('formatValidationSummary', () => {
  it('should format a passing summary correctly', () => {
    const summary: ValidationSummary = {
      passed: true,
      totalDuration: 5000,
      results: [
        { name: 'tests', passed: true, output: 'All tests passed', duration: 3000 },
        { name: 'lint', passed: true, output: 'No issues found', duration: 1000 },
        { name: 'typecheck', passed: true, output: 'No errors', duration: 1000 },
      ],
    };

    const formatted = formatValidationSummary(summary);

    expect(formatted).toContain('## Validation Passed');
    expect(formatted).toContain('✅ **tests**');
    expect(formatted).toContain('✅ **lint**');
    expect(formatted).toContain('✅ **typecheck**');
    expect(formatted).toContain('Total time: 5.0s');
  });

  it('should format a failing summary with error output', () => {
    const summary: ValidationSummary = {
      passed: false,
      totalDuration: 3000,
      results: [
        { name: 'tests', passed: true, output: 'All tests passed', duration: 2000 },
        { name: 'lint', passed: false, output: 'Error: unused variable x', duration: 1000 },
      ],
    };

    const formatted = formatValidationSummary(summary);

    expect(formatted).toContain('## Validation Failed');
    expect(formatted).toContain('✅ **tests**');
    expect(formatted).toContain('❌ **lint**');
    expect(formatted).toContain('Error: unused variable x');
    expect(formatted).toContain('```');
  });

  it('should truncate long error output', () => {
    const longOutput = 'x'.repeat(1500);
    const summary: ValidationSummary = {
      passed: false,
      totalDuration: 1000,
      results: [{ name: 'tests', passed: false, output: longOutput, duration: 1000 }],
    };

    const formatted = formatValidationSummary(summary);

    expect(formatted).toContain('...(truncated)');
    expect(formatted.length).toBeLessThan(longOutput.length + 500);
  });

  it('should show duration for steps with non-zero time', () => {
    const summary: ValidationSummary = {
      passed: true,
      totalDuration: 5000,
      results: [
        { name: 'tests', passed: true, output: '', duration: 3500 },
        { name: 'lint', passed: true, output: 'Skipped', duration: 0 },
      ],
    };

    const formatted = formatValidationSummary(summary);

    expect(formatted).toContain('**tests** (3.5s)');
    expect(formatted).not.toContain('**lint** (0');
  });

  it('should include all passed steps without error blocks', () => {
    const summary: ValidationSummary = {
      passed: true,
      totalDuration: 2000,
      results: [
        { name: 'tests', passed: true, output: 'Success', duration: 1000 },
        { name: 'lint', passed: true, output: 'OK', duration: 1000 },
      ],
    };

    const formatted = formatValidationSummary(summary);

    // Should not contain code blocks for passing tests
    const codeBlockCount = (formatted.match(/```/g) || []).length;
    expect(codeBlockCount).toBe(0);
  });

  it('should include code blocks only for failed steps', () => {
    const summary: ValidationSummary = {
      passed: false,
      totalDuration: 2000,
      results: [
        { name: 'tests', passed: true, output: 'Success', duration: 1000 },
        { name: 'lint', passed: false, output: 'Error here', duration: 1000 },
      ],
    };

    const formatted = formatValidationSummary(summary);

    // Should contain one pair of code blocks (open and close)
    const codeBlockCount = (formatted.match(/```/g) || []).length;
    expect(codeBlockCount).toBe(2);
    expect(formatted).toContain('Error here');
  });
});

describe('ValidationResult interface', () => {
  it('should have correct structure', () => {
    const result: ValidationResult = {
      name: 'tests',
      passed: true,
      output: 'All tests passed',
      duration: 1000,
    };

    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('output');
    expect(result).toHaveProperty('duration');
  });

  it('should allow passed to be false', () => {
    const result: ValidationResult = {
      name: 'lint',
      passed: false,
      output: 'Errors found',
      duration: 500,
    };

    expect(result.passed).toBe(false);
    expect(result.name).toBe('lint');
  });
});

describe('ValidationSummary interface', () => {
  it('should have correct structure', () => {
    const summary: ValidationSummary = {
      passed: true,
      results: [],
      totalDuration: 0,
    };

    expect(summary).toHaveProperty('passed');
    expect(summary).toHaveProperty('results');
    expect(summary).toHaveProperty('totalDuration');
  });

  it('should reflect overall pass when all results pass', () => {
    const summary: ValidationSummary = {
      passed: true,
      results: [
        { name: 'tests', passed: true, output: '', duration: 100 },
        { name: 'lint', passed: true, output: '', duration: 100 },
      ],
      totalDuration: 200,
    };

    expect(summary.passed).toBe(true);
    expect(summary.results.every((r) => r.passed)).toBe(true);
  });

  it('should reflect overall fail when any result fails', () => {
    const summary: ValidationSummary = {
      passed: false,
      results: [
        { name: 'tests', passed: true, output: '', duration: 100 },
        { name: 'lint', passed: false, output: 'error', duration: 100 },
      ],
      totalDuration: 200,
    };

    expect(summary.passed).toBe(false);
    expect(summary.results.some((r) => !r.passed)).toBe(true);
  });
});
