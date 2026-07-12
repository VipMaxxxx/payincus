FX-008 代码侧已完成，未执行 commit/push、发版、OTA 或生产变更。

主要收紧：

- root 更新/回滚单元仅执行固定入口 `/usr/local/libexec/incudal/incudal-online-task`。
- helper 直接从 SHA256 校验通过的 Release 包提取，安装为 `root:root 0755`。
- `current`、`releases`、`.git` 和清单由 root 控制；执行 JS 前校验属主、符号链接及完整性清单。
- `.env` 调整为 `root:incudal 0640`，服务用户只读。
- 不再将整个安装树递归交给 `incudal`，仅运行时目录可写。
- sudoers 仅允许调用 root-owned systemctl wrapper；wrapper 只接受两个 OTA 单元及正整数任务 ID。
- 原子布局迁移强制使用 root 控制、不可组/其他写且 SHA256 验证通过的 Release 包。
- 已在三个指定 TypeScript 守卫及安装脚本守卫中加入回归断言。

涉及文件包括 [安装脚本](C:/Users/Administrator/Desktop/payinces/scripts/install-panel.sh)、[原子布局迁移](C:/Users/Administrator/Desktop/payinces/scripts/migrate-ota-atomic-layout.sh)、[root OTA helper](C:/Users/Administrator/Desktop/payinces/deploy/incudal-online-task.sh.example)、两个 wrapper、两个 root service example 及相关守卫。

验证结果：

- `test:agent-install-command-guards`：通过
- `test:host-install-script-guards`：通过
- `test:split-deploy-config`：通过
- `bash scripts/test-install-panel-guards.sh`：通过
- `pnpm --filter server type-check`：通过
- Bash 语法检查、限定范围 `git diff --check`：通过

部署期 owner 必须验证：

- Release 包及 `.sha256` 为 `root:root`，组/其他用户无写权限；迁移时显式提供 `VERIFIED_RELEASE_ARCHIVE`。
- `systemctl cat` 确认两个 root 单元只指向固定 helper。
- 用 `stat` 验证 `/usr/local/libexec/incudal`、helper、wrapper、manifest、`current/releases/.git` 的属主和权限。
- 验证 `.env=root:incudal 0640`、sudoers=`root:root 0440`，且 `incudal` 无法修改单元、helper、代码树或清单。
- 用 `sudo -l -U incudal` 及非法参数测试确认只能启动指定 OTA 单元。
- 在维护窗口分别完成一次真实更新和回滚，核对 journal、完整性拒绝路径、current 切换、后台健康检查及业务探针。

由于按要求没有触碰生产，真机 OTA/回滚证据仍属于部署期验收项。
