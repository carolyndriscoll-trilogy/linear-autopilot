// tests/spawner/queue.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ticketQueue } from '../../src/spawner/queue';
import { createMockTicket, createMockTenant } from '../utils/fixtures';

describe('TicketQueue', () => {
  beforeEach(() => {
    // Clear the queue before each test
    ticketQueue.clear();
  });

  describe('enqueue', () => {
    it('should add a ticket to the queue', () => {
      const ticket = createMockTicket();
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);

      expect(ticketQueue.size()).toBe(1);
      expect(ticketQueue.isEmpty()).toBe(false);
    });

    it('should not add duplicate tickets', () => {
      const ticket = createMockTicket({ identifier: 'ABC-123' });
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);
      ticketQueue.enqueue(ticket, tenant);

      expect(ticketQueue.size()).toBe(1);
    });

    it('should allow different tickets', () => {
      const ticket1 = createMockTicket({ identifier: 'ABC-123' });
      const ticket2 = createMockTicket({ identifier: 'ABC-456' });
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket1, tenant);
      ticketQueue.enqueue(ticket2, tenant);

      expect(ticketQueue.size()).toBe(2);
    });

    it('should store enqueuedAt timestamp', () => {
      const ticket = createMockTicket();
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);
      const queued = ticketQueue.peek();

      expect(queued).toBeDefined();
      expect(queued?.enqueuedAt).toBeInstanceOf(Date);
    });

    it('should initialize attempts to 0', () => {
      const ticket = createMockTicket();
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);
      const queued = ticketQueue.peek();

      expect(queued?.attempts).toBe(0);
    });
  });

  describe('dequeue', () => {
    it('should return the next ticket in FIFO order', () => {
      const ticket1 = createMockTicket({ identifier: 'ABC-1' });
      const ticket2 = createMockTicket({ identifier: 'ABC-2' });
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket1, tenant);
      ticketQueue.enqueue(ticket2, tenant);

      const dequeued = ticketQueue.dequeue();

      expect(dequeued?.ticket.identifier).toBe('ABC-1');
      expect(ticketQueue.size()).toBe(1);
    });

    it('should return undefined when queue is empty', () => {
      const dequeued = ticketQueue.dequeue();

      expect(dequeued).toBeUndefined();
    });

    it('should remove the item from the queue', () => {
      const ticket = createMockTicket();
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);
      ticketQueue.dequeue();

      expect(ticketQueue.isEmpty()).toBe(true);
    });
  });

  describe('peek', () => {
    it('should return the next ticket without removing it', () => {
      const ticket = createMockTicket();
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);

      const peeked1 = ticketQueue.peek();
      const peeked2 = ticketQueue.peek();

      expect(peeked1).toEqual(peeked2);
      expect(ticketQueue.size()).toBe(1);
    });

    it('should return undefined when queue is empty', () => {
      expect(ticketQueue.peek()).toBeUndefined();
    });
  });

  describe('size and isEmpty', () => {
    it('should return correct size', () => {
      expect(ticketQueue.size()).toBe(0);

      const tenant = createMockTenant();
      ticketQueue.enqueue(createMockTicket({ identifier: 'ABC-1' }), tenant);
      expect(ticketQueue.size()).toBe(1);

      ticketQueue.enqueue(createMockTicket({ identifier: 'ABC-2' }), tenant);
      expect(ticketQueue.size()).toBe(2);

      ticketQueue.dequeue();
      expect(ticketQueue.size()).toBe(1);
    });

    it('should correctly report isEmpty', () => {
      expect(ticketQueue.isEmpty()).toBe(true);

      ticketQueue.enqueue(createMockTicket(), createMockTenant());
      expect(ticketQueue.isEmpty()).toBe(false);

      ticketQueue.dequeue();
      expect(ticketQueue.isEmpty()).toBe(true);
    });
  });

  describe('getByTenant', () => {
    it('should filter tickets by tenant team ID', () => {
      const tenant1 = createMockTenant({ linearTeamId: 'team-1' });
      const tenant2 = createMockTenant({ linearTeamId: 'team-2' });

      ticketQueue.enqueue(createMockTicket({ identifier: 'T1-1' }), tenant1);
      ticketQueue.enqueue(createMockTicket({ identifier: 'T2-1' }), tenant2);
      ticketQueue.enqueue(createMockTicket({ identifier: 'T1-2' }), tenant1);

      const tenant1Tickets = ticketQueue.getByTenant('team-1');
      const tenant2Tickets = ticketQueue.getByTenant('team-2');

      expect(tenant1Tickets.length).toBe(2);
      expect(tenant2Tickets.length).toBe(1);
      expect(tenant1Tickets[0].ticket.identifier).toBe('T1-1');
      expect(tenant1Tickets[1].ticket.identifier).toBe('T1-2');
    });

    it('should return empty array for unknown tenant', () => {
      ticketQueue.enqueue(createMockTicket(), createMockTenant());

      const tickets = ticketQueue.getByTenant('unknown-team');

      expect(tickets).toEqual([]);
    });
  });

  describe('requeue', () => {
    it('should increment retry count on requeue', () => {
      const ticket = createMockTicket();
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);
      const item = ticketQueue.dequeue();
      expect(item).toBeDefined();

      expect(item?.attempts).toBe(0);

      ticketQueue.requeue(item!);
      const requeuedItem = ticketQueue.peek();

      expect(requeuedItem?.attempts).toBe(1);
    });

    it('should not requeue tickets that exceeded max retries (3)', () => {
      const ticket = createMockTicket();
      const tenant = createMockTenant();

      ticketQueue.enqueue(ticket, tenant);
      const item = ticketQueue.dequeue();
      expect(item).toBeDefined();

      // First requeue: attempts 0 -> 1 (under limit, should requeue)
      ticketQueue.requeue(item!);
      expect(ticketQueue.size()).toBe(1);

      // Second requeue: attempts 1 -> 2 (under limit, should requeue)
      const item2 = ticketQueue.dequeue();
      expect(item2).toBeDefined();
      ticketQueue.requeue(item2!);
      expect(ticketQueue.size()).toBe(1);

      // Third requeue: attempts 2 -> 3 (at limit, should NOT requeue)
      const item3 = ticketQueue.dequeue();
      expect(item3).toBeDefined();
      ticketQueue.requeue(item3!);
      expect(ticketQueue.size()).toBe(0);
    });

    it('should add to end of queue', () => {
      const tenant = createMockTenant();
      const ticket1 = createMockTicket({ identifier: 'ABC-1' });
      const ticket2 = createMockTicket({ identifier: 'ABC-2' });

      ticketQueue.enqueue(ticket1, tenant);
      ticketQueue.enqueue(ticket2, tenant);

      const item1 = ticketQueue.dequeue();
      expect(item1).toBeDefined();
      ticketQueue.requeue(item1!);

      // ticket2 should be next, then requeued ticket1
      expect(ticketQueue.dequeue()?.ticket.identifier).toBe('ABC-2');
      expect(ticketQueue.dequeue()?.ticket.identifier).toBe('ABC-1');
    });
  });

  describe('clear', () => {
    it('should remove all items from the queue', () => {
      const tenant = createMockTenant();
      ticketQueue.enqueue(createMockTicket({ identifier: 'ABC-1' }), tenant);
      ticketQueue.enqueue(createMockTicket({ identifier: 'ABC-2' }), tenant);
      ticketQueue.enqueue(createMockTicket({ identifier: 'ABC-3' }), tenant);

      expect(ticketQueue.size()).toBe(3);

      ticketQueue.clear();

      expect(ticketQueue.size()).toBe(0);
      expect(ticketQueue.isEmpty()).toBe(true);
    });
  });

  describe('getAll', () => {
    it('should return a copy of all queued items', () => {
      const tenant = createMockTenant();
      ticketQueue.enqueue(createMockTicket({ identifier: 'ABC-1' }), tenant);
      ticketQueue.enqueue(createMockTicket({ identifier: 'ABC-2' }), tenant);

      const all = ticketQueue.getAll();

      expect(all.length).toBe(2);
      expect(all[0].ticket.identifier).toBe('ABC-1');
      expect(all[1].ticket.identifier).toBe('ABC-2');
    });

    it('should return a new array (not the internal reference)', () => {
      const tenant = createMockTenant();
      ticketQueue.enqueue(createMockTicket(), tenant);

      const all1 = ticketQueue.getAll();
      const all2 = ticketQueue.getAll();

      expect(all1).not.toBe(all2);
      expect(all1).toEqual(all2);
    });
  });
});
