# Public API SDK

The PayIncus Public API SDK is a lightweight TypeScript client for third-party extension backends and external integrations. It only calls `/api/v1` with Bearer tokens and does not depend on internal user or admin APIs.

Download:

```text
https://payincus.com/sdk/payincus-public-api.ts
```

Examples:

```text
https://payincus.com/sdk/examples/service-power-task.ts
https://payincus.com/sdk/examples/service-renew.ts
https://payincus.com/sdk/examples/flash-sale-action.ts
https://payincus.com/sdk/examples/balance-adjustment-request.ts
https://payincus.com/sdk/examples/billing-records.ts
https://payincus.com/sdk/examples/oauth-authorization-code.ts
```

## Usage

```ts
import { PayIncusPublicApiClient } from './payincus-public-api'

const client = new PayIncusPublicApiClient({
  baseUrl: 'https://panel.example.com',
  token: process.env.PAYINCUS_API_TOKEN!
})

const profile = await client.getProfile()
const services = await client.listServices({ include: ['product'] })
const task = await client.queueServiceAction(services.data[0].id, {
  action: 'restart'
})
```

## Token Sources

- `pat_`: API token created by a PayIncus user.
- `poa_`: OAuth Provider access token from the authorization code flow.

## Covered Scopes

- `profile:read`
- `profile:write`
- `balance:read`
- `balance:write`
- `billing:read`
- `products:read`
- `services:read`
- `services:operate`
- `services:billing`
- `orders:read`
- `tickets:read`
- `tickets:write`
- `notifications:read`
- `notifications:send`
- `plugins:action`

## Boundary

The SDK only covers stable Public API capabilities. It does not call `/api/admin/*`, access internal databases, bypass extension manifests, or write payment, balance, delivery, or risk-control state directly.
