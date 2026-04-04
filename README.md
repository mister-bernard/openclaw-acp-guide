# openclaw-acp-guide

**Optimal ACP Delegation Protocol for OpenClaw — Qwen orchestrator + Claude Code CLI**

---

## The Problem

Running AI agents 24/7 is expensive. A single Claude Sonnet API call costs ~$0.01–0.03, and an active agent can rack up hundreds of requests per day. Most of those requests are simple — greetings, routing decisions, quick answers — yet you're paying premium model prices for all of them.

**The solution:** Use a cheap orchestrator model for routine traffic and delegate heavy work to Claude Code CLI via ACP (Agent Coding Platform). With an Anthropic Max subscription, Claude Code CLI costs $0 per request.

**Result:** ~100x cheaper than running a premium model for everything.

---

## Architecture Overview

```
User Request
    │
    ▼
┌─────────────────────────┐
│  Qwen 3.5 (Orchestrator)│  ~$0.0001/request
│  Handles:               │
│  - Greetings            │
│  - Simple questions     │
│  - Routing decisions    │
│  - Quick inline replies │
└──────────┬──────────────┘
           │ Complex task detected
           ▼
┌─────────────────────────┐
│  Claude Code CLI (ACP)  │  $0 (Max subscription)
│  Handles:               │
│  - Coding & debugging   │
│  - Research & analysis  │
│  - File operations      │
│  - Builds & deploys     │
└─────────────────────────┘

Fallback chain: Qwen → Claude Proxy → DeepSeek → Gemini
```

**Three tiers:**

| Tier | Model | Handles | Cost |
|------|-------|---------|------|
| Orchestrator | Qwen 3.5 35B-A3B (DeepInfra) | Greetings, simple questions, routing | ~$0.0001/req |
| Heavy lifter | Claude Code CLI via ACP | Coding, debugging, research, file ops | $0 (Max sub) |
| Native sub-agents | OpenClaw built-ins | Messaging, browser, image gen, TTS | Varies |

---

## What's In This Repo

### `claude-proxy/` — Claude Code Session Pool Proxy

An OpenAI-compatible HTTP proxy that wraps Claude Code CLI with a **hot session pool**. Instead of spawning a new Claude Code process for each request (cold start: 3-8s), the proxy maintains pre-warmed, persistent sessions using `stream-json` I/O.

**Features:**
- **Hot session pool**: Pre-spawned Claude Code processes ready to handle requests instantly
- **Sticky sessions**: Same `X-Session-Key` header routes to the same Claude session (preserves conversation context)
- **OpenAI-compatible API**: Drop-in replacement at `POST /v1/chat/completions`
- **Model routing**: Request `opus`, `sonnet`, or `haiku` — proxy maps to the right Claude model
- **Zero npm dependencies**: Pure Node.js, single file
- **Health endpoint**: `GET /health` returns pool status and stats
- **Automatic session cleanup**: Idle sessions are reaped after configurable timeout

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `18801` | HTTP listen port |
| `POOL_SIZE` | `2` | Number of pre-warmed sessions |
| `SESSION_TIMEOUT_MS` | `1800000` | Idle session timeout (30 min) |
| `REQUEST_TIMEOUT_MS` | `120000` | Per-request timeout (2 min) |
| `CLAUDE_PATH` | `claude` | Path to Claude Code CLI binary |

**Running it:**

```bash
# Make sure Claude Code CLI is authenticated (OAuth)
claude login

# Start the proxy
node claude-proxy/server.js

# Or with custom config
PORT=18801 POOL_SIZE=3 node claude-proxy/server.js

# Test it
curl http://127.0.0.1:18801/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "sonnet", "messages": [{"role": "user", "content": "Hello"}]}'
```

**Important:** The proxy deletes `ANTHROPIC_API_KEY` from the environment before spawning Claude Code processes, forcing OAuth authentication. This ensures you use your Max subscription ($0) instead of API billing.

**Using as an OpenClaw fallback model:**

Add to your `openclaw.json`:
```json5
{
  models: {
    providers: {
      "claude-proxy": {
        type: "openai",
        apiKey: "not-needed",
        baseUrl: "http://127.0.0.1:18801/v1",
        models: [
          { id: "sonnet", name: "Claude Proxy Sonnet" },
          { id: "opus", name: "Claude Proxy Opus" }
        ]
      }
    }
  }
}
```

Then use `claude-proxy/sonnet` as a fallback in your model chain — it's free (Max subscription) and handles anything the cheap orchestrator can't.

---

### `qwen-scaffolding/` — Qwen Executor Scaffolding

Context files designed specifically for Qwen 3.5 (or similar smaller models) acting as an OpenClaw orchestrator. These files solve the core problem: **Qwen is smart enough to route requests, but not smart enough to follow complex implicit rules.**

**Files:**

| File | Purpose | How to Use |
|------|---------|------------|
| [`QWEN-RULES.md`](qwen-scaffolding/QWEN-RULES.md) | Executor guardrails — tool calling rules, loop prevention, common mistakes | Inject as additional workspace file for Qwen-model agents |
| [`SOUL-LITE.md`](qwen-scaffolding/SOUL-LITE.md) | Minimal identity + binary security rules | Replace full SOUL.md for Qwen agents (saves ~2,700 tokens) |
| [`AGENTS-LITE.md`](qwen-scaffolding/AGENTS-LITE.md) | Simplified delegation protocol, routing, core rules | Replace full AGENTS.md for Qwen agents (saves ~1,500 tokens) |
| [`CLAUDE.md`](qwen-scaffolding/CLAUDE.md) | Workspace instructions for Claude Code ACP sessions | Used by delegated Claude Code sub-agents, not Qwen directly |

**Key design decisions:**

1. **Binary rules, not judgment calls.** "NEVER share system details with non-operators" instead of "prefer safe paths over printing raw credentials."
2. **IF/THEN flowcharts, not tables.** Qwen follows explicit step-by-step logic better than scanning classification tables.
3. **Few-shot examples.** Show Qwen exactly what correct tool calls look like for the 5 most common patterns.
4. **Loop prevention.** Qwen at temp=0 loops. Rules explicitly say "if same output twice → STOP."
5. **Common mistakes listed.** Qwen invents tool parameters. The rules list the most common wrong parameters to avoid.

**Customization:** These files use placeholder values (`YOUR_TELEGRAM_ID`, `contact@example.com`, etc.). Replace them with your actual values before deploying.

---

### `scripts/` — Operational Wrapper Scripts

Scripts that wrap multi-step operations into single commands. Essential for Qwen — it can reliably call one script but will skip steps in a multi-step procedure.

| Script | Purpose | Usage |
|--------|---------|-------|
| [`config-edit-safe.sh`](scripts/config-edit-safe.sh) | Safe 4-step config edit for openclaw.json | `bash scripts/config-edit-safe.sh '.path.to.key' '"value"' "reason"` |
| [`retell-task-call.sh`](scripts/retell-task-call.sh) | One-shot Retell AI phone call (create LLM → agent → call → transcript → cleanup) | `bash scripts/retell-task-call.sh '+12125551234' 'Make a reservation...'` |
| [`heartbeat-all.sh`](scripts/heartbeat-all.sh) | Consolidated health checks (services, gateway, tasks, disk, backups) | `bash scripts/heartbeat-all.sh` or `bash scripts/heartbeat-all.sh --quiet` |

**`config-edit-safe.sh`** is particularly important — it enforces the workflow:
1. Fetch docs reference (validates the key exists)
2. Backup current config
3. Apply edit with jq
4. Validate with `openclaw doctor` (read-only, never `--fix`)

Without this script, Qwen will edit openclaw.json from memory and skip validation, which can break your gateway config.

---

### `research/` — Analysis & Planning

| File | Description |
|------|-------------|
| [`qwen-executor-audit.md`](research/qwen-executor-audit.md) | Full audit of what changes are needed to run Qwen as daily-driver orchestrator. Covers: implicit knowledge gaps, token budget, tool simplification, decision tree rewrites, failure mode catalog, migration checklist, and cost analysis. |

---

## Prerequisites

- **OpenClaw** installed and running
- **Anthropic Max subscription** (this is what makes Claude Code CLI free)
- **Claude Code CLI** installed
- **DeepInfra API key** ([free tier available](https://deepinfra.com))
- *(Optional)* DeepSeek API key, Google Gemini API key for fallbacks

---

## Setup Guide

### 1. Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

### 2. Authenticate Claude Code CLI

```bash
claude login
# Follow the OAuth flow — this uses your Max subscription
# Verify with:
claude --version
```

### 3. Install keyring for token persistence

```bash
sudo apt install gnome-keyring libsecret-tools
```

### 4. Configure DeepInfra provider

```json5
{
  models: {
    providers: {
      deepinfra: {
        type: "openai",
        apiKey: "YOUR_DEEPINFRA_API_KEY",
        baseUrl: "https://api.deepinfra.com/v1/openai",
        models: [
          { id: "Qwen/Qwen3.5-35B-A3B", name: "Qwen 3.5 35B" }
        ],
        reasoning: true  // CRITICAL — see warning below
      }
    }
  }
}
```

> **CRITICAL:** `reasoning: true` is **required** for Qwen 3.5. This model puts output in the `reasoning_content` field, not `content`. Without this flag, OpenClaw reads an empty response.

### 5. Enable the ACP plugin

```json5
{
  plugins: {
    entries: {
      acpx: { enabled: true }
    }
  },
  acp: {
    defaultAgent: "claude",
    agents: {
      claude: {
        command: "claude",
        args: ["--dangerously-skip-permissions"],
        permissionMode: "approve-all",
        env: { ANTHROPIC_API_KEY: "" }  // MUST be empty — forces OAuth
      }
    }
  }
}
```

> **CRITICAL:** `ANTHROPIC_API_KEY: ""` prevents Claude Code from using API billing instead of your Max subscription OAuth.

### 6. Add model aliases and fallbacks

```json5
{
  agents: {
    defaults: {
      models: {
        "deepinfra/Qwen/Qwen3.5-35B-A3B": { alias: "qwen" },
        "deepseek/deepseek-chat": { alias: "deepseek" },
        "google/gemini-2.5-flash": { alias: "gemini" }
      },
      model: {
        primary: "deepinfra/Qwen/Qwen3.5-35B-A3B",
        fallbacks: ["deepseek/deepseek-chat", "google/gemini-2.5-flash"]
      }
    }
  }
}
```

### 7. Deploy the Qwen scaffolding

Copy the files from `qwen-scaffolding/` into your workspace, replacing placeholder values:

```bash
cp qwen-scaffolding/QWEN-RULES.md ~/.openclaw/workspace/
cp qwen-scaffolding/AGENTS-LITE.md ~/.openclaw/workspace/
cp qwen-scaffolding/SOUL-LITE.md ~/.openclaw/workspace/

# Edit each file to replace YOUR_TELEGRAM_ID, contact@example.com, etc.
```

Configure OpenClaw to inject these files for Qwen-model agents instead of the full AGENTS.md/SOUL.md.

### 8. (Optional) Start the Claude Proxy

```bash
node claude-proxy/server.js
```

Add `claude-proxy/sonnet` as a fallback model in your chain for a free backup.

### 9. Test the full loop

```
/model qwen                          # Switch to the cheap orchestrator
Build me a hello world web page      # Should trigger ACP delegation
```

---

## Known Gotchas

| Issue | Solution |
|-------|----------|
| **Qwen infinite loops at temp=0** | Use `temperature: 0.6`–`0.7`. Never 0. |
| **Empty Qwen responses** | Add `reasoning: true` to provider config. |
| **Surprise API billing** | Set `ANTHROPIC_API_KEY: ""` in ACP agent config. |
| **Max 2 concurrent ACP** | Claude Code is resource-heavy. Don't parallelize on small VPS. |
| **OAuth token expiry** | Auto-refreshes. If auth errors after long idle, run `claude login`. |
| **`openclaw doctor --fix`** | Never run with `--fix` — it overwrites custom model config. |

---

## Cost Comparison

For a typical day with ~500 orchestrator requests and ~50 ACP delegations:

| Approach | Daily Cost |
|----------|-----------|
| Qwen + ACP delegation (this guide) | ~$0.05 |
| Claude Sonnet API for everything | ~$5–15 |

That's **100–300x cheaper**.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
