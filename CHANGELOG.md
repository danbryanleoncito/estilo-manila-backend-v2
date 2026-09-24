# Changelog

All notable changes to this backend are documented in this file.

## [1.5.0] - 2026-09-24
_Integrated by Dan Leoncito._

### Added
- **Delivery address on orders.** `POST /order/checkout` (Cash on Delivery) and
  `POST /payment/create-payment-intent` (card) now require a `shippingAddress`
  (`fullName, phone, addressLine1, addressLine2?, city, province, postalCode, country`), validated and
  normalised (Philippine mobile number, 4-digit postal code, Philippines only) and stored on the order as
  `shippingAddress`. A missing or invalid address is a 400 that names the field (`{ message, field }`).
  For COD it is checked before the cart is touched; for card it is checked before anything is charged.
- For card orders the address is frozen in the payment snapshot when the payment is created, so an order
  created by the Stripe webhook alone (the browser never called checkout) still has it.
- `utils/stripeClient.js`: one lazily created Stripe client that tests can replace.

### Changed
- Orders placed before this release have no `shippingAddress`; everything that reads orders tolerates that.
- **Deploy note:** the storefront must send the address, so deploy the frontend first. An older
  storefront that does not send it gets a 400 ("A delivery address is required") at checkout.

## [1.4.0] - 2026-09-24
_Integrated by Dan Leoncito._

### Added
- Automated tests (`npm test`, Node's built-in runner) against an isolated in-memory MongoDB and a
  fake Stripe, so they never touch a real database or account. They cover refunds, dispute crash
  recovery, checkout, the webhook, and the API's validation and error handling.
- Incidents: problems that need a person (a refund that keeps failing, a dispute stuck half way, a
  payment that has no order, a webhook that keeps failing) are now stored in an `Incident`
  collection and listed for admins at `GET /b4/order/incidents`, instead of only appearing in the
  console. They close themselves when the problem is fixed.
- Every PaymentIntent is tagged with the environment that created it (`render` or `local`).

### Fixed
- **Double refunds.** Stripe forgets an idempotency key after about 24 hours, but a refund that failed
  was retried indefinitely, so a late retry could refund twice. Each refund now carries its key in
  Stripe metadata and is looked up before a new one is made (checked against real Stripe test mode).
- **A charged customer with no order went unnoticed.** A payment with no snapshot was ignored with
  only a console line. If this environment created the payment it is now recorded as an incident (and
  still never auto-refunded); payments from other environments are ignored as before.
- **A failed refund made a successful checkout look failed.** The order was saved, then a Stripe call
  could throw, so checkout answered 500 and the cart was never cleared. The cart is now cleared first,
  a failed refund is recorded and retried by the 5-minute sweep, and a retry clears a cart that was
  left behind (without touching items added since).
- **Cash on Delivery double submit** could place two orders. The cart is now claimed atomically and
  put back if the order does not happen (shortage or error).
- `GET /b4/users/` was public and returned password hashes. It now needs an admin and never
  includes passwords.
- Registration accepted duplicate emails (and any capitalisation), crashed on missing fields, and
  login never answered when the email had no `@`. Emails are now compared case-insensitively,
  inputs are validated, and every path answers. Changing a password now applies the same rules as
  registering.
- A deleted product left in a cart crashed add-to-cart and remove-from-cart, and remove-from-cart
  stored a stale total. Totals now skip missing products and are recomputed before saving; updating a
  quantity drops a dead line.
- Errors: a bad JSON body or unknown route returned an HTML page; 500 responses included database and
  Stripe internals; malformed product ids and Stripe "unknown payment"/"amount too small" errors were
  500s. All now answer in JSON with a plain message (internals stay in the log), and a database
  connection failure at start-up stops the server instead of leaving it half alive.
- Product create/update now validate the price (a positive number) and search rejects an invalid or
  oversized pattern instead of failing.

## [1.3.1] - 2026-09-24
_Integrated by Dan Leoncito._

### Added
- Order lines now store the product `name` at purchase time, so order screens can show real
  names (and stay correct after a rename or deletion) instead of raw product ids.

### Fixed
- The Stripe webhook refunded any successful payment it had no snapshot for. One Stripe (test)
  account can feed several backends (a local dev server and the deployed one each receive every
  event), so each environment was refunding the other's payments. It now ignores payments it has
  no matching snapshot for; only a payment it created itself, with a mismatched amount, is refunded.
- Archived (inactive) products could be added to a cart, appeared in search, and could be bought
  with Cash on Delivery. Add/update-cart, checkout and payment-intent creation now treat them as
  unavailable (a customer may still reduce or remove an archived line), and both search endpoints
  only return active products.
- The cart controller's error paths sent a second response after `errorHandler` had already
  responded, which throws inside an async handler (an unhandled rejection that can crash Node) —
  for example on a malformed `productId`. They now send one plain 500, and add/update-cart
  reject a malformed `productId` with 400.

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
