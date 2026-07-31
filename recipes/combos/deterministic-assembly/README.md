# deterministic-assembly (JS) — why a replay is worth anything at all

**The pain.** Your offline test suite passes. Is it actually offline? A cassette replays by hashing
the request, so if prompt assembly is not deterministic, run 2 hashes differently, the cassette
misses, and you are back to a live call — *silently*.

**What this shows.** `@cendor/contextkit`'s packing is deterministic by construction, measured rather
than claimed. The same 40-turn conversation is built and assembled twice into a budget too small to
hold it (so real eviction happens — the hard case), both assembled prompts are hashed, then a cassette
recorded from run 1 is replayed against **run 2's** prompt with a client that throws if it is reached.

## Run it

```bash
cd recipes/combos/deterministic-assembly
npm install
node index.mjs
```

## Expected output

```text
assembled   : 284 tokens of 400 - history: kept 13 of 40 turns
run 1 hash  : f038f559c507cf87…
run 2 hash  : f038f559c507cf87…   identical: true
one char    : 68cd120934abe0c8…   identical: false
replay      : provider called 0x, answered "acknowledged"
```

27 of 40 turns were evicted and the two runs still hash identically — that is the property. `one char`
is the control: a fingerprint that never changed would prove nothing, so the recipe appends a single
`.` and asserts the hash moves.

The assembled token count and the eviction note match the Python twin exactly (284 tokens, 13 of 40
turns). The sha256 prefix differs only because each recipe hashes its own JSON serialisation, and
`JSON.stringify` and `json.dumps` space their separators differently.

Python twin: [`combos/deterministic-assembly`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/combos/deterministic-assembly) ·
Packages: `@cendor/core`, `@cendor/contextkit`, `@cendor/cassette` · Offline ✓ ·
[← all recipes](../../../README.md)
