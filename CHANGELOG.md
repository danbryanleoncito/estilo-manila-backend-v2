# Changelog

All notable changes to this backend are documented in this file.

## [1.1.1] - 2026-09-22
_Integrated by Dan Leoncito._

### Fixed
- `createPaymentIntent` created PaymentIntents with `automatic_payment_methods: { enabled: true }`,
  which allows redirect-based methods (Link, etc.) alongside card and made Stripe require a
  `return_url` on every confirmation attempt — the checkout UI only ever offers card vs. Cash on
  Delivery, never a redirect-based method. Restricted to `payment_method_types: ["card"]`, removing
  the return_url requirement entirely so the frontend can confirm card payments inline (3D Secure,
  when required, shows as an on-page popup instead of a redirect).

## [1.1.0] - 2026-09-22
_Integrated by Dan Leoncito._

### Added
- Stripe **test-mode** payment integration:
  - `POST /b4/payment/create-payment-intent` — creates a Stripe PaymentIntent (PHP) sized to the
    caller's current cart, recomputed server-side from live product prices.
  - `POST /b4/payment/webhook` — verifies Stripe's signature and processes
    `payment_intent.succeeded` / `payment_intent.payment_failed` events as the source of truth for
    marking an order paid, independent of the client calling checkout.
  - `POST /b4/order/checkout` now accepts an optional `paymentIntentId`; when present, the order is
    only created after verifying the payment succeeded and belongs to the requesting user. Checkout
    with no `paymentIntentId` is unchanged (Cash on Delivery).
  - Both the synchronous checkout path and the webhook are idempotent against each other (a
    `paymentIntentId` lookup plus a unique sparse index on `Order.paymentIntentId`), so a payment
    never produces two orders regardless of which path processes it first.
- `Order` model: `paymentStatus` (`COD` / `Unpaid` / `Paid` / `Failed`), `paymentMethod`
  (`card` / `cod`), `paymentIntentId` (unique, sparse).
- `backend/utils/cartTotal.js` — shared helper that recomputes cart subtotals/total from live
  `Product.price`, used by both checkout and payment-intent creation.
- `backend/scripts/seedStreetwearProducts.js` — seeds ~24 streetwear-themed demo products
  (safe to re-run; skips products that already exist by name).
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` env vars (see `.env.example`).

### Fixed
- `Order.productsOrdered` was declared as three separate single-field sub-schema fragments inside
  one array literal, which Mongoose only reads as a single-field item type — so `quantity` and
  `subtotal` were silently dropped from every saved order, only `productId` ever persisted.
  Collapsed into one sub-document schema so all three fields now save correctly.
- `checkout`'s idempotency check previously ran after the "cart is empty" guard, so when the
  Stripe webhook won the race and had already created the order (and deleted the cart) before the
  client's own `/checkout` call landed, that call incorrectly returned "cart is empty" instead of
  the already-placed order.
- `checkout` no longer double-sends a response via the broken
  `res.status(500).send({ message: errorHandler(error, req, res) })` pattern; it now returns a
  plain JSON error body, matching `getAllOrders` in the same controller.
- `index.js` no longer depends on `auth.js` being required first for `dotenv.config()` to run as a
  side effect — it's now called explicitly as the first line of `index.js`.

### Removed
- Nothing removed in this release.
