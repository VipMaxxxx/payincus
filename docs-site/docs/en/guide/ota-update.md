# Admin OTA

The admin console includes a version update page for controlled online updates.

Admin page:

```text
https://demoadmin.payincus.com/admin/system-update
```

## Recommended Mode

```dotenv
SYSTEM_UPDATE_APPLY_MODE=auto
SYSTEM_UPDATE_RELEASE_REPOSITORY=VipMaxxxx/payincus
```

`auto` prefers verified GitHub Release OTA artifacts. If no matching artifact exists for the target tag, it can fall back to Git tag build mode.

| Mode | Behavior |
| --- | --- |
| `auto` | Prefer artifact, fall back to Git build |
| `artifact` | Only use verified OTA artifacts |
| `git` | Checkout the tag and build on the server |

## Artifact Flow

1. Read `ota-manifest.json` from GitHub Release.
2. Select the artifact for the current Linux architecture.
3. Download outside the install directory.
4. Verify size and SHA256.
5. Extract to staging.
6. Create a new atomic release under `/opt/incudal/releases`.
7. Run Prisma migrations.
8. Restart the backend and wait for `/api/health`.
9. Run split host and production verification scripts.

## Atomic Layout

```text
/opt/incudal/current -> /opt/incudal/releases/<version-timestamp>
/opt/incudal/releases/v0.0.10-...
/opt/incudal/releases/v0.0.11-...
```

Rollback switches the `current` symlink back to the previous release, restarts the backend and reruns verification.

## Notes

- Only super administrators can start updates and rollbacks.
- Update APIs stay under `/api/admin/system-update/*`.
- The user portal does not include update controls or update APIs.
- Updates and rollbacks preserve `.env`, `server/certs`, `agent-release`, `plugins`, `plugin-data`, `plugin-logs`, `plugin-staging`, `.npm` and `.cache`.
