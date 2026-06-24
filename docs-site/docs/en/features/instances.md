# Instances and Resource Delivery

The primary delivery object in PayIncus is an Incus-backed LXC / KVM instance. The user portal handles customer self-service, while the admin console handles global operations and troubleshooting.

## Delivery Flow

1. The user selects a plan, image and host.
2. The backend validates balance, plan limits, host capacity and quotas.
3. The system creates order and billing records.
4. The backend calls Incus or the host Agent to create the instance.
5. Success syncs state, network information, limits and billing status.
6. Failure triggers compensation so the user is not charged for an undelivered resource.

## User Features

| Feature | Description |
| --- | --- |
| Create instance | Create LXC / KVM instances from plans, images and hosts. |
| Instance list | View status, resources, expiry and actions. |
| Instance detail | View CPU, memory, disk, network, IPv6, mappings and runtime status. |
| Lifecycle actions | Start, stop, reboot and delete. |
| Web terminal | Connect through `/api/ws`. |
| Snapshots and backups | Use snapshot or backup features when configured. |
| Traffic | View usage, reset state and limit notifications. |

## Admin Features

- View and manage all customer instances.
- Create instances manually for delivery correction or migration.
- Manage hosts, images, initialization commands and storage settings.
- Use Delivery Assurance to inspect queued, processing, failed and stale delivery tasks with user, host, Agent, resource, billing and notification context.
- Troubleshoot failed delivery through logs, Agent reports and task state.

## Delivery Assurance Handling

Delivery Assurance turns failed or stale instance tasks into operational cases:

- Statuses: pending manual handling, auto retryable, in progress, recovered and closed.
- Idempotent retry: only start, stop and restart tasks can be requeued automatically. Rebuild, recreate, clone and host-change tasks require manual confirmation.
- Manual takeover records the handler, note, handling time and state change.
- User notifications cover delivery delayed, recovered and contact support states.
- Context on the same page includes user, instance, host, Agent heartbeat, host resources and latest billing record, so operators can decide whether refund, compensation or migration is needed.

## Backend Modules

- `instances`, `instance-billing`, `instance-destroy`.
- `terminal`, `snapshots`, `backups`, `traffic`.
- `agent` for host heartbeat, resource reporting and instance state reporting.

## Risks

- Failed creation must compensate billing state.
- Failed, timed out or stale delivery tasks must notify the user and leave an auditable admin log.
- Non-idempotent delivery tasks must not be retried automatically.
- Deletion must clean Incus resources and local records.
- Terminal WebSocket must verify identity and instance ownership.
- Admin operations must be audited.
- Stale Agent state can affect capacity decisions.
