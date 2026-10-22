// Tiny hash-routed SPA. No build step.
const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

const state = { token: localStorage.getItem('token'), user: null, cartCount: 0 };

const money = (c) => `$${(c / 100).toFixed(2)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  setTimeout(() => $toast.classList.remove('show'), 2200);
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', ...(state.token && { authorization: `Bearer ${state.token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  if (res.status === 401 && state.token) setSession(null, null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  state.cartCount = 0;
  token ? localStorage.setItem('token', token) : localStorage.removeItem('token');
}

async function refreshCartCount() {
  if (!state.user) return (state.cartCount = 0);
  state.cartCount = (await api('GET', '/cart')).item_count;
}

function renderNav() {
  const u = state.user;
  $nav.innerHTML = u
    ? `<a href="#/">Shop</a><a href="#/cart">Cart (${state.cartCount})</a><a href="#/orders">Orders</a>
       ${u.role === 'admin' ? '<a href="#/admin">Admin</a>' : ''}<a href="#/account">${esc(u.name)}</a><a href="#/logout">Log out</a>`
    : `<a href="#/">Shop</a><a href="#/login">Log in</a><a href="#/register">Sign up</a>`;
}

const thumb = (p) => `<div class="thumb" style="background:hsl(${hue(p.name)} 55% 50%)">${esc(p.name[0])}</div>`;

// ---------- views ----------
const views = {};

views.home = async (params) => {
  const q = Object.fromEntries(params);
  const qs = new URLSearchParams({ limit: 8, ...q }).toString();
  const [data, cats] = await Promise.all([api('GET', `/products?${qs}`), api('GET', '/products/categories')]);
  const page = data.page;
  const link = (p) => `#/?${new URLSearchParams({ ...q, page: p })}`;
  $app.innerHTML = `
    <h1>Products</h1>
    <form class="toolbar" id="filters">
      <input name="q" placeholder="Search…" value="${esc(q.q || '')}">
      <select name="category"><option value="">All categories</option>
        ${cats.map((c) => `<option value="${esc(c.category)}" ${q.category === c.category ? 'selected' : ''}>${esc(c.category)} (${c.count})</option>`).join('')}</select>
      <select name="sort">${[['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['name', 'Name']]
        .map(([v, l]) => `<option value="${v}" ${q.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button>Apply</button>
    </form>
    ${data.items.length ? `<div class="grid">${data.items.map((p) => `
      <div class="card">${thumb(p)}
        <a href="#/product/${p.id}"><strong>${esc(p.name)}</strong></a>
        <span class="mute">${esc(p.category)}</span>
        <span class="price">${money(p.price_cents)}</span>
        <button data-add="${p.id}" ${p.stock ? '' : 'disabled'}>${p.stock ? 'Add to cart' : 'Out of stock'}</button>
      </div>`).join('')}</div>` : '<p class="mute">No products match.</p>'}
    <div class="pager">
      ${page > 1 ? `<a href="${link(page - 1)}">‹ Prev</a>` : ''}<span>Page ${page} of ${data.pages}</span>
      ${page < data.pages ? `<a href="${link(page + 1)}">Next ›</a>` : ''}
    </div>`;
  document.getElementById('filters').onsubmit = (e) => {
    e.preventDefault();
    const f = new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v));
    location.hash = `#/?${f}`;
  };
  $app.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => addToCart(b.dataset.add)));
};

async function addToCart(id, quantity = 1) {
  if (!state.user) { location.hash = '#/login'; return; }
  const cart = await api('POST', '/cart/items', { product_id: Number(id), quantity });
  state.cartCount = cart.item_count;
  renderNav();
  toast('Added to cart');
}

views.product = async ([id]) => {
  const p = await api('GET', `/products/${id}`);
  $app.innerHTML = `
    <p><a href="#/">‹ Back</a></p>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
      ${thumb(p)}
      <div><h1>${esc(p.name)}</h1><p>${esc(p.description)}</p>
        <p class="price">${money(p.price_cents)}</p>
        <p class="mute">${p.stock ? `${p.stock} in stock` : 'Out of stock'}</p>
        <div class="row"><input type="number" id="qty" min="1" max="${p.stock}" value="1" style="width:80px">
        <button id="add" ${p.stock ? '' : 'disabled'}>Add to cart</button></div></div>
    </div>`;
  document.getElementById('add').onclick = () => addToCart(p.id, Number(document.getElementById('qty').value));
};

views.cart = async () => {
  requireLogin();
  const cart = await api('GET', '/cart');
  if (!cart.items.length) { $app.innerHTML = '<h1>Your cart</h1><p class="mute">Your cart is empty. <a href="#/">Browse products</a>.</p>'; return; }
  $app.innerHTML = `<h1>Your cart</h1>
    <div class="table-wrap"><table><tr><th>Item</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr>
    ${cart.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${money(i.price_cents)}</td>
      <td><input type="number" min="0" max="${i.stock}" value="${i.quantity}" data-qty="${i.product_id}" style="width:70px"></td>
      <td>${money(i.line_cents)}</td><td><button class="ghost" data-rm="${i.product_id}">Remove</button></td></tr>`).join('')}</table></div>
    <p class="total">Total: <strong>${money(cart.total_cents)}</strong></p>
    <form id="checkout" class="form" style="margin-left:auto">
      <textarea name="shipping_address" placeholder="Shipping address" required rows="3"></textarea>
      <button>Place order</button><span class="error" id="err"></span>
    </form>`;
  const reload = () => route();
  $app.querySelectorAll('[data-qty]').forEach((el) => (el.onchange = () =>
    api('PATCH', `/cart/items/${el.dataset.qty}`, { quantity: Number(el.value) }).then(reload, (e) => { toast(e.message); reload(); })));
  $app.querySelectorAll('[data-rm]').forEach((el) => (el.onclick = () => api('DELETE', `/cart/items/${el.dataset.rm}`).then(reload)));
  document.getElementById('checkout').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const order = await api('POST', '/orders', { shipping_address: new FormData(e.target).get('shipping_address') });
      toast(`Order #${order.id} placed`);
      location.hash = '#/orders';
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
};

const orderRow = (o, admin) => `<tr>
  <td>#${o.id}</td><td>${esc(o.created_at)}</td>${admin ? `<td>${esc(o.user_email)}</td>` : ''}
  <td>${o.items.map((i) => `${i.quantity}× ${esc(i.name)}`).join('<br>')}</td>
  <td>${money(o.total_cents)}</td><td><span class="badge ${o.status}">${o.status}</span></td>
  <td>${admin ? adminActions(o) : ['pending', 'paid'].includes(o.status) ? `<button class="ghost" data-cancel="${o.id}">Cancel</button>` : ''}</td></tr>`;

const NEXT = { pending: ['paid', 'cancelled'], paid: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };
const adminActions = (o) => NEXT[o.status].map((s) => `<button class="${s === 'cancelled' ? 'danger' : 'ghost'}" data-status="${o.id}:${s}">${s}</button>`).join(' ');

views.orders = async () => {
  requireLogin();
  const orders = await api('GET', '/orders');
  $app.innerHTML = `<h1>My orders</h1>${orders.length ? `<div class="table-wrap"><table>
    <tr><th>Order</th><th>Placed</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr>
    ${orders.map((o) => orderRow(o, false)).join('')}</table></div>` : '<p class="mute">No orders yet.</p>'}`;
  $app.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () =>
    api('POST', `/orders/${b.dataset.cancel}/cancel`).then(() => { toast('Order cancelled'); route(); }, (e) => toast(e.message))));
};

views.account = async () => {
  requireLogin();
  $app.innerHTML = `<h1>My account</h1>
    <form class="form" id="profile">
      <label>Email<input value="${esc(state.user.email)}" disabled></label>
      <label>Name<input name="name" value="${esc(state.user.name)}" required></label>
      <label>New password (optional)<input type="password" name="password" minlength="8"></label>
      <button>Save</button><span class="error" id="err"></span></form>`;
  document.getElementById('profile').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (!f.password) delete f.password;
    try { state.user = (await api('PATCH', '/auth/me', f)).user; renderNav(); toast('Saved'); }
    catch (err) { document.getElementById('err').textContent = err.message; }
  };
};

const authView = (mode) => async () => {
  const reg = mode === 'register';
  $app.innerHTML = `<h1>${reg ? 'Create account' : 'Log in'}</h1>
    <form class="form" id="auth">
      ${reg ? '<input name="name" placeholder="Name" required>' : ''}
      <input name="email" type="email" placeholder="Email" required>
      <input name="password" type="password" placeholder="Password (min 8 chars)" required minlength="8">
      <button>${reg ? 'Sign up' : 'Log in'}</button><span class="error" id="err"></span>
      <span class="mute">${reg ? '<a href="#/login">Have an account? Log in</a>' : '<a href="#/register">New here? Sign up</a>'}</span>
    </form>`;
  document.getElementById('auth').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { token, user } = await api('POST', `/auth/${mode}`, Object.fromEntries(new FormData(e.target)));
      setSession(token, user);
      await refreshCartCount();
      location.hash = '#/';
    } catch (err) { document.getElementById('err').textContent = err.message; }
  };
};
views.login = authView('login');
views.register = authView('register');

views.admin = async () => {
  requireLogin();
  if (state.user.role !== 'admin') { location.hash = '#/'; return; }
  const [products, orders] = await Promise.all([api('GET', '/products?limit=100&sort=name'), api('GET', '/orders')]);
  $app.innerHTML = `<h1>Admin</h1><h2>Add product</h2>
    <form id="new" class="form-grid">
      <input name="name" placeholder="Name" required><input name="category" placeholder="Category">
      <input name="price" type="number" step="0.01" min="0" placeholder="Price ($)" required>
      <input name="stock" type="number" min="0" placeholder="Stock" required>
      <input name="description" placeholder="Description"><button>Add</button></form>
    <h2>Products</h2><div class="table-wrap"><table><tr><th>Name</th><th>Price ($)</th><th>Stock</th><th></th></tr>
    ${products.items.map((p) => `<tr data-id="${p.id}"><td>${esc(p.name)}</td>
      <td><input type="number" step="0.01" min="0" value="${(p.price_cents / 100).toFixed(2)}" data-f="price" style="width:100px"></td>
      <td><input type="number" min="0" value="${p.stock}" data-f="stock" style="width:80px"></td>
      <td><button data-save>Save</button> <button class="danger" data-del>Delete</button></td></tr>`).join('')}</table></div>
    <h2>Orders</h2><div class="table-wrap"><table><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Move to</th></tr>
    ${orders.map((o) => orderRow(o, true)).join('')}</table></div>`;
  const guard = (p) => p.then(() => route(), (e) => toast(e.message));
  document.getElementById('new').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    guard(api('POST', '/products', { name: f.name, category: f.category || 'general', description: f.description,
      price_cents: Math.round(Number(f.price) * 100), stock: Number(f.stock) }));
  };
  $app.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const val = (f) => tr.querySelector(`[data-f=${f}]`).value;
    tr.querySelector('[data-save]').onclick = () => guard(api('PUT', `/products/${id}`, { price_cents: Math.round(Number(val('price')) * 100), stock: Number(val('stock')) }));
    tr.querySelector('[data-del]').onclick = () => confirm('Delete this product?') && guard(api('DELETE', `/products/${id}`));
  });
  $app.querySelectorAll('[data-status]').forEach((b) => (b.onclick = () => {
    const [id, status] = b.dataset.status.split(':');
    guard(api('PATCH', `/orders/${id}/status`, { status }));
  }));
};

// ---------- router ----------
function requireLogin() {
  if (!state.user) { location.hash = '#/login'; throw new Error('redirect'); }
}

async function route() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  const parts = path.split('/').filter(Boolean);
  const name = parts[0] || 'home';
  if (name === 'logout') { setSession(null, null); renderNav(); location.hash = '#/'; return; }
  const view = views[name] || views.home;
  try {
    await view(name === 'home' || !views[name] ? new URLSearchParams(query) : parts.slice(1));
  } catch (e) {
    if (e.message !== 'redirect') $app.innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
  renderNav();
}

window.addEventListener('hashchange', route);
(async () => {
  if (state.token) {
    try { state.user = (await api('GET', '/auth/me')).user; await refreshCartCount(); } catch { setSession(null, null); }
  }
  route();
})();
