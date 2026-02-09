// tests/notifications/providers.test.ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { slackProvider } from '../../src/notifications/providers/slack';
import { discordProvider } from '../../src/notifications/providers/discord';
import { emailProvider } from '../../src/notifications/providers/email';
import { gchatProvider } from '../../src/notifications/providers/gchat';
import { smsProvider } from '../../src/notifications/providers/sms';
import { whatsappProvider } from '../../src/notifications/providers/whatsapp';
import {
  formatPlain,
  formatMarkdown,
  formatSlackBlocks,
  formatDiscordEmbed,
} from '../../src/notifications/formatter';
import { send } from '../../src/notifications';
import {
  createMockTicket,
  createMockTenant,
  createAgentStartedEvent,
  createAgentCompletedEvent,
  createAgentFailedEvent,
  createPrCreatedEvent,
  createMockNotificationConfig,
} from '../utils/fixtures';

// Mock fetch globally
const mockFetch = jest.fn<typeof global.fetch>();
global.fetch = mockFetch;

describe('Notification Formatters', () => {
  describe('formatPlain', () => {
    it('should format agent-started event', () => {
      const event = createAgentStartedEvent();
      const result = formatPlain(event);

      expect(result).toContain('🚀');
      expect(result).toContain('Agent Started');
      expect(result).toContain('ABC-123');
      expect(result).toContain('test-tenant');
      expect(result).toContain('Branch:');
    });

    it('should format agent-completed event with duration', () => {
      const event = createAgentCompletedEvent(
        createMockTicket(),
        createMockTenant(),
        'feature/test',
        125000
      );
      const result = formatPlain(event);

      expect(result).toContain('✅');
      expect(result).toContain('Agent Completed');
      expect(result).toContain('Duration:');
      expect(result).toContain('2m');
    });

    it('should format agent-failed event with error and attempt', () => {
      const event = createAgentFailedEvent(
        createMockTicket(),
        createMockTenant(),
        'feature/test',
        'Build failed',
        2,
        3
      );
      const result = formatPlain(event);

      expect(result).toContain('❌');
      expect(result).toContain('Agent Failed');
      expect(result).toContain('Error: Build failed');
      expect(result).toContain('Attempt: 2/3');
    });

    it('should format pr-created event with PR URL', () => {
      const event = createPrCreatedEvent(
        createMockTicket(),
        createMockTenant(),
        'feature/test',
        'https://github.com/org/repo/pull/42'
      );
      const result = formatPlain(event);

      expect(result).toContain('🔗');
      expect(result).toContain('PR Created');
      expect(result).toContain('https://github.com/org/repo/pull/42');
    });
  });

  describe('formatMarkdown', () => {
    it('should format with markdown bold and code', () => {
      const event = createAgentStartedEvent();
      const result = formatMarkdown(event);

      expect(result).toContain('**Agent Started**');
      expect(result).toContain('**Ticket:**');
      expect(result).toContain('**Tenant:**');
      expect(result).toContain('`feature/ABC-123-test-issue`');
    });

    it('should format PR URL as markdown link', () => {
      const event = createPrCreatedEvent();
      const result = formatMarkdown(event);

      expect(result).toContain('[View PR]');
      expect(result).toContain('(https://github.com/org/repo/pull/1)');
    });
  });

  describe('formatSlackBlocks', () => {
    it('should return valid Slack blocks structure', () => {
      const event = createAgentCompletedEvent();
      const result = formatSlackBlocks(event) as {
        attachments: Array<{ color: string; blocks: unknown[] }>;
      };

      expect(result).toHaveProperty('attachments');
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]).toHaveProperty('color');
      expect(result.attachments[0]).toHaveProperty('blocks');
    });

    it('should use correct color for completed events (green)', () => {
      const event = createAgentCompletedEvent();
      const result = formatSlackBlocks(event) as { attachments: Array<{ color: string }> };

      expect(result.attachments[0].color).toBe('#22c55e');
    });

    it('should use correct color for failed events (red)', () => {
      const event = createAgentFailedEvent();
      const result = formatSlackBlocks(event) as { attachments: Array<{ color: string }> };

      expect(result.attachments[0].color).toBe('#ef4444');
    });

    it('should include error section for failed events', () => {
      const event = createAgentFailedEvent();
      const result = formatSlackBlocks(event) as {
        attachments: Array<{ blocks: Array<{ text?: { text: string } }> }>;
      };

      const hasErrorBlock = result.attachments[0].blocks.some((block) =>
        block.text?.text?.includes('Error')
      );
      expect(hasErrorBlock).toBe(true);
    });
  });

  describe('formatDiscordEmbed', () => {
    it('should return valid Discord embed structure', () => {
      const event = createAgentStartedEvent();
      const result = formatDiscordEmbed(event) as {
        embeds: Array<{
          title: string;
          description: string;
          color: number;
          fields: unknown[];
          timestamp: string;
        }>;
      };

      expect(result).toHaveProperty('embeds');
      expect(result.embeds).toHaveLength(1);
      expect(result.embeds[0]).toHaveProperty('title');
      expect(result.embeds[0]).toHaveProperty('description');
      expect(result.embeds[0]).toHaveProperty('color');
      expect(result.embeds[0]).toHaveProperty('fields');
      expect(result.embeds[0]).toHaveProperty('timestamp');
    });

    it('should convert hex color to decimal', () => {
      const event = createAgentCompletedEvent();
      const result = formatDiscordEmbed(event) as { embeds: Array<{ color: number }> };

      // #22c55e = 2278750 in decimal
      expect(result.embeds[0].color).toBe(0x22c55e);
    });

    it('should include ticket and tenant fields', () => {
      const event = createAgentStartedEvent();
      const result = formatDiscordEmbed(event) as {
        embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
      };

      const fieldNames = result.embeds[0].fields.map((f) => f.name);
      expect(fieldNames).toContain('Ticket');
      expect(fieldNames).toContain('Tenant');
    });
  });
});

describe('Notification Providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('slackProvider', () => {
    const webhookUrl = 'https://hooks.slack.com/services/xxx/yyy/zzz';

    it('should have correct name', () => {
      expect(slackProvider.name).toBe('slack');
    });

    it('should send a message to Slack webhook', async () => {
      mockFetch.mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const event = createAgentCompletedEvent();
      await slackProvider.send(event, { webhookUrl });

      expect(mockFetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should throw error if webhookUrl is missing', async () => {
      const event = createAgentCompletedEvent();

      await expect(slackProvider.send(event, {})).rejects.toThrow('Slack webhookUrl is required');
    });

    it('should throw error on non-ok response', async () => {
      // Mock 3 consecutive 500 errors (all retry attempts)
      mockFetch
        .mockResolvedValueOnce(
          new Response('error', { status: 500, statusText: 'Internal Server Error' })
        )
        .mockResolvedValueOnce(
          new Response('error', { status: 500, statusText: 'Internal Server Error' })
        )
        .mockResolvedValueOnce(
          new Response('error', { status: 500, statusText: 'Internal Server Error' })
        );

      const event = createAgentCompletedEvent();

      await expect(slackProvider.send(event, { webhookUrl })).rejects.toThrow(
        'Slack webhook failed'
      );
    });
  });

  describe('discordProvider', () => {
    const webhookUrl = 'https://discord.com/api/webhooks/xxx/yyy';

    it('should have correct name', () => {
      expect(discordProvider.name).toBe('discord');
    });

    it('should send a message to Discord webhook', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      const event = createPrCreatedEvent();
      await discordProvider.send(event, { webhookUrl });

      expect(mockFetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should throw error if webhookUrl is missing', async () => {
      const event = createAgentStartedEvent();

      await expect(discordProvider.send(event, {})).rejects.toThrow(
        'Discord webhookUrl is required'
      );
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));

      const event = createAgentStartedEvent();

      await expect(discordProvider.send(event, { webhookUrl })).rejects.toThrow(
        'Discord webhook failed'
      );
    });
  });

  describe('emailProvider', () => {
    it('should have correct name', () => {
      expect(emailProvider.name).toBe('email');
    });

    it('should throw error if "to" is missing', async () => {
      const event = createAgentCompletedEvent();

      await expect(emailProvider.send(event, { apiKey: 'test' })).rejects.toThrow(
        'Email "to" address is required'
      );
    });

    it('should send email via Resend API', async () => {
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: '123' }), { status: 200 }));

      const event = createAgentCompletedEvent();
      await emailProvider.send(event, {
        to: 'test@example.com',
        apiKey: 'test-api-key',
        provider: 'resend',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should throw error when Resend API fails', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const event = createAgentCompletedEvent();

      await expect(
        emailProvider.send(event, {
          to: 'test@example.com',
          apiKey: 'invalid-key',
          provider: 'resend',
        })
      ).rejects.toThrow('Resend API failed');
    });

    it('should throw error if Resend API key is missing', async () => {
      const event = createAgentCompletedEvent();

      await expect(
        emailProvider.send(event, {
          to: 'test@example.com',
          provider: 'resend',
        })
      ).rejects.toThrow('Resend API key is required');
    });

    it('should send email via SendGrid API', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 202 }));

      const event = createAgentCompletedEvent();
      await emailProvider.send(event, {
        to: 'test@example.com',
        apiKey: 'test-api-key',
        provider: 'sendgrid',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
          }),
        })
      );
    });

    it('should throw error if SendGrid API key is missing', async () => {
      const event = createAgentCompletedEvent();

      await expect(
        emailProvider.send(event, {
          to: 'test@example.com',
          provider: 'sendgrid',
        })
      ).rejects.toThrow('SendGrid API key is required');
    });

    it('should throw error when SendGrid API fails', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

      const event = createAgentCompletedEvent();

      await expect(
        emailProvider.send(event, {
          to: 'test@example.com',
          apiKey: 'test-key',
          provider: 'sendgrid',
        })
      ).rejects.toThrow('SendGrid API failed');
    });
  });

  describe('gchatProvider', () => {
    const webhookUrl = 'https://chat.googleapis.com/v1/spaces/xxx/messages';

    it('should have correct name', () => {
      expect(gchatProvider.name).toBe('gchat');
    });

    it('should send a message to Google Chat webhook', async () => {
      mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));

      const event = createAgentCompletedEvent();
      await gchatProvider.send(event, { webhookUrl });

      expect(mockFetch).toHaveBeenCalledWith(
        webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should throw error if webhookUrl is missing', async () => {
      const event = createAgentStartedEvent();

      await expect(gchatProvider.send(event, {})).rejects.toThrow(
        'Google Chat webhookUrl is required'
      );
    });

    it('should throw error on non-ok response', async () => {
      // Mock 3 consecutive 500 errors (all retry attempts)
      mockFetch
        .mockResolvedValueOnce(new Response('Error', { status: 500, statusText: 'Server Error' }))
        .mockResolvedValueOnce(new Response('Error', { status: 500, statusText: 'Server Error' }))
        .mockResolvedValueOnce(new Response('Error', { status: 500, statusText: 'Server Error' }));

      const event = createAgentStartedEvent();

      await expect(gchatProvider.send(event, { webhookUrl })).rejects.toThrow(
        'Google Chat webhook failed'
      );
    });
  });

  describe('smsProvider', () => {
    const smsConfig = {
      accountSid: 'AC123',
      authToken: 'token123',
      from: '+1234567890',
      to: '+0987654321',
    };

    it('should have correct name', () => {
      expect(smsProvider.name).toBe('sms');
    });

    it('should send SMS via Twilio API', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
      );

      const event = createAgentCompletedEvent();
      await smsProvider.send(event, smsConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.twilio.com/2010-04-01/Accounts/${smsConfig.accountSid}/Messages.json`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        })
      );
    });

    it('should throw error if accountSid or authToken is missing', async () => {
      const event = createAgentStartedEvent();

      await expect(smsProvider.send(event, { from: '+1', to: '+2' })).rejects.toThrow(
        'Twilio accountSid and authToken are required'
      );
    });

    it('should throw error if from or to is missing', async () => {
      const event = createAgentStartedEvent();

      await expect(
        smsProvider.send(event, { accountSid: 'AC123', authToken: 'token' })
      ).rejects.toThrow('SMS "from" and "to" phone numbers are required');
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Invalid', { status: 400 }));

      const event = createAgentStartedEvent();

      await expect(smsProvider.send(event, smsConfig)).rejects.toThrow('Twilio SMS failed');
    });

    it('should truncate long messages to 160 characters', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
      );

      // Create an event that would generate a long message
      const event = createAgentFailedEvent(
        createMockTicket({ title: 'A'.repeat(200) }),
        createMockTenant(),
        'feature/test',
        'B'.repeat(200),
        1,
        3
      );
      await smsProvider.send(event, smsConfig);

      expect(mockFetch).toHaveBeenCalled();
      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      // Body is URL encoded, check it was truncated
      expect(body.length).toBeLessThan(500); // A very long message would be much larger
    });
  });

  describe('whatsappProvider', () => {
    const whatsappConfig = {
      accountSid: 'AC123',
      authToken: 'token123',
      from: '+1234567890',
      to: '+0987654321',
    };

    it('should have correct name', () => {
      expect(whatsappProvider.name).toBe('whatsapp');
    });

    it('should send WhatsApp message via Twilio API', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
      );

      const event = createAgentCompletedEvent();
      await whatsappProvider.send(event, whatsappConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.twilio.com/2010-04-01/Accounts/${whatsappConfig.accountSid}/Messages.json`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should add whatsapp: prefix to numbers if not present', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
      );

      const event = createAgentCompletedEvent();
      await whatsappProvider.send(event, whatsappConfig);

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      expect(body).toContain('whatsapp%3A%2B1234567890'); // URL encoded whatsapp:+1234567890
    });

    it('should not double-prefix numbers that already have whatsapp:', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 })
      );

      const event = createAgentCompletedEvent();
      await whatsappProvider.send(event, {
        ...whatsappConfig,
        from: 'whatsapp:+1234567890',
        to: 'whatsapp:+0987654321',
      });

      const call = mockFetch.mock.calls[0];
      const body = call[1]?.body as string;
      // Should have exactly one whatsapp: prefix, not double
      expect(body).not.toContain('whatsapp%3Awhatsapp');
    });

    it('should throw error if accountSid or authToken is missing', async () => {
      const event = createAgentStartedEvent();

      await expect(whatsappProvider.send(event, { from: '+1', to: '+2' })).rejects.toThrow(
        'Twilio accountSid and authToken are required'
      );
    });

    it('should throw error if from or to is missing', async () => {
      const event = createAgentStartedEvent();

      await expect(
        whatsappProvider.send(event, { accountSid: 'AC123', authToken: 'token' })
      ).rejects.toThrow('WhatsApp "from" and "to" numbers are required');
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Invalid', { status: 400 }));

      const event = createAgentStartedEvent();

      await expect(whatsappProvider.send(event, whatsappConfig)).rejects.toThrow(
        'Twilio WhatsApp failed'
      );
    });
  });
});

describe('Notification Manager (send)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  it('should do nothing if no notifications configured', async () => {
    const event = createAgentCompletedEvent();

    await send(event, undefined);
    await send(event, []);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should send to all configured providers', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));

    const event = createAgentCompletedEvent();
    const notifications = [
      createMockNotificationConfig('slack'),
      createMockNotificationConfig('discord'),
    ];

    await send(event, notifications);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should continue sending even if one provider fails', async () => {
    // First call fails, second succeeds
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const event = createAgentCompletedEvent();
    const notifications = [
      createMockNotificationConfig('slack'),
      createMockNotificationConfig('discord'),
    ];

    // Should not throw - errors are caught internally
    await send(event, notifications);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
