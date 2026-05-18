import { Ruby } from "./Ruby";

export type ChipKind = "vocab" | "grammar" | "particle" | "punct";
export type ChipScript = "ja" | "en";

export type BreakdownToken = {
  surface: string;
  reading?: string;
  pos: string;
  cardId?: string | null;
  kind?: ChipKind;
  /** Which script the surface is written in. JA chips render with the Mincho
   *  family and align furigana via `<ruby>`; EN chips drop the JP class on
   *  the surface so Latin renders in the body font and the `pos` slot
   *  carries the JP headword as a hint instead. */
  script?: ChipScript;
};

function inferKind(token: BreakdownToken): ChipKind {
  if (token.kind) return token.kind;
  if (token.pos === "punct") return "punct";
  if (token.pos === "particle") return "particle";
  if (token.cardId?.startsWith("g-")) return "grammar";
  if (token.cardId?.startsWith("v-")) return "vocab";
  return "particle";
}

export function BreakdownChip({
  token,
  active,
  onClick,
}: {
  token: BreakdownToken;
  active?: boolean;
  onClick?: () => void;
}) {
  const kind = inferKind(token);
  const script: ChipScript = token.script ?? "ja";
  if (kind === "punct") {
    return (
      <span className={`chip-punct${script === "ja" ? " jp" : ""}`}>
        {token.surface}
      </span>
    );
  }
  const cls = [
    "chip",
    kind === "particle" ? "chip-particle" : "",
    kind === "grammar" ? "chip-grammar" : "",
    kind === "vocab" ? "chip-vocab" : "",
    script === "en" ? "chip-en" : "",
    active ? "chip-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  // For JA the chip-pos slot holds the morphological POS; for EN it holds
  // the JP headword the match resolves to (rendered with the JP family so it
  // sits naturally under the EN surface).
  const posIsJp = script === "en" && kind !== "particle";
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={`${token.pos}${token.reading ? " · " + token.reading : ""}`}
      aria-pressed={active ?? false}
    >
      <span className={`chip-surface${script === "ja" ? " jp" : ""}`}>
        {token.reading ? <Ruby base={token.surface} rt={token.reading} /> : token.surface}
      </span>
      <span className={`chip-pos${posIsJp ? " jp" : ""}`}>{token.pos}</span>
    </button>
  );
}

export function BreakdownLegend() {
  return (
    <div className="rb-legend mono">
      <span><span className="lg-vocab">■</span>vocab</span>
      <span><span className="lg-gram">■</span>grammar</span>
      <span><span className="lg-part">·</span>particle</span>
    </div>
  );
}
