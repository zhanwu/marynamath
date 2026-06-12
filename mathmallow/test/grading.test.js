'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { gradeQuestion, gradeSet, parseNumeric } = require('../src/grading');
const { validateSet } = require('../src/sets');

const EXAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'exercise_set.example.json'), 'utf8')
);
const EXPECTED_RESULT = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'result.example.json'), 'utf8')
);

function q(id) { return EXAMPLE.questions.find((x) => x.id === id); }

test('numeric grading: exact match', () => {
  assert.strictEqual(gradeQuestion(q('q1'), '71'), true);
});

test('numeric grading: lenient whitespace and leading +', () => {
  assert.strictEqual(gradeQuestion(q('q1'), '  +71 '), true);
});

test('numeric grading: wrong number', () => {
  assert.strictEqual(gradeQuestion(q('q2'), '47'), false);
});

test('numeric grading: non-numeric input is false', () => {
  assert.strictEqual(gradeQuestion(q('q1'), 'seventy one'), false);
});

test('numeric grading honors tolerance', () => {
  const tq = { type: 'numeric', answer: 3.14, answer_tolerance: 0.01 };
  assert.strictEqual(gradeQuestion(tq, '3.145'), true);
  assert.strictEqual(gradeQuestion(tq, '3.2'), false);
});

test('parseNumeric rejects trailing junk', () => {
  assert.ok(Number.isNaN(parseNumeric('71abc')));
  assert.strictEqual(parseNumeric('  +12 '), 12);
});

test('numeric grading accepts thousands commas (valid positions only)', () => {
  const tq = { type: 'numeric', answer: 1234, answer_tolerance: 0 };
  assert.strictEqual(gradeQuestion(tq, '1,234'), true);
  assert.strictEqual(parseNumeric('12,345,678'), 12345678);
  assert.strictEqual(parseNumeric('-1,234.5'), -1234.5);
  // misplaced commas are NOT silently fixed up — don't guess what "1,2" meant
  assert.ok(Number.isNaN(parseNumeric('1,2')));
  assert.ok(Number.isNaN(parseNumeric('12,34')));
});

test('multiple_choice grading by exact string', () => {
  assert.strictEqual(gradeQuestion(q('q3'), '47'), true);
  assert.strictEqual(gradeQuestion(q('q3'), '63'), false);
});

test('multiple_choice grading by index answer', () => {
  const mq = { type: 'multiple_choice', choices: ['a', 'b', 'c'], answer: 1 };
  assert.strictEqual(gradeQuestion(mq, 'b'), true);
  assert.strictEqual(gradeQuestion(mq, 'a'), false);
});

test('true_false grading', () => {
  assert.strictEqual(gradeQuestion(q('q4'), 'true'), true);
  assert.strictEqual(gradeQuestion(q('q4'), 'false'), false);
});

test('analog-clock MC question (q6=3:30) grades correct', () => {
  assert.strictEqual(gradeQuestion(q('q6'), '3:30'), true);
  assert.strictEqual(gradeQuestion(q('q6'), '9:30'), false);
});

test('gradeSet produces expected score raw=6 max=7 percent=86 pending=0', () => {
  // student answers mirroring schemas/result.example.json (q2 wrong)
  const stored = {
    q1: { student_answer: '71', time_spent_seconds: 22, attempts: 1 },
    q2: { student_answer: '47', time_spent_seconds: 65, attempts: 2 },
    q3: { student_answer: '47', time_spent_seconds: 18, attempts: 1 },
    q4: { student_answer: 'true', time_spent_seconds: 9, attempts: 1 },
    q5: { student_answer: '63', time_spent_seconds: 88, attempts: 1 },
    q6: { student_answer: '3:30', time_spent_seconds: 27, attempts: 1 },
  };
  const { answers, score } = gradeSet(EXAMPLE, stored);
  // q5 worth 2pts (correct). All 6 are auto-gradable; q2 wrong.
  // raw = 1+0+1+1+2+1 = 6 ; max = 1+1+1+1+2+1 = 7 ; pending = 0.
  assert.deepStrictEqual(score, { raw: 6, max: 7, percent: 86, pending: 0 });

  // shape: each answer matches the result fixture's per-answer fields
  for (const expected of EXPECTED_RESULT.answers) {
    const got = answers.find((a) => a.id === expected.id);
    assert.ok(got, `missing answer ${expected.id}`);
    assert.strictEqual(got.correct, expected.correct, `correct mismatch for ${expected.id}`);
    assert.deepStrictEqual(
      Object.keys(got).sort(),
      ['attempts', 'correct', 'id', 'student_answer', 'time_spent_seconds'],
      'answer object has exactly the contract fields'
    );
  }
});

test('a set containing a legacy "text" question is rejected (not served)', () => {
  // The free-text type has been removed from the contract. A set carrying one
  // must be skipped/rejected rather than served — same graceful-skip philosophy
  // as malformed JSON.
  const legacy = {
    set_id: 'legacy-with-text',
    questions: [
      { id: 'q1', type: 'numeric', answer: 1 },
      { id: 'q2', type: 'text', prompt: 'Explain how you would add 38+38' },
    ],
  };
  const v = validateSet(legacy);
  assert.strictEqual(v.ok, false, 'set with a text question must be rejected');
  assert.match(v.error, /invalid type text/);
});

test('a set with the <STUDENT> placeholder is rejected (issue 005)', () => {
  // `student` is baked into every long-term record (set + result). The AGENT.md
  // template placeholder must never ship; rejecting here means the set won't
  // appear in the app and the agent learns immediately.
  const v = validateSet({
    set_id: 'placeholder-set',
    student: '<STUDENT>',
    questions: [{ id: 'q1', type: 'numeric', answer: 1 }],
  });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /<STUDENT>/);
});

test('ungradable structured widget value is pending: excluded from max, not wrong', () => {
  // A `null` correct can still arise from a structured interactive-input widget
  // value the server cannot auto-grade (no structured answer to compare against).
  const widgetQ = { id: 'qw', type: 'multiple_choice', points: 1, answer: '3:30' };
  const stored = { qw: { student_answer: { hour: 3, minute: 30 }, time_spent_seconds: 1, attempts: 1 } };
  const onlyWidget = { questions: [widgetQ] };
  const { answers, score } = gradeSet(onlyWidget, stored);
  assert.strictEqual(answers[0].correct, null, 'structured value with no structured answer -> null');
  assert.strictEqual(score.raw, 0);
  assert.strictEqual(score.max, 0);
  assert.strictEqual(score.pending, 1);
  assert.strictEqual(score.percent, null); // no auto-graded questions yet
});
