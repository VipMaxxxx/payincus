# Split Deployment

The production standard is two public frontend domains with one shared backend API.

## Domains

| Purpose | Example |
| --- | --- |
| User portal | `https://panel.example.com` |
| Admin console | `https://admin.example.com` |
| Backend API | Same-origin `/api` behind each frontend |

## Build Outputs

```text
client/dist/user/index.html
client/dist/admin/index.html
server/dist/app.js
```

The backend should not directly serve frontend assets in production.

## Nginx Responsibility

- Serve `client/dist/user` on the user domain.
- Serve `client/dist/admin` on the admin domain.
- Proxy `/api/` to the backend.
- Proxy `/api/ws/` with WebSocket upgrade headers.

## Boundary Requirements

- The user bundle must not contain admin entrypoints, admin API modules or admin navigation.
- The admin bundle must not contain user self-service features such as wallet recharge, friends, transfers, check-in or package sharing.
- Admin accounts must not enter the user portal.
- Regular users must not enter the admin console.
