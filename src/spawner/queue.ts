import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { LinearTicket } from '../linear';
import { TenantConfig } from '../config/tenants';
import { logger } from '../logger';
import { MAX_RETRIES } from '../constants';

export interface QueuedTicket {
  ticket: LinearTicket;
  tenant: TenantConfig;
  enqueuedAt: Date;
  attempts: number;
}

interface SerializedQueuedTicket {
  ticket: LinearTicket;
  tenant: TenantConfig;
  enqueuedAt: string;
  attempts: number;
}

const TRACKING_DIR = '.linear-autopilot';
const QUEUE_FILE = 'queue.json';

class TicketQueue {
  private queue: QueuedTicket[] = [];
  private queueFilePath: string;

  constructor() {
    this.queueFilePath = join(process.cwd(), TRACKING_DIR, QUEUE_FILE);
    this.loadQueue();
  }

  enqueue(ticket: LinearTicket, tenant: TenantConfig): void {
    // Avoid duplicates
    const exists = this.queue.some((q) => q.ticket.identifier === ticket.identifier);
    if (exists) {
      logger.debug('Ticket already in queue, skipping', { ticketId: ticket.identifier });
      return;
    }

    this.queue.push({
      ticket,
      tenant,
      enqueuedAt: new Date(),
      attempts: 0,
    });
    logger.info('Enqueued ticket', {
      ticketId: ticket.identifier,
      title: ticket.title,
      queueSize: this.queue.length,
      tenant: tenant.name,
    });
    this.persistQueue();
  }

  dequeue(): QueuedTicket | undefined {
    const item = this.queue.shift();
    if (item) {
      this.persistQueue();
    }
    return item;
  }

  peek(): QueuedTicket | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  getByTenant(tenantId: string): QueuedTicket[] {
    return this.queue.filter((q) => q.tenant.linearTeamId === tenantId);
  }

  requeue(item: QueuedTicket): void {
    item.attempts++;
    if (item.attempts < MAX_RETRIES) {
      this.queue.push(item);
      logger.info('Requeued ticket', { ticketId: item.ticket.identifier, attempt: item.attempts });
      this.persistQueue();
    } else {
      logger.warn('Dropped ticket after max attempts', {
        ticketId: item.ticket.identifier,
        attempts: item.attempts,
      });
      this.persistQueue();
    }
  }

  clear(): void {
    this.queue = [];
    try {
      if (existsSync(this.queueFilePath)) {
        unlinkSync(this.queueFilePath);
      }
    } catch (error) {
      logger.error('Failed to delete queue file', { error: String(error) });
    }
  }

  getAll(): QueuedTicket[] {
    return [...this.queue];
  }

  private persistQueue(): void {
    try {
      const dir = dirname(this.queueFilePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const serialized: SerializedQueuedTicket[] = this.queue.map((item) => ({
        ticket: item.ticket,
        tenant: item.tenant,
        enqueuedAt: item.enqueuedAt.toISOString(),
        attempts: item.attempts,
      }));

      writeFileSync(this.queueFilePath, JSON.stringify(serialized, null, 2));
    } catch (error) {
      logger.error('Failed to persist queue', { error: String(error) });
    }
  }

  private loadQueue(): void {
    try {
      if (!existsSync(this.queueFilePath)) {
        return;
      }

      const content = readFileSync(this.queueFilePath, 'utf-8');
      const serialized = JSON.parse(content) as SerializedQueuedTicket[];

      this.queue = serialized.map((item) => ({
        ticket: item.ticket,
        tenant: item.tenant,
        enqueuedAt: new Date(item.enqueuedAt),
        attempts: item.attempts,
      }));

      logger.info('Restored queue from disk', { count: this.queue.length });
    } catch (error) {
      logger.error('Failed to load queue from disk', { error: String(error) });
      this.queue = [];
    }
  }
}

// Singleton instance
export const ticketQueue = new TicketQueue();
