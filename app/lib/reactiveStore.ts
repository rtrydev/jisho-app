// A tiny in-memory store that mirrors a `StoreConfig` and exposes a
// `useSyncExternalStore`-friendly subscription API.
//
// The constructor seeds the state from `cfg.defaults()`; on the client
// we hydrate from localStorage lazily on first subscribe. SSR snapshots
// always return the defaults — the client adopts the persisted state
// on first render through useSyncExternalStore's snapshot semantics.

import { useSyncExternalStore } from "react";
import { readStore, writeStore, type StoreConfig } from "./storage";

// Test seam: every constructed store registers here so the test setup can
// rewind module-level state to defaults between test cases.
const REGISTRY: ReactiveStore<unknown>[] = [];

export function __resetAllReactiveStoresForTests(): void {
  for (const s of REGISTRY) s.__resetForTests();
}

export class ReactiveStore<T> {
  private state: T;
  private listeners = new Set<() => void>();
  private hydrated = false;
  private defaultSnapshot: T;

  constructor(private cfg: StoreConfig<T>) {
    this.defaultSnapshot = cfg.defaults();
    this.state = this.defaultSnapshot;
    REGISTRY.push(this as unknown as ReactiveStore<unknown>);
  }

  /** Test-only: forget the cached hydration so the next snapshot rereads storage. */
  __resetForTests(): void {
    this.hydrated = false;
    this.state = this.cfg.defaults();
    this.notify();
  }

  /** Idempotent client-side hydration from storage. */
  hydrateOnce(): void {
    if (this.hydrated) return;
    if (typeof window === "undefined") return;
    this.hydrated = true;
    const stored = readStore(this.cfg);
    if (stored !== this.state) {
      this.state = stored;
      this.notify();
    }
  }

  /** Snapshot for `useSyncExternalStore`. Triggers hydration the first
   *  time it runs on the client so the first render sees persisted state. */
  get = (): T => {
    this.hydrateOnce();
    return this.state;
  };
  getServerSnapshot = (): T => this.defaultSnapshot;

  set(next: T | ((prev: T) => T)): void {
    const value =
      typeof next === "function" ? (next as (p: T) => T)(this.state) : next;
    if (value === this.state) return;
    this.state = value;
    writeStore(this.cfg, value);
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    // First subscriber on the client triggers hydration.
    this.hydrateOnce();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

export function useReactiveStore<T>(store: ReactiveStore<T>): T {
  return useSyncExternalStore(
    store.subscribe,
    store.get,
    store.getServerSnapshot,
  );
}
