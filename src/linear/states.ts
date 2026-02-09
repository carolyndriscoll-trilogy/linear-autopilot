import { graphql } from './client';
import { LinearState, LinearStatesResponse } from './types';
import { logger } from '../logger';

// Cache TTL - default 1 hour, configurable via env
const CACHE_TTL_MS = parseInt(process.env.LINEAR_STATE_CACHE_TTL_MS || '3600000', 10);

interface CacheEntry {
  data: Map<string, string>;
  timestamp: number;
}

// Cache states per team: teamId -> CacheEntry
const statesCache = new Map<string, CacheEntry>();

async function fetchStatesForTeam(teamId: string): Promise<Map<string, string>> {
  const data = await graphql<LinearStatesResponse>(
    `
      query GetStates($teamId: String!) {
        team(id: $teamId) {
          states {
            nodes {
              id
              name
            }
          }
        }
      }
    `,
    { teamId },
    'GetStates'
  );

  if (!data.data?.team?.states?.nodes) {
    throw new Error(`Failed to fetch states for team ${teamId}`);
  }

  const stateMap = new Map<string, string>();
  for (const state of data.data.team.states.nodes) {
    stateMap.set(state.name.toLowerCase(), state.id);
  }

  return stateMap;
}

function isCacheValid(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

export async function getStateId(teamId: string, stateName: string): Promise<string> {
  const cached = statesCache.get(teamId);
  const normalizedName = stateName.toLowerCase();

  // Use cache if valid
  if (isCacheValid(cached)) {
    const stateId = cached!.data.get(normalizedName);
    if (stateId) return stateId;
  }

  // Try to fetch fresh data
  try {
    const teamStates = await fetchStatesForTeam(teamId);
    statesCache.set(teamId, { data: teamStates, timestamp: Date.now() });

    const stateId = teamStates.get(normalizedName);
    if (!stateId) {
      const available = Array.from(teamStates.keys()).join(', ');
      throw new Error(`State "${stateName}" not found in team. Available: ${available}`);
    }
    return stateId;
  } catch (error) {
    // Fall back to stale cache if available
    if (cached) {
      logger.warn('Using stale state cache due to API error', {
        teamId,
        error: String(error),
        cacheAgeMs: Date.now() - cached.timestamp,
      });
      const stateId = cached.data.get(normalizedName);
      if (stateId) return stateId;
    }
    throw error;
  }
}

export async function getAllStates(teamId: string): Promise<LinearState[]> {
  const cached = statesCache.get(teamId);

  // Use cache if valid
  if (isCacheValid(cached)) {
    return Array.from(cached!.data.entries()).map(([name, id]) => ({ id, name }));
  }

  // Try to fetch fresh data
  try {
    const teamStates = await fetchStatesForTeam(teamId);
    statesCache.set(teamId, { data: teamStates, timestamp: Date.now() });
    return Array.from(teamStates.entries()).map(([name, id]) => ({ id, name }));
  } catch (error) {
    // Fall back to stale cache if available
    if (cached) {
      logger.warn('Using stale state cache due to API error', {
        teamId,
        error: String(error),
        cacheAgeMs: Date.now() - cached.timestamp,
      });
      return Array.from(cached.data.entries()).map(([name, id]) => ({ id, name }));
    }
    throw error;
  }
}
