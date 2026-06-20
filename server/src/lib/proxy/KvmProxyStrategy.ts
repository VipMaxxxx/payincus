import { IProxyStrategy, ProxyDeviceResult, ProxyDeviceConfig, NamedProxyDeviceConfig } from './IProxyStrategy.js'

export class KvmProxyStrategy implements IProxyStrategy {
    createProxyDevice(
        hostNatIp: string | null | undefined,
        hostIpv6: string | null | undefined,
        networkMode: string,
        protocol: string,
        publicPort: number,
        privatePort: number
    ): ProxyDeviceResult {
        if (networkMode === 'nat_ipv6_nat') {
            const deviceConfigs: NamedProxyDeviceConfig[] = []

            if (hostNatIp && hostNatIp !== '0.0.0.0') {
                deviceConfigs.push({
                    deviceConfig: {
                        type: 'proxy',
                        listen: `${protocol}:${hostNatIp}:${publicPort}`,
                        connect: `${protocol}:0.0.0.0:${privatePort}`,
                        nat: 'true'
                    }
                })
            }

            if (hostIpv6) {
                deviceConfigs.push({
                    nameSuffix: '-v6',
                    deviceConfig: {
                        type: 'proxy',
                        listen: `${protocol}:[${hostIpv6}]:${publicPort}`,
                        connect: `${protocol}:0.0.0.0:${privatePort}`
                    }
                })
            }

            if (deviceConfigs.length === 0) {
                return {
                    success: false,
                    errorMessage: 'Current host has no usable NAT public IPv4 or IPv6 address for KVM port mapping.'
                }
            }

            return { success: true, deviceConfigs }
        }

        let listenAddr: string

        if (['ipv6_only', 'ipv6_nat'].includes(networkMode)) {
            if (!hostIpv6) {
                return {
                    success: false,
                    errorMessage: 'Current host has no public IPv6/NAT IPv6 configured for KVM port mapping.'
                }
            }
            listenAddr = `[${hostIpv6}]`
        } else {
            if (!hostNatIp || hostNatIp === '0.0.0.0') {
                return {
                    success: false,
                    errorMessage: 'Current host has no bindable IPv4 listen address for KVM port mapping. Please configure a local Listen IPv4 address in host NAT settings.'
                }
            }
            listenAddr = hostNatIp
        }

        const connectAddr = networkMode === 'ipv6_only' ? '[::]' : '0.0.0.0'

        const deviceConfig: ProxyDeviceConfig = {
            type: 'proxy',
            listen: `${protocol}:${listenAddr}:${publicPort}`,
            connect: `${protocol}:${connectAddr}:${privatePort}`
        }

        if (networkMode !== 'ipv6_nat') {
            deviceConfig.nat = 'true'
        }

        return { success: true, deviceConfig }
    }
}
