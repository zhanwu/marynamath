'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { stripAnswers } = require('../src/sets');
const { createApp } = require('../src/app');

const EXAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'exercise_set.example.json'), 'utf8')
);

test('stripAnswers removes answer and answer_tolerance, keeps render', () => {
  const clean = stripAnswers(EXAMPLE);
  for (const q of clean.questions) {
    assert.ok(!('answer' in q), `q ${q.id} still has answer`);
    assert.ok(!('answer_tolerance' in q), `q ${q.id} still has answer_tolerance`);
  }
  // render spec preserved on q6 (the analog-clock)
  const q6 = clean.questions.find((q) => q.id === 'q6');
  assert.strictEqual(q6.render.kind, 'widget');
  assert.strictEqual(q6.render.widget, 'analog-clock');
  assert.deepStrictEqual(q6.render.params, { hour: 3, minute: 30 });
});

// Full HTTP round-trip: prove no answer/answer_tolerance bytes reach the client.
test('GET /api/sets/:id response contains no answer fields (raw bytes check)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-strip-'));
  const setsDir = path.join(tmp, 'sets');
  const resultsDir = path.join(tmp, 'results');
  const dbPath = path.join(tmp, 'db', 'test.db');
  fs.mkdirSync(setsDir, { recursive: true });
  fs.writeFileSync(path.join(setsDir, 'example.json'), JSON.stringify(EXAMPLE));

  const { app, close } = createApp({ exerciseSetsDir: setsDir, resultsDir, dbPath });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sets/${EXAMPLE.set_id}`);
    const raw = await res.text();
    // raw-byte assertions: the literal keys must not appear at all
    assert.ok(!/"answer"\s*:/.test(raw), 'response leaked an "answer" key');
    assert.ok(!/"answer_tolerance"\s*:/.test(raw), 'response leaked "answer_tolerance"');
    // and the known answer value "71" must not be served as a JSON answer
    const body = JSON.parse(raw);
    for (const q of body.questions) {
      assert.ok(!('answer' in q));
      assert.ok(!('answer_tolerance' in q));
    }
    // render spec intact
    const q6 = body.questions.find((q) => q.id === 'q6');
    assert.strictEqual(q6.render.widget, 'analog-clock');
  } finally {
    server.close();
    close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
