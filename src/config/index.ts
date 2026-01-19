export interface Config {
  linearApiKey: string;
  linearTeamId: string;
  defaultRepoPath?: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnv(name: string): string | undefined {
  return process.env[name];
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    linearApiKey: getRequiredEnv('LINEAR_API_KEY'),
    linearTeamId: getRequiredEnv('LINEAR_TEAM_ID'),
    defaultRepoPath: getOptionalEnv('DEFAULT_REPO_PATH'),
  };

  return cachedConfig;
}

export function validateConfig(): void {
  getConfig();
}
