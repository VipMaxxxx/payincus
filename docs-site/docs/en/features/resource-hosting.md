# Hosting and Resource Pools

Hosting and resource pools connect internal or third-party host capacity to PayIncus so the system can sell and deliver instances by host, plan and capacity.

## Resource Model

| Object | Description |
| --- | --- |
| Host | A physical or virtual host running Incus and the Agent. |
| Plan | CPU, memory, disk, traffic, price and billing cycle offered to users. |
| Image | OS image selectable during instance creation. |
| Resource pool | Aggregated capacity and supply. |
| Hosting revenue | Revenue and settlement records for resource providers. |

## User Hosting Features

Availability depends on system configuration:

- Submit hosted hosts.
- View host state, resource reports and review result.
- Create and edit hosted plans.
- View hosting revenue and settlement records.

For new hosted hosts, use Ubuntu 22.04+ or Debian 12/13. Debian 11 remains a compatibility path only; new hosts should prefer Debian 12/13.

## Admin Hosting Features

- Review hosted hosts and resource providers.
- View capacity, online state and Agent heartbeat.
- Manage plans, images, pools and supply state.
- Handle revenue, settlement and abnormal resources.

## Agent Relationship

Agent provides runtime truth:

- Host heartbeat.
- CPU, memory, disk and traffic reports.
- Instance state reports.
- Agent release metadata.
- Signature and replay protection.

## Risks

- Host capacity must be checked against both Agent reports and admin configuration.
- Resource providers must not access other users' resources.
- Plan availability changes must not break renewal or billing for existing instances.
- Do not keep allocating resources blindly when the Agent is offline.
- If Incus returns `not authorized`, first check whether the host trusts the current panel certificate. Generate a fresh host install command and run it on the host to refresh the `panel` trust entry.
- Resource deletion and revenue settlement must leave audit records.

## Verification Checklist

- Agent heartbeat and resource reports are healthy.
- The admin console can read host storage pools and create or link a storage pool.
- Capacity changes are reflected in the admin console.
- User hosting entry points follow the system configuration.
- Admins can review and manage hosted resources.
- Instance delivery does not allocate to unavailable hosts.
