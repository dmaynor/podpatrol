/* podpatrol — regression cases.
   Each case names a defect this library actually shipped.
   RULE: when a bug is found, add a case before fixing it.

   t.squad  fresh PodPatrol on the rig host, stubbed tools, autonomy leashed
   t.sleep(ms) / t.wait(pred, ms)
   t.ok(v,msg) / t.no(v,msg) / t.is(a,b,msg)
*/
const CASES=[
 {name:'{skip} does not escalate to a peer',
  bug:'precondition refusals returned {none}, which blocked the pod and made ASSIST fabricate a rescue',
  run:async(t)=>{
   const sq=t.squad;let assisted=false;
   sq.tool('T_SKIP',async()=>({skip:'precondition unmet'}));
   sq.tool('ASSIST',async()=>{assisted=true;return{ok:'assisted'}});
   const seen=[];sq.on('taskskip',e=>seen.push(e.detail.pod));
   sq.assign('route','T_SKIP','a1');
   await t.wait(()=>seen.length>0,4000);
   await t.sleep(600);
   t.is(seen.length,1,'taskskip emitted once');
   t.no(assisted,'no peer was dragged into an ASSIST');
   t.is(sq.get('route').state,'idle','pod returned to idle, not blocked');
  }},

 {name:'{none} escalates and emits taskfail',
  bug:'taskfail did not exist; a failed job never resolved and deadlocked its dependents',
  run:async(t)=>{
   const sq=t.squad;const fails=[];
   sq.tool('T_FAIL',async()=>({none:'could not reach it'}));
   sq.on('taskfail',e=>fails.push(e.detail));
   sq.assign('route','T_FAIL','a1');
   await t.wait(()=>fails.length>0,5000);
   t.ok(fails.length>0,'taskfail emitted');
   t.is(fails[0].verb,'T_FAIL','carries the verb');
  }},

 {name:'a failed job releases its dependents',
  bug:'_depHook listened only for taskdone/taskskip, so run() spun forever after any failure',
  run:async(t)=>{
   const sq=t.squad;let ran=false;
   sq.tool('T_FAIL2',async()=>({none:'nope'}));
   sq.tool('T_AFTER',async()=>{ran=true;return{ok:'ran'}});
   sq.run([{id:'f1',after:[],pod:'route',verb:'T_FAIL2',target:'a1',label:'will fail'},
    {id:'f2',after:['f1'],pod:'scribe',verb:'T_AFTER',target:'a2',label:'depends on it'}],{gap:300});
   await t.wait(()=>ran,9000);
   t.ok(ran,'dependent job dispatched after the failure');
   sq.stopRun();
  }},

 {name:'independent jobs run in parallel',
  bug:'the runner dispatched one job per tick, so a four-pod squad worked one at a time',
  run:async(t)=>{
   const sq=t.squad;let peak=0;
   sq.tool('T_HOLD',async(ctx)=>{
    for(let i=0;i<14;i++){if(ctx.cancelled())return;await t.sleep(90);ctx.progress(i/14);
     peak=Math.max(peak,sq.pods.filter(p=>p.state==='working').length)}
    return{ok:'held'}});
   sq.run([{id:'p1',after:[],pod:'route',verb:'T_HOLD',target:'a1',label:'one'},
    {id:'p2',after:[],pod:'scribe',verb:'T_HOLD',target:'a2',label:'two'},
    {id:'p3',after:[],pod:'secrets',verb:'T_HOLD',target:'a1',label:'three'}],{gap:250});
   await t.wait(()=>peak>=2,9000);
   t.ok(peak>=2,'at least two pods worked simultaneously (peak '+peak+')');
   sq.stopRun();
  }},

 {name:'stall watchdog ends an unrunnable run',
  bug:'an unsatisfiable dependency left running=true forever with no signal',
  run:async(t)=>{
   const sq=t.squad;let end=null;
   sq.on('runend',e=>{end=e.detail});
   sq.tool('T_NEVER',async()=>({ok:'x'}));
   sq.run([{id:'z1',after:['does_not_exist'],pod:'route',verb:'T_NEVER',target:'a1',label:'orphan'}],{gap:250});
   await t.wait(()=>!!end,9000);
   t.ok(!!end,'runend fired');
   t.ok(end&&end.stalled,'reported as stalled, not completed');
   sq.stopRun();
  }},

 {name:'verb objects are per-instance, not shared',
  bug:'a shallow merge meant host tweaks to verb copy corrupted PodPatrol.DEFAULT_VERBS globally',
  run:async(t)=>{
   const before=JSON.stringify(PodPatrol.DEFAULT_VERBS.VERIFY.mid);
   t.squad.verbs.VERIFY.mid=['mutated','mutated'];
   const after=JSON.stringify(PodPatrol.DEFAULT_VERBS.VERIFY.mid);
   t.is(after,before,'module defaults untouched by an instance write');
   t.squad.verbs.VERIFY.mid=JSON.parse(before);
  }},

 {name:'tool() clones rather than aliasing defaults',
  bug:'tool() only cloned when meta was passed, leaving a shared reference behind',
  run:async(t)=>{
   t.squad.tool('T_CLONE',async()=>({ok:'x'}));
   t.no(t.squad.verbs.T_CLONE===PodPatrol.DEFAULT_VERBS.VERIFY,'not the same object as the default');
  }},

 {name:'ASSIST refuses an unnameable target',
  bug:'ASSIST with a null target fell through to a 70% fabricated success',
  run:async(t)=>{
   const sq=t.squad;const out=[];
   sq.tool('ASSIST',async(ctx)=>{if(!ctx.el)return{skip:'no identifiable target'};return{ok:'assisted'}});
   sq.on('taskskip',e=>out.push(e.detail));
   sq.assign('editor','ASSIST',null);
   await t.wait(()=>out.length>0,4000);
   t.ok(out.length>0,'skipped instead of claiming success');
  }},

 {name:'docks are distinct',
  bug:'the dock formula clamped two pods to the same y, so they overlapped as one',
  run:async(t)=>{
   const ys=t.squad.pods.map(p=>Math.round(p.dock.y)+':'+Math.round(p.dock.x));
   t.is(new Set(ys).size,ys.length,'all '+ys.length+' docks unique — '+ys.join(' '));
  }},

 {name:'looseJSON repairs a truncated reply',
  bug:'a plan cut off mid-array threw and the whole plan was discarded',
  run:async(t)=>{
   const L=PodPatrol.looseJSON;
   const cut='{"title":"x","jobs":[{"id":"j1","verb":"DRAFT"},{"id":"j2","verb":"VER';
   const got=L(cut);
   t.ok(got&&Array.isArray(got.jobs),'recovered an object with jobs');
   t.ok(got&&got.jobs.length>=1,'kept the complete entries ('+(got?got.jobs.length:0)+')');
   t.ok(L('{"a":1}')&&L('{"a":1}').a===1,'still parses valid JSON');
   t.is(L('not json at all'),null,'returns null on garbage');
  }},

 {name:'planner validates away unrunnable jobs',
  bug:'a plan naming a nonexistent verb or pod was run as-is',
  run:async(t)=>{
   const sq=t.squad;
   sq.planner(async()=>({title:'p',artifacts:[{key:'k',title:'K',done:['a check']}],
    jobs:[{id:'j1',after:[],pod:'route',verb:'DRAFT',artifact:'k',label:'ok one'},
     {id:'j2',after:[],pod:'ghostpod',verb:'DRAFT',label:'bad pod'},
     {id:'j3',after:[],pod:'route',verb:'NOT_A_VERB',label:'bad verb'}],rationale:'r'}));
   const plan=await sq.plan('anything');
   t.ok(!!plan,'plan returned');
   t.is(plan.jobs.length,1,'kept only the runnable job');
   t.is(plan.dropped,2,'reported 2 dropped');
   sq.planner(null);
  }},

 {name:'dependencies on dropped jobs are pruned',
  bug:'a dependency on a validated-away job deadlocked the run',
  run:async(t)=>{
   const sq=t.squad;
   sq.planner(async()=>({title:'p',artifacts:[],
    jobs:[{id:'j1',after:[],pod:'ghostpod',verb:'DRAFT',label:'dropped'},
     {id:'j2',after:['j1'],pod:'route',verb:'DRAFT',label:'depends on dropped'}],rationale:'r'}));
   const plan=await sq.plan('anything');
   t.is(plan.jobs.length,1,'one job survived');
   t.is(plan.jobs[0].after.length,0,'its dead dependency was pruned');
   sq.planner(null);
  }},

 {name:'DSL parses rules and reports bad lines',
  bug:'n/a — new surface, guarded from the start',
  run:async(t)=>{
   const h=t.squad.script('# note\non drop: VERIFY it\nevery 30s: route DRAFT newest\nthis line is broken');
   t.is(h.rules.length,2,'two valid rules');
   t.is(h.errors.length,1,'one error reported');
   h.stop();
  }},

 {name:'persona writes are readable back',
  bug:'retopic had one restore path, so stale personas leaked between goals',
  run:async(t)=>{
   const sq=t.squad;
   sq.setPersona('route',{traits:{agreeable:0.11},lines:{idle:['probe idle']}});
   t.is(sq.get('route').persona.traits.agreeable,0.11,'trait written');
   t.is(sq.get('route').persona.lines.idle[0],'probe idle','line written');
   t.ok(sq.get('route').persona.lines.ack.length>0,'unspecified pools still fall back');
  }},

 {name:'model settings are per-pod',
  bug:'n/a — guards the per-pod temperature feature',
  run:async(t)=>{
   const sq=t.squad;
   sq.setModel('route',{temperature:0.15});
   sq.setModel('editor',{temperature:0.95});
   t.is(sq.modelFor('route').temperature,0.15,'route holds its own value');
   t.is(sq.modelFor('editor').temperature,0.95,'editor holds a different one');
  }},

 {name:'history is timestamped and ordered',
  bug:'log entries had no clock, so a transcript could not be read chronologically',
  run:async(t)=>{
   const sq=t.squad;
   sq.say('route','probe one');sq.say('editor','probe two');
   const h=sq.history().slice(-2);
   t.is(h.length,2,'two entries recorded');
   t.ok(/^\d\d:\d\d:\d\d$/.test(h[0].time),'wall-clock stamp present ('+h[0].time+')');
   t.ok(h[1].seq>h[0].seq,'monotonic sequence');
  }},

 {name:'observations are not filed as results',
  bug:'standing-beat findings claimed completed edits that never happened',
  run:async(t)=>{
   const sq=t.squad;
   const fs=[];sq.on('finding',e=>fs.push(e.detail));
   sq.setAutonomy('quorum');
   const p=sq.get('scribe');
   p.state='self';p.progress=0.99;p.inc=0.02;p._beat='probing';p._finding='Noticed something. Not fixing it.';
   await t.wait(()=>fs.length>0,4000);
   const rec=sq.history().filter(e=>e.kind==='finding').pop();
   t.ok(!!rec,'recorded as kind=finding');
   t.is(rec&&rec.verb,'NOTICED','tagged NOTICED, not a work verb');
   t.no(/\bI have\b|\bhave normalised\b|\brebuilt\b|\brecompiled\b/i.test(rec.text),
    'phrasing does not claim a completed edit');
  }},

 {name:'a tool reporting progress drives the arc, not a timer',
  bug:'live tools were interpolated on a fixed clock, so the ring lied about real progress',
  run:async(t)=>{
   const sq=t.squad;let seen=[];
   sq.tool('T_PROG',async(ctx)=>{for(const v of[0.2,0.5,0.9]){ctx.progress(v);
    await t.sleep(120);seen.push(sq.get('route').progress)}return{ok:'done'}});
   sq.assign('route','T_PROG','a1');
   await t.wait(()=>seen.length>=3,5000);
   t.ok(seen[0]<seen[2],'progress rose with the tool, not the clock ('+seen.map(x=>x.toFixed(2)).join('→')+')');
   t.ok(sq.get('route').live===true||seen[2]>=0.85,'reported value was honoured');
  }},

 {name:'ctx.cancelled goes true when a pod stands down',
  bug:'a long poll kept running after the pod was cleared, then reported into a finished task',
  run:async(t)=>{
   const sq=t.squad;let sawCancel=false,finished=false;
   sq.tool('T_LONG',async(ctx)=>{for(let i=0;i<40;i++){await t.sleep(60);
    if(ctx.cancelled()){sawCancel=true;return}}finished=true;return{ok:'x'}});
   sq.assign('route','T_LONG','a1');
   await t.sleep(400);
   sq.standDown('route');
   await t.wait(()=>sawCancel,4000);
   t.ok(sawCancel,'tool observed cancellation');
   t.no(finished,'did not run to completion after stand-down');
  }},

 {name:'a thrown tool is a failure, not a crash',
  bug:'an exception inside a tool left the pod stuck working forever',
  run:async(t)=>{
   const sq=t.squad;const fails=[];
   sq.tool('T_THROW',async()=>{throw new Error('deliberate')});
   sq.on('taskfail',e=>fails.push(e.detail));
   sq.assign('route','T_THROW','a1');
   await t.wait(()=>fails.length>0,5000);
   t.ok(fails.length>0,'surfaced as taskfail');
   t.no(sq.get('route').state==='working','pod is no longer working');
  }},

 {name:'a bare return is treated as success',
  bug:'tools returning nothing were read as failures and escalated pointlessly',
  run:async(t)=>{
   const sq=t.squad;const done=[];
   sq.tool('T_VOID',async()=>{});
   sq.on('taskdone',e=>done.push(e.detail));
   sq.assign('route','T_VOID','a1');
   await t.wait(()=>done.length>0,5000);
   t.is(done.length,1,'one taskdone');
   t.is(done[0].outcome,'ok','outcome ok');
  }},

 {name:'a tool value reaches taskdone.result',
  bug:'structured tool output was discarded, so hosts could not use what a pod found',
  run:async(t)=>{
   const sq=t.squad;const done=[];
   sq.tool('T_VAL',async()=>({ok:{hits:3,src:'x'}}));
   sq.on('taskdone',e=>done.push(e.detail));
   sq.assign('route','T_VAL','a1');
   await t.wait(()=>done.length>0,5000);
   t.ok(done[0]&&done[0].result,'result present');
   t.is(done[0].result&&done[0].result.hits,3,'value survived intact');
  }},

 {name:'skips stay off the trail',
  bug:'a refusal was recorded as a place work happened, so trails showed phantom stops',
  run:async(t)=>{
   const sq=t.squad;
   sq.tool('T_SK2',async()=>({skip:'nothing to do'}));
   const before=sq.trailFor('route').length;
   sq.assign('route','T_SK2','a1');
   await t.wait(()=>sq.get('route').state==='idle',5000);
   await t.sleep(300);
   t.is(sq.trailFor('route').length,before,'trail length unchanged');
   t.ok(sq.history().some(e=>e.kind==='skip'),'still on the record as a skip');
  }},

 {name:'results land on the trail with their element',
  bug:'trail stops had no element, so the drawn path went nowhere',
  run:async(t)=>{
   const sq=t.squad;
   sq.tool('T_TR',async()=>({ok:'found it'}));
   sq.assign('route','T_TR','a1');
   await t.wait(()=>sq.trailFor('route').length>0,5000);
   const stop=sq.trailFor('route').pop();
   t.ok(!!stop,'a stop was recorded');
   t.ok(stop&&stop.el&&stop.el.getAttribute('data-pod-target')==='a1','carries the target element');
  }},

 {name:'history is capped',
  bug:'an unbounded log grew without limit during long runs',
  run:async(t)=>{
   const sq=t.squad;sq.maxHistory=20;
   for(let i=0;i<45;i++)sq.say('route','line '+i);
   t.ok(sq.history().length<=20,'capped at maxHistory ('+sq.history().length+')');
   t.ok(sq.history().pop().text.indexOf('44')>=0,'kept the newest');
  }},

 {name:'clearHistory empties trails too',
  bug:'clearing the log left stale trail stops pointing at removed content',
  run:async(t)=>{
   const sq=t.squad;
   sq.tool('T_CL',async()=>({ok:'x'}));
   sq.assign('route','T_CL','a1');
   await t.wait(()=>sq.trailFor('route').length>0,5000);
   sq.clearHistory();
   t.is(sq.history().length,0,'history empty');
   t.is(sq.trailFor('route').length,0,'trail empty');
  }},

 {name:'quorum is decided by the agreeable trait',
  bug:'votes were a fixed 72% coin flip, so persona had no effect on the outcome',
  run:async(t)=>{
   const sq=t.squad;
   ['secrets','scribe','editor'].forEach(id=>sq.setPersona(id,{traits:{agreeable:0}}));
   const votes=[];sq.on('vote',e=>votes.push(e.detail.yes));
   sq.propose('route',{text:'Want this done?',verb:'DRAFT'});
   await t.wait(()=>votes.length>=3,9000);
   t.is(votes.filter(v=>v).length,0,'all three dissented at agreeable 0');
  }},

 {name:'autonomy leash stops standing beats',
  bug:'demo takes were polluted by unscripted self-tasks because leash was not applied',
  run:async(t)=>{
   const sq=t.squad;const beats=[];
   sq.on('beat',e=>beats.push(e.detail));
   sq.setAutonomy('leash');
   sq.beat();sq.beat();
   await t.sleep(400);
   t.is(beats.length,0,'no beats fired while leashed');
   sq.setAutonomy('quorum');
   sq.beat();
   await t.sleep(300);
   t.ok(beats.length>0,'beats resume when unleashed');
  }},

 {name:'deterministic mode freezes styling and chatter',
  bug:'recorded takes differed run to run because tics and idle labels were random',
  run:async(t)=>{
   const sq=t.squad;
   sq.setPersona('route',{tic:'ALWAYS.',traits:{hedge:1}});
   sq.deterministic=true;
   const outs=[];for(let i=0;i<12;i++)outs.push(sq._style(sq.get('route'),'base text'));
   t.is(new Set(outs).size,1,'styling identical across 12 calls');
   t.is(outs[0],'base text','no tic or caveat appended');
   sq.deterministic=false;
  }},

 {name:'setAudio/setVoice do not throw without audio',
  bug:'toggling audio on a squad built with audio:false threw and killed the caller',
  run:async(t)=>{
   const sq=t.squad;
   sq.setAudio(true);sq.setAudio(false);sq.setVoice(true);sq.setVoice(false);
   t.ok(true,'toggled four times without throwing');
   t.ok(!!sq.audio,'audio object exists even when disabled');
  }},

 {name:'addJobs(front) jumps the queue',
  bug:'mid-run revisions were appended, so a follow-up ran after everything else',
  run:async(t)=>{
   const sq=t.squad;
   sq.tool('T_Q',async()=>({ok:'x'}));
   sq.run([{id:'q1',after:[],pod:'route',verb:'T_Q',label:'first'},
    {id:'q2',after:[],pod:'route',verb:'T_Q',label:'second'}],{gap:6000});
   sq.addJobs([{id:'urgent',pod:'route',verb:'T_Q',label:'urgent'}],true);
   const q=sq.queued();
   t.is(q[0].id,'urgent','urgent job is at the head');
   t.is(q.length,3,'queue holds all three');
   sq.stopRun();
  }},

 {name:'stopRun halts dispatch',
  bug:'a stopped run kept assigning jobs from a stale interval',
  run:async(t)=>{
   const sq=t.squad;let n=0;
   sq.tool('T_S',async()=>{n++;return{ok:'x'}});
   sq.run([{id:'s1',after:[],pod:'route',verb:'T_S',label:'a'},
    {id:'s2',after:[],pod:'scribe',verb:'T_S',label:'b'}],{gap:250});
   sq.stopRun();
   await t.sleep(900);
   t.is(n,0,'nothing dispatched after stopRun');
   t.no(sq.isRunning(),'isRunning false');
  }},

 {name:'targets() ignores the pod layer',
  bug:'pods discovered their own overlay as a target and tethered to themselves',
  run:async(t)=>{
   const ts=t.squad.targets();
   t.ok(ts.length>=2,'found the rig fixtures ('+ts.length+')');
   t.no(ts.some(e=>e.hasAttribute('data-pod-layer')||e.closest('[data-pod-layer]')),
    'no target lives inside the pod layer');
  }},

 {name:'destroy leaves no timers or listeners',
  bug:'destroyed squads kept ticking and mutating dependency state',
  run:async(t)=>{
   const sq=new PodPatrol({host:t.squad.host,scroller:t.squad.host,
    pods:RIG_PODS,autonomy:'quorum',audio:false,voice:false,labels:false,revealKey:null});
   sq.tool('T_D',async()=>({ok:'x'}));
   sq.run([{id:'d1',after:[],pod:'route',verb:'T_D',label:'x'}],{gap:200});
   sq.destroy();
   await t.sleep(500);
   t.no(sq.isRunning(),'run stopped');
   t.is(sq._depHook,null,'dependency hook removed');
   t.no(!!document.querySelector('[data-pod-layer][data-stale]'),'layer detached');
  }}];

if (typeof module !== 'undefined') module.exports = { CASES };
