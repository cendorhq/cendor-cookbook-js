# cassette-semantic-drift (JS) — `drift()` compares bytes; you want to compare meaning

**The pain.** You run a scheduled `rerecord` against the live provider to catch answers that have
moved. Models do not produce bytes twice, so it reports a divergence on nearly every entry — and a
signal that is mostly noise gets muted, which is the same as having no signal.

**What this shows.** `semanticDrift(threshold, scorer)` filters `drift()` down to divergences that
score **below** the threshold. The scorer is pluggable, and this recipe is mostly about *why* it has
to be.

## Run it

```bash
cd recipes/libs/cassette-semantic-drift
npm install
node index.mjs
```

## Expected output

```text
recorded    : "Refunds are available within 30 days of delivery."

live answer  drift()  lexical  kept  toy-embed  kept
paraphrase   1        0.42     1     0.26       1
real change  1        0.96     0     0.90       0

read the two 'kept' columns: the PARAPHRASE survives the filter and the REAL CHANGE is
dropped, under both scorers. A surface scorer measures shared words, so a rewrite looks
like a big change and one edited number looks like none. That is the whole reason
semanticDrift() takes scorer=.

the Python-only backend, shown rather than faked:
  localEmbeddingScorer() -> throws: localEmbeddingScorer needs a static-embedding model that is not bundled in JS. Pass your
  In Python that call IS the recommended offline semantic backend (model2vec, via the
  cendor-cassette[embeddings] extra). In JS, wrap your own model with embeddingScorer().

where the lexical default IS the right tool - asserting an answer means roughly X:
  semanticMatch(recorded, "refund within 30 days") = true
  semanticMatch(recorded, "delivery") = true

honest limit, measured rather than hidden:
  lexicalScore("We will not offer a refund.", 'offer a refund') = 1.00 -> match true
  keyword containment cannot see a negation. Do not use it as a safety check.
```

**Read the two `kept` columns.** A harmless paraphrase scores 0.42 and *survives* the filter; "30
days" changed to "14 days" scores 0.96 and is *dropped*. Both scorers behave the same way, because
both count shared words: a rewrite shares few, and one edited number shares almost all.

That is not a bug in `lexicalScore`, it is what lexical similarity **is** — and it is precisely why
`semanticDrift()` takes a `scorer=`.

## ⚠️ The one genuine parity gap in this cookbook

Python has `local_embedding_scorer()` — a real offline semantic backend (model2vec static embeddings,
no torch, no key) behind the `cendor-cassette[embeddings]` extra. **There is no maintained pure-JS
model2vec**, so `localEmbeddingScorer()` in `@cendor/cassette` exists only so the name is discoverable
and **throws by design**, with a message naming the alternative.

This recipe **calls it and prints the error** rather than shipping a TypeScript sample that does not
really work. In JS, bring your own embedder:

```js
import { embeddingScorer, semanticDrift } from '@cendor/cassette';
const scorer = embeddingScorer(async (texts) => myModel.embed(texts));  // any texts -> vectors
semanticDrift(0.8, scorer);
```

The recipe's `toyEmbed` is a deliberately crude hashed bag-of-words stand-in, and the output reports
honestly that it does not fix the problem — it is there to show the **seam**, not to pass as a model.

**Where the lexical default is right:** asserting that an agent's answer *means roughly* something. It
is recall-oriented, so it tolerates extra surrounding text — which is also why it accepts a negation.
Do not use it as a safety check.

Python twin: [`libs/cassette-semantic-drift`](https://github.com/cendorhq/cendor-cookbook/tree/main/recipes/libs/cassette-semantic-drift) ·
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
