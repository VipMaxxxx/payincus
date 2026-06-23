# Agent Installation

The Agent runs on Incus hosts. It reports host resources, instance state and traffic data, and helps the panel complete delivery workflows.

## Host OS

The host install script is recommended for Ubuntu 22.04+ and Debian 12/13. Debian 11 remains best-effort compatible, but it is not recommended for new hosts. Debian 10 and earlier are rejected by the installer.

## Panel Certificate Trust

The host install script imports the panel Incus client certificate into the host Incus trust list as `panel`. If the panel is reinstalled, migrated, restored from disaster recovery, or has its client certificate regenerated, the host may still trust an old `panel` certificate. Admin storage-pool creation or resource reads can then fail with `not authorized`.

When this happens, generate a fresh host install command from the admin console and run it again on the host. The current installer downloads the latest panel certificate first, then replaces the existing `panel` trust entry on the host.

## Release Configuration

```dotenv
INCUDAL_AGENT_RELEASE_REPOSITORY=VipMaxxxx/payincus
INCUDAL_AGENT_RELEASE_TOKEN=
```

If GitHub Agent releases are not available yet, use a local release directory:

```dotenv
INCUDAL_AGENT_RELEASE_DIR=/opt/incudal/agent-release
```

## Local Build

```bash
cd agent
go test ./...
cd ..
bash agent/scripts/build-release.sh
```

## Production Proof

Production acceptance must verify:

- Heartbeat reporting.
- Resource reporting.
- Instance state reporting.
- Traffic reporting.
- Invalid signatures and replayed requests are rejected.
