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

  it('should throw error on non-ok response after retries for 5xx', async () => {
    // Mock 3 consecutive 500 errors (all retry attempts)
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

    await expect(
      sendWebhook('https://example.com/webhook', { text: 'test' }, 'TestService')
    ).rejects.toThrow('TestService webhook failed: 500 Internal Server Error');

    // Should have tried 3 times
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should not retry on 4xx client errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    });

    await expect(
      sendWebhook('https://example.com/webhook', { text: 'test' }, 'TestService')
    ).rejects.toThrow('TestService webhook failed: 400 Bad Request');

    // Should NOT retry on 4xx
    expect(mockFetch).toHaveBeenCalledTimes(1);
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

  it('should retry on network errors', async () => {
    // First two attempts fail with network error, third succeeds
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ ok: true });

    await sendWebhook('https://example.com/webhook', { text: 'test' }, 'TestService');

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should succeed on retry after initial 5xx failure', async () => {
    // First attempt fails with 500, second succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      })
      .mockResolvedValueOnce({ ok: true });

    await sendWebhook('https://example.com/webhook', { text: 'test' }, 'TestService');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
