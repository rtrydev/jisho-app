import * as Icon from "./Icon";

export type HistoryEntry = {
  id: string;
  text: string;
  termCount: number;
  when: string;
  active?: boolean;
};

export function HistoryRow({
  entry,
  index,
  onOpen,
  onReplay,
  onDelete,
}: {
  entry: HistoryEntry;
  index: number;
  onOpen?: () => void;
  onReplay?: () => void;
  onDelete?: () => void;
}) {
  return (
    <li
      className={`hrow ${entry.active ? "hrow-active" : ""}`}
      onClick={onOpen}
    >
      <div className="hrow-marker">
        {entry.active ? (
          <span className="dot-seal" />
        ) : (
          <span className="dot-num mono">{String(index + 1).padStart(2, "0")}</span>
        )}
      </div>
      <div className="hrow-body">
        <div className="hrow-text jp">{entry.text}</div>
        <div className="hrow-meta mono">
          <span>{entry.when}</span>
          <span className="dot-sep">·</span>
          <span>{entry.termCount} terms</span>
          {entry.active && (
            <>
              <span className="dot-sep">·</span>
              <span className="ink-seal">currently open</span>
            </>
          )}
        </div>
      </div>
      <div className="hrow-actions">
        <button type="button" className="ic-btn" aria-label="Replay" onClick={(e) => { e.stopPropagation(); onReplay?.(); }}>
          <Icon.Play size={18} />
        </button>
        <button type="button" className="ic-btn" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete?.(); }}>
          <Icon.Trash size={18} />
        </button>
      </div>
    </li>
  );
}

export function HistoryList({ children }: { children: React.ReactNode }) {
  return <ul className="hlist">{children}</ul>;
}
