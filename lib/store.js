// Orders and subscriptions. Separate from the wallet database, which
// zcash-devtool owns.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'checkout.sqlite'));
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, label TEXT, amount_zat INTEGER, address TEXT UNIQUE,
    created_at INTEGER, status TEXT, paid_zat INTEGER, txid TEXT, paid_at INTEGER,
    height INTEGER, memo TEXT, sub_id TEXT, source TEXT, value_usd REAL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY, customer TEXT, plan TEXT, amount_zat INTEGER,
    interval_ms INTEGER, created_at INTEGER, next_due INTEGER, current_order TEXT
  );
`);

// Add any columns missing from databases created by older versions.
const have = new Set(db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name));
for (const [col, type] of [['value_usd', 'REAL'], ['usdc_deposit', 'TEXT'], ['usdc_amount', 'TEXT'], ['usdc_amount_fmt', 'TEXT'], ['usdc_status', 'TEXT'], ['usdc_chain', 'TEXT']]) {
  if (!have.has(col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} ${type}`);
}

function insert(table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => row[c]));
}

function update(table, id, fields) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ?`)
    .run(...cols.map((c) => fields[c]), id);
}

export const store = {
  insertOrder: (o) => insert('orders', o),
  updateOrder: (id, f) => update('orders', id, f),
  order: (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id),
  orders: () => db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all(),
  openOrders: () => db.prepare("SELECT * FROM orders WHERE status != 'paid'").all(),
  ordersForSubscription: (subId) => db.prepare('SELECT * FROM orders WHERE sub_id = ? ORDER BY created_at').all(subId),

  insertSubscription: (s) => insert('subscriptions', s),
  updateSubscription: (id, f) => update('subscriptions', id, f),
  subscription: (id) => db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id),
  subscriptions: () => db.prepare('SELECT * FROM subscriptions ORDER BY created_at DESC').all(),
};
