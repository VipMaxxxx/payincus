import { IProxyStrategy, ProxyDeviceResult, ProxyDeviceConfig } from './IProxyStrategy.js';

export class LxcProxyStrategy implements IProxyStrategy {
    createProxyDevice(
        _hostNatIp: string | null | undefined,
        hostIpv6: string | null | undefined,
        networkMode: string,
        protocol: string,
        publicPort: number,
        privatePort: number
    ): ProxyDeviceResult {
        let listenAddr: string;

        // 若要求带有内部 IPv6 穿透的规则，强迫提取确切外部地址保护通配符监听错误
        if (['ipv6_only', 'ipv6_nat'].includes(networkMode)) {
            if (!hostIpv6) {
                return { success: false, errorMessage: '当前所在节点暂无任何公网 IPv6 记录！请通知管理员在节点设置中补充【公网 IPv6 或 NAT IPv6 地址】，否则无法穿透映射。' };
            }
            listenAddr = `[${hostIpv6}]`;
        } else if (networkMode === 'nat_ipv6_nat') {
            // 当启用 IPv4 NAT 及 IPv6 NAT 的混合代理模式时，必须使用 [::] 来确保双栈监听而不单单是 0.0.0.0
            listenAddr = '[::]';
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

        return { success: true, deviceConfig };
    }
}
