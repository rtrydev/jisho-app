// URL ?q= based sharing — the current query lives in the search string so
// the link is human-readable and survives copy/paste through tools that
// strip the fragment. URLSearchParams handles percent-encoding for us.

const PARAM = "q";

export function buildShareUrl(text: string): string {
  const params = new URLSearchParams();
  params.set(PARAM, text);
  if (typeof window === "undefined") {
    return `?${params.toString()}`;
  }
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?${params.toString()}`;
}

export function readQueryParam(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(PARAM);
  return value && value.length > 0 ? value : null;
}

/** Mirror `text` into `?q=` via `replaceState` (no back-stack entries). */
export function writeQueryParam(text: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const current = params.get(PARAM) ?? "";
  if (current === text) return;
  if (text) params.set(PARAM, text);
  else params.delete(PARAM);
  const search = params.toString();
  const next =
    window.location.pathname +
    (search ? `?${search}` : "") +
    window.location.hash;
  window.history.replaceState({}, "", next);
}
