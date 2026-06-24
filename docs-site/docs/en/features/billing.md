# Billing and Payments

Billing covers recharges, balance changes, orders, plan consumption, affiliate rewards, points, VIP levels and payment provider configuration. This is a high-risk area and requires real payment callback proof before production acceptance.

## User Features

| Feature | Description |
| --- | --- |
| Wallet balance | View current and available balance. |
| Recharge | Create payment orders and continue to the payment provider. |
| Recharge history | View amount, channel, order ID, status and completion time. |
| Spending records | View instance creation, renewal and resource consumption. |
| Redeem codes | Use admin-issued codes for balance or benefits. |
| Affiliate rewards | View invites, conversions and rewards. |

## Admin Features

- Recharge order queries and callback diagnostics.
- Balance adjustment and audit.
- Payment provider configuration, keys, callbacks and enablement.
- Affiliate conversion review.
- VIP level, points and benefits management.
- Redeem code creation, disabling and usage records.

## Callback Boundary

- Payment callbacks should use the user portal domain, for example `https://panel.example.com/api/...`.
- Do not use the admin domain or internal backend URL for callbacks.
- Verify signature, order ID, amount, status and idempotency.
- Payment secrets must never enter frontend bundles or logs.

## Verification

- Real payment order creation succeeds.
- Real callback credits the account.
- Duplicate callbacks do not credit twice.
- Invalid signature, amount or order ID is rejected.
- Admin can audit orders, callbacks and balance records.
