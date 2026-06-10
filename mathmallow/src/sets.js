'use strict';

const fs = require('fs');
const path = require('path');

const VALID_TYPES = new Set(['numeric', 'multiple_choice', 'true_false']);

/**
 * Validate the shape of a parsed exercise set. Returns { ok, error }.
 * We are lenient (single-family tool) but reject anything that would crash
 * the grader or the client.
 */
function validateSet(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not an object' };
  if (typeof obj.set_id !== 'string' || obj.set_id.trim() === '')
    return { ok: false, error: 'missing set_id' };
  if (!Array.isArray(obj.questions))
    return { ok: false, error: 'questions is not an array' };
  if (obj.questions.length === 0)
    return { ok: false, error: 'questions is empty' };
  const seen = new Set();
  for (const q of obj.questions) {
    if (!q || typeof q !== 'object') return { ok: false, error: 'a question is not an object' };
    if (typeof q.id !== 'string' || q.id.trim() === '')
      return { ok: false, error: 'a question is missing id' };
    if (seen.has(q.id)) return { ok: false, error: `duplicate question id ${q.id}` };
    seen.add(q.id);
    if (!VALID_TYPES.has(q.type))
      return { ok: false, error: `question ${q.id} has invalid type ${q.type}` };
    if (q.type === 'multiple_choice' && !Array.isArray(q.choices))
      return { ok: false, error: `question ${q.id} (multiple_choice) needs choices[]` };
  }
  return { ok: true };
}

/**
 * Return a deep copy of the set with the `answer` and `answer_tolerance`
 * fields removed from every question. The `render` spec is kept intact.
 * 🔒 This is the single chokepoint that guarantees answers never reach the browser.
 */
function stripAnswers(set) {
  const copy = JSON.parse(JSON.stringify(set));
  if (Array.isArray(copy.questions)) {
    for (const q of copy.questions) {
      delete q.answer;
      delete q.answer_tolerance;
    }
  }
  return copy;
}

/**
 * Load all valid sets from a directory. Malformed files are skipped with a
 * console.warn line rather than crashing. Returns an array of full sets
 * (answers still present — caller strips before serving).
 */
function loadAllSets(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    console.warn(`[mathmallow] could not read EXERCISE_SETS_DIR ${dir}: ${err.message}`);
    return [];
  }
  const sets = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    const full = path.join(dir, name);
    let raw;
    try {
      raw = fs.readFileSync(full, 'utf8');
    } catch (err) {
      console.warn(`[mathmallow] skipping ${name}: cannot read (${err.message})`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`[mathmallow] skipping ${name}: invalid JSON (${err.message})`);
      continue;
    }
    const v = validateSet(parsed);
    if (!v.ok) {
      console.warn(`[mathmallow] skipping ${name}: invalid set (${v.error})`);
      continue;
    }
    parsed.__file = full;
    parsed.__mtimeMs = (() => {
      try { return fs.statSync(full).mtimeMs; } catch { return 0; }
    })();
    sets.push(parsed);
  }
  return sets;
}

/** Load a single set by set_id from a directory (full set, answers present). */
function loadSetById(dir, setId) {
  const all = loadAllSets(dir);
  return all.find((s) => s.set_id === setId) || null;
}

module.exports = { validateSet, stripAnswers, loadAllSets, loadSetById, VALID_TYPES };
