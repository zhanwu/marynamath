'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const { openDb } = require('./db');
const { loadAllSets, loadSetById, stripAnswers } = require('./sets');
const { gradeSet } = require('./grading');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const APP_ROOT = path.resolve(__dirname, '..');

function resolveDirs(opts = {}) {
  const exerciseSetsDir =
    opts.exerciseSetsDir ||
    process.env.EXERCISE_SETS_DIR ||
    path.join(REPO_ROOT, 'shared', 'exercise_sets');
  const resultsDir =
    opts.resultsDir ||
    process.env.RESULTS_DIR ||
    path.join(REPO_ROOT, 'shared', 'results');
  const dbPath = opts.dbPath || path.join(APP_ROOT, 'db', 'mathmallow.db');
  return { exerciseSetsDir, resultsDir, dbPath };
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build the Express app. Returns { app, db, dirs, close }.
 * Does NOT listen — server.js (or a test) calls app.listen().
 */
// A session with no activity for this long is "stale": another browser may
// take it over (issue 003). Activity = session start/claim + every answer save.
const DEFAULT_STALE_MS = 5 * 60 * 1000;

function createApp(opts = {}) {
  const dirs = resolveDirs(opts);
  const staleMs =
    opts.staleMs ||
    (Number(process.env.SESSION_STALE_MINUTES) || 0) * 60 * 1000 ||
    DEFAULT_STALE_MS;
  fs.mkdirSync(dirs.resultsDir, { recursive: true });

  const db = openDb(dirs.dbPath);
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Read capability manifest from disk once.
  const capabilitiesPath = path.join(APP_ROOT, 'capabilities.json');
  const readCapabilities = () =>
    JSON.parse(fs.readFileSync(capabilitiesPath, 'utf8'));

  // ---- Prepared statements --------------------------------------------------
  const stmt = {
    insertSession: db.prepare(
      `INSERT INTO sessions (set_id, student, started_at, created_ms, client_id, last_activity_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ),
    openSessionForSet: db.prepare(
      `SELECT * FROM sessions WHERE set_id = ? AND submitted_at IS NULL
       ORDER BY created_ms DESC LIMIT 1`
    ),
    sessionById: db.prepare(`SELECT * FROM sessions WHERE id = ?`),
    answersForSession: db.prepare(
      `SELECT * FROM answers WHERE session_id = ?`
    ),
    upsertAnswer: db.prepare(
      // attempts counts ANSWER CHANGES, not visits (issue 004): re-saving the same
      // value (e.g. paging Back/Next past an answered question) must not bump it,
      // or "many attempts = shaky mastery" becomes navigation noise for the agent.
      // Time still accumulates on every save. `IS NOT` is NULL-safe.
      `INSERT INTO answers (session_id, question_id, student_answer, time_spent_seconds, attempts, updated_ms)
       VALUES (@session_id, @question_id, @student_answer, @time_spent_seconds, 1, @updated_ms)
       ON CONFLICT(session_id, question_id) DO UPDATE SET
         attempts = answers.attempts +
           (CASE WHEN excluded.student_answer IS NOT answers.student_answer THEN 1 ELSE 0 END),
         student_answer = excluded.student_answer,
         time_spent_seconds = excluded.time_spent_seconds,
         updated_ms = excluded.updated_ms`
    ),
    markSubmitted: db.prepare(
      `UPDATE sessions SET submitted_at = ? WHERE id = ?`
    ),
    claimSession: db.prepare(
      `UPDATE sessions SET client_id = ?, last_activity_ms = ? WHERE id = ?`
    ),
    touchSession: db.prepare(
      `UPDATE sessions SET last_activity_ms = ? WHERE id = ?`
    ),
  };

  // ---- Session ownership (issue 003) ----------------------------------------
  // A browser identifies itself with a client_id. The open session for a set is
  // owned by one client; another client may only take it over once it is stale.
  const isActive = (session) =>
    Date.now() - (session.last_activity_ms || 0) < staleMs;
  // Legacy sessions (client_id null, pre-003 rows) are claimable by anyone.
  const ownedBy = (session, clientId) =>
    session.client_id == null || session.client_id === clientId;
  /** 409s the response and returns true if `clientId` does not own `session`. */
  function rejectForeign(res, session, clientId) {
    if (ownedBy(session, clientId)) return false;
    res.status(409).json({
      error: 'this set is being worked on from another device',
      taken_over: true,
    });
    return true;
  }

  function decodeAnswer(rawJson) {
    if (rawJson === null || rawJson === undefined) return null;
    try {
      return JSON.parse(rawJson);
    } catch {
      return rawJson;
    }
  }

  function storedAnswerMap(sessionId) {
    const rows = stmt.answersForSession.all(sessionId);
    const map = {};
    for (const r of rows) {
      map[r.question_id] = {
        student_answer: decodeAnswer(r.student_answer),
        time_spent_seconds: r.time_spent_seconds,
        attempts: r.attempts,
      };
    }
    return map;
  }

  // ---- Endpoints ------------------------------------------------------------

  // GET /api/capabilities
  app.get('/api/capabilities', (req, res) => {
    try {
      res.json(readCapabilities());
    } catch (err) {
      res.status(500).json({ error: `cannot read capabilities: ${err.message}` });
    }
  });

  // GET /api/sets — list available sets, newest-first.
  app.get('/api/sets', (req, res) => {
    const sets = loadAllSets(dirs.exerciseSetsDir);
    const list = sets
      .map((s) => {
        const resultPath = path.join(dirs.resultsDir, `${s.set_id}.result.json`);
        const open = stmt.openSessionForSet.get(s.set_id);
        return {
          set_id: s.set_id,
          title: s.title || s.set_id,
          subject: s.subject || null,
          question_count: Array.isArray(s.questions) ? s.questions.length : 0,
          completed: fs.existsSync(resultPath),
          wip: Boolean(open && isActive(open)), // someone is working it right now
          created_at: s.created_at || null,
          __mtimeMs: s.__mtimeMs || 0,
        };
      })
      .sort((a, b) => {
        // newest-first: prefer created_at, fall back to file mtime
        const ca = a.created_at || '';
        const cb = b.created_at || '';
        if (ca !== cb) return cb.localeCompare(ca);
        return b.__mtimeMs - a.__mtimeMs;
      })
      .map(({ __mtimeMs, ...rest }) => rest);
    res.json({ sets: list });
  });

  // GET /api/sets/:setId — set with answers stripped, render specs intact.
  app.get('/api/sets/:setId', (req, res) => {
    const set = loadSetById(dirs.exerciseSetsDir, req.params.setId);
    if (!set) return res.status(404).json({ error: 'set not found' });
    const clean = stripAnswers(set);
    delete clean.__file;
    delete clean.__mtimeMs;
    res.json(clean);
  });

  // POST /api/sessions — start or resume a session for a set.
  // Ownership (issue 003): an active session belongs to one client_id; a second
  // browser gets 409 until the session is stale, then may take it over.
  app.post('/api/sessions', (req, res) => {
    const setId = req.body && req.body.set_id;
    const clientId = (req.body && req.body.client_id) || null;
    if (!setId) return res.status(400).json({ error: 'set_id required' });
    const set = loadSetById(dirs.exerciseSetsDir, setId);
    if (!set) return res.status(404).json({ error: 'set not found' });

    let session = stmt.openSessionForSet.get(setId);
    let resumed = false;
    let tookOver = false;
    if (session) {
      if (!ownedBy(session, clientId)) {
        if (isActive(session)) {
          return res.status(409).json({
            error: 'this set is being worked on from another device right now',
            wip: true,
          });
        }
        tookOver = true; // stale -> reclaim; old browser will 409 on its next save
      }
      stmt.claimSession.run(clientId, Date.now(), session.id);
      session = stmt.sessionById.get(session.id);
      resumed = true;
    } else {
      const startedAt = nowIso();
      const info = stmt.insertSession.run(
        setId,
        set.student || null,
        startedAt,
        Date.now(),
        clientId,
        Date.now()
      );
      session = stmt.sessionById.get(info.lastInsertRowid);
    }

    const answers = storedAnswerMap(session.id);
    res.json({
      session_id: session.id,
      set_id: setId,
      started_at: session.started_at,
      resumed,
      took_over: tookOver,
      answers, // map of question_id -> { student_answer, time_spent_seconds, attempts }
    });
  });

  // POST /api/sessions/:id/answer — save one answer (autosave).
  app.post('/api/sessions/:id/answer', (req, res) => {
    const sessionId = Number(req.params.id);
    const session = stmt.sessionById.get(sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.submitted_at)
      return res.status(409).json({ error: 'session already submitted' });
    if (rejectForeign(res, session, (req.body && req.body.client_id) || null)) return;

    const { question_id, student_answer, time_spent_seconds } = req.body || {};
    if (!question_id) return res.status(400).json({ error: 'question_id required' });

    stmt.touchSession.run(Date.now(), sessionId);
    stmt.upsertAnswer.run({
      session_id: sessionId,
      question_id,
      student_answer:
        student_answer === undefined ? null : JSON.stringify(student_answer),
      time_spent_seconds: Math.max(0, Math.round(Number(time_spent_seconds) || 0)),
      updated_ms: Date.now(),
    });

    const row = stmt.answersForSession.all(sessionId).find((r) => r.question_id === question_id);
    res.json({ ok: true, attempts: row ? row.attempts : 1 });
  });

  // POST /api/sessions/:id/submit — finalize, grade, write result file.
  app.post('/api/sessions/:id/submit', (req, res) => {
    const sessionId = Number(req.params.id);
    const session = stmt.sessionById.get(sessionId);
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (rejectForeign(res, session, (req.body && req.body.client_id) || null)) return;

    const set = loadSetById(dirs.exerciseSetsDir, session.set_id);
    if (!set) return res.status(404).json({ error: 'set not found for session' });

    const stored = storedAnswerMap(sessionId);
    const { answers, score } = gradeSet(set, stored);

    const submittedAt = nowIso();
    const startedMs = Date.parse(session.started_at);
    const submittedMs = Date.parse(submittedAt);
    const durationSeconds = Number.isFinite(startedMs)
      ? Math.max(0, Math.round((submittedMs - startedMs) / 1000))
      : 0;

    const result = {
      set_id: set.set_id,
      student: set.student || session.student || null,
      started_at: session.started_at,
      submitted_at: submittedAt,
      duration_seconds: durationSeconds,
      answers,
      score,
    };

    const resultPath = path.join(dirs.resultsDir, `${set.set_id}.result.json`);
    const existed = fs.existsSync(resultPath);
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
    if (existed) {
      console.log(`[mathmallow] overwrote existing result ${resultPath} with latest run`);
    } else {
      console.log(`[mathmallow] wrote result ${resultPath}`);
    }

    if (!session.submitted_at) {
      stmt.markSubmitted.run(submittedAt, sessionId);
    }

    // `answers` carries per-question `correct` so the client can show review mode.
    // (No answer key here — only the student's answer + correctness.)
    res.json({ ok: true, score, answers, result_file: `${set.set_id}.result.json` });
  });

  // GET /api/sets/:setId/result — the stored result (for reopening a completed set
  // in read-only review mode). Contains student answers + per-question correctness,
  // never the answer key.
  app.get('/api/sets/:setId/result', (req, res) => {
    const p = path.join(dirs.resultsDir, `${req.params.setId}.result.json`);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'no result yet' });
    try {
      res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
    } catch (err) {
      res.status(500).json({ error: `cannot read result: ${err.message}` });
    }
  });

  // ---- Static frontend ------------------------------------------------------
  app.use(express.static(path.join(APP_ROOT, 'public')));

  function close() {
    try { db.close(); } catch { /* ignore */ }
  }

  return { app, db, dirs, close };
}

module.exports = { createApp, resolveDirs, REPO_ROOT, APP_ROOT };
