# systemd Service

The backend should run as a systemd service in production.

Template:

```bash
sudo cp deploy/incudal-backend.service.example /etc/systemd/system/incudal-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now incudal-backend
sudo journalctl -u incudal-backend -f
```

## Required Runtime Settings

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
SERVE_STATIC_CLIENT=false
FRONTEND_URL=https://panel.example.com
ADMIN_FRONTEND_URL=https://admin.example.com
```

## OTA Note

The OTA worker needs enough permission to install dependencies, run migrations, switch releases and restart the backend service. Production setups should keep that permission narrow and auditable.
