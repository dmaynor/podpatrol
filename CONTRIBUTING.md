# Contributing

## The one rule

**When a bug is found, add a test case before fixing it.**

`tests/cases.js` holds one case per defect this library has
actually shipped. Each case names the bug it guards. A suite that only tests what
already works will not catch the next one.

Add a case like this:

```js
{name:'short statement of the invariant',
 bug:'the defect this guards, in one line',
 run:async(t)=>{
  const sq=t.squad;                    // fresh squad, real host, stubbed tools
  sq.tool('T_X',async()=>({ok:'x'}));
  sq.assign('route','T_X','a1');
  await t.wait(()=>/* condition */,5000);
  t.ok(cond,'what this proves');       // also t.is(a,b,msg) and t.no(v,msg)
 }},
```

Open the page and it runs. Turn on VERBOSE to see each assertion and the source
of the test that produced it.

## Design rules that are not negotiable

1. **Never fabricate an outcome.** If a tool cannot do the work, say so. The
   `{skip}` outcome exists because returning `{none}` for an unmet precondition
   manufactures a blockage and the peer assist then claims a rescue that never
   happened. Half the bugs in the history of this library are variations on
   reporting work that did not occur.
2. **A remedy must be executable.** Do not put an artifact in a state that says
   "needs more drafting" unless something can actually pick it up. Check the
   selector.
3. **Loops need a cap and an exit.** Any revise-recheck cycle terminates, and
   when it terminates it escalates to the operator rather than spinning.
4. **Instance state must not alias module state.** Deep-copy anything a host can
   write to. A shallow merge once corrupted `DEFAULT_VERBS` process-wide.
5. **Yield to the user.** Pods pause their scroll drive after any scroll input,
   and never move the outer page.
