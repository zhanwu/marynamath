'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { createApp } = require('../src/app');

const EXAMPLE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'exercise_set.example.json'), 'utf8')
);

function tmpEnv() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-sess-'));
  const setsDir = path.join(tmp, 'sets');
  const resultsDir = path.join(tmp, 'results');
  const dbPath = path.join(tmp, 'db', 'test.db');
  fs.mkdirSync(setsDir, { recursive: true });
  fs.writeFileSync(path.join(setsDir, 'example.json'), JSON.stringify(EXAMPLE));
  return { tmp, setsDir, resultsDir, dbPath };
}

async function boot(env, extraOpts) {
  const { app, close } = createApp(Object.assign(
    { exerciseSetsDir: env.setsDir, resultsDir: env.resultsDir, dbPath: env.dbPath },
    extraOpts || {}
  ));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (p, opts) => {
    const res = await fetch(base + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    return { status: res.status, body: await res.json() };
  };
  return { base, j, stop: () => { server.close(); close(); } };
}

const STUDENT_ANSWERS = {
  q1: '71', q2: '47', q3: '47', q4: 'true', q5: '63', q6: '3:30',
};

test('full session: start -> answer all -> submit writes correct result file', async () => {
  const env = tmpEnv();
  const srv = await boot(env);
  try {
    const start = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id }) });
    assert.strictEqual(start.status, 200);
    assert.ok(start.body.session_id);
    assert.strictEqual(start.body.resumed, false);
    const sid = start.body.session_id;

    for (const q of EXAMPLE.questions) {
      const r = await srv.j(`/api/sessions/${sid}/answer`, {
        method: 'POST',
        body: JSON.stringify({ question_id: q.id, student_answer: STUDENT_ANSWERS[q.id], time_spent_seconds: 10 }),
      });
      assert.strictEqual(r.status, 200);
    }

    const sub = await srv.j(`/api/sessions/${sid}/submit`, { method: 'POST' });
    assert.strictEqual(sub.status, 200);
    assert.deepStrictEqual(sub.body.score, { raw: 6, max: 7, percent: 86, pending: 0 });

    const resultPath = path.join(env.resultsDir, `${EXAMPLE.set_id}.result.json`);
    assert.ok(fs.existsSync(resultPath), 'result file written');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

    // shape matches the fixture
    assert.deepStrictEqual(
      Object.keys(result).sort(),
      ['answers', 'duration_seconds', 'score', 'set_id', 'started_at', 'student', 'submitted_at']
    );
    assert.strictEqual(result.set_id, EXAMPLE.set_id);
    assert.deepStrictEqual(result.score, { raw: 6, max: 7, percent: 86, pending: 0 });
    assert.strictEqual(result.answers.length, 6);

    const q6 = result.answers.find((a) => a.id === 'q6');
    assert.strictEqual(q6.correct, true, 'analog-clock MC q6 graded correct');
    const q2 = result.answers.find((a) => a.id === 'q2');
    assert.strictEqual(q2.correct, false);
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});

test('submit response + result endpoint power review mode (per-question correct, no answer key)', async () => {
  const env = tmpEnv();
  const srv = await boot(env);
  try {
    const start = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id }) });
    const sid = start.body.session_id;
    for (const q of EXAMPLE.questions) {
      await srv.j(`/api/sessions/${sid}/answer`, {
        method: 'POST',
        body: JSON.stringify({ question_id: q.id, student_answer: STUDENT_ANSWERS[q.id], time_spent_seconds: 10 }),
      });
    }
    const sub = await srv.j(`/api/sessions/${sid}/submit`, { method: 'POST' });
    // submit returns per-question correctness for the client's review screen
    assert.ok(Array.isArray(sub.body.answers), 'submit returns answers[]');
    assert.strictEqual(sub.body.answers.find((a) => a.id === 'q2').correct, false);
    assert.strictEqual(sub.body.answers.find((a) => a.id === 'q6').correct, true);

    // reopening a completed set fetches the stored result, read-only
    const got = await srv.j(`/api/sets/${EXAMPLE.set_id}/result`);
    assert.strictEqual(got.status, 200);
    assert.strictEqual(got.body.answers.length, 6);
    // result must NOT carry the answer key
    const raw = JSON.stringify(got.body);
    assert.ok(!/"answer"\s*:/.test(raw), 'result leaked an "answer" key');

    const missing = await srv.j('/api/sets/nope/result');
    assert.strictEqual(missing.status, 404);
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});

test('resume returns saved answers for an in-progress session', async () => {
  const env = tmpEnv();
  const srv = await boot(env);
  try {
    const start = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id }) });
    const sid = start.body.session_id;
    await srv.j(`/api/sessions/${sid}/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_id: 'q1', student_answer: '71', time_spent_seconds: 5 }),
    });
    // a second POST /sessions for the same set should resume, not create new
    const resume = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id }) });
    assert.strictEqual(resume.body.session_id, sid);
    assert.strictEqual(resume.body.resumed, true);
    assert.strictEqual(resume.body.answers.q1.student_answer, '71');
    assert.strictEqual(resume.body.answers.q1.attempts, 1);
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});

test('attempts counts answer changes, not visits (issue 004)', async () => {
  const env = tmpEnv();
  const srv = await boot(env);
  try {
    const start = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id }) });
    const sid = start.body.session_id;
    const post = (student_answer, time_spent_seconds) =>
      srv.j(`/api/sessions/${sid}/answer`, { method: 'POST', body: JSON.stringify({ question_id: 'q1', student_answer, time_spent_seconds }) });

    const a1 = await post('70', 5);
    assert.strictEqual(a1.body.attempts, 1, 'first save = attempt 1');

    // kid pages Back/Next past the question — same value re-saved, no real change
    const a2 = await post('70', 9);
    assert.strictEqual(a2.body.attempts, 1, 're-saving the same value must NOT bump attempts');

    // kid actually changes the answer
    const a3 = await post('71', 14);
    assert.strictEqual(a3.body.attempts, 2, 'changed value bumps attempts');

    // time still accumulates across all saves
    const resume = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id }) });
    assert.strictEqual(resume.body.answers.q1.time_spent_seconds, 14);
    assert.strictEqual(resume.body.answers.q1.attempts, 2);
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});

test('GET /api/sets lists sets and flags completed; malformed files skipped', async () => {
  const env = tmpEnv();
  // add a malformed file
  fs.writeFileSync(path.join(env.setsDir, 'broken.json'), '{ not valid json ');
  const srv = await boot(env);
  try {
    const list = await srv.j('/api/sets');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.sets.length, 1, 'malformed file skipped, one good set listed');
    assert.strictEqual(list.body.sets[0].set_id, EXAMPLE.set_id);
    assert.strictEqual(list.body.sets[0].completed, false);
    assert.strictEqual(list.body.sets[0].question_count, 6);
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});

// ---- Issue 003: one active session per set; no silent clobber -------------

test('second browser gets 409 while another client is actively working a set', async () => {
  const env = tmpEnv();
  const srv = await boot(env);
  try {
    const a = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id, client_id: 'browser-A' }) });
    assert.strictEqual(a.status, 200);

    // browser B tries the same set while A's session is active
    const b = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id, client_id: 'browser-B' }) });
    assert.strictEqual(b.status, 409);
    assert.strictEqual(b.body.wip, true);

    // B also cannot write answers into A's session
    const w = await srv.j(`/api/sessions/${a.body.session_id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_id: 'q1', student_answer: '99', time_spent_seconds: 1, client_id: 'browser-B' }),
    });
    assert.strictEqual(w.status, 409);

    // A itself resumes fine
    const a2 = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id, client_id: 'browser-A' }) });
    assert.strictEqual(a2.status, 200);
    assert.strictEqual(a2.body.resumed, true);

    // and the home list flags the set as wip
    const list = await srv.j('/api/sets');
    assert.strictEqual(list.body.sets[0].wip, true);
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});

test('stale session can be taken over; ousted client then gets 409 (no clobber)', async () => {
  const env = tmpEnv();
  const srv = await boot(env, { staleMs: 50 }); // everything goes stale almost immediately
  try {
    const a = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id, client_id: 'browser-A' }) });
    const sid = a.body.session_id;
    await srv.j(`/api/sessions/${sid}/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_id: 'q1', student_answer: '71', time_spent_seconds: 5, client_id: 'browser-A' }),
    });

    await new Promise((r) => setTimeout(r, 80)); // let the session go stale

    // B takes over the same session (saved answers come along)
    const b = await srv.j('/api/sessions', { method: 'POST', body: JSON.stringify({ set_id: EXAMPLE.set_id, client_id: 'browser-B' }) });
    assert.strictEqual(b.status, 200);
    assert.strictEqual(b.body.session_id, sid, 'same session, not a new one');
    assert.strictEqual(b.body.took_over, true);
    assert.strictEqual(b.body.answers.q1.student_answer, '71');

    // A is ousted: its next save and submit are rejected
    const w = await srv.j(`/api/sessions/${sid}/answer`, {
      method: 'POST',
      body: JSON.stringify({ question_id: 'q2', student_answer: '37', time_spent_seconds: 5, client_id: 'browser-A' }),
    });
    assert.strictEqual(w.status, 409);
    const s = await srv.j(`/api/sessions/${sid}/submit`, { method: 'POST', body: JSON.stringify({ client_id: 'browser-A' }) });
    assert.strictEqual(s.status, 409);
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});

test('GET /api/capabilities serves the manifest', async () => {
  const env = tmpEnv();
  const srv = await boot(env);
  try {
    const cap = await srv.j('/api/capabilities');
    assert.strictEqual(cap.status, 200);
    assert.strictEqual(cap.body.schema_version, '1.0');
    assert.ok(cap.body.widgets.some((w) => w.name === 'analog-clock'));
  } finally {
    srv.stop();
    fs.rmSync(env.tmp, { recursive: true, force: true });
  }
});
