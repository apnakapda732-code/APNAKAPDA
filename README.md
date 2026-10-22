# ApnaKapda: bilkul FREE plan wala project

Isme **koi paid cheez nahi** use hoti: Firebase ka Spark (free) plan, Cloudinary ka free plan. Kisi card ya billing account ki zaroorat nahi.

Teeno apps ek hi website par chalte hain:

| App | Link (deploy ke baad) |
|---|---|
| Customer app | `https://apna-kapda-5b689.web.app/` |
| Seller app | `https://apna-kapda-5b689.web.app/seller/` |
| Admin dashboard | `https://apna-kapda-5b689.web.app/admin/` |

Teeno phone par bhi install ho sakte hain (Chrome mein menu > "Add to Home screen").

---

## Kya badla (pehle wale project se)

| Pehle | Ab (free) |
|---|---|
| Phone OTP login (paid SMS) | **Email + Password** login (free) |
| Firebase Storage (paid plan maangta hai) | Product photos: **Cloudinary** (free). KYC: Firestore mein **private** |
| Cloud Functions (paid plan maangta hai) | Functions ki jagah app aur Firestore rules. Purana code `later-needs-blaze/` mein bacha hai |
| Teen alag sites | Ek hi site, teen folder |

---

## Setup: 6 kaam (ek baar)

### Kaam 1: Firebase mein Email login chalu karo
1. Firebase Console kholo, apna project chuno.
2. **Build > Authentication > Sign-in method**.
3. **Email/Password** chuno aur **Enable** karke Save karo.
(Phone wala band rehne do. Wo free mein asli logon ko OTP nahi bhejta.)

### Kaam 2: Cloudinary (product photos ke liye): YE PEHLE SE BHAR DIYA GAYA HAI
Aapki details `public/shared/shared.js` mein pehle se hain:
```js
export const CLOUDINARY = { cloud: 'dgi2mqzw', preset: 'apnakapda_products' };
```
Aapko sirf Cloudinary mein ye ek baar check karna hai: **Settings (gear) > Upload > Upload presets > `apnakapda_products`**
- **Signing mode: Unsigned** hona chahiye (warna photo upload "must be set to Unsigned" error dega).
- **Asset folder:** `apnakapda/products` (aapne yahi rakha hai). App folder ka naam khud nahi bhejta, folder preset hi tay karta hai. Isliye product photo, store logo aur banner teeno isi folder mein jayenge.
- **Allowed formats:** `jpg, png, webp` rakho (agar ye option dikhe). Ye Cloudinary ki taraf se ek aur suraksha hai.

**API Secret kabhi kisi file mein ya kisi ko mat do.** App mein koi secret hai hi nahi.

**Photo ke niyam (app khud check karta hai, upload se pehle):** sirf JPG, PNG ya WEBP, har photo 8 MB tak, ek product mein 1 se 6 photos. Photo upload se pehle phone par hi chhoti (~200 KB, max 1200 px) ho jati hai, isliye free limit bahut der tak chalti hai. Niyam badalne ho to `shared.js` mein `IMG_RULES` ke do number badal do.

Free limit: har mahine 25 credits (1 credit = 1 GB jagah, ya 1 GB bandwidth, ya 1000 transformations). Card jura nahi hai, isliye bill ban hi nahi sakta. Limit khatam hui to upload rukega.

**Photo kahan upload hoti hai?** Product ki photo **Seller app** ke "Add product" form mein. Admin dashboard mein sirf **Banners** ki photo upload hoti hai (Admin mein product add karne ka form nahi hai, admin sirf products approve ya reject karta hai).

#### Photo upload ka test (Firebase ke bina bhi chal jata hai)
1. Website deploy hone ke baad `https://apna-kapda-5b689.web.app/upload-test.html` kholo.
2. Ek JPG photo chuno, **Upload** dabao. "Upload worked" aur photo dikhni chahiye.
3. Cloudinary > **Media Library > apnakapda > products** mein wo photo dikhegi (tag `test`).
4. Ab galat file bhi try karo: ek `.gif`, ek PDF, ya 8 MB se badi photo. Upload shuru hone se **pehle** hi "Rejected before upload" likha aana chahiye.
5. Phir **Seller app > Products > + (Add product)** mein 1 se 6 photos ke saath product daalo. Upload ke dauran button par "Uploading photo 2 of 3..." dikhega.
6. Test ke baad `public/upload-test.html` file **delete kar do**.

Agar error aaye: "preset name was not found" matlab preset ka naam galat. "must be set to Unsigned" matlab preset ko Unsigned karo. "cloud name" matlab cloud name check karo.

### Kaam 3: Pehla admin banao
1. Firebase Console > **Authentication > Users > Add user**: apna email aur ek **majboot password** daalo.
2. Us user ke saamne wali **User UID** copy karo (lambi text).
3. **Firestore Database > Start collection**.
   - Collection ID: `admins`
   - Document ID: **apni User UID paste karo**
   - Field 1: `role` (string) = `super`
   - Field 2: `email` (string) = apna email
   - Save karo.

Admin ka password kisi code ya file mein nahi jata. Sirf Firebase mein rehta hai.

### Kaam 4: Rules aur website deploy karo (apne computer par)
```bash
npm install -g firebase-tools
firebase login
cd apnakapda-free
firebase deploy --only firestore,hosting
```
Ye teeno cheezein free hain. (Storage ya Functions deploy **mat** karna, wo paid maangte hain.)

Agar ek-do jagah "index required" error aaye to error mein ek link hoga. Us par click karke index bana do. Wo bhi free hai.

### Kaam 5: Starter data banao
1. `/admin/` kholo, apne email aur password se login karo.
2. **Settings > Create starter data** dabao. Isse categories, homepage sections, 2 coupons (`APNA10`, `FIRST100`) aur settings ban jate hain.

### Kaam 6: Poora flow test karo (pehle khud, 2-3 test account se)
1. **Seller app** (`/seller/`): "New seller? Create an account" > email aur password. Phir registration form bharo aur KYC photo lagao.
2. **Admin** (`/admin/`) > **Sellers** > "View documents" dekho > **Approve**. Seller ID ban jayegi (`APK-SLR-000101`). Documents delete karne ka option aayega, verify hone ke baad delete kar dena.
3. Seller app apne aap dashboard par aa jayegi. **Products > +** se photo ke saath ek product daalo. Wo "In review" mein jayega.
4. **Admin > Products > Approve**. Ab wo customer app mein dikhega.
5. **Customer app** (`/`): "Create an account" > product kholo > size chuno > Add to cart > Checkout > address > Place order.
6. **Seller app > Orders**: naya order live dikhega. "Accept order" dabao (daam aur stock check hote hain), phir Packed > Pickup > Shipped (tracking ID) > Delivered.
7. **Customer app > My orders**: status aage badhta dikhega. Delivered ke baad "Rate" aur "Return or exchange" aayega.
8. **Admin > Commission and payout**: seller ka hisaab dikhega. Seller ko bank/UPI se paisa dene ke **baad** "Settle payout" dabao.

Jo bhi error aaye (browser mein F12 dabao > Console ka laal text), wo mujhe bhej do.

---

## KYC aur privacy

- KYC photos **public image site par kabhi nahi** jaati. Wo Firestore mein `sellers/{id}/kyc` mein rehti hain, jise rules ke hisaab se sirf seller aur admin padh sakte hain.
- Photo apne aap chhoti hoti hai (~500 KB tak). PDF sirf 600 KB tak.
- Admin verify karte hi **documents delete** kar de. Kam data rakhna hi sabse surakshit hai.
- Poora Aadhaar mat maango. PAN aur bank proof kaafi hain. (Main vakeel nahi hu. Aadhaar ke kanoon kisi jaankar se pooch lena.)

## Free plan ki hadein (Firestore)

Roz ke **50,000 reads**, **20,000 writes**, 1 GB data, mahine ke 10 GB data transfer. Chhoti dukaan ke liye kaafi hai. App phone mein data cache karta hai taaki reads bachein. Agar kabhi limit paar ho to "free daily limit reached" aayega aur agle din chalega.

## Jo free mein NAHI ho sakta (sach batana zaroori hai)

- **Asli OTP login:** SMS paid hai. Isliye Email + Password hai. Mobile number sirf profile mein likha jata hai, verify nahi hota.
- **Online payment (UPI, card):** payment gateway chahiye. Abhi sirf Cash on Delivery hai.
- **Phone par push notification:** paid hai. Notifications app ke andar dikhte hain.
- **Courier se jodna (Shiprocket, Delhivery):** seller khud tracking ID daalta hai.
- **Customer ka kisi aur ka account banana rokna:** email verify karne ki suvidha nahi lagayi.

## Dhyan dene wali kamzori

Free plan mein server nahi hota, isliye order customer ke phone se banta hai. Koi shaatir customer apne order mein sasta daam likh sakta hai. Bachav jo laga hai:
- Seller jab "Accept order" dabata hai, app **har daam aur total ko seller ke asli product daam se milata hai.** Alag nikla to accept hone hi nahi deta, sirf reject.
- Stock bhi accept ke samay hi ghatta hai, aur kam stock par accept nahi hota.
- Coupon ka discount rules mein coupon ki maximum limit se zyada nahi ho sakta.
- Payout admin ke apne hisaab se hota hai, order ke andar likhe hisaab se nahi.

Isliye seller ko samjha do: accept karne se pehle order ek baar dekh lein.

Jab dukaan badi ho jaye aur paid plan lena theek lage, to `later-needs-blaze/functions` ka purana code (order, stock, payout server par) use kiya ja sakta hai. Wo bhi aapki marzi se.

## Folder ka naksha

```
apnakapda-free/
  firebase.json, .firebaserc
  firestore.rules          <- suraksha ke niyam (sabse zaroori file)
  firestore.indexes.json
  public/
    index.html             <- customer app
    seller/index.html      <- seller app
    admin/index.html       <- admin dashboard
    shared/                <- firebase.js (config), shared.js (Cloudinary + photo rules), brand.js (logo)
    upload-test.html       <- photo upload test page (test ke baad delete kar do)
    icons/, manifest, sw.js
  later-needs-blaze/       <- purana Cloud Functions code (abhi use nahi hota)
```

## Maine kya test kiya aur kya nahi

Maine teeno apps ke saare screen aur ye hisaab nakli data par check kiye: seller ka daam/stock/total check, cancel par stock wapas, customer ka 2-seller order aur coupon baantna, payout aur refund katauti, Seller ID ka counter, aur ye ki koi apne naam mein code daal kar app nahi tod sakta.

**Maine asli Firebase par kuch deploy ya test nahi kiya** (mere paas aapka account nahi hai). Security rules ko bhi asli emulator par nahi chalaya. Isliye pehla asli test aapka hoga. Rules mein koi galti hui to usse aksar koi kaam rukega (suraksha nahi tootegi). Firebase Console > Firestore > Rules > **Rules Playground** mein bhi check kar sakte ho.

---

## Online payment (Razorpay) — naya

Customer app mein ab do option hain: **Cash on delivery** aur **UPI / card / net banking**.

### Sach jo samajhna zaroori hai
`https://razorpay.me/@apnakapda4644` sirf ek **payment page** hai. Wo payment ke baad aapki website ko kuch nahi bhejta.
Isliye us link se "order automatically successful" **kabhi nahi** ho sakta — jo bhi aisa dikhata hai wo nakli hai,
aur customer bina paise diye order confirm kar sakta hai.

Asli auto-success ke liye 3 cheezein chahiye:
1. Server Razorpay ka **order** banaye (secret key server par rehti hai).
2. Customer Razorpay Checkout mein pay kare.
3. Server `HMAC-SHA256(order_id|payment_id, key_secret)` se **signature verify** kare — tabhi order **paid** ho.

Bas isi tarah customer ko "Payment successful" dikhta hai, aur sirf asli paise aane par.

### Kya kya joda gaya
| File | Kaam |
|---|---|
| `server/index.js` | Nayi chhoti Node server: `/api/create-order`, `/api/verify-payment`, `/api/webhook` |
| `server/package.json`, `server/.env.example` | Server ke packages aur settings ka namoona |
| `public/shared/razorpay.js` | Server ka address + manual `razorpay.me` link (fallback) |
| `public/index.html` | Checkout mein online option, Razorpay Checkout, success/fail screen, "Pay now" retry |
| `firestore.rules` | Order banate waqt `payment.method` = `cod` ya `online` (status `pending`) allowed |
| `public/seller/index.html` | Online order jiska paisa nahi aaya, wo accept/ship nahi ho sakta |
| `public/admin/index.html` | Payments screen par online paid / unpaid dikhta hai |

**Kabhi bhi** `RAZORPAY_KEY_SECRET` ko `public/` folder mein ya kisi bhi browser file mein mat rakho.

### Setup (ek baar)
1. **Razorpay Dashboard > Account & Settings > API Keys > Generate Key.** Test Mode se shuru karo (`rzp_test_...`).
2. `cd server` phir `cp .env.example .env` aur `.env` mein daalo:
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
   - `FIREBASE_SERVICE_ACCOUNT` = Firebase Console > Project settings > Service accounts > Generate new private key.
     Puri JSON file ko **ek line** mein karke single quotes mein paste karo.
   - `ALLOWED_ORIGIN=https://apna-kapda-5b689.web.app`
3. `npm install` phir `npm start`. Test karo: browser mein `http://localhost:8080/health`.
4. Server ko internet par rakho (Render / Railway / VPS — free tier chalega) aur uska https address
   `public/shared/razorpay.js` ke `apiBase` mein daalo.
5. `firebase deploy --only firestore,hosting`
6. Razorpay Dashboard > **Payment capture** ko **Automatic** rakho (warna server khud capture karta hai, par automatic aasan hai).
7. Test Mode mein test card `4111 1111 1111 1111`, koi bhi future expiry, CVV `123`, OTP `1234`.

### Test Mode se Live jaane par
`.env` mein `rzp_live_...` keys daalo aur server restart karo. Browser files mein kuch badalne ki zaroorat nahi
(key id server hi bhejta hai).

### Webhook (optional, par achha hai)
Razorpay Dashboard > Webhooks > url `https://aapka-server/api/webhook`, secret `.env` ke
`RAZORPAY_WEBHOOK_SECRET` mein, events: `payment.captured`, `payment.failed`.
Agar customer payment ke baad app band kar de, tab bhi order paid ho jayega.

### Manual fallback
`public/shared/razorpay.js` mein `paymentLink` bhara hua hai. Payment fail hone par customer ko wahi link dikhta hai.
Us tarike se aaya paisa **apne aap confirm nahi hoga** — order "payment pending" rahega jab tak aap khud
(check karke) usse paid na kar dein. Ye jaan-boojh kar aisa rakha gaya hai, warna koi bhi bina paise order le leta.

---

## LIVE keys lagi hain — ab bas secret aur deploy

`.env.example` mein live key ID pehle se bhari hai:

```
RAZORPAY_KEY_ID=rzp_live_TqYUNCuC5Lspwu
RAZORPAY_KEY_SECRET=            <-- yahan Dashboard wali secret paste karo
```

**Secret chat, WhatsApp, screenshot ya GitHub mein kabhi nahi.** Sirf `server/.env` file mein.
Aur `.env` ko zip/git mein kabhi mat bhejo (`.gitignore` mein already hai).

### Ab ke 5 step
1. `cd server`
2. `cp .env.example .env`
3. `.env` kholo aur ye 3 cheezein bharo:
   - `RAZORPAY_KEY_SECRET` = Dashboard > Account & Settings > API Keys > Live keys ke saamne **secret** (jo Generate karte waqt dikhti hai). Purani secret bhool gaye? Nayi key generate karo, purani revoke kar do.
   - `FIREBASE_SERVICE_ACCOUNT` = Firebase Console > Project settings > Service accounts > Generate new private key. JSON ko **ek line** mein, single quotes ke andar.
   - `ALLOWED_ORIGIN` apna hosting address (example mein already sahi hai)
4. `npm install` phir `npm run preflight`
   - Saari lines **PASS** aani chahiye. Kahin **FAIL** aaye to us line ka matlab wahi likha hai — wahi theek karo, aage mat badho.
   - Ye script **ek rupaya bhi nahi kaat'ta** aur koi order nahi banata. Sirf keys aur service account check karta hai.
5. Sab PASS? `npm start` — ab live server chal raha hai.

### Server ko internet par daalo
Render / Railway / koi bhi VPS. Start command `npm start`, root folder `server`.
Wahan bhi wahi 4 environment variables daalo (`.env` file upload karne ki zaroorat nahi, dashboard mein env vars bhar do).
Phir uska https address `public/shared/razorpay.js` ke `apiBase` mein daalo aur `firebase deploy --only firestore,hosting`.

### Live mein pehla test — ₹1 ka
Razorpay live mode mein ₹1 se kam nahi hota, isliye **₹1 ka product** banake khud kharido (ya kisi dost se karwao).
Paisa aapke hi account mein aayega, gateway fee ke baad wapas mil jayega.

- ✅ "Payment successful" + Payment ID dikhe → seller app mein order **Paid online** aaye → kaam ho gaya.
- ❌ Razorpay window khule hi nahi → `apiBase` galat hai ya server band hai. Browser F12 > Console ka laal error dekho.
- ❌ "This payment could not be verified" → secret galat hai. `npm run preflight` dobara chalao.

### Live mein 3 cheezein khaas dhyan
1. **Payment capture = Automatic** rakho (Dashboard > Account & Settings). Warna paisa authorised rehta hai, capture nahi hota (server khud capture karta hai, par automatic aasan hai).
2. **Webhook** laga do — customer payment ke baad app band kar de, tab bhi order paid ho jaye.
3. **Refund** Dashboard se karo, phir admin panel mein return ko "refunded" mark karo — dono jagah record rahega.
