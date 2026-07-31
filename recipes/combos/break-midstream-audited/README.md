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
node index.mjs
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
[← all recipes](../../../README.md)
