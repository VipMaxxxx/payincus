# Agent Installation

The Agent runs on Incus hosts. It reports host resources, instance state and traffic data, and helps the panel complete delivery workflows.

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
