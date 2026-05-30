import { nanoid } from "nanoid";

interface RealtimeSessionStoreOptions {
  ttlMs?: number;
  now?: () => Date;
}

export interface CreateRealtimeSessionInput {
  agentId?: string | null;
  ttlMs?: number;
}

export interface RealtimeSessionContext {
  agentId: string | null;
}

export interface RealtimeSession extends RealtimeSessionContext {
  token: string;
  expiresAt: string;
}

export interface RealtimeSessionStore {
  createSession(input?: CreateRealtimeSessionInput): RealtimeSession;
  consume(token: string): RealtimeSessionContext | null;
}

const defaultTtlMs = 60_000;

type StoredSession = {
  expiresAtMs: number;
  context: RealtimeSessionContext;
};

export function createRealtimeSessionStore(
  options: RealtimeSessionStoreOptions = {},
): RealtimeSessionStore {
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const now = options.now ?? (() => new Date());
  const sessions = new Map<string, StoredSession>();

  return {
    createSession(input = {}) {
      pruneExpired(sessions, now().getTime());

      const token = nanoid(32);
      const expiresAtMs = now().getTime() + (input.ttlMs ?? ttlMs);
      const context = { agentId: input.agentId ?? null };
      sessions.set(token, { expiresAtMs, context });

      return {
        token,
        ...context,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },
    consume(token) {
      const session = sessions.get(token);
      if (!session) {
        return null;
      }

      sessions.delete(token);
      return session.expiresAtMs >= now().getTime() ? session.context : null;
    },
  };
}

function pruneExpired(sessions: Map<string, StoredSession>, nowMs: number) {
  for (const [token, session] of sessions) {
    if (session.expiresAtMs < nowMs) {
      sessions.delete(token);
    }
  }
}
