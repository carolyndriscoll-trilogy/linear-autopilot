import { LinearTicket } from '../linear';
import { TenantConfig } from '../config/tenants';
import { logger } from '../logger';

export interface QueuedTicket {
  ticket: LinearTicket;
  tenant: TenantConfig;
  enqueuedAt: Date;
  attempts: number;
}

class TicketQueue {
  private queue: QueuedTicket[] = [];

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
    logger.info('Enqueued ticket', { ticketId: ticket.identifier, title: ticket.title, queueSize: this.queue.length, tenant: tenant.name });
  }

  dequeue(): QueuedTicket | undefined {
    return this.queue.shift();
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
    if (item.attempts < 3) {
      this.queue.push(item);
      logger.info('Requeued ticket', { ticketId: item.ticket.identifier, attempt: item.attempts });
    } else {
      logger.warn('Dropped ticket after max attempts', { ticketId: item.ticket.identifier, attempts: item.attempts });
    }
  }

  clear(): void {
    this.queue = [];
  }

  getAll(): QueuedTicket[] {
    return [...this.queue];
  }
}

// Singleton instance
export const ticketQueue = new TicketQueue();
