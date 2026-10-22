// ApnaKapda payment server (Razorpay + Firebase Admin)
//
// Why a server is needed at all:
// A razorpay.me/@name link is only a payment page. It sends nothing back to the
// website, so the website can never know "this customer really paid for order
// APK123". Only a server that (a) creates the Razorpay order with the secret key
// and (b) checks the HMAC signature can prove a payment is genuine.
//
// What this server does:
//   POST /api/create-order    -> makes a Razorpay order for the shop orders (money in paise)
//   POST /api/verify-payment  -> checks the signature + amount, then marks the order PAID
//   POST /api/webhook         -> safety net if the customer's browser closed after paying
//   GET  /health              -> uptime check
//
// Run:  cp .env.example .env  (fill it)  &&  npm install  &&  npm start

require('dotenv').config();   // reads server/.env

const express = require('express');
const crypto = require('crypto');
const admin = require('firebase-admin');

const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  FIREBASE_SERVICE_ACCOUNT,
  ALLOWED_ORIGIN,
  PORT = 8080,
} = process.env;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error('Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. Copy .env.example to .env and fill it.');
  process.exit(1);
}
if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT (the service account json on one line).');
  process.exit(1);
}

// ---------- Firebase (Admin SDK ignores the browser rules, so it is the only thing that can mark an order paid) ----------
let serviceAccount;
try { serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT); }
catch (x) { console.error('FIREBASE_SERVICE_ACCOUNT is not valid json. Paste the whole file on one line, inside single quotes.'); process.exit(1); }
if (typeof serviceAccount.private_key === 'string') serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

// ---------- app ----------
const app = express();
const origins = String(ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && (origins.length === 0 || origins.includes(o))) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// The webhook must be read as raw bytes so its signature can be verified.
app.post('/api/webhook', express.raw({ type: '*/*' }), webhookHandler);

app.use(express.json({ limit: '64kb' }));

// ---------- helpers ----------
const RZP_API = 'https://api.razorpay.com/v1';
const rzAuth = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');

async function rz(path, { method = 'GET', body } = {}) {
  let r, j;
  try {
    r = await fetch(RZP_API + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: rzAuth },
      body: body ? JSON.stringify(body) : undefined,
    });
    j = await r.json().catch(() => ({}));
  } catch (x) {
    throw new Error('Could not reach Razorpay. Check the server internet.');
  }
  if (!r.ok) throw new Error(j?.error?.description || `Razorpay error ${r.status}`);
  return j;
}

const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: 'Please log in again.' });
  try {
    const d = await admin.auth().verifyIdToken(token);
    req.uid = d.uid;
    req.email = d.email || '';
    next();
  } catch (x) {
    res.status(401).json({ ok: false, error: 'Your session expired. Log in again.' });
  }
}

// Mark every order of a group as paid. Only called after a verified payment.
async function markPaid(uid, orderNos, payment) {
  const batch = db.batch();
  const at = FV.serverTimestamp();
  for (const no of orderNos) {
    const ref = db.doc(`orders/${no}`);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const o = snap.data();
    if (o.customerId !== uid) continue;                  // never touch someone else's order
    if (o.payment?.status === 'paid') continue;           // already done (idempotent)
    batch.update(ref, {
      'payment.status': 'paid',
      'payment.method': 'online',
      'payment.razorpayOrderId': payment.orderId,
      'payment.razorpayPaymentId': payment.paymentId,
      'payment.paidAmount': payment.amount,               // rupees
      'payment.paidAt': at,
      paymentVerified: true,
      updatedAt: at,
    });
  }
  await batch.commit();
  db.collection(`users/${uid}/notifications`).add({
    title: 'Payment received',
    body: `We received your payment for order ${orderNos[0] || ''}. The seller will confirm it shortly.`,
    type: 'order', read: false, createdAt: at,
  }).catch(() => {});
}

// ---------- 1. create the Razorpay order ----------
// The amount is always taken from the Firestore orders, never from the browser,
// so nobody can pay ₹1 for a ₹5,000 order.
app.post('/api/create-order', auth, async (req, res) => {
  try {
    const list = (req.body && req.body.orderNos) || [];
    if (!Array.isArray(list) || list.length < 1 || list.length > 10) {
      return res.status(400).json({ ok: false, error: 'Send 1 to 10 order numbers.' });
    }
    let amount = 0;
    const clean = [];
    for (const raw of list) {
      const no = String(raw);
      const snap = await db.doc(`orders/${no}`).get();
      if (!snap.exists) return res.status(400).json({ ok: false, error: `Order ${no} was not found.` });
      const o = snap.data();
      if (o.customerId !== req.uid) return res.status(403).json({ ok: false, error: 'That order belongs to another account.' });
      if (o.status === 'cancelled') return res.status(400).json({ ok: false, error: `Order ${no} was cancelled.` });
      if (o.payment?.method !== 'online') return res.status(400).json({ ok: false, error: `Order ${no} is a cash on delivery order.` });
      if (o.payment?.status === 'paid') return res.status(400).json({ ok: false, error: `Order ${no} is already paid.` });
      amount += Math.round(Number(o.total) || 0);
      clean.push(no);
    }
    if (amount < 1) return res.status(400).json({ ok: false, error: 'Nothing to pay for these orders.' });

    const order = await rz('/orders', {
      method: 'POST',
      body: {
        amount: amount * 100,                     // Razorpay works in paise
        currency: 'INR',
        receipt: clean[0].slice(0, 40),
        notes: { uid: req.uid, orderNos: clean.join(',') },
      },
    });

    res.json({ ok: true, keyId: RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (x) {
    console.error('create-order', x);
    res.status(500).json({ ok: false, error: x.message || 'Could not start the payment.' });
  }
});

// ---------- 2. verify the payment and mark the order paid ----------
app.post('/api/verify-payment', auth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ ok: false, error: 'Payment details are incomplete.' });
    }

    // The only real proof: HMAC-SHA256 of "order_id|payment_id" with the key secret.
    const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (!same(expected, razorpay_signature)) {
      console.warn('signature mismatch for', razorpay_order_id);
      return res.status(400).json({ ok: false, error: 'This payment could not be verified.' });
    }

    const order = await rz(`/orders/${razorpay_order_id}`);
    if (order.notes?.uid !== req.uid) {
      return res.status(403).json({ ok: false, error: 'This payment belongs to another account.' });
    }

    let pay = await rz(`/payments/${razorpay_payment_id}`);
    if (pay.order_id !== razorpay_order_id) {
      return res.status(400).json({ ok: false, error: 'Payment does not match this order.' });
    }
    // If the account is not on auto-capture, capture the money here.
    if (pay.status === 'authorized') {
      pay = await rz(`/payments/${razorpay_payment_id}/capture`, {
        method: 'POST',
        body: { amount: pay.amount, currency: pay.currency || 'INR' },
      });
    }
    if (pay.status !== 'captured') {
      return res.status(400).json({ ok: false, error: `Payment is ${pay.status}, not captured yet.` });
    }
    if (Number(pay.amount) !== Number(order.amount)) {
      return res.status(400).json({ ok: false, error: 'The paid amount does not match the order amount.' });
    }

    const orderNos = String(order.notes?.orderNos || '').split(',').filter(Boolean);
    if (!orderNos.length) return res.status(400).json({ ok: false, error: 'No shop orders on this payment.' });

    await markPaid(req.uid, orderNos, {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      amount: Number(pay.amount) / 100,
    });

    res.json({ ok: true, paymentId: razorpay_payment_id, amount: Number(pay.amount) / 100, orderNos });
  } catch (x) {
    console.error('verify-payment', x);
    res.status(500).json({ ok: false, error: x.message || 'Could not confirm the payment.' });
  }
});

// ---------- 3. webhook (optional but recommended) ----------
// Dashboard > Account & Settings > Webhooks: url = https://your-server/api/webhook
// Events: payment.captured, payment.failed, order.paid
async function webhookHandler(req, res) {
  try {
    if (!RAZORPAY_WEBHOOK_SECRET) return res.status(200).json({ ok: true, skipped: 'webhook secret not set' });
    const sig = req.headers['x-razorpay-signature'];
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const expected = crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
    if (!same(expected, sig)) return res.status(400).json({ ok: false, error: 'bad signature' });

    const ev = JSON.parse(body.toString('utf8') || '{}');
    const pay = ev?.payload?.payment?.entity;
    if (!pay) return res.json({ ok: true });

    if (ev.event === 'payment.captured' || ev.event === 'order.paid') {
      const order = await rz(`/orders/${pay.order_id}`);
      const uid = order.notes?.uid;
      const orderNos = String(order.notes?.orderNos || '').split(',').filter(Boolean);
      if (uid && orderNos.length) {
        await markPaid(uid, orderNos, { orderId: pay.order_id, paymentId: pay.id, amount: Number(pay.amount) / 100 });
      }
    }
    if (ev.event === 'payment.failed') {
      console.warn('payment failed', pay.id, pay.error_description || '');
    }
    res.json({ ok: true });
  } catch (x) {
    console.error('webhook', x);
    res.status(200).json({ ok: false });   // 200 so Razorpay does not keep retrying a bug on our side
  }
}

app.get('/health', (req, res) => res.json({ ok: true, mode: RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'live' : 'test' }));

app.listen(PORT, () => console.log(`ApnaKapda payments on :${PORT} (${RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'LIVE' : 'TEST'} mode)`));
