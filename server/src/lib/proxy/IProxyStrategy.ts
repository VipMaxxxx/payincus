export interface ProxyDeviceConfig {
    type: string;
    listen: string;
    connect: string;
    nat?: string;
    security_mac_filtering?: string;
    [key: string]: string | undefined;
}

export interface NamedProxyDeviceConfig {
    nameSuffix?: string;
    deviceConfig: ProxyDeviceConfig;
}

export interface ProxyDeviceResult {
    success: boolean;
    errorMessage?: string;
    deviceConfig?: ProxyDeviceConfig;
    deviceConfigs?: NamedProxyDeviceConfig[];
}

export interface IProxyStrategy {
    createProxyDevice(
        hostNatIp: string | null | undefined,
        hostIpv6: string | null | undefined,
        networkMode: string,
        protocol: string,
        publicPort: number,
        privatePort: number
    ): ProxyDeviceResult;
}
