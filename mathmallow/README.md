# Mathmallow 🍡

A tiny, kid-friendly local web app that delivers math exercise sets to one child and
records their answers. A parent runs it on a home machine; the child opens it from a
tablet/phone on the same Wi-Fi. A separate "teacher agent" (an LLM) writes the exercise
sets and reads the results — Mathmallow and the agent communicate **only** through JSON
files in shared folders, never directly.

## Quick start

```bash
cd mathmallow
npm install
npm start
```

On startup the server prints the LAN URL(s) and port, e.g.:

```
  🍡  Mathmallow is running!
      port: 4321
  Open in a browser:
      http://localhost:4321
      http://192.168.1.23:4321   (from another device on this Wi-Fi)
```

- On the parent's machine, open `http://localhost:4321`.
- On the child's tablet/phone (same Wi-Fi), open the `http://192.168.x.x:4321` URL printed
  in the console. If it doesn't load, your machine's firewall may be blocking the port —
  allow incoming connections for Node on that port.

Requires **Node 18+**.

## How the shared folders work

Mathmallow reads and writes shared folders under `shared/` at the repo root:

```
shared/exercise_sets/   INPUT  — *.json sets the teacher agent writes; Mathmallow serves them
shared/results/         OUTPUT — <set-id>.result.json that Mathmallow writes when a run is submitted
schemas/              the canonical example files (also used as test fixtures)
```

- **Add a new set:** drop a `*.json` file into `shared/exercise_sets/` (matching
  `schemas/exercise_set.example.json`). It appears on the home screen automatically — no
  restart needed. Malformed files are skipped with a log line, not a crash.
- **Read results:** after a child submits, Mathmallow writes
  `shared/results/<set-id>.result.json` (matching `schemas/result.example.json`). The teacher
  agent ingests this to grade and update the student's profile.

### Config (env vars)

| var | default | meaning |
|---|---|---|
| `PORT` | `4321` | HTTP port |
| `HOST` | `0.0.0.0` | bind address (LAN-reachable by default) |
| `EXERCISE_SETS_DIR` | `<repo-root>/shared/exercise_sets` | where sets are read from |
| `RESULTS_DIR` | `<repo-root>/shared/results` | where result files are written |

The SQLite working state lives in `mathmallow/db/mathmallow.db` (gitignored). It survives
restarts so a child can resume an in-progress quiz. The `shared/results/*.json` file is the durable
artifact for the agent; SQLite is just working state.

## 🔒 Answer safety

The correct `answer` (and `answer_tolerance`) of every question is **stripped server-side**
before any question is sent to the browser. Answers never reach the client; grading happens
on the server. This is enforced at a single chokepoint (`src/sets.js → stripAnswers`) and
covered by a raw-bytes HTTP test (`test/strip.test.js`).

## Visual questions (render widgets)

Questions can carry a declarative `render` spec (`kind`: `none` | `widget` | `image` | `svg`).
Mathmallow owns the drawing via a **client-side widget registry**
(`public/widgets/registry.js`), rendering crisp **inline SVG**. The implemented v1 catalog:

`analog-clock`, `number-line`, `fraction-bar`, `fraction-circle`, `array-dots`,
`base-ten-blocks`, `shape`, `bar-model`, `coordinate-grid`, `bar-chart`

…plus the `image` and `svg` escape hatches (the `svg` string is sanitized before insertion).
Unknown widgets fall back to the question's `alt` text.

### Capability manifest

`mathmallow/capabilities.json` advertises supported question types, render kinds, and every
widget with its params. It is also served at `GET /api/capabilities` so the teacher agent can
discover capabilities without hardcoding the list. A test
(`test/manifest.test.js`) asserts the manifest and the implemented registry never drift.

**Adding a widget** is a localized change: add one renderer to
`public/widgets/registry.js` and one entry to `capabilities.json`. The drift test keeps them
honest.

## API

| method + path | purpose |
|---|---|
| `GET /api/sets` | list available sets (newest-first) with completed flag |
| `GET /api/sets/:setId` | a set with answers stripped, render specs intact |
| `GET /api/capabilities` | the capability manifest |
| `POST /api/sessions` | start or resume a run for a set; returns `session_id` + saved answers |
| `POST /api/sessions/:id/answer` | autosave one answer `{question_id, student_answer, time_spent_seconds}` |
| `POST /api/sessions/:id/submit` | grade, write the result file, return the score |

## Tests

```bash
npm test     # runs node --test over test/*.test.js
```

Covers: grading logic (numeric/MC/TF, tolerance, leniency), the answer-stripping
guarantee (raw-bytes check over real HTTP), the manifest↔registry sync, and a full
session round-trip that asserts the written result file matches the fixture's shape and score.

## Troubleshooting

- **Child's device can't connect:** confirm both devices are on the same Wi-Fi; allow the
  Node process through the OS firewall for the printed port; try the explicit `http://192.168.x.x:PORT`.
- **A set doesn't appear:** check the server log — malformed JSON or an invalid set is skipped
  with a `[mathmallow] skipping ...` line. Validate it against `schemas/exercise_set.example.json`.
- **Reset working state:** stop the server and delete `mathmallow/db/`. Result files in
  `shared/results/` are untouched.
