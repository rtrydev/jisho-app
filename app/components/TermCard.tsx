import { Ruby, romanize } from "./Ruby";
import { FloatingActions } from "./FloatingActions";
import { ExampleList, type ExampleSentence } from "./Example";
import { ConjugationGrid, type Conjugation } from "./ConjugationGrid";
import { Tag, PosPill } from "./Tag";

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
  const cls = [
    "card",
    isGrammar ? "card-grammar" : "card-vocab",
    highlight ? "pulsing" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

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
