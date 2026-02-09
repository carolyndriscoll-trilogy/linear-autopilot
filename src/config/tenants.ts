import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger';

export type NotificationType = 'email' | 'slack' | 'discord' | 'sms' | 'whatsapp' | 'gchat';

export interface NotificationConfig {
  type: NotificationType;
  config: Record<string, string>;
}

export interface ValidationStep {
  name: string;
  command: string;
  args: string[];
}

export interface ValidationConfig {
  steps: ValidationStep[];
  timeoutMs?: number;
}

export interface TenantConfig {
  name: string;
  linearTeamId: string;
  repoPath: string;
  maxConcurrentAgents: number;
  githubRepo: string;
  triggerLabel?: string;
  validation?: ValidationConfig;
  notifications?: NotificationConfig[];
}

interface TenantsFile {
  tenants: TenantConfig[];
}

const VALID_NOTIFICATION_TYPES: NotificationType[] = [
  'email',
  'slack',
  'discord',
  'sms',
  'whatsapp',
  'gchat',
];

const GITHUB_REPO_PATTERN = /^[^/]+\/[^/]+$/;

function validateTenant(tenant: unknown, index: number): TenantConfig | null {
  if (typeof tenant !== 'object' || tenant === null) {
    logger.error('Invalid tenant config: not an object', { index });
    return null;
  }

  const t = tenant as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof t.name !== 'string' || !t.name) {
    errors.push('name must be a non-empty string');
  }

  if (typeof t.linearTeamId !== 'string' || !t.linearTeamId) {
    errors.push('linearTeamId must be a non-empty string');
  }

  if (typeof t.repoPath !== 'string' || !t.repoPath) {
    errors.push('repoPath must be a non-empty string');
  }

  if (
    typeof t.maxConcurrentAgents !== 'number' ||
    !Number.isInteger(t.maxConcurrentAgents) ||
    t.maxConcurrentAgents < 1
  ) {
    errors.push('maxConcurrentAgents must be a positive integer');
  }

  if (typeof t.githubRepo !== 'string' || !GITHUB_REPO_PATTERN.test(t.githubRepo)) {
    errors.push('githubRepo must be in "owner/repo" format');
  }

  if (t.triggerLabel !== undefined) {
    if (typeof t.triggerLabel !== 'string' || !t.triggerLabel.trim()) {
      errors.push('triggerLabel must be a non-empty string if provided');
    }
  }

  if (t.validation !== undefined) {
    if (typeof t.validation !== 'object' || t.validation === null) {
      errors.push('validation must be an object');
    } else {
      const v = t.validation as Record<string, unknown>;
      if (!Array.isArray(v.steps)) {
        errors.push('validation.steps must be an array');
      } else {
        for (let i = 0; i < v.steps.length; i++) {
          const step = v.steps[i] as Record<string, unknown>;
          if (typeof step.name !== 'string' || !step.name) {
            errors.push(`validation.steps[${i}].name must be a non-empty string`);
          }
          if (typeof step.command !== 'string' || !step.command) {
            errors.push(`validation.steps[${i}].command must be a non-empty string`);
          }
          if (!Array.isArray(step.args)) {
            errors.push(`validation.steps[${i}].args must be an array`);
          }
        }
      }
      if (v.timeoutMs !== undefined && (typeof v.timeoutMs !== 'number' || v.timeoutMs <= 0)) {
        errors.push('validation.timeoutMs must be a positive number');
      }
    }
  }

  if (t.notifications !== undefined) {
    if (!Array.isArray(t.notifications)) {
      errors.push('notifications must be an array');
    } else {
      for (let i = 0; i < t.notifications.length; i++) {
        const n = t.notifications[i] as Record<string, unknown>;
        if (!VALID_NOTIFICATION_TYPES.includes(n.type as NotificationType)) {
          errors.push(
            `notifications[${i}].type must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}`
          );
        }
        if (typeof n.config !== 'object' || n.config === null) {
          errors.push(`notifications[${i}].config must be an object`);
        }
      }
    }
  }

  if (errors.length > 0) {
    const name = typeof t.name === 'string' ? t.name : `index ${index}`;
    logger.error('Invalid tenant config', { tenant: name, errors });
    return null;
  }

  return tenant as TenantConfig;
}

let tenantsCache: TenantConfig[] | null = null;

function loadTenants(): TenantConfig[] {
  if (tenantsCache) {
    return tenantsCache;
  }

  const tenantsPath = process.env.TENANTS_CONFIG_PATH || join(process.cwd(), 'tenants.json');

  if (!existsSync(tenantsPath)) {
    logger.warn('tenants.json not found', { path: tenantsPath });
    return [];
  }

  try {
    const content = readFileSync(tenantsPath, 'utf-8');
    const data = JSON.parse(content) as TenantsFile;
    const rawTenants = data.tenants || [];

    tenantsCache = rawTenants
      .map((t, i) => validateTenant(t, i))
      .filter((t): t is TenantConfig => t !== null);

    if (tenantsCache.length < rawTenants.length) {
      logger.warn('Some tenants were excluded due to validation errors', {
        total: rawTenants.length,
        valid: tenantsCache.length,
        excluded: rawTenants.length - tenantsCache.length,
      });
    }

    logger.info('Loaded tenants', { count: tenantsCache.length, path: tenantsPath });
    return tenantsCache;
  } catch (error) {
    logger.error('Error loading tenants.json', { error: String(error) });
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

export function reloadTenants(): TenantConfig[] {
  tenantsCache = null;
  const reloaded = loadTenants();

  if (reloaded.length === 0) {
    logger.error('Tenant reload resulted in zero valid tenants!', {
      path: process.env.TENANTS_CONFIG_PATH || join(process.cwd(), 'tenants.json'),
    });
  } else {
    logger.info('Tenants reloaded successfully', {
      count: reloaded.length,
      tenants: reloaded.map((t) => t.name),
    });
  }

  return reloaded;
}
