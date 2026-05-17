# Jisho · 辞書

A quiet, offline-first workspace for reading Japanese. Paste a sentence and the
app segments it morphologically, looks up vocabulary against JMdict, matches
multi-token grammar patterns against a Yomitan-style grammar bank, and renders
an interactive breakdown plus detailed term cards with furigana, glosses, and
example sentences.

Everything runs in the browser. There is no backend, no account system, and no
server-side state — the dictionary, grammar bank, and morphology engine are all
shipped as static assets and processed locally.

Live at [jisho.rtrydev.com](https://jisho.rtrydev.com).

## What's in the box

- **Read** — the home screen. Paste Japanese, get a per-token breakdown and a
  deduplicated set of vocab + grammar term cards. URL `?q=…` is kept in sync so
  the current query is shareable / refreshable.
- **History** — every successful analysis is recorded locally and replayable.
- **Favorites** — save individual vocab or grammar terms; they're stored as
  dictionary references, not snapshots, so they re-resolve against the live
  resources.
- **Settings** — theme (light / dark / system), accent (seal / indigo / sumi),
  furigana mode (always / hover / off), Japanese-glyph scale (S / M / L),
  default sentence, copy format (Markdown / plain), and data export / import /
  reset.
- **Sharing & copying** — `?q=…` deep links, per-card copy + share, and a
  whole-analysis "copy all" formatted per the Settings preference.
- **PWA** — installable, with a web app manifest, maskable icons, and a
  pre-hydration script that paints the correct theme on the very first frame
  (no white flash on cold load, no light flash for dark-mode users).

## Stack

- **Framework:** Next.js 16 with `output: "export"` — the whole app is a static
  bundle. Hydration happens once on the client; kuromoji + the compiled
  dictionary load lazily on first analysis.
- **UI:** React 19, Tailwind v4, a first-party design system ("Editorial Ink")
  in [app/components/](app/components/) driven entirely by CSS variables and
  `data-*` attributes on `<html>`. See [AGENTS.md](AGENTS.md) for the
  rules — design tokens, components, and theme contract.
- **Engine:** kuromoji + IPADIC for morphology; JMdict (English) for vocab; a
  Yomitan v3 grammar bank for grammar pattern matching. All wrapped behind a
  single `useAnalyzer` hook ([app/lib/analyzer.ts](app/lib/analyzer.ts)).
- **Persistence:** `localStorage` under the `jp:v2:*` namespace with versioned
  payloads and graceful in-memory fallback when quota / private mode bite.
- **Tests:** Vitest + Testing Library; specs live in [tests/](tests/) next to
  the screen / component they cover.
- **Hosting:** S3 + CloudFront, provisioned by Terraform, deployed by
  [scripts/deploy.sh](scripts/deploy.sh).

## Repository layout

| Path | What's there |
|---|---|
| [app/](app/) | Next.js App Router source — `JishoApp.tsx` composes the providers + screens. |
| [app/components/](app/components/) | The Editorial Ink design system — the only place to reach for UI primitives. |
| [app/screens/](app/screens/) | Read / History / Favorites / Settings. |
| [app/providers/](app/providers/) | `EngineProvider`, `SettingsProvider`, `UserDataProvider`. |
| [app/lib/](app/lib/) | Pure logic: analyzer, storage, settings, history/favorites, share-URL helpers. The engine internals sit under `app/lib/engine/`. |
| [app/showcase/](app/showcase/) | A standalone reference page that exercises every design-system component, color token, and typography family. |
| [tools/](tools/) | Python data pipeline — produces the static assets the app loads at runtime. See [tools/README.md](tools/README.md). |
| [data/](data/) | Operator-supplied source files for the pipeline (`JMdict_e.gz`, `sentence_pairs.tsv`, `grammar.zip`). Gitignored. See [data/README.md](data/README.md). |
| [public/data/](public/data/) | Generated `dictionary.json.gz`, `grammar.json.gz`, `grammar-manifest.json` — the runtime assets the engine fetches. Gitignored. |
| [public/dict/](public/dict/) | Kuromoji IPADIC files synced from `node_modules` by `postinstall`. Gitignored. |
| [terraform/](terraform/) | AWS hosting stack (S3 + CloudFront + ACM + Route 53). See [terraform/README.md](terraform/README.md). |
| [scripts/](scripts/) | `deploy.sh` (build + sync + invalidate) and `sync-kuromoji-dict.mjs` (postinstall). |
| [docs/](docs/) | Long-form specs — `app-spec.md` and `data-pipeline-spec.md`. |
| [tests/](tests/) | Vitest suites for screens and components. |

## Getting started

```bash
npm install        # also runs postinstall → copies kuromoji IPADIC into public/dict/
npm run dev        # http://localhost:3000
```

Available scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server. |
| `npm run build` | Static export into `out/`. |
| `npm run start` | Serve a previously built export. |
| `npm run lint` | ESLint (Next.js config). |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Vitest in watch mode. |

### Runtime data assets

The app expects three files under [public/data/](public/data/):

- `dictionary.json.gz`
- `grammar.json.gz`
- `grammar-manifest.json`

These are produced by the Python data pipeline in [tools/](tools/) and are
**not committed**. Without them the engine will boot but every lookup will fail
— and `scripts/deploy.sh` will refuse to deploy.

To generate them, drop the source snapshots into [data/](data/) (see
[data/README.md](data/README.md) for the required filenames and licenses), then:

```bash
python -m venv venv            # only the first time
source venv/bin/activate
pip install -r tools/requirements.txt
python -m tools.data_pipeline
```

## Deploying

The site is hosted at `jisho.rtrydev.com` on a private S3 bucket fronted by
CloudFront, with ACM + Route 53 wired up to the existing `rtrydev.com` zone.
The whole stack is described in [terraform/](terraform/).

```bash
./scripts/deploy.sh           # terraform apply + next build + s3 sync + CloudFront invalidation
./scripts/deploy.sh --yes     # skip the terraform confirmation prompt
```

The script verifies AWS credentials, exports them so Terraform sees the same
identity, applies the stack, builds the static export, syncs `out/` to S3 with
split cache headers (immutable for fingerprinted assets, short TTL for HTML /
JSON / manifest), and issues a CloudFront invalidation.

Requires AWS CLI v2 (for `aws configure export-credentials`) and Terraform
`>= 1.6`.

## Project conventions

- **Design system is mandatory.** Don't roll bespoke buttons / chips / inputs;
  use or extend the components in [app/components/](app/components/). The full
  set of rules is in [AGENTS.md](AGENTS.md).
- **Tokens, not hex codes.** Colors come from CSS variables (`var(--seal)`,
  `var(--paper-card)`, …) or their Tailwind v4 mappings (`bg-paper`,
  `text-ink-faint`, …). Hard-coded colors break the theme/accent cascade.
- **Theme contract.** Theme / accent / furigana / glyph scale are driven from
  `<html data-*>`. Only `SettingsProvider` writes them; components only read.
- **Engine is sealed.** Every consumer goes through `useAnalyzer`. Nothing
  outside `app/lib/engine/` should import from `app/lib/engine/`.
- **No Python on the system interpreter.** Pipeline work uses the `venv/` at
  the repo root.
