import { sendWebhook } from '../../src/notifications/webhook';

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('sendWebhook', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should send a POST request with JSON payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
    });

    const payload = { text: 'Hello, World!' };
    await sendWebhook('https://example.com/webhook', payload, 'TestService');

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  it('should throw error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(
      sendWebhook('https://example.com/webhook', { text: 'test' }, 'TestService')
    ).rejects.toThrow('TestService webhook failed: 500 Internal Server Error');
  });

  it('should handle text() rejection gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.reject(new Error('Cannot read body')),
    });

    await expect(
      sendWebhook('https://example.com/webhook', { text: 'test' }, 'TestService')
    ).rejects.toThrow('TestService webhook failed: 403 Forbidden');
  });

  it('should include service name in error message', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(sendWebhook('https://example.com/webhook', {}, 'Slack')).rejects.toThrow(
      'Slack webhook failed'
    );

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    await expect(sendWebhook('https://example.com/webhook', {}, 'Discord')).rejects.toThrow(
      'Discord webhook failed'
    );
  });
});
