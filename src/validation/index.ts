import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger';
import { VALIDATION_TIMEOUT_MS } from '../constants';
import { ValidationConfig } from '../config/tenants';

export interface ValidationResult {
  name: string;
  passed: boolean;
  output: string;
  duration: number;
}

export interface ValidationSummary {
  passed: boolean;
  results: ValidationResult[];
  totalDuration: number;
}

const COVERAGE_THRESHOLD = parseInt(process.env.COVERAGE_THRESHOLD || '0', 10);

function hasScript(repoPath: string, scriptName: string): boolean {
  try {
    const packageJsonPath = join(repoPath, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return false;
    }
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    return !!packageJson.scripts?.[scriptName];
  } catch {
    return false;
  }
}

function hasTsConfig(repoPath: string): boolean {
  return existsSync(join(repoPath, 'tsconfig.json'));
}

async function runCommand(
  command: string,
  args: string[],
  repoPath: string,
  name: string,
  timeoutMs: number = VALIDATION_TIMEOUT_MS
): Promise<ValidationResult> {
  const startTime = Date.now();

  logger.debug('Running validation step', { name, command, args });

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoPath,
      env: { ...process.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      const duration = Date.now() - startTime;
      resolve({
        name,
        passed: false,
        output: `Timed out after ${timeoutMs}ms`,
        duration,
      });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      const output = (stdout + stderr).slice(-5000); // Keep last 5000 chars
      const passed = code === 0;

      logger.debug('Validation step completed', { name, passed, duration });

      resolve({
        name,
        passed,
        output,
        duration,
      });
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      resolve({
        name,
        passed: false,
        output: error.message,
        duration,
      });
    });
  });
}

async function runTests(repoPath: string): Promise<ValidationResult> {
  if (!hasScript(repoPath, 'test')) {
    return {
      name: 'tests',
      passed: true,
      output: 'No test script found, skipping',
      duration: 0,
    };
  }

  return runCommand('npm', ['test'], repoPath, 'tests');
}

async function runLint(repoPath: string): Promise<ValidationResult> {
  if (!hasScript(repoPath, 'lint')) {
    return {
      name: 'lint',
      passed: true,
      output: 'No lint script found, skipping',
      duration: 0,
    };
  }

  return runCommand('npm', ['run', 'lint'], repoPath, 'lint');
}

async function runTypeCheck(repoPath: string): Promise<ValidationResult> {
  if (!hasTsConfig(repoPath)) {
    return {
      name: 'typecheck',
      passed: true,
      output: 'No tsconfig.json found, skipping',
      duration: 0,
    };
  }

  return runCommand('npx', ['tsc', '--noEmit'], repoPath, 'typecheck');
}

function checkCoverage(repoPath: string): ValidationResult {
  if (COVERAGE_THRESHOLD <= 0) {
    return {
      name: 'coverage',
      passed: true,
      output: 'Coverage threshold not set, skipping',
      duration: 0,
    };
  }

  // Try to find coverage report
  const coveragePaths = [
    join(repoPath, 'coverage', 'coverage-summary.json'),
    join(repoPath, 'coverage', 'lcov-report', 'index.html'),
  ];

  const startTime = Date.now();

  for (const coveragePath of coveragePaths) {
    if (!existsSync(coveragePath)) continue;

    try {
      if (coveragePath.endsWith('.json')) {
        const coverage = JSON.parse(readFileSync(coveragePath, 'utf-8'));
        const totalCoverage = coverage.total?.lines?.pct || 0;
        const passed = totalCoverage >= COVERAGE_THRESHOLD;

        return {
          name: 'coverage',
          passed,
          output: `Line coverage: ${totalCoverage.toFixed(1)}% (threshold: ${COVERAGE_THRESHOLD}%)`,
          duration: Date.now() - startTime,
        };
      }
    } catch {
      // Continue to next path
    }
  }

  return {
    name: 'coverage',
    passed: true,
    output: 'No coverage report found, skipping',
    duration: Date.now() - startTime,
  };
}

export async function validate(
  repoPath: string,
  config?: ValidationConfig
): Promise<ValidationSummary> {
  const startTime = Date.now();

  logger.info('Starting validation pipeline', {
    repoPath,
    customSteps: config ? config.steps.length : 0,
  });

  const results: ValidationResult[] = [];
  const timeoutMs = config?.timeoutMs || VALIDATION_TIMEOUT_MS;

  if (config?.steps && config.steps.length > 0) {
    // Run custom validation steps
    for (const step of config.steps) {
      results.push(await runCommand(step.command, step.args, repoPath, step.name, timeoutMs));
    }
  } else {
    // Default auto-detection behavior
    results.push(await runTests(repoPath));
    if (!results[results.length - 1].passed) {
      logger.warn('Tests failed, stopping validation', { repoPath });
    }

    results.push(await runLint(repoPath));
    results.push(await runTypeCheck(repoPath));
    results.push(checkCoverage(repoPath));
  }

  const totalDuration = Date.now() - startTime;
  const passed = results.every((r) => r.passed);

  logger.info('Validation pipeline completed', {
    repoPath,
    passed,
    totalDuration,
    results: results.map((r) => ({ name: r.name, passed: r.passed })),
  });

  return {
    passed,
    results,
    totalDuration,
  };
}

export function formatValidationSummary(summary: ValidationSummary): string {
  const lines: string[] = [];

  lines.push(summary.passed ? '## Validation Passed' : '## Validation Failed');
  lines.push('');

  for (const result of summary.results) {
    const icon = result.passed ? '✅' : '❌';
    const time = result.duration > 0 ? ` (${(result.duration / 1000).toFixed(1)}s)` : '';
    lines.push(`${icon} **${result.name}**${time}`);

    if (!result.passed && result.output) {
      lines.push('```');
      lines.push(result.output.slice(0, 1000));
      if (result.output.length > 1000) {
        lines.push('...(truncated)');
      }
      lines.push('```');
    }
  }

  lines.push('');
  lines.push(`Total time: ${(summary.totalDuration / 1000).toFixed(1)}s`);

  return lines.join('\n');
}
