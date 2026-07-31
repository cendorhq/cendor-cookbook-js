# Contributing a recipe

Thanks for adding to the Cendor Cookbook (TypeScript). Every recipe here earns its place by proving
something real — and by **running green offline, with no API key**. That last rule is the bar every
PR must clear.

This is the TypeScript half. The Python half is
[`cendorhq/cendor-cookbook`](https://github.com/cendorhq/cendor-cookbook), and the two are twins: a
recipe folder name means the same thing in both trees.

## The one hard rule: it runs offline

CI has **no secrets, ever**. A recipe must produce its money shot with:

- **no API key** in the environment, and
- **no network call** to any model provider.

We get there the way the library's own test suite does: drive `instrument()` with a **fake
provider-shaped client** (a plain object exposing the same `chat.completions.create` /
`responses.create` / `messages.create` / `chat(...)` surface the real SDK has). The fake returns a
canned `usage`/response; `@cendor/core` normalizes and prices it exactly as it would a real call. No
SDK, no key, no daemon.

If your recipe demonstrates a real provider or a local model, add a **`RECORD=1` path**: the same
code, gated behind an env check, that a maintainer runs once with a real key so `@cendor/cassette`
records the exchange (secrets redacted on write). The committed cassette then lets CI replay it
offline. Ship the recipe **unrecorded** — the fake-client path is what keeps CI green until a
cassette lands.

## The recipe standard

| Piece | Rule |
|---|---|
| `README.md` | the **pain** (2–3 lines, in a developer's words) → **what the recipe shows** → the **run command** → an **expected-output** snippet that includes the money shot |
| `index.mjs` | **~80 lines is the target, not a gate** — copy-paste runnable as `npm install && node index.mjs` from the recipe directory. Some recipes are legitimately longer (the agent-host recipe is hundreds of lines, because the *host* is the point); the real rule is that a reader can follow it top to bottom in one sitting |
| `package.json` | the recipe's **own** pins — `"type": "module"`, `"private": true`, a `start` script, and caret ranges on the `@cendor/*` packages it actually imports. No workspace, no hoisting |
| Offline | green with **no key and no network** — fake provider-shaped client (default) or a committed cassette fixture |
| Node | runs on **Node 20 and 22** (the CI matrix). If it needs a newer Node, it does not belong here yet |
| One core | `node scripts/check-one-core.mjs recipes/<category>/<name>` passes |
| Honest claims | **no invented numbers.** Any cost printed comes from `prices.estimate(...)` on stated token counts, and money is `decimal.js` — `cost.amount.toString()`, never `Number(...)`. Frameworks "work alongside" Cendor — never "official integration" |
| No tool→tool imports | recipes compose libraries only through the documented seams (`instrument()`, the `@cendor/core` bus, protocols) |
| Python-only capability | gets a **documented omission** in the README and a row in the parity table — **never a fake TypeScript sample** |

## Recipe template

```
recipes/<category>/<name>/
├── README.md      # pain → shows → run → expected output (money shot)
├── package.json   # own pins, "type": "module", "private": true
└── index.mjs      # ~80 lines target (not a gate), offline, node index.mjs
```

`package.json` skeleton:

```json
{
  "name": "cendor-recipe-<name>",
  "private": true,
  "type": "module",
  "description": "Cendor cookbook — <one line> (JS, offline).",
  "scripts": { "start": "node index.mjs" },
  "dependencies": { "@cendor/core": "^3.1.0" }
}
```

`index.mjs` skeleton (fake-client offline pattern):

```js
import { LLMCall, bus, instrument } from '@cendor/core';

function fakeOpenAI(promptTokens = 1000, completionTokens = 500) {
  return {
    chat: {
      completions: {
        create: async () => ({ usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }),
      },
    },
  };
}

const client = instrument(fakeOpenAI());
bus.subscribe((call) => {
  if (!(call instanceof LLMCall)) return;
  console.log(call.provider, call.model, call.usage.totalTokens, `$${call.cost.amount}`);
});

await client.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
```

## Before you open the PR

- [ ] `npm install && node index.mjs` prints the money shot **with no key set**, from inside the
      recipe directory.
- [ ] It runs on **Node 20 and 22**, not just your local Node.
- [ ] `node scripts/check-one-core.mjs recipes/<category>/<name>` passes.
- [ ] The README's expected-output snippet matches what the recipe actually prints.
- [ ] **CI actually runs your recipe** — every directory under `recipes/` must be reachable from a
      job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). A new category needs its shard
      added there, and a new recipe needs adding to its shard's list.
- [ ] `.github/dependabot.yml` has an `npm` entry for the new recipe directory — otherwise its pins
      are the one set nothing is watching.
- [ ] No invented metrics; every cost traces to `prices.estimate(...)`, and money is `decimal.js`.
- [ ] You did **not** rename an existing recipe folder — those names are an API.
- [ ] You did not cross a **major** on any `@cendor/*` range — that is a maintainer decision.

## Conduct and security

Be respectful and constructive — see the [Code of Conduct](CODE_OF_CONDUCT.md).

Found a security problem in a recipe — an unsafe pattern people would copy, a credential that leaked
into a fixture, a cassette that isn't safe to load? **Don't open a public issue.** See
[SECURITY.md](SECURITY.md) for the private reporting channel and what belongs here versus in
[`cendor-libs-js`](https://github.com/cendorhq/cendor-libs-js).

## Site contract

Folder names under `recipes/` are an API — the cendor.ai `/cookbook` page deep-links to them and the
Cendor MCP docs server indexes them. **Don't rename an existing recipe folder** without updating the
site, and don't rename one that also exists in the Python cookbook without renaming both.

---
Licensed under Apache-2.0. By contributing you agree your contribution is licensed under the
same terms. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
