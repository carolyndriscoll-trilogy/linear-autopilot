import { NotificationProvider, NotificationEvent } from '../types';
import { formatSlackBlocks } from '../formatter';

export const slackProvider: NotificationProvider = {
  name: 'slack',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { webhookUrl } = config;

    if (!webhookUrl) {
      throw new Error('Slack webhookUrl is required');
    }

    const payload = formatSlackBlocks(event);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
    }
  },
};
