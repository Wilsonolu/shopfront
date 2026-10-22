import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const db = openDb();
seed(db);
const port = process.env.PORT || 3000;
createApp(db).listen(port, () => console.log(`Shop running at http://localhost:${port}`));
