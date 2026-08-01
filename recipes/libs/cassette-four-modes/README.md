# cassette-four-modes (JS) — four modes, four environments

**The pain.** The modes are one keyword apart and mean very different things. Pick the convenient one
and your CI quietly starts making live calls the first time a tape is missing — the exact failure a
cassette exists to prevent, and it fails green.

**What this shows.** All four modes driven against the same fake provider, with the provider-call
count printed for each, so the difference is a number rather than a description.

| mode | provider | write | use it |
|---|---|---|---|
| `record` | called | writes the tape | once, deliberately, with a key |
| `replay` | **never** | — | CI. An unrecorded call **throws** — strict on purpose |
| `auto` | only if the tape is missing | writes if missing | a laptop. **Wrong for CI**: a missing file silently becomes a live call |
| `rerecord` | called | **does not overwrite** — reports `drift()` | the scheduled refresh check |

And the fifth choice: **no cassette scope at all**. Nothing is intercepted; every call is live. That is
the default, and it is the right answer in production.

## Run it

```bash
cd recipes/libs/cassette-four-modes
npm install
node index.mjs
```

## Expected output

```text
record   : provider 1x -> tape written (773 bytes)
replay   : provider 0x -> "30 days from delivery."
           an UNRECORDED call throws: no recorded response for llm request (hash 48f3cff8053b…) in policy.json; re-r
auto     : existing tape -> provider 0x (replayed); missing tape -> provider 1x (recorded)
rerecord : provider 1x -> drift() reports 1 divergence(s); tape unchanged on disk: true
no scope : provider 1x - nothing is intercepted; this is production
```

The `auto` line is the one to internalise: **the same mode did two different things** depending on
whether a file existed. Convenient locally, dangerous in CI, where "the tape didn't get committed"
should be a red test. Use `mode: 'replay'` there and let the `CassetteError` tell you.

`rerecord` ran live *and left the tape alone*. It answers "has the provider's answer moved?" without
you losing the recorded baseline in the act of asking. Filtering that drift down to changes that
actually *mean* something is [`cassette-semantic-drift`](../cassette-semantic-drift/).

The **request hash is identical to the Python twin** (`48f3cff8053b…`) — a tape recorded in one
language replays in the other.

Call shape: `cassette.using(target, { mode }, cb)` — an async callback scope, not a `with` block.

Python twin: [`libs/cassette-four-modes`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/cassette-four-modes) ·
Packages: `@cendor/core`, `@cendor/cassette` · Offline ✓ · [← all recipes](../../../README.md)
## Pins

The npm shelf this recipe declares. `package.json` is the only pin file — this repo has no
workspace and no committed lockfile, so a fresh `npm install` re-resolves within these ranges and
drift shows up as a red CI job instead of being frozen into a lock nobody re-reads.

```
@cendor/cassette  ^3.0.0
@cendor/core      ^3.3.0
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
