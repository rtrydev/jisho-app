import type { TermCardData } from "../components/TermCard";
import type { CopyFormat } from "./settings";

export function formatCard(card: TermCardData, format: CopyFormat): string {
  if (format === "markdown") {
    const lines: string[] = [];
    const reading = card.reading ? ` （${card.reading}）` : "";
    lines.push(`### ${card.head}${reading}`);
    if (card.pos.length) lines.push(`_${card.pos.join(" · ")}_`);
    if (card.formula) lines.push(`\n> ${card.formula}`);
    lines.push("");
    card.glosses.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
    if (card.notes) lines.push(`\n_${card.notes}_`);
    if (card.explanation) lines.push(`\n${card.explanation}`);
    if (card.examples?.length) {
      lines.push("\n**Examples**");
      for (const ex of card.examples) {
        lines.push(`- ${ex.jp}${ex.rt ? ` （${ex.rt}）` : ""}`);
        if (ex.en) lines.push(`  - _${ex.en}_`);
      }
    }
    return lines.join("\n");
  }
  // plain
  const lines: string[] = [];
  const reading = card.reading ? ` (${card.reading})` : "";
  lines.push(`${card.head}${reading}`);
  if (card.pos.length) lines.push(card.pos.join(" / "));
  if (card.formula) lines.push(card.formula);
  card.glosses.forEach((g, i) => lines.push(`${i + 1}. ${g}`));
  if (card.notes) lines.push(card.notes);
  if (card.explanation) lines.push(card.explanation);
  if (card.examples?.length) {
    for (const ex of card.examples) {
      lines.push(`  ${ex.jp}${ex.rt ? ` (${ex.rt})` : ""}`);
      if (ex.en) lines.push(`    ${ex.en}`);
    }
  }
  return lines.join("\n");
}

export function formatAllResults(
  sentence: string,
  english: string | undefined,
  cards: TermCardData[],
  format: CopyFormat,
): string {
  if (format === "markdown") {
    const header = [
      `# ${sentence}`,
      english ? `_${english}_` : null,
      "",
    ].filter((x): x is string => x !== null);
    const body = cards.map((c) => formatCard(c, format)).join("\n\n---\n\n");
    return [...header, body].join("\n");
  }
  const header = [sentence, english ?? "", "".padEnd(40, "─"), ""].filter(Boolean);
  const body = cards.map((c) => formatCard(c, format)).join("\n\n" + "".padEnd(40, "─") + "\n\n");
  return header.join("\n") + body;
}

/** Best-effort clipboard write; degrades to a contenteditable + execCommand fallback. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  if (typeof document === "undefined") return false;
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
