import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  HistoryList,
  HistoryRow,
  type HistoryEntry,
} from "../../app/components/HistoryRow";

const entry: HistoryEntry = {
  id: "h_test",
  text: "私はその人を常に先生と呼んでいた。",
  termCount: 7,
  when: "just now",
};

const activeEntry: HistoryEntry = { ...entry, id: "h_active", active: true };

describe("HistoryRow", () => {
  it("inactive rows show a zero-padded index marker", () => {
    render(
      <HistoryList>
        <HistoryRow entry={entry} index={0} />
      </HistoryList>,
    );
    expect(document.querySelector(".dot-num")?.textContent).toBe("01");
    expect(document.querySelector(".dot-seal")).toBeNull();
  });

  it("active rows render the seal dot and the 'currently open' meta pill", () => {
    render(
      <HistoryList>
        <HistoryRow entry={activeEntry} index={0} />
      </HistoryList>,
    );
    expect(document.querySelector("li.hrow")).toHaveClass("hrow-active");
    expect(document.querySelector(".dot-seal")).not.toBeNull();
    expect(screen.getByText(/currently open/i)).toBeInTheDocument();
  });

  it("clicking the row triggers onOpen", async () => {
    const user = userEvent.setup();
    let opened = 0;
    render(
      <HistoryList>
        <HistoryRow entry={entry} index={0} onOpen={() => opened++} />
      </HistoryList>,
    );
    await user.click(document.querySelector("li.hrow") as HTMLElement);
    expect(opened).toBe(1);
  });

  it("Replay button fires onReplay AND stops propagation so onOpen is NOT also called", async () => {
    const user = userEvent.setup();
    let opened = 0;
    let replayed = 0;
    render(
      <HistoryList>
        <HistoryRow
          entry={entry}
          index={0}
          onOpen={() => opened++}
          onReplay={() => replayed++}
        />
      </HistoryList>,
    );
    const row = document.querySelector("li.hrow") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /replay/i }));
    expect(replayed).toBe(1);
    expect(opened).toBe(0);
  });

  it("Delete button fires onDelete and also stops propagation", async () => {
    const user = userEvent.setup();
    let opened = 0;
    let deleted = 0;
    render(
      <HistoryList>
        <HistoryRow
          entry={entry}
          index={0}
          onOpen={() => opened++}
          onDelete={() => deleted++}
        />
      </HistoryList>,
    );
    const row = document.querySelector("li.hrow") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /delete/i }));
    expect(deleted).toBe(1);
    expect(opened).toBe(0);
  });

  it("meta shows the relative time and term count", () => {
    render(
      <HistoryList>
        <HistoryRow entry={{ ...entry, when: "2 hours ago", termCount: 14 }} index={5} />
      </HistoryList>,
    );
    const meta = document.querySelector(".hrow-meta") as HTMLElement;
    expect(meta.textContent).toContain("2 hours ago");
    expect(meta.textContent).toContain("14 terms");
    expect(document.querySelector(".dot-num")?.textContent).toBe("06");
  });
});

describe("HistoryList", () => {
  it("wraps children in a single .hlist container", () => {
    render(
      <HistoryList>
        <HistoryRow entry={entry} index={0} />
        <HistoryRow entry={{ ...entry, id: "h_b" }} index={1} />
      </HistoryList>,
    );
    expect(document.querySelectorAll(".hlist")).toHaveLength(1);
    expect(document.querySelectorAll("li.hrow")).toHaveLength(2);
  });
});
