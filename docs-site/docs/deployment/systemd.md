# systemd 服务

后端服务模板：

```bash
sudo cp deploy/incudal-backend.service.example /etc/systemd/system/incudal-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now incudal-backend
sudo journalctl -u incudal-backend -f
```

在线更新服务模板：

```bash
sudo cp deploy/incudal-online-update@.service.example /etc/systemd/system/incudal-online-update@.service
sudo cp deploy/incudal-online-rollback@.service.example /etc/systemd/system/incudal-online-rollback@.service
sudo systemctl daemon-reload
```

受限 sudoers 示例：

```bash
printf 'Defaults:incudal !requiretty\nincudal ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block incudal-online-update@*.service, /usr/bin/systemctl start --no-block incudal-online-rollback@*.service\n' \
  | sudo tee /etc/sudoers.d/incudal-online-update >/dev/null
sudo chmod 440 /etc/sudoers.d/incudal-online-update
sudo visudo -cf /etc/sudoers.d/incudal-online-update
```

原子 OTA 布局下，服务工作目录应指向：

```text
/opt/incudal/current
```
