'use strict';

/**
 * Pure auto-grading logic for Mathmallow.
 *
 * Each grader takes (question, studentAnswer) and returns true | false | null.
 * - numeric: |student - answer| <= answer_tolerance (lenient about whitespace,
 *   leading '+', and thousands commas like "1,234")
 * - multiple_choice: selected choice string === answer exactly
 * - true_false: boolean comparison
 * - interactive input widget value (object): deep-equal against structured answer, else null
 *
 * There is no free-text question type — every first-class type is auto-gradable.
 * A `null` (pending teacher grading) only arises from an ungradable structured
 * widget value or the `default` safety branch.
 */

/** Parse a numeric student answer leniently. Returns a Number or NaN. */
function parseNumeric(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  if (s === '') return NaN;
  // allow a single leading '+'
  if (s.startsWith('+')) s = s.slice(1).trim();
  // allow US thousands separators, but only in valid positions ("1,234" yes,
  // "1,2" no — that's not a thousands pattern, don't guess what it meant)
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  // Number() handles ints, decimals, and rejects trailing junk (returns NaN)
  const n = Number(s);
  return n;
}

function gradeNumeric(question, studentAnswer) {
  const student = parseNumeric(studentAnswer);
  if (Number.isNaN(student)) return false;
  const answer = Number(question.answer);
  if (Number.isNaN(answer)) return null;
  const tol = Number(question.answer_tolerance) || 0;
  return Math.abs(student - answer) <= tol;
}

function gradeMultipleChoice(question, studentAnswer) {
  if (studentAnswer === null || studentAnswer === undefined) return false;
  // answer may be the exact choice string or a 0-based index into choices.
  const ans = question.answer;
  const student = String(studentAnswer);
  if (typeof ans === 'number' && Array.isArray(question.choices)) {
    const expected = question.choices[ans];
    return student === String(expected);
  }
  return student === String(ans);
}

function gradeTrueFalse(question, studentAnswer) {
  if (studentAnswer === null || studentAnswer === undefined) return false;
  const toBool = (v) => {
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === 't' || s === 'yes') return true;
    if (s === 'false' || s === 'f' || s === 'no') return false;
    return null;
  };
  const student = toBool(studentAnswer);
  const answer = toBool(question.answer);
  if (student === null || answer === null) return false;
  return student === answer;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) {
    // tolerate "3" vs 3 inside structured values
    if ((typeof a === 'number' || typeof a === 'string') &&
        (typeof b === 'number' || typeof b === 'string')) {
      return String(a) === String(b);
    }
    return false;
  }
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!deepEqual(a[ak[i]], b[bk[i]])) return false;
  }
  return true;
}

/**
 * Grade a single question against a stored student answer.
 * studentAnswer is whatever was persisted (string for the normal types,
 * or a structured object for interactive input widgets).
 */
function gradeQuestion(question, studentAnswer) {
  // structured/interactive answer: deep-equal against structured answer
  if (studentAnswer !== null && typeof studentAnswer === 'object') {
    if (question.answer !== null && typeof question.answer === 'object') {
      return deepEqual(studentAnswer, question.answer) ? true : false;
    }
    return null; // unsure how to grade -> leave for agent
  }

  switch (question.type) {
    case 'numeric':
      return gradeNumeric(question, studentAnswer);
    case 'multiple_choice':
      return gradeMultipleChoice(question, studentAnswer);
    case 'true_false':
      return gradeTrueFalse(question, studentAnswer);
    default:
      return null;
  }
}

/**
 * Build the result `answers[]` and `score` for a set + a map of stored answers.
 * storedAnswers: { [questionId]: { student_answer, time_spent_seconds, attempts } }
 */
function gradeSet(set, storedAnswers) {
  const answers = [];
  let raw = 0;
  let max = 0;
  let pending = 0; // # of questions awaiting teacher grading (correct === null)

  for (const q of set.questions) {
    const points = Number(q.points) || 0;
    const stored = storedAnswers[q.id] || {};
    const studentAnswer =
      stored.student_answer === undefined ? null : stored.student_answer;
    const correct = gradeQuestion(q, studentAnswer);
    // Only auto-graded questions (true/false) count toward the auto-score.
    // A `null` (e.g. an ungradable structured widget value awaiting the teacher)
    // is NOT counted as wrong — it is excluded from `max` and reported as
    // `pending` until the teacher grades it.
    if (correct === null) {
      pending += 1;
    } else {
      max += points;
      if (correct === true) raw += points;
    }
    answers.push({
      id: q.id,
      student_answer: studentAnswer,
      correct,
      time_spent_seconds: Number(stored.time_spent_seconds) || 0,
      attempts: Number(stored.attempts) || 0,
    });
  }

  const percent = max > 0 ? Math.round((100 * raw) / max) : null;
  return { answers, score: { raw, max, percent, pending } };
}

module.exports = {
  parseNumeric,
  gradeNumeric,
  gradeMultipleChoice,
  gradeTrueFalse,
  gradeQuestion,
  gradeSet,
  deepEqual,
};
