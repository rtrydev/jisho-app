<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system — "Editorial Ink"

This project ships a first-party design system for the Jisho v2 Japanese reading assistant. **It must be used.** Building a one-off element when a design-system component already covers the need is **strictly forbidden** — no inline buttons, no ad-hoc chips, no bespoke search inputs, no re-rolled tab bars, no parallel theme/accent logic.

## Where it lives

- **Tokens & component CSS:** `app/globals.css` — CSS variables for the parchment/ink palette (`--paper`, `--paper-card`, `--paper-sink`, `--paper-edge`, `--ink`, `--ink-soft`, `--ink-faint`, `--ink-ghost`, `--line`, `--line-soft`, `--rule`, `--seal`, `--seal-ink`, `--seal-glow`, `--indigo`, `--indigo-soft`, `--moss`, plus `--vocab-tint`/`--grammar-tint` and `--sh-1`/`--sh-2`/`--sh-3` shadows) with full dark-mode overrides under `[data-theme="dark"]` and accent remaps under `[data-accent="indigo"]` and `[data-accent="sumi"]`. Tokens are also registered as Tailwind v4 colors (`bg-paper`, `text-ink-faint`, `border-line`, `text-seal`, …) and fonts (`font-display`, `font-ui`, `font-jp`, `font-mono`) via `@theme inline`.
- **Components:** `app/components/` — every reusable primitive lives here as a TypeScript React component. The barrel export is `app/components/index.ts`.
- **Showcase:** `app/page.tsx` (route `/`) — the running app currently *is* the live reference of every component, color token, and typography family, with theme/accent/furigana/scale toggles bound to `<html data-*>`. Open it before designing a new screen.
- **Demo data:** `app/lib/demoData.ts` — pre-baked Sōseki / *Kokoro* analysis (tokens, term cards, history). Use it for any new showcase fragments or component fixtures; don't fabricate parallel demo content.

## Theme contract

Everything that needs to vary by theme/accent/furigana/scale is driven by data-attributes on the document root:

| Attribute | Values | Effect |
|---|---|---|
| `data-theme` | `light`, `dark` | Swaps the entire token palette |
| `data-accent` | `seal` (default), `indigo`, `sumi` | Remaps `--seal` + grammar tints |
| `data-furigana` | `always`, `hover`, `off` | Controls visibility of `<rt>` inside `.jp ruby` |
| `data-jp-scale` | `S`, `M`, `L` | Sets `--jp-scale` (S = 0.85, M = 1, L = 1.20). Each component rule that sizes `.jp` text multiplies its base size by `var(--jp-scale)` via `calc(Xpx * var(--jp-scale))`. |

No component computes its own colors. No component touches `document.documentElement` directly — drive these from a single settings provider when one is built.

## Components and what to use them for

| Component | Use it for | Don't roll your own when you need |
|---|---|---|
| `Hanko` (`size: mini \| sm \| md \| lg`) | Brand seal / logomark — appears in the rail, on the about card, anywhere the app needs to "sign" itself | A vermilion square with kanji inside |
| `Button` (`variant: primary \| quiet \| ghost \| warn \| icon`) | Every actionable button | A `<button>` styled inline |
| `Ruby`, `FuriganaSentence`, `romanize` | Furigana rendering and demo-grade hiragana→romaji | Manual `<ruby><rt>` markup or a romaji helper |
| `Icon.*` (15 icons: `Read`, `History`, `Favorites`, `Settings`, `Search`, `Close`, `Trash`, `Share`, `Copy`, `Collapse`, `Play`, `Check`, `ShareArrow`, `Seal`) | All icon usage | Inline SVG or a new icon library |
| `Segmented` (`variant: inline \| card`) | Mutually-exclusive options: theme/accent/scale, view filters, copy formats | A flex row of pill buttons |
| `SwatchRow` | Picking accent / palette options where the swatch matters | A custom color picker |
| `SearchField` | Any text search field (handles icon, focus ring) | An `<input>` wrapped with a magnifier icon |
| `TextField` (`jp` flag) | Settings inputs, default-sentence editor — JP variant uses the Mincho family | A bare `<input>` with a custom style |
| `Tag` (`tone: default \| jlpt \| vocab \| grammar`) | JLPT levels, frequency markers, type-of-content badges | A pill-shaped span |
| `PosPill` | Part-of-speech labels inside term cards | A bordered span using `mono` |
| `Eyebrow`, `RuleGold`, `Ornament` | Section captions, gold hairline dividers, kanji middots | Hand-rolled uppercase captions or `<hr>` |
| `Note` | Italic gold-rail callouts (usage notes, asides) | A bordered div with italic text |
| `FloatingActions` | The favorite / copy / share cluster pinned to the top-right of any card | A separate row of icon buttons |
| `BreakdownChip`, `BreakdownLegend` | One chip per token in a sentence breakdown (vocab / grammar / particle / punct) | A custom tile row for tokens |
| `Example`, `ExampleList` | Example sentences with `「` ornament, jp + italic en line | A bordered list of sentences |
| `ConjugationGrid` | The 5-column verb conjugation table | A custom table |
| `TermCard` | The atomic content card — vocab (indigo edge) or grammar (seal edge + tint); composes Ruby / FloatingActions / PosPill / Tag / ExampleList / ConjugationGrid / Note | A bespoke card showing a headword + glosses |
| `HistoryRow`, `HistoryList` | Auto-recorded query rows, active highlighting via `entry.active` | A custom list of past queries |
| `SideRail` | Desktop primary navigation (brand + items + tategaki marginalia) | A vertical flex column of nav buttons |
| `BottomTabs` | Mobile primary navigation | A flex row of icon-and-label buttons |
| `Sheet` | Bottom-sheet modal wrapper (handle + theme-aware shadow + gold hairline) — wrap any overlay panel | A custom modal/portal/dialog |
| `SettingGroup`, `SettingRow` | The card-surface + kanji-glyph wrapper for a settings section, and the label/hint/control row inside it | A bordered section with a heading |
| `DataAction`, `DataActionGrid` (`tone: quiet \| warn`) | Settings action buttons — export, import, destructive resets | A `<button>` with custom layout |
| `StorageBar` | Quota / progress indicator | A custom progress bar |

## Rules for using the system

1. **Reach for the component first.** Before writing any JSX, scan `app/components/` and `app/page.tsx`. If a component covers the use case — even approximately — use it.
2. **No bespoke re-implementations.** Creating a "view-specific" button, chip, search box, etc. is forbidden. If a variant is genuinely missing, **extend the existing component** (add a variant, add a prop) rather than forking it for one screen.
3. **Compose, don't fork.** Build new screens by composing existing primitives. If a screen feels like it needs custom styling, first ask whether a token (`var(--seal)`, `text-ink-faint`) or an existing component already expresses it.
4. **Use design tokens, not hex codes.** Colors come from CSS variables / Tailwind tokens. Hard-coding a hex like `#b73a2a` instead of `var(--seal)` is the same mistake as forking a component — it breaks theme/accent switching.
5. **Use the font families through `font-display` / `font-ui` / `font-jp` / `font-mono` (or the `.serif` / `.jp` / `.mono` utility classes — the body already uses `--f-ui` by default).** Don't hard-code `font-family` in inline styles.
6. **Honor the theme contract.** Anything you build must work in both light and dark and under all three accents (seal/indigo/sumi). Verify on the showcase before merging — the header toggles cover every dimension.
7. **Don't bypass `data-furigana` or `data-jp-scale`.** Render kana with `Ruby` / `FuriganaSentence` and wrap JP text in `.jp` (or use a `jp`-flagged component). The token cascade does the rest.

## Extending the system

When a real gap exists:

- Add the variant or prop to the existing component (`app/components/<Name>.tsx`). Add a corresponding CSS rule in `app/globals.css` only if a new visual concept is being introduced — prefer reusing an existing token-driven class.
- Re-export it from `app/components/index.ts` so consumers can import from the barrel.
- Add a fragment to the showcase (`app/page.tsx`) demonstrating the new variant — under the relevant `Section`, beside its siblings.
- Keep the API minimal: do not add props that only one consumer needs.
- Verify `npm run build` and `npm run lint` stay clean before opening the PR.

> **Tests:** there is no test runner wired up yet (`npm test` is not defined). When test coverage is set up, co-locate `*.test.tsx` alongside each component and query by role/label/text — don't reach for snapshot tests.

# Python work

For any Python-related work, always use the virtual environment located in the `venv/` directory at the root of the repo. If `venv/` does not exist, create it first with:

```
python -m venv venv
```

Then activate it (`source venv/bin/activate`) before installing packages or running Python scripts. Never invoke the system Python directly for project work.
