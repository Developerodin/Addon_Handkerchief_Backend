import rateLimit from 'express-rate-limit';

/** Failed logins allowed before the temporary lockout. */
const LOGIN_MAX_ATTEMPTS = 10;

/** How long failed attempts are remembered. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Rate-limit key is the account, not the office IP.
 * Refresh and other users on the same network were filling a shared bucket.
 * @param {import('express').Request} req
 * @returns {string}
 */
const loginKey = (req) => {
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  return email || req.ip || 'unknown';
};

/**
 * Counts failed logins only. A successful login is not counted.
 * Mounted on POST /v1/auth/login, not the rest of /v1/auth.
 */
const authLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX_ATTEMPTS,
  skipSuccessfulRequests: true,
  keyGenerator: loginKey,
  message: {
    code: 429,
    message: 'Too many login attempts. Try again in 15 minutes.',
  },
});

export {
  authLimiter,
};

