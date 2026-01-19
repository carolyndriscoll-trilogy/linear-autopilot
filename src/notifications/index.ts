import { NotificationType, NotificationConfig } from '../config/tenants';
import { NotificationEvent, NotificationProvider } from './types';
import { logger } from '../logger';
import { slackProvider } from './providers/slack';
import { discordProvider } from './providers/discord';
import { emailProvider } from './providers/email';
import { gchatProvider } from './providers/gchat';
import { smsProvider } from './providers/sms';
import { whatsappProvider } from './providers/whatsapp';

export * from './types';

const providers: Record<NotificationType, NotificationProvider> = {
  slack: slackProvider,
  discord: discordProvider,
  email: emailProvider,
  gchat: gchatProvider,
  sms: smsProvider,
  whatsapp: whatsappProvider,
};

export async function send(
  event: NotificationEvent,
  notifications: NotificationConfig[] | undefined
): Promise<void> {
  if (!notifications || notifications.length === 0) {
    return;
  }

  const results = await Promise.allSettled(
    notifications.map(async (notification) => {
      const provider = providers[notification.type];

      if (!provider) {
        logger.warn('Unknown notification provider', { type: notification.type });
        return;
      }

      try {
        await provider.send(event, notification.config);
        logger.debug('Notification sent', { type: notification.type, ticketId: event.ticket.identifier });
      } catch (error) {
        logger.error('Failed to send notification', { type: notification.type, error: String(error) });
        throw error;
      }
    })
  );

  // Log any failures but don't fail the overall operation
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    logger.warn('Some notifications failed', { failed: failures.length, total: notifications.length });
  }
}

export async function notify(
  event: NotificationEvent
): Promise<void> {
  return send(event, event.tenant.notifications);
}

// Convenience functions for creating events
export function createAgentStartedEvent(
  ticket: NotificationEvent['ticket'],
  tenant: NotificationEvent['tenant'],
  branchName: string
): NotificationEvent {
  return {
    type: 'agent-started',
    ticket,
    tenant,
    branchName,
    timestamp: new Date(),
  };
}

export function createAgentCompletedEvent(
  ticket: NotificationEvent['ticket'],
  tenant: NotificationEvent['tenant'],
  branchName: string,
  duration: number
): NotificationEvent {
  return {
    type: 'agent-completed',
    ticket,
    tenant,
    branchName,
    duration,
    timestamp: new Date(),
  };
}

export function createAgentFailedEvent(
  ticket: NotificationEvent['ticket'],
  tenant: NotificationEvent['tenant'],
  branchName: string,
  error: string,
  attempt: number,
  maxAttempts: number
): NotificationEvent {
  return {
    type: 'agent-failed',
    ticket,
    tenant,
    branchName,
    error,
    attempt,
    maxAttempts,
    timestamp: new Date(),
  };
}

export function createAgentStuckEvent(
  ticket: NotificationEvent['ticket'],
  tenant: NotificationEvent['tenant'],
  branchName: string,
  runningFor: number,
  lastActivity?: string
): NotificationEvent {
  return {
    type: 'agent-stuck',
    ticket,
    tenant,
    branchName,
    runningFor,
    lastActivity,
    timestamp: new Date(),
  };
}

export function createPrCreatedEvent(
  ticket: NotificationEvent['ticket'],
  tenant: NotificationEvent['tenant'],
  branchName: string,
  prUrl: string
): NotificationEvent {
  return {
    type: 'pr-created',
    ticket,
    tenant,
    branchName,
    prUrl,
    timestamp: new Date(),
  };
}
