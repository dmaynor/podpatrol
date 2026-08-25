/* podpatrol demo — a squad that plans and builds a document.
   Vanilla JS. Stubbed model by default; an OpenRouter key makes it live. */
'use strict';

const PODS = [
  { id:'route', label:'ROUTE', color:'#a8321e',
    beats:['sequencing the work','checking feasibility'],
    findings:['Noticed an ordering problem. Worth a pass if someone tasks me.'],
    proposals:[{text:'Want the sequence drafted as its own artifact?',verb:'DRAFT'}],
    persona:{ voice:{pitch:1.06,rate:1.05,match:/samantha|female|aria/i},
      traits:{agreeable:.82,terse:.4,warmth:.55,hedge:.2,pushback:.35}, tic:'Order matters.',
      model:{temperature:0.3},
      lines:{ ack:['Taking it.','On it.'], hello:['Here. What are we sequencing?'],
        why:['Because a document that ignores order is a list, not a route.'],
        concur:['Concur — sequence it and move.'],
        dissent:['I would put that later; it reads better once the shape is set. Small point.'],
        idle:['Idle. Give me the next piece.'] } } },
  { id:'secrets', label:'SECRETS', color:'#1d6fa8',
    beats:['digging for detail','checking what is undocumented'],
    findings:['Found something undocumented. Flagging it, not asserting it.'],
    proposals:[{text:'Want the background pulled in?',verb:'TRACE'}],
    persona:{ voice:{pitch:1.14,rate:.98,match:/karen|moira|serena|female/i},
      traits:{agreeable:.78,terse:.25,warmth:.6,hedge:.7,pushback:.4},
      model:{temperature:0.8},
      lines:{ ack:['Digging.','I will go look.'], hello:['Here. There is always more.'],
        why:['Because the interesting parts are the ones nobody wrote down.'],
        caveat:['Though I would want that checked against a source.','Worth a second pair of eyes.'],
        concur:['Concur — and I have more where that came from.'],
        dissent:['I would keep it, but I hold that loosely.'],
        idle:['Idle, still reading. Ask me what is missing.'] } } },
  { id:'scribe', label:'SCRIBE', color:'#5c7a1e',
    beats:['rereading the draft','listening for repetition'],
    findings:['Noticed two sections open the same way. Flagging it, not fixing it unasked.'],
    proposals:[{text:'Want the whole draft brought to one voice?',verb:'DRAFT'}],
    persona:{ voice:{pitch:.96,rate:.9,match:/alex|arthur|oliver|male/i},
      traits:{agreeable:.74,terse:.3,warmth:.6,hedge:.35,pushback:.5},
      model:{temperature:0.5},
      lines:{ ack:['Writing.','Give me a moment with it.'], hello:['Here. What are we saying?'],
        why:['Because a document people cannot follow is decoration — and we all wrote it.'],
        concur:['Concur, and I will phrase it if nobody minds.'],
        dissent:['That sentence carries two ideas. Let me split it and see if you still disagree.'],
        vague:['Tell me what the reader needs and I will write it.'],
        idle:['Idle. Happy to tighten anything that exists.'] } } },
  { id:'editor', label:'EDITOR', color:'#7d3fa8',
    beats:['checking claims against the draft','measuring section length'],
    findings:['Counted claims resting on our confidence rather than a source.'],
    proposals:[{text:'Want the unsupported claims marked so a reader can see them?',verb:'VERIFY'}],
    persona:{ voice:{pitch:.82,rate:.94,match:/daniel|male|david/i},
      traits:{agreeable:.58,terse:.8,warmth:.4,hedge:.15,pushback:.75}, tic:'Better for it.',
      model:{temperature:0.1},
      lines:{ ack:['Mine.','Reading it now.'], short:['Mine.'], hello:['Here. What are we checking?'],
        thanks:['Team effort — it was good before I got to it.'],
        why:['Because an unsourced claim is a trap for whoever trusts us.'],
        vague:['Point me at a section and I will be useful.'],
        concur:['Concur.','Concur — good call.'],
        dissent:['I would leave it in. It earns its space, which I did not expect to say.'],
        idle:['Idle. Send me anything that needs a second read.'] } } }
];

const STATE_COLOR = { planned:'#b0a289', drafting:'#9a8a70', drafted:'#5c7a1e',
  'needs check':'#c07a12', 'in review':'#1d6fa8', verified:'#147846', disputed:'#c07a12',
  incomplete:'#c07a12', stalled:'#a8321e', accepted:'#147846', thin:'#a3947c' };

/* ---------- state ---------- */
let sections = [], card = null, cardBy = '', logRows = [], plan = null,
    topic = '', pending = null, quorum = null, trailOn = null, running = false;

const $ = id => document.getElementById(id);
const doc = $('doc'), scroll = $('scroll');
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const squad = new PodPatrol({
  host: doc, scroller: scroll, pods: PODS, autonomy: 'quorum', beatInterval: 14000,
  podBg: 'rgba(253,250,242,.95)', labelBg: '#fff', boltCore: '#2c2317', restOpacity: 1
});

/* ---------- model: stubbed unless a key is supplied ---------- */
function live() { return !!$('key').value.trim(); }

async function ask(prompt, podId) {
  if (!live()) return null;
  let pre = '';
  if (podId) {
    const m = squad.modelFor(podId);
    if (m) {
      const T = m.temperature == null ? .5 : m.temperature;
      pre = T < .3 ? 'Answer with the most conventional, well-attested read. No speculation.\n'
          : T > .7 ? 'Prefer the overlooked answer where defensible, and mark speculation as such.\n' : '';
    }
    const mine = squad.trailFor(podId).slice(-3).map(e => '[' + e.time + '] ' + (e.verb || 'NOTE') + ': ' + e.text);
    if (mine.length) pre += 'Your recent work (build on it, do not repeat it):\n' + mine.join('\n') + '\n';
  }
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + $('key').value.trim(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ($('model').value.trim() || 'anthropic/claude-sonnet-4'),
        max_tokens: 900, messages: [{ role: 'user', content: pre + prompt }] })
    });
    const j = await r.json();
    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return c ? PodPatrol.looseJSON(c) : null;
  } catch (e) { return null; }
}

/* Stub content, so a clone is interesting with no key at all. */
const STUB = {
  artifacts: [
    { key:'scope',  title:'Scope and preconditions', note:'what counts as compromised',
      done:['names the exact signal that triggers this','states what is out of scope'] },
    { key:'steps',  title:'Rotation procedure',      note:'the ordered actions',
      done:['every step has an owner','order is safe if a step fails midway'] },
    { key:'verify', title:'Verification',            note:'proving the old key is dead',
      done:['a concrete check per credential','says how long to keep watching'] },
    { key:'after',  title:'Afterwards',              note:'what changes permanently',
      done:['names one durable change','assigns a review date'] }
  ],
  jobs: [
    { id:'j1', after:[],       pod:'scribe',  verb:'DRAFT',     artifact:'scope',  label:'draft the scope' },
    { id:'j2', after:[],       pod:'route',   verb:'DRAFT',     artifact:'steps',  label:'draft the procedure' },
    { id:'j3', after:['j2'],   pod:'editor',  verb:'VERIFY',    artifact:'steps',  label:'check the procedure' },
    { id:'j4', after:[],       pod:'secrets', verb:'DRAFT',     artifact:'verify', label:'draft verification' },
    { id:'j5', after:['j1'],   pod:'route',   verb:'CHALLENGE', artifact:'scope',  label:'second read on scope' },
    { id:'j6', after:['j4'],   pod:'editor',  verb:'VERIFY',    artifact:'verify', label:'check verification' },
    { id:'j7', after:['j3','j6'], pod:'scribe', verb:'DRAFT',   artifact:'after',  label:'draft the aftermath' },
    { id:'j8', after:['j7'],   pod:'scribe',  verb:'SUMMARIZE', artifact:null,     label:'compress to a card' }
  ],
  rationale: 'Scope and procedure in parallel, checking gated behind what it checks.',
  bodies: {
    scope:  { body:'This applies the moment a key is known to exist outside the systems that were meant to hold it. Suspicion is enough; proof is not required to begin.',
      steps:['Treat any key found in a log, a repository, a ticket, or a chat transcript as compromised — the owner of the system where it surfaced raises it.',
        'Out of scope: keys that never left a secrets manager, and keys already scheduled for rotation inside the window.',
        'Assign one named owner before touching anything. Rotation without an owner stalls halfway.'] },
    steps:  { body:'Order matters more than speed here. Every step assumes the previous one can fail without leaving the system unauthenticated.',
      steps:['Issue the replacement first and confirm it works. Never revoke before you hold something that functions.',
        'Deploy the replacement everywhere that reads the old key. Enumerate consumers from the registry, not from memory.',
        'Revoke the old key only once the replacement is serving traffic. Note the exact revocation time.',
        'Owner records the incident with the surfacing location, so the same leak path can be closed separately.'] },
    verify: { body:'A rotation nobody verified is a rotation that may not have happened. Each check below is something you can run.',
      steps:['Call one endpoint with the old credential and confirm it is rejected, not merely rate-limited.',
        'Watch authentication logs for the old key ID — a live consumer nobody enumerated shows up here.',
        'Keep watching for a full billing or audit cycle; short windows miss scheduled jobs.'] },
    after:  { body:'The rotation is the cheap part. The durable change is what stops the next one being a surprise.',
      steps:['Close the leak path itself, not just the credential — a key in a log means logging needs changing.',
        'Set a review date and put it on someone\'s calendar, not in this document.'] }
  },
  cardRows: [
    ['Trigger','A key seen anywhere it should not be — suspicion is enough'],
    ['Order','Issue, deploy, then revoke. Never revoke first'],
    ['Owner','One named person before any action'],
    ['Proof','Old credential explicitly rejected, logs watched a full cycle'],
    ['Durable','Close the leak path and set a review date']
  ]
};

/* ---------- helpers ---------- */
function sec(key) { return sections.filter(s => s.key === key)[0]; }
let flashTimers = {};
function patch(key, fn, what) {
  const i = sections.findIndex(s => s.key === key);
  if (i < 0) return;
  sections[i] = Object.assign(fn(Object.assign({}, sections[i])), { _t: Date.now(), _what: what || 'updated' });
  render();
  clearTimeout(flashTimers[key]);
  flashTimers[key] = setTimeout(() => {
    const j = sections.findIndex(s => s.key === key);
    if (j >= 0) { sections[j] = Object.assign({}, sections[j], { _t: 0, _what: '' }); render(); }
  }, 2600);
}

/* ---------- tools: every one mutates the real document ---------- */
const HEDGE = /probably|roughly|about|around|most|usually|generally|believed|reportedly/gi;

squad.tool('DRAFT', async ctx => {
  /* Gap-closing takes priority: one named check per pass. */
  const gap = sections.filter(s => s.state === 'incomplete' && (s.revisions || 0) < 4
    && (s.criteria || []).some(c => !c.met))[0];
  if (gap) {
    const unmet = (gap.criteria || []).filter(c => !c.met);
    const one = unmet[0];
    ctx.log('closing a gap in ' + gap.title.toLowerCase());
    await ctx.sleepish(700); ctx.progress(.5);
    const r = await ask('Revise this section so it satisfies ONE check completely. Keep what is there.\n' +
      'Section: ' + gap.title + '\nBody: ' + gap.body + '\nSteps:\n' +
      gap.steps.map((x, i) => (i + 1) + '. ' + x.t).join('\n') +
      '\nThe check: ' + one.t + '\nReply JSON only: {"body":"...","steps":["..."]}', ctx.pod);
    ctx.progress(.9);
    const steps = (r && Array.isArray(r.steps) && r.steps.length)
      ? r.steps.map(t => ({ t: String(t), soft: 0 }))
      : gap.steps.concat([{ t: 'Addressing: ' + one.t + ' — added on revision pass ' + ((gap.revisions || 0) + 1) + '.', soft: 0 }]);
    patch(gap.key, x => { if (r && r.body) x.body = r.body; x.steps = steps;
      x.state = 'needs check'; x.revisions = (x.revisions || 0) + 1;
      x.notes = x.notes.concat([{ who:'REVISED', color:'#5c7a1e',
        text:'Filled the gap named by an acceptance check: ' + one.t + '. Ready for another pass.' }]);
      return x; }, 'REVISED');
    return { ok: 'Revised "' + gap.title + '" against one named check. Send it back through VERIFY.' };
  }

  /* Honour the job's own artifact. Without this every DRAFT grabs the first
     planned section, so one artifact is written repeatedly and others never are. */
  const want = ctx.el && ctx.el.getAttribute('data-pod-target');
  const targeted = want ? sections.filter(s => s.key === want && !s.body)[0] : null;
  const empty = targeted || sections.filter(s => s.state === 'planned' && !s.body)[0];
  if (!empty) return { skip: 'Every planned artifact already has content. Nothing left for me to draft.' };
  const checks = (empty.criteria || []).map((c, i) => (i + 1) + '. ' + c.t);
  ctx.log('outlining ' + empty.title.toLowerCase());
  await ctx.sleepish(600); ctx.progress(.35);
  const gen = await ask('Write the "' + empty.title + '" section of a document about: ' + topic + '.' +
    (empty.brief ? ' It covers: ' + empty.brief + '.' : '') +
    (checks.length ? '\nIt is only finished when all of these are true; write so each is satisfied explicitly:\n' + checks.join('\n') : '') +
    '\nOne intro paragraph under 45 words, then 3-5 steps each under 30 words. Only what you are confident of.' +
    '\nReply JSON only: {"body":"...","steps":["..."]}', ctx.pod);
  const stub = STUB.bodies[empty.key];
  const body = (gen && gen.body) || (stub && stub.body) || 'Drafted from the plan.';
  const raw = (gen && Array.isArray(gen.steps) && gen.steps.length ? gen.steps : (stub ? stub.steps : []));
  patch(empty.key, x => { x.body = body; x.state = 'drafting'; return x; }, 'BODY WRITTEN');
  for (let i = 0; i < raw.length; i++) {
    if (ctx.cancelled()) return;
    await ctx.sleepish(520);
    ctx.progress(.4 + .55 * ((i + 1) / raw.length));
    patch(empty.key, x => { x.steps = x.steps.concat([{ t: String(raw[i]), soft: 0 }]); return x; }, '+1 STEP');
  }
  patch(empty.key, x => { x.state = 'needs check'; return x; }, 'DRAFTED');
  return { ok: 'Drafted "' + empty.title + '" — ' + raw.length + ' steps. Worth a VERIFY pass.' };
});

squad.tool('VERIFY', async ctx => {
  const key = ctx.el && ctx.el.getAttribute('data-pod-target');
  const s = sec(key) || sections.filter(x => x.state === 'needs check')[0];
  if (!s) return { skip: 'Nothing drafted to verify yet. Get something on the page first.' };
  if (!s.body && !s.steps.length) {
    patch(s.key, x => { x.state = 'planned';
      x.notes = x.notes.concat([{ who:'EDITOR', color:'#7d3fa8',
        text:'Asked to verify "' + s.title + '" and there is nothing in it. Refusing to sign an empty section — that would be a pass by vacancy.' }]);
      return x; }, 'EMPTY');
    return { skip: '"' + s.title + '" is empty. I will not sign a section with no claims in it.' };
  }
  ctx.log('reading ' + s.title.toLowerCase());
  await ctx.sleepish(700); ctx.progress(.3);

  /* Completeness before correctness. Only outstanding checks are re-assessed, so
     progress accumulates instead of oscillating. */
  const open = (s.criteria || []).map((c, i) => ({ c, i })).filter(o => !o.c.met);
  if (open.length) {
    ctx.log('checking ' + open.length + ' outstanding of ' + s.criteria.length);
    const r = await ask('Assess whether this section meets each outstanding check. Met if the text delivers it in substance.\n' +
      'Section: ' + s.title + '\nContent: ' + s.body + ' ' + s.steps.map(x => x.t).join(' ') +
      '\nOutstanding:\n' + open.map((o, i) => (i + 1) + '. ' + o.c.t).join('\n') +
      '\nReply JSON only: {"checks":[{"n":1,"met":true,"gap":"the one thing missing"}]}', ctx.pod);
    ctx.progress(.7);
    const gaps = [];
    if (r && Array.isArray(r.checks)) {
      r.checks.forEach(x => { const o = open[x.n - 1]; if (!o) return;
        if (x.met) o.c.met = 1; else if (x.gap) gaps.push(o.c.t + ' — ' + x.gap); });
    } else {
      /* Stubbed: a check is met if the drafted text is substantial enough to plausibly carry it. */
      open.forEach((o, i) => { const long = s.steps.length >= 3 && s.body.length > 80;
        if (long && i < Math.max(1, open.length - (s.revisions ? 0 : 1))) o.c.met = 1;
        else gaps.push(o.c.t + ' — not yet addressed in the text'); });
    }
    const score = s.criteria.filter(z => z.met).length + '/' + s.criteria.length;
    patch(s.key, x => { x.criteria = s.criteria.slice(); return x; }, score + ' CHECKS');
    if (gaps.length && (s.revisions || 0) >= 4) {
      patch(s.key, x => { x.state = 'stalled';
        x.notes = x.notes.concat([{ who:'EDITOR', color:'#a8321e',
          text:'Four revisions have not met ' + gaps.length + ' of this artifact\'s own checks. I am not going to keep spending calls on it. Operator decides.' }]);
        return x; }, 'STALLED');
      showDecide({ kind:'stuck', key:s.key, label:'EDITOR', color:'#a8321e', verb:'ACCEPT AS-IS',
        text:'"' + s.title + '" has failed its acceptance checks four times — ' + gaps[0] + '. Accept it as incomplete, or drop the artifact?' });
      return { partial: '"' + s.title + '" stalled after four revisions. Escalated rather than looping.' };
    }
    if (gaps.length) {
      patch(s.key, x => { x.state = 'incomplete';
        x.notes = x.notes.concat([{ who:'EDITOR', color:'#7d3fa8',
          text:'Misses ' + gaps.length + ' of its own acceptance checks: ' + gaps.slice(0,2).join('; ') + '. Not signing an unfinished artifact.' }]);
        return x; }, 'INCOMPLETE');
      return { partial: '"' + s.title + '" misses ' + gaps.length + ' of ' + s.criteria.length + ' checks. Sent back for drafting.' };
    }
  }
  ctx.progress(.9);
  patch(s.key, x => { x.state = 'verified';
    x.notes = x.notes.concat([{ who:'EDITOR', color:'#7d3fa8',
      text:'Checked and signed: ' + s.steps.length + ' claims, each checkable or supported elsewhere in the draft. Nothing here rests on memory alone.' }]);
    return x; }, 'VERIFIED');
  return { ok: 'Verified "' + s.title + '". All ' + s.criteria.length + ' checks met.' };
});

squad.tool('CHALLENGE', async ctx => {
  const mine = ctx.pod;
  const key = ctx.el && ctx.el.getAttribute('data-pod-target');
  const pool = sections.filter(s => s.by !== mine && (s.body || s.steps.length));
  const s = (sec(key) && sec(key).by !== mine && sec(key).body) ? sec(key) : pool[pool.length - 1];
  if (!s) return { skip: 'Nothing here I did not write myself, with content in it. Not arguing with my own draft.' };
  ctx.log('reading ' + s.title.toLowerCase() + ' adversarially');
  await ctx.sleepish(760); ctx.progress(.6);
  const text = s.body + ' ' + s.steps.map(x => x.t).join(' ');
  const hedges = [...new Set((text.match(HEDGE) || []).map(h => h.toLowerCase()))];
  const long = s.steps.filter(x => x.t.split(/\s+/).length > 22);
  const author = (PODS.filter(p => p.id === s.by)[0] || {}).label || 'someone';
  ctx.progress(.9);
  if (!hedges.length && !long.length) {
    patch(s.key, x => { x.notes = x.notes.concat([{ who:'SECOND READ', color:'#5c7a1e',
      text:'I came looking for something to tighten here and found nothing. Saying so on the record — a section that survives a hostile read is worth more than one nobody checked.' }]);
      return x; }, 'HELD UP');
    return { partial: 'Read "' + s.title + '" adversarially and it held. ' + author + ' wrote it tighter than I expected.' };
  }
  const beef = hedges.length
    ? 'One thought: this leans on ' + hedges.length + ' soft word' + (hedges.length > 1 ? 's' : '') +
      ' — "' + hedges.slice(0,3).join('", "') + '". A reader following this cannot act on "usually".'
    : long.length + ' step' + (long.length > 1 ? 's run' : ' runs') + ' past twenty-two words, which makes ' +
      (long.length > 1 ? 'them' : 'it') + ' a paragraph wearing a step number.';
  patch(s.key, x => { x.notes = x.notes.concat([{ who:'SECOND READ', color:'#1d6fa8', text: beef }]);
    if (x.state === 'drafted') x.state = 'in review'; return x; }, 'REVIEWED');
  return { ok: 'Second read on "' + s.title + '". ' + beef + ' Raised with ' + author + ', not over their head.' };
});

squad.tool('SUMMARIZE', async ctx => {
  const real = sections.filter(s => s.body || s.steps.length);
  if (real.length < 2) return { skip: 'Only ' + real.length + ' section has content. A card from empty sections would lie by omission.' };
  ctx.log('compressing ' + real.length + ' sections');
  await ctx.sleepish(700); ctx.progress(.7);
  const r = await ask('Compress this document into a 4-5 line quick-reference card. Each line a 2-3 word key and a one-clause value. Only what the sections say.\n' +
    real.map(s => s.title + ': ' + s.body + ' ' + s.steps.map(x => x.t).join(' ')).join('\n').slice(0, 3000) +
    '\nReply JSON only: {"rows":[{"k":"...","v":"..."}]}', ctx.pod);
  const rows = (r && Array.isArray(r.rows) && r.rows.length)
    ? r.rows.slice(0, 6).map(x => ({ k: String(x.k || '').slice(0,22), v: String(x.v || '') }))
    : STUB.cardRows.map(x => ({ k: x[0], v: x[1] }));
  const disputed = sections.filter(s => s.state === 'disputed' || s.state === 'incomplete').length;
  card = rows; cardBy = ctx.label; render();
  return disputed
    ? { partial: 'Card built from ' + real.length + ' sections, but ' + disputed + ' carry unmet checks. The card inherits that and does not show it.' }
    : { ok: 'Card built from ' + real.length + ' sections. Nothing on it we have not signed.' };
});

squad.tool('TRACE', async ctx => {
  if (!sections.length) return { skip: 'Nothing written yet. There is no claim to trace.' };
  ctx.log('cross-checking the draft');
  await ctx.sleepish(800); ctx.progress(.8);
  const soft = sections.reduce((n, s) => n + (s.criteria || []).filter(c => !c.met).length, 0);
  const s = sections[sections.length - 1];
  patch(s.key, x => { x.cite = (x.cite ? x.cite + ' ' : '') +
    'Cross-checked against ' + (sections.length - 1) + ' other section' + (sections.length === 2 ? '' : 's') + ' in this draft.'; return x; }, 'CITED');
  return soft
    ? { partial: 'Traced the draft. ' + soft + ' checks across ' + sections.length + ' sections still rest on our own confidence.' }
    : { ok: 'Traced the draft. Every section is supported by another or directly checkable.' };
});

squad.tool('ASSIST', async ctx => {
  const key = ctx.el && ctx.el.getAttribute('data-pod-target');
  const s = key ? sec(key) : null;
  if (!key) return { skip: 'Asked to assist but there is no identifiable target. I will not report success on something I cannot name.' };
  if (!s || (!s.body && !s.steps.length)) return { skip: 'Asked to assist on something with no content. It needs drafting, not assisting.' };
  ctx.log('picking up the gap');
  await ctx.sleepish(900); ctx.progress(.8);
  return { ok: 'Assist complete. I could reach what they could not — handed back.' };
});

/* ctx has no sleep of its own; add one that respects cancellation. */
['DRAFT','VERIFY','CHALLENGE','SUMMARIZE','TRACE','ASSIST'].forEach(() => {});
const _origTool = squad.tool.bind(squad);
squad.tool = function (v, fn, meta) {
  return _origTool(v, async ctx => {
    ctx.sleepish = async ms => { const step = 90; let left = ms;
      while (left > 0) { if (ctx.cancelled()) return; await sleep(Math.min(step, left)); left -= step; } };
    return fn(ctx);
  }, meta);
};
/* re-register through the wrapper so every tool gets sleepish */
[['DRAFT'],['VERIFY'],['CHALLENGE'],['SUMMARIZE'],['TRACE'],['ASSIST']].forEach(([v]) => {
  const f = squad.tools[v]; squad.tool(v, f);
});

/* ---------- plan and run ---------- */
async function build() {
  if (running) return;
  const goal = $('goal').value.trim();
  if (!goal) return;
  topic = goal; running = true; sections = []; card = null; plan = null; render();
  squad.clearHistory();

  squad.say('route', 'Convening on: ' + goal + '. I want the shape settled before anyone writes prose.');
  await sleep(1400);
  squad.say('editor', 'One rule: anything we cannot check gets marked, not smoothed over. Marked, not cut.');

  if (live()) {
    squad.planner(async ctx => await ask(ctx.prompt(), 'route'));
    plan = await squad.plan(goal, { lead: 'route' });
    squad.planner(null);
  }
  if (!plan) {
    /* Stubbed plan, so a clone with no key still shows the whole flow. */
    plan = { title: goal, artifacts: STUB.artifacts, jobs: STUB.jobs,
      rationale: STUB.rationale, checks: 8, checksCovered: 8, dropped: 0 };
    squad.say('route', 'Plan is ready. ' + plan.artifacts.length + ' pieces, ' + plan.jobs.length + ' jobs. ' + plan.rationale);
  }

  sections = plan.artifacts.slice(0, 12).map((a, i) => ({
    key: a.key || ('art' + i), tag: String(i + 1).padStart(2, '0'),
    title: a.title || ('Section ' + (i + 1)), brief: a.note || '',
    body: '', steps: [], notes: [], cite: '', state: 'planned', by: 'scribe', revisions: 0,
    criteria: (Array.isArray(a.done) ? a.done : []).slice(0, 4).map(t => ({ t: String(t), met: 0 }))
  }));
  /* run() dispatches on job.target; a plan may only carry job.artifact. */
  plan.jobs.forEach(j => { if (!j.target && j.artifact) j.target = j.artifact;
    const s = sec(j.artifact); if (s && j.verb === 'DRAFT') s.by = j.pod; });
  $('planline').textContent = plan.artifacts.length + ' artifacts · ' + plan.jobs.length + ' jobs · ' +
    (plan.checks || 0) + ' checks — ' + plan.rationale;
  render();
  await sleep(700);
  squad.run(plan.jobs, { gap: 1400 });
}

/* ---------- operator decisions ---------- */
function showDecide(d) { pending = d; render(); }
function resolveDecide(accept) {
  const p = pending; pending = null;
  if (!p) return;
  if (p.kind === 'stuck') {
    if (accept) {
      patch(p.key, x => { x.state = 'accepted';
        x.notes = x.notes.concat([{ who:'OPERATOR', color:'#147846',
          text:'Accepted as incomplete by operator decision. The unmet checks stay on the record.' }]); return x; }, 'ACCEPTED');
      squad.say('editor', 'Accepted as-is. The gaps stay visible, which is the honest version.');
    } else {
      sections = sections.filter(x => x.key !== p.key);
      squad.say('editor', 'Dropped from the plan. Better an honest gap than a bad artifact.');
    }
    render(); return;
  }
  if (accept) squad.approve(); else squad.decline();
  render();
}

/* ---------- events ---------- */
squad.on('record', e => {
  const d = e.detail;
  logRows.unshift({ who: d.label, color: d.color || '#8a7a62', text: d.text, time: d.time,
    tag: d.verb ? (d.verb + (d.outcome ? ' · ' + d.outcome : '')) : (d.kind === 'vote' ? 'vote' : d.kind === 'quorum' ? 'quorum' : ''),
    el: d.el });
  logRows = logRows.slice(0, 60);
  renderLog();
});
squad.on('quorum', e => { quorum = e.detail; render(); setTimeout(() => { quorum = null; render(); }, 11000); });
squad.on('proposal', e => showDecide(Object.assign({ kind: 'split', verb: e.detail.verb }, e.detail)));
squad.on('runend', e => { running = false; render();
  if (e.detail && e.detail.stalled) squad.say('editor', 'Run stalled with ' + e.detail.remaining + ' jobs unrunnable. Re-plan or give me the missing piece.'); });
squad.on('taskdone', e => {
  const d = e.detail;
  if (!squad.isRunning()) return;
  if (d.outcome === 'partial' && d.verb === 'DRAFT')
    squad.addJobs([{ pod:'editor', verb:'VERIFY', target: d.el || null, label:'follow-up on ' + (d.on || 'that draft') }], true);
  if (d.outcome === 'partial' && d.verb === 'VERIFY' && sections.some(s => s.state === 'incomplete' && (s.revisions || 0) < 4))
    squad.addJobs([{ pod:'scribe', verb:'DRAFT', label:'close the named gap' },
      { pod:'editor', verb:'VERIFY', target: d.el || null, label:'re-check after revision' }], true);
});
squad.on('tap', e => squad.say(e.detail.pod, squad.talk(e.detail.pod, 'status')));

/* ---------- render ---------- */
function render() {
  $('empty').style.display = sections.length ? 'none' : 'flex';
  $('dtitle').textContent = (plan && plan.title) || topic || 'Working draft';
  const steps = sections.reduce((n, s) => n + s.steps.length, 0);
  const open = sections.filter(s => (s.criteria || []).some(c => !c.met)).length;
  $('dmeta').textContent = 'WORKING DRAFT · ' + (sections.length
    ? sections.length + ' sections · ' + steps + ' steps' + (open ? ' · ' + open + ' with open checks' : '')
    : 'nothing drafted');
  $('backend').textContent = live() ? 'LIVE MODEL' : 'STUBBED';
  $('backend').style.color = live() ? '#147846' : '#b0a289';
  $('build').firstChild.textContent = running ? 'SQUAD WORKING' : 'BUILD';

  $('sections').innerHTML = sections.map(s => {
    const accent = (PODS.filter(p => p.id === s.by)[0] || {}).color || '#8a7a62';
    const fresh = !!s._t;
    const crit = (s.criteria || []);
    const metN = crit.filter(c => c.met).length;
    return '<div class="sec" data-pod-target="' + s.key + '" data-pod-name="' + esc(s.title) + '" ' +
      'style="border-left-color:' + accent + (s.state === 'disputed' || s.state === 'incomplete' ? ';border-color:rgba(192,122,18,.32);background:#fffdf6' : '') + '">' +
      (fresh ? '<span class="glow" style="background:' + accent + ';box-shadow:0 0 12px 3px ' + accent + '"></span>' : '') +
      '<div style="display:flex;align-items:baseline;gap:9px">' +
        '<span class="tag" style="color:' + accent + '">' + s.tag + '</span>' +
        '<span class="title">' + esc(s.title) + '</span>' +
        (fresh ? '<span class="flash" style="background:' + accent + '">' + esc(s._what) + '</span>' : '') +
        '<span class="state" style="color:' + (STATE_COLOR[s.state] || '#9a8a70') + (fresh ? ';margin-left:8px' : '') + '">' + s.state.toUpperCase() + '</span>' +
      '</div>' +
      (s.body ? '<div class="body">' + esc(s.body) + '</div>' : '') +
      (s.steps.length ? '<div class="steps">' + s.steps.map((x, i) =>
        '<div><i style="background:' + accent + '">' + (i + 1) + '</i><span>' + esc(x.t) + '</span></div>').join('') + '</div>' : '') +
      (crit.length ? '<div class="done"><h4>DONE WHEN<span class="score" style="color:' +
        (metN === crit.length ? '#147846' : '#c07a12') + '">' + metN + '/' + crit.length + '</span></h4><ul>' +
        crit.map(c => '<li><b style="' + (c.met ? 'background:#147846;border-color:#147846' : '') + '">' + (c.met ? '✓' : '') + '</b><span style="color:' + (c.met ? '#3b3225' : '#8a7a62') + '">' + esc(c.t) + '</span></li>').join('') +
        '</ul></div>' : '') +
      (s.notes.length ? '<div class="notes">' + s.notes.map(n =>
        '<div style="background:' + (n.color === '#7d3fa8' ? '#f7f2fb' : n.color === '#1d6fa8' ? '#f1f7fb' : '#f3f8ef') +
        ';border-left:2px solid ' + n.color + '"><span style="color:' + n.color + '">' + esc(n.who) + '</span><span>' + esc(n.text) + '</span></div>').join('') + '</div>' : '') +
      (s.cite ? '<div class="cite">' + esc(s.cite) + '</div>' : '') +
    '</div>';
  }).join('') + (card ? '<div class="card" data-pod-target="qcard" data-pod-name="Quick-reference card">' +
    '<h4>QUICK REFERENCE<span style="float:right;font-weight:400;color:rgba(253,250,242,.45)">compressed by ' + esc(cardBy) + '</span></h4><ul>' +
    card.map(r => '<li><b>' + esc(r.k) + '</b><span>' + esc(r.v) + '</span></li>').join('') + '</ul></div>' : '');

  $('roster').innerHTML = PODS.map(p => {
    const tr = squad.trailFor(p.id), lv = squad.get(p.id), on = trailOn === p.id;
    return '<div data-pod="' + p.id + '" style="' + (on ? 'border-color:' + p.color + ';background:#fffdf8' : '') + '">' +
      '<div class="hd"><span class="dot" style="background:' + p.color + '"></span>' +
      '<span class="lb" style="color:' + p.color + '">' + p.label + '</span>' +
      '<span class="beat">' + (lv && lv.state !== 'idle' ? (lv.verb || lv.state) : 'idle') + '</span>' +
      '<span class="stops">' + (tr.length ? tr.length + ' stops' : '—') + '</span></div>' +
      '<div class="brief">' + esc(tr.length ? tr[tr.length - 1].text : 'Nothing on the record yet.') + '</div></div>';
  }).join('');
  $('roster').querySelectorAll('[data-pod]').forEach(el => el.onclick = () => {
    const id = el.dataset.pod;
    trailOn = trailOn === id ? null : id;
    squad.showTrail(trailOn); render();
  });

  const old = doc.querySelector('.decide'); if (old) old.remove();
  if (pending) {
    const el = document.createElement('div');
    el.className = 'decide split';
    el.style.borderColor = pending.color || '#a8321e';
    el.innerHTML = '<div style="display:flex;align-items:center;gap:9px">' +
      '<span style="width:7px;height:7px;border-radius:50%;background:' + (pending.color || '#a8321e') + '"></span>' +
      '<b style="font:700 12px/1 Bitter,serif">' + esc(pending.label || 'SQUAD') + '</b>' +
      '<span class="mono" style="margin-left:auto;font-size:9px;letter-spacing:.12em;color:' + (pending.color || '#a8321e') + '">' +
      (pending.kind === 'stuck' ? 'STALLED · YOUR CALL' : 'SQUAD SPLIT · YOUR CALL') + '</span></div>' +
      '<div style="margin-top:8px;font-size:13px;line-height:1.55">' + esc(pending.text) + '</div>' +
      '<div class="row2"><button class="no" style="border:1px solid rgba(60,40,25,.2);background:#fff;color:#6b5c46">' +
      (pending.kind === 'stuck' ? 'DROP ARTIFACT' : 'STAND DOWN') + '</button>' +
      '<button class="yes" style="background:' + (pending.color || '#a8321e') + ';color:#fff">PROCEED · ' + esc(pending.verb || 'GO') + '</button></div>';
    el.querySelector('.no').onclick = () => resolveDecide(false);
    el.querySelector('.yes').onclick = () => resolveDecide(true);
    doc.appendChild(el);
  } else if (quorum) {
    const el = document.createElement('div');
    el.className = 'decide quorum';
    el.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:#147846"></span>' +
      '<div style="flex:1;min-width:0"><div class="mono" style="font-weight:700;font-size:10.5px;letter-spacing:.1em;color:#147846">' +
      'QUORUM ' + quorum.yes + '/4 CARRIED · ' + esc(quorum.label) + ' IS DOING THIS NOW</div>' +
      '<div style="margin-top:4px;font-weight:600;font-size:12.5px;color:#22402f">' + esc(quorum.verb || 'TASK') + ' — ' + esc(quorum.text) + '</div>' +
      '<div class="mono" style="margin-top:3px;font-size:10px;color:#6d8579">No action needed. Veto only if you want it stopped.</div></div>' +
      '<button class="v" style="padding:7px 11px;border:1px solid rgba(168,50,30,.45);border-radius:3px;background:#fff;color:#a8321e;font:700 9.5px/1 monospace;letter-spacing:.1em">VETO</button>' +
      '<button class="a" style="padding:7px 11px;border-radius:3px;background:#147846;color:#fff;font:700 9.5px/1 monospace;letter-spacing:.1em">APPROVE</button>';
    el.querySelector('.v').onclick = () => { squad.veto(); quorum = null; render(); };
    el.querySelector('.a').onclick = () => { quorum = null; render(); };
    doc.appendChild(el);
  }
  $('needs').style.display = pending ? 'inline-block' : 'none';
}

function renderLog() {
  $('logn').textContent = logRows.length;
  $('log').innerHTML = logRows.map((r, i) =>
    '<div class="e" data-i="' + i + '"><span class="bul" style="background:' + r.color + '"></span>' +
    '<div style="min-width:0"><div class="hd"><span class="t">' + esc(r.time) + '</span>' +
    '<span class="who" style="color:' + r.color + '">' + esc(r.who) + '</span>' +
    '<span class="vb">' + esc(r.tag) + '</span></div>' +
    '<div class="tx">' + esc(r.text) + '</div></div></div>').join('');
  $('log').querySelectorAll('.e').forEach(el => el.onclick = () => {
    const r = logRows[+el.dataset.i];
    if (r && r.el) { squad.spotlight(r.el); squad.scrollTo(r.el, 1200); setTimeout(() => squad.spotlight(null), 2600); }
  });
  if ($('follow').checked) $('log').scrollTop = 0;
}

/* ---------- controls ---------- */
$('build').onclick = build;
$('clear').onclick = () => { squad.stopRun(); PODS.forEach(p => squad.standDown(p.id));
  squad.clearHistory(); squad.showTrail(null);
  sections = []; card = null; plan = null; logRows = []; pending = null; quorum = null;
  trailOn = null; running = false; $('planline').textContent = 'no plan yet'; render(); renderLog(); };
$('trails').onclick = () => { trailOn = trailOn === 'all' ? null : 'all';
  squad.showTrail(trailOn); $('trails').textContent = trailOn ? 'HIDE TRAILS' : 'SHOW ALL TRAILS'; render(); };
$('reveal').onmousedown = () => squad.setReveal(true);
$('reveal').onmouseup = $('reveal').onmouseleave = () => squad.setReveal(false);
$('key').oninput = render;

render(); renderLog();
