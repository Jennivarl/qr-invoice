import express from 'express';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as wallet from './lib/wallet.js';
import { store } from './lib/store.js';
import * as intents from './lib/intents.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const SYNC_EVERY_MS = Number(process.env.SYNC_EVERY_MS || 15_000);
const ORDER_TTL_MS = 30 * 60_000;
const ZAT = 100_000_000;

const app = express();
app.use(express.json());
// The embed button calls the API from other sites.
app.use('/api', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const toZat = (zec) => Math.round(Number(zec) * ZAT);
const toZec = (zat) => (zat / ZAT).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
const newId = () => crypto.randomBytes(5).toString('hex');
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

// ZIP 321 payment request. Memo is base64url per the spec.
function paymentUri(order) {
  const memo = Buffer.from(`Order ${order.id}`).toString('base64url');
  return `zcash:${order.address}?amount=${toZec(order.amount_zat)}&memo=${memo}`;
}

// value_usd is the item's real-world price; demo orders charge a token amount.
async function createOrder({ label, amountZec, subId = null, source = 'web', valueUsd = null }) {
  const amount_zat = toZat(amountZec);
  if (!label || !(amount_zat > 0)) throw Object.assign(new Error('label and amount are required'), { status: 400 });
  const order = {
    id: newId(),
    label: String(label).slice(0, 80),
    amount_zat,
    address: await wallet.newAddress(),
    created_at: Date.now(),
    status: 'pending',
    paid_zat: 0,
    txid: null,
    paid_at: null,
    height: null,
    memo: null,
    sub_id: subId,
    source,
    value_usd: Number(valueUsd) || null,
  };
  store.insertOrder(order);
  return order;
}

function publicOrder(o) {
  return {
    ...o,
    amount: toZec(o.amount_zat),
    paid: toZec(o.paid_zat),
    uri: paymentUri(o),
    expires_at: o.created_at + ORDER_TTL_MS,
  };
}

// ---- Payment detection -------------------------------------------------------

let lastSync = { at: null, ok: null, error: null, tip: null };

function matchPayments() {
  const notes = wallet.receivedNotes();
  const byAddress = new Map();
  for (const n of notes) {
    if (!n.address) continue;
    const list = byAddress.get(n.address) || [];
    list.push(n);
    byAddress.set(n.address, list);
  }
  for (const o of store.openOrders()) {
    const hits = byAddress.get(o.address);
    if (!hits) continue;
    const paid = hits.reduce((s, n) => s + n.value, 0);
    const last = hits[hits.length - 1];
    const status = paid >= o.amount_zat ? 'paid' : 'partial';
    store.updateOrder(o.id, {
      paid_zat: paid,
      status,
      txid: last.txid,
      height: last.height,
      memo: hits.map((n) => n.memo).filter(Boolean).join(' | ') || null,
      paid_at: status === 'paid' ? Date.now() : null,
    });
    if (status === 'paid') console.log(`paid: order ${o.id} ${toZec(paid)} ZEC tx ${last.txid}`);
  }
}

async function syncLoop() {
  try {
    await wallet.sync();
    matchPayments();
    lastSync = { at: Date.now(), ok: true, error: null, tip: wallet.chainTip() };
  } catch (e) {
    lastSync = { at: Date.now(), ok: false, error: String(e.stderr || e.message).slice(-400), tip: wallet.chainTip() };
    console.error('sync failed:', lastSync.error);
  }
  renewSubscriptions().catch((e) => console.error('renewals failed:', e.message));
  setTimeout(syncLoop, SYNC_EVERY_MS);
}

// ---- Subscriptions -------------------------------------------------------------
// Zcash has no pull payments, so each cycle issues a fresh invoice the
// subscriber pays from their wallet.

async function renewSubscriptions() {
  const now = Date.now();
  for (const s of store.subscriptions()) {
    if (s.next_due > now) continue;
    const order = await createOrder({ label: `${s.plan} — renewal`, amountZec: toZec(s.amount_zat), subId: s.id, source: 'subscription' });
    store.updateSubscription(s.id, { next_due: s.next_due + s.interval_ms, current_order: order.id });
  }
}

function subscriptionView(s) {
  const orders = store.ordersForSubscription(s.id);
  const current = orders.find((o) => o.id === s.current_order);
  const unpaid = orders.filter((o) => o.status !== 'paid');
  let state = 'active';
  if (current && current.status !== 'paid') {
    state = Date.now() - current.created_at > s.interval_ms / 2 ? 'late' : 'due';
  }
  return {
    ...s,
    amount: toZec(s.amount_zat),
    state,
    paid_cycles: orders.length - unpaid.length,
    cycles: orders.length,
    current_order: current ? publicOrder(current) : null,
  };
}

// ---- API -------------------------------------------------------------------------

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }));

app.post('/api/orders', wrap(async (req, res) => {
  const order = await createOrder({ label: req.body.label, amountZec: req.body.amount, source: req.body.source || 'web', valueUsd: req.body.value_usd });
  res.json({ ...publicOrder(order), pay_url: `${baseUrl(req)}/pay/${order.id}` });
}));

app.get('/api/orders', (req, res) => res.json(store.orders().map(publicOrder)));

app.get('/api/orders/:id', wrap(async (req, res) => {
  const o = store.order(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.usdc_deposit && o.status !== 'paid' && !['SUCCESS', 'REFUNDED', 'FAILED'].includes(o.usdc_status)) {
    try {
      o.usdc_status = await intents.swapStatus(o.usdc_deposit);
      store.updateOrder(o.id, { usdc_status: o.usdc_status });
    } catch (e) {
      console.error('swap status failed:', e.message);
    }
  }
  res.json({
    ...publicOrder(o),
    usdc: o.usdc_deposit ? { ...usdcView(o), qr: await QRCode.toDataURL(usdcView(o).uri, { margin: 1, width: 320 }) } : null,
    qr: await QRCode.toDataURL(paymentUri(o), { margin: 1, width: 320 }),
    // Fallback for wallets that can't read full payment requests.
    qr_address: await QRCode.toDataURL(o.address, { margin: 1, width: 320 }),
  });
}));

// Pay a ZEC invoice with USDC from another chain. The swap delivers ZEC to the
// order's shielded address, where the viewing-key scan picks it up like any payment.
app.post('/api/orders/:id/usdc', wrap(async (req, res) => {
  const o = store.order(req.params.id);
  if (!o) return res.status(404).json({ error: 'not found' });
  if (o.usdc_deposit) return res.json(usdcView(o));
  const chain = intents.CHAINS[req.body.chain] ? req.body.chain : 'base';
  const refundTo = String(req.body.refund_to || '').trim();
  if (!intents.validRefund(chain, refundTo)) {
    return res.status(400).json({ error: `Enter your ${intents.CHAINS[chain].name} address for refunds` });
  }
  const q = await intents.usdcQuote({ chain, zat: o.amount_zat, zecAddress: o.address, refundTo });
  store.updateOrder(o.id, { usdc_chain: chain, usdc_deposit: q.deposit, usdc_amount: q.amount, usdc_amount_fmt: q.amountFormatted, usdc_status: 'PENDING_DEPOSIT' });
  res.json(usdcView(store.order(o.id)));
}));

function usdcView(o) {
  const chain = o.usdc_chain || 'base';
  return {
    chain,
    chain_name: intents.CHAINS[chain].name,
    deposit: o.usdc_deposit,
    amount: o.usdc_amount_fmt,
    status: o.usdc_status,
    uri: intents.paymentUri(chain, o.usdc_deposit, o.usdc_amount, o.usdc_amount_fmt),
  };
}

app.post('/api/subscriptions', wrap(async (req, res) => {
  const { customer, plan, amount, interval_min } = req.body;
  if (!customer || !plan) return res.status(400).json({ error: 'customer and plan are required' });
  const interval_ms = Math.max(1, Number(interval_min || 10)) * 60_000;
  const sub = {
    id: newId(),
    customer: String(customer).slice(0, 60),
    plan: String(plan).slice(0, 60),
    amount_zat: toZat(amount),
    interval_ms,
    created_at: Date.now(),
    next_due: Date.now() + interval_ms,
    current_order: null,
  };
  store.insertSubscription(sub);
  const first = await createOrder({ label: `${sub.plan} — first payment`, amountZec: amount, subId: sub.id, source: 'subscription' });
  store.updateSubscription(sub.id, { current_order: first.id });
  res.json({ ...subscriptionView(store.subscription(sub.id)), sub_url: `${baseUrl(req)}/sub/${sub.id}` });
}));

app.get('/api/subscriptions', (req, res) => res.json(store.subscriptions().map(subscriptionView)));

app.get('/api/subscriptions/:id', (req, res) => {
  const s = store.subscription(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(subscriptionView(s));
});

// Read-only sales report for an accountant: amounts and dates, no customer data.
app.get('/api/export.csv', (req, res) => {
  const rows = [['date_utc', 'order', 'item', 'amount_zec', 'value_usd', 'status', 'txid', 'block']];
  for (const o of store.orders()) {
    if (o.status === 'pending') continue;
    rows.push([new Date(o.paid_at || o.created_at).toISOString(), o.id, o.label, toZec(o.paid_zat), o.value_usd ?? '', o.status, o.txid || '', o.height || '']);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
  res.send(csv);
});

app.get('/api/status', (req, res) => res.json({ ...lastSync, server_time: Date.now() }));

// Clean URLs for the client-rendered pages.
for (const [route, file] of [['/pay/:id', 'pay.html'], ['/sub/:id', 'sub.html'], ['/world/:id', 'world.html']]) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
}

app.listen(PORT, () => {
  console.log(`listening on :${PORT}`);
  syncLoop();
});
