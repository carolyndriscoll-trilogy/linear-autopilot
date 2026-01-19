import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export interface RepoMemory {
  patterns: string[];
  commonErrors: string[];
  fileStructure: string;
  lastUpdated: Date;
}

interface MemoryFile {
  patterns: string[];
  commonErrors: string[];
  fileStructure: string;
  lastUpdated: string;
}

const MEMORY_DIR = '.linear-autopilot';
const MEMORY_FILE = 'memory.json';

function getMemoryPath(repoPath: string): string {
  return join(repoPath, MEMORY_DIR, MEMORY_FILE);
}

function createDefaultMemory(): RepoMemory {
  return {
    patterns: [],
    commonErrors: [],
    fileStructure: '',
    lastUpdated: new Date(),
  };
}

export function getMemory(repoPath: string): RepoMemory {
  const memoryPath = getMemoryPath(repoPath);

  if (!existsSync(memoryPath)) {
    return createDefaultMemory();
  }

  try {
    const content = readFileSync(memoryPath, 'utf-8');
    const data = JSON.parse(content) as MemoryFile;
    return {
      patterns: data.patterns || [],
      commonErrors: data.commonErrors || [],
      fileStructure: data.fileStructure || '',
      lastUpdated: new Date(data.lastUpdated),
    };
  } catch (error) {
    console.error(`Error reading memory for ${repoPath}: ${error}`);
    return createDefaultMemory();
  }
}

export function saveMemory(repoPath: string, memory: RepoMemory): void {
  const memoryPath = getMemoryPath(repoPath);
  const memoryDir = dirname(memoryPath);

  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  const data: MemoryFile = {
    patterns: memory.patterns,
    commonErrors: memory.commonErrors,
    fileStructure: memory.fileStructure,
    lastUpdated: memory.lastUpdated.toISOString(),
  };

  writeFileSync(memoryPath, JSON.stringify(data, null, 2));
}

export interface SessionLearnings {
  errors?: string[];
  learnings?: string[];
  fileStructure?: string;
}

export function updateMemory(repoPath: string, session: SessionLearnings): void {
  const memory = getMemory(repoPath);

  if (session.errors) {
    for (const error of session.errors) {
      if (!memory.commonErrors.includes(error)) {
        memory.commonErrors.push(error);
      }
    }
    // Keep only the last 20 errors
    memory.commonErrors = memory.commonErrors.slice(-20);
  }

  if (session.learnings) {
    for (const learning of session.learnings) {
      if (!memory.patterns.includes(learning)) {
        memory.patterns.push(learning);
      }
    }
    // Keep only the last 30 patterns
    memory.patterns = memory.patterns.slice(-30);
  }

  if (session.fileStructure) {
    memory.fileStructure = session.fileStructure;
  }

  memory.lastUpdated = new Date();
  saveMemory(repoPath, memory);
}

export function formatMemoryForPrompt(memory: RepoMemory): string {
  const sections: string[] = [];

  if (memory.patterns.length > 0) {
    sections.push(`**Patterns to follow:**\n${memory.patterns.map((p) => `- ${p}`).join('\n')}`);
  }

  if (memory.commonErrors.length > 0) {
    sections.push(`**Errors to avoid (seen in previous sessions):**\n${memory.commonErrors.map((e) => `- ${e}`).join('\n')}`);
  }

  if (memory.fileStructure) {
    sections.push(`**Project structure:**\n${memory.fileStructure}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : '';
}
