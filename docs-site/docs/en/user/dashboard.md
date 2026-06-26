# User Portal

The user portal is for regular customers only. It must not expose admin entrypoints, admin redirects, admin APIs or admin wording.

Entry:

```text
https://panel.example.com
```

## Access Boundary

- Regular users can access authenticated user routes.
- Admin accounts are redirected away from user-only pages.
- The user build output is `client/dist/user`.

## Core Pages

| Feature | Route | Description |
| --- | --- | --- |
| Home and market | `/`, `/market` | Public content, products and plans. |
| Dashboard | `/dashboard` | Account, instances, balance, notifications and shortcuts. |
| Instances | `/instances` | Customer-owned LXC / KVM instances. |
| Create instance | `/instances/create` | Create an instance by plan, image, host and limits. |
| Instance detail | `/instances/:id` | Start, stop, reboot, delete, network and terminal. |
| Terminal | `/terminal` | WebSocket terminal through `/api/ws`. |
| Wallet | `/wallet` | Recharge, balance, orders and callback results. |
| Gift Cards | `/gift-cards` | Generate gift cards from the user's own balance, redeem cards issued by others or admins, and view owned cards. |
| Orders | `/orders` | Unified read-only order center for recharge orders and instance billing records, including purchases, renewals, upgrades, refunds and transfer fees. |
| Invites | `/invites` | Referral relationships and rewards. |
| Tickets | `/tickets` | Create tickets, read replies and upload attachments. |
| Inbox | `/inbox` | System notifications and delivery state. |
| Logs | `/logs` | User-related operation logs. In the Chinese UI, modules, actions, results and common log content are localized to Chinese. |
| Help | `/help` | Help articles maintained by admins. |
| Profile | `/profile` | Account settings, OAuth binding and preferences. |

## Optional Self-service Modules

- Mail: `/mail` and `/mail/domains/:id`.
- Hosted resources: `/resources/hosts`.
- Hosted plans: `/resources/packages`.
- Hosting wallet: `/hosting-wallet`.
- Entertainment: `/entertainment`.

## Gift Cards

Users can generate gift cards from their own balance and redeem cards issued by other users or administrators. Self-redemption is blocked, and balance deduction, card creation, redemption and ledger writes are handled transactionally by the backend.

## Lifecycle Offers

The user dashboard can show targeted resource redeem codes issued by administrators:

- Only offers assigned to the current signed-in user are shown.
- The card shows the redeem code, host, resource type, resource value and expiry.
- Redemption still uses the existing redeem-code flow, so resource changes go through the existing instance resource path.
- Admin lifecycle tags, segments, internal lifecycle events and action records are not shown in the user portal.

## Verification

- Regular user login works.
- Admin user cannot use user-only pages.
- The user portal contains no admin navigation or admin API entry.
- Users can only read their own lifecycle offers and cannot read admin lifecycle data.
- Real payment, instance delivery, terminal and notification proof are completed.
