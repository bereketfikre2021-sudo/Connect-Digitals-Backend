/**
 * Lazy logger for provider adapters.
 *
 * Provider adapters are imported in unit tests without a DATABASE_URL env var.
 * This module defers the pino/env import until the first log call,
 * so test environments that don't set DATABASE_URL can still import adapters.
 */

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

interface LazyLogger {
  info:  LogFn;
  warn:  LogFn;
  error: LogFn;
}

let _logger: LazyLogger | null = null;

function getLogger(): LazyLogger {
  if (_logger) return _logger;
  try {
    // Dynamic require — only executed on first log call, not at import time
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { logger } = require("../lib/logger.js") as { logger: LazyLogger };
    _logger = logger;
  } catch {
    // Fallback for test environments where pino/env is not available
    _logger = {
      info:  (obj, msg) => console.log("[INFO]",  msg, obj),
      warn:  (obj, msg) => console.warn("[WARN]",  msg, obj),
      error: (obj, msg) => console.error("[ERROR]", msg, obj),
    };
  }
  return _logger;
}

export const providerLogger: LazyLogger = {
  info:  (obj, msg) => getLogger().info(obj, msg),
  warn:  (obj, msg) => getLogger().warn(obj, msg),
  error: (obj, msg) => getLogger().error(obj, msg),
};
