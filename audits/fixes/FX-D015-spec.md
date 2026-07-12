# FX-D015 规格：批量端口映射绕过配额与端口范围(P1 / D-015 / M13-02)

## 根因
`server/src/routes/instances.ts:4721,4749` 端口映射配额按 `privatePortStart/End` 计算,但当请求传 `portMappings` 数组时直接采用任意长度数组,绕过 NAT 端口范围校验,且 schema 无 `maxItems`。租户可声明 1 个端口却提交大量任意公网端口映射 → 绕配额 + 暴露宿主保留端口。

## 修法(只改 instances.ts 端口映射相关 + 其 schema + 守卫;不碰 ip-addresses/ipv6-subnets(并行)、不改 package.json)
1. 先只读:portMappings 的 schema 定义、当前配额如何算(privatePortStart/End 与套餐端口配额)、NAT 端口允许范围/宿主保留端口从哪来。
2. **统一以最终映射数组为准校验**:
   - 数量:`portMappings.length` 计入配额(取代只按 start/end 段),超套餐端口配额→400;schema 加合理 `maxItems`(与配额上限一致或更严)。
   - 唯一性:内部端口、外部端口各自去重,重复→400。
   - 端口范围:内/外端口都落在允许的 NAT 范围内、不落宿主保留端口→否则 400。
   - 两种入参(privatePortStart/End 段 与 显式 portMappings 数组)统一归一到"最终映射列表"再做上述校验,不允许任一路径绕过。
3. 保持既有正常单端口/段映射行为不回归。

## 加守卫
在实例/端口相关现有守卫追加:超量 portMappings 被拒、重复端口被拒、越界端口被拒、配额按最终数计。不改 package.json。

## 不许动
不碰 ip-addresses.ts / db/ipv6-subnets.ts(并行 FX-D016)。不做大重构。不 commit。

## 验收
pnpm --filter server type-check 通过;相关实例/端口守卫通过。交付一段话:配额口径、maxItems、范围/唯一校验、守卫结果。
