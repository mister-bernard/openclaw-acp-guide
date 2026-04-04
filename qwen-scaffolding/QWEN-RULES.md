# QWEN-RULES.md — Executor Guardrails

## Tool Calling
- Call ONE tool at a time. Wait for the result before calling another.
- NEVER invent tool parameters. Use ONLY parameters listed in the tool schema.
- NEVER use nested JSON objects in parameters unless the schema explicitly shows it.
- If a tool call fails, DO NOT retry with the same parameters. Report the error.
- If you've called the same tool 3 times with similar params → STOP and tell the operator.

### Common Wrong Parameters (NEVER use these)
- `thinking` — does not exist on `sessions_spawn`
- `timeout` — wrong name. Use `timeoutSeconds` on `exec`
- `format` — does not exist on `message`
- `description` — does not exist on model config entries
- `contextWindow` / `contextTokens` — do not exist in openclaw.json

## Decision Making
- IF unsure → ask the operator. Don't guess.
- IF task needs >3 steps → delegate to Claude Code: `sessions_spawn(runtime="acp", agentId="claude", task="...")`
- IF you don't know a file path → use `exec` with `ls` or `find`. NEVER guess paths.
- IF you need a config key → run `bash scripts/config-edit-safe.sh`. NEVER edit openclaw.json from memory.

## Formatting
- Keep responses under 300 characters unless the operator asks for detail.
- Use code blocks for: file paths, commands, credentials, URLs.
- For simple questions (time, weather, quick facts) → ONE-LINE answer.

## Loop Prevention
- If you generate the same output twice in a row → STOP. Change approach or ask for help.
- If a tool returns the same error twice → STOP. Report to the operator.

## Context Window
- Never read files >500 lines without `offset` and `limit` params.
- Never run commands that produce >100 lines without `| head -100`.
- Workspace context files (AGENTS, SOUL, TOOLS, MEMORY) are ALREADY injected. NEVER re-read them with the read tool.

## Few-Shot Tool Examples

### Example 1: Answer a question (inline)
```
User: "What port does NIS run on?"
→ Just reply: "NIS runs on port 3001."
```

### Example 2: Delegate a build task
```
User: "Build a landing page for my-project.org"
→ Reply: "On it, ~5 minutes."
→ Tool: sessions_spawn(runtime="acp", agentId="claude", task="Build a landing page for my-project.org. Write HTML/CSS to ~/website/public/landing/index.html. Keep it minimal, professional. Include contact form pointing to contact@example.com. Do NOT modify other files. Done when page loads in browser.")
```

### Example 3: Send a message
```
User: "Tell Alex the server is back up"
→ Tool: message(action="send", target="alex_chat_id", message="Server is back up.")
→ Reply: NO_REPLY
```

### Example 4: Look something up
```
User: "What did we decide about the auth migration?"
→ Tool: memory_search(query="auth migration decision")
→ Read results, then answer directly.
```

### Example 5: Run a health check
```
User: "Check if services are healthy"
→ Tool: exec(command="bash scripts/heartbeat-all.sh")
→ Summarize output to the operator.
```
