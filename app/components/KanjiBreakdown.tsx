"use client";

// KanjiBreakdown — per-kanji rows below a vocab TermCard.
//
// Composes the same design-system primitives the rest of the cards use:
// Eyebrow as the section caption, Tag for the JLPT + stroke-count badges,
// and a small paper-card glyph tile that echoes KanjiTile's chrome. The
// whole row is a button; tapping it jumps to the Kanji screen via
// useNav().openKanji so the reader can dig deeper without losing place.

import { Eyebrow } from "./Eyebrow";
import { Tag } from "./Tag";
import { useKanjiData } from "../lib/kanji/useKanjiData";
import { useNav } from "../JishoApp";

function isCjk(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf);
}

function distinctKanji(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of text) {
    if (isCjk(ch) && !seen.has(ch)) {
      seen.add(ch);
      out.push(ch);
    }
  }
  return out;
}

export function KanjiBreakdown({ text }: { text: string }) {
  const kanji = useKanjiData();
  const { openKanji } = useNav();

  const chars = distinctKanji(text);
  if (chars.length === 0) return null;
  // Hide silently while loading or on error — the rest of the card still
  // renders and the full data is available on the Kanji screen anyway.
  if (kanji.status.kind !== "ready" || !kanji.resources) return null;
  const map = kanji.resources.kanji;

  // Drop chars outside the shipped class set (kanji.json.gz covers the
  // JMdict ∩ KANJIDIC2 ∩ RADKFILE intersection — extension-A characters
  // and rare historical kanji are intentionally absent).
  const rows = chars.filter((ch) => map[ch]);
  if (rows.length === 0) return null;

  return (
    <section className="kb">
      <Eyebrow>Kanji</Eyebrow>
      <ul className="kb-list">
        {rows.map((ch) => {
          const info = map[ch];
          const meaning = info.m?.slice(0, 3).join("; ");
          return (
            <li key={ch}>
              <button
                type="button"
                className="kb-row"
                onClick={() => openKanji(ch)}
                aria-label={`Open kanji ${ch} in the Kanji screen`}
              >
                <span className="kb-glyph jp" aria-hidden>
                  {ch}
                </span>
                <span className="kb-body">
                  {(info.on?.length || info.kun?.length) && (
                    <span className="kb-readings">
                      {info.on?.length ? (
                        <span className="kb-reading">
                          <span className="kb-reading-label mono">On</span>
                          <span className="kb-reading-text jp">
                            {info.on.join("、")}
                          </span>
                        </span>
                      ) : null}
                      {info.kun?.length ? (
                        <span className="kb-reading">
                          <span className="kb-reading-label mono">Kun</span>
                          <span className="kb-reading-text jp">
                            {info.kun.join("、")}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  )}
                  {meaning && <span className="kb-meaning">{meaning}</span>}
                </span>
                <span className="kb-tags">
                  {info.j !== undefined && <Tag tone="jlpt">{`N${info.j}`}</Tag>}
                  <Tag>{`${info.s} strokes`}</Tag>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
