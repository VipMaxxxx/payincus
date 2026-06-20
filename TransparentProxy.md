针对 Incus/LXC 容器环境的 dae 透明代理。

这套方案实现了：宿主机自身流量直连、接管容器出站流量走出口节点、兼容容器入站端口映射、规避节点不支持 UDP 导致的断网。

---

### 部署流程 (适用于 Ubuntu 24.04 + Incus)

#### 第一步

默认情况下，Incus 容器网桥内的流量走的是二层转发，会绕过大多的网络层探针。为了让 `dae` 能抓到容器发出的 TCP 握手包，必须开启网桥的三层过滤。

在宿主机执行以下命令：

```bash
# 1. 确保 Incus 网桥保持默认的 NAT 开启状态 (保证入站映射正常)
incus network set incusbr0 ipv4.nat=true

# 2. 加载网桥过滤模块
sudo modprobe br_netfilter

# 3. 写入内核参数，强制网桥流量经过 iptables (进而被 dae 的 eBPF 探针捕获)
echo "net.bridge.bridge-nf-call-iptables = 1" | sudo tee /etc/sysctl.d/99-bridge-nf.conf
echo "net.bridge.bridge-nf-call-ip6tables = 1" | sudo tee -a /etc/sysctl.d/99-bridge-nf.conf
echo "net.bridge.bridge-nf-call-arptables = 1" | sudo tee -a /etc/sysctl.d/99-bridge-nf.conf

# 4. 生效配置
sudo sysctl -p /etc/sysctl.d/99-bridge-nf.conf
```

#### 第二步：安装 dae

```bash
sudo apt update && sudo apt install curl -y
sudo bash -c "$(curl -sL https://github.com/daeuniverse/dae-installer/raw/main/installer.sh)"
```

#### 第三步

清空并编辑 `/usr/local/etc/dae/config.dae`，将以下内容粘贴进去。

```dae
global {
  tproxy_port: 8321
  tproxy_port_protect: true
  wan_interface: auto

  # 绑定 Incus 网桥
  lan_interface: incusbr0

  auto_config_kernel_parameter: true
}

node {
  # 落地节点
  node1: ''
}

group {
  my_upstream {
    filter: name(node1)
    policy: fixed(0)
  }
}

dns {
  upstream {
    # 强制使用 tcp 协议查 DNS，完美解决代理节点不支持 UDP 导致的 DNS 解析超时黑洞
    cloudflare: 'tcp://1.1.1.1:53'
  }
  routing {
    request {
      fallback: cloudflare
    }
  }
}

routing {
  # 1. 内网互通与组播放行
  dip(224.0.0.0/3, 'ff00::/8') -> direct
  dip(geoip:private) -> direct

  # 2. 宿主机防失联 (SSH)
  dport(22, 2551) -> must_direct
  sport(22, 2551) -> must_direct

  # 3. 兼容 NAT 端口映射的回程放行
  sport(80, 443, 3306) -> must_direct

  # 4. 劫持容器网段
  sip(10.10.0.0/22) -> my_upstream

  # 5. 宿主机自身流量及未匹配流量兜底直连
  fallback: direct
}
```

#### 第四步：启动

```bash
sudo systemctl daemon-reload
sudo systemctl restart dae
sudo systemctl enable dae
```
