// src/runners/index.ts
// Agent runners - different execution strategies for tickets

export {
  runSwarmTeam,
  analyzeTicketComplexity,
  isSwarmAvailable,
  SwarmConfig,
  SwarmResult,
} from './swarm-runner';

export {
  runRailsSwarm,
  isRailsProject,
  hasClaudeOnRailsSetup,
  initializeClaudeOnRails,
  analyzeTicketForRailsAgents,
  isClaudeSwarmAvailable,
  getDefaultRailsConfig,
  RailsRunnerConfig,
  RailsRunnerResult,
} from './rails-runner';

export { selectRunner, RunnerType, RunnerSelection } from './runner-selector';
