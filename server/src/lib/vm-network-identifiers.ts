import { createHash } from 'node:crypto'

export interface VmNicMacs {
  eth0: string
  eth1: string
}

function formatMac(bytes: number[]): string {
  return bytes.map(byte => byte.toString(16).padStart(2, '0')).join(':')
}

function generateVmNicMac(seed: string, nicLabel: 'eth0' | 'eth1'): string {
  const hash = createHash('sha256')
    .update(`incudal-vm-nic:${seed}:${nicLabel}`)
    .digest()

  return formatMac([
    0x02,
    hash[0],
    hash[1],
    hash[2],
    hash[3],
    hash[4]
  ])
}

export function generateVmNicMacs(seed: string): VmNicMacs {
  return {
    eth0: generateVmNicMac(seed, 'eth0'),
    eth1: generateVmNicMac(seed, 'eth1')
  }
}
