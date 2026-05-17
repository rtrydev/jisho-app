import { Ruby } from "./Ruby";

export type ChipKind = "vocab" | "grammar" | "particle" | "punct";

export type BreakdownToken = {
  surface: string;
  reading?: string;
  pos: string;
  cardId?: string | null;
  kind?: ChipKind;
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
  if (kind === "punct") {
    return <span className="chip-punct jp">{token.surface}</span>;
  }
  const cls = [
    "chip",
    kind === "particle" ? "chip-particle" : "",
    kind === "grammar" ? "chip-grammar" : "",
    kind === "vocab" ? "chip-vocab" : "",
    active ? "chip-active" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      title={`${token.pos}${token.reading ? " · " + token.reading : ""}`}
      aria-pressed={active ?? false}
    >
      <span className="chip-surface jp">
        {token.reading ? <Ruby base={token.surface} rt={token.reading} /> : token.surface}
      </span>
      <span className="chip-pos">{token.pos}</span>
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
