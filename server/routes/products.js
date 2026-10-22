import { Router } from 'express';
import { HttpError, intField } from '../errors.js';
import { requireAuth, requireAdmin } from '../auth.js';

const SORTS = {
  newest: 'created_at DESC, id DESC',
  price_asc: 'price_cents ASC',
  price_desc: 'price_cents DESC',
  name: 'name COLLATE NOCASE ASC',
};

function parseProduct(body, partial) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('name')) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'name required');
    out.name = body.name.trim();
  }
  if (!partial || has('price_cents')) out.price_cents = intField(body.price_cents, 'price_cents');
  if (has('stock')) out.stock = intField(body.stock, 'stock');
  for (const k of ['description', 'category', 'image_url']) {
    if (has(k)) {
      if (typeof body[k] !== 'string') throw new HttpError(400, `${k} must be a string`);
      out[k] = body[k].trim();
    }
  }
  if (has('active')) out.active = body.active ? 1 : 0;
  return out;
}

export default function productRoutes(db) {
  const r = Router();
  const auth = requireAuth(db);

  r.get('/', (req, res) => {
    const where = ['active = 1'];
    const params = [];
    if (req.query.q) {
      const like = `%${String(req.query.q).replace(/[%_\\]/g, '\\$&')}%`;
      where.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    if (req.query.category) { where.push('category = ?'); params.push(String(req.query.category)); }
    if (req.query.min_price !== undefined) { where.push('price_cents >= ?'); params.push(intField(req.query.min_price, 'min_price')); }
    if (req.query.max_price !== undefined) { where.push('price_cents <= ?'); params.push(intField(req.query.max_price, 'max_price')); }
    const order = SORTS[req.query.sort] || SORTS.newest;
    const limit = Math.min(intField(req.query.limit ?? 12, 'limit', { min: 1 }), 100);
    const page = intField(req.query.page ?? 1, 'page', { min: 1 });
    const clause = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM products WHERE ${clause}`).get(...params).n;
    const items = db
      .prepare(`SELECT * FROM products WHERE ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, (page - 1) * limit);
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });

  r.get('/categories', (_req, res) => {
    res.json(db.prepare('SELECT category, COUNT(*) AS count FROM products WHERE active = 1 GROUP BY category ORDER BY category').all());
  });

  r.get('/:id', (req, res) => {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(intField(req.params.id, 'id', { min: 1 }));
    if (!p) throw new HttpError(404, 'Product not found');
    res.json(p);
  });

  r.post('/', auth, requireAdmin, (req, res) => {
    const p = { description: '', category: 'general', image_url: '', stock: 0, active: 1, ...parseProduct(req.body || {}, false) };
    const info = db
      .prepare('INSERT INTO products (name, description, price_cents, stock, category, image_url, active) VALUES (?,?,?,?,?,?,?)')
      .run(p.name, p.description, p.price_cents, p.stock, p.category, p.image_url, p.active);
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/:id', auth, requireAdmin, (req, res) => {
    const id = intField(req.params.id, 'id', { min: 1 });
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(id)) throw new HttpError(404, 'Product not found');
    const fields = parseProduct(req.body || {}, true);
    const keys = Object.keys(fields);
    if (keys.length) {
      db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    }
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  });

  // Soft delete: past orders keep referencing the product.
  r.delete('/:id', auth, requireAdmin, (req, res) => {
    const info = db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(intField(req.params.id, 'id', { min: 1 }));
    if (!info.changes) throw new HttpError(404, 'Product not found');
    res.status(204).end();
  });

  return r;
}
