import { NotificationProvider, NotificationEvent } from '../types';
import { formatMarkdown, formatPlain } from '../formatter';

export const emailProvider: NotificationProvider = {
  name: 'email',

  async send(event: NotificationEvent, config: Record<string, string>): Promise<void> {
    const { to, from, apiKey, provider = 'resend' } = config;

    if (!to) {
      throw new Error('Email "to" address is required');
    }

    const subject = `[Linear Autopilot] ${event.type}: ${event.ticket.identifier}`;
    const text = formatPlain(event);
    const html = formatMarkdown(event).replace(/\n/g, '<br>');

    if (provider === 'resend') {
      await sendWithResend(apiKey, from || 'autopilot@resend.dev', to, subject, text, html);
    } else if (provider === 'sendgrid') {
      await sendWithSendGrid(apiKey, from || 'autopilot@example.com', to, subject, text, html);
    } else {
      console.warn(`Email provider "${provider}" not implemented, logging instead:`);
      console.log(`To: ${to}, Subject: ${subject}\n${text}`);
    }
  },
};

async function sendWithResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<void> {
  if (!apiKey) {
    throw new Error('Resend API key is required');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API failed: ${response.status} ${error}`);
  }
}

async function sendWithSendGrid(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<void> {
  if (!apiKey) {
    throw new Error('SendGrid API key is required');
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SendGrid API failed: ${response.status} ${error}`);
  }
}
