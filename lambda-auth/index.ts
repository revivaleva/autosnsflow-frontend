import { handler as validateHandler } from './validate';
import { handler as heartbeatHandler } from './heartbeat';

export const handler = async (event: any = {}) => {
  // Determine action by request path (API Gateway HTTP API) or explicit body.action
  const path = event?.requestContext?.http?.path || '';
  let action: string | null = null;
  try {
    const body = event.body && typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    action = body?.action || null;
  } catch (e) {
    // ignore parse errors
  }

  if (String(path).includes('/heartbeat') || action === 'heartbeat') {
    return await heartbeatHandler(event);
  }

  // default to validate
  return await validateHandler(event);
};


