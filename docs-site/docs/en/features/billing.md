# Billing and Payments

Billing covers recharges, balance changes, orders, plan consumption, affiliate rewards, points, VIP levels and payment provider configuration. This is a high-risk area and requires real payment callback proof before production acceptance.

## User Features

| Feature | Description |
| --- | --- |
| Wallet balance | View current and available balance. |
| Recharge | Create payment orders and continue to the payment provider. |
| Manual recharge | Create a pending order through the admin-configured `manual` provider, show the order number, amount due and payment instructions, then wait for admin verification and crediting. |
| Recharge history | View amount, channel, order ID, status and completion time. |
| Spending records | View instance creation, renewal and resource consumption. |
| Order center | Use `/orders` to view unified recharge and instance billing order details. |
| Gift cards | Use `/gift-cards` to generate cards from the user's own balance, redeem cards issued by others or admins, and view owned cards. |
| Redeem codes | Use admin-issued codes for balance or benefits. |
| Affiliate rewards | View invites, conversions and rewards. |

## Admin Features

- Recharge order queries and callback diagnostics.
- Order center at `/admin/orders` for unified recharge and instance billing records, with user, type, status, order number, provider transaction ID and date range filters, detail views, recharge exception handling, dispute status and refund or balance-adjustment approval requests.
- Financial reconciliation at `/admin/billing?tab=reconciliation` summarizes recharge, balance logs, instance billing, adjustment approvals and hosting income by business date, then tracks differences and exports redacted CSV files.
- Balance adjustment approval and audit. Refunds, compensation credits and deductions are submitted first, then executed only after approval.
- Admins can create original-route refunds from completed plugin payment gateway recharge records and track them in `/admin/billing?tab=refundRequests`. PayIncus validates the provider, config snapshot and `refund` hook before creating a refund request. Built-in providers still use order refund approval or manual balance adjustment until dedicated adapters are implemented.
- Payment provider configuration, keys, callbacks, manual payment instructions and enablement.
- Affiliate conversion review.
- VIP level, points and benefits management.
- Gift card management at `/admin/gift-cards`, including single or batch generation, stats, redacted lists, and enable/disable/delete for unused cards.
- Redeem code creation, disabling and usage records.

## Callback Boundary

- Payment callbacks should use the user portal domain, for example `https://panel.example.com/api/...`.
- Do not use the admin domain or internal backend URL for callbacks.
- Verify signature, order ID, amount, status and idempotency.
- Payment secrets must never enter frontend bundles or logs.
- Manual recharge never credits balance automatically. The user portal only shows the configured payment instructions; an administrator must verify receipt and manually complete the order in the order center.
- Gift cards are a high-risk balance feature. Production deployments must configure `PAYINCUS_GIFT_CARD_ADMIN_IDS`; user generation and redemption must stay transactional, and admin lists are redacted by default.
- Manual completion and failure marking in the order center keep using the existing audited recharge flows. Refunds, compensation credits and deductions create balance-adjustment approval tasks, and approved tasks execute the existing balance-ledger flow.
- Refund registration only creates an approval request. It does not call payment-provider refund APIs and does not directly modify the user balance.
- Plugin-gateway original-route refunds validate provider support before any refund request is persisted. Unsupported providers do not create hanging pending refund requests.
- Original-route refunds pre-deduct the user balance when processing starts. Failed refunds must restore the pre-deduction and write a balance log. Daily reconciliation now flags stale pending/processing refund requests and failed refunds missing restore logs.
- The admin recharge record list only shows the create original-route refund action for completed `plugin_gateway` records. Admins must enter amount and reason. The refund workbench supports status filtering, search by order number, username, provider, or refund id, provider result inspection, failure reason inspection, and retry/sync for `pending`, `processing`, and `failed` requests.
- Order details may show only redacted provider summaries. Raw callback payloads, provider configuration snapshots and secrets must not be returned.
- Reconciliation exports may include only necessary business fields. Order numbers and transaction identifiers are masked, and exports must not include raw callback payloads, provider configuration snapshots, passwords, tokens or secrets.

## Verification

- Real payment order creation succeeds.
- Real callback credits the account.
- Duplicate callbacks do not credit twice.
- Invalid signature, amount or order ID is rejected.
- Admin can audit orders, callbacks and balance records.
- Gift-card generation from user balance deducts balance and writes a ledger entry; self-redemption is blocked, and concurrent redemption can succeed only once.
- Gift-card admin management rejects production access without `PAYINCUS_GIFT_CARD_ADMIN_IDS`, and admin lists are redacted by default.
- User and admin order centers must only return authorized order data and must not expose raw payment callback payloads or provider config snapshots.
- Admin order detail can manually complete or fail pending/paid recharge orders and submit reasoned balance-adjustment approval requests for the related user.
- Admin order detail can set dispute status to pending review, confirmed, compensated or closed.
- Duplicate refund registration is blocked while the order already has a pending refund approval request.
- The balance-adjustment approval list shows up to 7 tasks per page. A balance log is created only after an administrator approves and executes the request.
- Rerunning reconciliation for the same business date does not duplicate difference items.
- Reconciliation differences can be traced to their source, user, amount, handling status, handler and note.
- Reconciliation detects stale original-route refund requests and failed refund requests that are missing pre-deduction restore logs.
- Financial CSV exports do not contain credentials, raw callback payloads or provider configuration snapshots.
