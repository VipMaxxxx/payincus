# Introduction

PayIncus is an Incus-based panel for selling, delivering and operating LXC / KVM NAT VPS resources.

It is based on `qwer-xyz/incudal` and focuses on non-Docker production deployment, split user/admin frontends, payment callbacks, resource delivery, host Agent reporting and admin OTA updates.

## Entrypoints

- User portal: `https://demo.payincus.com`
- Admin console: `https://demoadmin.payincus.com`
- Documentation: `https://payincus.com`
- Telegram group: `https://t.me/Payincus`
- GitHub repository: `https://github.com/VipMaxxxx/payincus`

## Main Capabilities

- User portal for accounts, instances, terminal access, wallet, tickets, notifications and self-service modules.
- Admin console for users, billing, payments, hosts, images, settings, logs and OTA updates.
- Backend API for authentication, billing, Incus delivery, Agent reporting and notification delivery.
- Host Agent for heartbeat, capacity, instance state and traffic reporting.
- Production verification scripts for split hosts, route boundaries, response headers and live acceptance.

## Production Rule

Local tests and build-time guards are necessary, but production readiness still requires real live proof for payments, Incus operations, Agent reporting, SMTP, Lsky and notification delivery.
