# FX-008 规格(草案性质·需 owner 部署时审阅)：root 单元执行服务用户可写 JS 提权链(P1 / D-055 / M27-01)

## 根因
scripts/install-panel.sh(约 828/1136/1174 行)与 deploy/incudal-backend.service.example:32:
User=root 的"在线更新"systemd oneshot 单元,直接执行位于 incudal 服务用户**可写目录**中的 JS/脚本;
且 incudal 用户被授予免密 `systemctl start` 该单元 → 后端/扩展代码/incudal 账号一旦被攻破,即可替换 root 单元执行的脚本,拿到完整 root。

## 目标(fix direction)
root helper/单元只执行**root 拥有、且服务用户不可写**的固定入口与"已验证产物";切断"服务用户可写 → root 执行"的链路。

## 要做（先只读通读 scripts/install-panel.sh 全文 与 deploy/*.service*.example / deploy/*.sh,弄清 OTA/在线更新单元怎么装、执行什么路径、sudoers 授了什么）
产出**加固改动草案**(改 deploy/ 与 scripts/install-panel.sh 里对应片段),满足:
1. root 单元(ExecStart)执行的目标改为 **root:root 拥有、chmod 0755(服务用户无写权)** 的固定路径(如 /opt/incudal/bin/ 下的受控入口),而非 incudal 可写的 releases/current 工作目录里的任意 JS。
2. 若必须在更新时运行仓库产物,先由 root helper **校验产物完整性/来源**(复用现有 OTA 的 sha256/tag 校验思路)再执行,且执行体本身 root 拥有。
3. sudoers 收紧:incudal 只能免密执行**特定的、参数受限的**单元/命令(NOPASSWD 限定到具体 unit 与动作,不给宽泛 systemctl)。
4. 安装脚本里对相关目录/文件设置正确 owner/权限(chown root:root + chmod 去掉 group/other 写),并在文档/注释里写清。
5. **不破坏**现有安装与 OTA 正常流程:改动要与现有目录布局(/opt/incudal/releases/<ver>、current 软链)兼容。

## 交付物(不执行任何安装/上线动作)
- 具体 diff(deploy + install-panel.sh)。
- 一份 `audits/fixes/FX-008-owner-steps.md`:owner 在**现网**升级到该加固版时需要做的手动步骤(chown/chmod/sudoers 更新、验证命令、回滚方式),因为纯文件 diff 不会自动纠正已部署机器上的既有权限。
- 明确标注:本改动**未也无法在本机验证**(无 systemd/root),需 owner 在预发/演练环境按步骤验证后再上生产。

## 铁律
不 commit;不执行 install-panel.sh / systemctl / 任何安装动作;不动业务代码;不做大重构。此条属高危 OTA/部署区,只产出草案与步骤。
