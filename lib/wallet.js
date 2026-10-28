// View-only merchant wallet, driven through zcash-devtool.
// The wallet holds a Unified Full Viewing Key only: it can see incoming
// payments but has no spending key.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const run = promisify(execFile);

const BIN = process.env.ZDT_BIN || 'zcash-devtool';
const WALLET_DIR = process.env.WALLET_DIR || '/data/wallet';
const LWD = process.env.LWD_SERVER || 'zecrocks';

// zcash-devtool opens the wallet database itself, so calls must not overlap.
let queue = Promise.resolve();
function devtool(args, timeout = 120_000) {
  const job = queue.then(() =>
    run(BIN, ['wallet', '-w', WALLET_DIR, ...args], { timeout, maxBuffer: 16 << 20 })
  );
  queue = job.catch(() => {});
  return job;
}

export async function newAddress() {
  const { stdout } = await devtool(['generate-address']);
  const m = stdout.match(/Address:\s+(u1[0-9a-z]+)/);
  if (!m) throw new Error('generate-address returned no address');
  return m[1];
}

export async function sync() {
  await devtool(['sync', '-s', LWD], 600_000);
}

function dbPath() {
  return path.join(WALLET_DIR, 'data.sqlite');
}

// Zcash displays txids byte-reversed.
function txidHex(blob) {
  return Buffer.from(blob).reverse().toString('hex');
}

// ZIP 302: first byte <= 0xF4 means UTF-8 text, padded with zeros.
function memoText(blob) {
  if (!blob) return '';
  const b = Buffer.from(blob);
  if (b[0] > 0xf4) return '';
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return b.subarray(0, end).toString('utf8');
}

function hasColumn(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
}

// Every shielded note the wallet has received, with the address it was sent to.
export function receivedNotes() {
  if (!fs.existsSync(dbPath())) return [];
  const db = new DatabaseSync(dbPath(), { readOnly: true });
  try {
    const parts = [];
    // One table per shielded pool (sapling, orchard, ironwood, ...).
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name GLOB '*_received_notes'").all();
    for (const { name: table } of tables) {
      const pool = table.replace('_received_notes', '');
      if (!hasColumn(db, table, 'address_id')) continue;
      parts.push(`
        SELECT '${pool}' AS pool, a.address AS address, n.value AS value, n.memo AS memo,
               t.txid AS txid, t.mined_height AS height, t.block AS block, n.is_change AS is_change
        FROM ${table} n
        JOIN transactions t ON t.id_tx = n.transaction_id
        LEFT JOIN addresses a ON a.id = n.address_id`);
    }
    if (!parts.length) return [];
    return db.prepare(parts.join(' UNION ALL ')).all()
      .filter((r) => !r.is_change)
      .map((r) => ({
        pool: r.pool,
        address: r.address,
        value: Number(r.value),
        memo: memoText(r.memo),
        txid: txidHex(r.txid),
        height: r.height ?? r.block ?? null,
      }));
  } finally {
    db.close();
  }
}

export function chainTip() {
  if (!fs.existsSync(dbPath())) return null;
  const db = new DatabaseSync(dbPath(), { readOnly: true });
  try {
    return db.prepare('SELECT MAX(height) AS h FROM blocks').get()?.h ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}
