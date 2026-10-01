import rateLimit from 'express-rate-limit';

const skip = () => process.env.NODE_ENV === 'test';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, 
  legacyHeaders: false,
  skip,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});

export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 login/register requests per `window`
  standardHeaders: true, 
  legacyHeaders: false,
  skip,
  message: { error: 'Too many authentication attempts from this IP, please try again after an hour' }
});
