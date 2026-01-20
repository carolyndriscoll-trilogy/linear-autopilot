export interface Config {
  linearApiKey: string;
  defaultRepoPath?: string;
  mcpAgentMail: {
    enabled: boolean;
    baseUrl: string;
    bearerToken?: string;
  };
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
    defaultRepoPath: getOptionalEnv('DEFAULT_REPO_PATH'),
    mcpAgentMail: {
      enabled: getOptionalEnv('MCP_AGENT_MAIL_ENABLED') === 'true',
      baseUrl: getOptionalEnv('MCP_AGENT_MAIL_URL') ?? 'http://localhost:8000',
      bearerToken: getOptionalEnv('MCP_AGENT_MAIL_TOKEN'),
    },
  };

  return cachedConfig;
}

export function validateConfig(): void {
  getConfig();
}
