/* podpatrol.js — autonomous support-pod overlay. No dependencies.
 *
 * A squad of small agents that live ON TOP of your UI: they dock at the screen
 * edges, undock to work on elements you point them at, tether and spotlight the
 * thing they are working on, interrupt with a lightning arc, vote among
 * themselves before acting, and answer plain-language questions in character.
 *
 * Two ways to use it:
 *
 *   1) Custom element — zero JS:
 *      <div style="position:relative">
 *        ...your app...  (mark targets with data-pod-target="id")
 *        <pod-patrol accent="#7de2ef" autonomy="quorum"></podpatrol>
 *      </div>
 *      The element uses its parentElement as the host box.
 *
 *   2) Class:
 *      const squad = new PodPatrol({ host, scroller, pods, verbs, autonomy });
 *      squad.assign('scout', 'TRACE', document.querySelector('#claim'));
 *      squad.cutIn('audit', el, 5000, 'Cutting in — that figure is amended.');
 *      squad.talk('scout', 'what are you doing?')   // -> reply string
 *      squad.on('record', e => log(e.detail))       // public activity log
 *      squad.on('say', e => log(e.detail.text))      // audio is built in; this
 *                                                   // is only for captions etc
 *
 * Personality: every pod takes a `persona` — voice (pitch, rate, preferred
 * system voice), traits that steer its behaviour, its own phrase pools, and a
 * verbal tic. See PodPatrol.PERSONA for the full shape and defaults.
 *
 *      { id:'audit', label:'AUDIT', color:'#c07a12', persona:{
 *          voice:{ pitch:.86, rate:.94, match:/daniel|male/i },
 *          traits:{ agreeable:.5, terse:.9, warmth:.1, hedge:.2, pushback:.9 },
 *          lines:{ ack:['Mine.'], thanks:['Check my work instead.'] },
 *          tic:'Logged.'
 *      }}
 *
 * Sound and voice ship with it: synthesized cues (no asset files) and one cast
 * voice per pod, so four pods read as four people. Unlocks on first gesture.
 *      squad.setAudio(false)   // mute cues + hum
 *      squad.setVoice(false)   // mute speech only
 *      new PodPatrol({ audio:false, voice:false })   // silent; wire 'say' yourself
 *
 * Real work: register async tools and the pods run them instead of a timer.
 *
 *      squad.tool('TRACE', async (ctx) => {
 *        const hits = await search(ctx.text);      // ctx.text/.el/.label/.pod
 *        ctx.progress(.6);                          // drives the pod's arc
 *        ctx.log('61 in, 3 kept');                  // shows on its label
 *        return hits.length ? { ok: hits } : { none: 'no primary source' };
 *      });
 *
 * Return { ok } | { partial } | { none } | { skip } (a value or a message), throw
 * to fail, or return nothing to accept the tool's own default text. `none` means
 * "I tried and could not reach it" — it escalates to a peer. `skip` means "there
 * was nothing valid to do" (precondition unmet) — it is recorded honestly and
 * the pod returns to idle WITHOUT manufacturing a blockage. Outcome drives the
 * same downstream behaviour as the simulation: peer assist on failure, trail
 * history, sound, speech. Verbs with no registered tool stay simulated.
 *
 * Standing orders (DSL): squad.script(src) parses a tiny rule language so end
 * users can author pod behaviour without JS. One rule per line:
 *
 *      # comments and blank lines are fine
 *      on finding: editor VERIFY it
 *      on blocked(audit): say "I can take a look."
 *      on drop: VERIFY it
 *      on idle(scout) every 25s: TRACE random
 *      every 40s: forge SUMMARIZE
 *
 * Grammar: [on EVENT[(pod[,pod])]] [every Ns] : [pod] (VERB [target] | say "...")
 * Events: taskdone finding blocked cutin drop quorum vote beat idle.
 * Targets: `it` (the event's element), `newest`, `random`, or a target id.
 * Acting pod: the named one, else the event's pod, else any idle pod. Rules are
 * rate-limited (4s each) and never interrupt a working pod. Returns a handle
 * with .stop(); calling script() again replaces the previous set.
 *
 * Self-scaffolding: squad.plan(goal) asks the planner (your brain fn by default)
 * to invent the artifact list AND the job graph for a goal it has never seen.
 * The plan is validated against registered verbs/pods before anything runs.
 *
 *      const plan = await squad.plan('write a guide to X');
 *      squad.run(plan.jobs);        // work-queue driver: hands a job to any
 *                                   // idle pod, never interrupts, respects deps
 *      squad.addJobs([...]);        // mid-run revision — a pod that learns
 *                                   // something can extend the plan
 *      squad.on('plan', e => ...)   // plan | jobqueued | jobstart | runend
 *
 * History: every outcome is kept. squad.history() is the unified chronological
 * record; squad.trailFor(id) is one pod's. squad.showTrail(id | 'all' | null)
 * draws a line through the places that pod actually did work, with a numbered
 * bubble at each stop summarising what happened there.
 *
 * At rest pods sit at 20% opacity so they never fight the content. HOLD the
 * reveal key (default Alt / Option) to bring the whole squad to full opacity
 * and pin a named bubble for each one inside the visible area, arrow pointing
 * back at the pod. Pass { revealKey:'Shift' } to rebind, null to disable.
 *
 * Events: record | say | taskstart | taskdone | blocked | proposal | quorum | tap
 * Autonomy: 'leash' (orders only) | 'quorum' (squad votes, you may veto) | 'auto'
 */
(function (root) {
  'use strict';

  /* Standing-beat findings are OBSERVATIONS. A beat does not mutate anything, so
   * these must never claim a completed edit — that would be a fabricated change. */
  var DEFAULT_PODS = [
    { id: 'scout',   label: 'SCOUT',   color: '#7de2ef',
      beats: ['sweeping new sources', 're-indexing what I have', 'checking for edits'],
      findings: ['Two new items match. Neither changes the conclusion.',
                 'One source has been amended. It narrows the claim — worth a pass if someone tasks me.'] ,
      proposals: [{ text: 'A fourth source disputes this. Want it pulled in?', verb: 'TRACE' }] },
    { id: 'audit',   label: 'AUDIT',   color: '#ffb347',
      beats: ['spot-checking cited numbers', 're-reading the chain of custody'],
      findings: ['Spot-check reads clean. Every figure I sampled traces to its source.',
                 'One number looks rounded past its source precision. Noting it, not changing it.'],
      proposals: [{ text: 'This was revised without a citation. Demand one?', verb: 'CHALLENGE' }] },
    { id: 'archive', label: 'ARCHIVE', color: '#b58cff',
      beats: ['cross-linking prior sessions', 'indexing this session'],
      findings: ['This was asked before. The answer on record has changed since.',
                 'Three items here look like they contradict the older record.'],
      proposals: [{ text: 'Want the earlier record pulled for comparison?', verb: 'RECALL' }] },
    { id: 'forge',   label: 'FORGE',   color: '#6ee7a0',
      beats: ['reading the working table', 'checking the diff'],
      findings: ['The disagreement is spread across three places. One table would hold it.',
                 'Looks like one substantive delta and a lot of noise around it.'],
      proposals: [{ text: 'Want me to draft the reply?', verb: 'DRAFT' }] }
  ];

  var DEFAULT_VERBS = {
    VERIFY:    { seconds: 12, mid: ['opening the chain', 'two of three links reachable'],
      ok: 'Verified against a primary source.', partial: 'Partly verified — one link is secondary.', none: 'Cannot verify. The chain breaks before any primary.' },
    TRACE:     { seconds: 15, mid: ['sweeping the index', 'sixty-one in, three kept'],
      ok: 'Traced to origin.', partial: 'Traced two hops. The third is unreachable.', none: 'Dead end. No citation to follow.' },
    RECALL:    { seconds: 9,  mid: ['scanning prior records', 'four matches, ranking them'],
      ok: 'Recalled. The earlier record disagrees with this one.', partial: 'Recalled partially — the relevant part was pruned.', none: 'Nothing on record touches this.' },
    DRAFT:     { seconds: 17, mid: ['laying out structure', 'filling in the gaps'],
      ok: 'Drafted and ready.', partial: 'Structurally done, two cells unsourced.', none: 'Cannot draft. The spec is underdefined.' },
    WATCH:     { seconds: 24, mid: ['watch armed, polling', 'no change since arming'],
      ok: 'Watch fired. The source changed.', partial: 'One soft signal, below threshold.', none: 'Watch expired. No change in window.' },
    SPLIT:     { seconds: 11, mid: ['decomposing', 'one branch looks circular'],
      ok: 'Split into three subtasks.', partial: 'One branch reduces to the original question.', none: 'Will not split. This is atomic.' },
    CHALLENGE: { seconds: 13, mid: ['building the opposing case', 'looking for the strongest counter'],
      ok: 'Challenged. The counter-case is weaker but real.', partial: 'I can weaken it; I cannot break it.', none: 'No honest challenge available.' },
    SUMMARIZE: { seconds: 10, mid: ['compressing', 'cutting to load-bearing lines'],
      ok: 'Summarized to four load-bearing points.', partial: 'Lossy — the disagreement does not compress.', none: 'Too little on record to summarize.' },
    ASSIST:    { seconds: 8,  mid: ['picking up the peer\u2019s gap', 'cross-checking'],
      ok: 'Assist complete. Handed back.', partial: 'Found the reference, not the document.', none: 'Cannot assist. No better reach than you.' }
  };

  var INTENTS = [
    [/source|origin|where.*from|trace|find/, 'TRACE'],
    [/true|check|verif|confirm|accurate|fact/, 'VERIFY'],
    [/remember|before|last time|prior|earlier|recall/, 'RECALL'],
    [/write|draft|build|table|produce/, 'DRAFT'],
    [/watch|monitor|alert|keep an eye|tell me if/, 'WATCH'],
    [/break.*down|split|subtask|decompose/, 'SPLIT'],
    [/argue|challenge|devil|opposite|push back|counter/, 'CHALLENGE'],
    [/summar|shorten|tl;?dr|condense|brief/, 'SUMMARIZE']
  ];

  /* ---------------- audio: synthesized cues + cast voices ---------------- *
   * No asset files. Browsers require a user gesture before audio starts, so
   * the first pointerdown anywhere unlocks the context and raises the hum.
   * Wire your own instead by passing { audio:false } and listening to 'say'.
   */
  function PatrolAudio(opts) {
    opts = opts || {};
    this.enabled = opts.enabled !== false;
    this.voice = opts.voice !== false;
    this.volume = opts.volume == null ? 0.5 : opts.volume;
    this.humHz = opts.humHz || 54;
    this.pitches = opts.pitches || [1.1, 0.88, 1.0, 0.8];
    this.rates = opts.rates || [1.03, 0.95, 0.93, 0.99];
    this.tones = opts.tones || [880, 660, 780, 560];
    this._q = [];
    var self = this;
    this._unlock = function () {
      window.removeEventListener('pointerdown', self._unlock);
      window.removeEventListener('keydown', self._unlock);
      if (self.enabled) { self.ctx(); self.hum(true); }
    };
    window.addEventListener('pointerdown', this._unlock);
    window.addEventListener('keydown', this._unlock);
    if (window.speechSynthesis) {
      this._vc = function () { self._voices = null; self._cast = null; };
      window.speechSynthesis.addEventListener('voiceschanged', this._vc);
    }
  }

  PatrolAudio.prototype.ctx = function () {
    if (this._ac) return this._ac;
    var A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    this._ac = new A();
    this._master = this._ac.createGain();
    this._master.gain.value = this.volume;
    this._master.connect(this._ac.destination);
    return this._ac;
  };

  PatrolAudio.prototype.tone = function (o) {
    if (!this.enabled) return;
    var ac = this.ctx(); if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    var t = ac.currentTime, os = ac.createOscillator(), g = ac.createGain();
    os.type = o.type || 'sine';
    os.frequency.setValueAtTime(o.f, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + (o.d || 0.2));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.g || 0.14, t + (o.a || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + (o.d || 0.2));
    os.connect(g); g.connect(this._master);
    os.start(t); os.stop(t + (o.d || 0.2) + 0.02);
  };

  PatrolAudio.prototype.noise = function (dur, gain, hz) {
    if (!this.enabled) return;
    var ac = this.ctx(); if (!ac) return;
    var n = Math.floor(ac.sampleRate * dur), b = ac.createBuffer(1, n, ac.sampleRate), ch = b.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = ac.createBufferSource(); s.buffer = b;
    var f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = hz || 2600; f.Q.value = 1.4;
    var g = ac.createGain(); g.gain.value = gain || 0.06;
    s.connect(f); f.connect(g); g.connect(this._master); s.start();
  };

  PatrolAudio.prototype.click   = function () { this.noise(0.045, 0.05); this.tone({ f: 1750, to: 900, d: 0.05, g: 0.05, type: 'square' }); };
  PatrolAudio.prototype.ping    = function (i) { var f = this.tones[(i || 0) % this.tones.length];
    this.tone({ f: f, d: 0.5, g: 0.09 }); this.tone({ f: f * 2, d: 0.22, g: 0.03, type: 'triangle' }); };
  PatrolAudio.prototype.soft    = function (i) { this.tone({ f: (this.tones[(i || 0) % this.tones.length]) * 0.8, d: 0.2, g: 0.04 }); };
  PatrolAudio.prototype.chord   = function () { var self = this;
    [392, 494, 587, 784].forEach(function (f, i) { setTimeout(function () { self.tone({ f: f, d: 0.9, g: 0.05 }); }, i * 70); }); };
  PatrolAudio.prototype.sweep   = function (up) { this.tone({ f: up ? 300 : 900, to: up ? 900 : 300, d: 0.28, g: 0.06, type: 'sawtooth' }); this.noise(0.12, 0.03); };
  PatrolAudio.prototype.alert   = function () { var self = this;
    this.tone({ f: 220, d: 0.18, g: 0.1, type: 'square' });
    setTimeout(function () { self.tone({ f: 180, d: 0.26, g: 0.09, type: 'square' }); }, 150); };
  PatrolAudio.prototype.crackle = function () { this.noise(0.09, 0.09, 1800); this.tone({ f: 1400, to: 420, d: 0.16, g: 0.06, type: 'sawtooth' }); };
  PatrolAudio.prototype.tick    = function (yes) { this.tone({ f: yes ? 720 : 300, d: 0.1, g: 0.04 }); };

  PatrolAudio.prototype.hum = function (on) {
    var ac = this.ctx(); if (!ac) return;
    if (on && !this._hum && this.enabled) {
      var os = ac.createOscillator(), g = ac.createGain();
      os.type = 'sine'; os.frequency.value = this.humHz; g.gain.value = 0;
      os.connect(g); g.connect(this._master); os.start();
      g.gain.linearRampToValueAtTime(0.035, ac.currentTime + 1.2);
      this._hum = { os: os, g: g };
    } else if (!on && this._hum) {
      var h = this._hum; this._hum = null;
      h.g.gain.linearRampToValueAtTime(0, ac.currentTime + 0.5);
      setTimeout(function () { try { h.os.stop(); } catch (e) {} }, 700);
    }
  };

  PatrolAudio.prototype.voices = function () {
    if (this._voices && this._voices.length) return this._voices;
    var sy = window.speechSynthesis; if (!sy) return [];
    var all = sy.getVoices(), en = all.filter(function (v) { return /^en/i.test(v.lang); });
    if (!en.length) en = all;
    var bad = /compact|eloquence|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|princess|deranged|hysterical/i;
    var good = /samantha|alex|daniel|karen|moira|tessa|serena|allison|ava|nicky|aaron|arthur|martha|natural|google|premium|enhanced|siri/i;
    var clean = en.filter(function (v) { return !bad.test(v.name); });
    var pool = clean.length ? clean : en;
    pool.sort(function (a, b) {
      return (good.test(b.name) ? 1 : 0) - (good.test(a.name) ? 1 : 0) ||
             (b.localService ? 1 : 0) - (a.localService ? 1 : 0) ||
             a.name.localeCompare(b.name);
    });
    this._voices = pool;
    return pool;
  };

  /* Cast distinct speakers so N pods read as N people, not one voice detuned.
   * A persona may name the voice it wants via voice.match. */
  PatrolAudio.prototype.setCast = function (specs) { this._specs = specs || null; this._cast = null; };
  PatrolAudio.prototype.castFor = function (i) {
    var vs = this.voices(); if (!vs.length) return null;
    if (!this._cast) {
      var specs = this._specs, taken = [];
      var fem = /female|samantha|karen|moira|ava|allison|serena|tessa|zira|aria|sonia/i;
      var mal = /male|daniel|alex|aaron|arthur|guy|david|oliver|ryan/i;
      var f = vs.filter(function (v) { return fem.test(v.name); });
      var m = vs.filter(function (v) { return mal.test(v.name); });
      var rest = vs.filter(function (v) { return !fem.test(v.name) && !mal.test(v.name); });
      var fallback = [f[0], m[0], f[1] || rest[0], m[1] || rest[1]];
      var n = specs ? specs.length : 4;
      this._cast = [];
      for (var k = 0; k < n; k++) {
        var want = specs && specs[k] && specs[k].match, v = null;
        if (want) {
          v = vs.filter(function (vv) { return want.test(vv.name) && taken.indexOf(vv) < 0; })[0] ||
              vs.filter(function (vv) { return want.test(vv.name); })[0];
        }
        if (!v) v = fallback[k % fallback.length] || vs[k % vs.length];
        taken.push(v);
        this._cast.push(v);
      }
    }
    return this._cast[i % this._cast.length];
  };

  /* Queued so a burst of squad chatter reads as turn-taking, not overlap. */
  PatrolAudio.prototype.speak = function (text, i) {
    if (!this.voice) return;
    var sy = window.speechSynthesis; if (!sy) return;
    /* Clear a wedged utterance rather than queue behind it forever. */
    if (sy.speaking && !this._speaking) { try { sy.cancel(); } catch (e) {} }
    this._q.push([text, i || 0]);
    if (this._q.length > 6) this._q.splice(0, this._q.length - 6);
    if (!this._speaking) this._drain();
  };
  PatrolAudio.prototype._drain = function () {
    var sy = window.speechSynthesis;
    if (!sy || !this._q.length) { this._speaking = false; return; }
    var pair = this._q.shift(), self = this;
    this._speaking = true;
    var txt = String(pair[0]).replace(/·/g, ',').replace(/—/g, ', ').replace(/\s+/g, ' ');
    var u = new SpeechSynthesisUtterance(txt);
    var v = this.castFor(pair[1]); if (v) u.voice = v;
    var spec = this._specs && this._specs[pair[1] % this._specs.length];
    u.pitch = spec && spec.pitch != null ? spec.pitch : this.pitches[pair[1] % this.pitches.length];
    u.rate = spec && spec.rate != null ? spec.rate : this.rates[pair[1] % this.rates.length];
    u.volume = 0.92;
    /* Browsers routinely wedge speechSynthesis: `speaking` stays true and onend
     * never fires, which would block this queue forever. Watchdog past the
     * plausible duration of the line, then force on. */
    var moved = false;
    var advance = function () {
      if (moved) return;
      moved = true;
      clearTimeout(self._wd);
      self._speaking = false;
      self._drain();
    };
    u.onend = advance;
    u.onerror = advance;
    this._wd = setTimeout(function () {
      if (moved) return;
      try { sy.cancel(); } catch (e) {}
      advance();
    }, 2500 + (txt.length / 12) * 1000 / (u.rate || 1));
    if (sy.paused) { try { sy.resume(); } catch (e) {} }
    sy.speak(u);
  };
  PatrolAudio.prototype.hush = function () {
    this._q.length = 0; this._speaking = false;
    clearTimeout(this._wd);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  };
  PatrolAudio.prototype.setEnabled = function (on) {
    this.enabled = !!on;
    if (on) { this.ctx(); this.click(); this.hum(true); } else this.hum(false);
  };
  PatrolAudio.prototype.setVoice = function (on) { this.voice = !!on; if (!on) this.hush(); };
  PatrolAudio.prototype.destroy = function () {
    this.hush(); this.hum(false);
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    if (window.speechSynthesis && this._vc) window.speechSynthesis.removeEventListener('voiceschanged', this._vc);
    if (this._ac) try { this._ac.close(); } catch (e) {}
  };

  /* ---------------- personality ---------------- *
   * The squad shares one goal. Pods disagree often, but as colleagues: a dissent
   * carries a reason and usually an alternative, and credit goes to whoever was
   * right. traits are 0..1 and are read, not decorative:
   *   agreeable — probability of voting yes in a quorum
   *   terse     — prefers the short phrasing from every pool
   *   warmth    — accepts thanks instead of deflecting
   *   hedge     — how often it appends a caveat
   *   pushback  — how readily it asks for specifics before moving
   * lines override any pool; anything you omit falls back to these.
   */
  var PERSONA = {
    voice: { pitch: 1.0, rate: 1.0, match: null },
    model: { name: null, temperature: 0.5, topP: 1, system: null },
    traits: { agreeable: 0.72, terse: 0.5, warmth: 0.45, hedge: 0.3, pushback: 0.5 },
    tic: null,
    lines: {
      ack:     ['On it.', 'Taking it.', 'Understood.', 'Mine \u2014 I will report back.'],
      short:   ['On it.', 'Mine.'],
      thanks:  ['Glad it helped. Check it anyway, that is how this works.', 'Team effort. Next one.', 'Noted \u2014 it was the interesting part of my day.'],
      warmThanks: ['Glad it helped.', 'Any time. That one was fun.'],
      hello:   ['Here.', 'Listening.', 'Here \u2014 what do you need?'],
      why:     ['Because the cheap check comes before the expensive one, and it saves us all a round.',
                'Because a weak result on the shared record costs the whole squad, not just me.',
                'Because we vote on anything bigger, and this was not bigger.'],
      vague:   ['Happy to \u2014 tell me what you want out of it and I will move.'],
      soft:    ['I can take a good guess at what you mean, if you would rather I just moved.'],
      unknown: ['Logged. Say the word and I will act on it.', 'Noted \u2014 turn it into a task and it is mine.', 'I hear you. Point me at it.'],
      question:['I would rather find out than guess. Say the word and I will look.',
                'I can answer that properly if you let me check first.'],
      concur:  ['Concur.', 'Concur \u2014 cheap, and it closes a gap.', 'Concur. I would have asked for it myself.'],
      dissent: ['I would skip it \u2014 the cost outbuys the answer, but outvote me and I will help.',
                'I read it differently: we can answer this without it. Not a strong objection.',
                'I would rather spend the round elsewhere. Happy to be wrong.'],
      standDown: ['Standing down. Nothing lost \u2014 I log as I go.'],
      idle:    ['Idle, on standing orders. Give me something harder.'],
      caveat:  ['Worth a second pair of eyes.', 'Read my confidence, not my tone.', 'That is my read \u2014 push back if yours differs.']
    }
  };

  function mergePersona(p) {
    var s = p || {};
    return {
      voice: Object.assign({}, PERSONA.voice, s.voice || {}),
      model: Object.assign({}, PERSONA.model, s.model || {}),
      traits: Object.assign({}, PERSONA.traits, s.traits || {}),
      tic: s.tic || PERSONA.tic,
      lines: Object.assign({}, PERSONA.lines, s.lines || {})
    };
  }

  /* Wall-clock stamp for the unified log. */
  function stamp(d) {
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }

  /* Tolerant JSON: models truncate long plans mid-array. Rather than lose the
   * whole reply, walk back to the last complete element and close the brackets. */
  function looseJSON(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    var s = String(raw);
    var start = s.indexOf('{');
    if (start < 0) return null;
    s = s.slice(start).replace(/```[\s\S]*$/, '');
    try { return JSON.parse(s); } catch (e) {}
    /* Largest balanced prefix. */
    var depth = 0, inStr = false, esc = false, lastSafe = -1, i, c;
    for (i = 0; i < s.length; i++) {
      c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { depth--; if (depth === 0) lastSafe = i; }
    }
    if (lastSafe > 0) { try { return JSON.parse(s.slice(0, lastSafe + 1)); } catch (e2) {} }
    /* Repair: cut at the last complete element, close whatever is still open. */
    var cut = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    while (cut > 0) {
      var head = s.slice(0, cut + 1), stack = [];
      inStr = false; esc = false;
      for (var j = 0; j < head.length; j++) {
        var ch = head[j];
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === '{' || ch === '[') stack.push(ch);
        else if (ch === '}' || ch === ']') stack.pop();
      }
      if (!inStr) {
        var tail = stack.reverse().map(function (b) { return b === '{' ? '}' : ']'; }).join('');
        try { return JSON.parse(head.replace(/,\s*$/, '') + tail); } catch (e3) {}
      }
      cut = Math.max(head.lastIndexOf('}', cut - 1), head.lastIndexOf(']', cut - 1));
    }
    return null;
  }

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function PodPatrol(opts) {
    opts = opts || {};
    this.host = opts.host;
    if (!this.host) throw new Error('PodPatrol: host element required');
    this.scroller = opts.scroller || null;
    this.targetAttr = opts.targetAttr || 'data-pod-target';
    /* Deep-copy each verb entry: a shallow merge leaves every this.verbs[V] as the
     * same object as DEFAULT_VERBS[V], so any host tweaking copy would corrupt the
     * module's defaults for every squad on the page. */
    var merged = Object.assign({}, DEFAULT_VERBS, opts.verbs || {});
    this.verbs = {};
    for (var vk in merged) {
      this.verbs[vk] = Object.assign({}, merged[vk], { mid: (merged[vk].mid || []).slice() });
    }
    this.autonomy = opts.autonomy || 'quorum';
    this.podSize = opts.podSize || 52;
    this.labels = opts.labels !== false;
    this.beatInterval = opts.beatInterval || 10500;
    this.podBg = opts.podBg || 'rgba(10,12,16,.72)';
    this.labelBg = opts.labelBg || null;
    this.restOpacity = opts.restOpacity == null ? 0.2 : opts.restOpacity;
    /* Hold to reveal: brings the whole squad to full opacity while held, so a
     * near-invisible resting squad is still findable on demand. */
    this.revealKey = opts.revealKey === undefined ? 'Alt' : opts.revealKey;
    this.boltCore = opts.boltCore || '#ffffff';
    this._bus = document.createElement('i');
    this._history = [];
    this.maxHistory = opts.maxHistory || 200;
    this._epoch = Date.now();
    this._seq = 0;
    this.trailShown = null;
    this.tools = {};
    this.pods = (opts.pods || DEFAULT_PODS).map(function (p, i) {
      return Object.assign({ index: i, state: 'idle', progress: 0, verb: null, on: null,
        target: null, helping: null, inc: 0, dim: false }, p, { persona: mergePersona(p.persona) });
    });
    if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
    this.audio = new PatrolAudio({
      enabled: opts.audio !== false, voice: opts.voice !== false, volume: opts.volume,
      humHz: opts.humHz, pitches: opts.pitches, rates: opts.rates, tones: opts.tones
    });
    this._wireAudio();
    this._build();
    this._t0 = performance.now();
    this._frame = 0;
    /* Any direct scroll input hands control back to the user. */
    if (this.scroller) {
      var squad = this;
      this._yieldHook = function () { squad.yieldScroll(); };
      ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'].forEach(function (ev) {
        squad.scroller.addEventListener(ev, squad._yieldHook, { passive: true });
      });
    }
    this._probe(this.host.getBoundingClientRect());
    var self = this;
    this._loop = function () { self._tick(); self._raf = requestAnimationFrame(self._loop); };
    this._raf = requestAnimationFrame(this._loop);
    if (this.revealKey) {
      var keys = [].concat(this.revealKey);
      var isAlt = keys.indexOf('Alt') >= 0;
      var set = function (on) {
        if (self.reveal === on) return;
        self.reveal = on;
        self._emit('reveal', { on: on });
      };
      this._setReveal = set;
      this._down = function (e) {
        if (keys.indexOf(e.key) >= 0 || (isAlt && (e.altKey || (e.getModifierState && e.getModifierState('Alt'))))) set(true);
      };
      this._up = function (e) {
        if (keys.indexOf(e.key) >= 0) return set(false);
        if (isAlt && !e.altKey) set(false);
      };
      /* Keydown can be missed entirely when the page does not have keyboard
       * focus (iframes, devtools, another pane). Any pointer event carries the
       * live modifier state, so re-sync from that too. */
      this._sync = function (e) { if (isAlt) set(!!e.altKey); };
      this._blur = function () { set(false); };
      window.addEventListener('keydown', this._down, true);
      window.addEventListener('keyup', this._up, true);
      document.addEventListener('keydown', this._down, true);
      document.addEventListener('keyup', this._up, true);
      window.addEventListener('pointermove', this._sync, true);
      window.addEventListener('pointerdown', this._sync, true);
      window.addEventListener('blur', this._blur);
      document.addEventListener('visibilitychange', this._blur);
    }
    if (this.autonomy !== 'leash') this._beatTimer = setInterval(function () { self.beat(); }, this.beatInterval);
  }

  PodPatrol.prototype._build = function () {
    var box = this.host.getBoundingClientRect(), n = this.pods.length, S = this.podSize;
    this.layer = document.createElement('div');
    this.layer.setAttribute('data-pod-layer', '');
    this.layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:50';
    this.svg = svg('svg', { width: '100%', height: '100%' });
    this.svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible';
    this.layer.appendChild(this.svg);

    this.spotOuter = svg('rect', { fill: 'none', 'stroke-width': '1', opacity: '0' });
    this.spot = svg('rect', { fill: 'none', 'stroke-width': '1', 'stroke-dasharray': '6 5', opacity: '0' });
    this.boltGlow = svg('path', { fill: 'none', 'stroke-width': '5', 'stroke-linejoin': 'round', opacity: '0' });
    this.boltGlow.style.filter = 'blur(2.5px)';
    this.bolt = svg('path', { fill: 'none', stroke: this.boltCore, 'stroke-width': '1.3', 'stroke-linejoin': 'round', opacity: '0' });
    [this.spotOuter, this.spot, this.boltGlow, this.bolt].forEach(this.svg.appendChild.bind(this.svg));

    var self = this;
    this.pods.forEach(function (p, i) {
      p.line = svg('line', { stroke: p.color, 'stroke-width': '1', 'stroke-dasharray': '3 4', opacity: '0' });
      self.svg.appendChild(p.line);
      p.trail = [];
      p.trailPath = svg('path', { d: '', fill: 'none', stroke: p.color, 'stroke-width': '1.5',
        'stroke-dasharray': '7 5', 'stroke-linejoin': 'round', opacity: '0' });
      p.trailDots = svg('g', { opacity: '0' });
      self.svg.appendChild(p.trailPath);
      self.svg.appendChild(p.trailDots);

      var side = i % 2 === 0 ? -8 : Math.max(40, box.width - S + 8);
      /* Distribute per side, not by row index — the old formula clamped the two
       * lower pods onto the same y and they stacked into what looked like one. */
      var onSide = [], j;
      for (j = 0; j < n; j++) if (j % 2 === i % 2) onSide.push(j);
      var k = onSide.indexOf(i), m = onSide.length;
      var top = Math.max(70, box.height * 0.14);
      var bottom = Math.max(top + 40, box.height - 130);
      var y = m > 1 ? top + (bottom - top) * (k / (m - 1)) : (top + bottom) / 2;
      p.dock = { x: side, y: clamp(y, 56, Math.max(56, box.height - S - 30)) };
      p.x = p.dock.x; p.y = p.dock.y;

      var el = document.createElement('div');
      el.setAttribute('data-pod', p.id);
      el.style.cssText = 'position:absolute;left:0;top:0;width:' + S + 'px;height:' + S + 'px;' +
        'pointer-events:auto;cursor:grab;touch-action:none;will-change:transform,opacity;' +
        'transition:opacity .45s ease,filter .3s ease';
      el.innerHTML = self._podSVG(p);
      if (self.labels) {
        var lab = document.createElement('div');
        lab.setAttribute('data-pod-label', p.id);
        /* Wraps to a readable block rather than truncating: an action tag you can
         * only half-read is worse than none. */
        lab.style.cssText = 'position:absolute;bottom:' + (i % 2 === 0 ? S - 10 : -10) + 'px;left:' + (S - 8) + 'px;' +
          'width:max-content;max-width:230px;white-space:normal;overflow-wrap:break-word;' +
          'font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.01em;' +
          'color:' + p.color + ';background:' + self.podBg + ';padding:5px 8px;border-radius:3px;' +
          'border:1px solid ' + p.color + '3d;opacity:0';
        lab.textContent = p.label;
        el.appendChild(lab);
        p.labelEl = lab;
      }
      el.addEventListener('pointerdown', function (ev) { self._grab(p, ev); });
      p.el = el; p.arc = el.querySelector('[data-arc]');
      self.layer.appendChild(el);

      /* Reveal bubble: a pod docked half off-canvas cannot be pointed at, so on
       * reveal each one gets a named bubble pinned INSIDE the visible area with
       * an arrow aimed at where the pod actually is. */
      var bub = document.createElement('div');
      bub.setAttribute('data-pod-bubble', p.id);
      bub.style.cssText = 'position:absolute;left:0;top:0;display:flex;align-items:center;gap:7px;' +
        'padding:5px 10px;border-radius:4px;white-space:nowrap;pointer-events:none;opacity:0;' +
        'transition:opacity .16s ease;z-index:70;' +
        'font:600 11.5px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;' +
        'color:' + p.color + ';background:' + (self.labelBg || self.podBg) + ';' +
        'border:1px solid ' + p.color + ';box-shadow:0 2px 12px rgba(0,0,0,.28)';
      var arrow = document.createElement('span');
      arrow.style.cssText = 'width:9px;height:10px;flex:none;background:' + p.color +
        ';clip-path:polygon(100% 50%,0 0,0 100%)';
      var nm = document.createElement('span');
      nm.textContent = p.label;
      bub.appendChild(arrow); bub.appendChild(nm);
      p.bubble = bub; p.arrowEl = arrow;
      self.layer.appendChild(bub);
    });
    this.host.appendChild(this.layer);
    this._chatter = setInterval(this._chatterTick.bind(this), 7000);
  };

  PodPatrol.prototype._podSVG = function (p) {
    var S = this.podSize, c = S / 2, r = S * 0.327, C = (2 * Math.PI * r).toFixed(1);
    return '<svg viewBox="0 0 ' + S + ' ' + S + '" style="position:absolute;inset:0;overflow:visible">' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="' + this.podBg + '"></circle>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="1" opacity=".28"></circle>' +
      '<circle data-arc cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="2" ' +
        'stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '" transform="rotate(-90 ' + c + ' ' + c + ')"></circle>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + (r * 0.65).toFixed(1) + '" fill="none" stroke="' + p.color + '" stroke-width="1"></circle>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + (S * 0.065).toFixed(1) + '" fill="' + p.color + '"></circle>' +
      '<g stroke="' + p.color + '" stroke-width="1.1" opacity=".85">' +
        '<path d="M' + (c - r + 2) + ' ' + c + ' L' + (c - r - 9) + ' ' + (c - r + 1) + '"></path>' +
        '<path d="M' + (c + r - 2) + ' ' + c + ' L' + (c + r + 9) + ' ' + (c - r + 1) + '"></path>' +
        '<path d="M' + (c - r + 5) + ' ' + (c + 8) + ' L' + (c - r - 5) + ' ' + (c + r + 9) + '"></path>' +
        '<path d="M' + (c + r - 5) + ' ' + (c + 8) + ' L' + (c + r + 5) + ' ' + (c + r + 9) + '"></path>' +
      '</g></svg>';
  };

  /* Every cue is derived from the same events the host sees, so muting audio
   * changes nothing else about the squad's behaviour. */
  PodPatrol.prototype._wireAudio = function () {
    var a = this.audio, self = this;
    a.setCast(this.pods.map(function (p) { return p.persona.voice; }));
    this.on('taskstart', function () { a.click(); a.tone({ f: 520, to: 980, d: 0.18, g: 0.07, type: 'triangle' }); });
    this.on('taskdone', function (e) { a.ping(self._idx(e.detail.pod)); });
    this.on('finding', function (e) { a.soft(self._idx(e.detail.pod)); });
    this.on('blocked', function () { a.alert(); });
    this.on('cutin', function () { a.crackle(); });
    this.on('vote', function (e) { a.tick(e.detail.yes); });
    this.on('quorum', function () { a.chord(); });
    this.on('proposal', function (e) { a.ping(self._idx(e.detail.pod)); });
    this.on('beat', function (e) { a.tone({ f: 400 + self._idx(e.detail.pod) * 40, d: 0.12, g: 0.03 }); });
    this.on('autonomy', function () { a.click(); });
    this.on('tap', function (e) { a.ping(e.detail.index); });
    this.on('say', function (e) { a.speak(e.detail.text, e.detail.index); });
  };
  PodPatrol.prototype._idx = function (id) { var p = this.get(id); return p ? p.index : 0; };
  PodPatrol.prototype.setAudio = function (on) { this.audio.setEnabled(on); return this; };
  PodPatrol.prototype.setVoice = function (on) { this.audio.setVoice(on); return this; };

  /* ---------- personality helpers ---------- */
  /* Pool lookup honouring `terse` (prefers the shortest option) and `tic`. */
  PodPatrol.prototype._line = function (p, key, fallbackKey) {
    var pool = p.persona.lines[key] || (fallbackKey && p.persona.lines[fallbackKey]) || [''];
    if (!pool.length) return '';
    if (p.persona.traits.terse > 0.66) {
      var sorted = pool.slice().sort(function (a, b) { return a.length - b.length; });
      return sorted[Math.floor(Math.random() * Math.max(1, Math.ceil(sorted.length / 2)))];
    }
    return pick(pool);
  };
  PodPatrol.prototype._style = function (p, text) {
    if (this.deterministic) return text;
    if (p.persona.tic && Math.random() < 0.34) return text + ' ' + p.persona.tic;
    if (Math.random() < p.persona.traits.hedge * 0.5) return text + ' ' + pick(p.persona.lines.caveat);
    return text;
  };
  /* Per-pod model settings. Passed through to your brain/tool backend verbatim
   * (ctx.model / squad.modelFor(id)) — a real API backend uses them as sampling
   * params; the built-in prompt() maps temperature onto an instruction register
   * since window.claude.complete exposes no sampling knobs. */
  PodPatrol.prototype.setModel = function (ref, cfg) {
    var p = this.get(ref); if (!p) return null;
    p.persona.model = Object.assign({}, p.persona.model, cfg || {});
    this._emit('model', { pod: p.id, model: p.persona.model });
    return p.persona.model;
  };
  PodPatrol.prototype.modelFor = function (ref) {
    var p = this.get(ref); return p ? Object.assign({}, p.persona.model) : null;
  };

  PodPatrol.prototype.setPersona = function (ref, persona) {
    var p = this.get(ref); if (!p) return null;
    p.persona = mergePersona(Object.assign({}, p.persona, persona || {}));
    if (this.audio) this.audio.setCast(this.pods.map(function (q) { return q.persona.voice; }));
    this._emit('persona', { pod: p.id, persona: p.persona });
    return p.persona;
  };
  PodPatrol.prototype.say = function (ref, text) {
    var p = this.get(ref); if (!p) return;
    this._record(p, text, 'line'); this._say(p, text);
  };

  /* ---------- events ---------- */
  PodPatrol.prototype.on = function (name, fn) { this._bus.addEventListener(name, fn); return this; };
  PodPatrol.prototype.off = function (name, fn) { this._bus.removeEventListener(name, fn); return this; };
  PodPatrol.prototype._emit = function (name, detail) {
    this._bus.dispatchEvent(new CustomEvent(name, { detail: detail }));
    if (this.host) this.host.dispatchEvent(new CustomEvent('pod-' + name, { detail: detail, bubbles: true }));
  };
  PodPatrol.prototype._record = function (pod, text, kind, meta) {
    var now = new Date();
    this._seq = (this._seq || 0) + 1;
    if (!this._epoch) this._epoch = now.getTime();
    var entry = { seq: this._seq, pod: pod ? pod.id : null, label: pod ? pod.label : 'SQUAD',
      color: pod ? pod.color : null, text: text, kind: kind || 'line',
      at: now.getTime(), time: stamp(now), iso: now.toISOString(),
      elapsed: +((now.getTime() - this._epoch) / 1000).toFixed(1),
      verb: meta && meta.verb || null, outcome: meta && meta.outcome || null,
      on: meta && meta.label || null, el: meta && meta.el || null };
    this._history.push(entry);
    if (this._history.length > this.maxHistory) this._history.shift();
    /* A trail stop is a place work actually happened, not every log line. */
    /* A skip stop is not a work stop — it records, but it is not a place work
     * happened, so it stays off the trail. */
    if (pod && entry.el && ['result', 'finding', 'cutin', 'flag'].indexOf(entry.kind) >= 0) {
      pod.trail.push(entry);
      if (pod.trail.length > 24) pod.trail.shift();
      this._emit('trailadd', { pod: pod.id, entry: entry });
    }
    this._emit('record', entry);
  };

  /* ---------- history ---------- */
  PodPatrol.prototype.history = function (filter) {
    if (!filter) return this._history.slice();
    return this._history.filter(function (e) {
      if (filter.pod && e.pod !== filter.pod) return false;
      if (filter.kind && [].concat(filter.kind).indexOf(e.kind) < 0) return false;
      return true;
    });
  };
  PodPatrol.prototype.trailFor = function (ref) {
    var p = this.get(ref); return p ? p.trail.slice() : [];
  };
  PodPatrol.prototype.clearHistory = function () {
    this._history.length = 0;
    this.pods.forEach(function (p) { p.trail.length = 0; });
    this.showTrail(null);
    this._emit('historyclear', {});
  };
  PodPatrol.prototype.showTrail = function (ref) {
    this.trailShown = ref === 'all' ? 'all' : (ref ? (this.get(ref) || {}).id || null : null);
    this._emit('trail', { showing: this.trailShown });
    return this.trailShown;
  };
  PodPatrol.prototype._say = function (pod, text) { this._emit('say', { pod: pod.id, index: pod.index, label: pod.label, text: text }); };

  /* ---------- lookup ---------- */
  PodPatrol.prototype.get = function (ref) {
    if (typeof ref === 'number') return this.pods[ref];
    return this.pods.filter(function (p) { return p.id === ref || p.label === String(ref).toUpperCase(); })[0];
  };
  PodPatrol.prototype._resolve = function (t) {
    if (!t) return null;
    if (t.nodeType === 1) return t;
    return this.host.querySelector('[' + this.targetAttr + '="' + t + '"]');
  };

  /* ---------- tools: real work instead of a countdown ---------- */
  /* A tool owns its own duration and outcome. The pod still shows progress,
   * still blocks and asks a peer when it fails, still lands in the trail. */
  PodPatrol.prototype.tool = function (verb, fn, meta) {
    if (typeof verb === 'object') {
      for (var k in verb) this.tool(k, verb[k]);
      return this;
    }
    this.tools[verb] = fn;
    /* Always clone — never leave a shared DEFAULT_VERBS reference in place. */
    var base = this.verbs[verb] || DEFAULT_VERBS[verb] || DEFAULT_VERBS.VERIFY;
    var next = Object.assign({}, base, meta || {});
    if (!this.verbs[verb] && !meta) {
      next = Object.assign({}, DEFAULT_VERBS.VERIFY, { seconds: 12,
        ok: verb + ' complete.', partial: verb + ' partly complete.', none: verb + ' failed.' });
    }
    next.mid = (next.mid || []).slice();
    this.verbs[verb] = next;
    return this;
  };
  PodPatrol.prototype.hasTool = function (verb) { return typeof this.tools[verb] === 'function'; };

  PodPatrol.prototype._runTool = function (p, verb) {
    var self = this, info = this.verbs[verb] || this.verbs.VERIFY, fn = this.tools[verb];
    var settled = false;
    p.live = true;               /* progress is reported, not interpolated */
    p.inc = 0;
    p.progress = 0.02;
    var token = p.token = (p.token || 0) + 1;
    var stale = function () { return p.token !== token || p.state !== 'working'; };
    var ctx = {
      pod: p.id, label: p.label, verb: verb, el: p.targetEl, on: p.on,
      text: p.targetEl ? (p.targetEl.innerText || p.targetEl.textContent || '').trim() : '',
      squad: this,
      progress: function (v) { if (!stale()) p.progress = clamp(Number(v) || 0, 0.02, 0.99); },
      log: function (msg) { if (!stale() && p.labelEl) p.labelEl.textContent = String(msg); },
      cancelled: stale
    };
    var done = function (out) {
      if (settled || stale()) return;
      settled = true;
      p.progress = 1;
      self._settle(p, verb, out);
    };
    var res;
    try { res = fn(ctx); }
    catch (err) { done({ none: (err && err.message) || info.none }); return; }
    Promise.resolve(res).then(function (out) {
      if (out && typeof out === 'object' && ('ok' in out || 'partial' in out || 'none' in out || 'skip' in out)) return done(out);
      done({ ok: out == null ? info.ok : out });
    }, function (err) {
      done({ none: (err && err.message) || info.none });
    });
  };

  /* Normalise a tool result into the outcomes the pipeline understands. */
  PodPatrol.prototype._settle = function (p, verb, out) {
    var info = this.verbs[verb] || this.verbs.VERIFY;
    var kind = 'skip' in out ? 'skip' : 'none' in out ? 'none' : 'partial' in out ? 'partial' : 'ok';
    var val = out[kind];
    var text = typeof val === 'string' ? val
      : (kind === 'ok' ? info.ok : kind === 'partial' ? info.partial : info.none);
    p.live = false;
    p.result = (val && typeof val !== 'string') ? val : null;
    this._finish(p, { outcome: kind, text: text });
  };

  /* ---------- task lifecycle ---------- */
  PodPatrol.prototype.assign = function (ref, verb, target, opts) {
    var p = this.get(ref); if (!p) return null;
    opts = opts || {};
    var info = this.verbs[verb] || this.verbs.VERIFY;
    var el = this._resolve(target);
    var real = this.hasTool(verb);
    p.state = 'working'; p.progress = 0; p.verb = verb;
    p.inc = real ? 0 : 1 / (info.seconds * 60);
    p.live = false; p.result = null;
    p.targetEl = el; p.on = opts.label || (el && (el.getAttribute('data-pod-name') || this._label(el))) || 'the current item';
    if (p.labelEl) p.labelEl.textContent = verb.toLowerCase() + ', starting';
    this._record(p, (opts.source || 'OPERATOR') + ' \u2192 ' + p.label + ': ' + verb + ' \u2014 ' + p.on +
      (real ? '.' : '. Estimated ' + info.seconds + 's.'), 'order');
    this._say(p, this._line(p, p.persona.traits.terse > 0.66 ? 'short' : 'ack', 'ack'));
    this._emit('taskstart', { pod: p.id, verb: verb, on: p.on, seconds: real ? null : info.seconds, live: real });
    if (real) this._runTool(p, verb);
    return p;
  };

  PodPatrol.prototype.standDown = function (ref) {
    var p = this.get(ref); if (!p) return;
    this._clear(p); this._record(p, 'Stood down mid-task.', 'line'); this._say(p, 'Standing down.');
  };

  PodPatrol.prototype._clear = function (p) {
    p.state = 'idle'; p.progress = 0; p.verb = null; p.targetEl = null; p.inc = 0; p.on = null;
    p.live = false; p.token = (p.token || 0) + 1;
    if (p.labelEl) p.labelEl.textContent = p.label;
  };

  PodPatrol.prototype._finish = function (p, forced) {
    var info = this.verbs[p.verb] || this.verbs.VERIFY;
    var out, text;
    if (forced) {
      out = forced.outcome;
      text = forced.text;
    } else {
      var roll = Math.random();
      out = roll < 0.5 ? 'ok' : roll < 0.82 ? 'partial' : 'none';
      text = out === 'ok' ? info.ok : out === 'partial' ? info.partial : info.none;
    }
    /* skip: the precondition was not met. Record it, stand down, escalate nothing.
     * Manufacturing a blockage here is how a refusal becomes a fake resolution. */
    if (out === 'skip') {
      var skipOn = p.on, skipVerb = p.verb, skipEl = p.targetEl;
      p.helping = null;
      this._clear(p);
      this._record(p, text, 'skip', { el: skipEl, verb: skipVerb, outcome: 'skip', label: skipOn });
      this._say(p, text);
      this._emit('taskskip', { pod: p.id, verb: skipVerb, on: skipOn, text: text });
      return;
    }
    if (out === 'none') {
      var free = this.pods.filter(function (q) { return q !== p && q.state === 'idle'; });
      if (free.length) {
        var helper = pick(free), self = this, blockedOn = p.on, blockedEl = p.targetEl, blockedVerb = p.verb;
        p.state = 'blocked'; p.progress = 0; p.live = false;
        if (p.labelEl) p.labelEl.textContent = 'blocked \u00b7 ' + helper.label.toLowerCase() + ' inbound';
        this._record(p, text + ' Handing to ' + helper.label + ' \u2014 better reach than mine on this \u2014 rather than signing something weak.', 'flag',
          { el: blockedEl, verb: blockedVerb, outcome: 'none', label: blockedOn });
        this._say(p, text + ' ' + helper.label + ', can you reach it?');
        this._emit('blocked', { pod: p.id, helper: helper.id, on: blockedOn, verb: blockedVerb, text: text, el: blockedEl });
        /* Resolve the job for dependency purposes: a failure is an outcome, and
         * dependents must become ready rather than waiting on it forever. */
        this._emit('taskfail', { pod: p.id, verb: blockedVerb, on: blockedOn, text: text, blocked: true });
        setTimeout(function () {
          if (helper.state !== 'idle') return;
          helper.helping = p;
          self.assign(helper.id, 'ASSIST', blockedEl, { label: blockedOn, source: p.label });
          self._say(helper, 'Taking it from you.');
        }, 2400 + Math.random() * 2200);
        return;
      }
      this._record(p, text + ' No pod free to take it over.', 'line',
        { el: p.targetEl, verb: p.verb, outcome: 'none', label: p.on });
      var failVerb = p.verb, failOn = p.on;
      this._say(p, text); this._clear(p);
      this._emit('taskfail', { pod: p.id, verb: failVerb, on: failOn, text: text, blocked: false });
      return;
    }
    var helped = p.helping, on = p.on, verb = p.verb, result = p.result;
    var whereEl = p.targetEl;
    p.helping = null; this._clear(p);
    text = this._style(p, text);
    this._record(p, text + ' (' + on + ')', 'result', { el: whereEl, verb: verb, outcome: out, label: on });
    this._say(p, text);
    this._emit('taskdone', { pod: p.id, verb: verb, outcome: out, on: on, text: text, result: result, el: whereEl });
    if (helped && helped.state === 'blocked') {
      var self2 = this;
      setTimeout(function () {
        self2._clear(helped);
        self2._record(helped, 'Assist from ' + p.label + ' got there. Block cleared, result signed \u2014 credit theirs.', 'line');
        self2._say(helped, 'Assist landed. Block cleared \u2014 that was ' + p.label + '.');
      }, 1900);
    }
  };

  /* ---------- interruption ---------- */
  PodPatrol.prototype.cutIn = function (ref, target, ms, text) {
    var p = this.get(ref); if (!p) return;
    if (p.state === 'working' || p.state === 'blocked') {
      var free = this.pods.filter(function (q) { return q.state === 'idle'; });
      if (!free.length) return; p = free[0];
    }
    ms = ms || 5000;
    p.state = 'cutin'; p.targetEl = this._resolve(target);
    if (p.labelEl) p.labelEl.textContent = 'cutting in';
    this.boltPod = p; this.boltUntil = performance.now() + ms; this._boltRoll = 0;
    if (text) { this._record(p, text, 'cutin', { el: p.targetEl, verb: 'CUTIN', label: text }); this._say(p, text); }
    this._emit('cutin', { pod: p.id, text: text, ms: ms, el: p.targetEl });
    var self = this;
    setTimeout(function () {
      if (p.state === 'cutin') self._clear(p);
      if (self.boltPod === p) self.boltPod = null;
    }, ms);
  };

  /* ---------- autonomy: standing beats + quorum ---------- */
  PodPatrol.prototype.setAutonomy = function (mode) {
    this.autonomy = mode;
    clearInterval(this._beatTimer);
    if (mode !== 'leash') {
      var self = this;
      this._beatTimer = setInterval(function () { self.beat(); }, this.beatInterval);
    }
    this._emit('autonomy', { mode: mode });
  };

  PodPatrol.prototype.beat = function () {
    if (this.autonomy === 'leash') return;
    if (this.boltPod && performance.now() < this.boltUntil) return;
    if (this.pendingProposal) return;
    var idle = this.pods.filter(function (p) { return p.state === 'idle'; });
    if (!idle.length) return;
    var p = pick(idle);
    this._beatN = (this._beatN || 0) + 1;
    if (this._beatN % 3 === 0 && p.proposals && p.proposals.length) return this.propose(p, pick(p.proposals));
    p.state = 'self'; p.progress = 0; p.inc = 1 / (14 * 60);
    p._beat = pick(p.beats || ['working quietly']);
    p._finding = pick(p.findings || ['Nothing worth reporting.']);
    var targets = this.targets();
    p.targetEl = targets.length ? pick(targets) : null;
    if (p.labelEl) p.labelEl.textContent = p._beat;
    this._emit('beat', { pod: p.id, beat: p._beat });
  };

  PodPatrol.prototype._selfDone = function (p) {
    var finding = p._finding, whereEl = p.targetEl, beat = p._beat;
    this._clear(p);
    /* Marked as an observation so a host can style it differently from a result:
     * a standing beat looked at something, it did not change it. */
    this._record(p, finding, 'finding', { el: whereEl, verb: 'NOTICED', outcome: 'ok', label: beat });
    this._emit('finding', { pod: p.id, text: finding, el: whereEl });
  };

  PodPatrol.prototype.propose = function (ref, proposal) {
    var p = this.get(ref) || ref, self = this;
    var text = proposal.text.replace(/^Want (me |it )?/, '').replace(/\?$/, '');
    if (this.autonomy === 'auto') {
      this._record(p, 'Acting without asking: ' + text + '.', 'line');
      this._say(p, 'Acting on my own initiative. ' + text);
      return this.assign(p.id, proposal.verb, p.targetEl, { label: text, source: 'SELF' });
    }
    if (this.autonomy === 'leash') {
      this.pendingProposal = { pod: p, proposal: proposal, split: false };
      this._emit('proposal', { pod: p.id, label: p.label, color: p.color, text: proposal.text,
        verb: proposal.verb, split: false });
      this._say(p, proposal.text);
      return null;
    }
    this._record(p, 'Proposing to the squad: ' + text + '. Calling a quorum.', 'line');
    this._say(p, 'Proposing ' + text + '. Squad, call it.');
    var peers = this.pods.filter(function (q) { return q !== p; });
    var votes = peers.map(function (q) { return { pod: q, yes: Math.random() < q.persona.traits.agreeable }; });
    var d = 900;
    votes.forEach(function (v) {
      setTimeout(function () {
        self._emit('vote', { pod: v.pod.id, yes: v.yes });
        self._emit('vote', { pod: v.pod.id, yes: v.yes });
        self._record(v.pod, self._line(v.pod, v.yes ? 'concur' : 'dissent'), 'vote');
      }, d);
      d += 850;
    });
    setTimeout(function () {
      var yes = votes.filter(function (v) { return v.yes; }).length + 1;
      var carried = yes > votes.length / 2 + 0.5;
      if (carried) {
        self._record(null, 'QUORUM ' + yes + '/' + (votes.length + 1) + ' \u2014 carried. ' + p.label +
          ' proceeding, dissent noted and kept on the record.', 'quorum');
        self.assign(p.id, proposal.verb, p.targetEl, { label: text, source: 'QUORUM ' + yes + '/' + (votes.length + 1) });
        self.runningQuorum = { pod: p, verb: proposal.verb, yes: yes, text: text };
        self._emit('quorum', { pod: p.id, label: p.label, yes: yes, of: votes.length + 1, verb: proposal.verb, text: text });
        setTimeout(function () { self.runningQuorum = null; }, 7000);
      } else {
        self._record(null, 'QUORUM ' + yes + '/' + (votes.length + 1) + ' \u2014 split, and reasonably so. Bringing it to the operator.', 'quorum');
        self._say(p, 'We are split, and both reads are defensible. Operator, your call.');
        self.pendingProposal = { pod: p, proposal: proposal, split: true };
        self._emit('proposal', { pod: p.id, label: p.label, color: p.color, text: proposal.text,
          verb: proposal.verb, split: true });
      }
    }, d + 400);
    return null;
  };

  PodPatrol.prototype.approve = function () {
    var q = this.pendingProposal; if (!q) return;
    this.pendingProposal = null;
    return this.assign(q.pod.id, q.proposal.verb, q.pod.targetEl,
      { label: q.proposal.text.replace(/\?$/, ''), source: 'APPROVED' });
  };
  PodPatrol.prototype.decline = function () {
    var q = this.pendingProposal; if (!q) return;
    this.pendingProposal = null; this._say(q.pod, 'Understood. Standing down.');
  };
  PodPatrol.prototype.veto = function () {
    var q = this.runningQuorum; if (!q) return;
    this._clear(q.pod); this.runningQuorum = null;
    this._record(q.pod, 'Vetoed by operator mid-task \u2014 ' + q.text + '.', 'line');
    this._say(q.pod, 'Vetoed. Standing down.');
  };

  /* ---------- conversation ---------- */
  PodPatrol.prototype.verbFor = function (text) {
    var t = text.toLowerCase();
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i][0].test(t)) return INTENTS[i][1];
    return null;
  };

  /* Rule-based reply. Kept as the always-available path: it is instant, it never
   * fails, and it is what talkAsync() falls back to when no brain is attached. */
  PodPatrol.prototype.talk = function (ref, text) {
    var p = this.get(ref); if (!p) return '';
    var t = text.toLowerCase().trim(), self = this;
    var busy = p.state === 'working' || p.state === 'self';
    var tr = p.persona.traits;
    var reply;
    if (/^(stop|stand down|cancel|halt|abort|forget it|never mind)/.test(t)) {
      if (busy) { this._clear(p); reply = this._line(p, 'standDown'); }
      else reply = 'Nothing running. I am already idle.';
    } else if (/status|what are you|you doing|busy|progress|how.*going/.test(t)) {
      reply = p.state === 'working' ? 'Mid-task: ' + p.verb + ' on ' + p.on + ', ' + Math.round(p.progress * 100) + ' per cent.'
        : p.state === 'self' ? 'Running my own beat, ' + p._beat + '. Interruptible.'
        : p.state === 'blocked' ? 'Blocked. I asked a peer rather than sign something weak.'
        : this._line(p, 'idle');
      reply = this._style(p, reply);
    } else if (/thank|nice work|good job|well done|cheers/.test(t)) {
      reply = this._line(p, tr.warmth > 0.55 ? 'warmThanks' : 'thanks', 'thanks');
    } else if (/who|which pod|should i ask|better suited/.test(t)) {
      var other = this.pods[(p.index + 1) % this.pods.length];
      reply = other.label + ' is better placed for that than I am \u2014 want me to hand it over?';
    } else if (/why/.test(t)) {
      reply = this._line(p, 'why');
    } else if (/can you|could you|would you|please|i need|i want/.test(t) || this.verbFor(t)) {
      var v = this.verbFor(t);
      if (v) {
        if (busy) reply = 'I will take it after this one \u2014 or say "stop" and I switch now.';
        else {
          setTimeout(function () { self.assign(p.id, v, p.targetEl, { label: text.slice(0, 52) }); }, 450);
          reply = this._line(p, 'ack') + ' I will report in the record.';
        }
      } else reply = this._line(p, tr.pushback > 0.5 ? 'vague' : 'soft', 'vague');
    } else if (/hello|hi\b|hey|you there|awake/.test(t)) {
      reply = this._line(p, 'hello');
    } else if (/\?$/.test(text)) {
      reply = this._line(p, 'question');
    } else {
      reply = this._line(p, 'unknown');
    }
    this._record(null, 'OPERATOR \u2192 ' + p.label + ': ' + text, 'said');
    var out = reply;
    setTimeout(function () { self._record(p, out, 'line'); self._say(p, out); }, 520 + Math.random() * 400);
    return reply;
  };

  /* ---------- reasoning: let a model choose the verb ---------- *
   * squad.brain(fn) attaches a decision function. It receives everything the pod
   * knows and returns { reply, verb, target, ask } — reply is spoken, verb is
   * dispatched through the same assign() path as a manual order, ask hands off
   * to a peer. Async, and free to call an LLM. If it throws or times out the
   * rule engine answers instead, so the squad never goes mute.
   *
   *   squad.brain(async (ctx) => JSON.parse(await window.claude.complete(ctx.prompt())));
   */
  PodPatrol.prototype.brain = function (fn, opts) {
    this._brain = fn;
    this._brainTimeout = (opts && opts.timeout) || 12000;
    this._emit('brain', { attached: !!fn });
    return this;
  };
  PodPatrol.prototype.hasBrain = function () { return typeof this._brain === 'function'; };

  PodPatrol.prototype._brainCtx = function (p, text) {
    var self = this;
    var tgts = this.targets().map(function (e) {
      return { id: e.getAttribute(self.targetAttr), name: e.getAttribute('data-pod-name') || self._label(e) };
    });
    var verbs = Object.keys(this.verbs).filter(function (v) { return v !== 'ASSIST'; });
    var recent = this._history.slice(-6).map(function (e) { return e.label + ': ' + e.text; });
    var mine = p.trail.slice(-5).map(function (e) { return '[' + e.time + '] ' + (e.verb || 'NOTE') + ' (' + (e.outcome || 'n/a') + '): ' + e.text; });
    var peers = this.pods.filter(function (q) { return q !== p; })
      .map(function (q) { return { id: q.id, label: q.label, state: q.state }; });
    var ctx = {
      pod: p.id, label: p.label, said: text,
      state: p.state, verb: p.verb, progress: p.progress, on: p.on,
      persona: { traits: p.persona.traits, tic: p.persona.tic },
      model: Object.assign({}, p.persona.model),
      peers: peers, verbs: verbs, targets: tgts, recent: recent, mine: mine, tools: Object.keys(this.tools)
    };
    /* A ready-made prompt so the common case is one line of host code. */
    ctx.prompt = function () {
      var mdl = p.persona.model, T = mdl.temperature == null ? 0.5 : mdl.temperature;
      var register = T < 0.3 ? 'Be maximally conventional and deterministic: give the single most probable, safest read and commit to it.'
        : T > 0.7 ? 'Be exploratory: prefer the interesting or overlooked angle over the obvious one, and say so when you are speculating.'
        : 'Balance the conventional read with one non-obvious observation.';
      return (mdl.system ? mdl.system + '\n' : '') +
        'You are ' + p.label + ', one of ' + self.pods.length + ' support agents working alongside a person.\n' +
        'Your disposition (0-1): ' + JSON.stringify(p.persona.traits) + '. Speak in that register. Be brief, never sycophantic. ' + register + '\n' +
        'You may run exactly one of these actions, or none: ' + verbs.join(', ') + '.\n' +
        'Targets: ' + (tgts.length ? tgts.map(function (x) { return x.id + ' (' + x.name + ')'; }).join('; ') : 'none') + '.\n' +
        'Peers: ' + peers.map(function (q) { return q.label + ' [' + q.state + ']'; }).join(', ') + '.\n' +
        'You are currently ' + (p.state === 'idle' ? 'idle' : p.state + ' on ' + p.on) + '.\n' +
        (recent.length ? 'Recent squad activity:\n' + recent.join('\n') + '\n' : '') +
        (mine.length ? 'Your own recent work (do not repeat it):\n' + mine.join('\n') + '\n' : '') +
        'The person said: ' + JSON.stringify(text) + '\n\n' +
        'Reply with JSON only: {"reply":"one or two sentences in your voice",' +
        '"verb":"ACTION_OR_NULL","target":"target id or null","ask":"peer id or null"}';
    };
    return ctx;
  };

  /* Same contract as talk(), but resolves to the reply and may act on its own. */
  PodPatrol.prototype.talkAsync = function (ref, text) {
    var p = this.get(ref), self = this;
    if (!p) return Promise.resolve('');
    if (!this._brain) return Promise.resolve(this.talk(ref, text));

    this._record(null, 'OPERATOR \u2192 ' + p.label + ': ' + text, 'said');
    p.thinking = true;
    if (p.labelEl) p.labelEl.textContent = 'thinking';
    this._emit('thinking', { pod: p.id, on: true });

    var stop = function () {
      p.thinking = false;
      self._emit('thinking', { pod: p.id, on: false });
      if (p.labelEl && p.state === 'idle') p.labelEl.textContent = p.label;
    };
    var timeout = new Promise(function (_, rej) {
      setTimeout(function () { rej(new Error('brain timeout')); }, self._brainTimeout);
    });

    return Promise.race([Promise.resolve(this._brain(this._brainCtx(p, text))), timeout])
      .then(function (d) {
        d = looseJSON(d) || { reply: typeof d === 'string' ? d : null };
        stop();
        var reply = (d && d.reply) || self._line(p, 'unknown');
        self._record(p, reply, 'line');
        self._say(p, reply);
        var peer = d && d.ask ? self.get(d.ask) : null;
        if (peer && peer !== p) {
          self._record(p, 'Handing this to ' + peer.label + '.', 'line');
          if (d.verb && self.verbs[d.verb]) setTimeout(function () {
            self.assign(peer.id, d.verb, d.target || null, { label: text.slice(0, 52), source: p.label });
          }, 700);
          return reply;
        }
        if (d && d.verb && self.verbs[d.verb] && p.state === 'idle') setTimeout(function () {
          self.assign(p.id, d.verb, d.target || p.targetEl, { label: text.slice(0, 52), source: 'REASONED' });
        }, 600);
        return reply;
      })
      .catch(function (err) {
        stop();
        self._emit('brainerror', { pod: p.id, error: String((err && err.message) || err) });
        /* Degrade to rules rather than silence. */
        var reply = self._talkRules(p, text);
        self._record(p, reply, 'line');
        self._say(p, reply);
        return reply;
      });
  };

  /* The rule engine with its logging suppressed, for reuse as a fallback. */
  PodPatrol.prototype._talkRules = function (p, text) {
    var keep = this._record;
    this._record = function () {};
    var out;
    try { out = this.talk(p.id, text); } finally { this._record = keep; }
    return out;
  };

  /* ---------- self-scaffolding: plan then run ---------- *
   * The squad invents its own structure for a goal. planner(fn) overrides the
   * default, which reuses the attached brain. Nothing runs unvalidated: unknown
   * verbs and pods are dropped, and a plan with no runnable jobs is reported as
   * a failure rather than silently doing nothing. */
  PodPatrol.prototype.planner = function (fn) { this._planner = fn; return this; };

  PodPatrol.prototype.plan = function (goal, opts) {
    var self = this;
    opts = opts || {};
    var lead = this.get(opts.lead) || this.pods[0];
    var verbs = Object.keys(this.verbs).filter(function (v) { return v !== 'ASSIST'; });
    var pods = this.pods.map(function (p) { return p.id; });
    var ctx = {
      goal: goal, lead: lead.id, verbs: verbs, pods: pods,
      tools: Object.keys(this.tools),
      podRoles: this.pods.map(function (p) {
        return { id: p.id, label: p.label, traits: p.persona.traits,
          beats: (p.beats || []).slice(0, 2) };
      }),
      prompt: function () {
        return 'You are ' + lead.label + ', leading a squad of ' + self.pods.length + ' agents. ' +
          'Design the work for this goal, then stop — do not do the work.\n' +
          'GOAL: ' + goal + '\n\n' +
          'Your squad, with dispositions:\n' + ctx.podRoles.map(function (r) {
            return '- ' + r.id + ' (' + r.label + '): ' + JSON.stringify(r.traits);
          }).join('\n') + '\n\n' +
          'Actions available: ' + verbs.join(', ') + '.\n\n' +
          'Produce a plan: the artifacts to create, then an ordered job list. Assign each job ' +
          'to the pod whose disposition fits it. Include verification and critique jobs, not just ' +
          'production ones — a plan with no checking in it is a bad plan. 8 to 14 jobs.\n' +
          'Give every job an id (j1, j2, …) and an "after" list naming the job ids it genuinely ' +
          'depends on. Leave "after" empty for anything that can start immediately — independent ' +
          'artifacts SHOULD run in parallel. A check job depends on the job that produced what it checks.\n' +
          'For each artifact give 2-3 acceptance checks: the specific things that must be true ' +
          'before it counts as finished. Concrete and checkable, not "is good quality".\n' +
          'The checks are the point of the plan, not decoration: every job must say which checks it ' +
          'advances ("meets": ["check text", …]) and between them the jobs must cover EVERY check on ' +
          'every artifact. Do not plan a job whose only purpose is that an artifact exists.\n' +
          'Keep it compact: artifact titles under 6 words, notes under 12 words, checks under 12 words, ' +
          'job labels under 8 words. Plan the work only — no content, no code, no prose from the artifacts themselves.\n\n' +
          'Reply JSON only: {"title":"...","artifacts":[{"key":"short_id","title":"...","note":"what it covers","done":["check","check"]}],' +
          '"jobs":[{"id":"j1","after":[],"pod":"pod id","verb":"ACTION","artifact":"artifact key or null","label":"short description","meets":["which check this advances"]}],' +
          '"rationale":"one sentence on why this shape"}';
      }
    };
    var fn = this._planner || this._brain;
    if (!fn) return Promise.resolve(null);

    lead.thinking = true;
    if (lead.labelEl) lead.labelEl.textContent = 'planning';
    this._emit('thinking', { pod: lead.id, on: true });
    this._record(lead, 'Planning: ' + goal, 'line');

    var stop = function () {
      lead.thinking = false;
      self._emit('thinking', { pod: lead.id, on: false });
      if (lead.labelEl && lead.state === 'idle') lead.labelEl.textContent = lead.label;
    };

    return Promise.resolve(fn(ctx)).then(function (d) {
      d = looseJSON(d);
      stop();
      if (!d || !Array.isArray(d.jobs) || !d.jobs.length) {
        self._record(lead, 'Could not read a usable plan back' +
          (d && d.artifacts ? ' — artifacts came through, the job list did not' : '') +
          '. Try a narrower goal, or press PLAN IT again.', 'line');
        self._emit('plan', { ok: false, goal: goal, partial: d || null });
        return null;
      }
      /* Validate: drop anything that cannot actually run. */
      var dropped = 0;
      var jobs = d.jobs.map(function (j, idx) {
        var verb = String(j.verb || '').toUpperCase();
        var pod = self.get(j.pod);
        if (!self.verbs[verb] || !pod) { dropped++; return null; }
        return { id: j.id || ('j' + (idx + 1)),
          after: (Array.isArray(j.after) ? j.after : []).map(String),
          meets: Array.isArray(j.meets) ? j.meets.map(String) : [],
          pod: pod.id, verb: verb, artifact: j.artifact || null,
          label: j.label || verb.toLowerCase(), target: j.artifact || null };
      }).filter(Boolean);
      /* A dependency on a dropped job would deadlock the run — prune those. */
      var live = {};
      jobs.forEach(function (j) { live[j.id] = true; });
      jobs.forEach(function (j) {
        j.after = j.after.filter(function (a) { return live[a]; });
      });
      var plan = { title: d.title || goal, artifacts: Array.isArray(d.artifacts) ? d.artifacts : [],
        jobs: jobs, rationale: d.rationale || '', dropped: dropped };
      /* Report coverage: a plan that leaves checks unaddressed is a weak plan and
       * the operator should see that before running it. */
      var allChecks = 0, covered = {};
      plan.artifacts.forEach(function (a) { allChecks += (a.done || []).length; });
      jobs.forEach(function (j) { j.meets.forEach(function (m) { covered[m.toLowerCase().slice(0, 40)] = true; }); });
      plan.checks = allChecks;
      plan.checksCovered = Math.min(allChecks, Object.keys(covered).length);
      self._plan = plan;
      self._record(lead, 'Plan: ' + plan.artifacts.length + ' artifacts, ' + jobs.length + ' jobs, ' +
        allChecks + ' acceptance checks' +
        (allChecks && plan.checksCovered < allChecks
          ? ' — only ' + plan.checksCovered + ' have a job aimed at them'
          : ' — all covered') +
        (dropped ? ' (' + dropped + ' jobs dropped as unrunnable)' : '') + '. ' + plan.rationale, 'line');
      self._say(lead, 'Plan is ready. ' + plan.artifacts.length + ' pieces, ' + jobs.length + ' jobs. ' + plan.rationale);
      self._emit('plan', Object.assign({ ok: true, goal: goal }, plan));
      return plan;
    }).catch(function (err) {
      stop();
      self._record(lead, 'Planning failed: ' + ((err && err.message) || err), 'line');
      self._emit('plan', { ok: false, goal: goal, error: String((err && err.message) || err) });
      return null;
    });
  };

  /* Work-queue driver. Dispatches every job whose dependencies are satisfied to
   * any free pod, so independent work runs in parallel; never interrupts a pod
   * that is working. Jobs with no `after` start immediately. */
  PodPatrol.prototype.run = function (jobs, opts) {
    var self = this;
    opts = opts || {};
    this.stopRun();
    this._queue = (jobs || []).slice().map(function (j, i) {
      return Object.assign({ id: j.id || ('j' + (i + 1)), after: j.after || [] }, j);
    });
    this._doneIds = {};
    this._active = {};
    this._running = true;
    this._emit('runstart', { jobs: this._queue.length });
    var gap = opts.gap || 1500;
    var ready = function (j) {
      for (var i = 0; i < j.after.length; i++) if (!self._doneIds[j.after[i]]) return false;
      return true;
    };
    if (!this._depHook) {
      this._depHook = function (e) {
        var pid = e.detail && e.detail.pod;
        if (!pid || !self._active) return;
        var jid = self._active[pid];
        if (jid) { self._doneIds[jid] = true; delete self._active[pid]; }
      };
      this.on('taskdone', this._depHook);
      this.on('taskskip', this._depHook);
      this.on('taskfail', this._depHook);
    }
    /* Stall watchdog: if nothing can be dispatched while work remains, say so
     * instead of spinning. */
    this._idleTicks = 0;
    this._runTimer = setInterval(function () {
      if (!self._queue.length) {
        if (self.pods.some(function (p) { return p.state !== 'idle'; })) return;
        self.stopRun();
        self._emit('runend', { completed: true });
        return;
      }
      /* Fill every idle pod this tick, not just one. */
      var guard = self.pods.length, dispatched = 0;
      while (guard-- > 0) {
        var idle = self.pods.filter(function (p) { return p.state === 'idle'; });
        if (!idle.length) break;
        var pickIdx = -1, p = null;
        for (var i = 0; i < self._queue.length; i++) {
          var j = self._queue[i];
          if (!ready(j)) continue;
          var named = self.get(j.pod);
          if (named && named.state === 'idle') { pickIdx = i; p = named; break; }
          if (pickIdx < 0 && !opts.strict) { pickIdx = i; p = idle[0]; }
        }
        if (pickIdx < 0) break;
        dispatched++;
        var job = self._queue.splice(pickIdx, 1)[0];
        self._active[p.id] = job.id;
        self._emit('jobstart', { pod: p.id, verb: job.verb, label: job.label, id: job.id });
        self.assign(p.id, job.verb, job.target || null, { label: job.label, source: 'PLAN' });
      }
      if (dispatched) self._idleTicks = 0;
      else if (self.pods.every(function (p) { return p.state === 'idle'; })) {
        if (++self._idleTicks >= 6) {
          var stuck = self._queue.length;
          self.stopRun();
          self._emit('runend', { completed: false, stalled: true, remaining: stuck });
        }
      }
    }, gap);
    return this;
  };
  PodPatrol.prototype.addJobs = function (jobs, front) {
    var self = this;
    var add = (jobs || []).map(function (j, i) {
      var verb = String(j.verb || '').toUpperCase();
      if (!self.verbs[verb]) return null;
      return { id: j.id || ('x' + Date.now() + i), after: j.after || [],
        pod: (self.get(j.pod) || {}).id || null, verb: verb,
        target: j.target || j.artifact || null, label: j.label || verb.toLowerCase() };
    }).filter(Boolean);
    if (!add.length) return 0;
    this._queue = this._queue || [];
    if (front) this._queue = add.concat(this._queue); else this._queue = this._queue.concat(add);
    this._emit('jobqueued', { added: add.length, remaining: this._queue.length, front: !!front });
    return add.length;
  };
  PodPatrol.prototype.queued = function () { return (this._queue || []).slice(); };
  PodPatrol.prototype.stopRun = function () {
    clearInterval(this._runTimer);
    this._runTimer = null;
    this._running = false;
    this._idleTicks = 0;
    return this;
  };
  PodPatrol.prototype.isRunning = function () { return !!this._running; };

  /* ---------- standing orders DSL ---------- */
  PodPatrol.prototype.script = function (src) {
    var self = this;
    if (this._script) this._script.stop();
    var rules = [], errors = [];
    String(src || '').split('\n').forEach(function (raw, ln) {
      var line = raw.trim();
      if (!line || line[0] === '#') return;
      var m = line.match(/^(?:on\s+(\w+)\s*(?:\(([^)]+)\))?\s*)?(?:every\s+(\d+)\s*s\s*)?:\s*(.+)$/i);
      if (!m) { errors.push('line ' + (ln + 1) + ': cannot parse "' + line + '"'); return; }
      var act = m[4].trim().match(/^(?:(\w+)\s+)?(?:say\s+"([^"]*)"|([A-Z][A-Z_]+)(?:\s+(\S+))?)$/);
      if (!act) { errors.push('line ' + (ln + 1) + ': bad action "' + m[4] + '"'); return; }
      rules.push({ event: m[1] ? m[1].toLowerCase() : null,
        pods: m[2] ? m[2].split(',').map(function (s) { return s.trim().toLowerCase(); }) : null,
        everyMs: m[3] ? Number(m[3]) * 1000 : null,
        actor: act[1] ? act[1].toLowerCase() : null,
        say: act[2] != null ? act[2] : null,
        verb: act[3] || null, target: act[4] || null, last: 0 });
    });
    var offs = [], timers = [];
    var resolveTarget = function (spec, ev) {
      if (!spec || spec === 'it') return (ev && (ev.el || ev.target)) || null;
      if (spec === 'newest') { var t = self.targets(); return t[t.length - 1] || null; }
      if (spec === 'random') { var t2 = self.targets(); return t2.length ? pick(t2) : null; }
      return self._resolve(spec);
    };
    var fire = function (rule, ev) {
      var now = Date.now();
      if (now - rule.last < 4000) return;
      var p = rule.actor ? self.get(rule.actor) : (ev && ev.pod ? self.get(ev.pod) : null);
      if (!p) p = self.pods.filter(function (q) { return q.state === 'idle'; })[0];
      if (!p) return;
      if (rule.say != null) { rule.last = now; self.say(p.id, rule.say); return; }
      if (!rule.verb || p.state !== 'idle') return;
      rule.last = now;
      self.assign(p.id, rule.verb, resolveTarget(rule.target, ev), { source: 'STANDING ORDER' });
    };
    rules.forEach(function (rule) {
      if (rule.event === 'idle') {
        var iv = setInterval(function () {
          var candidates = rule.pods || self.pods.map(function (q) { return q.id; });
          var idle = candidates.map(function (id) { return self.get(id); })
            .filter(function (q) { return q && q.state === 'idle'; });
          if (idle.length) fire(rule, { pod: (rule.actor || idle[0].id) });
        }, rule.everyMs || 20000);
        timers.push(iv);
      } else if (rule.event) {
        var h = function (e) {
          var d = e.detail || {};
          if (rule.pods && rule.pods.indexOf(d.pod) < 0) return;
          fire(rule, d);
        };
        self.on(rule.event, h);
        offs.push([rule.event, h]);
      } else if (rule.everyMs) {
        timers.push(setInterval(function () { fire(rule, null); }, rule.everyMs));
      }
    });
    this._script = { rules: rules, errors: errors,
      stop: function () {
        timers.forEach(clearInterval);
        offs.forEach(function (o) { self.off(o[0], o[1]); });
        self._script = null;
      } };
    this._emit('script', { rules: rules.length, errors: errors });
    return this._script;
  };

  /* ---------- targets & drag ---------- */
  PodPatrol.prototype.targets = function () {
    var rr = this.host.getBoundingClientRect(), self = this;
    return Array.prototype.filter.call(this.host.querySelectorAll('[' + this.targetAttr + ']'), function (e) {
      var b = e.getBoundingClientRect(), cy = b.top - rr.top + b.height / 2;
      return cy > 50 && cy < rr.height - 40 && !self.layer.contains(e);
    });
  };
  PodPatrol.prototype._label = function (el) {
    var src = el;
    if (el.children.length > 3 || el.clientHeight > 170) {
      var leaves = Array.prototype.filter.call(el.querySelectorAll('*'), function (n) {
        return n.children.length === 0 && (n.innerText || '').trim().length > 14;
      });
      if (leaves.length) src = leaves.reduce(function (a, b) {
        return (b.innerText || '').length > (a.innerText || '').length ? b : a;
      });
    }
    var t = (src.innerText || src.textContent || '').trim().replace(/\s+/g, ' ');
    return t.length > 44 ? t.slice(0, 44) + '\u2026' : t || 'this item';
  };

  PodPatrol.prototype._hidePods = function () {
    this.pods.forEach(function (p) { p.el.style.visibility = 'hidden'; });
  };
  PodPatrol.prototype._showPods = function () {
    this.pods.forEach(function (p) { p.el.style.visibility = ''; });
  };

  PodPatrol.prototype._dropAt = function (x, y, p) {
    this._hidePods();
    var el = document.elementFromPoint(x, y);
    this._showPods();
    if (!el || !this.host.contains(el)) return null;
    var hostTgt = el.closest('[' + this.targetAttr + ']');
    if (!hostTgt) {
      hostTgt = el.closest('div,section,article,li,p,td');
      if (!hostTgt || !this.host.contains(hostTgt)) return null;
      if ((hostTgt.innerText || '').trim().length < 8) return null;
      if (hostTgt.clientHeight > this.host.clientHeight * 0.6) return null;
      hostTgt.setAttribute(this.targetAttr, 'drop-' + p.id);
    }
    return { el: hostTgt, label: this._label(hostTgt) };
  };

  PodPatrol.prototype._grab = function (p, ev) {
    ev.preventDefault(); ev.stopPropagation();
    var rr = this.host.getBoundingClientRect(), self = this;
    var ox = ev.clientX - rr.left - p.x, oy = ev.clientY - rr.top - p.y;
    var sx = p.x, sy = p.y, moved = 0;
    p.dragging = true; p.el.style.zIndex = '80'; p.el.style.cursor = 'grabbing';
    function mark(el) {
      if (self._mk && self._mk !== el) { self._mk.style.outline = ''; self._mk.style.outlineOffset = ''; }
      self._mk = el || null;
      if (el) { el.style.outline = '1px dashed ' + p.color; el.style.outlineOffset = '3px'; }
    }
    function mv(e) {
      p.x = clamp(e.clientX - rr.left - ox, -22, rr.width - self.podSize + 22);
      p.y = clamp(e.clientY - rr.top - oy, 8, rr.height - 24);
      moved = Math.max(moved, Math.hypot(p.x - sx, p.y - sy));
      if (self.scroller) {
        var rs = self.scroller.getBoundingClientRect(), yy = e.clientY - rs.top;
        if (yy < 74) self.scroller.scrollTop -= Math.min(14, (74 - yy) * 0.35);
        else if (yy > rs.height - 74) self.scroller.scrollTop += Math.min(14, (yy - (rs.height - 74)) * 0.35);
      }
      if (moved > 7) { var d = self._dropAt(e.clientX, e.clientY, p); mark(d && d.el); }
    }
    function up(e) {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      p.dragging = false; p.el.style.zIndex = ''; p.el.style.cursor = 'grab'; mark(null);
      if (moved <= 7) { self._emit('tap', { pod: p.id, index: p.index, label: p.label, color: p.color }); return; }
      var d = self._dropAt(e.clientX, e.clientY, p);
      if (d) {
        p.targetEl = d.el; p.dropLabel = d.label;
        self._emit('drop', { pod: p.id, index: p.index, label: p.label, color: p.color,
          target: d.el, targetLabel: d.label });
        self._say(p, p.label + ' in position. What are my orders?');
      }
    }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  /* ---------- frame ---------- */
  PodPatrol.prototype._chatterTick = function () {
    /* deterministic: hold idle labels steady so recorded takes are comparable. */
    if (this.deterministic) return;
    this.pods.forEach(function (p) {
      if (!p.labelEl || p.state !== 'idle') return;
      p.labelEl.textContent = Math.random() < 0.35 ? pick(p.beats || [p.label]) : p.label;
    });
  };

  PodPatrol.prototype._tick = function () {
    var t = (performance.now() - this._t0) / 1000, rr = this.host.getBoundingClientRect(), self = this;
    var S = this.podSize;
    var cutPod = this.pods.filter(function (p) { return p.state === 'cutin'; })[0];
    var workPod = this.pods.filter(function (p) { return p.state === 'working'; })[0];
    var driver = cutPod || workPod;
    this._frame++;

    var beside = function (b, force) {
      var cx = b.left - rr.left + b.width / 2;
      var cy = b.top - rr.top + b.height / 2;
      if (force) cy = clamp(cy, 80, rr.height - 120);
      else if (cy < 58 || cy > rr.height - 60) return null;
      var side = cx > rr.width * 0.44 ? -1 : 1;
      return { ax: clamp(cx + side * (Math.min(b.width, 300) / 2 + 42), -8, rr.width - self.podSize + 8),
        ay: clamp(cy - self.podSize / 2, 52, rr.height - 60), cx: cx, cy: cy };
    };

    this.pods.forEach(function (p) {
      var ax = p.dock.x, ay = p.dock.y, active = !!p.thinking, tc = null;
      if (p.dragging) {
        p.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) scale(1.08)';
        p.el.style.opacity = '1'; p.el.style.filter = 'drop-shadow(0 3px 10px rgba(0,0,0,.35))';
        p.line.setAttribute('opacity', '0');
        return;
      }
      if (p.state !== 'idle' && p.targetEl && self.host.contains(p.targetEl)) {
        var b = p.targetEl.getBoundingClientRect();
        var rawCy = b.top - rr.top + b.height / 2;
        var offBand = rawCy < 58 || rawCy > rr.height - 60;
        var r = beside(b, p.state === 'cutin');
        if (r) { ax = r.ax; ay = r.ay; active = true; if (!offBand) tc = r; }
        /* A pod that needs to see something off-screen scrolls the host to it,
         * rather than giving up and going back to its dock. */
        if (offBand && self.scroller && driver === p) { active = true; self._drive(b); }
      }
      var dx = ax - p.x, dy = ay - p.y, dist = Math.hypot(dx, dy);
      var ease = dist > 90 ? 0.038 : dist > 14 ? 0.055 : 0.085;
      p.x += dx * ease; p.y += dy * ease;
      var bob = Math.sin(t * 0.55 + p.index * 2.1) * (dist < 3 ? 1.6 : 0);
      var dy2 = p.y + bob;

      if (tc && dist < 140) {
        p.line.setAttribute('x1', (p.x + self.podSize / 2).toFixed(1));
        p.line.setAttribute('y1', (dy2 + self.podSize / 2).toFixed(1));
        p.line.setAttribute('x2', tc.cx.toFixed(1));
        p.line.setAttribute('y2', tc.cy.toFixed(1));
        p.line.setAttribute('opacity', '.5');
      } else p.line.setAttribute('opacity', '0');

      p.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + dy2.toFixed(1) + 'px)' + (active ? ' scale(1.06)' : '');
      /* At rest they are nearly transparent — present, not competing with the
       * content. The moment one is tasked it comes up to full and gains a halo. */
      var rv = self.reveal;
      p.el.style.opacity = (active || rv) ? '1' : (p.dim ? (self.restOpacity * 0.6).toFixed(2) : String(self.restOpacity));
      p.el.style.filter = active ? 'drop-shadow(0 0 7px ' + p.color + '88)' : (rv ? 'drop-shadow(0 0 5px ' + p.color + '55)' : 'none');
      if (p.labelEl) {
        /* Anchor the label on whichever side has room for its full width, and
         * clamp it inside the host so nothing is cut off at an edge. */
        var lw = p.labelEl.offsetWidth || 160;
        var roomRight = rr.width - (p.x + S);
        if (roomRight >= lw + 12 || p.x < rr.width * 0.4) {
          p.labelEl.style.left = (S - 8) + 'px'; p.labelEl.style.right = 'auto';
          var over = (p.x + S - 8 + lw) - (rr.width - 6);
          if (over > 0) p.labelEl.style.left = (S - 8 - over) + 'px';
        } else {
          p.labelEl.style.right = (S - 8) + 'px'; p.labelEl.style.left = 'auto';
          var under = (p.x + 8) - lw - 6;
          if (under < 0) p.labelEl.style.right = (S - 8 + under) + 'px';
        }
        /* Working pods keep their label but on an opaque plate; idle chatter
         * yields entirely rather than sitting over someone's paragraph. */
        var speaking = p.state !== 'idle';
        p.labelEl.style.opacity = (speaking || rv) ? '1' : (p.labelDim ? '0' : '.5');
        if ((speaking || rv) && p.labelDim) {
          p.labelEl.style.background = self.labelBg || self.podBg;
          p.labelEl.style.boxShadow = '0 1px 6px rgba(0,0,0,.28)';
          p.labelEl.style.borderColor = p.color;
        } else {
          p.labelEl.style.background = self.podBg;
          p.labelEl.style.boxShadow = 'none';
          p.labelEl.style.borderColor = p.color + '3d';
        }
      }

      var C = 2 * Math.PI * (self.podSize * 0.327);
      if (p.state === 'cutin') {
        p.arc.setAttribute('stroke-dasharray', '2 4');
        p.arc.setAttribute('opacity', Math.random() < 0.3 ? '.3' : '1');
        p.arc.setAttribute('stroke-dashoffset', (t * 40 % 6).toFixed(1));
      } else if (p.state === 'blocked') {
        p.arc.setAttribute('stroke', '#ff5c5c');
        p.arc.setAttribute('stroke-dasharray', '4 6');
        p.arc.setAttribute('stroke-dashoffset', (t * 14 % 10).toFixed(1));
        p.arc.setAttribute('opacity', Math.sin(t * 5) > 0 ? '1' : '.25');
      } else if (p.thinking) {
        /* Thinking: fast counter-rotating dash, visibly not the same as working. */
        p.arc.setAttribute('stroke', p.color);
        p.arc.setAttribute('stroke-dasharray', '5 6');
        p.arc.setAttribute('opacity', '.9');
        p.arc.setAttribute('stroke-dashoffset', (-t * 26 % 11).toFixed(1));
      } else if (p.state === 'working' || p.state === 'self') {
        /* A live tool reports its own progress; a simulated one interpolates. */
        if (!p.live) p.progress = Math.min(1, p.progress + p.inc);
        p.arc.setAttribute('stroke', p.color);
        p.arc.setAttribute('stroke-dasharray', p.state === 'self' ? '3 5' : String(C.toFixed(1)));
        p.arc.setAttribute('opacity', p.state === 'self' ? '.55' : '1');
        p.arc.setAttribute('stroke-dashoffset', (C * (1 - p.progress)).toFixed(1));
        if (p.labelEl && self._frame % 18 === 0 && !p.live) {
          var info = self.verbs[p.verb] || self.verbs.VERIFY;
          p.labelEl.textContent = p.state === 'self' ? p._beat
            : (p.progress < 0.42 ? info.mid[0] : info.mid[1]) + ' \u00b7 ' + Math.round(p.progress * 100) + '%';
        }
        if (p.progress >= 1 && !p.live) { if (p.state === 'self') self._selfDone(p); else self._finish(p); }
      } else {
        p.arc.setAttribute('stroke', p.color);
        p.arc.setAttribute('stroke-dasharray', String(C.toFixed(1)));
        p.arc.setAttribute('opacity', '1');
        p.arc.setAttribute('stroke-dashoffset', (C * (1 - (Math.sin(t * 1.6 + p.index) * 0.06 + 0.08))).toFixed(1));
      }
    });

    this._drawSpot(rr);
    this._drawBolt(rr);
    this._drawBubbles(rr);
    this._drawTrail(rr);
    if (this._frame % 14 === 0) this._probe(rr);
  };

  /* ---------- trail: where a pod has been, and what happened there ---------- */
  PodPatrol.prototype._trailBubble = function (n) {
    this._tb = this._tb || [];
    while (this._tb.length <= n) {
      var d = document.createElement('div');
      d.setAttribute('data-trail-bubble', String(this._tb.length));
      d.style.cssText = 'position:absolute;left:0;top:0;max-width:224px;pointer-events:none;opacity:0;' +
        'padding:5px 9px;border-radius:4px;z-index:66;' +
        'font:400 10.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;' +
        'background:' + (this.labelBg || this.podBg) + ';box-shadow:0 2px 12px rgba(0,0,0,.24);' +
        'transition:opacity .18s ease';
      this.layer.appendChild(d);
      this._tb.push(d);
    }
    return this._tb[n];
  };

  PodPatrol.prototype._drawTrail = function (rr) {
    var show = this.trailShown, self = this, used = 0;
    this.pods.forEach(function (p) {
      var on = show === 'all' || show === p.id;
      if (!on) {
        if (p.trailPath.getAttribute('opacity') !== '0') {
          p.trailPath.setAttribute('opacity', '0');
          p.trailDots.setAttribute('opacity', '0');
          p.trailPath.setAttribute('d', '');
          while (p.trailDots.firstChild) p.trailDots.removeChild(p.trailDots.firstChild);
        }
        return;
      }
      /* Only stops whose element is still on the page and on screen can be drawn. */
      var stops = [];
      p.trail.forEach(function (e) {
        if (!e.el || !self.host.contains(e.el)) return;
        var b = e.el.getBoundingClientRect();
        var cy = b.top - rr.top + b.height / 2;
        if (cy < 40 || cy > rr.height - 24) return;
        stops.push({ e: e, x: b.left - rr.left + Math.min(b.width, 260) / 2, y: cy });
      });
      stops = stops.slice(-8);
      if (!stops.length) {
        p.trailPath.setAttribute('opacity', '0');
        p.trailDots.setAttribute('opacity', '0');
        return;
      }
      p.trailPath.setAttribute('d', 'M' + stops.map(function (s) {
        return s.x.toFixed(1) + ' ' + s.y.toFixed(1);
      }).join(' L'));
      p.trailPath.setAttribute('opacity', '.75');

      while (p.trailDots.firstChild) p.trailDots.removeChild(p.trailDots.firstChild);
      stops.forEach(function (s, k) {
        var last = k === stops.length - 1;
        p.trailDots.appendChild(svg('circle', { cx: s.x.toFixed(1), cy: s.y.toFixed(1),
          r: last ? 6 : 4, fill: last ? p.color : 'none', stroke: p.color, 'stroke-width': '1.5' }));
        if (last) p.trailDots.appendChild(svg('circle', { cx: s.x.toFixed(1), cy: s.y.toFixed(1),
          r: 11, fill: 'none', stroke: p.color, 'stroke-width': '1', 'stroke-dasharray': '3 4', opacity: '.6' }));
      });
      p.trailDots.setAttribute('opacity', '1');

      /* One summary bubble per stop, offset inboard, alternating side. */
      stops.forEach(function (s, k) {
        var b = self._trailBubble(used++);
        var e = s.e;
        var outcome = e.outcome === 'none' ? 'blocked' : e.outcome === 'partial' ? 'partial' : e.kind === 'cutin' ? 'interrupted' : 'done';
        b.innerHTML = '';
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600;letter-spacing:.06em;color:' + p.color;
        head.textContent = (k + 1) + ' \u00b7 ' + (e.verb || 'NOTE') + ' \u00b7 ' + outcome;
        var body = document.createElement('div');
        body.style.cssText = 'margin-top:3px;opacity:.78;white-space:normal';
        body.textContent = e.text.length > 92 ? e.text.slice(0, 92) + '\u2026' : e.text;
        b.appendChild(head); b.appendChild(body);
        b.style.borderLeft = '2px solid ' + p.color;
        var bw = b.offsetWidth || 200, bh = b.offsetHeight || 40;
        var side = s.x > rr.width * 0.5 ? -1 : 1;
        var bx = clamp(s.x + side * 18 - (side < 0 ? bw : 0), 8, Math.max(8, rr.width - bw - 8));
        var by = clamp(s.y - bh / 2 + (k % 2 ? 14 : -14), 40, Math.max(40, rr.height - bh - 14));
        b.style.transform = 'translate(' + bx.toFixed(1) + 'px,' + by.toFixed(1) + 'px)';
        b.style.opacity = '1';
      });
    });
    if (this._tb) for (var j = used; j < this._tb.length; j++) this._tb[j].style.opacity = '0';
  };

  /* On reveal, only pods that are actually hard to see get a bubble: one pinned
   * inside the visible area with its arrow aimed out at where the pod is. A pod
   * sitting in plain sight needs no signpost. */
  PodPatrol.prototype._drawBubbles = function (rr) {
    var on = !!this.reveal, S = this.podSize;
    /* Visible area = host box clipped by the window, in host coordinates. */
    var vis = {
      left: Math.max(0, -rr.left),
      top: Math.max(0, -rr.top),
      right: Math.min(rr.width, (window.innerWidth || rr.right) - rr.left),
      bottom: Math.min(rr.height, (window.innerHeight || rr.bottom) - rr.top)
    };
    for (var i = 0; i < this.pods.length; i++) {
      var p = this.pods[i], b = p.bubble;
      if (!b) continue;
      var vw = Math.max(0, Math.min(p.x + S, vis.right) - Math.max(p.x, vis.left));
      var vh = Math.max(0, Math.min(p.y + S, vis.bottom) - Math.max(p.y, vis.top));
      var seen = (vw * vh) / (S * S);
      if (!on || seen > 0.72) { if (b.style.opacity !== '0') b.style.opacity = '0'; continue; }
      var cx = p.x + S / 2, cy = p.y + S / 2;
      var bw = b.offsetWidth || 96, bh = b.offsetHeight || 24;
      /* Anchor on the edge of the visible area nearest the pod, then sit inboard. */
      var ax = clamp(cx, vis.left + 14, vis.right - 14);
      var ay = clamp(cy, vis.top + 14, vis.bottom - 14);
      var dx = cx - ax, dy = cy - ay;
      var bx = Math.abs(dx) < 1 ? ax - bw / 2 : (dx < 0 ? ax + 12 : ax - 12 - bw);
      var by = Math.abs(dy) < 1 ? ay - bh / 2 : (dy < 0 ? ay + 10 : ay - 10 - bh);
      bx = clamp(bx, vis.left + 10, Math.max(vis.left + 10, vis.right - bw - 10));
      by = clamp(by, vis.top + 10, Math.max(vis.top + 10, vis.bottom - bh - 12));
      b.style.transform = 'translate(' + bx.toFixed(1) + 'px,' + by.toFixed(1) + 'px)';
      b.style.opacity = '1';
      var ang = Math.atan2(cy - (by + bh / 2), cx - (bx + bw / 2)) * 180 / Math.PI;
      p.arrowEl.style.transform = 'rotate(' + ang.toFixed(1) + 'deg)';
      p.arrowEl.style.order = Math.abs(ang) > 90 ? '0' : '2';
    }
  };

  /* Programmatic equivalent of holding the reveal key — wire to a button for
   * hosts where the page may not own keyboard focus. */
  PodPatrol.prototype.setReveal = function (on) {
    if (this._setReveal) this._setReveal(!!on);
    else { this.reveal = !!on; this._emit('reveal', { on: !!on }); }
    return this;
  };

  PodPatrol.prototype.spotlight = function (target) { this._spotEl = this._resolve(target); };

  /* Eased, frame-by-frame scroll so it reads as a deliberate pull, not a jump.
   * Yields entirely for a few seconds after the user scrolls: an agent that
   * fights your wheel feels like losing control of the page. */
  PodPatrol.prototype._drive = function (rect, speed) {
    if (!this.scroller) return;
    if (this._userScrollUntil && performance.now() < this._userScrollUntil) return;
    var rs = this.scroller.getBoundingClientRect();
    var want = rect.top - rs.top + this.scroller.scrollTop - rs.height * 0.42;
    var cur = this.scroller.scrollTop;
    if (Math.abs(want - cur) > 3) this.scroller.scrollTop = cur + clamp((want - cur) * 0.055, -(speed || 9), speed || 9);
  };
  PodPatrol.prototype.yieldScroll = function (ms) {
    this._userScrollUntil = performance.now() + (ms == null ? 2600 : ms);
    return this;
  };

  /* Public: let a pod take the wheel and bring something into view. */
  PodPatrol.prototype.scrollTo = function (target, ms) {
    var el = this._resolve(target); if (!el || !this.scroller) return;
    var self = this, until = performance.now() + (ms || 1400);
    /* An explicit request overrides the user-scroll yield. */
    this._userScrollUntil = 0;
    clearInterval(this._driveTimer);
    this._driveTimer = setInterval(function () {
      if (performance.now() > until || !self.host.contains(el)) { clearInterval(self._driveTimer); return; }
      self._drive(el.getBoundingClientRect(), 12);
    }, 16);
  };

  PodPatrol.prototype._drawSpot = function (rr) {
    var el = this._spotEl;
    if (!el || !this.host.contains(el)) { this.spot.setAttribute('opacity', '0'); this.spotOuter.setAttribute('opacity', '0'); return; }
    var b = el.getBoundingClientRect(), cy = b.top - rr.top + b.height / 2;
    var ok = cy > 44 && cy < rr.height - 40;
    this.spot.setAttribute('opacity', ok ? '.8' : '0');
    this.spotOuter.setAttribute('opacity', ok ? '.5' : '0');
    if (!ok) return;
    var color = (this._spotPod || this.pods[0]).color;
    [[this.spot, 2], [this.spotOuter, 7]].forEach(function (pair) {
      pair[0].setAttribute('x', b.left - rr.left - pair[1]);
      pair[0].setAttribute('y', b.top - rr.top - pair[1]);
      pair[0].setAttribute('width', b.width + pair[1] * 2);
      pair[0].setAttribute('height', b.height + pair[1] * 2);
      pair[0].setAttribute('stroke', color);
    });
  };

  PodPatrol.prototype._drawBolt = function (rr) {
    var p = this.boltPod;
    var live = p && p.state === 'cutin' && performance.now() < this.boltUntil && p.targetEl && this.host.contains(p.targetEl);
    if (!live) {
      this.bolt.setAttribute('opacity', '0'); this.boltGlow.setAttribute('opacity', '0');
      if (this._bel) { this._bel.style.outline = ''; this._bel.style.outlineOffset = ''; this._bel = null; }
      return;
    }
    var b = p.targetEl.getBoundingClientRect();
    var y2 = clamp(b.top - rr.top + b.height / 2, 52, rr.height - 40);
    var x1 = p.x + this.podSize / 2, y1 = p.y + this.podSize / 2;
    var x2 = p.x < rr.width * 0.44 ? b.left - rr.left + 2 : b.left - rr.left + b.width - 2;
    var now = performance.now();
    if (now - this._boltRoll > 65) {
      this._boltRoll = now;
      var n = 7, pts = [[x1, y1]], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
      for (var k = 1; k < n; k++) {
        var f = k / n, jx = x1 + dx * f, jy = y1 + dy * f, off = (Math.random() - 0.5) * Math.min(26, L * 0.22);
        pts.push([jx + (-dy / L) * off, jy + (dx / L) * off]);
      }
      pts.push([x2, y2]);
      this._boltD = 'M' + pts.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' L');
    }
    this.bolt.setAttribute('d', this._boltD || '');
    this.bolt.setAttribute('opacity', Math.random() < 0.16 ? '.35' : '1');
    this.boltGlow.setAttribute('d', this._boltD || '');
    this.boltGlow.setAttribute('stroke', p.color);
    this.boltGlow.setAttribute('opacity', (0.35 + Math.random() * 0.3).toFixed(2));
    if (this._bel !== p.targetEl) {
      if (this._bel) { this._bel.style.outline = ''; this._bel.style.outlineOffset = ''; }
      this._bel = p.targetEl;
    }
    this._bel.style.outline = '1px solid ' + p.color;
    this._bel.style.outlineOffset = (2 + (Math.random() < 0.3 ? 1 : 0)) + 'px';
  };

  /* Rect intersection against text-bearing leaves. Point sampling with
   * elementFromPoint returns whichever wrapper is topmost and misses the text
   * laid out inside it, which is why labels used to sit on body copy. */
  PodPatrol.prototype._probe = function (rr) {
    var self = this, S = this.podSize;
    var scope = this.scroller || this.host;
    var nodes = scope.querySelectorAll('*'), leaves = [], i, n, t, b;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      if (n.children.length) continue;
      if (self.layer.contains(n)) continue;
      t = (n.textContent || '').trim();
      if (t.length < 3) continue;
      b = n.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      leaves.push(b);
    }
    var overlaps = function (box) {
      for (var k = 0; k < leaves.length; k++) {
        var q = leaves[k];
        if (box.right > q.left && box.left < q.right &&
            box.bottom > q.top && box.top < q.bottom) return true;
      }
      return false;
    };
    this.pods.forEach(function (p) {
      var pb = p.el.getBoundingClientRect();
      p.dim = overlaps({ left: pb.left + 9, right: pb.right - 9,
        top: pb.top + 9, bottom: pb.bottom - 9 });
      if (p.labelEl) {
        var lb = p.labelEl.getBoundingClientRect();
        p.labelDim = lb.width > 2 && overlaps(lb);
      }
    });
  };

  PodPatrol.prototype.destroy = function () {
    if (this.audio) this.audio.destroy();
    this.stopRun();
    if (this._depHook) {
      this.off('taskdone', this._depHook);
      this.off('taskskip', this._depHook);
      this.off('taskfail', this._depHook);
      this._depHook = null;
    }
    if (this._script) this._script.stop();
    clearInterval(this._driveTimer);
    cancelAnimationFrame(this._raf);
    clearInterval(this._beatTimer);
    clearInterval(this._chatter);
    if (this.scroller && this._yieldHook) {
      var yh = this._yieldHook, sc = this.scroller;
      ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'].forEach(function (ev) {
        sc.removeEventListener(ev, yh);
      });
      this._yieldHook = null;
    }
    window.removeEventListener('keydown', this._down, true);
    window.removeEventListener('keyup', this._up, true);
    document.removeEventListener('keydown', this._down, true);
    document.removeEventListener('keyup', this._up, true);
    window.removeEventListener('pointermove', this._sync, true);
    window.removeEventListener('pointerdown', this._sync, true);
    window.removeEventListener('blur', this._blur);
    document.removeEventListener('visibilitychange', this._blur);
    if (this.layer && this.layer.parentNode) this.layer.parentNode.removeChild(this.layer);
  };

  /* ---------- custom element ---------- */
  if (root.customElements && !root.customElements.get('pod-patrol')) {
    root.customElements.define('pod-patrol', class extends HTMLElement {
      connectedCallback() {
        if (this.squad) return;
        this.style.display = 'none';
        var host = this.parentElement || document.body;
        var scroller = this.getAttribute('scroller') ? host.querySelector(this.getAttribute('scroller')) : null;
        var pods = null;
        try { pods = this.getAttribute('pods') ? JSON.parse(this.getAttribute('pods')) : null; } catch (e) { pods = null; }
        var accent = this.getAttribute('accent');
        if (!pods && accent) pods = DEFAULT_PODS.map(function (p, i) {
          return Object.assign({}, p, i === 0 ? { color: accent } : {});
        });
        var self = this;
        this.squad = new PodPatrol({
          host: host, scroller: scroller, pods: pods,
          autonomy: this.getAttribute('autonomy') || 'quorum',
          podSize: Number(this.getAttribute('pod-size')) || 52,
          podBg: this.getAttribute('pod-bg') || undefined,
          labelBg: this.getAttribute('label-bg') || undefined,
          restOpacity: this.hasAttribute('rest-opacity') ? Number(this.getAttribute('rest-opacity')) : undefined,
          revealKey: this.hasAttribute('reveal-key') ? (this.getAttribute('reveal-key') || null) : undefined,
          targetAttr: this.getAttribute('target-attr') || undefined,
          labels: this.getAttribute('labels') !== 'off',
          audio: this.getAttribute('audio') !== 'off',
          voice: this.getAttribute('voice') !== 'off',
          volume: this.hasAttribute('volume') ? Number(this.getAttribute('volume')) : undefined
        });
        ['record', 'say', 'tap', 'drop', 'proposal', 'quorum', 'taskstart', 'taskdone', 'blocked', 'cutin', 'finding', 'vote', 'beat']
          .forEach(function (n) { self.squad.on(n, function (e) { self.dispatchEvent(new CustomEvent(n, { detail: e.detail, bubbles: true })); }); });
      }
      disconnectedCallback() { if (this.squad) { this.squad.destroy(); this.squad = null; } }
    });
  }

  root.PodPatrol = PodPatrol;
  root.PatrolAudio = PatrolAudio;
  root.PodPatrol.PatrolAudio = PatrolAudio;
  root.PodPatrol.DEFAULT_PODS = DEFAULT_PODS;
  root.PodPatrol.PERSONA = PERSONA;
  root.PodPatrol.looseJSON = looseJSON;
  root.PodPatrol.DEFAULT_VERBS = DEFAULT_VERBS;
  if (typeof module !== 'undefined' && module.exports) module.exports = { PodPatrol: PodPatrol, PatrolAudio: PatrolAudio };
})(typeof window !== 'undefined' ? window : this);
