import { NotificationProvider, NotificationEvent } from '../types';
import { formatSlackBlocks } from '../formatter';
import { sendWebhook } from '../webhook';

export const slackProvider: NotificationProvider = {
  name: 'slack',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { webhookUrl } = config;

    if (!webhookUrl) {
      throw new Error('Slack webhookUrl is required');
    }

    const payload = formatSlackBlocks(event);
    await sendWebhook(webhookUrl, payload, 'Slack');
  },
};
