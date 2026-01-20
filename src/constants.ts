// src/constants.ts
// Shared constants used across the application

// Retry configuration
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;

// Agent timeouts
export const STUCK_THRESHOLD_MS = parseInt(process.env.AGENT_STUCK_THRESHOLD_MS || '600000', 10);

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
