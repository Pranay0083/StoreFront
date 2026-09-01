import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, validate } from '../middleware';
import { authLimiter } from '../middleware/failsafes';
import * as authController from '../controllers/auth.controller';

const router = Router();

const registerSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).min(2, 'Name must be at least 2 characters').max(80, 'Name cannot exceed 80 characters'),
  email: z.string({ required_error: 'Email is required' }).email('Please provide a valid email address'),
  password: z.string({ required_error: 'Password is required' }).min(6, 'Password must be at least 6 characters').max(100, 'Password cannot exceed 100 characters'),
}).strict();
router.post('/register', authLimiter, validate(registerSchema), authController.register);

const loginSchema = z.object({ 
  email: z.string({ required_error: 'Email is required' }).email('Please provide a valid email address'), 
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password cannot be empty') 
}).strict();
router.post('/login', authLimiter, validate(loginSchema), authController.login);

router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.getMe);
router.post('/refresh', authController.refresh);

const forgotSchema = z.object({ email: z.string({ required_error: 'Email is required' }).email('Please provide a valid email address') }).strict();
router.post('/forgot-password', validate(forgotSchema), authController.forgotPassword);

const resetSchema = z.object({ 
  token: z.string({ required_error: 'Reset token is required' }).min(10, 'Invalid token format'), 
  password: z.string({ required_error: 'New password is required' }).min(6, 'Password must be at least 6 characters').max(100, 'Password cannot exceed 100 characters') 
}).strict();
router.post('/reset-password', validate(resetSchema), authController.resetPassword);

export default router;
