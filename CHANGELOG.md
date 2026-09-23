# Changelog

All notable changes to this backend are documented in this file.

## [1.3.0] - 2026-09-24
_Integrated by Dan Leoncito._

### Added
- Shortfall disputes. When a card payment succeeds but a line is only partly available (ordered 5,
  4 left), the order is created, the available units are held (taken out of `Product.stock`), and a
  `Dispute` is opened. `POST /order/disputes/:id/resolve` with `{ action: "cancel" }` or
  `{ action: "reduce", quantity: n }` refunds the difference through a partial Stripe refund and puts
  the unused held units back in stock. `GET /order/disputes` (mine) and `GET /order/disputes/all`
  (admin) list them. An unresolved dispute is auto-cancelled and refunded after 24 hours by a sweep
  that runs at boot and every 5 minutes.
- Strict purchase quantity: a cart line is capped at `min(available stock, 99)`, enforced at
  add-to-cart, quantity update, payment-intent creation and checkout. Rejections return
  `409 { message, available, maxPurchasable }`, and the limit is derived from the stock already
  returned by the product and cart endpoints (no polling endpoint; the atomic decrement at purchase
  time stays the guarantee).
- Payment snapshots: card orders are built from what was frozen when the payment intent was created,
  so the checkout and the webhook can never create an order that differs from the charge (the cart is
  no longer re-read at payment time).
- Order lines now record `unitPrice`, `requestedQuantity`, `lineStatus`
  (`Fulfilled | Disputed | Adjusted | Cancelled`) and `refundedAmount`; orders record
  `refundedAmount` (and `totalPrice` is the net amount after refunds).

### Changed
- A paid item selling out no longer refunds the whole order. Lines with no units available are
  refunded immediately and the rest of the order is fulfilled; only when nothing is available is the
  whole payment refunded and no order created. Cash on Delivery is unchanged (short cart -> 409).

## [1.2.0] - 2026-09-24
_Integrated by Dan Leoncito._

### Added
- Product stock: `Product.stock` (whole number >= 0, default 0). Admins set it through
  `POST /product` and `PATCH /product/:id/update` (validated, 400 on invalid values).
- Stock enforcement everywhere an order is affected: `addToCart` and `updateCartQuantity` reject
  quantities above stock (409), `createPaymentIntent` refuses to charge for short carts, and
  checkout/the Stripe webhook decrement stock atomically through one shared order-creation step
  (`utils/placeOrder.js`, `utils/stock.js`), so a payment never decrements twice.
- If a card payment succeeds but the item sold out in the meantime, the payment is automatically
  refunded through Stripe (idempotent) and no order is created. Shortages return
  `409 { message, outOfStock: [{ productId, name, requested, available }] }`.
- `scripts/backfillStock.js` gives existing products a starting stock (idempotent). **Run it against
  the live database before deploying this release** — products without a `stock` field cannot be
  bought.
- The seed script now assigns each demo product a stock of 5-50.

### Fixed
- The second Cash on Delivery order failed with `E11000 duplicate key ... paymentIntentId: null`:
  COD orders stored `paymentIntentId: null`, and a sparse unique index still indexes `null`. The field
  is now left absent on COD orders.
- `addToCart` concatenated a string quantity onto the existing quantity (`"2"` + `"2"` = `"22"`);
  quantity is now validated as a whole number >= 1 and coerced to a number.
- `updateCartQuantity` returned a NaN-total 400 when it added a brand-new line; it now recomputes the
  total with the shared helper.

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
