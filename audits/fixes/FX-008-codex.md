FX-008 加固草案已完成，未执行任何安装、`systemctl`、sudoers 写入、OTA、提交、推送或发布动作。

主要改动：

- root oneshot 改为固定执行 root-owned helper：
  - [incudal-online-update@.service.example](C:/Users/Administrator/Desktop/payinces/deploy/incudal-online-update@.service.example)
  - [incudal-online-rollback@.service.example](C:/Users/Administrator/Desktop/payinces/deploy/incudal-online-rollback@.service.example)
- 新增三个受控入口：
  - [incudal-online-task.sh.example](C:/Users/Administrator/Desktop/payinces/deploy/incudal-online-task.sh.example:1)：校验 SHA256 文件清单、完整文件集合、symlink、Git origin/hooks/config，并选择性恢复安全权限。
  - [incudal-systemctl-wrapper.sh.example](C:/Users/Administrator/Desktop/payinces/deploy/incudal-systemctl-wrapper.sh.example:1)：只接受两个 unit 模板和正整数 task ID。
  - [incudal-ota-chown-wrapper.sh.example](C:/Users/Administrator/Desktop/payinces/deploy/incudal-ota-chown-wrapper.sh.example:1)：截获 OTA 现有递归 `chown`，防止重新将代码交给 `incudal`。
- backend PATH 和 sudoers `secure_path` 指向 `/usr/local/libexec/incudal`，避免直接授权真实 `systemctl`：
  - [incudal-backend.service.example](C:/Users/Administrator/Desktop/payinces/deploy/incudal-backend.service.example)
  - [install-panel.sh](C:/Users/Administrator/Desktop/payinces/scripts/install-panel.sh:1113)
- `.env` 改为 `root:incudal 0640`；代码、`current`、`releases`、Git 元数据保持 root 控制，仅显式运行时目录归 `incudal`。
- 只有本次实际通过 Release SHA256 校验的产物才能自动建立可信清单，拒绝直接给来源不明的既有目录“现场背书”。
- owner 迁移、验证、负向测试和回滚手册：
  - [FX-008-owner-steps.md](C:/Users/Administrator/Desktop/payinces/audits/fixes/FX-008-owner-steps.md:1)

验证结果：

- `bash -n`：安装脚本和三个 helper 通过。
- `pnpm test:installer`：通过。
- `pnpm --filter server test:system-update-guards`：通过。
- `pnpm --filter server type-check`：通过。
- `git diff --check`：通过。
- wrapper 非法动作、非法 unit/附加参数负向检查：按预期以 64 拒绝。
- 未修改或覆盖仓库中原有的无关工作区改动。

重要限制：本改动未也无法在本机验证 Linux systemd、root、sudoers、真实 OTA/回滚流程，必须由 owner 在预发/演练环境按手册验证后才能考虑生产。按本次指定范围，旧的 `scripts/migrate-ota-atomic-layout.sh` 未修改，它仍会写回旧式不安全 unit；手册已明确要求加固后不得继续运行该脚本。
