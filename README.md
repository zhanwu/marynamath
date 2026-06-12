# Maryna Math

Home math tutoring, one K–5 kid. Two parts:

- **Maryna** — LLM math teacher ([`AGENT.md`](AGENT.md)). Rates level, makes exercise sets, tracks mastery.
- **Mathmallow** 🍡 — local web app ([`mathmallow/`](mathmallow/)). Shows sets to kid in browser, records answers.

They never talk direct. Trade **JSON files** via `shared/`:

```
Maryna ──set──▶ shared/exercise_sets/ ──▶ Mathmallow ⇄ kid
Maryna ◀─result─ shared/results/      ◀──
```

## Map

| path | what |
|---|---|
| `AGENT.md` | Maryna manual |
| `SUBJECTS.md` | subject list (editable) |
| `mathmallow/` | the web app (`DESIGN.md`, `README.md`) |
| `schemas/` | JSON contract examples |
| `student/` | profile + mastery summaries |
| `shared/` | `exercise_sets/`, `results/`, `evaluations/` |

## Run

1. Profile: `cp student/profile.example.md student/profile.md`, fill in your kid.
2. App: `cd mathmallow && npm install && npm start` -> open printed LAN URL on kid's device (same Wi-Fi).
3. Maryna: load `AGENT.md` as system prompt. Ask for level or a set. Sets -> `shared/exercise_sets/` -> show up in app.

**Privacy:** this repo is a shareable template. Your student's data — profile, sets,
results, evaluations, summaries — is gitignored and never leaves your machine.
