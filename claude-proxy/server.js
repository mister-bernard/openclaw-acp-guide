#!/usr/bin/env node
// Claude Code API Proxy — OpenAI-compatible wrapper with hot session pool
// Persistent stream-json sessions, sticky routing, zero npm dependencies
// Port 18801, systemd managed

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

// --- Configuration ---
const PORT = parseInt(process.env.PORT || '18801', 10);
const HOST = '127.0.0.1';
const POOL_SIZE = parseInt(process.env.POOL_SIZE || '2', 10);
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || '1800000', 10); // 30 min
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '120000', 10);
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';
const DEFAULT_POOL_MODEL = 'claude-sonnet-4-6';

// --- Model mapping ---
const MODEL_MAP = {
  'opus': 'claude-opus-4-6',
  'sonnet': 'claude-sonnet-4-6',
  'haiku': 'claude-haiku-4-5-20251001',
  'claude-proxy/opus': 'claude-opus-4-6',
  'claude-proxy/sonnet': 'claude-sonnet-4-6',
  'claude-proxy/haiku': 'claude-haiku-4-5-20251001',
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
};

function resolveModel(requested) {
  if (!requested) return null;
  const mapped = MODEL_MAP[requested];
  if (mapped) return mapped;
  if (requested.startsWith('claude-')) return requested;
  return null;
}

// --- Logging ---
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// --- Persistent Session ---
// A long-lived claude CLI process using stream-json I/O.
// Accepts multiple messages over its lifetime without respawning.
class PersistentSession {
  constructor(model) {
    this.model = model;
    this.state = 'initializing'; // initializing | idle | busy | dead
    this.sessionId = null; // CLI-assigned session ID (from first result)
    this.process = null;
    this.spawnTime = Date.now();
    this.lastUsed = Date.now();
    this.requestCount = 0;

    // Current in-flight request callback
    this._pendingResolve = null;
    this._pendingReject = null;
    this._pendingTimeout = null;
    this._resultText = null;
    this._lineBuf = '';

    this._spawn();
  }

  _spawn() {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // force OAuth

    this.process = spawn(CLAUDE_PATH, [
      '-p', '--verbose',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--model', this.model,
    ], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    this.process.stdout.on('data', (d) => this._onData(d));
    this.process.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) log(`[session ${this._shortId()}] stderr: ${msg.slice(0, 200)}`);
    });
    this.process.on('exit', (code) => {
      log(`[session ${this._shortId()}] exited code=${code}, state was ${this.state}`);
      const wasBusy = this.state === 'busy';
      this.state = 'dead';
      if (wasBusy && this._pendingReject) {
        clearTimeout(this._pendingTimeout);
        this._pendingReject(new Error(`Claude process exited unexpectedly (code=${code})`));
        this._pendingResolve = null;
        this._pendingReject = null;
      }
    });
    this.process.on('error', (err) => {
      log(`[session ${this._shortId()}] error: ${err.message}`);
      this.state = 'dead';
    });

    // The session becomes idle once we see the first session_state_changed → idle,
    // or after a short grace period
    this._initTimer = setTimeout(() => {
      if (this.state === 'initializing') this.state = 'idle';
    }, 5000);
  }

  _shortId() {
    return this.sessionId ? this.sessionId.slice(0, 8) : 'pending';
  }

  _onData(chunk) {
    this._lineBuf += chunk.toString();
    const lines = this._lineBuf.split('\n');
    this._lineBuf = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        this._onEvent(event);
      } catch {
        // ignore non-JSON lines
      }
    }
  }

  _onEvent(event) {
    // Capture session ID from any event that has it
    if (event.session_id && !this.sessionId) {
      this.sessionId = event.session_id;
    }

    // Handle state transitions
    if (event.type === 'system' && event.subtype === 'session_state_changed') {
      if (event.state === 'idle' && this.state === 'initializing') {
        clearTimeout(this._initTimer);
        this.state = 'idle';
        log(`[session ${this._shortId()}] warm and ready (${this.model})`);
      }
    }

    // Handle result — completes the current request
    if (event.type === 'result' && this._pendingResolve) {
      clearTimeout(this._pendingTimeout);
      this._resultText = event.result || '';
      if (event.session_id) this.sessionId = event.session_id;
      this.state = 'idle';
      this._pendingResolve(this._resultText);
      this._pendingResolve = null;
      this._pendingReject = null;
      this._resultText = null;
    }
  }

  // Send a user message and wait for the result
  sendMessage(content) {
    if (this.state === 'dead') {
      return Promise.reject(new Error('Session is dead'));
    }
    if (this.state === 'busy') {
      return Promise.reject(new Error('Session is busy — concurrent sendMessage calls are not allowed'));
    }

    return new Promise((resolve, reject) => {
      this.state = 'busy';
      this.lastUsed = Date.now();
      this.requestCount++;
      this._pendingResolve = resolve;
      this._pendingReject = reject;

      this._pendingTimeout = setTimeout(() => {
        this._pendingReject = null;
        this._pendingResolve = null;
        this.kill();
        reject(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);

      const msg = {
        type: 'user',
        uuid: crypto.randomUUID(),
        session_id: this.sessionId || '',
        parent_tool_use_id: null,
        message: { role: 'user', content },
      };

      try {
        this.process.stdin.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        clearTimeout(this._pendingTimeout);
        this._pendingResolve = null;
        this._pendingReject = null;
        this.state = 'dead';
        reject(new Error(`Failed to write to session: ${err.message}`));
      }
    });
  }

  isAvailable() {
    return this.state === 'idle';
  }

  isAlive() {
    return this.state !== 'dead';
  }

  kill() {
    if (this.process && this.state !== 'dead') {
      this.state = 'dead';
      this.process.kill('SIGTERM');
    }
  }
}

// --- Session Pool ---
class SessionPool {
  constructor() {
    // model → PersistentSession[] (unbound warm sessions)
    this.warmPool = new Map();
    // sessionKey → { session: PersistentSession, lastUsed, queue: Promise }
    this.stickyMap = new Map();

    this.stats = {
      totalRequests: 0,
      poolHits: 0,
      stickyHits: 0,
      coldSpawns: 0,
      totalResponseMs: 0,
    };
  }

  init() {
    log(`Initializing pool: size=${POOL_SIZE}, model=${DEFAULT_POOL_MODEL}, timeout=${SESSION_TIMEOUT_MS / 1000}s`);
    this._fillPool(DEFAULT_POOL_MODEL);
    this._healthTimer = setInterval(() => this._healthCheck(), HEALTH_CHECK_INTERVAL_MS);
    this._cleanupTimer = setInterval(() => this._cleanupSessions(), 60_000);
  }

  _fillPool(model) {
    if (!this.warmPool.has(model)) this.warmPool.set(model, []);
    const pool = this.warmPool.get(model);
    // Count alive sessions in warm pool
    const alive = pool.filter(s => s.isAlive()).length;
    const needed = POOL_SIZE - alive;
    for (let i = 0; i < needed; i++) {
      pool.push(new PersistentSession(model));
    }
  }

  // Claim an available session from the warm pool
  _claimWarm(model) {
    const pool = this.warmPool.get(model);
    if (!pool) return null;
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].isAvailable()) {
        return pool.splice(i, 1)[0];
      }
    }
    // Also try initializing sessions (they might become idle before the request timeout)
    for (let i = 0; i < pool.length; i++) {
      if (pool[i].state === 'initializing') {
        return pool.splice(i, 1)[0];
      }
    }
    return null;
  }

  handleRequest(sessionKey, prompt, model) {
    this.stats.totalRequests++;

    let binding = this.stickyMap.get(sessionKey);

    // If sticky session exists but is dead or wrong model, remove it
    if (binding && (!binding.session.isAlive() || binding.session.model !== model)) {
      if (binding.session.isAlive()) binding.session.kill();
      this.stickyMap.delete(sessionKey);
      binding = null;
    }

    if (!binding) {
      // Get or create a session for this user
      let session = this._claimWarm(model);
      if (session) {
        this.stats.poolHits++;
        log(`Pool hit for ${sessionKey} (${model})`);
      } else {
        this.stats.coldSpawns++;
        log(`Cold spawn for ${sessionKey} (${model})`);
        session = new PersistentSession(model);
      }
      binding = { session, lastUsed: Date.now(), chain: Promise.resolve() };
      this.stickyMap.set(sessionKey, binding);
      // Replenish the warm pool
      this._fillPool(model);
    } else {
      this.stats.stickyHits++;
      log(`Sticky hit for ${sessionKey} (session ${binding.session._shortId()})`);
    }

    binding.lastUsed = Date.now();

    // Serialize requests to the same session
    const start = Date.now();
    return new Promise((resolve, reject) => {
      binding.chain = binding.chain.then(async () => {
        try {
          // Wait for session to become available if it's not idle
          if (!binding.session.isAvailable()) {
            await this._waitForReady(binding.session, 15000);
          }
          const result = await binding.session.sendMessage(prompt);
          this.stats.totalResponseMs += Date.now() - start;
          resolve(result);
        } catch (err) {
          reject(err);
          // If session died, remove the sticky binding so next request gets a fresh one
          if (!binding.session.isAlive()) {
            this.stickyMap.delete(sessionKey);
          }
        }
      });
    });
  }

  _waitForReady(session, maxWaitMs) {
    if (session.isAvailable()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = setInterval(() => {
        if (session.isAvailable()) {
          clearInterval(check);
          resolve();
        } else if (!session.isAlive()) {
          clearInterval(check);
          reject(new Error('Session died while waiting for initialization'));
        } else if (Date.now() - start > maxWaitMs) {
          clearInterval(check);
          reject(new Error('Session initialization timed out'));
        }
      }, 100);
    });
  }

  _healthCheck() {
    // Remove dead sessions from warm pool and replenish
    for (const [model, pool] of this.warmPool) {
      for (let i = pool.length - 1; i >= 0; i--) {
        if (!pool[i].isAlive()) pool.splice(i, 1);
      }
    }
    this._fillPool(DEFAULT_POOL_MODEL);
    // Also replenish for models with active sticky sessions
    const activeModels = new Set();
    for (const [, binding] of this.stickyMap) {
      if (binding.session.isAlive()) activeModels.add(binding.session.model);
    }
    for (const model of activeModels) {
      if (model !== DEFAULT_POOL_MODEL) this._fillPool(model);
    }
  }

  _cleanupSessions() {
    const now = Date.now();
    for (const [key, binding] of this.stickyMap) {
      if (now - binding.lastUsed > SESSION_TIMEOUT_MS) {
        log(`Releasing sticky session ${key} (idle ${Math.round((now - binding.lastUsed) / 1000)}s)`);
        binding.session.kill();
        this.stickyMap.delete(key);
      }
    }
  }

  getStatus() {
    let warmReady = 0;
    let warmInitializing = 0;
    for (const [, pool] of this.warmPool) {
      for (const s of pool) {
        if (s.isAvailable()) warmReady++;
        else if (s.state === 'initializing') warmInitializing++;
      }
    }

    let stickyIdle = 0;
    let stickyBusy = 0;
    let stickyTotal = 0;
    for (const [, binding] of this.stickyMap) {
      if (binding.session.isAlive()) {
        stickyTotal++;
        if (binding.session.isAvailable()) stickyIdle++;
        else if (binding.session.state === 'busy') stickyBusy++;
      }
    }

    const avgResponseMs = this.stats.totalRequests > 0
      ? Math.round(this.stats.totalResponseMs / this.stats.totalRequests) : 0;

    return {
      pool_size_config: POOL_SIZE,
      warm_ready: warmReady,
      warm_initializing: warmInitializing,
      sticky_sessions: stickyTotal,
      sticky_idle: stickyIdle,
      sticky_busy: stickyBusy,
      session_timeout_ms: SESSION_TIMEOUT_MS,
      avg_response_ms: avgResponseMs,
      stats: { ...this.stats },
    };
  }

  shutdown() {
    clearInterval(this._healthTimer);
    clearInterval(this._cleanupTimer);
    for (const [, pool] of this.warmPool) {
      for (const s of pool) s.kill();
    }
    for (const [, binding] of this.stickyMap) {
      binding.session.kill();
    }
  }
}

// --- Extract prompt from OpenAI messages ---
function messagesToPrompt(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const parts = [];
  for (const msg of messages) {
    const role = msg.role || 'user';
    const content = msg.content || '';
    if (role === 'system') {
      parts.push(`[System] ${content}`);
    } else if (role === 'assistant') {
      parts.push(`[Assistant] ${content}`);
    } else {
      parts.push(content);
    }
  }
  return parts.join('\n\n');
}

// --- OpenAI-format response builders ---
function chatResponse(content, model) {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'claude-proxy/sonnet',
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function errorResponse(status, message, type = 'api_error') {
  return { error: { message, type, code: status } };
}

// --- HTTP helpers ---
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// --- Instantiate pool ---
const pool = new SessionPool();

// --- Route handlers ---
async function handleChatCompletions(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJSON(res, 400, errorResponse(400, 'Invalid JSON body', 'invalid_request_error'));
    return;
  }

  const prompt = messagesToPrompt(body.messages);
  if (!prompt) {
    sendJSON(res, 400, errorResponse(400, 'No messages provided', 'invalid_request_error'));
    return;
  }

  const model = resolveModel(body.model) || DEFAULT_POOL_MODEL;
  const requestedModel = body.model || 'sonnet';

  // Session key: X-Session-Key header, or generate a one-off key (no stickiness)
  const sessionKey = req.headers['x-session-key'] || `anon-${crypto.randomUUID()}`;

  try {
    const content = await pool.handleRequest(sessionKey, prompt, model);
    sendJSON(res, 200, chatResponse(content, requestedModel));
  } catch (err) {
    log(`Error: ${err.message}`);
    sendJSON(res, 500, errorResponse(500, err.message, 'api_error'));
  }
}

function handleModels(req, res) {
  const models = ['sonnet', 'opus', 'haiku'].map(id => ({
    id,
    object: 'model',
    created: 1700000000,
    owned_by: 'claude-proxy',
  }));
  sendJSON(res, 200, { object: 'list', data: models });
}

function handleHealth(req, res) {
  const status = pool.getStatus();
  sendJSON(res, 200, {
    status: 'ok',
    uptime_s: Math.floor(process.uptime()),
    ...status,
  });
}

// --- Process-level crash protection ---
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}`);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${reason}`);
});

// --- Graceful shutdown ---
function shutdown(signal) {
  log(`Received ${signal}, shutting down...`);
  pool.shutdown();
  server.close(() => {
    log('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Server ---
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const path = url.pathname;

    log(`${req.method} ${path}`);

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      await handleChatCompletions(req, res);
    } else if (req.method === 'GET' && path === '/v1/models') {
      handleModels(req, res);
    } else if (req.method === 'GET' && path === '/health') {
      handleHealth(req, res);
    } else {
      sendJSON(res, 404, errorResponse(404, `Not found: ${req.method} ${path}`, 'not_found'));
    }
  } catch (err) {
    log(`Request handler error: ${err.message}`);
    console.error(err.stack);
    if (!res.headersSent) {
      sendJSON(res, 500, errorResponse(500, 'Internal server error', 'api_error'));
    }
  }
});

server.on('error', (err) => {
  log(`Server error: ${err.message}`);
});

server.listen(PORT, HOST, () => {
  log(`Claude Code API Proxy listening on http://${HOST}:${PORT}`);
  log(`Pool: size=${POOL_SIZE}, model=${DEFAULT_POOL_MODEL}, session_timeout=${SESSION_TIMEOUT_MS / 1000}s`);
  pool.init();
});
