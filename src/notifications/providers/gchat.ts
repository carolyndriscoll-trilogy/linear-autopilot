import { NotificationProvider, NotificationEvent } from '../types';
import { formatPlain } from '../formatter';
import { sendWebhook } from '../webhook';

export const gchatProvider: NotificationProvider = {
  name: 'gchat',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { webhookUrl } = config;

    if (!webhookUrl) {
      throw new Error('Google Chat webhookUrl is required');
    }

    // Google Chat uses a simpler format
    const text = formatPlain(event);
    await sendWebhook(webhookUrl, { text }, 'Google Chat');
  },
};
