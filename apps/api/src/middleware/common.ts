import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { ZodError, type ZodTypeAny } from 'zod';
import { isAllowedOrigin } from '../config/env.js';
import { readToken } from '../services/auth.service.js';
import { HttpError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && incoming.length < 80 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function requireOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  if (!isAllowedOrigin(origin)) {
    return next(new HttpError(403, 'FORBIDDEN_ORIGIN', 'Origin is not allowed'));
  }
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  try {
    const header = req.get('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer || req.cookies?.lbrce_admin;
    if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'Admin authentication is required');
    const session = readToken(token);
    if (session.role !== 'admin' && session.role !== 'operator') {
      throw new HttpError(403, 'FORBIDDEN', 'This account cannot access admin tools');
    }
    req.admin = session;
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'UNAUTHORIZED', 'Invalid session'));
  }
}

export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(validationError(parsed.error));
    req.body = parsed.data;
    next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return next(validationError(parsed.error));
    req.query = parsed.data as Request['query'];
    next();
  };
}

function validationError(error: ZodError): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', 'The request is invalid', error.flatten());
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const http =
    error instanceof HttpError
      ? error
      : error instanceof ZodError
        ? new HttpError(400, 'VALIDATION_ERROR', 'The request is invalid', error.flatten())
        : new HttpError(500, 'INTERNAL_ERROR', 'Something went wrong');
  if (http.status >= 500) logger.error({ err: error, requestId: req.requestId }, 'request failed');
  res.status(http.status).json({
    error: {
      code: http.code,
      message: http.message,
      requestId: req.requestId,
      details: http.details,
    },
  });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}

export const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMIT', message: 'Too many chat requests. Please wait and try again.' } },
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMIT', message: 'Too many login attempts. Please wait and try again.' } },
});

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});

export const ingestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
