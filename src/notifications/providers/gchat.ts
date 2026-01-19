import { NotificationProvider, NotificationEvent } from '../types';
import { formatPlain } from '../formatter';

export const gchatProvider: NotificationProvider = {
  name: 'gchat',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { webhookUrl } = config;

    if (!webhookUrl) {
      throw new Error('Google Chat webhookUrl is required');
    }

    // Google Chat uses a simpler format
    const text = formatPlain(event);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Google Chat webhook failed: ${response.status} ${response.statusText}`);
    }
  },
};
