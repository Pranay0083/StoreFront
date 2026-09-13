import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from '../middleware';
import { LoginAttempt, User } from '../models';
import { logger } from '../utils/logger';

export const cookieOpts = { httpOnly: true, secure: true, sameSite: 'none' as const, path: '/' };

/**
 * Generates and sets access and refresh JWT cookies for the authenticated user.
 */
export function setAuthCookies(res: any, userId: string, email: string) {
  const access = jwt.sign({ sub: userId, email, type: 'access' }, env.JWT_SECRET, { expiresIn: '15m' });
  const refresh = jwt.sign({ sub: userId, type: 'refresh' }, env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('access_token', access, { ...cookieOpts, maxAge: 900_000 });
  res.cookie('refresh_token', refresh, { ...cookieOpts, maxAge: 604_800_000 });
  return access;
}

/**
 * Strips sensitive data from a user object before returning it to the client.
 */
export const publicUser = (u: any) => ({ id: String(u._id), email: u.email, name: u.name, role: u.role });

/**
 * Registers a new user, hashes their password, and sets authentication cookies.
 */
export const register = async (req: any, res: any, next: any) => {
  try {
    const email = req.body.email.toLowerCase();
    if (await User.findOne({ email })) throw new ApiError(409, 'An account with this email already exists');
    const user = await User.create({
      email,
      name: req.body.name,
      passwordHash: await bcrypt.hash(req.body.password, 10),
    });
    const token = setAuthCookies(res, String(user._id), email);
    logger.info({ email, userId: user._id }, 'New user registered successfully');
    res.status(201).json({ user: publicUser(user), token });
  } catch (e) { next(e); }
};
/**
 * Authenticates a user with email and password, enforcing rate limits for failed attempts.
 */
export const login = async (req: any, res: any, next: any) => {
  try {
    const email = req.body.email.toLowerCase();
    const attempt = await LoginAttempt.findOne({ identifier: email });
    if (attempt?.lockedUntil && attempt.lockedUntil > new Date()) {
      logger.warn({ email }, 'Login rate limited');
      throw new ApiError(429, 'Too many failed attempts. Try again in 15 minutes.');
    }
    const user = await User.findOne({ email });
    const ok = user && await bcrypt.compare(req.body.password, user.passwordHash);
    if (!ok) {
      const count = (attempt?.count || 0) + 1;
      await LoginAttempt.updateOne(
        { identifier: email },
        { $set: { count, ...(count >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60_000) } : {}) } },
        { upsert: true }
      );
      if (count >= 5) logger.warn({ email }, 'Account temporarily locked due to failed logins');
      else logger.debug({ email, count }, 'Failed login attempt');
      throw new ApiError(401, 'Invalid email or password');
    }
    await LoginAttempt.deleteOne({ identifier: email });
    const token = setAuthCookies(res, String(user._id), email);
    logger.info({ email, userId: user._id }, 'User logged in successfully');
    res.json({ user: publicUser(user), token });
  } catch (e) { next(e); }
};

/**
 * Logs out the user by clearing their authentication cookies.
 */
export const logout = (_req: any, res: any) => {
  res.clearCookie('access_token', cookieOpts);
  res.clearCookie('refresh_token', cookieOpts);
  res.json({ ok: true });
};

/**
 * Returns the currently authenticated user's profile information.
 */
export const getMe = (req: any, res: any) => {
  res.json({ user: req.user });
};

/**
 * Refreshes the user's access token using a valid refresh token.
 */
export const refresh = async (req: any, res: any, next: any) => {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) throw new ApiError(401, 'No refresh token');
    let payload: any;
    try { payload = jwt.verify(token, env.JWT_SECRET); }
    catch { throw new ApiError(401, 'Invalid refresh token'); }
    if (payload.type !== 'refresh') throw new ApiError(401, 'Invalid token type');
    const user = await User.findById(payload.sub);
    if (!user) throw new ApiError(401, 'User not found');
    setAuthCookies(res, String(user._id), user.email);
    res.json({ user: publicUser(user) });
  } catch (e) { next(e); }
};
