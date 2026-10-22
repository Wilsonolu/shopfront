import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const PRODUCTS = [
  ['Wireless Headphones', 'Over-ear Bluetooth headphones with 30h battery.', 7999, 25, 'electronics'],
  ['Mechanical Keyboard', 'Hot-swappable switches, RGB backlight.', 8999, 15, 'electronics'],
  ['USB-C Hub', '7-in-1 hub with HDMI and card reader.', 3499, 40, 'electronics'],
  ['Smart Watch', 'Heart rate, GPS and sleep tracking.', 12999, 10, 'electronics'],
  ['Running Shoes', 'Lightweight, breathable daily trainers.', 6999, 30, 'fashion'],
  ['Denim Jacket', 'Classic fit, medium wash.', 5499, 20, 'fashion'],
  ['Canvas Backpack', '20L with laptop sleeve.', 3999, 35, 'fashion'],
  ['Ceramic Mug Set', 'Set of four 350ml mugs.', 2499, 50, 'home'],
  ['Desk Lamp', 'Dimmable LED with USB charging port.', 2999, 28, 'home'],
  ['Cast Iron Skillet', '10-inch pre-seasoned skillet.', 3499, 18, 'home'],
  ['Yoga Mat', '6mm non-slip mat with strap.', 2299, 45, 'sports'],
  ['Water Bottle', 'Insulated stainless steel, 750ml.', 1999, 60, 'sports'],
];

/** Idempotent: only seeds an empty database. */
export function seed(db) {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const pw = process.env.ADMIN_PASSWORD || 'admin1234';
    db.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,'admin')")
      .run('admin@shop.test', 'Admin', bcrypt.hashSync(pw, 10));
  }
  if (!db.prepare('SELECT 1 FROM products LIMIT 1').get()) {
    const ins = db.prepare('INSERT INTO products (name, description, price_cents, stock, category) VALUES (?,?,?,?,?)');
    for (const p of PRODUCTS) ins.run(...p);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed(openDb());
  console.log('Seeded. Admin: admin@shop.test');
}
