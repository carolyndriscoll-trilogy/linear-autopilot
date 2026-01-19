import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface TenantConfig {
  name: string;
  linearTeamId: string;
  repoPath: string;
  maxConcurrentAgents: number;
  githubRepo: string;
  slackWebhook?: string;
}

interface TenantsFile {
  tenants: TenantConfig[];
}

let tenantsCache: TenantConfig[] | null = null;

function loadTenants(): TenantConfig[] {
  if (tenantsCache) {
    return tenantsCache;
  }

  const tenantsPath = process.env.TENANTS_CONFIG_PATH || join(process.cwd(), 'tenants.json');

  if (!existsSync(tenantsPath)) {
    console.warn(`Warning: tenants.json not found at ${tenantsPath}`);
    return [];
  }

  try {
    const content = readFileSync(tenantsPath, 'utf-8');
    const data = JSON.parse(content) as TenantsFile;
    tenantsCache = data.tenants || [];
    console.log(`Loaded ${tenantsCache.length} tenant(s) from ${tenantsPath}`);
    return tenantsCache;
  } catch (error) {
    console.error(`Error loading tenants.json: ${error}`);
    return [];
  }
}

export function getTenantByTeamId(teamId: string): TenantConfig | undefined {
  const tenants = loadTenants();
  return tenants.find((t) => t.linearTeamId === teamId);
}

export function getAllTenants(): TenantConfig[] {
  return loadTenants();
}

export function reloadTenants(): void {
  tenantsCache = null;
  loadTenants();
}
