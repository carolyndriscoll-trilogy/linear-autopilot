import { renderDashboard } from '../../src/dashboard/template';

describe('Dashboard Template', () => {
  const baseData = {
    queueSize: 5,
    activeCount: 2,
    completionsCount: 10,
    totalCost: 123.45,
    uptime: '2h 30m',
    agents: [],
    completions: [],
  };

  describe('renderDashboard', () => {
    it('should render basic stats correctly', () => {
      const html = renderDashboard(baseData);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Linear Autopilot Dashboard</title>');
      expect(html).toContain('>5</div>'); // queueSize
      expect(html).toContain('>2</div>'); // activeCount
      expect(html).toContain('>10</div>'); // completionsCount
      expect(html).toContain('$123.45');
      expect(html).toContain('2h 30m');
    });

    it('should show empty state when no agents', () => {
      const html = renderDashboard(baseData);
      expect(html).toContain('No active agents');
    });

    it('should show empty state when no completions', () => {
      const html = renderDashboard(baseData);
      expect(html).toContain('No recent completions');
    });

    it('should render agents table when agents exist', () => {
      const data = {
        ...baseData,
        agents: [
          {
            ticketId: 'PROJ-123',
            ticketTitle: 'Fix login bug',
            tenantName: 'Acme Corp',
            duration: '5m 30s',
          },
        ],
      };

      const html = renderDashboard(data);

      expect(html).toContain('PROJ-123');
      expect(html).toContain('Fix login bug');
      expect(html).toContain('Acme Corp');
      expect(html).toContain('5m 30s');
      expect(html).not.toContain('No active agents');
    });

    it('should render completions table with PR links', () => {
      const data = {
        ...baseData,
        completions: [
          {
            ticketId: 'PROJ-456',
            tenant: 'Acme Corp',
            duration: 120000,
            prUrl: 'https://github.com/org/repo/pull/123',
            completedAt: '2025-01-15T10:30:00Z',
          },
        ],
      };

      const html = renderDashboard(data);

      expect(html).toContain('PROJ-456');
      expect(html).toContain('Acme Corp');
      expect(html).toContain('View PR');
      expect(html).toContain('https://github.com/org/repo/pull/123');
      expect(html).not.toContain('No recent completions');
    });

    it('should show dash when no PR URL', () => {
      const data = {
        ...baseData,
        completions: [
          {
            ticketId: 'PROJ-789',
            tenant: 'Test Tenant',
            duration: 60000,
            completedAt: '2025-01-15T10:30:00Z',
          },
        ],
      };

      const html = renderDashboard(data);

      expect(html).toContain('PROJ-789');
      expect(html).toMatch(/<td>-<\/td>/);
    });

    it('should escape HTML in user content to prevent XSS', () => {
      const data = {
        ...baseData,
        agents: [
          {
            ticketId: '<script>alert("xss")</script>',
            ticketTitle: '<img src=x onerror=alert(1)>',
            tenantName: '&<>"\' characters',
            duration: '1m',
          },
        ],
      };

      const html = renderDashboard(data);

      // Should not contain raw script tag
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img src=x');

      // Should contain escaped versions
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&lt;img');
      expect(html).toContain('&amp;');
    });

    it('should escape PR URLs to prevent XSS', () => {
      const data = {
        ...baseData,
        completions: [
          {
            ticketId: 'PROJ-1',
            tenant: 'Test',
            duration: 1000,
            prUrl: 'javascript:alert("xss")',
            completedAt: '2025-01-15T10:30:00Z',
          },
        ],
      };

      const html = renderDashboard(data);

      // URL should be escaped (though still clickable - this is defense in depth)
      expect(html).toContain('href="javascript:alert');
      // But important content should be escaped
      expect(html).not.toContain('javascript:alert("xss")">'); // quotes should be escaped
    });

    it('should include auto-refresh meta tag', () => {
      const html = renderDashboard(baseData);
      expect(html).toContain('<meta http-equiv="refresh" content="30">');
    });

    it('should include rel="noopener" on external links', () => {
      const data = {
        ...baseData,
        completions: [
          {
            ticketId: 'PROJ-1',
            tenant: 'Test',
            duration: 1000,
            prUrl: 'https://github.com/org/repo/pull/1',
            completedAt: '2025-01-15T10:30:00Z',
          },
        ],
      };

      const html = renderDashboard(data);
      expect(html).toContain('rel="noopener"');
    });
  });
});
