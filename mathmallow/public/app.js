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
      throw new Error(msg);
    }
    return res.json();
  }

  // ---- State ----
  let state = null; // { set, sessionId, answers:{qid:{value,time,attempts}}, idx, qStartTs, timerInt }

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
      btn.innerHTML =
        `<div class="mm-set-title">${escapeHtml(s.title)} ${s.completed ? '<span class="mm-set-done">✅</span>' : ''}</div>` +
        `<div class="mm-set-sub">${escapeHtml(s.subject || '')} · ${s.question_count} question${s.question_count === 1 ? '' : 's'}</div>`;
      btn.onclick = () => startSet(s.set_id);
      list.appendChild(btn);
    }
  }

  // ---- Start / resume ----
  async function startSet(setId) {
    const set = await api('/api/sets/' + encodeURIComponent(setId));
    const session = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ set_id: setId }),
    });
    const answers = {};
    for (const qid in (session.answers || {})) {
      const a = session.answers[qid];
      answers[qid] = { value: a.student_answer, time: a.time_spent_seconds || 0, attempts: a.attempts || 0 };
    }
    state = {
      set,
      sessionId: session.session_id,
      answers,
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
    const total = state.set.questions.length;
    $('progress').textContent = `Question ${state.idx + 1} of ${total}`;
    $('q-prompt').textContent = q.prompt || '';

    // visual
    const vslot = $('q-visual');
    vslot.innerHTML = '';
    vslot.appendChild(window.renderRender(q.render));

    // input
    const islot = $('q-input');
    islot.innerHTML = '';
    const saved = state.answers[q.id] ? state.answers[q.id].value : null;
    buildInput(islot, q, saved);

    // hint
    const hintBtn = $('btn-hint');
    const hintText = $('hint-text');
    hintText.hidden = true;
    if (q.hint) {
      hintBtn.hidden = false;
      hintBtn.onclick = () => {
        hintText.textContent = q.hint;
        hintText.hidden = false;
      };
    } else {
      hintBtn.hidden = true;
    }

    // nav
    $('btn-back').disabled = state.idx === 0;
    const isLast = state.idx === total - 1;
    $('btn-next').hidden = isLast;
    $('btn-submit').hidden = !isLast;

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

  // ---- Autosave current answer ----
  async function saveCurrent() {
    const q = currentQ();
    const slot = $('q-input');
    const value = slot._getValue ? slot._getValue() : null;
    if (value == null || value === '') return; // nothing to save
    const prior = state.answers[q.id] || { time: 0, attempts: 0 };
    const elapsed = Math.round((Date.now() - state.qStartTs) / 1000);
    const totalTime = (prior.time || 0) + Math.max(0, elapsed);
    state.answers[q.id] = { value, time: totalTime, attempts: (prior.attempts || 0) + 1 };
    try {
      await api(`/api/sessions/${state.sessionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({
          question_id: q.id,
          student_answer: value,
          time_spent_seconds: totalTime,
        }),
      });
    } catch (e) {
      console.warn('autosave failed:', e.message);
    }
  }

  // ---- Nav ----
  async function goNext() {
    await saveCurrent();
    if (state.idx < state.set.questions.length - 1) {
      state.idx++;
      renderQuestion();
    }
  }
  async function goBack() {
    await saveCurrent();
    if (state.idx > 0) {
      state.idx--;
      renderQuestion();
    }
  }

  async function submit() {
    await saveCurrent();
    if (state.timerInt) clearInterval(state.timerInt);
    let resp;
    try {
      resp = await api(`/api/sessions/${state.sessionId}/submit`, { method: 'POST' });
    } catch (e) {
      alert('Could not submit: ' + e.message);
      return;
    }
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
      // everything is awaiting teacher grading
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
  $('btn-submit').onclick = submit;
  $('btn-home').onclick = loadHome;
  $('btn-home-2').onclick = loadHome;

  loadHome();
})();
