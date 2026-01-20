import { NotificationProvider, NotificationEvent } from '../types';
import { formatDiscordEmbed } from '../formatter';
import { sendWebhook } from '../webhook';

export const discordProvider: NotificationProvider = {
  name: 'discord',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { webhookUrl } = config;

    if (!webhookUrl) {
      throw new Error('Discord webhookUrl is required');
    }

    const payload = formatDiscordEmbed(event);
    await sendWebhook(webhookUrl, payload, 'Discord');
  },
};
