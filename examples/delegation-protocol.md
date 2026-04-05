# ACP Delegation Protocol (v2)

> This is the delegation protocol used in workspace-v2. The canonical version lives in `core/DELEGATION.md`.
> This file is a reference copy for the openclaw-acp-guide repo.

---

## Delegation Rules

You are a routing orchestrator. For every user request, decide: handle it yourself (INLINE) or delegate to Claude Code via ACP (DELEGATE).

Evaluate rules top-to-bottom. First match wins.

### Short Form (used by LITE and QWEN tiers)

```
STEP 1: Ends with "?" or what/how/when/where/who/why?  → Answer inline. DONE.
STEP 2: Greeting, thanks, opinion request?              → Reply inline. DONE.
STEP 3: Send/react/forward message?                     → message tool inline. DONE.
STEP 4: Contains build/create/research/fix/deploy/
        implement/write/generate/design/debug/diagnose/
        investigate/compare/audit/analyze?              → DELEGATE.
STEP 5: Can you do it in 2 or fewer tool calls?         → Do inline. DONE.
        Otherwise                                       → DELEGATE.
```

### How to Delegate

1. Ack the operator: "On it, ~Xmin" (simple=1, medium=3, complex=10)
2. `sessions_spawn(runtime="acp", agentId="claude", task="<detailed>")`
3. Keep chatting. Don't wait.
4. Done → summarize to operator immediately.

**Native sub-agent EXCEPTION** — only if task needs `message`, `browser`, `image_generate`, `tts`, `canvas`.

### Task Description Template

Every task description MUST include:
```
Do [ACTION]. Read [FILE1], [FILE2]. Write output to [PATH].
Do NOT [CONSTRAINT]. Done when [CRITERIA].
Context: [paste facts, don't say "as discussed"]
```

---

## Why Keyword Matching?

A small orchestrator model (Qwen 3.5, 35B parameters) can reliably:
- Scan for the word "build" in a message
- Match against a list of keywords
- Follow deterministic if/then routing rules

It **cannot** reliably:
- Estimate task complexity
- Predict how many tool calls something needs
- Judge whether a request requires deep reasoning
- Assess whether it has enough context to answer

Keyword matching is dumb, fast, and reliable. Complexity estimation with a small model is smart, slow, and wrong half the time. Optimize for the thing that works.

---

## Tier Differences

| Tier | Delegation behavior |
|------|---|
| **FULL** (opus-dm, pv-fund) | Full long-form delegation with runtime selection, task spec, multi-hop reasoning |
| **CLAUDE-CLI** (most agents) | Full delegation minus memory protocol (Claude handles memory natively) |
| **LITE** (DeepSeek fallbacks) | Short form only — keyword match → delegate. No nuance. |
| **QWEN** | Short form + QWEN-RULES.md guardrails (loop prevention, parameter validation) |
