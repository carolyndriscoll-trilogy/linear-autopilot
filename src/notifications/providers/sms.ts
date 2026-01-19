import { NotificationProvider, NotificationEvent } from '../types';
import { formatPlain } from '../formatter';

export const smsProvider: NotificationProvider = {
  name: 'sms',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { accountSid, authToken, from, to } = config;

    if (!accountSid || !authToken) {
      throw new Error('Twilio accountSid and authToken are required for SMS');
    }

    if (!from || !to) {
      throw new Error('SMS "from" and "to" phone numbers are required');
    }

    // Truncate message for SMS (160 char limit for single SMS)
    const fullMessage = formatPlain(event);
    const message = fullMessage.length > 160
      ? fullMessage.slice(0, 157) + '...'
      : fullMessage;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const body = new URLSearchParams({
      To: to,
      From: from,
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
      throw new Error(`Twilio SMS failed: ${response.status} ${error}`);
    }
  },
};
