"use client";

import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { HistoryList, HistoryRow } from "../components/HistoryRow";
import { SearchField } from "../components/SearchField";
import { useIsMobile } from "../components/AppShell";
import {
  filterEntries,
  HISTORY_CAP,
  relativeWhen,
} from "../lib/history";
import { useUserData } from "../providers/UserDataProvider";

export function HistoryScreen({
  activeId,
  onOpen,
}: {
  activeId?: string | null;
  onOpen?: (text: string) => void;
}) {
  const mobile = useIsMobile();
  const { history, deleteHistoryEntry, clearHistory } = useUserData();
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => filterEntries(history, query), [history, query]);

  return (
    <div className={`screen history ${mobile ? "mobile" : "desktop"}`}>
      <header className="sc-head">
        <div>
          <h1 className="sc-title">History</h1>
          <div className="sc-sub mono ink-faint">
            {history.entries.length} of {HISTORY_CAP} stored locally · oldest evicted first
          </div>
        </div>
        <div className="sc-head-actions">
          <SearchField
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {history.entries.length > 0 &&
            (confirmClear ? (
              <div className="confirm-row">
                <span>Clear all {history.entries.length}?</span>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmClear(false)}
                  aria-label="Cancel"
                >
                  Cancel
                </Button>
                <Button
                  variant="warn"
                  onClick={() => {
                    clearHistory();
                    setConfirmClear(false);
                  }}
                  aria-label="Confirm clear"
                >
                  Clear
                </Button>
              </div>
            ) : (
              <Button variant="quiet" onClick={() => setConfirmClear(true)}>
                Clear all
              </Button>
            ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="rc-empty">
          {history.entries.length === 0
            ? "No analyses yet. Paste Japanese text on the Read screen to get started."
            : "No entries match your filter."}
        </div>
      ) : (
        <HistoryList>
          {filtered.map((h, i) => (
            <HistoryRow
              key={h.id}
              entry={{
                id: h.id,
                text: h.text,
                termCount: h.termCount,
                when: relativeWhen(h.lastViewedAt),
                active: h.id === activeId,
              }}
              index={i}
              onOpen={() => onOpen?.(h.text)}
              onReplay={() => onOpen?.(h.text)}
              onDelete={() => deleteHistoryEntry(h.id)}
            />
          ))}
        </HistoryList>
      )}
    </div>
  );
}
