// Shared webhook request utility for notification providers

export async function sendWebhook(
  url: string,
  payload: object,
  serviceName: string
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`${serviceName} webhook failed: ${response.status} ${text}`);
  }
}
