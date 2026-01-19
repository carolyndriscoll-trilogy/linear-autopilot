import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../logger';

export interface CostRecord {
  ticketId: string;
  tokens: {
    input: number;
    output: number;
  };
  estimatedCost: number;
  timestamp: string;
  tenant?: string;
}

interface CostFile {
  records: CostRecord[];
}

const TRACKING_DIR = '.linear-autopilot';
const COSTS_FILE = 'costs.json';

// Pricing per 1M tokens (Claude 3.5 Sonnet pricing as of 2024)
const PRICING = {
  input: 3.00, // $3 per 1M input tokens
  output: 15.00, // $15 per 1M output tokens
};

function getCostsPath(repoPath: string): string {
  return join(repoPath, TRACKING_DIR, COSTS_FILE);
}

function loadCosts(repoPath: string): CostRecord[] {
  const costsPath = getCostsPath(repoPath);

  if (!existsSync(costsPath)) {
    return [];
  }

  try {
    const content = readFileSync(costsPath, 'utf-8');
    const data = JSON.parse(content) as CostFile;
    return data.records || [];
  } catch (error) {
    logger.error('Error reading costs file', { repoPath, error: String(error) });
    return [];
  }
}

function saveCosts(repoPath: string, records: CostRecord[]): void {
  const costsPath = getCostsPath(repoPath);
  const costsDir = dirname(costsPath);

  if (!existsSync(costsDir)) {
    mkdirSync(costsDir, { recursive: true });
  }

  const data: CostFile = { records };
  writeFileSync(costsPath, JSON.stringify(data, null, 2));
}

// Parse token usage from Claude Code output
// Claude Code outputs lines like:
// "Tokens: 1234 input, 5678 output"
// or JSON format: {"input_tokens": 1234, "output_tokens": 5678}
export function parseTokenUsage(output: string): { input: number; output: number } | null {
  // Try pattern: "Tokens: X input, Y output"
  const simplePattern = /tokens?:?\s*(\d+)\s*input\s*,?\s*(\d+)\s*output/i;
  const simpleMatch = output.match(simplePattern);
  if (simpleMatch) {
    return {
      input: parseInt(simpleMatch[1], 10),
      output: parseInt(simpleMatch[2], 10),
    };
  }

  // Try pattern: "input: X, output: Y" or "input_tokens: X, output_tokens: Y"
  const labeledPattern = /input[_\s]*tokens?:?\s*(\d+)[\s,]+output[_\s]*tokens?:?\s*(\d+)/i;
  const labeledMatch = output.match(labeledPattern);
  if (labeledMatch) {
    return {
      input: parseInt(labeledMatch[1], 10),
      output: parseInt(labeledMatch[2], 10),
    };
  }

  // Try to find JSON with token info
  const jsonPattern = /\{"[^"]*input[^"]*":\s*(\d+)[^}]*"[^"]*output[^"]*":\s*(\d+)[^}]*\}/i;
  const jsonMatch = output.match(jsonPattern);
  if (jsonMatch) {
    return {
      input: parseInt(jsonMatch[1], 10),
      output: parseInt(jsonMatch[2], 10),
    };
  }

  // Try pattern for summary lines: "Total tokens used: X"
  const totalPattern = /total[_\s]*tokens?[_\s]*used?:?\s*(\d+)/i;
  const totalMatch = output.match(totalPattern);
  if (totalMatch) {
    // Assume 50/50 split if only total is provided
    const total = parseInt(totalMatch[1], 10);
    return {
      input: Math.floor(total / 2),
      output: Math.ceil(total / 2),
    };
  }

  return null;
}

function calculateCost(tokens: { input: number; output: number }): number {
  const inputCost = (tokens.input / 1_000_000) * PRICING.input;
  const outputCost = (tokens.output / 1_000_000) * PRICING.output;
  return Math.round((inputCost + outputCost) * 10000) / 10000; // Round to 4 decimal places
}

export function recordUsage(
  repoPath: string,
  ticketId: string,
  output: string,
  tenant?: string
): CostRecord | null {
  const tokens = parseTokenUsage(output);

  if (!tokens) {
    logger.debug('No token usage found in output', { ticketId });
    return null;
  }

  const record: CostRecord = {
    ticketId,
    tokens,
    estimatedCost: calculateCost(tokens),
    timestamp: new Date().toISOString(),
    tenant,
  };

  logger.info('Recorded token usage', {
    ticketId,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    estimatedCost: record.estimatedCost,
  });

  const records = loadCosts(repoPath);
  records.push(record);

  // Keep last 1000 records
  if (records.length > 1000) {
    records.splice(0, records.length - 1000);
  }

  saveCosts(repoPath, records);

  return record;
}

export function getCosts(repoPath: string): CostRecord[] {
  return loadCosts(repoPath);
}

export function getTotalCost(repoPath: string): number {
  const records = loadCosts(repoPath);
  return records.reduce((sum, r) => sum + r.estimatedCost, 0);
}

export function getRecentCosts(repoPath: string, count: number = 20): CostRecord[] {
  const records = loadCosts(repoPath);
  return records.slice(-count);
}

export interface CostSummary {
  totalRecords: number;
  totalCost: number;
  totalTokens: { input: number; output: number };
  recentRecords: CostRecord[];
}

export function getCostSummary(repoPath: string): CostSummary {
  const records = loadCosts(repoPath);

  const totalTokens = records.reduce(
    (sum, r) => ({
      input: sum.input + r.tokens.input,
      output: sum.output + r.tokens.output,
    }),
    { input: 0, output: 0 }
  );

  return {
    totalRecords: records.length,
    totalCost: records.reduce((sum, r) => sum + r.estimatedCost, 0),
    totalTokens,
    recentRecords: records.slice(-20),
  };
}
