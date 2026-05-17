// Persistence layer — the single point of contact with browser storage.
// Every store is namespaced `jp:v2:*` and records its own schema version
// inside the payload so future migrations can run on read without
// breaking existing users.

export type StorageStatus = "ready" | "memory-only" | "unsupported";

type Listener = (status: StorageStatus, reason?: string) => void;

let status: StorageStatus = "ready";
let reason: string | undefined;
const listeners = new Set<Listener>();
const memory = new Map<string, string>();

function publish(next: StorageStatus, why?: string) {
  if (next === status && why === reason) return;
  status = next;
  reason = why;
  for (const l of listeners) l(status, reason);
}

function detect(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const probe = "__jp_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (e) {
    publish("memory-only", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function getStorageStatus(): { status: StorageStatus; reason?: string } {
  return { status, reason };
}

export function onStorageStatusChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export type StoredPayload<T> = {
  schemaVersion: number;
  data: T;
};

type Migrate<T> = (
  rawSchemaVersion: number,
  rawData: unknown,
) => T | null;

export type StoreConfig<T> = {
  key: string;
  currentVersion: number;
  defaults: () => T;
  /** Called when the stored schemaVersion < currentVersion. Return migrated data
   *  or null to fall back to defaults. */
  migrate?: Migrate<T>;
};

export function readStore<T>(cfg: StoreConfig<T>): T {
  const store = detect();
  if (!store) {
    const raw = memory.get(cfg.key);
    if (!raw) return cfg.defaults();
    return parse(cfg, raw) ?? cfg.defaults();
  }
  try {
    const raw = store.getItem(cfg.key);
    if (!raw) return cfg.defaults();
    return parse(cfg, raw) ?? cfg.defaults();
  } catch (e) {
    publish("memory-only", e instanceof Error ? e.message : String(e));
    return cfg.defaults();
  }
}

function parse<T>(cfg: StoreConfig<T>, raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as StoredPayload<unknown>;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.schemaVersion !== "number"
    ) {
      return null;
    }
    if (parsed.schemaVersion === cfg.currentVersion) {
      return parsed.data as T;
    }
    if (parsed.schemaVersion < cfg.currentVersion && cfg.migrate) {
      return cfg.migrate(parsed.schemaVersion, parsed.data);
    }
    // Newer than us: ignore rather than risk corruption.
    return null;
  } catch {
    return null;
  }
}

export function writeStore<T>(cfg: StoreConfig<T>, data: T): void {
  const payload: StoredPayload<T> = {
    schemaVersion: cfg.currentVersion,
    data,
  };
  const raw = JSON.stringify(payload);
  const store = detect();
  if (!store) {
    memory.set(cfg.key, raw);
    return;
  }
  try {
    store.setItem(cfg.key, raw);
    if (status !== "ready") publish("ready");
  } catch (e) {
    memory.set(cfg.key, raw);
    publish("memory-only", e instanceof Error ? e.message : String(e));
  }
}

export function clearStore<T>(cfg: StoreConfig<T>): void {
  memory.delete(cfg.key);
  const store = detect();
  if (!store) return;
  try {
    store.removeItem(cfg.key);
  } catch {
    /* swallow */
  }
}

export function approximateUsageBytes(): number {
  const store = detect();
  if (!store) {
    let total = 0;
    memory.forEach((v, k) => (total += k.length + v.length));
    return total * 2;
  }
  let total = 0;
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k || !k.startsWith("jp:v2:")) continue;
      total += k.length + (store.getItem(k)?.length ?? 0);
    }
  } catch {
    return 0;
  }
  return total * 2; // UTF-16 in most engines
}
