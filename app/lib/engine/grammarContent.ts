// Parse a Yomitan v3 structured-content array into the shapes the TermCard
// renderer needs: a list of meanings, an explanation paragraph, and example
// sentence pairs.
//
// The bank uses three full-width English section markers that we key on
// (note the internal spaces — they are part of the literal):
//   "【 Meaning 】"
//   "【 Explanation 】"
//   "【 Example sentences 】"
//
// Each marker is followed by structured-content children belonging to that
// section, until the next marker or end of array. We walk one level deep —
// enough for the v1 grammar bank's shape.

import type { ExampleSentence } from "../../components/Example";

type Section = "meaning" | "explanation" | "examples" | null;

type SCNode = string | { type?: string; tag?: string; content?: unknown };

function isObj(n: unknown): n is { type?: string; tag?: string; content?: unknown } {
  return typeof n === "object" && n !== null;
}

function flattenText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isObj(node) && "content" in node) return flattenText(node.content);
  return "";
}

function detectSection(text: string): Section {
  if (text.includes("【 Meaning 】")) return "meaning";
  if (text.includes("【 Explanation 】")) return "explanation";
  if (text.includes("【 Example sentences 】")) return "examples";
  return null;
}

/** Pull jp + en out of one example list-item. The bank stores them as a single
 *  string containing "<japanese>\n <english>", so we split on the first newline.
 *  Whitespace inside the kana / kanji (the bank pads characters with U+3000
 *  spaces for furigana alignment) is preserved as-is. */
function parseExampleString(s: string): ExampleSentence | null {
  const idx = s.indexOf("\n");
  if (idx < 0) {
    const trimmed = s.trim();
    return trimmed ? { jp: trimmed, en: "" } : null;
  }
  const jp = s.slice(0, idx).trim();
  const en = s.slice(idx + 1).trim();
  if (!jp) return null;
  return { jp, en };
}

/** Walk a node tree. If the node is (or contains) a list-item, return the
 *  flattened text of that item. */
function collectListItems(node: SCNode, out: string[]): void {
  if (typeof node === "string" || !isObj(node)) return;
  if (node.tag === "li") {
    out.push(flattenText(node.content));
    return;
  }
  const c = node.content;
  if (Array.isArray(c)) for (const child of c) collectListItems(child as SCNode, out);
  else if (isObj(c)) collectListItems(c as SCNode, out);
}

export type GrammarContent = {
  glosses: string[];
  explanation?: string;
  examples: ExampleSentence[];
};

export function extractGrammarContent(scContent: unknown[]): GrammarContent {
  const meanings: string[] = [];
  const explanationParts: string[] = [];
  const examples: ExampleSentence[] = [];
  let section: Section = null;

  for (const node of scContent) {
    if (typeof node === "string") {
      const next = detectSection(node);
      if (next) {
        section = next;
        continue;
      }
      // Loose paragraph text outside any section header gets dropped.
      continue;
    }

    if (!isObj(node)) continue;

    if (section === "meaning") {
      const text = flattenText(node).trim();
      if (text) meanings.push(text);
    } else if (section === "explanation") {
      const text = flattenText(node).trim();
      if (text) explanationParts.push(text);
    } else if (section === "examples") {
      const items: string[] = [];
      collectListItems(node as SCNode, items);
      for (const item of items) {
        const ex = parseExampleString(item);
        if (ex) examples.push(ex);
      }
    }
  }

  return {
    glosses: meanings.length > 0 ? meanings : [],
    explanation: explanationParts.length > 0 ? explanationParts.join(" ") : undefined,
    examples,
  };
}

/** Find the structured-content root node inside a grammar entry's content
 *  array. Returns its content[] (already unwrapped), or [] if missing. */
export function findStructuredContent(glossary: unknown[]): unknown[] {
  for (const node of glossary) {
    if (isObj(node) && node.type === "structured-content" && Array.isArray(node.content)) {
      return node.content;
    }
  }
  return [];
}
