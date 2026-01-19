import { getConfig } from '../config';
import { LinearState, LinearStatesResponse } from './types';

let statesCache: Map<string, string> | null = null;

async function fetchStates(): Promise<Map<string, string>> {
  const config = getConfig();

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': config.linearApiKey,
    },
    body: JSON.stringify({
      query: `
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
      variables: { teamId: config.linearTeamId },
    }),
  });

  const data = (await response.json()) as LinearStatesResponse;

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.team?.states?.nodes) {
    throw new Error('Failed to fetch states from Linear');
  }

  const stateMap = new Map<string, string>();
  for (const state of data.data.team.states.nodes) {
    stateMap.set(state.name.toLowerCase(), state.id);
  }

  return stateMap;
}

export async function getStateId(stateName: string): Promise<string> {
  if (!statesCache) {
    statesCache = await fetchStates();
  }

  const stateId = statesCache.get(stateName.toLowerCase());
  if (!stateId) {
    const available = Array.from(statesCache.keys()).join(', ');
    throw new Error(`State "${stateName}" not found. Available: ${available}`);
  }

  return stateId;
}

export async function getAllStates(): Promise<LinearState[]> {
  if (!statesCache) {
    statesCache = await fetchStates();
  }

  return Array.from(statesCache.entries()).map(([name, id]) => ({ id, name }));
}
