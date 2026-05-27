"use client";

// KanjiCard — detail view for a single kanji.
//
// Composes existing primitives (Tag, Eyebrow, FloatingActions) under the
// shared `.card` base class so it inherits the same paper/edge/typography
// treatment as TermCard. Distinct from TermCard because the underlying
// data shape is different — kanji have on/kun readings, stroke counts,
// radicals, and JLPT levels rather than JMdict-style senses with POS.

import { Eyebrow } from "./Eyebrow";
import { FloatingActions } from "./FloatingActions";
import { Tag } from "./Tag";
import type { KanjiInfo } from "../lib/kanji/types";
import type { KanjiWordExample } from "../lib/analyzer";

export type KanjiCardData = {
  char: string;
  info: KanjiInfo;
  examples: KanjiWordExample[];
};

export function KanjiCard({
  card,
  onCopy,
  onRadicalClick,
  className,
}: {
  card: KanjiCardData;
  /** Copy the kanji character to clipboard. When omitted, the action
   *  doesn't render. */
  onCopy?: () => void;
  /** Fired when the user taps a radical in the "Radicals" section. Lets
   *  the host start a fresh radical search seeded with this radical, closing
   *  the loop from detail → exploration. When omitted, the radicals render
   *  as plain text. */
  onRadicalClick?: (radical: string) => void;
  className?: string;
}) {
  const { char, info, examples } = card;
  const cls = ["card", "card-kanji", className].filter(Boolean).join(" ");

  return (
    <article className={cls}>
      <FloatingActions onCopy={onCopy} />

      <header className="kc-head">
        <span className="kc-glyph jp">{char}</span>
        <div className="kc-tags">
          {info.s > 0 && <Tag>{info.s} strokes</Tag>}
          {info.j !== undefined && <Tag tone="jlpt">JLPT N{info.j}</Tag>}
          {info.g !== undefined && <Tag>Grade {info.g}</Tag>}
          {info.f !== undefined && <Tag>#{info.f}</Tag>}
        </div>
      </header>

      {info.m && info.m.length > 0 && (
        <section className="kc-section">
          <Eyebrow>Meaning</Eyebrow>
          <ol className="kc-meanings">
            {info.m.map((m, i) => (
              <li key={i}>
                <span className="g-num">{i + 1}</span>
                <span className="g-text">{m}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {((info.on && info.on.length > 0) || (info.kun && info.kun.length > 0)) && (
        <section className="kc-section">
          <Eyebrow>Readings</Eyebrow>
          {info.on && info.on.length > 0 && (
            <div className="kc-reading-row">
              <span className="kc-reading-label mono">On</span>
              <span className="kc-reading-text jp">{info.on.join("、")}</span>
            </div>
          )}
          {info.kun && info.kun.length > 0 && (
            <div className="kc-reading-row">
              <span className="kc-reading-label mono">Kun</span>
              <span className="kc-reading-text jp">{info.kun.join("、")}</span>
            </div>
          )}
        </section>
      )}

      {info.r && info.r.length > 0 && (
        <section className="kc-section">
          <Eyebrow>Radicals</Eyebrow>
          <div className="kc-radicals">
            {info.r.map((r) =>
              onRadicalClick ? (
                <button
                  key={r}
                  type="button"
                  className="kc-radical kc-radical-link jp"
                  onClick={() => onRadicalClick(r)}
                  aria-label={`Search by radical ${r}`}
                >
                  {r}
                </button>
              ) : (
                <span key={r} className="kc-radical jp">
                  {r}
                </span>
              ),
            )}
          </div>
        </section>
      )}

      {examples.length > 0 && (
        <section className="kc-section">
          <Eyebrow>In words</Eyebrow>
          <ul className="kc-words">
            {examples.map((ex) => (
              <li key={ex.headword} className="kc-word-row">
                <span className="jp kc-word-jp">{ex.headword}</span>
                {ex.reading && ex.reading !== ex.headword && (
                  <span className="ink-faint mono kc-word-reading">
                    {ex.reading}
                  </span>
                )}
                {ex.gloss && (
                  <span className="kc-word-gloss"> · {ex.gloss}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
