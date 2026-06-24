# Billing and Payments

Billing covers recharges, balance changes, orders, plan consumption, affiliate rewards, points, VIP levels and payment provider configuration. This is a high-risk area and requires real payment callback proof before production acceptance.

## User Features

| Feature | Description |
| --- | --- |
| Wallet balance | View current and available balance. |
| Recharge | Create payment orders and continue to the payment provider. |
| Recharge history | View amount, channel, order ID, status and completion time. |
| Spending records | View instance creation, renewal and resource consumption. |
| Order center | Use `/orders` to view unified recharge and instance billing order details. |
| Redeem codes | Use admin-issued codes for balance or benefits. |
| Affiliate rewards | View invites, conversions and rewards. |

## Admin Features

- Recharge order queries and callback diagnostics.
- Order center at `/admin/orders` for unified recharge and instance billing records, with user, type and status filters, detail views, recharge exception handling and balance-adjustment approval requests.
- Balance adjustment approval and audit. Refunds, compensation credits and deductions are submitted first, then executed only after approval.
- Payment provider configuration, keys, callbacks and enablement.
- Affiliate conversion review.
- VIP level, points and benefits management.
- Redeem code creation, disabling and usage records.

## Callback Boundary

- Payment callbacks should use the user portal domain, for example `https://panel.example.com/api/...`.
- Do not use the admin domain or internal backend URL for callbacks.
- Verify signature, order ID, amount, status and idempotency.
- Payment secrets must never enter frontend bundles or logs.
- Manual completion and failure marking in the order center keep using the existing audited recharge flows. Refunds, compensation credits and deductions create balance-adjustment approval tasks, and approved tasks execute the existing balance-ledger flow.

## Verification

- Real payment order creation succeeds.
- Real callback credits the account.
- Duplicate callbacks do not credit twice.
- Invalid signature, amount or order ID is rejected.
- Admin can audit orders, callbacks and balance records.
- User and admin order centers must only return authorized order data and must not expose raw payment callback payloads or provider config snapshots.
- Admin order detail can manually complete or fail pending/paid recharge orders and submit reasoned balance-adjustment approval requests for the related user.
- The balance-adjustment approval list shows up to 7 tasks per page. A balance log is created only after an administrator approves and executes the request.
