import { runTokenRefreshOnce } from './token-refresh';

export async function handler(event: any, context: any) {
  try {
    await runTokenRefreshOnce();
    return { status: 'ok' };
  } catch (e) {
    console.error('[token-refresh-lambda] failed', e);
    return { status: 'error', error: String(e) };
  }
}

export default handler;


