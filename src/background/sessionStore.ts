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
      await this.save(sessions);
      this.cache = sessions;
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
      sessions.set(numericTabId, session);
    }
    return sessions;
  }

  private async save(sessions: Map<number, DiagnosticSession>): Promise<void> {
    const stored: StoredSessions = {};
    for (const [tabId, session] of sessions) {
      stored[String(tabId)] = session;
    }
    await this.storage.set({ [SESSIONS_KEY]: stored });
  }

  private get storage(): chrome.storage.StorageArea {
    return chrome.storage.session ?? chrome.storage.local;
  }
}

export const sessionStore = new SessionStore();

function cloneSessions(sessions: Map<number, DiagnosticSession>): Map<number, DiagnosticSession> {
  const cloned = new Map<number, DiagnosticSession>();
  for (const [tabId, session] of sessions) {
    cloned.set(tabId, JSON.parse(JSON.stringify(session)) as DiagnosticSession);
  }
  return cloned;
}
