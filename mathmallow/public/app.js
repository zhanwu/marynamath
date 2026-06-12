/* Mathmallow frontend controller. Plain vanilla JS, no framework. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const screens = {
    home: $('screen-home'),
    quiz: $('screen-quiz'),
    done: $('screen-done'),
  };
  function show(name) {
    for (const k in screens) screens[k].hidden = k !== name;
    window.scrollTo(0, 0);
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // Stable per-browser identity so the server can tell two devices apart
  // (issue 003: one active session per set; a second browser must not clobber it).
  function clientId() {
    try {
      let id = localStorage.getItem('mm-client-id');
      if (!id) {
        id = 'c-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('mm-client-id', id);
      }
      return id;
    } catch {
      // localStorage unavailable -> per-page-load identity (still better than none)
      if (!window.__mmClientId) window.__mmClientId = 'c-' + Math.random().toString(36).slice(2, 10);
      return window.__mmClientId;
    }
  }

  // The session here was taken over by another device -> stop editing, go home.
  function handleTakenOver() {
    if (state && state.timerInt) clearInterval(state.timerInt);
    alert('This set is being worked on from another device, so this screen is closing. 🍡');
    loadHome();
  }

  // ---- State ----
  // { set, sessionId, mode:'quiz'|'review', answers:{qid:{value,time,attempts}},
  //   correctById:{qid:true|false|null}, idx, qStartTs, timerInt, deadline, score }
  let state = null;

  // ---- Home ----
  async function loadHome() {
    show('home');
    const list = $('set-list');
    list.innerHTML = '';
    let data;
    try {
      data = await api('/api/sets');
    } catch (e) {
      list.innerHTML = `<p class="mm-muted">Could not load sets: ${e.message}</p>`;
      return;
    }
    const sets = data.sets || [];
    $('home-empty').hidden = sets.length > 0;
    for (const s of sets) {
      const btn = document.createElement('button');
      btn.className = 'mm-set-card';
      const badge = s.completed ? '<span class="mm-set-done">✅</span>' : (s.wip ? '<span class="mm-set-done">⏳</span>' : '');
      const subNote = s.completed ? ' · done — tap to review' : (s.wip ? ' · in progress' : '');
      btn.innerHTML =
        `<div class="mm-set-title">${escapeHtml(s.title)} ${badge}</div>` +
        `<div class="mm-set-sub">${escapeHtml(s.subject || '')} · ${s.question_count} question${s.question_count === 1 ? '' : 's'}${subNote}</div>`;
      // Completed set -> read-only review, not a new editable run.
      btn.onclick = s.completed ? () => openReview(s.set_id) : () => startSet(s.set_id);
      list.appendChild(btn);
    }
  }

  // ---- Start / resume (editable quiz) ----
  async function startSet(setId) {
    const set = await api('/api/sets/' + encodeURIComponent(setId));
    let session;
    try {
      session = await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ set_id: setId, client_id: clientId() }),
      });
    } catch (e) {
      if (e.status === 409) {
        alert('Someone is doing this set on another device right now. 🍡 Try again in a few minutes!');
        return;
      }
      throw e;
    }
    const answers = {};
    for (const qid in (session.answers || {})) {
      const a = session.answers[qid];
      answers[qid] = { value: a.student_answer, time: a.time_spent_seconds || 0, attempts: a.attempts || 0 };
    }
    state = {
      set,
      sessionId: session.session_id,
      mode: 'quiz',
      answers,
      correctById: {},
      idx: 0,
      qStartTs: Date.now(),
      timerInt: null,
      deadline: null,
    };
    // resume at first unanswered question
    const firstUnanswered = set.questions.findIndex((q) => !(q.id in answers) || answers[q.id].value == null || answers[q.id].value === '');
    state.idx = firstUnanswered === -1 ? 0 : firstUnanswered;

    if (set.time_limit_minutes) {
      state.deadline = Date.now() + set.time_limit_minutes * 60 * 1000;
      startTimer();
    } else {
      $('timer').hidden = true;
    }
    show('quiz');
    renderQuestion();
  }

  // ---- Review (read-only) ----
  async function openReview(setId) {
    let set, result;
    try {
      set = await api('/api/sets/' + encodeURIComponent(setId));
      result = await api('/api/sets/' + encodeURIComponent(setId) + '/result');
    } catch (e) {
      // no result -> fall back to a normal run
      return startSet(setId);
    }
    enterReview(set, result.answers || [], result.score || {});
  }

  function enterReview(set, answerRows, score) {
    const answers = {};
    const correctById = {};
    for (const a of answerRows) {
      answers[a.id] = { value: a.student_answer };
      correctById[a.id] = a.correct;
    }
    state = {
      set,
      sessionId: null,
      mode: 'review',
      answers,
      correctById,
      idx: 0,
      timerInt: null,
      score,
    };
    $('timer').hidden = true;
    show('quiz');
    renderQuestion();
  }

  function startTimer() {
    const el = $('timer');
    el.hidden = false;
    const tick = () => {
      const left = Math.max(0, Math.round((state.deadline - Date.now()) / 1000));
      const m = Math.floor(left / 60), s = left % 60;
      el.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
      el.classList.toggle('mm-low', left <= 30);
      if (left <= 0) {
        clearInterval(state.timerInt);
        submit();
      }
    };
    tick();
    state.timerInt = setInterval(tick, 1000);
  }

  // ---- Render one question ----
  function currentQ() { return state.set.questions[state.idx]; }

  function renderQuestion() {
    const q = currentQ();
    const isReview = state.mode === 'review';
    const total = state.set.questions.length;
    $('progress').textContent = `${isReview ? 'Review · ' : ''}Question ${state.idx + 1} of ${total}`;
    $('q-prompt').textContent = q.prompt || '';

    // visual
    const vslot = $('q-visual');
    vslot.innerHTML = '';
    vslot.appendChild(window.renderRender(q.render));

    // input (editable) or read-only display + verdict (review)
    const islot = $('q-input');
    islot.innerHTML = '';
    const saved = state.answers[q.id] ? state.answers[q.id].value : null;
    const verdict = $('q-verdict');
    if (isReview) {
      buildReview(islot, q, saved);
      renderVerdict(verdict, state.correctById[q.id]);
    } else {
      verdict.hidden = true;
      buildInput(islot, q, saved);
    }

    // hint (quiz only)
    const hintBtn = $('btn-hint');
    const hintText = $('hint-text');
    hintText.hidden = true;
    if (!isReview && q.hint) {
      hintBtn.hidden = false;
      hintBtn.onclick = () => {
        hintText.textContent = q.hint;
        hintText.hidden = false;
      };
    } else {
      hintBtn.hidden = true;
    }

    // nav
    const isLast = state.idx === total - 1;
    $('btn-back').disabled = state.idx === 0;
    $('btn-next').hidden = isLast;
    const submitBtn = $('btn-submit');
    if (isReview) {
      // last review screen -> a friendly way back; no submit.
      submitBtn.hidden = !isLast;
      submitBtn.textContent = 'Back to sets';
      submitBtn.className = 'mm-btn mm-btn-primary';
    } else {
      submitBtn.hidden = !isLast;
      submitBtn.textContent = "I'm done! 🎉";
      submitBtn.className = 'mm-btn mm-btn-go';
    }

    state.qStartTs = Date.now();
  }

  function buildInput(slot, q, saved) {
    if (q.type === 'numeric') {
      const inp = document.createElement('input');
      inp.className = 'mm-num-input';
      inp.type = 'text';
      inp.inputMode = 'numeric';
      inp.setAttribute('inputmode', 'numeric');
      inp.placeholder = '?';
      if (saved != null) inp.value = saved;
      slot.appendChild(inp);
      slot._getValue = () => inp.value.trim();
      // Auto-focus so the keyboard is ready. Called synchronously inside the
      // Next/Back tap (a user gesture) so iOS Safari/Chrome will raise the keyboard.
      inp.focus();
    } else if (q.type === 'multiple_choice') {
      const wrap = document.createElement('div');
      wrap.className = 'mm-choices';
      let selected = saved;
      (q.choices || []).forEach((c) => {
        const b = document.createElement('button');
        b.className = 'mm-choice' + (String(c) === String(saved) ? ' mm-selected' : '');
        b.textContent = c;
        b.onclick = () => {
          selected = c;
          Array.from(wrap.children).forEach((ch) => ch.classList.remove('mm-selected'));
          b.classList.add('mm-selected');
        };
        wrap.appendChild(b);
      });
      slot.appendChild(wrap);
      slot._getValue = () => selected;
    } else if (q.type === 'true_false') {
      const row = document.createElement('div');
      row.className = 'mm-tf-row';
      let selected = saved;
      [['True', 'true'], ['False', 'false']].forEach(([label, val]) => {
        const b = document.createElement('button');
        b.className = 'mm-tf' + (String(saved) === val ? ' mm-selected' : '');
        b.textContent = label;
        b.onclick = () => {
          selected = val;
          Array.from(row.children).forEach((ch) => ch.classList.remove('mm-selected'));
          b.classList.add('mm-selected');
        };
        row.appendChild(b);
      });
      slot.appendChild(row);
      slot._getValue = () => selected;
    } else {
      slot.textContent = 'Unsupported question type.';
      slot._getValue = () => null;
    }
  }

  // Read-only render of the child's answer, marked right/wrong.
  function buildReview(slot, q, saved) {
    const correct = state.correctById[q.id];
    const mark = (el) => {
      if (correct === true) el.classList.add('mm-correct');
      else if (correct === false) el.classList.add('mm-wrong');
    };
    if (q.type === 'multiple_choice' || q.type === 'true_false') {
      const opts = q.type === 'true_false'
        ? [['True', 'true'], ['False', 'false']]
        : (q.choices || []).map((c) => [String(c), String(c)]);
      const wrap = document.createElement('div');
      wrap.className = q.type === 'true_false' ? 'mm-tf-row' : 'mm-choices';
      opts.forEach(([label, val]) => {
        const b = document.createElement('div');
        b.className = (q.type === 'true_false' ? 'mm-tf' : 'mm-choice') + ' mm-ro';
        b.textContent = label;
        if (String(val) === String(saved)) { b.classList.add('mm-selected'); mark(b); }
        wrap.appendChild(b);
      });
      slot.appendChild(wrap);
    } else {
      // numeric (or other): show the answer as read-only text
      const box = document.createElement('div');
      box.className = 'mm-num-input mm-ro';
      box.textContent = (saved == null || saved === '') ? '—' : String(saved);
      mark(box);
      slot.appendChild(box);
    }
  }

  function renderVerdict(el, correct) {
    el.hidden = false;
    el.classList.remove('mm-v-right', 'mm-v-wrong', 'mm-v-pending');
    if (correct === true) { el.textContent = '✓ Right!'; el.classList.add('mm-v-right'); }
    else if (correct === false) { el.textContent = '✗ Not quite'; el.classList.add('mm-v-wrong'); }
    else { el.textContent = '⏳ Your teacher will check this one'; el.classList.add('mm-v-pending'); }
  }

  // ---- Autosave current answer ----
  // Reads the value synchronously, then sends the POST without blocking (so callers
  // can re-render in the same user-gesture tick -> keeps iOS keyboard focus working).
  function saveCurrent() {
    const q = currentQ();
    const slot = $('q-input');
    const value = slot._getValue ? slot._getValue() : null;
    if (value == null || value === '') return; // nothing to save
    const prior = state.answers[q.id] || { time: 0, attempts: 0 };
    const elapsed = Math.round((Date.now() - state.qStartTs) / 1000);
    const totalTime = (prior.time || 0) + Math.max(0, elapsed);
    // attempts counts answer CHANGES, not visits (issue 004) — server enforces the same.
    const changed = String(prior.value) !== String(value);
    state.answers[q.id] = { value, time: totalTime, attempts: (prior.attempts || 0) + (changed ? 1 : 0) };
    api(`/api/sessions/${state.sessionId}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        question_id: q.id,
        student_answer: value,
        time_spent_seconds: totalTime,
        client_id: clientId(),
      }),
    }).catch((e) => {
      if (e.status === 409 && state && state.mode === 'quiz') return handleTakenOver();
      console.warn('autosave failed:', e.message);
    });
  }

  // ---- Nav ----
  function goNext() {
    if (state.mode !== 'review') saveCurrent();
    if (state.idx < state.set.questions.length - 1) {
      state.idx++;
      renderQuestion();
    }
  }
  function goBack() {
    if (state.mode !== 'review') saveCurrent();
    if (state.idx > 0) {
      state.idx--;
      renderQuestion();
    }
  }

  // btn-submit dispatches by mode: quiz -> submit; review -> back to sets.
  function onSubmitBtn() {
    if (state.mode === 'review') { loadHome(); return; }
    submit();
  }

  async function submit() {
    saveCurrent();
    if (state.timerInt) clearInterval(state.timerInt);
    let resp;
    try {
      resp = await api(`/api/sessions/${state.sessionId}/submit`, {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId() }),
      });
    } catch (e) {
      if (e.status === 409) return handleTakenOver();
      alert('Could not submit: ' + e.message);
      return;
    }
    // remember results so "See my answers" can open review without a refetch
    state.score = resp.score;
    state.reviewAnswers = resp.answers || [];
    showDone(resp.score);
  }

  function showDone(score) {
    const msgs = ['Awesome work! 🌟', 'Great job! 🎈', 'You did it! 🎉', 'Super! 🦄'];
    $('done-msg').textContent = msgs[Math.floor(Math.random() * msgs.length)];
    const pending = Number(score.pending) || 0;
    let line;
    if (score.max > 0) {
      line = `You got ${score.raw} out of ${score.max}!`;
    } else {
      line = `All done — your teacher will check your answers!`;
    }
    if (pending > 0 && score.max > 0) {
      line += ` (${pending} ${pending === 1 ? 'answer is' : 'answers are'} waiting for your teacher.)`;
    }
    $('done-score').textContent = line;
    show('done');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Wire up ----
  $('btn-next').onclick = goNext;
  $('btn-back').onclick = goBack;
  $('btn-submit').onclick = onSubmitBtn;
  $('btn-home').onclick = loadHome;
  $('btn-home-2').onclick = loadHome;
  // From the done screen, review the just-finished set (read-only).
  $('btn-review').onclick = () => {
    const set = state && state.set;
    if (!set) return loadHome();
    enterReview(set, state.reviewAnswers || [], state.score || {});
  };

  loadHome();
})();
