# Online Demo

The demo environment is for quickly trying the PayIncus user portal and admin console. It is not a production deployment entrypoint and must not be used for real payment, secret, delivery or private-data testing.

## Entrypoints

| Entry | URL | Username | Password |
| --- | --- | --- | --- |
| User portal | <https://demo.payincus.com> | `demo` | `demo123` |
| Admin console | <https://demoadmin.payincus.com> | `admin` | `admin123` |

## Boundaries

- Demo data may be reset at any time.
- Do not enter real payment details, API keys, SMTP passwords, Telegram tokens, Lsky tokens or other sensitive configuration in the demo environment.
- For production deployments, use your own user portal and admin domains. See [One-click Install](/en/deployment/one-click-install) and [Environment Variables](/en/deployment/environment).
- The demo is only for reviewing the UI, feature layout and basic workflows. Production readiness must be verified on your own deployment.

## Difference From Production

- Demo domains are public trial entrypoints.
- `panel.example.com` and `admin.example.com` are placeholder domains in the docs and must be replaced with your own domains.
- Production requires your own database, Redis, Incus hosts, Agent, payment providers, SMTP, object storage and notification channels.
