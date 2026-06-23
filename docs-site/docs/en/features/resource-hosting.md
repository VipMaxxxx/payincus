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
