import { Ruby, romanize } from "./Ruby";
import { FloatingActions } from "./FloatingActions";
import { ExampleList, type ExampleSentence } from "./Example";
import { ConjugationGrid, type Conjugation } from "./ConjugationGrid";
import { Tag, PosPill } from "./Tag";

/** One JP entry surfaced as a translation candidate for an English query.
 *  Populated only on EN→JP cards (where `candidates` is non-empty). */
export type CandidateRef = {
  /** JP headword (kanji or kana form). */
  head: string;
  /** Kana reading, when distinct from the headword. */
  reading?: string;
  /** Kind of underlying entry — controls the colorway of the candidate row
   *  (vocab → indigo, grammar → seal). */
  kind: "vocab" | "grammar";
  /** POS tags for the matched sense — same shape as the top-level pos. */
  pos: string[];
  /** First English gloss of the matched sense, used as a one-line
   *  disambiguator next to the headword (e.g., "to give up; to abandon"). */
  disambig?: string;
};

export type TermCardData = {
  id: string;
  type: "vocab" | "grammar";
  head: string;
  reading?: string;
  surface?: string;
  pos: string[];
  tags?: string[];
  glosses: string[];
  notes?: string;
  explanation?: string;
  formula?: string;
  conjugation?: Conjugation;
  examples?: ExampleSentence[];
  /** EN→JP card content. When set, the card renders in inverted layout:
   *  the head is the English query, the body lists JP candidates, and the
   *  numbered gloss list / examples / conjugation are suppressed (those
   *  belong to a specific JP entry; this card represents an aggregate). */
  candidates?: CandidateRef[];
};

export function TermCard({
  card,
  favorite,
  onToggleFavorite,
  onCopy,
  onShare,
  compact = false,
  highlight = false,
  className,
}: {
  card: TermCardData;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  compact?: boolean;
  highlight?: boolean;
  className?: string;
}) {
  const isGrammar = card.type === "grammar";
  const isInverted = !!(card.candidates && card.candidates.length > 0);
  const cls = [
    "card",
    isGrammar ? "card-grammar" : "card-vocab",
    isInverted ? "card-en" : "",
    highlight ? "pulsing" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (isInverted) {
    return (
      <article className={cls} data-card-id={card.id}>
        <FloatingActions
          favorite={favorite}
          onFavorite={onToggleFavorite}
          onCopy={onCopy}
          onShare={onShare}
        />
        <header className="card-head">
          <div className="card-headword">
            <span className="card-headword-en serif">{card.head}</span>
          </div>
        </header>
        <ol className="candidates">
          {card.candidates!.map((c, i) => (
            <li key={`${c.head}-${i}`} className={`cand cand-${c.kind}`}>
              <div className="cand-headline">
                <span className="cand-jp jp">
                  {c.reading && c.reading !== c.head ? (
                    <Ruby base={c.head} rt={c.reading} />
                  ) : (
                    <span>{c.head}</span>
                  )}
                </span>
                {c.pos.length > 0 && (
                  <span className="cand-pos">
                    {c.pos.map((p) => (
                      <PosPill key={p}>{p}</PosPill>
                    ))}
                  </span>
                )}
              </div>
              {c.reading && c.reading !== c.head && (
                <div className="cand-reading ink-faint mono">
                  {romanize(c.reading)}
                </div>
              )}
              {c.disambig && <div className="cand-disambig">{c.disambig}</div>}
            </li>
          ))}
        </ol>
      </article>
    );
  }

  return (
    <article className={cls} data-card-id={card.id}>
      <FloatingActions
        favorite={favorite}
        onFavorite={onToggleFavorite}
        onCopy={onCopy}
        onShare={onShare}
      />

      <header className="card-head">
        <div className="card-headword">
          <span className="card-headword-jp jp">
            {isGrammar || !card.reading ? (
              <span>{card.head}</span>
            ) : (
              <Ruby base={card.head} rt={card.reading} />
            )}
          </span>
          {!isGrammar && card.surface && card.surface !== card.head && (
            <span className="card-surface mono">surface · {card.surface}</span>
          )}
        </div>
        <div className="card-meta">
          {card.pos.map((p) => (
            <PosPill key={p}>{p}</PosPill>
          ))}
        </div>
      </header>

      {!isGrammar && card.reading && (
        <div className="card-reading">
          <span className="jp">{card.reading}</span>
          <span className="ink-faint mono"> · {romanize(card.reading)}</span>
        </div>
      )}

      {isGrammar && card.formula && (
        <div className="card-formula mono">{card.formula}</div>
      )}

      <ol className="glosses">
        {card.glosses.map((g, i) => (
          <li key={i}>
            <span className="g-num">{i + 1}</span>
            <span className="g-text">{g}</span>
          </li>
        ))}
      </ol>

      {(card.notes || card.explanation) && !compact && (
        <p className="card-notes">{card.notes ?? card.explanation}</p>
      )}

      {!isGrammar && card.conjugation && !compact && (
        <ConjugationGrid conjugation={card.conjugation} />
      )}

      {!compact && card.examples && card.examples.length > 0 && (
        <ExampleList examples={card.examples} />
      )}

      {card.tags && card.tags.length > 0 && (
        <div className="card-tags">
          {card.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}
    </article>
  );
}
