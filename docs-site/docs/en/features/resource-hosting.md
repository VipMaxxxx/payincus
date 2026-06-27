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

KVM plans can only be bound to hosts that support virtual machines. The host must expose a usable `/dev/kvm` and be marked as `vm` or `both` in the admin host type. Hosts without KVM support should be used as container hosts only. The backend rejects VM plans bound to container-only hosts and rejects changing a host to container-only while VM plans are still bound to it, so users do not create instances that immediately enter an error state.

## Network Delivery Modes

PayIncus currently treats these network modes as supported sales and delivery targets:

- `nat`: IPv4 NAT. Instances receive an internal IPv4 address and port mappings use the host NAT port pool.
- `nat_ipv6`: IPv4 NAT plus dedicated IPv6. Instances receive an internal NAT IPv4 address and a routed dedicated IPv6 address.
- `ipv6_only`: dedicated IPv6 only. This mode does not consume NAT IPv4 ports.
- `public_ipv4`: dedicated IPv4. Instances bind a public IPv4 address through an Incus routed NIC.
- `public_ipv4_ipv6`: dedicated IPv4 plus dedicated IPv6. Instances receive both a public routed IPv4 address and a routed dedicated IPv6 address.

`nat_ipv6_nat` and `ipv6_nat` remain only for legacy data compatibility and should not be used for newly published plans.

Dedicated IPv4 plans require a public IPv4 pool on the host first. Configure it from the host detail page under the "Dedicated IPv4" tab. A pool stores gateway, prefix length, DNS and address entries. During instance creation PayIncus reserves one free IPv4 address after locked host capacity reservation; failed or timed-out provisioning releases the address. Hosts without free dedicated IPv4 addresses are excluded from dedicated IPv4 delivery.

## Admin Hosting Features

- Review hosted hosts and resource providers.
- View capacity, online state and Agent heartbeat.
- Use `/admin/capacity-cost` to inspect sellable inventory, Host pressure, capacity trends, cost profiles and plan margin estimates.
- Manage plans, images, pools and supply state.
- Handle revenue, settlement and abnormal resources.

## Capacity and Cost Operations

The capacity and cost center is admin-only:

- Sellable inventory is derived from Host configuration, Agent resource reports, non-deleted instance usage and NAT port ranges.
- Dedicated IPv4 sellable inventory is derived from `free` addresses in the host public IPv4 pools.
- Cost profiles include monthly Host cost, monthly IPv4 cost, traffic cost per TB and internal notes. They are used only for backend estimates.
- Plan margin estimates do not participate in real billing and do not change plan sales, instance creation or renewal behavior.
- High Host CPU, memory, disk or NAT port usage creates capacity warnings and syncs them into the SLA alert center.
- User package APIs do not return costs, margins, capacity snapshots or internal alert fields.

## Agent Relationship

Agent provides runtime truth:

- Host heartbeat.
- CPU, memory, disk and traffic reports.
- Instance state reports.
- Agent release metadata.
- Signature and replay protection.

## Risks

- Host capacity must be checked against both Agent reports and admin configuration.
- Capacity and cost data is an operations view only and must not be treated as the sole source of truth for delivery.
- Resource providers must not access other users' resources.
- Plan availability changes must not break renewal or billing for existing instances.
- Do not keep allocating resources blindly when the Agent is offline.
- VM/KVM plan type, host type and visible images must stay compatible. If Incus returns `KVM support is missing (no /dev/kvm)`, the host cannot deliver KVM instances; enable nested virtualization, replace the host with one that supports KVM, or convert the plan to a container plan before publishing it again.
- If Incus returns `not authorized`, first check whether the host trusts the current panel certificate. Generate a fresh host install command and run it on the host to refresh the `panel` trust entry.
- Prefer LVM when creating storage pools on Debian/cloud kernels. Choose ZFS only after confirming the host can run `modprobe zfs`. If ZFS pool creation returns `modprobe: FATAL: Module zfs not found`, the host does not have a usable ZFS kernel module. Repair `linux-headers-$(uname -r)` / `zfs-dkms`, or use LVM, Btrfs, or DIR storage instead.
- Resource deletion and revenue settlement must leave audit records.

## Verification Checklist

- Agent heartbeat and resource reports are healthy.
- The admin console can read host storage pools and create or link a storage pool.
- Dedicated IPv4 hosts have public IPv4 pools configured, and free address capacity is reflected in plan delivery checks.
- Capacity changes are reflected in the admin console.
- The capacity and cost page shows Host sellable inventory, cost profiles and plan margin estimates, while users cannot see those internal fields.
- User hosting entry points follow the system configuration.
- Admins can review and manage hosted resources.
- Instance delivery does not allocate to unavailable hosts.
