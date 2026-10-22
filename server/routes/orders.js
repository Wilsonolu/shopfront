import { Router } from 'express';
import { HttpError, intField } from '../errors.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { transaction } from '../db.js';

const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
// Allowed forward transitions for admins.
const NEXT = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

export default function orderRoutes(db) {
  const r = Router();
  r.use(requireAuth(db));

  const withItems = (order) => ({
    ...order,
    items: db.prepare('SELECT product_id, name, unit_price_cents, quantity FROM order_items WHERE order_id = ?').all(order.id),
  });

  const restock = (orderId) => {
    db.prepare(
      `UPDATE products SET stock = stock + (SELECT quantity FROM order_items WHERE order_id = ? AND product_id = products.id)
       WHERE id IN (SELECT product_id FROM order_items WHERE order_id = ?)`
    ).run(orderId, orderId);
  };

  // Checkout: turn the cart into an order atomically.
  r.post('/', (req, res) => {
    const address = req.body?.shipping_address;
    if (typeof address !== 'string' || !address.trim()) throw new HttpError(400, 'shipping_address required');
    const order = transaction(db, () => {
      const lines = db
        .prepare(
          `SELECT c.product_id, c.quantity, p.name, p.price_cents, p.stock, p.active
           FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ?`
        )
        .all(req.user.id);
      if (!lines.length) throw new HttpError(400, 'Cart is empty');
      for (const l of lines) {
        if (!l.active) throw new HttpError(409, `${l.name} is no longer available`);
        if (l.quantity > l.stock) throw new HttpError(409, `Only ${l.stock} of ${l.name} in stock`);
      }
      const total = lines.reduce((n, l) => n + l.quantity * l.price_cents, 0);
      const { lastInsertRowid: orderId } = db
        .prepare('INSERT INTO orders (user_id, total_cents, shipping_address) VALUES (?,?,?)')
        .run(req.user.id, total, address.trim());
      const addItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, unit_price_cents, quantity) VALUES (?,?,?,?,?)');
      const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
      for (const l of lines) {
        addItem.run(orderId, l.product_id, l.name, l.price_cents, l.quantity);
        dec.run(l.quantity, l.product_id);
      }
      db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.user.id);
      return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    });
    res.status(201).json(withItems(order));
  });

  // Customers see their own orders; admins see all (optionally filtered by status).
  r.get('/', (req, res) => {
    const admin = req.user.role === 'admin';
    const where = [];
    const params = [];
    if (!admin) { where.push('o.user_id = ?'); params.push(req.user.id); }
    if (req.query.status) {
      if (!STATUSES.includes(req.query.status)) throw new HttpError(400, 'Unknown status');
      where.push('o.status = ?');
      params.push(req.query.status);
    }
    const rows = db
      .prepare(
        `SELECT o.*, u.email AS user_email FROM orders o JOIN users u ON u.id = o.user_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC`
      )
      .all(...params);
    res.json(rows.map(withItems));
  });

  const loadOwned = (req) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(intField(req.params.id, 'id', { min: 1 }));
    // 404 rather than 403 so ids of other users' orders aren't revealed.
    if (!o || (req.user.role !== 'admin' && o.user_id !== req.user.id)) throw new HttpError(404, 'Order not found');
    return o;
  };

  r.get('/:id', (req, res) => res.json(withItems(loadOwned(req))));

  r.post('/:id/cancel', (req, res) => {
    const o = loadOwned(req);
    if (!['pending', 'paid'].includes(o.status)) throw new HttpError(409, `Cannot cancel a ${o.status} order`);
    transaction(db, () => {
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(o.id);
      restock(o.id);
    });
    res.json(withItems({ ...o, status: 'cancelled' }));
  });

  r.patch('/:id/status', requireAdmin, (req, res) => {
    const o = loadOwned(req);
    const status = req.body?.status;
    if (!NEXT[o.status].includes(status)) throw new HttpError(409, `Cannot move order from ${o.status} to ${status}`);
    transaction(db, () => {
      db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, o.id);
      if (status === 'cancelled') restock(o.id);
    });
    res.json(withItems({ ...o, status }));
  });

  return r;
}
