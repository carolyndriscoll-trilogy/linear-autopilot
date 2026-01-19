import { getConfig } from '../config';
import { LinearState, LinearStatesResponse } from './types';

// Cache states per team: teamId -> (stateName -> stateId)
const statesCache = new Map<string, Map<string, string>>();

async function fetchStatesForTeam(teamId: string): Promise<Map<string, string>> {
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
      variables: { teamId },
    }),
  });

  const data = (await response.json()) as LinearStatesResponse;

  if (data.errors) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }

  if (!data.data?.team?.states?.nodes) {
    throw new Error(`Failed to fetch states for team ${teamId}`);
  }

  const stateMap = new Map<string, string>();
  for (const state of data.data.team.states.nodes) {
    stateMap.set(state.name.toLowerCase(), state.id);
  }

  return stateMap;
}

export async function getStateId(teamId: string, stateName: string): Promise<string> {
  let teamStates = statesCache.get(teamId);

  if (!teamStates) {
    teamStates = await fetchStatesForTeam(teamId);
    statesCache.set(teamId, teamStates);
  }

  const stateId = teamStates.get(stateName.toLowerCase());
  if (!stateId) {
    const available = Array.from(teamStates.keys()).join(', ');
    throw new Error(`State "${stateName}" not found in team. Available: ${available}`);
  }

  return stateId;
}

export async function getAllStates(teamId: string): Promise<LinearState[]> {
  let teamStates = statesCache.get(teamId);

  if (!teamStates) {
    teamStates = await fetchStatesForTeam(teamId);
    statesCache.set(teamId, teamStates);
  }

  return Array.from(teamStates.entries()).map(([name, id]) => ({ id, name }));
}
