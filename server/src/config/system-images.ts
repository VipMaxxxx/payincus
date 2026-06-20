/**
 * 系统预定义镜像列表
 * 这些镜像可供用户创建实例使用
 * Incus 会在需要时自动从远程下载镜像
 */

export interface SystemImage {
    id: string           // 唯一标识，用于前端选择
    name: string         // 显示名称
    osType: string       // 操作系统类型
    remoteAlias: string  // LXC 远程镜像别名
    architecture: string // 架构
    icon: string         // 图标标识（发行版ID）
}

export const SYSTEM_IMAGES: SystemImage[] = [
    // AlmaLinux
    {
        id: 'almalinux-8-cloud',
        name: 'Almalinux 8 amd64',
        osType: 'Linux',
        remoteAlias: 'almalinux/8/cloud',
        architecture: 'x86_64',
        icon: 'almalinux'
    },
    {
        id: 'almalinux-9-cloud',
        name: 'Almalinux 9 amd64',
        osType: 'Linux',
        remoteAlias: 'almalinux/9/cloud',
        architecture: 'x86_64',
        icon: 'almalinux'
    },
    {
        id: 'almalinux-10-cloud',
        name: 'Almalinux 10 amd64',
        osType: 'Linux',
        remoteAlias: 'almalinux/10/cloud',
        architecture: 'x86_64',
        icon: 'almalinux'
    },
    // Alpine
    {
        id: 'alpine-3.19-cloud',
        name: 'Alpine 3.19 amd64',
        osType: 'Linux',
        remoteAlias: 'alpine/3.19/cloud',
        architecture: 'x86_64',
        icon: 'alpine'
    },
    {
        id: 'alpine-3.20-cloud',
        name: 'Alpine 3.20 amd64',
        osType: 'Linux',
        remoteAlias: 'alpine/3.20/cloud',
        architecture: 'x86_64',
        icon: 'alpine'
    },
    {
        id: 'alpine-3.21-cloud',
        name: 'Alpine 3.21 amd64',
        osType: 'Linux',
        remoteAlias: 'alpine/3.21/cloud',
        architecture: 'x86_64',
        icon: 'alpine'
    },
    {
        id: 'alpine-3.22-cloud',
        name: 'Alpine 3.22 amd64',
        osType: 'Linux',
        remoteAlias: 'alpine/3.22/cloud',
        architecture: 'x86_64',
        icon: 'alpine'
    },
    {
        id: 'alpine-3.23-cloud',
        name: 'Alpine 3.23 amd64',
        osType: 'Linux',
        remoteAlias: 'alpine/3.23/cloud',
        architecture: 'x86_64',
        icon: 'alpine'
    },
    {
        id: 'alpine-edge-cloud',
        name: 'Alpine edge amd64',
        osType: 'Linux',
        remoteAlias: 'alpine/edge/cloud',
        architecture: 'x86_64',
        icon: 'alpine'
    },
    // CentOS Stream
    {
        id: 'centos-9-stream-cloud',
        name: 'Centos 9-Stream amd64',
        osType: 'Linux',
        remoteAlias: 'centos/9-Stream/cloud',
        architecture: 'x86_64',
        icon: 'centos'
    },
    {
        id: 'centos-10-stream-cloud',
        name: 'Centos 10-Stream amd64',
        osType: 'Linux',
        remoteAlias: 'centos/10-Stream/cloud',
        architecture: 'x86_64',
        icon: 'centos'
    },
    // Debian
    {
        id: 'debian-11-cloud',
        name: 'Debian bullseye amd64',
        osType: 'Linux',
        remoteAlias: 'debian/11/cloud',
        architecture: 'x86_64',
        icon: 'debian'
    },
    {
        id: 'debian-12-cloud',
        name: 'Debian bookworm amd64',
        osType: 'Linux',
        remoteAlias: 'debian/12/cloud',
        architecture: 'x86_64',
        icon: 'debian'
    },
    {
        id: 'debian-13-cloud',
        name: 'Debian trixie amd64',
        osType: 'Linux',
        remoteAlias: 'debian/13/cloud',
        architecture: 'x86_64',
        icon: 'debian'
    },
    {
        id: 'debian-14-cloud',
        name: 'Debian forky amd64',
        osType: 'Linux',
        remoteAlias: 'debian/14/cloud',
        architecture: 'x86_64',
        icon: 'debian'
    },
    // Fedora
    {
        id: 'fedora-41-cloud',
        name: 'Fedora 41 amd64',
        osType: 'Linux',
        remoteAlias: 'fedora/41/cloud',
        architecture: 'x86_64',
        icon: 'fedora'
    },
    {
        id: 'fedora-42-cloud',
        name: 'Fedora 42 amd64',
        osType: 'Linux',
        remoteAlias: 'fedora/42/cloud',
        architecture: 'x86_64',
        icon: 'fedora'
    },
    {
        id: 'fedora-43-cloud',
        name: 'Fedora 43 amd64',
        osType: 'Linux',
        remoteAlias: 'fedora/43/cloud',
        architecture: 'x86_64',
        icon: 'fedora'
    },
    // Kali Linux
    {
        id: 'kali-current-cloud',
        name: 'Kali current amd64',
        osType: 'Linux',
        remoteAlias: 'kali/cloud',
        architecture: 'x86_64',
        icon: 'kali'
    },
    // openSUSE
    {
        id: 'opensuse-15.6-cloud',
        name: 'Opensuse 15.6 amd64',
        osType: 'Linux',
        remoteAlias: 'opensuse/15.6/cloud',
        architecture: 'x86_64',
        icon: 'opensuse'
    },
    {
        id: 'opensuse-16.0-cloud',
        name: 'Opensuse 16.0 amd64',
        osType: 'Linux',
        remoteAlias: 'opensuse/16.0/cloud',
        architecture: 'x86_64',
        icon: 'opensuse'
    },
    {
        id: 'opensuse-tumbleweed-cloud',
        name: 'Opensuse tumbleweed amd64',
        osType: 'Linux',
        remoteAlias: 'opensuse/tumbleweed/cloud',
        architecture: 'x86_64',
        icon: 'opensuse'
    },
    // Oracle Linux
    {
        id: 'oracle-8-cloud',
        name: 'Oracle 8 amd64',
        osType: 'Linux',
        remoteAlias: 'oracle/8/cloud',
        architecture: 'x86_64',
        icon: 'oracle'
    },
    {
        id: 'oracle-9-cloud',
        name: 'Oracle 9 amd64',
        osType: 'Linux',
        remoteAlias: 'oracle/9/cloud',
        architecture: 'x86_64',
        icon: 'oracle'
    },
    // Rocky Linux
    {
        id: 'rockylinux-8-cloud',
        name: 'Rockylinux 8 amd64',
        osType: 'Linux',
        remoteAlias: 'rockylinux/8/cloud',
        architecture: 'x86_64',
        icon: 'rockylinux'
    },
    {
        id: 'rockylinux-9-cloud',
        name: 'Rockylinux 9 amd64',
        osType: 'Linux',
        remoteAlias: 'rockylinux/9/cloud',
        architecture: 'x86_64',
        icon: 'rockylinux'
    },
    {
        id: 'rockylinux-10-cloud',
        name: 'Rockylinux 10 amd64',
        osType: 'Linux',
        remoteAlias: 'rockylinux/10/cloud',
        architecture: 'x86_64',
        icon: 'rockylinux'
    },
    // Ubuntu
    {
        id: 'ubuntu-25.04-cloud',
        name: 'Ubuntu plucky amd64',
        osType: 'Linux',
        remoteAlias: 'ubuntu/25.04/cloud',
        architecture: 'x86_64',
        icon: 'ubuntu'
    },
    {
        id: 'ubuntu-25.10-cloud',
        name: 'Ubuntu questing amd64',
        osType: 'Linux',
        remoteAlias: 'ubuntu/25.10/cloud',
        architecture: 'x86_64',
        icon: 'ubuntu'
    },
    {
        id: 'ubuntu-jammy-cloud',
        name: 'Ubuntu jammy amd64',
        osType: 'Linux',
        remoteAlias: 'ubuntu/jammy/cloud',
        architecture: 'x86_64',
        icon: 'ubuntu'
    },
    {
        id: 'ubuntu-noble-cloud',
        name: 'Ubuntu noble amd64',
        osType: 'Linux',
        remoteAlias: 'ubuntu/noble/cloud',
        architecture: 'x86_64',
        icon: 'ubuntu'
    }
]

/**
 * 通过 ID 获取系统镜像
 */
export function getSystemImageById(id: string): SystemImage | undefined {
    return SYSTEM_IMAGES.find(img => img.id === id)
}

/**
 * 通过远程别名获取系统镜像
 */
export function getSystemImageByRemoteAlias(remoteAlias: string): SystemImage | undefined {
    return SYSTEM_IMAGES.find(img => img.remoteAlias === remoteAlias)
}

/**
 * 生成本地别名（从远程别名）
 * e.g., "debian/12/cloud" -> "debian-12-cloud"
 */
export function generateLocalAlias(remoteAlias: string): string {
    return remoteAlias.replace(/[/\.]/g, '-').toLowerCase()
}
