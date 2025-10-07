import { loadConfig } from './config';

// Load AppConfig at startup and dump key=value pairs to stdout (plain text)
(async () => {
  try {
    const cfg = await loadConfig();
    // app-init logs removed
  } catch (e) {
    console.error('[app-init] Failed to load AppConfig:', e);
    // Fail-fast: stop the server so devs notice missing AppConfig immediately
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1);
    }
    throw e;
  }
})();

export default {};


