"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as Icon from "./Icon";

export type ToastTone = "default" | "success" | "warn";

export type ToastInput = {
  message: ReactNode;
  tone?: ToastTone;
  duration?: number;
};

type ToastEntry = ToastInput & {
  id: number;
  // `closing` triggers the exit transition before the entry is unmounted.
  closing?: boolean;
};

type ToastContextValue = {
  showToast: (toast: ToastInput | string) => number;
  dismissToast: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 2200;
const EXIT_MS = 220;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: number) => {
    setToasts((curr) => curr.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    const exitTimer = setTimeout(() => {
      setToasts((curr) => curr.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, EXIT_MS);
    const prev = timers.current.get(id);
    if (prev) clearTimeout(prev);
    timers.current.set(id, exitTimer);
  }, []);

  const showToast = useCallback(
    (toast: ToastInput | string) => {
      const id = nextId.current++;
      const entry: ToastEntry =
        typeof toast === "string"
          ? { id, message: toast }
          : { id, ...toast };
      setToasts((curr) => [...curr, entry]);
      const duration = entry.duration ?? DEFAULT_DURATION;
      const lifeTimer = setTimeout(() => dismissToast(id), duration);
      timers.current.set(id, lifeTimer);
      return id;
    },
    [dismissToast],
  );

  // Clear pending timers on unmount so we don't write to an unmounted setter.
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const ctx = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Outside of a provider — fall back to a no-op so unit tests that
    // render screens in isolation don't crash.
    return { showToast: () => -1, dismissToast: () => {} };
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`toast toast-${t.tone ?? "default"} ${t.closing ? "toast-closing" : ""}`}
        >
          <span className="toast-icon" aria-hidden>
            {t.tone === "warn" ? <Icon.Trash size={14} /> : <Icon.Check size={14} />}
          </span>
          <span className="toast-msg">{t.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => onDismiss(t.id)}
          >
            <Icon.Close size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
