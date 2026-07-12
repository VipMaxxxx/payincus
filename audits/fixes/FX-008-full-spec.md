# FX-008 完整实现:root 单元执行服务用户可写 JS 提权链(D-055,owner"全部做了"授权)

## 根因
`deploy/incudal-backend.service.example:32` 等 `User=root` 在线更新单元直接执行 `incudal` 用户**可写目录**中的 JS,且该用户可免密 `systemctl start` → 服务用户/扩展/incudal 账号被攻破即可替换 root 单元脚本获完整 root。证据:scripts/install-panel.sh:1136/828/1174。

## 修法(只改 deploy/*.service.example + scripts/install-panel.sh + 相关 OTA 脚本 + 守卫;不碰运行时业务代码;不改 schema/package)
1. 先只读:各 systemd 单元(User=/ExecStart=)、install-panel.sh 的目录属主/权限设置、OTA update/rollback 单元、免密 sudoers 规则。
2. **root helper 只执行 root 拥有且服务用户不可写的固定入口与已验证产物**:
   - root 权限单元的 ExecStart **固定指向 root 拥有、`incudal`/服务用户不可写(0755 root:root 或更严)的脚本/入口**;不再执行 incudal 可写目录中的 JS。
   - OTA 释放目录/产物在被 root 执行前**校验属主与完整性**(root 拥有、不可被服务用户改;可加校验和/签名校验已验证产物)。
   - 收敛免密 `systemctl start` 权限:sudoers 仅允许**特定单元**、不允许服务用户改单元文件本身。
   - install-panel.sh 建目录/放文件时把 root 执行路径的**属主设 root、权限去服务用户写位**。
3. **⚠️ 部署期红线**:这是 OTA 高危 infra,代码侧收紧后**owner 必须在部署期按 OTA 流程验证**(权限/属主/单元路径),交付里明确标注。

## 加守卫
`test:agent-install-command-guards`/`test:host-install-script-guards`/`test:split-deploy-config` 追加:root 单元不执行服务用户可写路径、属主/权限收紧、sudoers 收敛。不改 package.json。

## 不许动
不碰运行时业务代码。不改 schema/package。不 commit/push/发版/OTA。

## 验收
`test:agent-install-command-guards`、`test:host-install-script-guards`、`test:split-deploy-config` 通过;`bash scripts/test-install-panel-guards.sh` 通过(若有)。交付一段话:root 执行路径怎么收紧、属主/权限、sudoers、**部署期 owner 需验证什么**、守卫结果。
