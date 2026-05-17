// URL-fragment based sharing — never hits a server.
// The text is UTF-8 encoded then base64url-encoded; for short Japanese inputs
// this is comfortably under the practical URL length limit. (pako isn't yet
// a dependency; we can swap in compression here later without changing the
// fragment format other than versioning the prefix.)

const PREFIX = "q1:";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeQuery(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return PREFIX + toBase64Url(bytes);
}

export function decodeQuery(fragment: string): string | null {
  const f = fragment.replace(/^#/, "");
  if (!f.startsWith(PREFIX)) return null;
  try {
    const bytes = fromBase64Url(f.slice(PREFIX.length));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function buildShareUrl(text: string): string {
  if (typeof window === "undefined") {
    return "#" + encodeQuery(text);
  }
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${encodeQuery(text)}`;
}

export function readFragmentQuery(): string | null {
  if (typeof window === "undefined") return null;
  return decodeQuery(window.location.hash);
}

export function clearFragment(): void {
  if (typeof window === "undefined") return;
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } else {
    window.location.hash = "";
  }
}
