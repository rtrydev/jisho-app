<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system

This project ships a first-party design system. **It must be used.** Building a one-off element when a design-system component already covers the need is **strictly forbidden** — no inline buttons, no ad-hoc chips, no bespoke search inputs, no re-rolled tab bars, no parallel theme/accent logic.

## Where it lives

- **Tokens & utility classes:** `app/globals.css` — CSS variables for the parchment/lacquer/saffron palette (`--bg`, `--paper`, `--ink`, `--ink-2`, `--ink-3`, `--ink-faint`, `--gold`, `--gold-soft`, `--ruby`, `--ruby-soft`, `--jade`, `--border`, `--border-2`, `--surface`, `--surface-2`, `--shadow*`, `--modal-*`) with full dark-mode overrides under `.dark`. Tokens are also registered as Tailwind colors (`bg-paper`, `text-ink-2`, `border-gold`, etc.) and fonts (`font-serif`, `font-mm`, `font-ui`, `font-mono`).
- **Components:** `app/components/` — every reusable primitive lives here, each with a co-located `*.test.tsx`.
- **Showcase:** `app/system/page.tsx` (route `/system`) — live reference of every component, color token, and typography family. Open it before designing a new screen.
- **App views:** `app/views/` — composed screens that make up the running dictionary app at `/`. Not part of the design system; tests live alongside as `*.test.tsx` and exercise the views with a fixture engine via `app/lib/app/__fixtures__/buildAppFixture.tsx`.

## Components and what to use them for

| Component | Use it for | Don't roll your own when you need |
|---|---|---|
| `Button` (`variant: primary \| secondary \| ghost \| icon`) | Every actionable button | A `<button>` styled inline |
| `Chip` (`variant: default \| solid \| exact \| partial \| fuzzy`) | Tags, filter pills, status badges, result-relevance markers | A pill-shaped span |
| `SearchInput` | Any text search field (handles icon, focus ring, clear button) | An `<input>` wrapped with a magnifier icon |
| `WordBlock` | Tappable Burmese/English word tile (sentence breakdown) | A custom card showing mm + en |
| `ResultRow` | Search-result rows (single entry or grouped, with chip) | Hand-built list items in result lists |
| `Card`, `Note` | Sheet/panel surface and gold-bordered callout | A bordered div with a heading |
| `Eyebrow`, `RuleGold`, `Ornament` | Section headers and ornamental dividers | Hand-rolled uppercase captions or hairlines |
| `TabBar` | Bottom navigation between top-level views | A flex row of buttons with icons |
| `Logo`, `Wordmark` | Brand mark and lockup | An `<Image>` import of the logo |
| `Icon.*` (16 icons) | All icon usage | Inline SVG or a new icon library |
| `EntryDetail` | Full entry view (headword, IPA/POS, glosses, forms, action bar) | A bespoke detail panel in the desktop rail or modal |
| `Sheet` | Bottom-sheet modal wrapper (theme-aware dim + shadow + gold hairline) — wrap entry detail, settings, any future overlay panel | A custom modal/portal/dialog |
| `ThemeToggle`, `AccentSwitcher` | Light/dark switching and accent remap | A separate state machine touching `document.documentElement` |

## Rules for using the system

1. **Reach for the component first.** Before writing any JSX, scan `app/components/` and `app/system/page.tsx`. If a component covers the use case — even approximately — use it.
2. **No bespoke re-implementations.** Creating a "view-specific" button, chip, search box, etc. is forbidden. If a variant is genuinely missing, **extend the existing component** (add a variant, add a prop) rather than forking it for one screen.
3. **Compose, don't fork.** Build new screens by composing existing primitives. If a screen feels like it needs custom styling, first ask whether a token (`var(--gold)`, `text-ink-3`) or an existing component already expresses it.
4. **Use design tokens, not hex codes.** Colors come from CSS variables / Tailwind tokens. Hard-coding a hex like `#B07820` instead of `var(--gold)` is the same mistake as forking a component — it breaks theme/accent switching.
5. **Use the font families through `font-serif` / `font-mm` / `font-ui` / `font-mono` (or the `.serif` / `.mm` / `.ui` / `.mono` utility classes).** Don't hard-code `font-family` in inline styles.
6. **Honor the theme contract.** Anything you build must work in both light and dark and under all four accents (ruby/gold/jade/indigo) — that's the reason the tokens exist. Verify on the showcase page before merging.

## Extending the system

When a real gap exists:

- Add the variant or prop to the existing component (`app/components/<Name>.tsx`).
- Update the co-located test (`app/components/<Name>.test.tsx`) to cover the new behavior — accessibility, keyboard, callbacks where applicable.
- Add an example to the showcase (`app/system/page.tsx`).
- Keep the API minimal: do not add props that only one consumer needs.

`npm test` must stay green; tests query by role/label/text and assert on user-perceivable outcomes (see the existing tests for the pattern).

# Python work

For any Python-related work, always use the virtual environment located in the `venv/` directory at the root of the repo. If `venv/` does not exist, create it first with:

```
python -m venv venv
```

Then activate it (`source venv/bin/activate`) before installing packages or running Python scripts. Never invoke the system Python directly for project work.
