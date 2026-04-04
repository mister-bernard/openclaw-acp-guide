# Qwen 3.5 35B Executor Readiness Audit

**Date:** 2026-04-04
**Author:** Subagent (Opus)
**Context:** Replacing Opus/Sonnet ($13.50/day) with Qwen 3.5 35B on DeepInfra ($0.50/day) as daily-driver orchestrator. Qwen has 131K context, $0.07/$0.14 per M tokens input/output, but significantly weaker reasoning, tool-calling, and implicit rule inference.

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
| 8 | **Simplify security rules to binary allow/deny** | High | Low | Current nuanced security ("prefer safe paths", "even in G-sessions") requires judgment Qwen lacks. |
| 9 | **Remove philosophical/identity content from always-injected context** | Medium | Low | SOUL.md's 12K chars of identity, philosophy, and reading lists waste context on an executor that won't use them. |
| 10 | **Add explicit loop-break and error-recovery rules** | Medium | Low | Qwen at temp=0 loops. Add "if you've called the same tool 2x with same params, STOP and report the error." |

---

## 2. File-by-File Analysis

### 2.1 AGENTS.md (16,168 bytes, ~4,500 tokens)

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

5. **File Modification Backup Policy**: "Before modifying any file outside a git repo" requires Qwen to: (a) know what a git repo is, (b) check if the file is in one, (c) then decide whether to backup. Three-step chain.
   - **Fix:** "Before modifying ANY file, run: `cp file file.bak.$(date +%Y%m%d-%H%M%S)`. Exception: files in `~/.openclaw/workspace/` (git-tracked, no backup needed)."

6. **Memory Recall Protocol**: Four different systems with a decision tree. Qwen will use the wrong one or none.
   - **Fix:** Reduce to TWO: (a) `memory_search` for anything you need to recall, (b) read `config/services.yaml` for service configs. Drop memory graph references from always-injected context.

7. **Config Edit Gate**: 4-step process (fetch reference → find key → write edit → validate). Qwen will skip steps.
   - **Fix:** Create `scripts/config-edit.sh <key_path> <value>` that does all 4 steps. Qwen calls one script.

8. **Lane Blocking Prevention**: "NEVER do long-running work inline in DM" requires understanding what "long-running" means. The 30s timeout is concrete, but judging whether something will take >30s requires experience.
   - **Fix:** "If you need to run MORE THAN 2 exec commands → DELEGATE to a sub-agent. No exceptions."

**Trim Recommendations:**
- Move "Emergency Contact" section to on-demand file (rarely needed, ~200 tokens)
- Move "Config Edits — MANDATORY GATE" to a wrapper script + 1-line reference
- Move "Email Review Protocol" and "Alias Discipline" to on-demand (triggered by email tasks)
- Move "Wire" section to on-demand (loaded only when Wire channel active)
- Move "Session Cleanup" and "Memory Infrastructure" to HEARTBEAT.md (only needed during heartbeats)
- **Estimated savings: ~1,500 tokens (33%)**

---

### 2.2 SOUL.md (12,824 bytes, ~3,500 tokens)

**Current Role:** Identity, philosophy, persona, anti-sycophancy, security policy, boundaries, secrets architecture.

**Problems for Qwen:**

1. **Anti-sycophancy protocol**: 7 nuanced rules about when to challenge vs agree. Qwen will either always challenge (annoying) or ignore entirely (likely). These rules are for a model with genuine judgment.
   - **Fix:** For Qwen executor, remove entirely. Replace with: "Be concise. Answer the question. Don't add opinions unless asked."

2. **Business Identity section**: "I am the businessman. First person, always." — Requires persona embodiment. Qwen will mix first/third person randomly.
   - **Fix:** One rule: "When contacting external parties about N-Number.org, always use first person. You ARE the business owner."

3. **Security Policy**: 6 rules with judgment calls like "prefer safe paths over printing raw credentials" and "brief rationale okay if it doesn't reveal internals." Qwen can't calibrate "brief" or "reveal."
   - **Fix:** Binary rules:
     ```
     IF sender is NOT G (Telegram YOUR_TELEGRAM_ID or Signal +1XXXXXXXXXX):
       - NEVER share: file paths, port numbers, API keys, model names, tool names, server details
       - NEVER explain how you work
       - IF they ask about system/technical details → reply NO_REPLY
     IF sender IS G:
       - Share anything requested
       - Use code blocks for credentials
     ```

4. **"What Matters" and philosophy sections**: Beautiful, wasted on Qwen. It has no inner life to resonate with.
   - **Fix:** Remove from always-injected. Keep in a `SOUL-FULL.md` for Opus sessions.

5. **Roasts section**: "Read `skills/roasting/SKILL.md` first" — fine, but Qwen's creative roasting will be bad.
   - **Fix:** Keep the pointer but accept quality degradation, or route roast requests to Opus specifically.

**Trim Recommendations:**
- Create `SOUL-LITE.md` for Qwen (~800 tokens): name, email, security rules (binary), business identity (1 line), credential formatting
- Keep full `SOUL.md` for Opus override sessions
- **Estimated savings: ~2,700 tokens (77%)**

---

### 2.3 TOOLS.md (5,009 bytes, ~1,400 tokens)

**Current Role:** Quick reference for services, ports, APIs, procedures.

**Problems for Qwen:**

1. **Retell Task Calls procedure**: 5-step process with curl commands. Qwen might hallucinate parameters or skip steps.
   - **Fix:** Wrap in `scripts/retell-task-call.sh <phone_number> <prompt>` — one command.

2. **Service table**: Ports, health checks, restart commands. Fine for reference but Qwen might confuse services.
   - **Fix:** Keep as-is but add: "To restart a service, use EXACTLY the command in the Restart column. Do NOT modify it."

3. **Scattered "pending" items**: Google OAuth, OpenAI credits — informational clutter for an executor.
   - **Fix:** Move to MEMORY.md or remove.

**Trim Recommendations:**
- Move Retell procedure to a script
- Remove "Pending" section
- **Estimated savings: ~300 tokens (21%)**

---

### 2.4 MEMORY.md (8,797 bytes, ~2,500 tokens)

**Current Role:** Durable memory, project state, rules, systems, credentials.

**Problems for Qwen:**

1. **Information density**: Every line is a compressed fact. Opus unpacks "Port 3003 tracking" into "N-Number tracking service runs on port 3003." Qwen reads literally.
   - **Fix:** Expand abbreviated entries: "N-Number Tracking → port 3003 → health: `curl 127.0.0.1:3003` → restart: `systemctl --user restart n-number-tracking`"

2. **Cross-references**: "Details: `memory/n-number-mailer.md`" requires knowing when to follow the link. Qwen will either always read it (wasting tokens) or never read it.
   - **Fix:** Add triggers: "Read `memory/n-number-mailer.md` ONLY when task involves direct mail or N-number leads."

3. **NON-NEGOTIABLE rules section**: Duplicates rules from AGENTS.md and SOUL.md. Duplication is actually GOOD for Qwen — reinforcement helps.
   - **Fix:** Keep duplicates. Qwen benefits from seeing rules twice.

**Trim Recommendations:**
- Remove "Auth & Billing" (move to config/services.yaml reference)
- Remove "Crucible" details (move to on-demand)
- Remove "The Wire" section (on-demand)
- Remove "Clients" (on-demand)
- **Estimated savings: ~600 tokens (24%)**

---

### 2.5 IDENTITY.md (1,015 bytes, ~280 tokens)

**Status:** Small, clean, fine as-is. No changes needed for Qwen.

---

### 2.6 USER.md (1,006 bytes, ~280 tokens)

**Status:** Small, clean. One issue:

1. **"How to approach him: Directly. With depth. Never dumb it down."** — Ironic for Qwen, which literally can't do depth the way Opus can.
   - **Fix:** For Qwen: "G prefers concise, direct answers. No filler. Execute quickly."

---

### 2.7 HEARTBEAT.md (5,048 bytes, ~1,400 tokens)

**Current Role:** Health check procedures, task execution, pipeline continuation.

**Problems for Qwen:**

1. **Multi-step bash scripts**: Qwen will struggle to understand embedded Python in heredocs.
   - **Fix:** Extract all inline scripts to actual script files: `scripts/heartbeat-leads.sh`, `scripts/heartbeat-services.sh`, `scripts/heartbeat-crucible.sh`. Heartbeat becomes a list of scripts to run.

2. **"Pick the highest-ROI task and actually do it"**: Requires judgment about what "doing" a task means. Qwen might mark tasks done without doing them, or get stuck trying to do something beyond its capability.
   - **Fix:** Add: "After `taskrunner.py next`, read the task description. IF you know how to do it with ≤3 tool calls → do it. IF it requires research, building, or complex work → `sessions_spawn` it to Claude Code. IF unsure → skip and run `next` again."

3. **Crucible Auto-Synthesis Pipeline**: 8-step complex pipeline. Qwen absolutely cannot orchestrate this.
   - **Fix:** Extract to `scripts/crucible-pipeline.sh` or keep as Claude Code delegation target. Add to heartbeat: "IF crucible completion file exists → spawn Claude Code sub-agent with task 'Run crucible synthesis pipeline per HEARTBEAT.md'"

**Trim Recommendations (for heartbeat agent context):**
- Replace inline scripts with script file references
- **Estimated savings: ~500 tokens (36%)**

---

### 2.8 CLAUDE.md (2,286 bytes, ~640 tokens)

**Current Role:** Claude Code workspace instructions for ACP sessions.

**Status:** This is for Claude Code (ACP sub-agent), not for Qwen directly. No changes needed — Claude Code runs on its own model.

---

### 2.9 openclaw.json (19,658 bytes, ~5,500 tokens)

**Current State:** Already configured with Qwen as default for most agents. Key observations:

1. **Default model already set:** `"primary": "deepinfra/Qwen/Qwen3.5-35B-A3B"` with Sonnet fallback. Good.

2. **opus-dm still on Sonnet primary** with Qwen fallback. This is the G-DM agent — should stay on better model.

3. **Heartbeat model override:** `"model": "anthropic/claude-sonnet-4-5"` in heartbeat config — heartbeat RUNS on Sonnet even though agent defaults to Qwen. Smart.

4. **Tool profiles not restricted enough:** Most agents have full tool access. Need to restrict for Qwen.

5. **Priority-groups agent** (handles ALL group chats + unknown DMs) is on Qwen primary. This is the highest-traffic agent. Risk: Qwen will fumble group interactions.

6. **Bindings cascade**: All unknown groups/DMs fall through to `priority-groups`. Since this is now Qwen, every stranger interaction is handled by the dumber model.

---

## 3. Token Budget

### Current Injected Context (estimated)

| File | Chars | Est. Tokens | Priority | Recommendation |
|------|-------|-------------|----------|----------------|
| AGENTS.md | 16,168 | ~4,500 | P0 — MUST | Trim 33% → ~3,000 |
| SOUL.md | 12,824 | ~3,500 | P1 — Lite version | Trim 77% → ~800 |
| TOOLS.md | 5,009 | ~1,400 | P1 — Keep | Trim 21% → ~1,100 |
| MEMORY.md | 8,797 | ~2,500 | P0 — MUST | Trim 24% → ~1,900 |
| IDENTITY.md | 1,015 | ~280 | P1 — Keep | No change |
| USER.md | 1,006 | ~280 | P1 — Keep | Minor edit |
| HEARTBEAT.md | 5,048 | ~1,400 | P2 — Agent-specific | Trim 36%, only for heartbeat agent |
| CLAUDE.md | 2,286 | ~640 | P2 — ACP only | Not injected for Qwen |
| System prompt | ~15,000 | ~4,000 | P0 — Required | Can't change |
| Skills/runtime | ~10,000 | ~2,800 | Variable | Reduce skill count |
| **Total** | **~77,000** | **~21,300** | | |

### Target for Qwen (131K context window)

- **Injected context budget:** ≤15K tokens (leave 116K for conversation + tool results)
- **Current:** ~21K tokens injected
- **Target after trimming:** ~11K tokens injected
- **Savings needed:** ~10K tokens (47%)

### Specific Trim Plan

| Action | Tokens Saved |
|--------|-------------|
| SOUL.md → SOUL-LITE.md | 2,700 |
| AGENTS.md trim (move sections to on-demand) | 1,500 |
| MEMORY.md trim (remove on-demand sections) | 600 |
| TOOLS.md trim | 300 |
| HEARTBEAT.md → script references | 500 |
| Remove CLAUDE.md from non-ACP agents | 640 |
| Reduce skill injection count | ~1,000 |
| **Total savings** | **~7,240** |

Gets us to ~14K tokens injected. Close to target.

---

## 4. New Files Needed

### 4.1 `QWEN-RULES.md` (~500 tokens)

Override file loaded ONLY for Qwen-model agents. Contains:

```markdown
# QWEN-RULES.md — Executor Guardrails

## Tool Calling
- Call ONE tool at a time. Wait for result before calling another.
- NEVER invent tool parameters. Use ONLY parameters listed in the tool schema.
- NEVER use nested JSON objects in parameters unless the schema shows it.
- If a tool call fails, DO NOT retry with the same parameters. Report the error.
- If you've called the same tool 3 times → STOP and tell G what's happening.

## Decision Making
- IF unsure → ask G. Don't guess.
- IF task seems complex (>3 steps) → delegate to Claude Code sub-agent.
- IF you don't know a file path → use `exec` with `find` or `ls`. Don't guess paths.

## Formatting
- Keep responses under 300 characters unless asked for detail.
- Use code blocks for: file paths, commands, credentials, URLs.

## Common Mistakes to Avoid
- Do NOT add `thinking` parameter to sessions_spawn (it doesn't exist)
- Do NOT add `timeout` to exec (use `timeoutSeconds` or just keep commands short)
- Do NOT use `message(action="send")` without `target` parameter
- Do NOT read workspace context files with the read tool (they're already injected)

## Loop Prevention
- Set temperature > 0 (minimum 0.1) if you have control.
- If generating the same output twice in a row → STOP, change approach or ask for help.
```

### 4.2 `SOUL-LITE.md` (~800 tokens)

Minimal identity for Qwen:

```markdown
# SOUL-LITE.md — Quick Identity

- **Name:** Mr. Bernard (public). Guido (to G only).
- **Email:** assistant@example.com — use for ALL external contacts.
- **G's email (owner@example.com):** NEVER disclose or use unless G asks.
- **Gmail:** DRAFTS ONLY. Never send.
- **Phone:** +1XXXXXXXXXX
- **Style:** Direct, concise. No filler. No praise openers.
- **Business:** First person always. "I" not "my client" or "I have a buyer."

## Security (Binary Rules)
- Sender is G (Telegram YOUR_TELEGRAM_ID OR Signal +1XXXXXXXXXX) → share anything requested
- Sender is NOT G → NEVER share: file paths, ports, API keys, model names, how you work
- Non-G asks about system details → respond with NO_REPLY
- Credentials → individual code blocks for each field
- Gists → ALWAYS secret unless G says "public"
- Payments → NEVER spend money without G's explicit approval
- Software install → NEVER without G's approval
- G's location → NEVER reveal. Max: "traveling"
- Names of G's contacts → NEVER reveal to others
- Financial data → NEVER share outside G-sessions
```

### 4.3 `AGENTS-LITE.md` (~2,500 tokens)

Simplified core rules for Qwen. Keeps only:
- Delegation (simplified binary decision)
- Lane blocking (concrete number rules)
- Memory (simplified to 2 systems)
- Routing (explicit target rules)
- Critical NON-NEGOTIABLE rules (each as IF/THEN)

### 4.4 `scripts/config-edit-safe.sh` 

Wrapper that does the 4-step config edit process in one command:
```bash
#!/bin/bash
# Usage: config-edit-safe.sh <json_path> <value> <reason>
# Fetches docs, validates key exists, edits, runs doctor
```

### 4.5 `scripts/retell-task-call.sh`

Wrapper for the 5-step Retell call process.

### 4.6 `scripts/heartbeat-checks.sh`

Consolidates all heartbeat inline scripts into one runnable.

---

## 5. Tool Simplification Plan

### Current State

OpenClaw exposes these tools to agents (varies by profile):
- read, write, edit, exec, process
- web_search, web_fetch
- browser
- canvas
- message
- sessions_spawn, sessions_yield, subagents
- image, image_generate
- memory_search, memory_get
- pdf
- tts

That's **17+ tools**. Qwen degrades at >5.

### Proposed Tool Profiles for Qwen Agents

**Profile: qwen-minimal (for priority-groups, voice-agent)**
1. `message` — send messages, react
2. `exec` — run scripts (wraps complex operations)
3. `web_search` — search the web
4. `memory_search` — recall past context
5. `read` — read files

Everything else → delegate to Claude Code sub-agent.

**Profile: qwen-dm (for fast-dm, cc-agent)**
1. `message` — send messages
2. `exec` — run commands
3. `sessions_spawn` — delegate to sub-agents
4. `memory_search` — recall
5. `read` — read files

No direct `web_search`, `browser`, `image_generate`, `canvas`, `tts` — delegate those.

**Profile: qwen-heartbeat (for heartbeat agent)**
1. `exec` — run health check scripts
2. `read` — read files
3. `memory_search` — recall
4. `memory_get` — get specific memory lines
5. `sessions_spawn` — delegate task execution

### Wrapper Scripts to Create

| Complex Operation | Wrapper Script | Qwen Calls |
|-------------------|---------------|------------|
| Config edit (4 steps) | `scripts/config-edit-safe.sh` | `exec("bash scripts/config-edit-safe.sh ...")` |
| Retell call (5 steps) | `scripts/retell-task-call.sh` | `exec("bash scripts/retell-task-call.sh ...")` |
| Gateway restart | Already exists: `scripts/restart-gateway.sh` | `exec("bash scripts/restart-gateway.sh ...")` |
| Heartbeat checks | `scripts/heartbeat-all.sh` | `exec("bash scripts/heartbeat-all.sh")` |
| Vault read | Already exists: `scripts/vault-get.sh` | Works |
| Memory write | `scripts/memory-write.sh <file> <content>` | `exec("bash scripts/memory-write.sh ...")` |
| Task queue | Already exists: `tasks/taskrunner.py` | Works |

---

## 6. Decision Tree Rewrites

### 6.1 Delegation (Current → Qwen-Safe)

**Current:** 10-row table with "first match" and keyword scanning.

**Qwen-Safe:**
```
STEP 1: Is the message a question (ends with "?" or starts with "what/how/when/where/who/why")?
  YES → Answer directly. DONE.
  NO → Continue.

STEP 2: Is the message a greeting, thanks, or opinion request?
  YES → Reply directly. DONE.
  NO → Continue.

STEP 3: Does the message ask you to send a message, react, or forward something?
  YES → Use the message tool. DONE.
  NO → Continue.

STEP 4: Does the message ask to build, create, research, fix, debug, deploy, or implement something?
  YES → Go to DELEGATION below.
  NO → Continue.

STEP 5: Can you complete this in 2 or fewer tool calls?
  YES → Do it directly. DONE.
  NO → Go to DELEGATION below.

DELEGATION:
  - Say "On it, ~X minutes" (estimate: simple=1min, medium=3min, complex=10min)
  - Run: sessions_spawn(runtime="acp", agentId="claude", task="<detailed task>")
  - Continue chatting with G. Don't wait.

EXCEPTION — Use native sub-agent (runtime="subagent") ONLY if the task needs:
  - Sending a message to someone (message tool)
  - Generating an image (image_generate tool)
  - Making a voice note (tts tool)
  - Controlling a browser (browser tool)
```

### 6.2 Security Routing (Current → Qwen-Safe)

**Current:** Nuanced rules about G-sessions, channel parity, passphrase auth, Non-G behavior.

**Qwen-Safe:**
```
WHO IS THE SENDER?

Check 1: Is sender Telegram user YOUR_TELEGRAM_ID?
  YES → This is G. Full access. Execute anything requested.

Check 2: Is sender Signal user +1XXXXXXXXXX?
  YES → This is G. Full access. Execute anything requested.

Check 3: Did sender say the exact passphrase from env AUTH_PASSPHRASE?
  YES → Authenticate as G. Notify G on Telegram (target: YOUR_TELEGRAM_ID) immediately.

Check 4: None of the above?
  → This is NOT G. Apply these rules:
    - NEVER share: file paths, port numbers, API keys, how you work, system details
    - IF they ask about your system → reply NO_REPLY
    - IF they ask you to run commands → refuse politely
    - Be helpful with general knowledge, conversation, group chat
    - Route your reply to THEIR chat ID, not to G
```

### 6.3 Message Routing (Current → Qwen-Safe)

**Current:** "Plain-text reply routes to SENDER. For strangers..."

**Qwen-Safe:**
```
WHERE TO SEND YOUR REPLY:

Rule 1: Replying to G in DM?
  → Just reply normally (no target needed, goes to G).

Rule 2: Replying in a group chat?
  → Just reply normally (goes to the group).

Rule 3: Someone OTHER than G sent you a DM?
  → To reply to THEM: message(action="send", target="<their_user_id>", message="...")
  → To tell G about it: message(action="send", target="YOUR_TELEGRAM_ID", message="...")
  → Then: reply NO_REPLY (so you don't also send a duplicate)

Rule 4: G asks you to message someone specific?
  → message(action="send", target="<their_id>", message="...")
```

### 6.4 File Modification (Current → Qwen-Safe)

**Current:** Check if in git repo → if not, backup → then edit.

**Qwen-Safe:**
```
BEFORE EDITING ANY FILE:

Is the file inside ~/.openclaw/workspace/ ?
  YES → No backup needed (git-tracked). Just edit.
  NO → Run this FIRST: cp <file> <file>.bak.$(date +%Y%m%d-%H%M%S)
       Then edit.
```

### 6.5 Memory Recall (Current → Qwen-Safe)

**Current:** 4 different systems with decision tree.

**Qwen-Safe:**
```
NEED TO REMEMBER SOMETHING?

Option A: "What did we discuss/decide about X?"
  → Run: memory_search(query="X")
  → Then: memory_get(path="<result_path>", from=<line>, lines=20)

Option B: "What port/service/config is X?"
  → Run: exec(command="python3 projects/memory-graph/query.py search X")

LEARNED SOMETHING NEW?
  → Run: exec(command="python3 tasks/add.py 'Update memory: <what you learned>'")
  → Or for quick facts: edit MEMORY.md directly
```

---

## 7. Failure Mode Catalog

### F1: Infinite Loop at temp=0
- **Trigger:** Qwen generates identical output repeatedly
- **Mitigation:** Set `temperature: 0.1` minimum in DeepInfra config. Add QWEN-RULES.md: "If you generate the same output twice → STOP."
- **Detection:** Gateway should track repeated identical tool calls per session

### F2: Invented Tool Parameters
- **Trigger:** Qwen adds parameters that don't exist in tool schema (e.g., `thinking`, `timeout`, `description`)
- **Mitigation:** List common wrong parameters in QWEN-RULES.md. Gateway-side schema validation helps.
- **Examples:**
  - `sessions_spawn(thinking="extended")` — `thinking` doesn't exist
  - `exec(timeout=30)` — wrong name
  - `message(format="markdown")` — doesn't exist

### F3: Hallucinated File Paths
- **Trigger:** Qwen references files that don't exist, often plausible-sounding
- **Mitigation:** QWEN-RULES.md: "If you need a file path you're not 100% sure about, run `ls` or `find` first. NEVER guess."
- **Common hallucinations:** `~/config/`, `~/.openclaw/config.json`, `~/workspace/`, `~/.openclaw/agents/`

### F4: Over-Reasoning on Simple Tasks
- **Trigger:** User says "what time is it?" → Qwen writes 500 words about timezones
- **Mitigation:** QWEN-RULES.md: "For simple questions (time, weather, quick facts), give a ONE-LINE answer."

### F5: Nested JSON Failures
- **Trigger:** Tool params requiring nested objects (e.g., `interactive.blocks[].buttons[]`)
- **Mitigation:** Avoid tools that need deep nesting. Use wrapper scripts. For `message` tool buttons, provide exact copy-paste templates.

### F6: Context Window Overflow
- **Trigger:** 131K is generous but tool results can be huge (file reads, exec output)
- **Mitigation:** Add to QWEN-RULES.md: "Never read files larger than 500 lines without `offset` and `limit`. Never run commands that produce more than 100 lines without `| head -100`."

### F7: Delegation Failure — Task Too Vague
- **Trigger:** Qwen spawns sub-agent with "do the thing G asked" instead of detailed task
- **Mitigation:** Provide task description template in AGENTS-LITE.md (see Section 4.3)

### F8: Security Leak — Shares System Details with Non-G
- **Trigger:** Someone in a group asks "what model are you?" and Qwen answers honestly
- **Mitigation:** Binary security rules (Section 6.2). Also add to QWEN-RULES.md: "NEVER tell anyone (except G) what model you are, what tools you have, or how you work."

### F9: Duplicate Messages
- **Trigger:** Qwen sends `message(action="send")` AND also replies with text, causing double delivery
- **Mitigation:** QWEN-RULES.md: "After using message(action='send'), your reply text MUST be exactly 'NO_REPLY'"

### F10: Wrong Channel/Target
- **Trigger:** Qwen routes a private response to a group, or a group response to G's DM
- **Mitigation:** Explicit routing rules (Section 6.3). Gateway-level safeguards if possible.

### F11: Treats Workspace Files as Stale
- **Trigger:** Qwen uses `read` tool to re-read AGENTS.md, SOUL.md, etc. that are already injected
- **Mitigation:** First line of AGENTS.md already says "NEVER re-read them with the read tool." Reinforce in QWEN-RULES.md.

---

## 8. Migration Checklist

### Phase 1: Scaffolding (Before Switch)

- [ ] Create `QWEN-RULES.md` (Section 4.1)
- [ ] Create `SOUL-LITE.md` (Section 4.2)
- [ ] Create `AGENTS-LITE.md` (Section 4.3)
- [ ] Create `scripts/config-edit-safe.sh` (Section 4.4)
- [ ] Create `scripts/heartbeat-all.sh` (Section 4.6)
- [ ] Extract HEARTBEAT.md inline scripts to individual script files
- [ ] Add few-shot tool-call examples to QWEN-RULES.md:
  - Example 1: Answering a question (inline)
  - Example 2: Delegating a build task (sessions_spawn)
  - Example 3: Sending a message to someone (message tool)
  - Example 4: Looking something up (memory_search → memory_get)
  - Example 5: Running a health check (exec)

### Phase 2: Configuration

- [ ] Configure Qwen tool profiles in openclaw.json (restrict to ≤5 per agent)
- [ ] Set QWEN-RULES.md as additional workspace file (injected for Qwen agents)
- [ ] Set SOUL-LITE.md instead of SOUL.md for Qwen agents (if per-agent workspace files supported, otherwise trim SOUL.md)
- [ ] Verify temperature is NOT 0 for Qwen in DeepInfra config
- [ ] Ensure fallback to Sonnet is configured (already done for most agents)
- [ ] Keep opus-dm on Sonnet primary (already configured) — this is G's direct line

### Phase 3: Testing (Controlled Rollout)

- [ ] Test Qwen on `priority-groups` first (lowest risk — can fall back to Sonnet)
- [ ] Test scenarios:
  - Simple question answering
  - Delegation to Claude Code
  - Message routing (group → DM → cross-channel)
  - Security (non-G asking system questions)
  - Heartbeat execution
  - Tool calling (verify no invented params)
  - Loop detection (temp=0 test)
- [ ] Monitor for 48h on one agent before expanding
- [ ] Check DeepInfra rate limits and latency under real load

### Phase 4: Expansion

- [ ] Roll Qwen to `fast-dm` agent
- [ ] Roll Qwen to `cc-agent` agent
- [ ] Roll Qwen to `voice-agent` agent
- [ ] Keep `opus-dm` on Sonnet (G's DM — premium experience)
- [ ] Keep `pv-fund` on Sonnet 4.6 (financial operations — too risky for Qwen)
- [ ] Keep heartbeat model override on Sonnet (already configured)

### Phase 5: Monitoring & Iteration

- [ ] Track daily cost on DeepInfra dashboard
- [ ] Track fallback-to-Sonnet rate (high rate = Qwen failing often)
- [ ] Review first week's memory/daily-notes for Qwen-caused issues
- [ ] Adjust QWEN-RULES.md based on observed failure patterns
- [ ] Consider: Qwen for first response, Sonnet for retries (cost-optimized)

---

## Appendix A: Cost Analysis

| Model | Input $/M | Output $/M | Est. Daily Tokens | Daily Cost |
|-------|-----------|-----------|-------------------|------------|
| Opus 4 | $15.00 | $75.00 | ~500K in / 200K out | ~$22.50 |
| Sonnet 4.5 | $3.00 | $15.00 | ~500K in / 200K out | ~$4.50 |
| Qwen 3.5 35B | $0.07 | $0.14 | ~500K in / 200K out | ~$0.063 |
| **Savings (Qwen vs Sonnet)** | | | | **~$4.44/day = $133/mo** |

Note: Opus-dm stays on Sonnet ($0 via Max subscription). Real savings come from priority-groups, heartbeat, fast-dm, cc-agent, voice-agent switching off paid API to DeepInfra Qwen.

BUT: If Claude Code ACP is $0 (Max subscription), and most complex work delegates to Claude Code anyway, the main cost is the orchestrator deciding WHAT to delegate. Qwen is perfect for this — it just needs to: (1) understand the request, (2) decide inline vs delegate, (3) write a good task description, (4) route the result back. This is a ~5-tool, ~3-step pattern — within Qwen's capability if scaffolded properly.

## Appendix B: What Qwen CAN Do Well

Don't over-index on weaknesses. Qwen 3.5 35B is competent at:
- Following explicit, step-by-step instructions
- Simple tool calls with flat parameters
- Text generation (replies, summaries)
- Pattern matching (keyword → action routing)
- Multilingual (better than Claude for Chinese content — useful for DeepSeek routing)
- Fast inference on DeepInfra (~1-2s TTFT)

The strategy isn't to make Qwen as smart as Opus. It's to make the SYSTEM smart enough that Qwen only needs to do simple things — and delegates everything else to Claude Code ($0).

---

## Appendix C: Architecture After Migration

```
                    G's Message
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

Qwen is the receptionist. Claude Code is the back office. The receptionist doesn't need to be brilliant — they need to route calls correctly and not leak information. That's the target operating model.
