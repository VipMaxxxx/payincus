// 「远程端口」= 用户连进实例用的那个端口：Linux 走 SSH(22)，Windows 走 RDP(3389)。
//
// 刻意做成零依赖的纯模块：守卫测试要直接调用 resolveRemotePrivatePort 验行为（而不是匹配字符串），
// 如果它和 instance-port-mapping.ts 放在一起，守卫 import 时会连带把 Prisma 拉起来并挂住进程。
export const REMOTE_PORT_SSH = 22
export const REMOTE_PORT_RDP = 3389

/**
 * 按镜像名判断实例的远程端口。判不出来时一律回落到 SSH —— 给 Linux 实例多一条 22 至少是可用的，
 * 给 Linux 实例发一条 3389 则是永远连不通的垃圾映射。
 */
export function resolveRemotePrivatePort(image: string | null | undefined): number {
  return /windows|win(?:10|11|server|2019|2022|2025)/i.test(String(image ?? ''))
    ? REMOTE_PORT_RDP
    : REMOTE_PORT_SSH
}
