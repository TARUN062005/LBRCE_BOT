import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { getEnv } from '../config/env.js';

export const SESSION_COOKIE = 'lbrce_session';

const SESSION_ID = /^[A-Za-z0-9_-]{8,80}$/;

export function readSessionCookie(req: Request): string | undefined {
  const value = req.cookies?.[SESSION_COOKIE];
  return typeof value === 'string' && SESSION_ID.test(value) ? value : undefined;
}

export function setSessionCookie(res: Response, sessionId: string): void {
  const env = getEnv();
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: env.COOKIE_SAMESITE,
    secure: env.NODE_ENV === 'production',
    maxAge: 180 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/**
 * The cookie is the session. A body id is accepted only until the cookie exists,
 * so a session id in a URL cannot be replayed after the browser has a cookie.
 */
export function bindSession(req: Request, res: Response, presented?: string): string {
  const cookie = readSessionCookie(req);
  if (cookie) return cookie;
  const sessionId = presented && SESSION_ID.test(presented) ? presented : randomUUID();
  setSessionCookie(res, sessionId);
  return sessionId;
}
