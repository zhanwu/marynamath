# Subject Taxonomy (editable config)

This file is the **authoritative, editable list of subjects** Maryna tracks the student on.
It is intentionally separate from `AGENT.md`: the teaching/leveling **methodology** is stable,
but *what counts as a subject* is subjective and will evolve. **Add or remove strands here
freely** — the methodology in `AGENT.md` does not depend on the specific list, only on the
idea that each subject has a `slug` and a per-skill mastery record.

Rules for any change:
- A subject is a **strand** that runs across grades (K→5), not a single grade's topic.
- Each row needs a stable `slug` (kebab-case). The `slug` is what appears in every file
  (`shared/exercise_sets/*.json` `subject` field, `student/subject-summaries/<slug>.md`, etc.).
- Renaming a slug means renaming the matching subject-summary file too.

---

## Active subjects

Use these exact `subject` slugs in all files:

| slug                      | covers (K–5)                                                              | typical Mathmallow visuals |
|---------------------------|---------------------------------------------------------------------------|----------------------------|
| `counting`                | counting, cardinality, number sense, place value, comparing numbers       | mostly text; `number-line`, `base-ten-blocks` |
| `addition-subtraction`    | number bonds, add/subtract within 20→1000, regrouping, mental strategies   | mostly text; `number-line`, `base-ten-blocks`, `bar-model` |
| `multiplication-division` | times tables, multi-digit ×/÷, remainders                                 | mostly text; `array-dots`, `bar-model` |
| `fractions`               | fraction concepts, equivalence, +/−/×/÷ fractions, fraction↔decimal link  | **needs** `fraction-bar`, `fraction-circle`, `number-line` |
| `decimals`                | decimal place value, +/−/×/÷ decimals, rounding                           | mostly text; `number-line`, `base-ten-blocks` |
| `measurement-data`        | length/mass/volume/capacity/time/money, area & perimeter, graphs, line plots, mean | **needs** `analog-clock`, `money`, `bar-chart`, `picture-graph`, `line-plot` |
| `geometry`                | 2D/3D shapes, attributes, angles, triangles, quadrilaterals, symmetry, nets, coordinate plane | **needs** `shape`, `coordinate-grid` (+ `svg` escape hatch for complex figures) |
| `word-problems`           | multi-step reasoning, bar models, problem-solving strategy (cross-cutting) | mostly text; `bar-model` |

When the parent names a subject loosely ("fractions", "times tables"), map it to the
nearest slug above. Most strands stay `not-started` for a young student — an empty
`fractions` summary for a 7-year-old is expected, not an oversight.

**On the visuals column:** "mostly text" strands can be exercised with plain questions and need
no widget support; the **needs**-marked strands depend on Mathmallow's render widgets to be
asked properly. This column is just guidance — the authoritative list of what Mathmallow can
actually render is its capability manifest (`mathmallow/capabilities.json`), which the agent
reads before generating a visual set. If a needed widget isn't available, the agent falls back
to the `svg`/`image` escape hatch or rephrases to text (see `AGENT.md` §6.2).

---

## Candidate additions (not yet active)

Captured from a coverage check against Singapore Math (see reference below). These are
grade 4–5 strands not yet in the active list. Promote them into the table above when the
student approaches that level, or sooner if you want full coverage.

| candidate slug          | covers                                                                  |
|-------------------------|-------------------------------------------------------------------------|
| `factors-multiples`     | factors, multiples, primes, common factors/multiples (gr4 number theory) |
| `expressions-algebra`   | order of operations, expressions with parentheses, numeric/visual patterns (gr5) |
| `ratio-proportion`      | ratio, rate, percentage (gr5 proportional reasoning)                    |

---

## Reference: coverage vs Singapore Math

Benchmarked against the Dimensions Math Scope & Sequence (Singapore Math, PK–5).
The active list covers all K–4 number/measurement/geometry strands. Known gaps vs Singapore
K–5 are exactly the three candidate strands above (Singapore introduces ratio/rate/percent
in 5B — ahead of US Common Core, which places them in grade 6). Taxonomy is subjective; this
note exists so future edits start from a known baseline, not so the list must match Singapore
exactly.
