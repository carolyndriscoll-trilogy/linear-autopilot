// Shared webhook request utility for notification providers

import { WEBHOOK_RETRY } from '../constants';
import { logger } from '../logger';

function isRetryableError(status: number): boolean {
  // Retry on 5xx server errors, not on 4xx client errors
  return status >= 500 && status < 600;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWebhook(
  url: string,
  payload: object,
  serviceName: string
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < WEBHOOK_RETRY.maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return; // Success
      }

      const text = await response.text().catch(() => response.statusText);
      lastError = new Error(`${serviceName} webhook failed: ${response.status} ${text}`);

      // Don't retry on 4xx client errors
      if (!isRetryableError(response.status)) {
        throw lastError;
      }

      // Log retry attempt for 5xx errors
      if (attempt < WEBHOOK_RETRY.maxAttempts - 1) {
        const delayMs = WEBHOOK_RETRY.baseDelayMs * Math.pow(2, attempt);
        logger.warn('Webhook request failed, retrying', {
          service: serviceName,
          status: response.status,
          attempt: attempt + 1,
          maxAttempts: WEBHOOK_RETRY.maxAttempts,
          retryInMs: delayMs,
        });
        await sleep(delayMs);
      }
    } catch (error) {
      // Network errors (fetch throws) are retryable
      if (error instanceof TypeError || (error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        lastError = new Error(`${serviceName} webhook network error: ${String(error)}`);

        if (attempt < WEBHOOK_RETRY.maxAttempts - 1) {
          const delayMs = WEBHOOK_RETRY.baseDelayMs * Math.pow(2, attempt);
          logger.warn('Webhook network error, retrying', {
            service: serviceName,
            error: String(error),
            attempt: attempt + 1,
            maxAttempts: WEBHOOK_RETRY.maxAttempts,
            retryInMs: delayMs,
          });
          await sleep(delayMs);
        }
      } else if (lastError) {
        // Re-throw non-retryable errors (like 4xx that we caught above)
        throw error;
      } else {
        throw error;
      }
    }
  }

  // All retries exhausted
  if (lastError) {
    logger.error('Webhook request failed after all retries', {
      service: serviceName,
      attempts: WEBHOOK_RETRY.maxAttempts,
    });
    throw lastError;
  }
}
