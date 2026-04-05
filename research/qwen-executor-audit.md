# Qwen 3.5 35B Executor Readiness Audit

> **Status (2026-04-05):** This audit has been largely implemented via workspace-v2 migration. The tiered bootstrap system now handles Qwen-specific scaffolding natively:
> - `AGENTS-LITE.md` → `core/DELEGATION.md` (short form, used by LITE/QWEN tiers)
> - `SOUL-LITE.md` → `core/RULES.md` (binary security rules) + `core/VOICE.md` (omitted for LITE tier)
> - `QWEN-RULES.md` → `model-rules/QWEN-RULES.md` (executor guardrails)
> - Token budget achieved: ~7K tokens for QWEN tier (vs ~13.5K old baseline, vs ~15K target in this audit)
> - `build-workspace.sh QWEN <dir>` generates injector-compatible files for Qwen agents
>
> The analysis below remains useful as **design rationale** for the tiered system.

**Context:** Replacing Opus/Sonnet (~$13.50/day) with Qwen 3.5 35B on DeepInfra (~$0.50/day) as daily-driver orchestrator. Qwen has 131K context, $0.07/$0.14 per M tokens input/output, but significantly weaker reasoning, tool-calling, and implicit rule inference.

---

## 1. Executive Summary — Top 10 Changes, Ranked by Impact

| # | Change | Impact | Effort | Why |
|---|--------|--------|--------|-----|
| 1 | **Reduce tool count per agent to ≤5** | Critical | Medium | Qwen degrades severely with >5 tools. Most agents currently expose 10-20+. Gate tools behind router or reduce profiles. |
| 2 | **Rewrite delegation protocol as explicit IF/THEN flowchart** | Critical | Medium | Current 10-row classification table requires judgment. Qwen will misclassify constantly. |
| 3 | **Eliminate multi-hop reasoning requirements** | Critical | High | "Backup before modifying" + "outside git repo" = check git first. Qwen won't chain this. Make each rule self-contained. |
| 4 | **Add few-shot tool-call examples to context** | Critical | Low | Qwen invents parameters. Show exact correct tool calls for the 5 most common patterns. |
| 5 | **Trim context to <40K tokens injected** | High | Medium | Current ~25K chars (~7-8K tokens) of workspace files is manageable, but system prompt + skills + runtime adds 50K+. Every token saved = more room for conversation. |
| 6 | **Create QWEN-RULES.md override file** | High | Low | Qwen-specific guardrails: no nested JSON, no invented params, explicit temp guidance, loop-break rules. |
| 7 | **Wrapper scripts for complex multi-step operations** | High | Medium | Config edit workflow (fetch docs → find key → edit → validate) should be ONE script, not 4 implicit steps. |
| 8 | **Simplify security rules to binary allow/deny** | High | Low | Current nuanced security requires judgment Qwen lacks. |
| 9 | **Remove philosophical/identity content from always-injected context** | Medium | Low | SOUL.md's 12K chars of identity, philosophy, and reading lists waste context on an executor that won't use them. |
| 10 | **Add explicit loop-break and error-recovery rules** | Medium | Low | Qwen at temp=0 loops. Add "if you've called the same tool 2x with same params, STOP and report the error." |

---

## 2. File-by-File Analysis

### 2.1 AGENTS.md (~4,500 tokens)

**Current Role:** Core rules, delegation, security, routing, memory protocol, config edits, emergency contact.

**Implicit Knowledge Opus Infers That Qwen Won't:**

1. **Delegation table (Step 1)**: "Message contains build, create, write..." requires Qwen to scan message text for keywords AND apply first-match priority. Qwen will either always delegate or never delegate.
   - **Fix:** Replace with explicit keyword-match rules: `IF message starts with a question mark OR ends with "?" → INLINE. IF message contains any of [build, create, deploy, implement] → DELEGATE.`

2. **"3+ tool calls" rule**: Requires Qwen to predict how many tools a task needs before starting. Opus estimates this from experience. Qwen will guess wrong.
   - **Fix:** Remove this rule. Replace with: "IF unsure whether to delegate → DELEGATE."

3. **Step 2 (Choose runtime)**: "Default = ACP Claude Code... Use native sub-agent ONLY if task needs these OpenClaw tools" — requires Qwen to analyze which tools a task needs. Complex reasoning.
   - **Fix:** Simplify to: "ALWAYS use `sessions_spawn(runtime: 'acp', agentId: 'claude')` UNLESS the task explicitly mentions: sending a message, generating an image, making a voice note, or controlling a browser. Those 4 = native sub-agent."

4. **Step 3 (Write task description)**: "Sub-agents are blind" is a concept. Qwen needs a template:
   ```
   TEMPLATE: "Do [ACTION]. Read [FILE1], [FILE2]. Write output to [PATH]. Do NOT [CONSTRAINT]. Done when [CRITERIA]."
   ```

5. **File Modification Backup Policy**: "Before modifying any file outside a git repo" requires a three-step reasoning chain.
   - **Fix:** "Before modifying ANY file, run: `cp file file.bak.$(date +%Y%m%d-%H%M%S)`. Exception: files in `~/.openclaw/workspace/` (git-tracked, no backup needed)."

6. **Memory Recall Protocol**: Four different systems with a decision tree. Qwen will use the wrong one or none.
   - **Fix:** Reduce to TWO: (a) `memory_search` for anything you need to recall, (b) read `config/services.yaml` for service configs.

7. **Config Edit Gate**: 4-step process (fetch reference → find key → write edit → validate). Qwen will skip steps.
   - **Fix:** Create `scripts/config-edit-safe.sh <key_path> <value>` that does all 4 steps.

8. **Lane Blocking Prevention**: "NEVER do long-running work inline" requires understanding what "long-running" means.
   - **Fix:** "If you need to run MORE THAN 2 exec commands → DELEGATE to a sub-agent. No exceptions."

**Trim Recommendations:**
- Move "Emergency Contact" section to on-demand file (~200 tokens)
- Move "Config Edits" to a wrapper script + 1-line reference
- Move email/alias sections to on-demand (triggered by email tasks)
- **Estimated savings: ~1,500 tokens (33%)**

---

### 2.2 SOUL.md (~3,500 tokens)

**Current Role:** Identity, philosophy, persona, anti-sycophancy, security policy, boundaries.

**Problems for Qwen:**

1. **Anti-sycophancy protocol**: 7 nuanced rules about when to challenge vs agree. These require genuine judgment.
   - **Fix:** For Qwen: "Be concise. Answer the question. Don't add opinions unless asked."

2. **Business Identity**: Requires persona embodiment. Qwen will mix first/third person randomly.
   - **Fix:** One rule: "When contacting external parties, always use first person. You ARE the business owner."

3. **Security Policy**: Judgment calls like "prefer safe paths" and "brief rationale okay if it doesn't reveal internals."
   - **Fix:** Binary rules: operator → full access; not operator → NEVER share system details.

4. **Philosophy sections**: Wasted on an executor model.
   - **Fix:** Remove from always-injected. Keep in `SOUL-FULL.md` for premium model sessions.

**Trim Recommendations:**
- Create `SOUL-LITE.md` for Qwen (~800 tokens)
- Keep full `SOUL.md` for Opus override sessions
- **Estimated savings: ~2,700 tokens (77%)**

---

### 2.3 TOOLS.md (~1,400 tokens)

- Wrap multi-step procedures in single scripts
- Keep service table as-is with explicit "use EXACTLY this command" note
- **Estimated savings: ~300 tokens (21%)**

### 2.4 MEMORY.md (~2,500 tokens)

- Expand abbreviated entries for Qwen
- Add explicit triggers for cross-references
- Keep rule duplicates (reinforcement helps Qwen)
- **Estimated savings: ~600 tokens (24%)**

---

## 3. Token Budget

### Current vs Target

| File | Current Tokens | Target Tokens |
|------|---------------|---------------|
| AGENTS.md | ~4,500 | ~3,000 |
| SOUL.md | ~3,500 | ~800 |
| TOOLS.md | ~1,400 | ~1,100 |
| MEMORY.md | ~2,500 | ~1,900 |
| IDENTITY.md | ~280 | ~280 |
| USER.md | ~280 | ~280 |
| HEARTBEAT.md | ~1,400 | ~900 |
| CLAUDE.md | ~640 | 0 (not for Qwen) |
| System prompt | ~4,000 | ~4,000 |
| Skills/runtime | ~2,800 | ~1,800 |
| **Total** | **~21,300** | **~14,060** |

Target: ≤15K tokens injected, leaving 116K for conversation + tool results.

---

## 4. New Files Created

| File | Purpose | Tokens |
|------|---------|--------|
| `QWEN-RULES.md` | Executor guardrails, common mistakes, loop prevention | ~500 |
| `SOUL-LITE.md` | Minimal identity + binary security rules | ~800 |
| `AGENTS-LITE.md` | Simplified delegation, routing, core rules | ~2,500 |
| `scripts/config-edit-safe.sh` | 4-step config edit in one command | N/A |
| `scripts/retell-task-call.sh` | 5-step Retell call in one command | N/A |
| `scripts/heartbeat-all.sh` | Consolidated health checks | N/A |

---

## 5. Tool Simplification Plan

### Proposed Tool Profiles for Qwen Agents

**Profile: qwen-minimal (for group chats, voice agent)**
1. `message` — send messages, react
2. `exec` — run scripts
3. `web_search` — search the web
4. `memory_search` — recall past context
5. `read` — read files

**Profile: qwen-dm (for direct message agents)**
1. `message` — send messages
2. `exec` — run commands
3. `sessions_spawn` — delegate to sub-agents
4. `memory_search` — recall
5. `read` — read files

**Profile: qwen-heartbeat (for heartbeat agent)**
1. `exec` — run health check scripts
2. `read` — read files
3. `memory_search` — recall
4. `memory_get` — get specific memory lines
5. `sessions_spawn` — delegate task execution

---

## 6. Decision Tree Rewrites

### 6.1 Delegation (Qwen-Safe)

```
STEP 1: Is the message a question?
  YES → Answer directly. DONE.

STEP 2: Is the message a greeting, thanks, or opinion request?
  YES → Reply directly. DONE.

STEP 3: Does the message ask to send/react/forward?
  YES → Use the message tool. DONE.

STEP 4: Does the message ask to build/create/research/fix/debug/deploy/implement?
  YES → DELEGATE.

STEP 5: Can you complete this in 2 or fewer tool calls?
  YES → Do it directly. DONE.
  NO → DELEGATE.

DELEGATION:
  - Say "On it, ~X minutes"
  - Run: sessions_spawn(runtime="acp", agentId="claude", task="<detailed task>")
  - Continue chatting. Don't wait.

EXCEPTION — Native sub-agent ONLY for: messaging, image gen, TTS, browser.
```

### 6.2 Security Routing (Qwen-Safe)

```
Is sender the verified operator?
  YES → Full access. Execute anything.
  NO  → NEVER share system details. General knowledge only.
        If they ask about your system → NO_REPLY.
```

### 6.3 Message Routing (Qwen-Safe)

```
Replying to operator in DM? → Just reply normally.
Replying in a group? → Just reply normally.
Non-operator sent a DM? → Reply to THEM via message tool, notify operator, then NO_REPLY.
Operator asks to message someone? → Use message tool with their ID.
```

---

## 7. Failure Mode Catalog

| ID | Failure | Trigger | Mitigation |
|----|---------|---------|------------|
| F1 | Infinite loop | temp=0 | Set temp ≥ 0.1. Loop-break rule. |
| F2 | Invented params | Qwen adds nonexistent params | List common wrong params in QWEN-RULES.md. |
| F3 | Hallucinated paths | References nonexistent files | Rule: "If unsure, `ls` first." |
| F4 | Over-reasoning | Simple question → essay | Rule: "Simple questions → ONE LINE." |
| F5 | Nested JSON fails | Deep nesting in tool params | Use wrapper scripts. |
| F6 | Context overflow | Large reads/outputs | Max 500 lines per read, `| head -100`. |
| F7 | Vague delegation | "Do the thing" task description | Task description template. |
| F8 | Security leak | Shares system details | Binary security rules. |
| F9 | Duplicate messages | Sends + replies | "After message send → NO_REPLY." |
| F10 | Wrong routing | Private → group or vice versa | Explicit routing rules. |
| F11 | Re-reads context | Uses read on injected files | "Context files ALREADY injected." |

---

## 8. Migration Checklist

### Phase 1: Scaffolding
- [ ] Create `QWEN-RULES.md`, `SOUL-LITE.md`, `AGENTS-LITE.md`
- [ ] Create wrapper scripts (`config-edit-safe.sh`, `heartbeat-all.sh`)
- [ ] Add few-shot examples to QWEN-RULES.md

### Phase 2: Configuration
- [ ] Restrict Qwen tool profiles to ≤5 per agent
- [ ] Inject QWEN-RULES.md + SOUL-LITE.md for Qwen agents
- [ ] Set temperature ≥ 0.1
- [ ] Configure Sonnet fallback

### Phase 3: Testing
- [ ] Start with lowest-risk agent
- [ ] Test: Q&A, delegation, routing, security, heartbeat, tool calling, loops
- [ ] Monitor 48h before expanding

### Phase 4: Expansion
- [ ] Roll Qwen to additional agents incrementally
- [ ] Keep operator DM + financial agents on premium model

### Phase 5: Monitoring
- [ ] Track cost, fallback rate, and failure patterns
- [ ] Iterate on QWEN-RULES.md based on observed issues

---

## Appendix: Cost Analysis

| Model | Input $/M | Output $/M | Est. Daily Cost |
|-------|-----------|-----------|-----------------|
| Opus 4 | $15.00 | $75.00 | ~$22.50 |
| Sonnet 4.5 | $3.00 | $15.00 | ~$4.50 |
| Qwen 3.5 35B | $0.07 | $0.14 | ~$0.063 |
| **Savings (Qwen vs Sonnet)** | | | **~$4.44/day = $133/mo** |

## Appendix: Architecture

```
                    User Message
                         │
                    ┌────┴────┐
                    │  Qwen   │  ← Simple routing brain (≤5 tools)
                    │ (cheap) │
                    └────┬────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         Answer      Delegate    Route
         Inline    to Claude    Message
         (simple)    Code ($0)   (send)
                      │
                 ┌────┴────┐
                 │ Claude  │  ← Does all complex work
                 │  Code   │
                 │  (ACP)  │
                 └─────────┘
```

Qwen is the receptionist. Claude Code is the back office. The receptionist doesn't need to be brilliant — they need to route calls correctly and not leak information.
