// src/constants.ts
// Shared constants used across the application

// Retry configuration
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;

// Agent timeouts
export const STUCK_THRESHOLD_MS = parseInt(process.env.AGENT_STUCK_THRESHOLD_MS || '600000', 10);
export const AGENT_TIMEOUT_MS = parseInt(process.env.AGENT_TIMEOUT_MS || '1800000', 10); // 30 minutes

// Spawner intervals
export const SPAWNER_POLL_INTERVAL_MS = 2000;
export const SPAWNER_HEALTH_CHECK_INTERVAL_MS = 60000;

// Git operation timeouts
const GIT_TIMEOUT_BASE = parseInt(process.env.GIT_OPERATION_TIMEOUT_MS || '30000', 10);
export const GIT_TIMEOUT_MS = {
  local: GIT_TIMEOUT_BASE, // git diff, git log, git branch, git checkout: 30s
  push: GIT_TIMEOUT_BASE * 4, // git push: 2 minutes
  ghPrCreate: GIT_TIMEOUT_BASE * 2, // gh pr create: 1 minute
} as const;

// Validation
export const VALIDATION_TIMEOUT_MS = parseInt(process.env.VALIDATION_TIMEOUT_MS || '300000', 10); // 5 minutes

// Kill escalation grace period (SIGTERM -> SIGKILL)
export const SIGKILL_GRACE_MS = parseInt(process.env.SIGKILL_GRACE_MS || '5000', 10);

// Notification colors (hex)
export const COLORS = {
  success: '#22c55e', // green
  error: '#ef4444', // red
  warning: '#f59e0b', // amber
  info: '#3b82f6', // blue
  started: '#8b5cf6', // purple
} as const;

// Memory limits
export const MEMORY_LIMITS = {
  maxErrors: 20,
  maxPatterns: 30,
} as const;

// Webhook retry configuration
export const WEBHOOK_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1s, 2s, 4s exponential backoff
} as const;
