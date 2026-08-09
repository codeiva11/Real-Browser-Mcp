/**
 * Structured JSON logging with log levels.
 *
 * All server-side diagnostics go through this module so logs are parseable
 * and correlate with the tool call that produced them. Control via
 * REAL_BROWSER_LOG_LEVEL (debug|info|warn|error, default: info). Emoji-free
 * JSON lines keep the STDIO MCP channel clean and log files greppable.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): LogLevel {
  const raw = process.env.REAL_BROWSER_LOG_LEVEL || process.env.LOG_LEVEL || 'info';
  const value = raw.toLowerCase().trim() as LogLevel;
  return LEVELS[value] !== undefined ? value : 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel()];
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  });
  // stderr only — stdout is reserved for the MCP JSON-RPC transport.
  process.stderr.write(line + '\n');
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};