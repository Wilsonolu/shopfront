# Shopfront

Full-stack e-commerce app: Express + SQLite (built-in `node:sqlite`) API and a no-build vanilla JS frontend.

## Requirements
- Node.js >= 22.5 (uses the built-in `node:sqlite` module, so no database server or native build is needed)
- npm

## Dependencies
Runtime (installed by `npm install`):

| Package | Used for |
|---|---|
| `express` | HTTP server, routing, static file serving |
| `bcryptjs` | password hashing |
| `jsonwebtoken` | login tokens (JWT) |

Built in to Node: `node:sqlite` (database), `node:test` (test runner), `fetch` (used by the tests).
The frontend has no dependencies and no build step.

## How to run
```
cd willie
npm install
npm start        # serves the site and API at http://localhost:3000
```
Then open http://localhost:3000 in a browser.

Run the tests:
```
npm test
```

Other commands and settings:
- `npm run seed` re-runs seeding (only fills an empty database).
- `PORT` sets the port (default 3000).
- `DB_FILE` sets the database path (default `data/shop.db`).
- `JWT_SECRET` sets the token signing secret. Change it outside development.
- `ADMIN_PASSWORD` sets the seeded admin password (default `admin1234`).

The first start seeds 12 products and an admin account: `admin@shop.test` / `admin1234`.
Register a normal account from the site to try the customer flow.

## API (JSON, Bearer-token auth)
| | |
|---|---|
| `POST /api/auth/register`, `/login`; `GET/PATCH /api/auth/me` | accounts |
| `GET /api/products?q&category&min_price&max_price&sort&page&limit`, `/categories`, `/:id` | catalog |
| `POST/PUT/DELETE /api/products[/:id]` (admin) | product management (delete is soft) |
| `GET/POST/PATCH/DELETE /api/cart[/items[/:productId]]` | server-side cart |
| `POST /api/orders` | checkout cart (atomic, checks and decrements stock) |
| `GET /api/orders[/:id]`, `POST /api/orders/:id/cancel` | own orders (admin sees all); cancel restocks |
| `PATCH /api/orders/:id/status` (admin) | pending → paid → shipped → delivered |

Prices are integer cents. Order items snapshot name and price at purchase time.
