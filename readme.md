# Capstone 2 E-commerce API Overview:

## Application Name: E-commerce API (Estilo Manila backend)

- Live API: https://estilo-manila-backend-v2.onrender.com (routes are mounted under `/b4`)
- Frontend: https://estillo-manila.vercel.app

## Team Members:

- Marc Aldous Conde
- Dan Leoncito

## User Credentials:

- Admin User
  - Email: admin@gmail.com
  - Password: Admin123!
- Dummy Customer:
  - Email: customer@gmail.com
  - Password: Customer123!

## Tech Stack

- Node.js, Express 4, Mongoose 8 (MongoDB), JWT auth, bcrypt
- Stripe (test mode) for card payments

## Getting Started

```bash
npm install
cp .env.example .env   # then fill in the values below
npm run dev            # nodemon; or `npm start` for plain node (default port 3004)
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `MONGO_STRING` | MongoDB connection string |
| `JWT_SECRET_KEY` | Secret used to sign login tokens |
| `PORT` | Server port (defaults to 3004) |
| `STRIPE_SECRET_KEY` | Stripe **test-mode** secret key (`sk_test_...`), backend only |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the Stripe webhook endpoint |

The webhook secret must match the endpoint that Stripe is calling:

- **Local:** run `stripe listen --forward-to localhost:3004/b4/payment/webhook`. It prints a `whsec_...` signing secret for your CLI login (it stays the same between restarts); put it in `.env`. If Stripe ever shows a different one, update `.env` to match.
- **Deployed:** create a webhook endpoint in the Stripe Dashboard (test mode) pointing at `https://<your-host>/b4/payment/webhook`, subscribed to `payment_intent.succeeded` and `payment_intent.payment_failed`, and use that endpoint's signing secret.

### Optional: seed demo products

```bash
node scripts/seedStreetwearProducts.js
```

Adds ~24 streetwear demo products with placeholder images. It is safe to re-run; products that already exist by name are skipped.

The script writes to whichever database `MONGO_STRING` points at in the `.env` you run it with. Seeding locally does **not** touch the deployed site, which uses its own database. To seed the live database, run the script with the production `MONGO_STRING` (for example from the Render shell, where it is already set).

## API Overview

All routes are prefixed with `/b4`.

| Area | Endpoints |
| --- | --- |
| Users | `POST /users/register`, `POST /users/login`, `GET /users/details`, `PATCH /users/update-password`, `PATCH /users/:id/set-as-admin` (admin) |
| Products | `GET /product/active`, `GET /product/:productId`, `POST /product/search-by-name`, `POST /product/search-by-price`; admin: `POST /product`, `GET /product/all`, `PATCH /product/:productId/update`, `.../archive`, `.../activate` |
| Cart | `POST /cart/add-to-cart`, `GET /cart/get-cart`, `PATCH /cart/update-cart-quantity`, `PATCH /cart/:productId/remove-from-cart`, `PUT /cart/clear-cart` |
| Orders | `POST /order/checkout`, `GET /order/my-orders`, `GET /order/all-orders` (admin), `GET /order/disputes`, `POST /order/disputes/:id/resolve`, `GET /order/disputes/all` (admin) |
| Payments | `POST /payment/create-payment-intent`, `POST /payment/webhook` (called by Stripe, not by clients) |

`EcommerceAPI.postman_collection.json` is a request collection for the API.

## Payments (Stripe test mode)

- **Delivery address:** both `POST /order/checkout` (COD) and `POST /payment/create-payment-intent` (card) require a `shippingAddress` object: `fullName`, `phone` (Philippine mobile, `09…` or `+639…`), `addressLine1`, optional `addressLine2`, `city`, `province`, `postalCode` (4 digits) and `country` (Philippines only, the default). It is validated and normalised by `utils/address.js`, stored on the order, and a bad one is a 400 with `{ message, field }`. For card orders it is saved in the payment snapshot, so a webhook-created order has it too. Orders from before this feature have no address.
- `POST /payment/create-payment-intent` creates a PaymentIntent (currency `php`, card only) for the logged-in user's cart. The amount is always recomputed on the server from current product prices, never taken from the client.
- `POST /order/checkout` accepts an optional `paymentIntentId`:
  - With it, the intent is verified with Stripe (it must have succeeded and belong to the caller) and the order is saved as `paymentStatus: "Paid"`, `paymentMethod: "card"`.
  - Without it, the order is a Cash on Delivery order: `paymentStatus: "COD"`, `paymentMethod: "cod"`.
- The webhook is the source of truth: on `payment_intent.succeeded` it creates the order even if the browser never called checkout. Checkout and the webhook are idempotent against each other (a unique index on `Order.paymentIntentId`), so a payment can never produce two orders.
- The webhook route is registered with a raw body parser **before** `express.json()` in `index.js`. Signature verification breaks if that order changes.
- A Stripe test account sends every event to **every** registered endpoint and `stripe listen`, so a local server and the deployed one both receive each payment. The webhook only acts on payments it created itself (it has a snapshot for them) and ignores the rest, so the environments never refund each other's payments.
- Use Stripe's test cards, e.g. `4242 4242 4242 4242` (success), `4000 0027 6000 3184` (3D Secure), `4000 0000 0000 0002` (declined), with any future expiry and any CVC. No real money is ever charged.

## Stock

- Each product has a `stock` count (whole number, default 0). Admins set it via `POST /product` and `PATCH /product/:productId/update`. A product with `stock: 0` is out of stock; the API still returns it, so the storefront can show it as sold out.
- `addToCart` and `PATCH /cart/update-cart-quantity` refuse quantities above the available stock, and `POST /payment/create-payment-intent` refuses to charge for a cart that is short.
- Stock is decremented when the order is created, by both `POST /order/checkout` and the Stripe webhook, through one shared step, so a payment never decrements twice.
- **Strict quantity:** a line can hold at most `min(available stock, 99)` units. The available stock comes with every product and cart response, and a rejected quantity returns `409 { message, available, maxPurchasable }`. There is deliberately no polling endpoint: the limit reflects the stock loaded with the page, and the server re-checks it atomically at purchase time, which is what actually prevents overselling.
- **Card orders are built from a payment snapshot** taken when the payment intent is created, so the order always matches what was charged, even if the cart is edited afterwards.
- **If an item runs short after a card payment**, only that line is affected instead of the whole order:
  - Some units available (e.g. ordered 5, 4 left): the order is created, the available units are held for the customer, and a *dispute* is opened. The customer resolves it with `POST /order/disputes/:id/resolve` and `{ "action": "cancel" }` (that line is refunded) or `{ "action": "reduce", "quantity": n }` (keep `n` from 1 up to the held units, the difference is refunded). Held units go back to stock once resolved. An unresolved dispute is auto-cancelled and refunded after 24 hours.
  - No units available: that line is refunded immediately and the rest of the order is fulfilled.
  - Nothing available at all: the whole payment is refunded and no order is created.
- Cash on Delivery has no payment to refund, so a short cart is simply rejected with a 409.
- Stock problems return `409 { message, outOfStock: [{ productId, name, requested, available }] }`.
- **Before deploying to a database that already has products, run `node scripts/backfillStock.js [startingStock]` once** (default 25). It only touches products that have no `stock` field and is safe to re-run. Without it those products cannot be bought.

## Tests

`npm test` runs the suite in `test/` with Node's built-in runner. It starts its own in-memory MongoDB (the first run downloads a MongoDB binary, then it is cached) and replaces Stripe with a fake, and it forces throwaway settings before the app loads, so it cannot reach your `MONGO_STRING` database or your Stripe account.

To try the storefront without touching any real data, run `node test/devserver.js`: it serves the real API on port 3005 from an in-memory database with sample products, users (password `Secret123!`: `admin@example.com`, `shopper@example.com`, `dispute@example.com` with open disputes) and a fake Stripe, then start the frontend with `REACT_APP_API_BASE_URL=http://localhost:3005/b4` on port 3000. `/__dev/down?on=1` makes it behave as if offline and `/__dev/dump` shows its state. Everything is lost when it stops.

## Incidents

Anything that needs a person is recorded, not just logged: a refund that keeps failing, a dispute stuck half way, a card payment that succeeded here with no order to show for it (`payment-no-snapshot`), a webhook that keeps failing. Admins read them at `GET /b4/order/incidents`; they close themselves once the problem is fixed. A payment created by another environment (each PaymentIntent is tagged `render` or `local`) is ignored, never refunded and never an incident.

## Patch Notes

Full history is in [CHANGELOG.md](CHANGELOG.md). Summary:

### v1.5.0 (2026-09-24)
_Integrated by Dan Leoncito._
- **Added:** Delivery address on orders: checkout (COD) and payment-intent creation require and validate a `shippingAddress`, and it is saved on the order (also for orders created by the Stripe webhook). Deploy the storefront first.

### v1.4.0 (2026-09-24)
_Integrated by Dan Leoncito._
- **Added:** Automated tests (`npm test`, no real database or Stripe needed); an incidents list for admins (`GET /order/incidents`) for refunds that keep failing, stuck disputes and payments with no order.
- **Fixed:** Refunds can no longer be duplicated by a late retry; a failed refund no longer turns a successful checkout into an error; a Cash on Delivery double submit places one order; `GET /users/` is admin-only and hides password hashes; duplicate emails, missing fields and login without an `@` are handled; a deleted product no longer breaks the cart; every error answers in JSON without leaking internals.

### v1.3.1 (2026-09-24)
_Integrated by Dan Leoncito._
- **Added:** Order lines store the product name at purchase time.
- **Fixed:** The webhook no longer refunds payments it has no snapshot for (a shared Stripe test account feeds every environment); archived products can no longer be added to a cart, bought, or found in search; a malformed product id in the cart endpoints returns 400 instead of risking a crash.

### v1.3.0 (2026-09-24)
_Integrated by Dan Leoncito._
- **Added:** Per-line handling of stock shortages after a card payment: partial refunds instead of refunding the whole cart, and shortfall disputes (cancel the line or reduce its quantity, with the available units held until resolved and auto-cancelled after 24h).
- **Added:** Strict purchase quantity: `min(stock, 99)` per line (limits come with the stock already returned by the product and cart endpoints), and card orders built from a payment snapshot so they always match the charge.

### v1.2.0 (2026-09-24)
_Integrated by Dan Leoncito._
- **Added:** Product stock counts with out-of-stock enforcement across cart, payment-intent creation, checkout and the Stripe webhook, plus an automatic refund when a paid item sells out. Includes `scripts/backfillStock.js` (run it on existing databases before deploying).
- **Fixed:** The second Cash on Delivery order failed with a duplicate-key error on `paymentIntentId: null`.
- **Fixed:** Adding a string quantity to the cart concatenated instead of adding (`"2"` + `"2"` = `"22"`), and updating the cart with a new line returned a NaN total.

### v1.1.1 (2026-09-22)
_Integrated by Dan Leoncito._
- **Fixed:** PaymentIntents are now card-only, so Stripe no longer demands a `return_url`; 3D Secure shows as an on-page popup instead of a redirect.

### v1.1.0 (2026-09-22)
_Integrated by Dan Leoncito._
- **Added:** Stripe test-mode payments (create-payment-intent endpoint, signature-verified webhook, idempotent checkout), `paymentStatus` / `paymentMethod` / `paymentIntentId` on orders, a shared cart-total helper, and the demo product seed script.
- **Fixed:** `Order.productsOrdered` silently dropped `quantity` and `subtotal` on every save; all three fields are now stored.
- **Fixed:** Checkout reported "cart is empty" if the webhook had already created the order; it now returns the existing order.
- **Fixed:** Checkout no longer sends a double response on errors, and `dotenv` is loaded explicitly at the top of `index.js`.

## Features:

## Features by Marc Aldous Conde

- User Resources:
  - User registration
  - User authentication
- Product Resources:
  - Archive product
  - Activate product
- Cart Resources:
  - Add to cart
  - Get cart information
  - Remove products from cart
  - Clear cart
- Order Resources:
  - Create order
  - Retrieve logged in user's orders

## Features by Dan Leoncito

- User Resources:
  - Set user as admin (Admin only)
  - Retrieve User details
  - Update Password
- Product resources:
  - Retrieve single product
  - Update product information
- Cart Resources:
  - Subtotal for each item
  - Change product quantities
  - Add search for products by name
  - Add search for products by price range
- Order Resources:
  - Retrieve all user's orders
- Payment Resources:
  - Stripe test-mode PaymentIntents and webhook-based order creation
