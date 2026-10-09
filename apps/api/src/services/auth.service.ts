import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { User } from '../models/index.js';
import { HttpError } from '../utils/http-error.js';

export async function login(email: string, password: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  const env = getEnv();
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, env.JWT_SECRET, { expiresIn: '12h' });
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

export function readToken(token: string): { sub: string; email: string; role: string } {
  const env = getEnv();
  const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  if (!payload.sub || !payload.email) throw new HttpError(401, 'UNAUTHORIZED', 'Invalid session');
  return { sub: String(payload.sub), email: String(payload.email), role: String(payload.role ?? 'operator') };
}
