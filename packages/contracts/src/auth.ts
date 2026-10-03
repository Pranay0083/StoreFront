import { z } from 'zod';

export const ROLES = ['customer', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const RegisterSchema = z
  .object({
    name: z
      .string({ required_error: 'Name is required' })
      .min(2, 'Name must be at least 2 characters')
      .max(80, 'Name cannot exceed 80 characters'),
    email: z.string({ required_error: 'Email is required' }).email('Please provide a valid email address'),
    password: z
      .string({ required_error: 'Password is required' })
      .min(6, 'Password must be at least 6 characters')
      .max(100, 'Password cannot exceed 100 characters'),
  })
  .strict();
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z
  .object({
    email: z.string({ required_error: 'Email is required' }).email('Please provide a valid email address'),
    password: z.string({ required_error: 'Password is required' }).min(1, 'Password cannot be empty'),
  })
  .strict();
export type LoginInput = z.infer<typeof LoginSchema>;

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthResponse {
  user: User;
  token?: string;
}

export interface AuthSessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  ip?: string;
  userAgent?: string;
  current: boolean;
}
