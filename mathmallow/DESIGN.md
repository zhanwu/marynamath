# Mathmallow — Design 🍡

Mathmallow is a small local web app that delivers math exercise sets to one child and
records their answers. A parent runs it on a home machine; the child opens the web UI from
another device on the same Wi-Fi. It is **decoupled from the teacher agent** (Maryna): the
two never call each other — they exchange JSON files through shared folders under `shared/`.

Scope: single family, single student, low stakes. Optimized for simplicity, robustness, and
a kid-friendly UI — not scale, auth, or multi-tenancy.

## Stack

- **Node.js + Express** — JSON API + serves the static frontend.
- **better-sqlite3** — session/answer working state (resume across restarts).
- **Plain HTML + vanilla JS + CSS** — no build step, no frontend framework.
- Runs with `npm install` && `npm start` (Node 18+). Binds `0.0.0.0`; prints the LAN URL.

## Layout

```
mathmallow/
  server.js              # startup: binds 0.0.0.0, prints LAN URL + port
  src/
    app.js               # createApp(): endpoints, dir resolution, result writing
    db.js                # SQLite open + migrate (sessions, answers)
    sets.js              # load/validate sets; stripAnswers() chokepoint
    grading.js           # pure auto-grading + scoring
  public/                # index.html, app.js, styles.css, widgets/registry.js
  capabilities.json      # capability manifest (served at /api/capabilities)
  db/                    # SQLite file (gitignored)
shared/exercise_sets/      # INPUT  — sets the agent writes; Mathmallow serves them
shared/results/            # OUTPUT — <set-id>.result.json written on submit
schemas/                 # canonical example fixtures (also used in tests)
```

Shared-folder paths are configurable via `EXERCISE_SETS_DIR` / `RESULTS_DIR` (defaults
`shared/exercise_sets` and `shared/results`, relative to repo root).

## Data contract

The agent↔app contract is two JSON shapes. Canonical examples live in `schemas/`.

**Exercise set** (`shared/exercise_sets/<set-id>.json`): top-level `set_id`, `student`,
`subject`, `title`, `framework`, `grade_band`, `created_at`, `instructions`,
`time_limit_minutes`, and `questions[]`. Each question has `id`, `type`, `prompt`, `render`,
`choices`, `answer`, `answer_tolerance`, `points`, `skill_tag`, `difficulty`, `hint`.

**Question types** (all auto-gradable — there is **no free-text type**):
- `numeric` — number; correct if `|student − answer| ≤ answer_tolerance`.
- `multiple_choice` — `correct` if the selected choice equals `answer` exactly.
- `true_false` — boolean compare.

**Result** (`shared/results/<set-id>.result.json`): `set_id`, `student`, `started_at`,
`submitted_at`, `duration_seconds`, `answers[]` (`id`, `student_answer`, `correct`,
`time_spent_seconds`, `attempts`), and `score`.

🔒 **The `answer` / `answer_tolerance` fields are stripped before any question reaches the
browser** — answers live server-side only. `sets.js#stripAnswers` is the single chokepoint;
a test asserts no answer ever leaks over HTTP.

### Scoring

`score = { raw, max, percent, pending }`, over **auto-graded questions only**:
- `correct === true` → its `points` add to both `raw` and `max`.
- `correct === false` → `points` add to `max` only.
- `correct === null` (pending) → excluded from `raw` **and** `max`; counted in `pending`.
- `percent = round(100·raw/max)`, or `null` if `max === 0`.

A `null` is *pending teacher grading, not wrong* — it must not drag the score down. With the
three auto-gradable types, `pending` is normally `0`; it only occurs for an ungradable
structured widget-input value (see below).

## Visual questions

Many K–5 subjects need a picture (clocks, shapes, fractions, number lines, graphs). The
agent never draws — it attaches a declarative `render` spec; the app renders it. `render` is
a tagged union: `kind ∈ {none, widget, image, svg}`.
- **widget** — looked up in the client-side registry (`public/widgets/registry.js`) and drawn
  as inline SVG. Starter catalog: `analog-clock`, `number-line`, `fraction-bar`,
  `fraction-circle`, `array-dots`, `base-ten-blocks`, `shape`, `bar-model`, `coordinate-grid`,
  `bar-chart`.
- **image** / **svg** — escape hatches so *any* visual is expressible before a dedicated
  widget exists (svg is sanitized). The agent is never blocked.

The visual is the *stimulus*; the answer is a normal question type. **Interactive input
widgets** (drag the clock, tap to shade) are an optional future capability — advertised with
`canInput: true`, producing a structured `student_answer` graded by deep-equality. Display-only
is the current baseline.

### Capability manifest

So the agent knows what the app can render without hardcoding a widget list, the app publishes
`capabilities.json` (served at `GET /api/capabilities`): supported `question_types`,
`render_kinds`, and `widgets` with their params. A test keeps the manifest in sync with the
implemented registry. Adding a visual = one renderer + one manifest entry; the agent discovers
it by re-reading the manifest. **The widget catalog is the app's concern, not the agent's.**

## API

- `GET /api/sets` — list available sets (with `completed` flag).
- `GET /api/sets/:id` — one set, **answers stripped**, `render` specs intact.
- `GET /api/capabilities` — the manifest.
- `POST /api/sessions` — start or **resume** a run; returns saved answers.
- `POST /api/sessions/:id/answer` — autosave one answer (persisted immediately; enables
  resume); increments `attempts`.
- `POST /api/sessions/:id/submit` — grade, write the result file, return the score.
- `GET /` — the static frontend.

## Frontend

Mobile-first, calm, kid-friendly. Home screen lists sets (✅ when done). Quiz screen shows
**one question per screen** with the `render` visual above the answer input, progress, an
optional hint, autosave, and resume-at-first-unanswered. Optional gentle timer if
`time_limit_minutes` is set. Done screen is positive — a simple score (and a note if any
answers are pending the teacher); it never highlights wrong answers harshly. Detailed
evaluation is the teacher agent's job, not the child's screen.

## Robustness

- Malformed or invalid sets (e.g. an unsupported question type) are skipped with a
  `[mathmallow] ...` log line, never crash the server.
- SQLite is the working state (survives restarts); `shared/results/*.json` is the durable
  artifact the agent reads. Resubmits overwrite the result file.
- Tests (`node:test`) cover grading/scoring, the answer-stripping guarantee, manifest↔registry
  sync, and a full session round-trip.
