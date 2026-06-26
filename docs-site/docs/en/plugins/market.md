# Extension Marketplace

The PayIncus Extension Marketplace is a stable online directory for the Extension Center. The admin console reads the machine-readable index from:

```text
https://payincus.com/plugin-market/index.json
```

This URL does not change when PayIncus is upgraded, rolled back, or deployed through OTA.

## Listed Extensions

| Extension | Type | Status | Source | Security |
| --- | --- | --- | --- | --- |
| AI Ticket Assistant | Official extension | Listed | PayIncus docs site marketplace | SHA256 is verified during install |

## Directory Files

- Market index: [/plugin-market/index.json](/plugin-market/index.json)
- AI Ticket Assistant manifest: [/plugin-market/manifests/com.payincus.ai-ticket-agent/0.1.1.json](/plugin-market/manifests/com.payincus.ai-ticket-agent/0.1.1.json)
- AI Ticket Assistant package: [/plugin-market/packages/com.payincus.ai-ticket-agent/0.1.1/plugin.tar.gz](/plugin-market/packages/com.payincus.ai-ticket-agent/0.1.1/plugin.tar.gz)

## Review Rules

Only entries with `reviewStatus = listed` appear in the default marketplace. Third-party submissions first enter the review queue and must pass package structure, manifest, SHA256, permission, compatibility, and high-risk capability checks before they are published to the stable index.

## Install Rules

The server downloads the extension package again during installation and verifies SHA256. The marketplace is a discovery and listing surface; it does not replace server-side install validation.
