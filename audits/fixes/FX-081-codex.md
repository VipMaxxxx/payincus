已完成 FX-081：在 `terminal.ts` 中将连接成功审计和断开审计分别用局部 `try/catch` 隔离，日志失败只输出错误，不再关闭已建立终端，也不会产生未处理 Promise rejection；守卫已追加相应断言。服务端 type-check、两项指定守卫及 diff 检查均通过。未修改禁改文件，未 commit/push/发版。
