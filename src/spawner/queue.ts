import { LinearTicket } from '../linear';
import { TenantConfig } from '../config/tenants';

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
      console.log(`Ticket ${ticket.identifier} already in queue, skipping`);
      return;
    }

    this.queue.push({
      ticket,
      tenant,
      enqueuedAt: new Date(),
      attempts: 0,
    });
    console.log(`Enqueued ${ticket.identifier}: ${ticket.title} (queue size: ${this.queue.length})`);
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
      console.log(`Requeued ${item.ticket.identifier} (attempt ${item.attempts})`);
    } else {
      console.log(`Dropped ${item.ticket.identifier} after ${item.attempts} attempts`);
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
