import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { HttpError } from '../errors.js';
import { signToken, requireAuth } from '../auth.js';

export default function authRoutes(db) {
  const r = Router();

  r.post('/register', (req, res) => {
    const { email, name, password } = req.body || {};
    if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Valid email required');
    if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Name required');
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    const normalized = email.trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized)) throw new HttpError(409, 'Email already registered');
    const info = db
      .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
      .run(normalized, name.trim(), bcrypt.hashSync(password, 10));
    const user = { id: Number(info.lastInsertRowid), email: normalized, name: name.trim(), role: 'customer' };
    res.status(201).json({ user, token: signToken(user) });
  });

  r.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!row || !bcrypt.compareSync(String(password || ''), row.password_hash)) throw new HttpError(401, 'Invalid email or password');
    const user = { id: row.id, email: row.email, name: row.name, role: row.role };
    res.json({ user, token: signToken(user) });
  });

  r.get('/me', requireAuth(db), (req, res) => res.json({ user: req.user }));

  r.patch('/me', requireAuth(db), (req, res) => {
    const { name, password } = req.body || {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Name required');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), req.user.id);
    }
    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.user.id);
    }
    res.json({ user: db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(req.user.id) });
  });

  return r;
}
