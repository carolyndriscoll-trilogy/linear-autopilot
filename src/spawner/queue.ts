import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { LinearTicket } from '../linear';
import { TenantConfig } from '../config/tenants';
import { logger } from '../logger';
import { MAX_RETRIES } from '../constants';
import { atomicWriteFileSync } from '../utils';

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
const DEADLETTER_FILE = 'deadletter.json';
const PROCESSED_FILE = 'processed.json';

// Default 24 hours for duplicate prevention window
const PROCESSED_RETENTION_MS = parseInt(process.env.PROCESSED_RETENTION_MS || '86400000', 10);
// Hard limit to prevent unbounded file growth
const MAX_PROCESSED_ENTRIES = 10000;

interface ProcessedEntry {
  ticketId: string;
  processedAt: string;
}

interface ProcessedFile {
  entries: ProcessedEntry[];
}

export interface DeadletterEntry {
  ticketId: string;
  ticketTitle: string;
  tenantName: string;
  attempts: number;
  lastError: string;
  failedAt: string;
}

interface DeadletterFile {
  entries: DeadletterEntry[];
}

class TicketQueue {
  private queue: QueuedTicket[] = [];
  private queueFilePath: string;
  private deadletterFilePath: string;
  private processedFilePath: string;

  constructor() {
    this.queueFilePath = join(process.cwd(), TRACKING_DIR, QUEUE_FILE);
    this.deadletterFilePath = join(process.cwd(), TRACKING_DIR, DEADLETTER_FILE);
    this.processedFilePath = join(process.cwd(), TRACKING_DIR, PROCESSED_FILE);
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

  requeue(item: QueuedTicket, lastError?: string): void {
    item.attempts++;
    if (item.attempts < MAX_RETRIES) {
      this.queue.push(item);
      logger.info('Requeued ticket', { ticketId: item.ticket.identifier, attempt: item.attempts });
      this.persistQueue();
    } else {
      logger.warn('Moved ticket to deadletter after max attempts', {
        ticketId: item.ticket.identifier,
        attempts: item.attempts,
      });
      this.addToDeadletter(item, lastError || 'Unknown error');
      this.persistQueue();
    }
  }

  private addToDeadletter(item: QueuedTicket, lastError: string): void {
    try {
      const deadletter = this.loadDeadletter();
      deadletter.push({
        ticketId: item.ticket.identifier,
        ticketTitle: item.ticket.title,
        tenantName: item.tenant.name,
        attempts: item.attempts,
        lastError,
        failedAt: new Date().toISOString(),
      });

      // Keep only last 100 entries
      const trimmed = deadletter.slice(-100);
      atomicWriteFileSync(this.deadletterFilePath, JSON.stringify({ entries: trimmed }, null, 2));
    } catch (error) {
      logger.error('Failed to write to deadletter', { error: String(error) });
    }
  }

  private loadDeadletter(): DeadletterEntry[] {
    try {
      if (!existsSync(this.deadletterFilePath)) {
        return [];
      }
      const content = readFileSync(this.deadletterFilePath, 'utf-8');
      const data = JSON.parse(content) as DeadletterFile;
      return data.entries || [];
    } catch {
      return [];
    }
  }

  getDeadletter(): DeadletterEntry[] {
    return this.loadDeadletter();
  }

  wasRecentlyProcessed(ticketId: string): boolean {
    const processed = this.loadProcessed();
    const cutoff = Date.now() - PROCESSED_RETENTION_MS;

    return processed.some(
      (entry) => entry.ticketId === ticketId && new Date(entry.processedAt).getTime() > cutoff
    );
  }

  markAsProcessed(ticketId: string): void {
    try {
      const processed = this.loadProcessed();
      const cutoff = Date.now() - PROCESSED_RETENTION_MS;

      // Clean up old entries and add new one
      const filtered = processed.filter((entry) => new Date(entry.processedAt).getTime() > cutoff);
      filtered.push({
        ticketId,
        processedAt: new Date().toISOString(),
      });

      // Apply hard size limit to prevent unbounded growth
      const trimmed = filtered.slice(-MAX_PROCESSED_ENTRIES);

      atomicWriteFileSync(this.processedFilePath, JSON.stringify({ entries: trimmed }, null, 2));
    } catch (error) {
      logger.error('Failed to mark ticket as processed', { ticketId, error: String(error) });
    }
  }

  private loadProcessed(): ProcessedEntry[] {
    try {
      if (!existsSync(this.processedFilePath)) {
        return [];
      }
      const content = readFileSync(this.processedFilePath, 'utf-8');
      const data = JSON.parse(content) as ProcessedFile;
      return data.entries || [];
    } catch {
      return [];
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
      const serialized: SerializedQueuedTicket[] = this.queue.map((item) => ({
        ticket: item.ticket,
        tenant: item.tenant,
        enqueuedAt: item.enqueuedAt.toISOString(),
        attempts: item.attempts,
      }));

      atomicWriteFileSync(this.queueFilePath, JSON.stringify(serialized, null, 2));
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
