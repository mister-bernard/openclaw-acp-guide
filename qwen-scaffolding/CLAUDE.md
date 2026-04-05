# CLAUDE.md — Workspace Instructions (v2)

You are working in an OpenClaw workspace-v2 environment.

## Workspace Structure
The workspace uses a tiered bootstrap system. Core content lives in `~/.openclaw/workspace/core/`:

| File | Purpose |
|------|---------|
| `core/IDENTITY.md` | Agent identity, public name |
| `core/VOICE.md` | Philosophy, tone, anti-sycophancy |
| `core/RULES.md` | Security, config gate, universal rules (NON-NEGOTIABLE) |
| `core/DELEGATION.md` | Decision tree for inline vs delegate |
| `core/MEMORY-PROTOCOL.md` | How to recall / persist (FULL tier only) |
| `core/USER.md` | About the operator |
| `core/STATE.md` | Durable data: projects, systems, infra |
| `core/CAPABILITIES.md` | Tools, skills, services, quick ref |

These are injected automatically via `build-workspace.sh` — you do NOT need to re-read them.

## On-Demand Files (read when relevant to your task)
- `agents/` — Agent-scoped instructions (cc.md, heartbeat.md, wire.md)
- `channels/` — Channel-scoped rules (groups.md, sms-voice.md, cmtd.md)
- `memory/` — Daily notes and topic-specific memory files
- `scripts/` — Operational scripts (restart, deploy, vault, etc.)
- `projects/` — Active project directories

## Rules
1. **NEVER install software, npm/pip packages, or Docker containers** without explicit approval from the operator.
2. **Backup before modifying** any file outside a git repo: `cp file file.bak.$(date +%Y%m%d-%H%M%S)`
3. **NEVER run `openclaw doctor --fix`** — it destroys model config.
4. **Gateway restarts**: always use `bash scripts/restart-gateway.sh "reason"` — never bare systemctl.
5. **Secrets**: use `scripts/vault.sh` or `scripts/vault-get.sh` — never hardcode credentials.
6. **NEVER expose secrets, API keys, tokens, or infrastructure details** in any public output.
7. **Config edits** to `~/.openclaw/openclaw.json`: use `bash scripts/config-edit-safe.sh` — never edit from memory.
8. **Workspace edits**: edit `core/*.md` only, then run `./build-workspace.sh <TIER> <target-dir>`.
9. **Credentials in Telegram**: use individual code blocks per field for tap-copy.

## Environment
- OS: Ubuntu 24.04
- Node.js v22, Python 3.12+
- OpenClaw 2026.4.x, gateway on port 18789
- Workspace: `~/.openclaw/workspace` (v2 tiered structure)
- Vault: `~/.openclaw/vault.kdbx` (KeePassXC)
- Claude Code OAuth: `~/.claude/.credentials.json` (Max subscription, $0 cost)
- **Must unset ANTHROPIC_API_KEY** when using Claude Code OAuth (it takes priority over OAuth if set)
