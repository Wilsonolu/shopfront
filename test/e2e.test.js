import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';

let server, base, db;

before(async () => {
  db = openDb(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

async function api(method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('full shopping workflow', async () => {
  // Register + login + profile
  const reg = await api('POST', '/auth/register', { body: { email: 'Bob@Example.com', name: 'Bob', password: 'password1' } });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.role, 'customer');
  const dup = await api('POST', '/auth/register', { body: { email: 'bob@example.com', name: 'B', password: 'password1' } });
  assert.equal(dup.status, 409);
  const bad = await api('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const { token } = (await api('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'password1' } })).body;
  assert.equal((await api('GET', '/auth/me', { token })).body.user.name, 'Bob');

  // Browse
  const list = await api('GET', '/products?category=electronics&sort=price_asc');
  assert.ok(list.body.items.length >= 3);
  assert.ok(list.body.items.every((p, i, a) => i === 0 || a[i - 1].price_cents <= p.price_cents));
  assert.ok((await api('GET', '/products?q=mug')).body.items.some((p) => p.name.includes('Mug')));
  assert.equal((await api('GET', '/products?q=%25')).body.total, 0); // wildcard is escaped
  const [a, b] = list.body.items;

  // Cart
  assert.equal((await api('GET', '/cart')).status, 401);
  await api('POST', '/cart/items', { token, body: { product_id: a.id, quantity: 2 } });
  const c2 = await api('POST', '/cart/items', { token, body: { product_id: a.id, quantity: 1 } });
  assert.equal(c2.body.items[0].quantity, 3);
  const over = await api('POST', '/cart/items', { token, body: { product_id: b.id, quantity: b.stock + 1 } });
  assert.equal(over.status, 409);
  await api('POST', '/cart/items', { token, body: { product_id: b.id } });
  const upd = await api('PATCH', `/cart/items/${b.id}`, { token, body: { quantity: 2 } });
  assert.equal(upd.body.total_cents, 3 * a.price_cents + 2 * b.price_cents);
  const rm = await api('PATCH', `/cart/items/${b.id}`, { token, body: { quantity: 0 } });
  assert.equal(rm.body.items.length, 1);

  // Checkout
  assert.equal((await api('POST', '/orders', { token, body: {} })).status, 400);
  const order = await api('POST', '/orders', { token, body: { shipping_address: '1 Main St' } });
  assert.equal(order.status, 201);
  assert.equal(order.body.total_cents, 3 * a.price_cents);
  assert.equal(order.body.items[0].quantity, 3);
  assert.equal((await api('GET', '/cart', { token })).body.items.length, 0);
  assert.equal((await api('GET', `/products/${a.id}`)).body.stock, a.stock - 3);
  assert.equal((await api('POST', '/orders', { token, body: { shipping_address: 'x' } })).status, 400); // empty cart

  // Isolation between users
  const other = (await api('POST', '/auth/register', { body: { email: 'eve@example.com', name: 'Eve', password: 'password1' } })).body.token;
  assert.equal((await api('GET', `/orders/${order.body.id}`, { token: other })).status, 404);
  assert.equal((await api('GET', '/orders', { token: other })).body.length, 0);

  // Customers can't use admin endpoints
  assert.equal((await api('PATCH', `/orders/${order.body.id}/status`, { token, body: { status: 'paid' } })).status, 403);
  assert.equal((await api('POST', '/products', { token, body: { name: 'x', price_cents: 1 } })).status, 403);

  // Admin: manage order lifecycle
  const admin = (await api('POST', '/auth/login', { body: { email: 'admin@shop.test', password: 'admin1234' } })).body.token;
  assert.equal((await api('PATCH', `/orders/${order.body.id}/status`, { token: admin, body: { status: 'delivered' } })).status, 409);
  assert.equal((await api('PATCH', `/orders/${order.body.id}/status`, { token: admin, body: { status: 'paid' } })).body.status, 'paid');
  assert.ok((await api('GET', '/orders?status=paid', { token: admin })).body.length >= 1);

  // Cancel restores stock
  const cancel = await api('POST', `/orders/${order.body.id}/cancel`, { token });
  assert.equal(cancel.body.status, 'cancelled');
  assert.equal((await api('GET', `/products/${a.id}`)).body.stock, a.stock);
  assert.equal((await api('POST', `/orders/${order.body.id}/cancel`, { token })).status, 409);
});

test('admin product CRUD', async () => {
  const admin = (await api('POST', '/auth/login', { body: { email: 'admin@shop.test', password: 'admin1234' } })).body.token;
  assert.equal((await api('POST', '/products', { token: admin, body: { name: '', price_cents: 5 } })).status, 400);
  assert.equal((await api('POST', '/products', { token: admin, body: { name: 'X', price_cents: -5 } })).status, 400);
  const p = (await api('POST', '/products', { token: admin, body: { name: 'Gadget', price_cents: 1000, stock: 5, category: 'misc' } })).body;
  assert.equal(p.stock, 5);
  const put = await api('PUT', `/products/${p.id}`, { token: admin, body: { price_cents: 1500 } });
  assert.equal(put.body.price_cents, 1500);
  assert.equal(put.body.name, 'Gadget');
  assert.equal((await api('DELETE', `/products/${p.id}`, { token: admin })).status, 204);
  assert.equal((await api('GET', `/products/${p.id}`)).status, 404);
  assert.equal((await api('PUT', '/products/99999', { token: admin, body: { name: 'n' } })).status, 404);
});

test('concurrent checkout cannot oversell', async () => {
  const admin = (await api('POST', '/auth/login', { body: { email: 'admin@shop.test', password: 'admin1234' } })).body.token;
  const p = (await api('POST', '/products', { token: admin, body: { name: 'Rare', price_cents: 100, stock: 1 } })).body;
  const users = [];
  for (const n of ['u1', 'u2']) {
    const t = (await api('POST', '/auth/register', { body: { email: `${n}@x.com`, name: n, password: 'password1' } })).body.token;
    await api('POST', '/cart/items', { token: t, body: { product_id: p.id } });
    users.push(t);
  }
  const res = await Promise.all(users.map((token) => api('POST', '/orders', { token, body: { shipping_address: 'a' } })));
  assert.deepEqual(res.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await api('GET', `/products/${p.id}`)).body.stock, 0);
});
