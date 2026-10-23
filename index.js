require('dotenv').config();

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

// Check required environment variables
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error('Missing Razorpay credentials.');
  process.exit(1);
}

if (!FIREBASE_SERVICE_ACCOUNT) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT.');
  process.exit(1);
}

// Firebase setup
let serviceAccount;

try {
  serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);

  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key =
      serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (error) {
  console.error('Firebase credentials error:', error.message);
  process.exit(1);
}

const db = admin.firestore();
const FV = admin.firestore.FieldValue;

// Express app
const app = express();

const origins = String(ALLOWED_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && (origins.length === 0 || origins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, GET, OPTIONS'
  );

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

// Verify Razorpay webhook using raw request bytes
app.post(
  '/api/webhook',
  express.raw({ type: '*/*' }),
  webhookHandler
);

app.use(express.json({ limit: '64kb' }));

// Home page: fixes Cannot GET /
app.get('/', (req, res) => {
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ApnaKapda</title>
  <style>
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #f5f3ff;
      color: #222;
      min-height: 100vh;
      display: grid;
      place-items: center;
    }
    .card {
      background: white;
      padding: 35px;
      margin: 20px;
      border-radius: 16px;
      text-align: center;
      box-shadow: 0 8px 30px #0001;
    }
    h1 { color: #6d28d9; }
    .status { color: #15803d; font-weight: bold; }
  </style>
</head>
<body>
  <main class="card">
    <h1>ApnaKapda</h1>
    <p>Welcome to ApnaKapda!</p>
    <p class="status">Payment server is running.</p>
  </main>
</body>
</html>`);
});

// Razorpay helpers
const RZP_API = 'https://api.razorpay.com/v1';

const rzAuth =
  'Basic ' +
  Buffer.from(
    `${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`
  ).toString('base64');

async function rz(path, { method = 'GET', body } = {}) {
  let response;
  let data;

  try {
    response = await fetch(RZP_API + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: rzAuth,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    data = await response.json().catch(() => ({}));
  } catch (error) {
    throw new Error('Could not connect to Razorpay.');
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.description || `Razorpay error ${response.status}`
    );
  }

  return data;
}

function same(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));

  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Verify logged-in Firebase user
async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'Please log in again.',
    });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.email = decoded.email || '';
    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: 'Your session expired. Log in again.',
    });
  }
}

// Mark verified customer orders as paid
async function markPaid(uid, orderNos, payment) {
  const batch = db.batch();
  const at = FV.serverTimestamp();

  for (const orderNo of orderNos) {
    const ref = db.doc(`orders/${orderNo}`);
    const snapshot = await ref.get();

    if (!snapshot.exists) continue;

    const order = snapshot.data();

    if (order.customerId !== uid) continue;
    if (order.payment?.status === 'paid') continue;

    batch.update(ref, {
      'payment.status': 'paid',
      'payment.method': 'online',
      'payment.razorpayOrderId': payment.orderId,
      'payment.razorpayPaymentId': payment.paymentId,
      'payment.paidAmount': payment.amount,
      'payment.paidAt': at,
      paymentVerified: true,
      updatedAt: at,
    });
  }

  await batch.commit();

  await db.collection(`users/${uid}/notifications`).add({
    title: 'Payment received',
    body: `Payment received for order ${orderNos[0] || ''}.`,
    type: 'order',
    read: false,
    createdAt: at,
  }).catch(() => {});
}

// Create Razorpay order
app.post('/api/create-order', auth, async (req, res) => {
  try {
    const list = req.body?.orderNos || [];

    if (!Array.isArray(list) || list.length < 1 || list.length > 10) {
      return res.status(400).json({
        ok: false,
        error: 'Send 1 to 10 order numbers.',
      });
    }

    let amount = 0;
    const clean = [];

    for (const raw of list) {
      const no = String(raw);
      const snapshot = await db.doc(`orders/${no}`).get();

      if (!snapshot.exists) {
        return res.status(400).json({
          ok: false,
          error: `Order ${no} was not found.`,
        });
      }

      const order = snapshot.data();

      if (order.customerId !== req.uid) {
        return res.status(403).json({
          ok: false,
          error: 'That order belongs to another account.',
        });
      }

      if (order.status === 'cancelled') {
        return res.status(400).json({
          ok: false,
          error: `Order ${no} was cancelled.`,
        });
      }

      if (order.payment?.method !== 'online') {
        return res.status(400).json({
          ok: false,
          error: `Order ${no} is a cash on delivery order.`,
        });
      }

      if (order.payment?.status === 'paid') {
        return res.status(400).json({
          ok: false,
          error: `Order ${no} is already paid.`,
        });
      }

      amount += Math.round(Number(order.total) || 0);
      clean.push(no);
    }

    if (amount < 1) {
      return res.status(400).json({
        ok: false,
        error: 'Nothing to pay for these orders.',
      });
    }

    const order = await rz('/orders', {
      method: 'POST',
      body: {
        amount: amount * 100,
        currency: 'INR',
        receipt: clean[0].slice(0, 40),
        notes: {
          uid: req.uid,
          orderNos: clean.join(','),
        },
      },
    });

    res.json({
      ok: true,
      keyId: RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error('create-order:', error.message);

    res.status(500).json({
      ok: false,
      error: error.message || 'Could not start payment.',
    });
  }
});

// Verify payment signature and capture payment if needed
app.post('/api/verify-payment', auth, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        ok: false,
        error: 'Payment details are incomplete.',
      });
    }

    const expected = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (!same(expected, razorpay_signature)) {
      return res.status(400).json({
        ok: false,
        error: 'This payment could not be verified.',
      });
    }

    const order = await rz(`/orders/${razorpay_order_id}`);

    if (order.notes?.uid !== req.uid) {
      return res.status(403).json({
        ok: false,
        error: 'This payment belongs to another account.',
      });
    }

    let payment = await rz(`/payments/${razorpay_payment_id}`);

    if (payment.order_id !== razorpay_order_id) {
      return res.status(400).json({
        ok: false,
        error: 'Payment does not match this order.',
      });
    }

    if (payment.status === 'authorized') {
      payment = await rz(`/payments/${razorpay_payment_id}/capture`, {
        method: 'POST',
        body: {
          amount: payment.amount,
          currency: payment.currency || 'INR',
        },
      });
    }

    if (payment.status !== 'captured') {
      return res.status(400).json({
        ok: false,
        error: `Payment is ${payment.status}, not captured yet.`,
      });
    }

    if (Number(payment.amount) !== Number(order.amount)) {
      return res.status(400).json({
        ok: false,
        error: 'The paid amount does not match the order amount.',
      });
    }

    const orderNos = String(order.notes?.orderNos || '')
      .split(',')
      .filter(Boolean);

    if (!orderNos.length) {
      return res.status(400).json({
        ok: false,
        error: 'No shop orders on this payment.',
      });
    }

    await markPaid(req.uid, orderNos, {
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      amount: Number(payment.amount) / 100,
    });

    res.json({
      ok: true,
      paymentId: razorpay_payment_id,
      amount: Number(payment.amount) / 100,
      orderNos,
    });
  } catch (error) {
    console.error('verify-payment:', error.message);

    res.status(500).json({
      ok: false,
      error: error.message || 'Could not confirm payment.',
    });
  }
});

// Razorpay webhook handler
async function webhookHandler(req, res) {
  try {
    if (!RAZORPAY_WEBHOOK_SECRET) {
      return res.status(200).json({
        ok: true,
        skipped: 'webhook secret not set',
      });
    }

    const signature = req.headers['x-razorpay-signature'];
    const body = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}));

    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (!same(expected, signature)) {
      return res.status(400).json({
        ok: false,
        error: 'Bad signature.',
      });
    }

    const event = JSON.parse(body.toString('utf8') || '{}');
    const payment = event?.payload?.payment?.entity;

    if (!payment) return res.json({ ok: true });

    if (
      event.event === 'payment.captured' ||
      event.event === 'order.paid'
    ) {
      const order = await rz(`/orders/${payment.order_id}`);
      const uid = order.notes?.uid;
      const orderNos = String(order.notes?.orderNos || '')
        .split(',')
        .filter(Boolean);

      if (uid && orderNos.length) {
        await markPaid(uid, orderNos, {
          orderId: payment.order_id,
          paymentId: payment.id,
          amount: Number(payment.amount) / 100,
        });
      }
    }

    if (event.event === 'payment.failed') {
      console.warn('Payment failed:', payment.id);
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('webhook:', error.message);
    res.status(200).json({ ok: false });
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    mode: RAZORPAY_KEY_ID.startsWith('rzp_live')
      ? 'live'
      : 'test',
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `ApnaKapda payment server running on port ${PORT}`
  );
});
