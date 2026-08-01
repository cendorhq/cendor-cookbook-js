# break-midstream-audited (JS) — cut a runaway stream mid-flight, and keep the evidence

**The pain.** A pre-flight cap cannot help you here. You asked for one paragraph; the model is four
thousand tokens into a loop and still going. The request was already approved, and by the time the
response settles you have paid for all of it.

**What this shows.** `onExceed: 'break'` registers a per-chunk observer on core's stream seam; when
the running output estimate crosses the cap it **closes the provider stream**, keeps the partial text,
and throws once. `@cendor/acttrace` chains the cut as `budget_event(action='broken')` on the same
tamper-evident file, and the chain still verifies.

## Run it

```bash
cd recipes/combos/break-midstream-audited
npm install
node index.mjs        # plain JS, no build step
# ...or run the TypeScript source it is generated from:
# npx tsx index.mts
```

## Expected output

```text
stream       : cut after 9 of 60 chunks (partial text kept)
provider     : underlying stream closed = true
raised       : 1x BudgetExceeded - mid-stream break: streamed output ~23 tokens crossed the remaining budget (~20 left) for gpt-4o; the stream was cut. You keep the partial output; the provider bills to the cut (~one chunk + one RTT past).
chained      : budget_event(action='broken'), cap 20 tokens
verify()     : true - ok: 3 entries, head f9f2f16d019c…
```

`underlying stream closed = true` is the line to read. A consumer-side `break` out of the loop would
stop *your* iteration while the provider kept generating and billing; this closes the socket.

⚠️ **The abort mechanism differs from Python, and the fake stream has to match it.** When the observer
throws, core's `for await` exits and JavaScript's **IteratorClose** calls the source iterator's
`return()` — which is what a real SDK stream uses to abort its fetch controller. Python's iterator
protocol calls `close()` instead. A fake stream that only implements `close()` will make this recipe
report `closed = false` while everything else looks right.

**`break` is not a substitute for `block`** — see
[`libs/tokenguard-hard-vs-runaway`](../../libs/tokenguard-hard-vs-runaway/).

Python twin: [`combos/break-midstream-audited`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/combos/break-midstream-audited) ·
Packages: `@cendor/core`, `@cendor/tokenguard`, `@cendor/acttrace` · Offline ✓ ·
Live switch: none (offline only) · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/acttrace    ^3.1.0
@cendor/core        ^3.4.0
@cendor/tokenguard  ^3.1.0
```

⚠️ **A caret is not a floor you can forget.** At `3.x` a caret spans the whole major, so a newer
patch or minor than the numbers above is expected, not drift — but the reverse also holds:
`npm install` over an existing `node_modules` is **lock-obedient, not a refresh**, and will happily
leave you on an older 3.x while everything still passes. To move onto what is actually published:

```bash
rm -rf node_modules package-lock.json && npm install
node ../../../scripts/check-one-core.mjs .
```

That second line is the one that matters after any `@cendor/core` minor: **the whole `@cendor/*` set
moves together**, and a sibling left behind resolves a *second* copy of `@cendor/core` — two event
buses, so a guardrail decision never reaches the budget, and nothing fails to say so.
