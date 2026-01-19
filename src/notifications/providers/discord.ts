import { NotificationProvider, NotificationEvent } from '../types';
import { formatDiscordEmbed } from '../formatter';

export const discordProvider: NotificationProvider = {
  name: 'discord',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { webhookUrl } = config;

    if (!webhookUrl) {
      throw new Error('Discord webhookUrl is required');
    }

    const payload = formatDiscordEmbed(event);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord webhook failed: ${response.status} ${text}`);
    }
  },
};
