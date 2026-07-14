import { IProxyStrategy, ProxyDeviceResult, ProxyDeviceConfig, NamedProxyDeviceConfig } from './IProxyStrategy.js';

// Incus 的 proxy device 默认由 incusd fork 出一个独立的 forkproxy 进程来搬运流量：
// 每个端口映射一个进程，每个 ~10-30 MB RSS。宿主机上实例一多，光 forkproxy 就能吃掉几百 MB
// （实测：12 个映射 ≈ 360 MB）。
//
// nat=true 让 Incus 改用内核 nftables DNAT：零用户态进程、零常驻内存，顺带保留真实客户端 IP。
// 但它有前提，不满足时 Incus 会直接拒绝创建设备：
//   1. 实例网卡必须有静态 IP —— 本项目的 NAT 模式实例在 eth0 上都设了 ipv4.address；
//   2. listen 必须是宿主机上的一个具体地址 —— 0.0.0.0 / [::] 这类通配监听不行。
//
// 因此只在「IPv4 NAT 模式 + 拿得到宿主机具体 IPv4」时开启；其余情况保持原来的 forkproxy。
// 绝不为了省内存把端口映射变成创建失败 —— KvmProxyStrategy 里的
// `if (hostNatIp && hostNatIp !== '0.0.0.0')` 就是同一个约束。
const IPV4_NAT_NETWORK_MODES = ['nat', 'nat_ipv6', 'nat_ipv6_nat'];

function isConcreteHostIpv4(address: string | null | undefined): address is string {
    return Boolean(address) && address !== '0.0.0.0';
}

export class LxcProxyStrategy implements IProxyStrategy {
    createProxyDevice(
        _hostNatIp: string | null | undefined,
        hostIpv6: string | null | undefined,
        networkMode: string,
        protocol: string,
        publicPort: number,
        privatePort: number
    ): ProxyDeviceResult {
        // nat_ipv6_nat：原来用单个 [::] 设备做双栈监听。[::] 是通配监听，开不了 NAT，
        // 因此拆成两个设备 —— IPv4 走内核 NAT（零进程），IPv6 仍走 forkproxy。与 KVM 一致。
        if (networkMode === 'nat_ipv6_nat') {
            if (isConcreteHostIpv4(_hostNatIp)) {
                const deviceConfigs: NamedProxyDeviceConfig[] = [{
                    deviceConfig: {
                        type: 'proxy',
                        listen: `${protocol}:${_hostNatIp}:${publicPort}`,
                        connect: `${protocol}:0.0.0.0:${privatePort}`,
                        nat: 'true'
                    }
                }];

                if (hostIpv6) {
                    deviceConfigs.push({
                        nameSuffix: '-v6',
                        deviceConfig: {
                            type: 'proxy',
                            listen: `${protocol}:[${hostIpv6}]:${publicPort}`,
                            connect: `${protocol}:0.0.0.0:${privatePort}`
                        }
                    });
                }

                return { success: true, deviceConfigs };
            }

            // 拿不到宿主机具体 IPv4：退回原来的单设备 [::] 双栈监听（forkproxy）。
            return {
                success: true,
                deviceConfig: {
                    type: 'proxy',
                    listen: `${protocol}:[::]:${publicPort}`,
                    connect: `${protocol}:0.0.0.0:${privatePort}`
                }
            };
        }

        let listenAddr: string;

        // 若要求带有内部 IPv6 穿透的规则，强迫提取确切外部地址保护通配符监听错误
        if (['ipv6_only', 'ipv6_nat'].includes(networkMode)) {
            if (!hostIpv6) {
                return { success: false, errorMessage: '当前所在节点暂无任何公网 IPv6 记录！请通知管理员在节点设置中补充【公网 IPv6 或 NAT IPv6 地址】，否则无法穿透映射。' };
            }
            listenAddr = `[${hostIpv6}]`;
        } else {
            listenAddr = _hostNatIp || '0.0.0.0';
        }

        // 普通情况下连接使用 0.0.0.0 自适应服务监听源；仅在仅含 IPv6 及无内网 V4 桥池的极端环境启用 [::] 防止 ECONNRESET
        const connectAddr = ['ipv6_only', 'ipv6_nat'].includes(networkMode) ? '[::]' : '0.0.0.0';

        const deviceConfig: ProxyDeviceConfig = {
            type: 'proxy',
            listen: `${protocol}:${listenAddr}:${publicPort}`,
            connect: `${protocol}:${connectAddr}:${privatePort}`
        };

        // IPv4 NAT 模式 + 具体监听地址 → 交给内核 nftables DNAT，省掉一个常驻 forkproxy 进程。
        if (IPV4_NAT_NETWORK_MODES.includes(networkMode) && isConcreteHostIpv4(_hostNatIp)) {
            deviceConfig.nat = 'true';
        }

        return { success: true, deviceConfig };
    }
}
