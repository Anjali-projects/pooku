import jwt from 'jsonwebtoken';
import crypto from 'crypto';

if (!process.env.JWT_SECRET) {
  const generated = crypto.randomBytes(64).toString('hex');
  process.env.JWT_SECRET = generated;
  console.warn('⚠ JWT_SECRET not set — generated a random secret. Sessions will not persist across restarts. Set JWT_SECRET in .env for production.');
}

const JWT_SECRET = process.env.JWT_SECRET;

export function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/'
};

export function authMiddleware(req, res, next) {
  try {
    // Prefer httpOnly cookie, fall back to Authorization header
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}
