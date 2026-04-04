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

The OAuth flow will open a browser window. Log in with the account that has the Max subscription. Once authenticated, Claude Code CLI will use your subscription instead of API billing.

### 3. Install keyring for token persistence

OAuth tokens need to survive reboots. Without a keyring, you'll need to re-authenticate after every restart.

```bash
sudo apt install gnome-keyring libsecret-tools
```

Tokens are stored in `~/.claude/.credentials.json`. The keyring encrypts them at rest.

### 4. Configure DeepInfra provider

Add the DeepInfra provider to your `openclaw.json`:

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

> **CRITICAL:** `reasoning: true` is **required** for Qwen 3.5. This model is a reasoning model — it puts its output in the `reasoning_content` field, not `content`. Without this flag, OpenClaw reads an empty response and you'll think the model is broken. It's not. It's just talking to itself in a field you're not reading.

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
        env: { ANTHROPIC_API_KEY: "" }  // MUST be empty — see warning
      }
    }
  }
}
```

> **CRITICAL:** Setting `ANTHROPIC_API_KEY: ""` (empty string) is essential. If OpenClaw's gateway has `ANTHROPIC_API_KEY` set in its environment, Claude Code will detect it and use API billing instead of your Max subscription OAuth. An empty string explicitly overrides this. This is the difference between $0 and a surprise bill.

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

This gives you:
- `/model qwen` — switch to the cheap orchestrator
- `/model deepseek` — fallback if DeepInfra is down
- `/model gemini` — secondary fallback
- Automatic fallback chain if the primary model fails

### 7. Set up the delegation protocol

Copy the delegation protocol from [`examples/delegation-protocol.md`](examples/delegation-protocol.md) into your workspace's `AGENTS.md` file. This tells the orchestrator model when to handle requests itself vs. delegate to ACP.

### 8. Test the full loop

```
/model qwen                          # Switch to the cheap orchestrator
Build me a hello world web page      # Should trigger ACP delegation to Claude Code
```

You should see:
1. Qwen receives the request
2. Qwen detects "build" keyword → triggers ACP delegation
3. Claude Code CLI spins up via ACP
4. Claude Code writes the files, returns the result
5. Qwen relays the result back to you

---

## The Delegation Protocol

The orchestrator needs to decide: handle this myself, or delegate to Claude Code?

### Why keyword matching beats "vibes"

A cheap model like Qwen 3.5 can reliably scan for the word "build" in a message. It **cannot** reliably estimate task complexity, predict how many tool calls something needs, or judge whether a request requires deep reasoning. Keyword matching is dumb, fast, and reliable. Vibes-based routing with a small model is smart, slow, and wrong half the time.

### The routing table

| # | Pattern | Action |
|---|---------|--------|
| 1 | Question answerable from conversation context | **INLINE** — answer directly |
| 2 | Greeting, acknowledgment, small talk | **INLINE** — reply normally |
| 3 | Send message, react, channel action | **INLINE** — use native messaging tools |
| 4 | Keywords: *build, create, write, generate, deploy, implement, set up, design* | **DELEGATE** to ACP |
| 5 | Keywords: *research, find out, look into, investigate, compare, audit* | **DELEGATE** to ACP |
| 6 | Keywords: *fix, debug, diagnose, troubleshoot* | **DELEGATE** to ACP |
| 7 | File edit likely > 5 lines | **DELEGATE** to ACP |
| 8 | Task needs reading 2+ files | **DELEGATE** to ACP |
| 9 | Task needs 3+ tool calls | **DELEGATE** to ACP |
| 10 | Everything else | **INLINE** — handle directly |

Rules are evaluated top-to-bottom. First match wins.

The full protocol with instructions for your `AGENTS.md` is in [`examples/delegation-protocol.md`](examples/delegation-protocol.md).

---

## ACP vs Native Sub-Agents

Not everything goes through ACP. Some tasks need OpenClaw's native tools.

| Capability | Use ACP (Claude Code) | Use Native Sub-Agent |
|-----------|----------------------|---------------------|
| Write/edit code | Yes | |
| Run shell commands | Yes | |
| Read/search files | Yes | |
| Build & deploy | Yes | |
| Research & analysis | Yes | |
| Send messages (Telegram, Signal, etc.) | | Yes |
| Browser automation | | Yes |
| Image generation | | Yes |
| Text-to-speech | | Yes |
| Canvas/whiteboard | | Yes |

**Rule of thumb:** ACP by default. Native sub-agents only when you need OpenClaw-specific tools that Claude Code doesn't have access to.

---

## Known Gotchas

These are lessons learned the hard way. Read them before you start.

### Qwen 3.5 temperature

**Never use `temperature=0` with Qwen 3/3.5/QwQ.** It causes infinite reasoning loops where the model thinks forever and never produces output. Use `0.6`–`0.7` instead.

### Empty responses from Qwen

If Qwen returns empty responses, you forgot `reasoning: true` in the provider config. See [Step 4](#4-configure-deepinfra-provider).

### Surprise API billing

If `ANTHROPIC_API_KEY` is set in the environment where ACP spawns Claude Code, it will use API billing instead of your OAuth/Max subscription. Always set it to an empty string in the ACP agent config. See [Step 5](#5-enable-the-acp-plugin).

### Concurrency limits

Max 2 concurrent ACP processes on a 2-core machine. Claude Code CLI is resource-heavy. If you're running on a small VPS, don't try to parallelize ACP tasks.

### OAuth token expiry

OAuth tokens expire after ~7 hours. Claude Code handles refresh automatically — you don't need to do anything. But if you see auth errors after a long idle period, run `claude login` again.

### `openclaw doctor --fix`

**Never run `openclaw doctor --fix`** if you have custom model configuration. It can overwrite your provider config, model aliases, and fallback chains. Use `openclaw doctor` (without `--fix`) to diagnose, then fix issues manually.

---

## Cost Comparison

| Component | Cost |
|-----------|------|
| Qwen 3.5 on DeepInfra | ~$0.0001/request |
| Claude Code CLI (Max subscription) | $0/request |
| DeepSeek fallback | ~$0.001/request |
| Gemini Flash fallback | Free tier available |
| **Claude Sonnet via API (for comparison)** | **~$0.01–0.03/request** |

For a typical day with ~500 orchestrator requests and ~50 ACP delegations:

| Approach | Daily Cost |
|----------|-----------|
| Qwen + ACP delegation (this guide) | ~$0.05 |
| Claude Sonnet API for everything | ~$5–15 |

That's **100–300x cheaper**.

---

## Claude Proxy (Advanced — Optional)

You can run a local proxy server that wraps Claude Code CLI as an OpenAI-compatible API endpoint. This gives you a $0 fallback model that can handle any request — not just ACP delegations.

The proxy accepts standard OpenAI API calls and routes them through Claude Code CLI using your Max subscription OAuth. This is useful as a fallback in the model chain, sitting between Qwen and the paid fallbacks (DeepSeek, Gemini).

Setup guide for the Claude proxy will be linked here in a future update.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
