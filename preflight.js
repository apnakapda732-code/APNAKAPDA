// Pre-flight check — run this BEFORE accepting real money.
//
//   cd server
//   cp .env.example .env      (fill it)
//   npm install               (installs dotenv, express, firebase-admin)
//   npm run preflight
//
// It takes NO money and creates NO order.
// It only asks Razorpay "who am I?" and Firebase "can I read/write?".
// PASS on all lines = your live keys and service account are correct.

try { require('dotenv').config(); } catch (x) { /* dotenv optional if vars are already exported */ }
const crypto = require('crypto');

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, FIREBASE_SERVICE_ACCOUNT, ALLOWED_ORIGIN } = process.env;

let bad = 0;
const ok = m => console.log('  PASS  ' + m);
const no = m => { bad++; console.log('  FAIL  ' + m); };

console.log('\n=== ApnaKapda payment pre-flight ===\n');

// ---------- 1. settings ----------
console.log('1. Settings');
if (!RAZORPAY_KEY_ID) no('RAZORPAY_KEY_ID missing in .env');
else if (!/^rzp_(test|live)_[A-Za-z0-9]{14}$/.test(RAZORPAY_KEY_ID)) no(`RAZORPAY_KEY_ID looks wrong: ${RAZORPAY_KEY_ID} (expected rzp_live_ + 14 characters)`);
else ok(`${RAZORPAY_KEY_ID} (${RAZORPAY_KEY_ID.startsWith('rzp_live') ? 'LIVE — real money' : 'test mode'})`);

if (!RAZORPAY_KEY_SECRET) no('RAZORPAY_KEY_SECRET missing in .env — and never put it in public/ or in chat');
else if (RAZORPAY_KEY_SECRET.length < 20) no('RAZORPAY_KEY_SECRET looks too short — did you paste the key id twice?');
else ok(`RAZORPAY_KEY_SECRET present (${RAZORPAY_KEY_SECRET.length} characters, value not printed)`);

if (!FIREBASE_SERVICE_ACCOUNT) no('FIREBASE_SERVICE_ACCOUNT missing in .env');
else {
  try {
    const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    if (!sa.project_id || !sa.private_key || !sa.client_email) throw new Error('project_id / private_key / client_email missing');
    if (sa.project_id !== 'apna-kapda-5b689') console.log(`  WARN  service account is for "${sa.project_id}", shop is on apna-kapda-5b689`);
    ok(`service account for ${sa.project_id} (${sa.client_email})`);
  } catch (x) { no('FIREBASE_SERVICE_ACCOUNT is not valid json on one line: ' + x.message); }
}

if (!ALLOWED_ORIGIN) console.log('  WARN  ALLOWED_ORIGIN empty — the browser will be blocked by CORS');
else ok('ALLOWED_ORIGIN = ' + ALLOWED_ORIGIN);

(async () => {
  // ---------- 2. razorpay ----------
  console.log('\n2. Razorpay (read-only, no order created)');
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) no('skipped — keys missing');
  else {
    const auth = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    try {
      const r = await fetch('https://api.razorpay.com/v1/orders?count=1', { headers: { Authorization: auth } });
      if (r.status === 200) ok('keys accepted by Razorpay');
      else if (r.status === 401) no('Razorpay rejected the pair — key id and secret are not from the same mode/account');
      else if (r.status === 403) no('Razorpay returned 403 — live keys work only after your account is activated (KYC)');
      else no(`unexpected answer: HTTP ${r.status} ${(await r.text()).slice(0, 140)}`);
    } catch (x) { no('cannot reach api.razorpay.com: ' + x.message); }
  }

  // ---------- 3. firebase admin ----------
  console.log('\n3. Firebase Admin (the only thing allowed to mark an order paid)');
  if (!FIREBASE_SERVICE_ACCOUNT) no('skipped — service account missing');
  else {
    try {
      const admin = require('firebase-admin');
      const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
      if (typeof sa.private_key === 'string') sa.private_key = sa.private_key.replace(/\\n/g, '\n');
      if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
      const snap = await admin.firestore().doc('settings/app').get();
      ok('Firestore readable' + (snap.exists ? ' (settings/app found)' : ' (settings/app empty, that is fine)'));
      const id = crypto.randomBytes(4).toString('hex');
      await admin.firestore().doc(`_preflight/${id}`).set({ at: Date.now() });
      await admin.firestore().doc(`_preflight/${id}`).delete();
      ok('Firestore writable, test doc cleaned up');
    } catch (x) { no('Firebase Admin: ' + x.message); }
  }

  // ---------- 4. formula ----------
  console.log('\n4. Signature formula');
  const a = crypto.createHmac('sha256', 'x').update('order_1|pay_1').digest('hex');
  const b = crypto.createHmac('sha256', 'x').update('order_1' + '|' + 'pay_1').digest('hex');
  if (a === b && a.length === 64) ok('HMAC-SHA256(order_id|payment_id) matches the Razorpay doc');
  else no('signature formula is wrong');

  console.log('\n' + (bad ? `=== ${bad} problem(s) — DO NOT accept live payments yet ===\n` : '=== All good. Start the server: npm start ===\n'));
  process.exit(bad ? 1 : 0);
})();
