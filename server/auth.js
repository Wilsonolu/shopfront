import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';

export const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: '7d' });

export function requireAuth(db) {
  return (req, _res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(new HttpError(401, 'Authentication required'));
    try {
      const payload = jwt.verify(token, SECRET);
      const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(payload.sub);
      if (!user) throw new Error('no user');
      req.user = user;
      next();
    } catch {
      next(new HttpError(401, 'Invalid or expired token'));
    }
  };
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Admin only'));
  next();
}
