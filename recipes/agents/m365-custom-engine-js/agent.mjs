/**
 * Govern a **Microsoft 365 Agents SDK custom engine agent** (TypeScript/JS) — the wrap map, one file.
 *
 * A *custom engine agent* is the tile where **you** hold the model client ("you manage orchestration
 * and provide your own LLM" — Microsoft's words). Your process hosts `AgentApplication` behind
 * `POST /api/messages`, and the model call inside your message handler is an ordinary provider-SDK
 * call. Your call, your tokens, your bill — which is exactly why cendor applies.
 *
 * Everything here is real host code from `@microsoft/agents-hosting` + `-express` plus the published
 * `@cendor/*` packages. The only stand-in is the provider client: `makeClient()` returns a small
 * async fake so this runs in CI with **no key and no network**. Swap it for
 * `instrument(new OpenAI())` and nothing else changes — `instrument()` detection is structural.
 *
 * The wrap map, in the order the handler hits it:
 *
 *   (A) pre-flight estimate + block .... preflight()      refuse before spending anything
 *   (B) per-turn budget scope .......... turnBudget()     wraps the WHOLE body (tool loops)
 *   (C) per-conversation cap ........... SpendLedger      TurnState, Decimal-as-string
 *   (D) attribution tags ............... turnScope()      conversation.id (never AAD by default)
 *   (E) mid-stream break ............... turnBudget({stream:true})
 *
 *   + instrument() on the client, guardrails in/out, acttrace guard + hash-chained audit,
 *     contextkit/squeeze history assembly, and the `channelData.cendor` reply envelope.
 *
 * ⚠️ This host runs `/api/messages` with no configured client id, i.e. **anonymous** — the supported
 * local posture and an **open relay in production**. See the README's "Before you deploy this" box.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import express from 'express';
import { Decimal } from 'decimal.js';
import {
  LLMCall,
  Money,
  addAmbientProvider,
  addInterceptor,
  bus,
  instrument,
  prices,
  removeAmbientProvider,
  removeInterceptor,
  tokens,
  trace,
} from '@cendor/core';
import { AuditLog, Policy, PolicyViolation, guard } from '@cendor/acttrace';
import { Block, Context as CkContext } from '@cendor/contextkit';
import { GuardrailTripped, evaluateAsync, presets, rules } from '@cendor/guardrails';
import { compress } from '@cendor/squeeze';
import { BudgetExceeded, track, withBudget } from '@cendor/tokenguard';
import { AgentApplication, MemoryStorage, StreamingResponse } from '@microsoft/agents-hosting';
import { Activity, ActivityTypes } from '@microsoft/agents-activity';
import { createAgentRequestHandler } from '@microsoft/agents-hosting-express';

export const MODEL = process.env.MODEL ?? 'gpt-4o-mini';
const INSTRUCTIONS =
  'You are a concise support agent in Microsoft Teams. Answer in one short sentence.';

// (C) Money is a `Decimal`, never a JS number — which is also why the ledger round-trips through
// TurnState as a *string*.
export const SESSION_CAP_USD = new Decimal(process.env.SESSION_CAP_USD ?? '5.00');
const TURN_CAP_USD = new Decimal(process.env.TURN_CAP_USD ?? '0.05');
const MAX_OUTPUT_TOKENS = 48;

// ⚠️ TRAP — **the output-cap parameter is not the same on every model, and the wrong one is a hard
// 400 on every turn.** The reasoning families (o-series, gpt-5-*) reject `max_tokens` outright:
//
//   400 Unsupported parameter: 'max_tokens' is not supported with this model.
//       Use 'max_completion_tokens' instead.
//
// Measured against a Foundry deployment running `gpt-5-mini` — exactly the
// Azure swap `makeClient()` offers below. It matters more here than in a
// plain OpenAI app because **an Azure deployment name is arbitrary**: `MODEL` may be `prod-chat`
// with a gpt-5 behind it, so no name heuristic can be authoritative. Hence: heuristic default,
// env override, and a one-shot switch when the provider tells us which name it wants.
let CAP_PARAM =
  process.env.OUTPUT_CAP_PARAM ??
  (/^(o[1-9]|gpt-5)/i.test(MODEL) ? 'max_completion_tokens' : 'max_tokens');
// ⚠️ And once the cap is accepted, mind what it BUYS on a reasoning model: the cap covers reasoning
// tokens too. Measured on the same deployment, MAX_OUTPUT_TOKENS = 48 returned
// `37 in / 48 out` with an EMPTY visible reply — the whole allowance went to hidden reasoning. The
// governance numbers are all correct; there is simply no text. Raise the cap for a reasoning
// deployment, or keep the demo cap and expect an empty answer.
const CONTEXT_BUDGET_TOKENS = 1200;

// ⚠️ TRAP — **an unpriced model turns every USD guard in this file into a silent no-op, and the
// agent still exits 0.** An Azure deployment name is arbitrary (`prod-chat`, `gpt-5-mini`, …) and
// carries no rate card, so tokenguard counts its calls as $0. Measured 2026-07-31 against the
// `gpt-5-mini` deployment the Azure swap points at: every governed turn reported `cost: $0`, and
// the session cap, the pre-flight refusal AND the mid-stream breaker all printed `ok` while doing
// nothing at all — five passing governance demos that were five no-ops. Worse than a crash,
// because nothing tells you.
//
// So price the deployment by naming the model behind it (`@cendor/core` >= 3.2), exactly as
// `providers/azure-foundry` does, and refuse to run unpriced rather than pretend.
const BASE_MODEL = process.env.AZURE_BASE_MODEL ?? 'gpt-4o-mini';

/**
 * Give `MODEL` a rate card if it has none. Returns true if a registration was needed.
 *
 * A plain OpenAI model name (`gpt-4o-mini`) is already priced and this is a no-op. An Azure
 * deployment name is not, and without this every dollar figure in this file is $0.
 * `registerDeployment` **throws** on a `like` cendor does not know, which is the point: an unknown
 * base model must be a loud failure at startup, not a quiet $0 on every turn.
 */
export function priceTheDeployment() {
  if (prices.models().includes(MODEL)) return false;
  prices.registerDeployment(MODEL, { like: BASE_MODEL });
  return true;
}

// TurnState in the JS port is a **property proxy** (`state.conversation.foo = …`), not Python's
// dotted-path string. Same conversation scope, different ergonomics.
const SPEND_PROP = 'cendorSpentUsd';
const HISTORY_PROP = 'cendorHistory';
// ───────────────────────────────────────────── the instrumented client (one line, at startup)

/**
 * The provider client, wrapped once. **Swap the body, keep the `instrument()`.**
 *
 *   import OpenAI from 'openai';
 *   return instrument(new OpenAI());        // or new Anthropic()
 *   // Microsoft Foundry (formerly Azure AI Foundry) — same client, v1 GA endpoint (no apiVersion):
 *   return instrument(new OpenAI({
 *     baseURL: `${process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')}/openai/v1/`,
 *     apiKey: process.env.AZURE_OPENAI_API_KEY }));
 *
 * The fake below keeps this recipe offline and keyless.
 */
/** The OpenAI-shaped request this host sends — `stream` decides which branch the fake takes. */

export function makeClient() {
  const completions = {
    async create(kw) {
      if (kw.stream) return fakeStream(kw);
      const answer = JSON.stringify(kw.messages).includes('refund')
        ? 'Your refund is on its way.'
        : 'Happy to help.';
      return {
        model: kw.model,
        choices: [{ message: { content: answer } }],
        usage: { prompt_tokens: 41, completion_tokens: 8 },
      };
    },
  };
  return instrument({ chat: { completions } });
}

/** An OpenAI-shaped chunk stream, so the (E) breaker has real chunks to break on. */
async function* fakeStream(kw) {
  const words = [
    'Here',
    ' is',
    ' a',
    ' long',
    ' answer',
    ' that',
    ' keeps',
    ' going',
    ' and',
    ' on',
  ];
  for (let i = 0; i < 6; i++) {
    for (const w of words) {
      yield {
        model: kw.model,
        choices: [{ delta: { content: w }, finish_reason: null }],
        usage: null,
      };
    }
  }
}

// ──────────────────────────────────── (D) attribution: an AsyncLocalStorage + a `trace()` scope

const TURN = new AsyncLocalStorage();

/** Once, at startup: stamp whatever is in `TURN` onto every event the bus sees. */
export function installTurnAmbient() {
  const provider = () => ({ ...(TURN.getStore() ?? {}) });
  addAmbientProvider(provider);
  return provider;
}

/**
 * Both halves matter, and both are scoped to exactly one turn:
 *
 *  - the **ambient stamp** — conversation / channel / activity id on every `LLMCall`;
 *  - the **`trace()` scope** — so a tool loop's N calls share ONE `traceId`. Without it a call
 *    carries no trace id at all and the reply envelope has nothing to correlate.
 *
 * ⚠️ `AsyncLocalStorage.run(value, fn)` — **never `enterWith`**. On Node 20/22 (legacy ALS) an
 * `enterWith` leaks into concurrent flows and is never restored on exit, and a server handling
 * overlapping turns is precisely the shape that breaks on. `run()` is correct on every Node.
 *
 * Only `conversation.id` is stamped. The sender's AAD object id is on the Activity and deliberately
 * **not** tagged: identity in exported telemetry is personal data. Opt in (and consider hashing) if
 * you need per-user attribution.
 *
 * ⚠️ Forgetting this scope fails **silently** — cost and usage stay exact, only attribution vanishes.
 */
export async function turnScope(context, fn) {
  const act = context.activity;
  const stamp = {
    conversation: act.conversation?.id ?? '',
    channel: act.channelId,
    turn_activity_id: act.id ?? '',
  };
  return TURN.run(stamp, () =>
    trace(`${stamp.conversation}:${stamp.turn_activity_id}`, () => fn(stamp)),
  );
}

// ─────────────────────────────────────────────────── guardrails on the channel boundary

const inputGate = () => [
  presets.promptInjection({ stage: 'input', action: 'block' }),
  rules.regexRule(/[\w.+-]+@[\w-]+\.[\w.]+/g, {
    action: 'redact',
    stage: 'input',
    name: 'email_redact',
    replacement: '[email redacted]',
  }),
  rules.lengthBounds({ maxChars: 8000, stage: 'input', action: 'block', name: 'activity_length' }),
];

const outputGate = () => [
  rules.keywordDeny(['internal-only'], {
    stage: 'output',
    action: 'block',
    name: 'disclosure_deny',
  }),
  rules.regexRule(/\bsk-[A-Za-z0-9]{8,}\b/g, {
    action: 'redact',
    stage: 'output',
    name: 'apikey_redact',
    replacement: '[redacted]',
  }),
];

/**
 * ⚠️ **THE most important call shape on this page.**
 *
 * `evaluateAsync` (and Python's `evaluate_async`) **THROW** `GuardrailTripped` on a block — they do
 * not hand you back a decision list with `action === 'block'` in it. A handler that only reads the
 * return value never sees the block: it escapes as an unhandled turn error and your user reads
 * *"the agent hit an error"* instead of your policy's refusal, which is indistinguishable from a
 * broken agent. Catch it, and the refusal becomes yours to word.
 *
 * The `redact` path is why this is `evaluateAsync` and not a boolean check: the returned payload is
 * the *rewritten* text, so the model never sees the e-mail address.
 */
async function gate(guardrails, stage, payload, conversationId) {
  const ctx = { stage, agent: 'm365-custom-engine', metadata: { conversation: conversationId } };
  try {
    const res = await evaluateAsync(guardrails, stage, payload, ctx);
    return { payload: res.payload, decisions: res.decisions };
  } catch (err) {
    if (err instanceof GuardrailTripped) {
      const decisions = err.decisions ?? [];
      return {
        payload,
        decisions: decisions.length
          ? decisions
          : [{ guardrail: 'guardrail', stage, action: 'block' }],
      };
    }
    throw err;
  }
}

const blocked = (decisions) => decisions.find((d) => d.action === 'block') ?? null;

// ───────────────────────────────────────── acttrace: evidence for a long-lived server

/**
 * One append-only, hash-chained file per **process**, installed once at startup.
 *
 * Why an interceptor and not a per-turn `guard(...)` scope: the scope form mutates a process-global
 * interceptor list, so under concurrent turns turn A's exit races turn B's entry.
 *
 * Reopening this same path after a restart **resumes** the chain and `verify()` stays green. What
 * acttrace refuses is two *live* `AuditLog`s on one file at once — the second throws at construction,
 * because two interleaved hash chains in one file can never verify. So rotate per process only if you
 * have **concurrent writers**, not merely because you restarted.
 */
function installAudit(path) {
  const log = new AuditLog('m365-custom-engine', { riskTier: 'limited', path });
  const interceptor = guard(Policy.gdpr(), log);
  addInterceptor(interceptor);
  return { log, interceptor };
}

// ──────────────────────── contextkit + squeeze: the prompt, inside a token budget
//
// Replayed conversation history is the dominant token-growth driver in a chat agent — every turn
// re-sends the previous ones. So assemble inside a budget instead of concatenating.

async function assemblePrompt(history, userText) {
  const ctx = new CkContext({
    budgetTokens: CONTEXT_BUDGET_TOKENS,
    model: MODEL,
    reserveOutput: 256,
  });
  ctx.add(new Block(INSTRUCTIONS, { role: 'system', priority: 100, pin: true }));

  let squeezedPct;
  if (history.length) {
    const blob = history.map((m) => `${m.role}: ${m.content}`).join('\n');
    if (blob.length > 1200) {
      const [text] = compress(blob, { kind: 'prose', targetTokens: 256, model: MODEL });
      ctx.add(
        new Block(`Earlier conversation (compressed):\n${text}`, { role: 'system', priority: 50 }),
      );
      // Token-for-token, not character-for-character — the budget is in tokens, so a character
      // ratio would be a different (and flattering) number.
      const before = tokens.count(blob, MODEL);
      if (before) squeezedPct = Math.round((1 - tokens.count(text, MODEL) / before) * 100);
    } else {
      ctx.add(new Block({ messages: history, priority: 50, evict: 'drop_oldest' }));
    }
  }
  ctx.add(new Block(userText, { role: 'user', priority: 90, pin: true }));
  return { messages: await ctx.assemble(), squeezedPct };
}
// ────────────────── (C) the per-conversation cap, held in the host's own TurnState
//
// tokenguard budgets are scope-shaped: they live and die with a callback. Conversations are
// long-lived. The bridge is the hosting SDK's own conversation-scoped state, so the cap survives
// turns — and, with Blob/Cosmos storage instead of MemoryStorage, process restarts.

/**
 * The slice of the M365 `TurnState` this host touches. The SDK's `DefaultConversationState` has no
 * index signature, so this is written as a structural read/write view over the one
 * conversation-scoped property the ledger uses rather than as a supertype of the SDK's own state.
 */
/** One chat turn as this host stores it. */
/**
 * The SDK's own turn context. Using the real type rather than a hand-rolled stand-in is what makes
 * `conversation` correctly OPTIONAL below — the Activity schema does not guarantee it.
 */

export class SpendLedger {
  state;
  capUsd;
  turnCapUsd;

  constructor(state, capUsd = SESSION_CAP_USD, turnCapUsd = TURN_CAP_USD) {
    this.state = state;
    this.capUsd = capUsd;
    this.turnCapUsd = turnCapUsd;
  }
  get spent() {
    const raw = this.state.conversation?.[SPEND_PROP];
    return raw ? new Decimal(String(raw)) : new Decimal(0);
  }
  get remaining() {
    return this.capUsd.minus(this.spent);
  }
  get exhausted() {
    return this.spent.gte(this.capUsd);
  }
  /** The per-turn scope is the **derived remainder** — a $4.97 session can burn $0.03 more. */
  turnAllowance() {
    return Decimal.min(this.turnCapUsd, this.remaining);
  }
  add(cost) {
    const amount = cost instanceof Money ? new Decimal(cost.amount.toString()) : new Decimal(0);
    const total = this.spent.plus(amount);
    this.state.conversation[SPEND_PROP] = total.toString(); // Decimal-as-string, never a JS number
    return total;
  }
}

/**
 * (B)/(E) — ONE scope around the whole handler body, so a tool loop shares one fuse.
 *
 * ⚠️ `withBudget(cfg, cb)` — **not** `budget(cfg, cb)`. `budget` is curried
 * (`budget(cfg)(cb)`) and its two-argument overload is a deliberate compile error that tells you so.
 */
function turnBudget(allowance, { conversationId, stream = false }, cb) {
  return track({ conversation: conversationId }, () =>
    withBudget(
      {
        usd: allowance.toString(),
        onExceed: stream ? 'break' : 'block',
        name: `m365-turn:${conversationId}`,
      },
      cb,
    ),
  );
}

/**
 * (A) — estimate before spending. Zero spend on refusal.
 *
 * ⚠️ The estimate reserves the **full** `maxOutputTokens`, which a short answer never uses (measured
 * 3.04x over-reservation on one real turn). So (A) can refuse while the ledger still shows headroom —
 * correct and zero-spend, but **never word that refusal as "you reached your cap"**. Say the request
 * *would* exceed what is left.
 *
 * An unpriced model (Azure deployment names, Bedrock/HF/Ollama ids) yields null: no number, so no
 * refusal — let the real budget scope do the work.
 */
function preflight(messages, allowance) {
  const amount = estimateFor(messages);
  if (amount === undefined) return true;
  return amount.lte(0) ? true : amount.lte(allowance);
}

/** The same projection `preflight()` compares, as a number — so the card can SHOW what it refused
 *  on. A refusal that does not name its own number is indistinguishable from a bug. */
function estimateFor(messages) {
  try {
    const text = messages.map((m) => String(m.content ?? '')).join('\n');
    const est = prices.estimate(MODEL, tokens.count(text, MODEL), {
      outputTokens: MAX_OUTPUT_TOKENS,
    });
    return est ? new Decimal(est.amount.toString()) : undefined;
  } catch {
    return undefined;
  }
}
// ─────────────────── the reply envelope, attached in the handler
//
// `FoundryAdapter` is **not** used here, on purpose. That adapter belongs to the separate Azure AI
// Foundry integration; the M365 Agents SDK owns its own Activity plumbing, so the envelope is three
// lines on the reply Activity. Using both would duplicate the host's plumbing.

/** The governance envelope this host attaches to every reply Activity. */

function channelDataFor(envelope) {
  const payload = {};
  for (const [k, v] of Object.entries(envelope)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    payload[k] = v;
  }
  return { cendor: payload };
}

// ─────────────────── the governance card, the part a USER sees
//
// The envelope above is for machines. This is for the person in the chat.
//
// ⚠️ WHY A CARD AND NOT `channelData`: measured against M365 Agents Playground 0.2.28 — its UI
// projection (`convertMessage()`) forwards a fixed field set and reads `channelData` only for
// `feedbackLoopEnabled`, so the envelope is on the wire and **invisible in the chat pane**. It does
// survive in the Log Panel's raw Activity JSON. `attachments`, by contrast, ARE forwarded and
// rendered. So a card is the only way to actually *see* what the libraries did while sitting in
// front of the Playground — or in Teams, or WebChat.
//
// The shape is deliberately the one cendor.ai/try uses: **one row per library, saying what that
// library did on this turn, in words.** A FactSet of raw keys is a JSON dump with better spacing;
// what a reviewer needs to read is "tokenguard refused this before any call, and here is the number
// it refused on". So the card leads with a sentence and then attributes each fact to the tool that
// produced it.
//
// Opt-in, off by default (`M365_CARDS=1`, or `/cards on` in the chat): plain text stays the
// canonical reply, because a card is channel styling and governance must not depend on styling.

const CARDS_DEFAULT = process.env.M365_CARDS === '1';
/** Everything the card shows, collected by the handler as the turn happens. */

export function newTurnFacts(over = {}) {
  return {
    governance: 'ok',
    inputTokens: 0,
    outputTokens: 0,
    modelCalls: 0,
    assembledMessages: 0,
    contextBudgetTokens: CONTEXT_BUDGET_TOKENS,
    decisions: [],
    policyCategories: [],
    ...over,
  };
}

/** `[container style, headline]` per governance outcome — Adaptive Card 1.5's own styles, so each
 *  client renders them in ITS theme rather than in ours. */
const STATUS = {
  ok: ['good', '✅  governed · answered'],
  input_blocked: ['attention', '🛑  guardrails · input blocked'],
  output_blocked: ['attention', '🛑  guardrails · output blocked'],
  policy_blocked: ['attention', '🛑  acttrace · data policy blocked'],
  broke_on_budget: ['warning', '✂️  tokenguard · stopped mid-stream'],
  preflight_refused: ['warning', '⛔  tokenguard · refused before the call'],
  session_cap_reached: ['warning', '⛔  tokenguard · session cap reached'],
};

const usd = (v) => (v === undefined ? '—' : `$${v.toString()}`);

/**
 * One sentence: what happened to this turn, and why. The part people actually read.
 *
 * ⚠️ Two of these are worded the way they are because the alternative is a lie. A pre-flight refusal
 * is **not** "you hit your cap" — the estimate over-reserves the full output allowance (measured
 * 3.04x on one real turn), so it can refuse while the ledger still shows headroom. And an output
 * block is **still billed**: the tokens were spent before the gate saw them.
 */
function narration(f) {
  if (f.governance === 'session_cap_reached') {
    return `This conversation has spent ${usd(f.sessionSpentUsd)} of its ${usd(f.sessionCapUsd)} cap, so no model call was made. Nothing was billed.`;
  }
  if (f.governance === 'preflight_refused') {
    return `Refused before any model call: the estimate was ${usd(f.estimateUsd)} against ${usd(f.turnAllowanceUsd)} left for this turn. Zero provider calls, $0 spent. The estimate reserves the full output allowance, so this can refuse while the session ledger still shows headroom.`;
  }
  if (f.governance === 'input_blocked') {
    const names = [
      ...new Set(f.decisions.filter((d) => d.action === 'block').map((d) => d.guardrail)),
    ]
      .sort()
      .join(', ');
    return `Blocked on the way in by ${names || 'a guardrail'} — before the request was built, so the model never saw it and nothing was billed. The block is in the audit chain.`;
  }
  if (f.governance === 'policy_blocked') {
    return `The data policy stopped this inside the provider call (${f.policyCategories.join(', ') || 'a policy category'}) — no tokens left the process. The finding's categories are reported; the matched value never is.`;
  }
  if (f.governance === 'output_blocked') {
    return `The model answered and the output gate refused to send it. ⚠️ This turn is still billed ${usd(f.costUsd)} — the tokens were spent before the gate could see them.`;
  }
  if (f.governance === 'broke_on_budget') {
    return `The stream was cut at the chunk where this turn's ${usd(f.turnAllowanceUsd)} allowance ran out. Spend stops at that boundary; whatever the channel had already been sent stays on screen.`;
  }
  return `Answered in ${f.modelCalls} model call${f.modelCalls === 1 ? '' : 's'} for ${usd(f.costUsd)}. This conversation has used ${usd(f.sessionSpentUsd)} of ${usd(f.sessionCapUsd)}.`;
}

/** One library's row: what it is on the left, what it DID on the right. */
function row(name, lib, lines) {
  const text = lines.filter(Boolean).join('\n\n');
  if (!text) return null;
  return {
    type: 'ColumnSet',
    separator: true,
    spacing: 'Small',
    columns: [
      {
        type: 'Column',
        width: '108px',
        items: [
          { type: 'TextBlock', text: `**${name}**`, wrap: true, size: 'Small' },
          {
            type: 'TextBlock',
            text: lib,
            wrap: true,
            size: 'Small',
            isSubtle: true,
            spacing: 'None',
          },
        ],
      },
      {
        type: 'Column',
        width: 'stretch',
        items: [{ type: 'TextBlock', text, wrap: true, size: 'Small' }],
      },
    ],
  };
}

/**
 * An Adaptive Card 1.5 that says **which library did what** on this turn, in words.
 *
 * 1.5 rather than anything newer on purpose: the Playground, Teams and WebChat all render it.
 */
export function governanceCard(f) {
  const [style, headline] = STATUS[f.governance] ?? ['accent', f.governance];

  const coreLines = f.modelCalls
    ? [
        `detected **${f.provider ?? '?'} · ${f.model}** from the client's shape`,
        `${f.inputTokens.toLocaleString('en-US')} in / ${f.outputTokens.toLocaleString('en-US')} out — the provider's count`,
      ]
    : ['**no model call was made** — nothing reached the provider'];
  if (f.traceId) coreLines.push(`one trace id for the turn: \`${f.traceId}\``);

  const budgetLines = [];
  if (f.costUsd !== undefined)
    budgetLines.push(`this turn **${usd(f.costUsd)}** (decimal.js, never a JS number)`);
  if (f.sessionSpentUsd !== undefined && f.sessionCapUsd !== undefined) {
    budgetLines.push(
      `session ${usd(f.sessionSpentUsd)} of ${usd(f.sessionCapUsd)}, held in the host's own TurnState`,
    );
  }
  if (f.turnAllowanceUsd !== undefined)
    budgetLines.push(`this turn's fuse: ${usd(f.turnAllowanceUsd)} (the remainder)`);
  // ⚠️ The provenance line, not a decoration. A USD cap is only as good as the rate under it, and an
  // unpriced model makes every dollar guard in this file a silent no-op.
  if (f.rateFrom) budgetLines.push(`rate ${f.rateFrom}`);

  const ctxLines = f.assembledMessages
    ? [
        `packed ${f.assembledMessages} message(s) into a ${f.contextBudgetTokens.toLocaleString('en-US')}-token window`,
      ]
    : [];
  const sqLines =
    f.squeezedPct === undefined
      ? []
      : [`history compressed **${f.squeezedPct}%** — reversible, not summarised`];

  const gateLines = f.decisions.map((d) => `\`${d.guardrail}\` → **${d.action}**`);
  if (!gateLines.length && f.governance !== 'policy_blocked')
    gateLines.push('in and out: nothing to act on');

  const auditLines = [];
  if (f.policyCategories.length)
    auditLines.push(`data policy stopped: ${f.policyCategories.join(', ')}`);
  if (f.auditEntries !== undefined) auditLines.push(`${f.auditEntries} hash-chained entries`);
  if (f.auditHead)
    auditLines.push(`head \`${f.auditHead.slice(0, 16)}…\` — \`verify()\` re-walks the file`);

  const body = [
    {
      type: 'Container',
      style,
      bleed: true,
      items: [
        { type: 'TextBlock', text: headline, weight: 'Bolder', wrap: true },
        { type: 'TextBlock', text: narration(f), wrap: true, spacing: 'Small' },
      ],
    },
  ];
  for (const r of [
    row('Bus feed', 'core', coreLines),
    row('Budget', 'tokenguard', budgetLines),
    row('Receipt', 'contextkit', ctxLines),
    row('Compression', 'squeeze', sqLines),
    row('Gate', 'guardrails', gateLines),
    row('Audit', 'acttrace', auditLines),
  ]) {
    if (r) body.push(r);
  }
  body.push({
    type: 'TextBlock',
    text: '_Every number above came from the published cendor packages reading this turn — not from the app. Replay it from a cassette and this card is identical._',
    wrap: true,
    isSubtle: true,
    size: 'Small',
    separator: true,
    spacing: 'Medium',
  });
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    body,
  };
}

/**
 * Plain text, the machine envelope, and — when asked — the card a human reads.
 *
 * `channelData.cendor` is for the channel / your back end to consume. Whether a *client* surfaces it
 * is client-specific: the M365 Agents Playground projects `channelData` away in its UI (it is still
 * on the wire), so don't tell people to look for it there — assert it in a test, or log it. The card
 * is the visible half, and it goes in `attachments`, which every one of those clients does forward.
 */
async function reply(context, text, envelope, facts, cards = false) {
  const activity = Activity.fromObject({ type: ActivityTypes.Message, text });
  activity.channelData = { ...(activity.channelData ?? {}), ...channelDataFor(envelope) };
  if (cards && facts) {
    activity.attachments = [
      { contentType: 'application/vnd.microsoft.card.adaptive', content: governanceCard(facts) },
    ];
  }
  await context.sendActivity(activity);
}
// ═══════════════════════════════════════════════════════════════════ the agent

/** Constructor options for {@link GovernedAgent}. */

export class GovernedAgent {
  /**
   * @param opts.skipAfterTurnHandler  **Do not set this in real code.** It exists so the recipe can
   *   demonstrate the trap below with a negative control, instead of just asserting the happy path.
   */
  client;
  inGate;
  outGate;
  sessionCapUsd;
  ambient;
  audit;
  interceptor;
  app;
  auditPath;
  /** Flipped by `/cards on|off`. Off unless `M365_CARDS=1` — plain text stays the canonical reply,
   *  so governance never depends on a channel rendering a card. */
  cards = CARDS_DEFAULT;
  /** True when `MODEL` had no rate card and one was registered for it at startup. */
  pricedDeployment;

  constructor({
    auditPath,
    storage = new MemoryStorage(),
    sessionCapUsd = SESSION_CAP_USD,
    skipAfterTurnHandler = false,
  } = {}) {
    this.auditPath = auditPath;
    // Price MODEL FIRST. Every USD guard below — the turn cap, the session cap, the pre-flight
    // projection, the mid-stream breaker — reads $0 for an unpriced model and enforces nothing,
    // silently. Do this before anything that can spend. See `priceTheDeployment()`.
    this.pricedDeployment = priceTheDeployment();
    this.client = makeClient();
    this.inGate = inputGate();
    this.outGate = outputGate();
    this.sessionCapUsd = sessionCapUsd;
    this.ambient = installTurnAmbient();
    const installed = installAudit(auditPath);
    this.audit = installed.log;
    this.interceptor = installed.interceptor;

    this.app = new AgentApplication({ storage });

    // ⚠️ **REQUIRED, and its absence looks exactly like working code.**
    // `AgentApplication.run()` calls `state.save()` only inside `if (this._afterTurn.length > 0)`,
    // and the official nodejs quickstart registers nothing — so `TurnState` is never persisted, the
    // ledger above reads $0 on every turn, and the session cap silently never binds. (Its own `count`
    // demo echoes `[1]` forever for the same reason.) The Python port saves unconditionally, so this
    // line has no Python twin.
    if (!skipAfterTurnHandler) this.app.onTurn('afterTurn', async () => true);

    this.register();
  }

  /** Undo the process-global installs. **A real server never calls this** — it lives forever. */
  close() {
    this.audit.detach();
    removeInterceptor(this.interceptor);
    removeAmbientProvider(this.ambient);
  }

  /**
   * One phrase saying where `MODEL`'s per-token rate came from (`@cendor/core` >= 3.6).
   *
   * Three answers, and the third is the one that costs money if nobody notices it:
   * **registered** (your line, outranks every table) · **from a source as of a date** (the bundled
   * snapshot, generated from the cendor-prices feed with per-row provenance, or whatever
   * `refresh()` you called at startup) · **unpriced**, where tokenguard counts every call as $0 and
   * the USD cap, the pre-flight refusal and the mid-stream breaker are all silent no-ops.
   */
  rateProvenance() {
    const e = prices.explain(MODEL);
    if (e.registered)
      return `registered here as \`${BASE_MODEL}\` — your line, outranks every table`;
    if (e.how === 'unpriced')
      return '**UNPRICED — every USD guard on this turn is a silent no-op**';
    return `from **${e.rowSource ?? e.sourceName}** as of ${e.rowAsof ?? e.snapshotDate}`;
  }

  /**
   * Stamp the audit chain's state and the price provenance onto `facts` at reply time.
   *
   * Read at reply time, not at turn start, because the entries this turn wrote are the whole point.
   * The head comes from the live `AuditLog`; the count is the chain FILE's line count — the file is
   * the evidence, and asking it is how you notice a writer that stopped writing.
   */
  turnFacts(facts) {
    facts.rateFrom = this.rateProvenance();
    facts.auditHead = this.audit.head ?? undefined;
    try {
      facts.auditEntries = this.auditPath
        ? readFileSync(this.auditPath, 'utf8')
            .split('\n')
            .filter((l) => l.trim()).length
        : undefined;
    } catch {
      facts.auditEntries = undefined; // no chain file yet — an answer, not an error
    }
    return facts;
  }

  register() {
    this.app.onActivity(ActivityTypes.Message, async (context, state) => {
      // `DefaultConversationState` carries no index signature; the ledger addresses its own
      // namespaced property, so the state is viewed through the structural type above.
      const turnState = state;
      let text = (context.activity.text ?? '').trim();

      // `/cards on|off` — the visible-governance toggle. It costs nothing and calls nothing, so it
      // answers before the ledger is even read.
      if (text.toLowerCase() === '/cards on' || text.toLowerCase() === '/cards off') {
        this.cards = text.toLowerCase().endsWith('on');
        await context.sendActivity(
          Activity.fromObject({
            type: ActivityTypes.Message,
            text: `Governance cards ${this.cards ? 'on' : 'off'}.`,
          }),
        );
        return;
      }

      const streamed = text.startsWith('/stream ');
      if (streamed) text = text.slice('/stream '.length);
      const cid = context.activity.conversation?.id ?? '';
      const ledger = new SpendLedger(turnState, this.sessionCapUsd);
      const facts = newTurnFacts({ model: MODEL, sessionCapUsd: ledger.capUsd });

      // (D) every bus event raised below carries this turn's identity and one trace id
      await turnScope(context, async () => {
        // (C) the cheapest refusal there is: the cap is gone, so no model call happens
        if (ledger.exhausted) {
          facts.governance = 'session_cap_reached';
          facts.sessionSpentUsd = ledger.spent;
          await reply(
            context,
            "This conversation has used its budget, so I didn't call the model.",
            {
              governance: 'session_cap_reached',
              session_spent_usd: ledger.spent.toString(),
              session_cap_usd: ledger.capUsd.toString(),
            },
            this.turnFacts(facts),
            this.cards,
          );
          return;
        }

        const inGated = await gate(this.inGate, 'input', text, cid);
        const inHit = blocked(inGated.decisions);
        if (inHit) {
          this.audit.flag(`input blocked by ${inHit.guardrail}`, {
            action: 'blocked',
            severity: 'warning',
          });
          facts.governance = 'input_blocked';
          facts.decisions = [...inGated.decisions];
          facts.sessionSpentUsd = ledger.spent;
          await reply(
            context,
            "I can't process that message.",
            {
              governance: 'input_blocked',
              decisions: inGated.decisions.map((d) => `${d.guardrail}:${d.action}`),
              session_spent_usd: ledger.spent.toString(),
            },
            this.turnFacts(facts),
            this.cards,
          );
          return;
        }

        const history = turnState.conversation[HISTORY_PROP] ?? [];
        const assembly = await assemblePrompt(history, String(inGated.payload));
        const messages = assembly.messages;
        const allowance = ledger.turnAllowance();
        facts.assembledMessages = messages.length;
        facts.squeezedPct = assembly.squeezedPct;
        facts.turnAllowanceUsd = allowance;
        facts.sessionSpentUsd = ledger.spent;
        facts.decisions = [...inGated.decisions];

        // (A) is skipped on a streamed turn, on purpose. ⚠️ (A) and (E) are MUTUALLY EXCLUSIVE: the
        // estimate reserves the full `maxOutputTokens`, so any allowance small enough for the breaker
        // to fire is already below the estimate — the turn would be refused before a chunk existed.
        // A stream's fuse IS the breaker.
        if (!streamed && !preflight(messages, allowance)) {
          facts.governance = 'preflight_refused';
          facts.estimateUsd = estimateFor(messages);
          await reply(
            context,
            "That request would exceed what's left of this conversation's budget.",
            {
              governance: 'preflight_refused',
              session_spent_usd: ledger.spent.toString(),
              session_cap_usd: ledger.capUsd.toString(),
            },
            this.turnFacts(facts),
            this.cards,
          );
          return;
        }

        const calls = [];
        const collect = (e) => {
          if (e instanceof LLMCall) calls.push(e);
        };
        bus.subscribe(collect);
        let answer = '';
        let broke = false;
        try {
          answer = await this.audit.decision(
            async (decision) => {
              const r = streamed
                ? await this.streamedTurn(context, messages, allowance)
                : await this.plainTurn(messages, allowance);
              broke = r.broke;
              decision.record({ model: MODEL, streamed });
              return r.text;
            },
            { input: String(inGated.payload).slice(0, 200) },
          );
        } catch (err) {
          // ⚠️ The THIRD exception type a governed handler must expect, alongside BudgetExceeded and
          // GuardrailTripped: the acttrace `guard()` installed at startup throws `PolicyViolation`
          // from *inside* the provider call, at core's interceptor seam. Uncaught, the channel shows
          // "the agent hit an error" instead of the refusal. Report categories, never the value.
          if (!(err instanceof PolicyViolation)) throw err;
          const categories = [...new Set((err.findings ?? []).map((f) => f.category))].sort();
          facts.governance = 'policy_blocked';
          facts.policyCategories = categories;
          await reply(
            context,
            "I can't send that to the model — our data policy blocked it" +
              (categories.length ? ` (${categories.join(', ')}).` : '.'),
            { governance: 'policy_blocked', decisions: categories.map((c) => `acttrace:${c}`) },
            this.turnFacts(facts),
            this.cards,
          );
          return;
        } finally {
          bus.unsubscribe(collect);
        }

        const cost = new Money(
          calls.reduce(
            (t, c) => (c.cost instanceof Money ? t.plus(new Decimal(c.cost.amount.toString())) : t),
            new Decimal(0),
          ),
        );
        const usageIn = calls.reduce((n, c) => n + Number(c.usage?.inputTokens ?? 0), 0);
        const usageOut = calls.reduce((n, c) => n + Number(c.usage?.outputTokens ?? 0), 0);

        const outGated = await gate(this.outGate, 'output', answer, cid);
        const outHit = blocked(outGated.decisions);
        const safeAnswer = outHit
          ? 'I generated a response our output policy blocked.'
          : outGated.payload;

        const total = ledger.add(cost); // (C) write the cap back into TurnState
        turnState.conversation[HISTORY_PROP] = [
          ...history,
          { role: 'user', content: String(inGated.payload) },
          { role: 'assistant', content: String(safeAnswer) },
        ].slice(-20);

        const envelope = {
          governance: broke ? 'broke_on_budget' : outHit ? 'output_blocked' : 'ok',
          trace_id: calls.length ? calls[calls.length - 1].traceId : undefined,
          cost_usd: cost.amount.toString(),
          model: MODEL,
          input_tokens: usageIn || undefined,
          output_tokens: usageOut || undefined,
          session_spent_usd: total.toString(),
          session_cap_usd: ledger.capUsd.toString(),
          decisions: [...inGated.decisions, ...outGated.decisions].map(
            (d) => `${d.guardrail}:${d.action}`,
          ),
        };
        facts.governance = envelope.governance;
        facts.provider = calls.length ? calls[calls.length - 1].provider : undefined;
        facts.traceId = envelope.trace_id;
        facts.costUsd = new Decimal(cost.amount.toString());
        facts.inputTokens = usageIn;
        facts.outputTokens = usageOut;
        facts.modelCalls = calls.length;
        facts.sessionSpentUsd = total;
        facts.decisions = [...inGated.decisions, ...outGated.decisions];
        // A streamed turn already flushed its text, so the envelope rides a final activity.
        await reply(
          context,
          streamed ? '' : String(safeAnswer),
          envelope,
          this.turnFacts(facts),
          this.cards,
        );
      });
    });
  }

  /**
   * One model call, with the output cap under whichever name this model accepts (see the
   * `CAP_PARAM` trap note at the top). The retry costs nothing — the rejected call never reached the
   * model, so there is no double spend — and the switch is remembered so it happens at most once.
   */
  async create(cap, kw) {
    try {
      return await this.client.chat.completions.create({ ...kw, [CAP_PARAM]: cap });
    } catch (err) {
      const other = CAP_PARAM === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
      const text = err instanceof Error ? err.message : String(err);
      if (!text.includes(other) || !text.includes('nsupported')) throw err;
      CAP_PARAM = other;
      return await this.client.chat.completions.create({ ...kw, [CAP_PARAM]: cap });
    }
  }

  async plainTurn(messages, allowance) {
    try {
      const resp = await turnBudget(allowance, { conversationId: 'turn' }, () =>
        this.create(MAX_OUTPUT_TOKENS, { model: MODEL, messages }),
      );
      const message = resp.choices[0].message;
      return { text: message.content ?? '', broke: false };
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      return {
        text: "I stopped before calling the model — this turn's budget was already spent.",
        broke: true,
      };
    }
  }

  /**
   * (E) provider stream → the channel's streamed reply, with the breaker in between.
   *
   * **Spend truth vs display truth.** Break stops token consumption at the chunk boundary. The
   * channel keeps whatever it had already been sent — queued chunks cannot be unsent. Whether
   * anything was visible depends on the channel and on how long the answer ran; on a non-streaming
   * channel the user simply sees the truncated answer plus the notice. Never claim the user-visible
   * text is cut at the exact budget token.
   */
  async streamedTurn(context, messages, allowance) {
    const stream = new StreamingResponse(context);
    stream.queueInformativeUpdate('Thinking…');
    const collected = [];
    let broke = false;
    try {
      const conversationId = context.activity.conversation?.id ?? '';
      await turnBudget(allowance, { conversationId, stream: true }, async () => {
        // `create` returns a stream OR a plain response depending on `stream`, so its inferred type
        // is that union; the cast is this call site asserting which branch it asked for.
        const providerStream = await this.create(512, {
          model: MODEL,
          messages,
          stream: true,
          stream_options: { include_usage: true },
        });
        for await (const chunk of providerStream) {
          const piece = chunk.choices?.[0]?.delta?.content ?? '';
          if (piece) {
            collected.push(piece);
            stream.queueTextChunk(piece);
          }
        }
      });
    } catch (err) {
      if (!(err instanceof BudgetExceeded)) throw err;
      broke = true;
      stream.queueTextChunk('\n\n_[stopped at the budget cap]_');
    } finally {
      // On JS `waitForQueue()` is private and `endStream()` drains the queue itself. (On Python BOTH
      // are coroutines and an un-awaited `end_stream()` silently loses the last chunk.)
      await stream.endStream();
    }
    return { text: collected.join(''), broke };
  }
}

// ═══════════════════════════════════════════════════════════════════ the express host

/** The quickstart's server: one POST route behind the SDK's own request handler (JWT included). */
export function buildWebApp(agent) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.post('/api/messages', createAgentRequestHandler(agent.app));
  return app;
}

export async function serve(agent, port = 3979) {
  return new Promise((resolve) => {
    const server = buildWebApp(agent).listen(port, '127.0.0.1', () => resolve(server));
  });
}
