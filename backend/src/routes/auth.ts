import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../env';
import { ApiError, requireAuth, validate } from '../middleware';
import { LoginAttempt, PasswordResetToken, User } from '../models';

const router = Router();

const cookieOpts = { httpOnly: true, secure: true, sameSite: 'none' as const, path: '/' };

function setAuthCookies(res: any, userId: string, email: string) {
  const access = jwt.sign({ sub: userId, email, type: 'access' }, env.JWT_SECRET, { expiresIn: '15m' });
  const refresh = jwt.sign({ sub: userId, type: 'refresh' }, env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('access_token', access, { ...cookieOpts, maxAge: 900_000 });
  res.cookie('refresh_token', refresh, { ...cookieOpts, maxAge: 604_800_000 });
  return access;
}

const publicUser = (u: any) => ({ id: String(u._id), email: u.email, name: u.name, role: u.role });

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    if (await User.findOne({ email })) throw new ApiError(409, 'An account with this email already exists');
    const user = await User.create({
      email,
      name: req.body.name,
      passwordHash: await bcrypt.hash(req.body.password, 10),
    });
    const token = setAuthCookies(res, String(user._id), email);
    res.status(201).json({ user: publicUser(user), token });
  } catch (e) { next(e); }
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const attempt = await LoginAttempt.findOne({ identifier: email });
    if (attempt?.lockedUntil && attempt.lockedUntil > new Date()) {
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
      throw new ApiError(401, 'Invalid email or password');
    }
    await LoginAttempt.deleteOne({ identifier: email });
    const token = setAuthCookies(res, String(user._id), email);
    res.json({ user: publicUser(user), token });
  } catch (e) { next(e); }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('access_token', cookieOpts);
  res.clearCookie('refresh_token', cookieOpts);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: (req as any).user });
});

router.post('/refresh', async (req, res, next) => {
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
});

router.post('/forgot-password', validate(z.object({ email: z.string().email() })), async (req, res, next) => {
  try {
    const email = req.body.email.toLowerCase();
    const user = await User.findOne({ email });
    let resetUrl: string | undefined;
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      await PasswordResetToken.create({ token, userId: user._id, expiresAt: new Date(Date.now() + 3_600_000) });
      resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      console.log(`[auth] password reset link for ${email}: ${resetUrl}`);
    }
    // No email provider configured — the link is returned so the demo flow works end-to-end.
    res.json({ ok: true, message: 'If that email exists, a reset link has been issued.', resetUrl });
  } catch (e) { next(e); }
});

const resetSchema = z.object({ token: z.string().min(10), password: z.string().min(6).max(100) });

router.post('/reset-password', validate(resetSchema), async (req, res, next) => {
  try {
    const record = await PasswordResetToken.findOne({ token: req.body.token });
    if (!record || record.used || record.expiresAt < new Date()) {
      throw new ApiError(400, 'This reset link is invalid or has expired');
    }
    const user = await User.findById(record.userId);
    if (!user) throw new ApiError(400, 'This reset link is invalid or has expired');
    user.passwordHash = await bcrypt.hash(req.body.password, 10);
    await user.save();
    record.used = true;
    await record.save();
    await LoginAttempt.deleteOne({ identifier: user.email });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
