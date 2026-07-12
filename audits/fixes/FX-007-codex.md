已完成 FX-007，未 commit。超管口径复用 OTA 门禁 `canManageSystemUpdates` 的内建 owner 字段：`request.user.username === 'admin'`。PUT 请求只要包含任一四个高危白名单键，非 owner 即在校验和写库前整批返回 `403 / ErrorCode.FORBIDDEN`；普通配置及 `normalizeAdminIdCsv` 行为不变。守卫新增了四键集合、owner 判断、403 及写库前拒绝的源码断言。

验收全部通过：server type-check、system-config-value-guards、system-update-guards。仅修改了规格允许的两个文件。
