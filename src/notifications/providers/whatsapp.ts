import { NotificationProvider, NotificationEvent } from '../types';
import { formatPlain } from '../formatter';

export const whatsappProvider: NotificationProvider = {
  name: 'whatsapp',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { accountSid, authToken, from, to } = config;

    if (!accountSid || !authToken) {
      throw new Error('Twilio accountSid and authToken are required for WhatsApp');
    }

    if (!from || !to) {
      throw new Error('WhatsApp "from" and "to" numbers are required');
    }

    const message = formatPlain(event);

    // WhatsApp uses Twilio's API with whatsapp: prefix
    const fromNumber = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const body = new URLSearchParams({
      To: toNumber,
      From: fromNumber,
      Body: message,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twilio WhatsApp failed: ${response.status} ${error}`);
    }
  },
};
