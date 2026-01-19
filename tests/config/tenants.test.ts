// tests/config/tenants.test.ts
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

// Import after mocking
import { getAllTenants, getTenantByTeamId, reloadTenants } from '../../src/config/tenants';

describe('Tenants Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Reset the tenants cache before each test
    reloadTenants();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getAllTenants', () => {
    it('should return empty array when tenants.json does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      reloadTenants();
      const tenants = getAllTenants();

      expect(tenants).toEqual([]);
    });

    it('should load tenants from tenants.json', () => {
      const mockTenants = {
        tenants: [
          {
            name: 'test-tenant',
            linearTeamId: 'team-123',
            repoPath: '/path/to/repo',
            maxConcurrentAgents: 2,
            githubRepo: 'org/repo',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockTenants));

      reloadTenants();
      const tenants = getAllTenants();

      expect(tenants).toHaveLength(1);
      expect(tenants[0].name).toBe('test-tenant');
      expect(tenants[0].linearTeamId).toBe('team-123');
    });

    it('should use TENANTS_CONFIG_PATH env var if set', () => {
      process.env.TENANTS_CONFIG_PATH = '/custom/path/tenants.json';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ tenants: [] }));

      reloadTenants();
      getAllTenants();

      expect(mockFs.existsSync).toHaveBeenCalledWith('/custom/path/tenants.json');
    });

    it('should return empty array on JSON parse error', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      reloadTenants();
      const tenants = getAllTenants();

      expect(tenants).toEqual([]);
    });

    it('should cache tenants after first load', () => {
      const mockTenants = {
        tenants: [
          {
            name: 'cached',
            linearTeamId: 'team-1',
            repoPath: '/',
            maxConcurrentAgents: 1,
            githubRepo: 'o/r',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockTenants));

      reloadTenants();

      // Clear mock to verify caching
      mockFs.readFileSync.mockClear();

      // First call loads from "disk" via reloadTenants
      getAllTenants();
      // Second call should use cache
      getAllTenants();

      // readFileSync should not be called again after reloadTenants
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });
  });

  describe('getTenantByTeamId', () => {
    it('should return tenant matching team ID', () => {
      const mockTenants = {
        tenants: [
          {
            name: 'tenant-1',
            linearTeamId: 'team-1',
            repoPath: '/',
            maxConcurrentAgents: 1,
            githubRepo: 'o/r1',
          },
          {
            name: 'tenant-2',
            linearTeamId: 'team-2',
            repoPath: '/',
            maxConcurrentAgents: 1,
            githubRepo: 'o/r2',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockTenants));

      reloadTenants();
      const tenant = getTenantByTeamId('team-2');

      expect(tenant).toBeDefined();
      expect(tenant?.name).toBe('tenant-2');
    });

    it('should return undefined for unknown team ID', () => {
      const mockTenants = {
        tenants: [
          {
            name: 'tenant-1',
            linearTeamId: 'team-1',
            repoPath: '/',
            maxConcurrentAgents: 1,
            githubRepo: 'o/r',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockTenants));

      reloadTenants();
      const tenant = getTenantByTeamId('unknown-team');

      expect(tenant).toBeUndefined();
    });
  });

  describe('reloadTenants', () => {
    it('should clear cache and reload tenants', () => {
      const mockTenants1 = {
        tenants: [
          {
            name: 'old',
            linearTeamId: 't1',
            repoPath: '/',
            maxConcurrentAgents: 1,
            githubRepo: 'o/r',
          },
        ],
      };
      const mockTenants2 = {
        tenants: [
          {
            name: 'new',
            linearTeamId: 't2',
            repoPath: '/',
            maxConcurrentAgents: 1,
            githubRepo: 'o/r',
          },
        ],
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify(mockTenants1));

      reloadTenants();

      // First load
      const tenants1 = getAllTenants();
      expect(tenants1[0].name).toBe('old');

      // Set up mock for second load
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify(mockTenants2));

      // Reload
      reloadTenants();
      const tenants2 = getAllTenants();
      expect(tenants2[0].name).toBe('new');
    });
  });
});
