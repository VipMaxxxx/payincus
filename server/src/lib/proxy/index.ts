import { IProxyStrategy } from './IProxyStrategy.js';
import { LxcProxyStrategy } from './LxcProxyStrategy.js';
import { KvmProxyStrategy } from './KvmProxyStrategy.js';

export class ProxyStrategyFactory {
    static getStrategy(instanceType: string | undefined): IProxyStrategy {
        if (instanceType === 'virtual-machine' || instanceType === 'kvm') {
            return new KvmProxyStrategy();
        }
        return new LxcProxyStrategy();
    }
}

export * from './IProxyStrategy.js';
