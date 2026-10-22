import { Router } from 'express';
import { HttpError, intField } from '../errors.js';
import { requireAuth } from '../auth.js';

export const cartFor = (db, userId) => {
  const items = db
    .prepare(
      `SELECT c.product_id, c.quantity, p.name, p.price_cents, p.stock, p.image_url,
              c.quantity * p.price_cents AS line_cents
       FROM cart_items c JOIN products p ON p.id = c.product_id
       WHERE c.user_id = ? AND p.active = 1 ORDER BY p.name`
    )
    .all(userId);
  return {
    items,
    item_count: items.reduce((n, i) => n + i.quantity, 0),
    total_cents: items.reduce((n, i) => n + i.line_cents, 0),
  };
};

export default function cartRoutes(db) {
  const r = Router();
  r.use(requireAuth(db));

  const activeProduct = (id) => {
    const p = db.prepare('SELECT id, stock FROM products WHERE id = ? AND active = 1').get(id);
    if (!p) throw new HttpError(404, 'Product not found');
    return p;
  };

  r.get('/', (req, res) => res.json(cartFor(db, req.user.id)));

  // Adds to the existing quantity.
  r.post('/items', (req, res) => {
    const productId = intField(req.body?.product_id, 'product_id', { min: 1 });
    const qty = intField(req.body?.quantity ?? 1, 'quantity', { min: 1 });
    const product = activeProduct(productId);
    const existing = db.prepare('SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.user.id, productId);
    const next = (existing?.quantity || 0) + qty;
    if (next > product.stock) throw new HttpError(409, `Only ${product.stock} in stock`);
    db.prepare(
      `INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?,?,?)
       ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = excluded.quantity`
    ).run(req.user.id, productId, next);
    res.status(201).json(cartFor(db, req.user.id));
  });

  // Sets quantity; 0 removes the line.
  r.patch('/items/:productId', (req, res) => {
    const productId = intField(req.params.productId, 'productId', { min: 1 });
    const qty = intField(req.body?.quantity, 'quantity');
    if (qty === 0) {
      db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, productId);
    } else {
      const product = activeProduct(productId);
      if (qty > product.stock) throw new HttpError(409, `Only ${product.stock} in stock`);
      const info = db.prepare('UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?').run(qty, req.user.id, productId);
      if (!info.changes) throw new HttpError(404, 'Item not in cart');
    }
    res.json(cartFor(db, req.user.id));
  });

  r.delete('/items/:productId', (req, res) => {
    db.prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?').run(req.user.id, intField(req.params.productId, 'productId', { min: 1 }));
    res.json(cartFor(db, req.user.id));
  });

  r.delete('/', (req, res) => {
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
    res.json(cartFor(db, req.user.id));
  });

  return r;
}
