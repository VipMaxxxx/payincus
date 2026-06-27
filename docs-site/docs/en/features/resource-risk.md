# Resource Risk Control

Resource risk control detects and handles instance-level abuse, security risk and sustained abnormal resource usage. PayIncus scores instances only; accounts are linked through their instances for order restrictions, notifications and ticket review.

## Risk Targets

| Target | Description |
| --- | --- |
| Instance | Primary target for scores, QoS downgrades, manual suspension and risk events. |
| Account | Linked through the instance. A high-risk instance can restrict the account from creating new instances, but the score is not assigned directly to the account. |
| Risk event | Records sustained bandwidth, CPU usage, packet rate, scan suspicion, manual actions and automatic handling results. |
| Order restriction | Blocks the linked account from creating new instances until staff review it, usually through a ticket. |

## Detection

Resource risk combines Incus / Agent data with admin policy:

- Sustained bandwidth usage.
- Sustained high CPU usage.
- PPS and packet volume anomalies.
- Small-packet scan suspicion.
- QoS downgrade events.
- Instance status, suspension state and manual handling state.

Default policy is conservative. Automatic suspension is disabled by default so the first rollout does not block legitimate customers before operators review real traffic patterns.

## QoS Tiers

QoS tiers are configured with structured rows instead of a CSV text field. Each row contains:

- Tier level.
- Bandwidth limit in Mbps.
- Trigger score.

When an instance reaches the configured score, PayIncus can downgrade the instance bandwidth to the matching tier. QoS downgrade is instance-scoped and does not directly change plan price or billing records.

## Manual Operations

The admin page at `/admin/resource-risk` supports manual intervention:

- Limit instance bandwidth.
- Suspend an instance.
- Unsuspend an instance.
- Restrict the linked account from new orders.
- Release the active order restriction created by the current source instance.

All manual actions require a reason and write audit records. High-risk actions must still pass internal instance state, permission and audit boundaries.

## Order Restriction Boundary

Order restrictions are account-level, but admin operations preserve the source instance boundary:

- If the current instance created the active order restriction, the row shows the release action.
- If another instance under the same account created the active restriction, the row shows an account-restricted state instead.
- Releasing a restriction only releases the active record created by that source instance.
- Because release affects whether the whole account can create new orders, operators must keep the source instance and review reason clear.

This avoids showing every risky instance under one user as independently releasable when they are actually tied to the same account restriction.

## Pagination and Operations Lists

The resource risk center shows up to 10 rows per page for:

- Risk instances.
- Risk events.
- Order restriction records.

After an operator releases the last item on a page, the UI reloads the last valid page instead of staying on an empty page.

## User Impact

Resource risk affects instances and the linked account:

- An instance may be QoS downgraded, suspended or manually blocked.
- The linked account may be blocked from creating new instances because of a high-risk instance.
- The user should open a ticket and wait for staff review before the order restriction is released.
- Regular users cannot see score policy, internal notes, other account restrictions or risk event details.

## Backend Modules

- `resource-risk`: admin policy, risk instance list, event list, order restriction handling and manual action routes.
- `resource-risk-service`: scoring, automatic handling, QoS and restriction logic.
- `traffic`: instance traffic and packet collection entrypoint.
- `instances`: instance state, suspension state and lifecycle actions.
- `tickets`: staff review channel after order restriction.

## Risks

- Automatic suspension and automatic order restriction should be enabled carefully after production observation.
- CPU, bandwidth and PPS signals must be interpreted with plan size, host capacity and customer use case in mind.
- Account order restriction affects all new instance purchases for that account, so release must verify the source instance and review result.
- Risk notes, score policy and manual action records must remain admin-only.
- QoS downgrade must not bypass instance bandwidth restore, plan upgrade or billing state machines.

## Verification Checklist

- The admin resource risk page paginates risk instances, events and order restrictions.
- When one account has multiple risky instances, only the source instance shows the release action; other rows show the account-restricted state.
- Manual suspension, unsuspension, restriction and release require a reason and write audit records.
- Releasing a restriction refreshes the list to a valid page.
- Regular users cannot read risk policy, manual notes or other account restrictions through user APIs.
- A restricted account is blocked from creating new instances and can proceed through ticket review.
