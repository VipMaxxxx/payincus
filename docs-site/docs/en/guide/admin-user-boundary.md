# Admin and User Boundaries

PayIncus treats frontend boundaries as a security and product requirement, not only a navigation detail.

## User Portal

- Requires a regular user identity for authenticated routes.
- Does not expose admin navigation, admin API calls or admin wording.
- Redirects admin accounts away from user-only pages.

## Admin Console

- Uses `/admin/login` as the admin login page.
- Requires administrator identity for admin routes.
- Does not expose user self-service workflows.
- Uses admin-specific API modules and routes.

## Build-time Guards

The repository includes guards that scan source and build artifacts:

```bash
pnpm --filter server test:frontend-route-guards
pnpm --filter server test:frontend-dist-boundary-guards
```

These checks help prevent accidental cross-imports between the user and admin bundles.
