import { NotificationEvent } from './types';

export type MessageFormat = 'markdown' | 'plain' | 'slack-blocks' | 'discord-embed';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function getEmoji(event: NotificationEvent): string {
  switch (event.type) {
    case 'agent-started':
      return '🚀';
    case 'agent-completed':
      return '✅';
    case 'agent-failed':
      return '❌';
    case 'agent-stuck':
      return '⚠️';
    case 'pr-created':
      return '🔗';
  }
}

function getTitle(event: NotificationEvent): string {
  switch (event.type) {
    case 'agent-started':
      return 'Agent Started';
    case 'agent-completed':
      return 'Agent Completed';
    case 'agent-failed':
      return 'Agent Failed';
    case 'agent-stuck':
      return 'Agent Stuck';
    case 'pr-created':
      return 'PR Created';
  }
}

function getColor(event: NotificationEvent): string {
  switch (event.type) {
    case 'agent-started':
      return '#3b82f6'; // blue
    case 'agent-completed':
      return '#22c55e'; // green
    case 'agent-failed':
      return '#ef4444'; // red
    case 'agent-stuck':
      return '#f59e0b'; // amber
    case 'pr-created':
      return '#8b5cf6'; // purple
  }
}

export function formatPlain(event: NotificationEvent): string {
  const emoji = getEmoji(event);
  const { ticket, tenant } = event;
  const base = `${emoji} ${getTitle(event)}: ${ticket.identifier} - ${ticket.title} (${tenant.name})`;

  switch (event.type) {
    case 'agent-started':
      return `${base}\nBranch: ${event.branchName}`;
    case 'agent-completed':
      return `${base}\nDuration: ${formatDuration(event.duration)}`;
    case 'agent-failed':
      return `${base}\nError: ${event.error}\nAttempt: ${event.attempt}/${event.maxAttempts}`;
    case 'agent-stuck':
      return `${base}\nRunning for: ${formatDuration(event.runningFor)}${event.lastActivity ? `\nLast activity: ${event.lastActivity}` : ''}`;
    case 'pr-created':
      return `${base}\nPR: ${event.prUrl}`;
  }
}

export function formatMarkdown(event: NotificationEvent): string {
  const emoji = getEmoji(event);
  const { ticket, tenant } = event;
  const base = `${emoji} **${getTitle(event)}**\n\n**Ticket:** ${ticket.identifier} - ${ticket.title}\n**Tenant:** ${tenant.name}`;

  switch (event.type) {
    case 'agent-started':
      return `${base}\n**Branch:** \`${event.branchName}\``;
    case 'agent-completed':
      return `${base}\n**Duration:** ${formatDuration(event.duration)}`;
    case 'agent-failed':
      return `${base}\n**Error:** ${event.error}\n**Attempt:** ${event.attempt}/${event.maxAttempts}`;
    case 'agent-stuck':
      return `${base}\n**Running for:** ${formatDuration(event.runningFor)}${event.lastActivity ? `\n**Last activity:** ${event.lastActivity}` : ''}`;
    case 'pr-created':
      return `${base}\n**PR:** [View PR](${event.prUrl})`;
  }
}

export function formatSlackBlocks(event: NotificationEvent): object {
  const emoji = getEmoji(event);
  const { ticket, tenant } = event;
  const color = getColor(event);

  const fields: { type: string; text: string }[] = [
    { type: 'mrkdwn', text: `*Ticket:*\n${ticket.identifier}` },
    { type: 'mrkdwn', text: `*Tenant:*\n${tenant.name}` },
  ];

  switch (event.type) {
    case 'agent-started':
      fields.push({ type: 'mrkdwn', text: `*Branch:*\n\`${event.branchName}\`` });
      break;
    case 'agent-completed':
      fields.push({ type: 'mrkdwn', text: `*Duration:*\n${formatDuration(event.duration)}` });
      break;
    case 'agent-failed':
      fields.push({ type: 'mrkdwn', text: `*Attempt:*\n${event.attempt}/${event.maxAttempts}` });
      break;
    case 'agent-stuck':
      fields.push({ type: 'mrkdwn', text: `*Running for:*\n${formatDuration(event.runningFor)}` });
      if (event.lastActivity) {
        fields.push({ type: 'mrkdwn', text: `*Last activity:*\n${event.lastActivity}` });
      }
      break;
    case 'pr-created':
      fields.push({ type: 'mrkdwn', text: `*PR:*\n<${event.prUrl}|View PR>` });
      break;
  }

  return {
    attachments: [
      {
        color,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${emoji} *${getTitle(event)}*\n${ticket.title}`,
            },
          },
          {
            type: 'section',
            fields,
          },
          ...(event.type === 'agent-failed'
            ? [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `*Error:*\n\`\`\`${event.error}\`\`\``,
                  },
                },
              ]
            : []),
        ],
      },
    ],
  };
}

export function formatDiscordEmbed(event: NotificationEvent): object {
  const { ticket, tenant } = event;
  const color = parseInt(getColor(event).slice(1), 16);

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Ticket', value: ticket.identifier, inline: true },
    { name: 'Tenant', value: tenant.name, inline: true },
  ];

  switch (event.type) {
    case 'agent-started':
      fields.push({ name: 'Branch', value: `\`${event.branchName}\``, inline: true });
      break;
    case 'agent-completed':
      fields.push({ name: 'Duration', value: formatDuration(event.duration), inline: true });
      break;
    case 'agent-failed':
      fields.push({ name: 'Attempt', value: `${event.attempt}/${event.maxAttempts}`, inline: true });
      fields.push({ name: 'Error', value: `\`\`\`${event.error.slice(0, 500)}\`\`\``, inline: false });
      break;
    case 'agent-stuck':
      fields.push({ name: 'Running for', value: formatDuration(event.runningFor), inline: true });
      if (event.lastActivity) {
        fields.push({ name: 'Last activity', value: event.lastActivity, inline: true });
      }
      break;
    case 'pr-created':
      fields.push({ name: 'PR', value: `[View PR](${event.prUrl})`, inline: true });
      break;
  }

  return {
    embeds: [
      {
        title: `${getEmoji(event)} ${getTitle(event)}`,
        description: ticket.title,
        color,
        fields,
        timestamp: event.timestamp.toISOString(),
      },
    ],
  };
}
