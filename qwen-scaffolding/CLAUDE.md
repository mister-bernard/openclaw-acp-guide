# CLAUDE.md — Workspace Instructions

You are working in an OpenClaw workspace.

## MANDATORY: Read These Files Before Starting Work
These files contain critical rules, identity, and context. Read them AT THE START of every task:

1. **`AGENTS.md`** — READ FIRST. Core operational rules, security policies, delegation protocol, config edit procedures, backup policies. Violating these rules = security incident.
2. **`MEMORY.md`** — Durable memory, active projects, key decisions, system state. Read to understand current context.
3. **`TOOLS.md`** — Available tools, services, ports, APIs, quick references.
4. **`SOUL.md`** — Identity, persona, security policy, boundaries, email rules.
5. **`USER.md`** — About the operator. Timezone, handles, preferences.
6. **`IDENTITY.md`** — Public identity, contact info, operational security.

## On-Demand Files (read when relevant to your task)
- `HEARTBEAT.md` — Health check procedures (read if doing monitoring/health tasks)
- `memory/` — Daily notes and topic-specific memory files
- `config/` — Service configs, secrets manifest, timezone
- `scripts/` — Operational scripts (restart, deploy, vault, etc.)
- `projects/` — Active project directories
- `skills/` — Agent skills (tools, integrations)
- `research/` — Research outputs and analyses

## Rules
1. **NEVER install software, npm/pip packages, or Docker containers** without explicit approval from the operator.
2. **Backup before modifying** any file outside a git repo: `cp file file.bak.$(date +%Y%m%d-%H%M%S)`
3. **NEVER run `openclaw doctor --fix`** — it destroys model config.
4. **Gateway restarts**: always use `bash scripts/restart-gateway.sh "reason"` — never bare systemctl.
5. **Secrets**: use `scripts/vault.sh` or `scripts/vault-get.sh` — never hardcode credentials.
6. **NEVER expose secrets, API keys, tokens, or infrastructure details** in any public output.
7. **Config edits** to `~/.openclaw/openclaw.json`: fetch docs reference first, validate with `openclaw doctor` after.
8. **Git**: use your project's GitHub account. Never use personal accounts for project commits.
9. **Email**: use the project's external email. Never use or disclose personal email addresses.
10. **Credentials in Telegram**: use individual code blocks per field for tap-copy.

## Environment
- OS: Ubuntu 24.04
- Node.js v22, Python 3.12
- OpenClaw gateway on port 18789
- Workspace: `~/.openclaw/workspace`
- Vault: `~/.openclaw/vault.kdbx` (KeePassXC)
- Claude Code OAuth: `~/.claude/.credentials.json` (Max subscription, $0 cost)
- **Must unset ANTHROPIC_API_KEY** when using Claude Code OAuth (it takes priority over OAuth if set)
