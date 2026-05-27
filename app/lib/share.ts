// URL-based sharing — the current query lives in the search string so
// the link is human-readable and survives copy/paste through tools that
// strip the fragment. URLSearchParams handles percent-encoding for us.
//
// Two parallel params:
//   ?q=…       — Read screen's analysis input
//   ?kanji=…   — Kanji screen's currently-inspected character

const PARAM_Q = "q";
const PARAM_KANJI = "kanji";

export function buildShareUrl(text: string): string {
  const params = new URLSearchParams();
  params.set(PARAM_Q, text);
  if (typeof window === "undefined") {
    return `?${params.toString()}`;
  }
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?${params.toString()}`;
}

export function readQueryParam(): string | null {
  return _read(PARAM_Q);
}

/** Mirror `text` into `?q=` via `replaceState` (no back-stack entries). */
export function writeQueryParam(text: string): void {
  _write(PARAM_Q, text);
}

export function readKanjiParam(): string | null {
  return _read(PARAM_KANJI);
}

export function writeKanjiParam(char: string | null): void {
  _write(PARAM_KANJI, char ?? "");
}

function _read(name: string): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(name);
  return value && value.length > 0 ? value : null;
}

function _write(name: string, value: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const current = params.get(name) ?? "";
  if (current === value) return;
  if (value) params.set(name, value);
  else params.delete(name);
  const search = params.toString();
  const next =
    window.location.pathname +
    (search ? `?${search}` : "") +
    window.location.hash;
  window.history.replaceState({}, "", next);
}
