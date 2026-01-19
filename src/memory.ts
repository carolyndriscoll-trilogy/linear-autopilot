// src/memory.ts
// Memory module for storing context from previous agent sessions

export interface SessionMemory {
  sessions: AgentSession[];
}

export interface AgentSession {
  ticketId: string;
  timestamp: Date;
  outcome: 'success' | 'failure';
  notes?: string;
}

export function getMemory(_repoPath: string): SessionMemory | null {
  // TODO: Implement memory retrieval from disk/database
  return null;
}

export function formatMemoryForPrompt(memory: SessionMemory | null): string {
  if (!memory || memory.sessions.length === 0) {
    return '';
  }

  const lines = memory.sessions.map((session) => {
    const date = new Date(session.timestamp).toISOString().split('T')[0];
    return `- ${date}: ${session.ticketId} (${session.outcome})${session.notes ? ` - ${session.notes}` : ''}`;
  });

  return lines.join('\n');
}
