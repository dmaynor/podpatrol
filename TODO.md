# Pod Squad — TODO

Backlog agreed with the user. Return here to pick up work.

## Test suite — GREEN (34/34)
`Pod Squad Tests.dc.html` — every case is named after a bug this library shipped.
Rule: when a bug is found, add a case before fixing it.
Batch 1 — outcome routing and state isolation: {skip} non-escalation · {none}+taskfail ·
dependents released after failure · parallel dispatch · stall watchdog ·
per-instance verb objects · tool() cloning · ASSIST null-target refusal · unique docks ·
looseJSON repair · planner validation · dependency pruning · DSL parsing ·
persona round-trip · per-pod models · timestamped history · observations not filed as results.
Batch 2 — tool contract, history, behaviour, runner: live progress drives the arc ·
ctx.cancelled on stand-down · thrown tool becomes taskfail · bare return is success ·
structured result survives to taskdone · skips off-trail but on-record · trail stops carry
their element · maxHistory cap · clearHistory clears trails · quorum follows the agreeable
trait · leash stops beats · deterministic mode freezes styling · audio toggles safe when
disabled · addJobs(front) jumps the queue · stopRun halts dispatch · targets() excludes the
pod layer · destroy leaves no timers or hooks.
- [ ] Add cases as new bugs appear (acceptance-check monotonicity still untested)
- [ ] Backport the suite's rig pattern if the library is split into modules

## Image search (FIGURE tool) — first pass shipped, needs a return visit
- [x] FIGURE tool in Guide Build demo: Openverse (CC, no key) with placeholder fallback
- [ ] Verify Openverse fetch actually resolves in the preview sandbox; if blocked, wire the placeholder path as primary
- [ ] Better query building: derive the search from the section's own text instead of a hardcoded map
- [ ] Pod picks among the 6 candidates instead of taking the first (score by aspect/size/title match)
- [ ] Real-screenshot path: drag-and-drop onto the placeholder (image_slot-style), user-supplied captures beat CC results
- [ ] Move FIGURE into pod-squad.js as a documented recipe (fetch backend pluggable: Openverse / own-key proxy / none)

## ROM harness — parked (large jump, revisit deliberately)
Goal: pods play a real ROM, and test the guide's claims against what actually happens.
User has legally-supplied ROMs (Anbernic, several consoles). Partial file was deleted; start clean.
- [ ] Emulator mount: jsnes in-browser, ROM via file input (never bundle a ROM)
- [ ] Observation via RAM, not pixels — SMB3 RAM map: player x/y, world, level, powerup, lives, timer
- [ ] `PLAY` verb: model plans a per-segment policy, deterministic executor runs frames,
      ctx.progress driven by x-position, ctx.cancelled on death
- [ ] Outcome mapping: reached goal = ok, died = none, cleared without powerup = partial
- [ ] Death-driven re-plan: addJobs at queue front with death coords in the trail (ARCHIVE holds "we died here")
- [ ] The payoff: a route step written from memory gets tested against the ROM and
      verified or corrected — guide assembled from evidence, not confidence
- [ ] Constraint to respect: an LLM cannot close a 60fps loop. Plan macros, execute deterministically,
      re-plan only at segment boundaries or deaths
- [ ] Multi-console later (user has several) — keep the emulator behind an adapter interface

## Route diagram (MAP tool) — DONE
- [x] Per-world route strips from drafted data; whole-game map with whistle arcs
- [x] From-memory diagrams render dashed until verified

## Self-scaffolding — DONE
- [x] squad.plan(goal) — squad invents artifacts + job graph, validated before running
- [x] squad.run(jobs) work-queue driver in the library; addJobs() for mid-run revision
- [x] Verified: "document fastest way through smb3" produced 6 artifacts / 12 jobs unprompted

## Old route-diagram notes (superseded)
- [x] Pod builds a schematic world-route diagram from the drafted route section
- [x] Whistle skips drawn as arcs; from-memory diagrams dashed
- [ ] EDITOR second-reads the diagram like any section (still open)

## Library (pod-squad.js)
- [ ] Pod-to-pod argument: CHALLENGE triggers a real reply from the section author (two-turn exchange, resolution recorded)
- [x] Brain-planned convene: squad derives its own plan from a one-line goal
- [x] Parallel dependency-aware runner (`after` graph, fills every idle pod)
- [x] Acceptance criteria per artifact, check-driven drafting, monotonic accumulation
- [x] Regression suite (`Pod Squad Tests.dc.html`)
- [ ] Live job counter: `N done · N running · N queued · N added` (plan count currently static and misleading)
- [ ] README + copy-paste recipes (tools, brain, personas, audio, DSL, planner) — highest-value remaining item
- [ ] Consider splitting core / audio / DSL (file is ~2000 lines, grown by accretion)
- [ ] Backport to the other demos: Library demo lacks model-backed tools and per-pod temps

## Council app (Section9 Council.dc.html)
- [ ] Migrate its inline pod logic onto pod-squad.js (single implementation)
- [ ] Pods physically carry results back into the thread
- [ ] SIGINT view filtered to a single seat's channel
