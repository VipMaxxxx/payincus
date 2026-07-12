# FX-008 owner 部署步骤（草案，生产操作前必须复审）

## 状态与边界

这是 FX-008 的 owner 手动迁移草案，不是已完成的生产变更。本次代码改动没有执行安装脚本、`systemctl`、sudoers 写入、OTA、发布、提交或推送。

按本任务的文件范围，`scripts/migrate-ota-atomic-layout.sh` 没有改动；仓库当前版本的该旧迁移脚本仍会写回直接执行 `current/...js` 的 unit 和旧 sudoers。完成 FX-008 迁移后不得再运行它。既有机器应使用本文步骤迁移；若 owner 后续要继续保留该脚本，必须另开高危变更把同一 helper/sudoers 方案同步进去并重新演练。

本改动未也无法在当前本机验证 systemd/root 行为（本机没有可用的 Linux systemd/root 演练环境）。owner 必须先在预发或可回滚演练机完成下面的全流程和攻击面验证，再决定是否进入生产。

## 加固后的信任边界

- `/usr/local/libexec/incudal/incudal-online-task` 是 root unit 的唯一入口，必须为 `root:root 0755`。helper 放在安装根之外，避免 legacy OTA 替换 `/opt/incudal` 时删除自身。
- backend 的 `sudo systemctl ...` 会通过仅对 `incudal` 设置的 sudo `secure_path` 命中 `/usr/local/libexec/incudal/systemctl`。该 root-owned wrapper 只接受 `start --no-block`、两个固定 unit 模板以及正整数 task ID。
- OTA worker 内原有的 `chown -R incudal:incudal /opt/incudal` 会命中 `/usr/local/libexec/incudal/ota-path/chown`，由它执行选择性封存，不再把代码、`current` 和 `releases` 交给服务用户。
- 安装包先按 Release `.sha256` 校验；封存后，helper 为当前 release 的静态文件写入 root-only SHA256 清单。每次 root worker 启动前必须校验该清单，成功切换 release 后重新封存。
- 只有缓存、更新日志、插件/主题运行数据等明确列出的目录归 `incudal`。`.env` 为 `root:incudal 0640`，服务可读不可写。

## 预发/演练前置检查

1. 安排维护窗口，确认有控制台/root 回退通道；记录当前版本、`current` 指向、unit 内容和 sudoers 内容。不要把 `.env`、token、cookie 或其他凭证写入工单/截图。
2. 备份以下文件到 root-only 目录（建议目录权限 `0700`）：
   - `/etc/systemd/system/incudal-backend.service`
   - `/etc/systemd/system/incudal-online-update@.service`
   - `/etc/systemd/system/incudal-online-rollback@.service`
   - `/etc/sudoers.d/incudal-online-update`
3. 从正式 Release 同时取得目标 tar 包和同名 `.sha256`，先运行 `sha256sum -c <asset>.sha256`。不要在未经验证的现有 release 上直接运行 `seal`：如果机器可能已被入侵，给当前文件“现场生成清单”不能证明来源。应从已验证产物重建目标 release，再封存。
4. 检查 `/opt/incudal/.env` 是否含异常的进程注入项，尤其是 `NODE_OPTIONS`、`NODE_PATH`、`LD_PRELOAD`、`BASH_ENV`、`ENV`。不要把检查输出复制到外部记录。
5. 从可信源重建或逐项审计 `/opt/incudal/.git`：`origin` 必须是 `https://github.com/VipMaxxxx/payincus.git`，不得有可执行 hook，也不得设置 `core.hooksPath`、`core.fsmonitor`、filter clean/smudge/process 或 diff command。仅把既有 `.git` 改成 root owner 不能消除攻陷后已植入的 Git 执行配置。

## 迁移步骤（仅 owner 在预发/现网手动执行）

以下命令假定安装根为 `/opt/incudal`，且已验证的加固版已经成为 `current`。legacy 布局没有 `current` 时，helper 源路径应使用 `/opt/incudal/deploy/`。路径不同必须先审阅 helper 中的固定路径，不能直接套用。

1. 从已验证 release 安装固定 helper：

   ```bash
   install -d -o root -g root -m 0755 /usr/local/libexec/incudal /usr/local/libexec/incudal/ota-path
   install -o root -g root -m 0755 /opt/incudal/current/deploy/incudal-online-task.sh.example /usr/local/libexec/incudal/incudal-online-task
   install -o root -g root -m 0755 /opt/incudal/current/deploy/incudal-systemctl-wrapper.sh.example /usr/local/libexec/incudal/systemctl
   install -o root -g root -m 0755 /opt/incudal/current/deploy/incudal-ota-chown-wrapper.sh.example /usr/local/libexec/incudal/ota-path/chown
   install -d -o root -g root -m 0755 /var/cache/incudal-ota /var/lib/incudal-ota/manifests
   ```

2. 收紧环境文件，并封存已验证 release：

   ```bash
   chown root:incudal /opt/incudal/.env
   chmod 0640 /opt/incudal/.env
   /usr/local/libexec/incudal/incudal-online-task seal
   ```

3. 把加固版 unit 示例安装到 `/etc/systemd/system/`。同时给 backend unit 增加以下 PATH，确保应用发起的 `sudo systemctl` 命中受控 wrapper：

   ```ini
   Environment=PATH=/usr/local/libexec/incudal:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
   ```

   root oneshot 的 `ExecStart` 必须分别是：

   ```ini
   ExecStart=/usr/local/libexec/incudal/incudal-online-task update %i
   ExecStart=/usr/local/libexec/incudal/incudal-online-task rollback %i
   ```

4. 先写临时 sudoers 文件、校验，再原子替换。内容应与加固版安装脚本一致：

   ```sudoers
   Defaults:incudal !requiretty
   Defaults:incudal secure_path=/usr/local/libexec/incudal:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
   incudal ALL=(root) NOPASSWD: /usr/local/libexec/incudal/systemctl start --no-block incudal-online-update@*.service, /usr/local/libexec/incudal/systemctl start --no-block incudal-online-rollback@*.service
   ```

   ```bash
   chown root:root /etc/sudoers.d/incudal-online-update.new
   chmod 0440 /etc/sudoers.d/incudal-online-update.new
   visudo -cf /etc/sudoers.d/incudal-online-update.new
   mv -f /etc/sudoers.d/incudal-online-update.new /etc/sudoers.d/incudal-online-update
   ```

   sudoers 中的 `*` 只负责让动态 task ID 到达 wrapper；安全边界是 root-owned wrapper 对参数数量、动作、unit 名和正整数 ID 的二次严格校验。不得把规则改回 `/usr/bin/systemctl ...@*.service`。

5. owner 审阅无误后才执行 `systemctl daemon-reload` 和 backend 重启。先在预发完成，生产必须另行批准。

## 必须通过的验证

### 静态权限与 sudoers

```bash
stat -c '%U:%G %a %n' \
  /opt/incudal /usr/local/libexec/incudal/incudal-online-task /usr/local/libexec/incudal/systemctl \
  /usr/local/libexec/incudal/ota-path/chown /opt/incudal/.env
readlink -f /opt/incudal/current
find /opt/incudal/releases -xdev \( ! -user root -o -perm /022 \) -print
sudo -l -U incudal
visudo -cf /etc/sudoers.d/incudal-online-update
systemd-analyze verify \
  /etc/systemd/system/incudal-backend.service \
  /etc/systemd/system/incudal-online-update@.service \
  /etc/systemd/system/incudal-online-rollback@.service
```

预期：三个 helper 和安装根为 root-owned；`.env` 为 `root:incudal 640`；原子布局下 `current` 解析到 `/opt/incudal/releases/` 内；release 代码除明确运行时例外外没有非 root owner 或 group/other 写位；sudoers 仅列出 `/usr/local/libexec/incudal/systemctl` 的两个 start 规则。

`server/certs` 是有意保留的运行时例外，应单独确认仅 `incudal` 可访问。插件、主题、缓存和日志目录也是显式可写例外，不能放入 root helper、Node preload 或 systemd unit 所引用的代码。

### 负向参数验证

以下调用必须在 wrapper 内失败，且不得启动任何 unit：

```bash
sudo -u incudal sudo -n /usr/local/libexec/incudal/systemctl status incudal-backend.service
sudo -u incudal sudo -n /usr/local/libexec/incudal/systemctl start --no-block incudal-online-update@0.service
sudo -u incudal sudo -n /usr/local/libexec/incudal/systemctl start --no-block 'incudal-online-update@1.service ssh.service'
sudo -u incudal test ! -w /usr/local/libexec/incudal/incudal-online-task
sudo -u incudal test ! -w /opt/incudal/current/server/dist/scripts/run-system-update-task.js
sudo -u incudal test ! -w /opt/incudal/.env
```

### 正向 OTA/回滚演练

1. 在预发通过后台创建真实、受审计的更新 task，确认只启动对应数字实例 unit。
2. 确认更新日志出现 OTA artifact SHA256 校验成功，更新完成后 `current` 原子指向新 release，backend 健康检查通过。
3. 再次执行静态权限检查；新 release 必须仍为 root-owned，`incudal` 不可修改 worker 或其 imports。
4. 确认 `/var/lib/incudal-ota/manifests/` 中出现新 current 对应的 root-owned 清单；篡改预发 release 的副本后，helper 必须在 Node worker 启动前因清单校验失败。
5. 在预发执行一次受审计回滚 task，确认切回旧 release 后权限和清单仍满足上述条件。

## 回滚方式

1. 使用控制台/root 通道停止新的 update/rollback 实例，保存 journal 证据（注意脱敏）。
2. 首先移除或禁用 `/etc/sudoers.d/incudal-online-update`，阻止服务账户继续触发 root OTA；校验 sudoers 总配置。
3. 恢复备份的三个 unit 和 backend unit，执行 `systemctl daemon-reload`，再按维护流程恢复 backend。
4. 保留 release/current/root helper 的 root ownership不会妨碍 backend 只读运行。不要为了“回滚”直接恢复 `chown -R incudal:incudal /opt/incudal`；这会重新引入 FX-008。若旧版本确实依赖写代码目录，应保持在线更新禁用并由 owner 单独评估。
5. 若必须恢复旧 OTA 行为，只能视为接受 P1 风险的临时应急措施，需 owner 明确批准、限定维护窗口并在事后重新执行本加固迁移。

## 生产放行证据

生产前至少保存：预发 unit 校验、sudoers 校验、三组负向参数测试、一次成功 OTA、一次成功回滚、更新前后权限扫描、manifest 拒绝篡改的结果，以及 backend/双前端/支付就绪等既有发布守卫结果。不得把“本地静态测试通过”记作 systemd/root 或生产验证。
