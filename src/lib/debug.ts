// Debug logging helper. Use ALLOW_DEBUG_EXEC_LOGS env to gate output in production.
export function isDebugEnabled() {
  return process.env.ALLOW_DEBUG_EXEC_LOGS === 'true' || process.env.ALLOW_DEBUG_EXEC_LOGS === '1';
}

export function debugLog(...args: any[]) {
  if (!isDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.debug(...args);
  } catch (_) {
    // swallow
  }
}

export function debugWarn(...args: any[]) {
  if (!isDebugEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.warn(...args);
  } catch (_) {}
}

export default { isDebugEnabled, debugLog, debugWarn };


