// src/coordination/mcp-client.ts
// MCP Agent Mail client for agent coordination

import { logger } from '../logger';

export interface McpAgentMailConfig {
  baseUrl: string;
  bearerToken?: string;
  enabled: boolean;
}

export interface AgentProfile {
  name: string;
  program: string;
  model: string;
  taskDescription?: string;
}

export interface FileReservation {
  id: string;
  paths: string[];
  agentName: string;
  exclusive: boolean;
  reason: string;
  expiresAt: Date;
}

export interface ReservationResult {
  granted: FileReservation[];
  conflicts: FileReservation[];
}

export interface Message {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface InboxResult {
  messages: Message[];
  hasMore: boolean;
}

class McpAgentMailClient {
  private config: McpAgentMailConfig | null = null;

  configure(config: McpAgentMailConfig): void {
    this.config = config;
    if (config.enabled) {
      logger.info('MCP Agent Mail configured', { baseUrl: config.baseUrl });
    }
  }

  isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    if (!this.config?.enabled) {
      throw new Error('MCP Agent Mail is not enabled');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.bearerToken) {
      headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
    }

    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MCP Agent Mail error: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Register an agent with MCP Agent Mail
   */
  async registerAgent(
    projectKey: string,
    profile: AgentProfile
  ): Promise<{ agentId: string; name: string }> {
    logger.debug('Registering agent', { projectKey, name: profile.name });

    return this.request('/tools/register_agent', {
      project_key: projectKey,
      program: profile.program,
      model: profile.model,
      name: profile.name,
      task_description: profile.taskDescription,
    });
  }

  /**
   * Reserve files for exclusive editing
   */
  async reserveFiles(
    projectKey: string,
    agentName: string,
    paths: string[],
    options: {
      ttlSeconds?: number;
      exclusive?: boolean;
      reason?: string;
    } = {}
  ): Promise<ReservationResult> {
    const { ttlSeconds = 1800, exclusive = true, reason = 'Working on ticket' } = options;

    logger.debug('Reserving files', { projectKey, agentName, paths, ttlSeconds });

    return this.request('/tools/file_reservation_paths', {
      project_key: projectKey,
      agent_name: agentName,
      paths,
      ttl_seconds: ttlSeconds,
      exclusive,
      reason,
    });
  }

  /**
   * Release file reservations
   */
  async releaseReservations(
    projectKey: string,
    agentName: string,
    paths?: string[]
  ): Promise<{ released: number }> {
    logger.debug('Releasing reservations', { projectKey, agentName, paths });

    return this.request('/tools/release_file_reservations', {
      project_key: projectKey,
      agent_name: agentName,
      paths,
    });
  }

  /**
   * Check for file reservation conflicts
   */
  async checkConflicts(projectKey: string, paths: string[]): Promise<FileReservation[]> {
    // Try to reserve non-exclusively to see conflicts
    const result = await this.request<ReservationResult>('/tools/file_reservation_paths', {
      project_key: projectKey,
      agent_name: '_conflict_check_',
      paths,
      ttl_seconds: 1, // Minimal TTL
      exclusive: false,
      reason: 'Conflict check',
    });

    // Immediately release
    await this.releaseReservations(projectKey, '_conflict_check_');

    return result.conflicts;
  }

  /**
   * Send a message to other agents
   */
  async sendMessage(
    projectKey: string,
    senderName: string,
    to: string[],
    subject: string,
    body: string,
    options: {
      threadId?: string;
      importance?: 'low' | 'normal' | 'high';
      ackRequired?: boolean;
    } = {}
  ): Promise<{ messageId: string; threadId: string }> {
    logger.debug('Sending message', { projectKey, senderName, to, subject });

    return this.request('/tools/send_message', {
      project_key: projectKey,
      sender_name: senderName,
      to,
      subject,
      body_md: body,
      thread_id: options.threadId,
      importance: options.importance ?? 'normal',
      ack_required: options.ackRequired ?? false,
    });
  }

  /**
   * Fetch inbox messages for an agent
   */
  async fetchInbox(
    projectKey: string,
    agentName: string,
    options: {
      sinceTs?: Date;
      urgentOnly?: boolean;
      limit?: number;
    } = {}
  ): Promise<InboxResult> {
    const { sinceTs, urgentOnly = false, limit = 20 } = options;

    return this.request('/tools/fetch_inbox', {
      project_key: projectKey,
      agent_name: agentName,
      since_ts: sinceTs?.toISOString(),
      urgent_only: urgentOnly,
      include_bodies: true,
      limit,
    });
  }

  /**
   * List all agents in a project
   */
  async listAgents(projectKey: string): Promise<AgentProfile[]> {
    return this.request('/tools/list_agents', {
      project_key: projectKey,
    });
  }

  /**
   * Broadcast a message to all active agents in a project
   */
  async broadcastToAgents(
    projectKey: string,
    senderName: string,
    subject: string,
    body: string,
    excludeSelf = true
  ): Promise<void> {
    const agents = await this.listAgents(projectKey);
    const recipients = agents
      .map((a) => a.name)
      .filter((name) => !excludeSelf || name !== senderName);

    if (recipients.length > 0) {
      await this.sendMessage(projectKey, senderName, recipients, subject, body);
    }
  }
}

// Singleton instance
export const mcpAgentMail = new McpAgentMailClient();
