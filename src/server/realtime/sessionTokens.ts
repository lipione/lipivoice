import { nanoid } from "nanoid";

interface RealtimeSessionStoreOptions {
  ttlMs?: number;
  now?: () => Date;
}

export interface RealtimeSession {
  token: string;
  expiresAt: string;
}

export interface RealtimeSessionStore {
  createSession(): RealtimeSession;
  consume(token: string): boolean;
}

const defaultTtlMs = 60_000;

export function createRealtimeSessionStore(
  options: RealtimeSessionStoreOptions = {},
): RealtimeSessionStore {
  const ttlMs = options.ttlMs ?? defaultTtlMs;
  const now = options.now ?? (() => new Date());
  const sessions = new Map<string, number>();

  return {
    createSession() {
      pruneExpired(sessions, now().getTime());

      const token = nanoid(32);
      const expiresAtMs = now().getTime() + ttlMs;
      sessions.set(token, expiresAtMs);

      return {
        token,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },
    consume(token) {
      const expiresAtMs = sessions.get(token);
      if (!expiresAtMs) {
        return false;
      }

      sessions.delete(token);
      return expiresAtMs >= now().getTime();
    },
  };
}

function pruneExpired(sessions: Map<string, number>, nowMs: number) {
  for (const [token, expiresAtMs] of sessions) {
    if (expiresAtMs < nowMs) {
      sessions.delete(token);
    }
  }
}
