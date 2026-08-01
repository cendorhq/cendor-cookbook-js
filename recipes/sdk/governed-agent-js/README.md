# governed-agent (JS) — a budget-capped, audited agent in ~15 lines

**What this shows.** `@cendor/sdk` makes governance the default. This agent runs one tool call under a
USD `withBudget(... onExceed: 'block')` circuit breaker, writes a tamper-evident `AuditLog` chain, and
proves it with `verify()` — all offline, no key. The TypeScript twin of the
[`governed-agent`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/sdk/governed-agent)
recipe in the Python cookbook.

## Run it

```bash
cd recipes/sdk/governed-agent-js
npm install    # pulls @cendor/sdk from npm
node index.mjs
```

## Expected output

```text
output : Done — your refund for order 123 is on the way.
cost   : 0.000... USD
tokens : 182
tools  : [ 'refund' ]
trace  : <hex>
audit  : true — ok: 7 entries, head <hex>… (signatures verified)
```

## Going live

Drop the `client:` argument and set `OPENAI_API_KEY` (Anthropic: `ANTHROPIC_API_KEY`) — the SDK
builds the provider client from your environment. Or keep the argument and pass
`client: new OpenAI()` yourself; both are supported and neither changes anything else in the file.

> ⚠️ **`openai` is an OPTIONAL PEER of `@cendor/sdk` and this recipe does not declare it**, so the
> live swap needs `npm install openai` first. Without it the SDK cannot construct a client and you
> get a module-not-found, which reads nothing like the auth error you would expect to hit next.

The budget, audit and `verify()` guarantees are unchanged on the live path — and the audit chain
this writes verifies in **Python** too (`cendor.acttrace.verify`), byte for byte. One chain format,
both languages.

## Pins

The npm shelf this recipe was **verified against on 2026-08-01** — a record of what was run, not a
lockfile. `package.json` declares carets and at `3.x` a caret spans the whole major, so a fresh
`npm install` resolves forward within major 3. `package-lock.json` is deliberately not committed.

```
@cendor/sdk 3.1.0  (pulls @cendor/core 3.4.0 + the six libraries)
zod 4.x
```

⚠️ `npm install` over an existing `node_modules` is **lock-obedient, not a refresh**. To move onto what
is published: `rm -rf node_modules package-lock.json && npm install`. Then
`node ../../../scripts/check-one-core.mjs .` asserts exactly one `@cendor/core` — two copies are two
event buses, and cross-library cooperation stops with nothing failing to say so.

Libraries: `@cendor/sdk` (+ `@cendor/tokenguard`, `@cendor/acttrace`) · Offline ✓ · TypeScript · [← all recipes](../../../README.md)
