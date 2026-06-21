import type { DiagnosticSession } from "../shared/types";

const SESSIONS_KEY = "devlite:sessions";

type StoredSessions = Record<string, DiagnosticSession>;

class SessionStore {
  private cache: Map<number, DiagnosticSession> | null = null;
  private loadPromise: Promise<Map<number, DiagnosticSession>> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  async get(tabId: number): Promise<DiagnosticSession | undefined> {
    const sessions = await this.load();
    return sessions.get(tabId);
  }

  async has(tabId: number): Promise<boolean> {
    const sessions = await this.load();
    return sessions.has(tabId);
  }

  async set(tabId: number, session: DiagnosticSession): Promise<void> {
    await this.mutate((sessions) => {
      sessions.set(tabId, session);
      return undefined;
    });
  }

  async delete(tabId: number): Promise<void> {
    await this.mutate((sessions) => {
      sessions.delete(tabId);
      return undefined;
    });
  }

  async prune(cutoffTimestamp: number): Promise<void> {
    await this.mutate((sessions) => {
      for (const [tabId, session] of sessions) {
        if ((session.updatedAt || session.createdAt || 0) < cutoffTimestamp) {
          sessions.delete(tabId);
        }
      }
      return undefined;
    });
  }

  async update(
    tabId: number,
    updater: (session: DiagnosticSession | undefined) => DiagnosticSession | undefined
  ): Promise<DiagnosticSession | undefined> {
    let updated: DiagnosticSession | undefined;
    await this.mutate((sessions) => {
      updated = updater(sessions.get(tabId));
      if (updated) {
        sessions.set(tabId, updated);
      }
      return undefined;
    });
    return updated;
  }

  private async mutate<T>(mutator: (sessions: Map<number, DiagnosticSession>) => T): Promise<T> {
    let result!: T;
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const sessions = cloneSessions(await this.load());
      result = mutator(sessions);
      this.cache = await this.save(sessions);
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    await run;
    return result;
  }

  private async load(): Promise<Map<number, DiagnosticSession>> {
    if (this.cache) return this.cache;
    if (!this.loadPromise) {
      this.loadPromise = this.readStorage();
    }
    this.cache = await this.loadPromise;
    this.loadPromise = null;
    return this.cache;
  }

  private async readStorage(): Promise<Map<number, DiagnosticSession>> {
    const result = await this.storage.get(SESSIONS_KEY);
    const stored = result[SESSIONS_KEY] as StoredSessions | undefined;
    const sessions = new Map<number, DiagnosticSession>();
    if (!stored || typeof stored !== "object") return sessions;

    for (const [tabId, session] of Object.entries(stored)) {
      const numericTabId = Number(tabId);
      if (!Number.isFinite(numericTabId) || !session) continue;
      session.events ??= [];
      session.styleChanges ??= [];
      session.archivedStyleChanges ??= [];
      sessions.set(numericTabId, session);
    }
    return sessions;
  }

  private async save(sessions: Map<number, DiagnosticSession>): Promise<Map<number, DiagnosticSession>> {
    const attempts = [
      sessions,
      compactSessions(sessions, { maxSessions: 10, maxEvents: 300, maxStyleChanges: 120, maxArchivedStyleChanges: 80 }),
      compactSessions(sessions, { maxSessions: 3, maxEvents: 160, maxStyleChanges: 60, maxArchivedStyleChanges: 40 }),
      compactSessions(sessions, { maxSessions: 1, maxEvents: 80, maxStyleChanges: 30, maxArchivedStyleChanges: 20 })
    ];
    let lastQuotaError: unknown;

    for (const attempt of attempts) {
      try {
        await this.storage.set({ [SESSIONS_KEY]: serializeSessions(attempt) });
        if (attempt !== sessions) {
          console.warn("[DevLite] session storage quota exceeded; saved a compacted session snapshot");
        }
        return attempt;
      } catch (error) {
        if (!isQuotaError(error)) throw error;
        lastQuotaError = error;
      }
    }

    console.warn("[DevLite] session storage quota exceeded; clearing persisted sessions", lastQuotaError);
    await this.storage.remove(SESSIONS_KEY);
    return new Map();
  }

  private get storage(): chrome.storage.StorageArea {
    return chrome.storage.session ?? chrome.storage.local;
  }
}

export const sessionStore = new SessionStore();

function cloneSessions(sessions: Map<number, DiagnosticSession>): Map<number, DiagnosticSession> {
  const cloned = new Map<number, DiagnosticSession>();
  for (const [tabId, session] of sessions) {
    cloned.set(tabId, cloneSession(session));
  }
  return cloned;
}

function cloneSession(session: DiagnosticSession): DiagnosticSession {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(session);
    } catch {
      // Fall through to a storage-compatible clone for unexpected non-cloneable fields.
    }
  }
  return cloneStorageValue(session) as DiagnosticSession;
}

function cloneStorageValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null;
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") return value;

  if (Array.isArray(value)) {
    if (seen.has(value)) return [];
    seen.add(value);
    return value.map((item) => {
      const cloned = cloneStorageValue(item, seen);
      return cloned === undefined ? null : cloned;
    });
  }

  if (valueType === "object") {
    const source = value as Record<string, unknown>;
    if (seen.has(source)) return undefined;
    seen.add(source);
    const cloned: Record<string, unknown> = {};
    Object.entries(source).forEach(([key, item]) => {
      const clonedItem = cloneStorageValue(item, seen);
      if (clonedItem !== undefined) {
        cloned[key] = clonedItem;
      }
    });
    return cloned;
  }

  return undefined;
}

function serializeSessions(sessions: Map<number, DiagnosticSession>): StoredSessions {
  const stored: StoredSessions = {};
  for (const [tabId, session] of sessions) {
    stored[String(tabId)] = session;
  }
  return stored;
}

function compactSessions(
  sessions: Map<number, DiagnosticSession>,
  limits: { maxSessions: number; maxEvents: number; maxStyleChanges: number; maxArchivedStyleChanges: number }
): Map<number, DiagnosticSession> {
  const compacted = new Map<number, DiagnosticSession>();
  const sorted = Array.from(sessions.entries()).sort(([, left], [, right]) => {
    return (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0);
  });

  for (const [tabId, session] of sorted.slice(0, limits.maxSessions)) {
    compacted.set(tabId, {
      ...session,
      events: (session.events ?? []).slice(-limits.maxEvents),
      styleChanges: (session.styleChanges ?? []).slice(-limits.maxStyleChanges),
      archivedStyleChanges: (session.archivedStyleChanges ?? []).slice(-limits.maxArchivedStyleChanges)
    });
  }

  return compacted;
}

function isQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /quota|QUOTA_BYTES|exceeded/i.test(message);
}
