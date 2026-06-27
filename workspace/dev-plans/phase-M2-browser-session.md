# M2 浏览器与会话管理

## 目标

构建浏览器驱动层，实现 CDP 连接、自动启动 Chrome、页面池、人类行为模拟、反检测、验证码检测，以及登录态检查/刷新/QR 兜底，为后续职位抓取提供稳定、可复用的浏览器环境。

## 参考来源

- `workspace/ZhipinPlan.md`：登录模块详细设计、验证码检测模块、内存管理、反检测与合规策略

## 依赖前置阶段

- M1 项目脚手架与抽象接口

## 交付物

- `src/browser/manager.ts`：CDP/自动启动/fallback
- `src/browser/page-pool.ts`：并发页面控制
- `src/browser/human-actions.ts`：人形行为
- `src/browser/stealth.ts`：反检测脚本
- `src/browser/verification.ts`：验证码检测与暂停
- `src/platform/boss/auth.ts`：登录态检查与 CDP 登录
- `src/platform/boss/session-manager.ts`：登录态过期检测与刷新
- QR 登录兜底：`fingerprint.ts`、`security-check.ts`、`scripts/login-qr.ts`

## 本阶段子任务

| 任务 ID | 任务名称 | 需要创建/修改的文件 | 依赖 | 验收要点 |
|---------|---------|-------------------|------|---------|
| M2-T1 | BrowserManager（CDP/自动启动/fallback） | `src/browser/manager.ts`、测试 | M1-T2, M1-T4 | 连接 9222、自动启动 Chrome、fallback Chromium、自动重启 |
| M2-T2 | PagePool 页面池 | `src/browser/page-pool.ts`、测试 | M1-T2, M2-T1 | 最大 3 并发、acquire/release |
| M2-T3 | 人类行为模拟 | `src/browser/human-actions.ts`、测试 | M1-T2 | 贝塞尔鼠标、随机停顿、分段滚动 |
| M2-T4 | 反检测 Stealth 注入 | `src/browser/stealth.ts`、测试 | M1-T2 | 覆盖 webdriver/plugins/chrome/Permissions/Canvas/WebGL |
| M2-T5 | 验证码检测与暂停 | `src/browser/verification.ts`、测试 | M1-T2, M1-T4 | 检测选择器/文本、截图、暂停等待 |
| M2-T6 | 登录态检查与 CDP 登录脚本 | `src/platform/boss/auth.ts`、`selectors.ts`、`urls.ts`、`scripts/login.ts` | M2-T1, M2-T5 | DOM/API 检查、保存 session |
| M2-T7 | 二维码登录兜底（fp、security-check） | `src/platform/boss/fingerprint.ts`、`security-check.ts`、`scripts/login-qr.ts` | M2-T6 | AES fp、QR 流程、stoken 获取 |
| M2-T8 | SessionManager 过期检测与自动刷新 | `src/platform/boss/session-manager.ts`、测试 | M2-T6, M2-T7 | 缓存检查、三级刷新策略、回调 |

## 阶段内依赖关系

```text
M2-T1 → M2-T2
M2-T1, M2-T5 → M2-T6
M2-T6 → M2-T7
M2-T6, M2-T7 → M2-T8
M2-T3/T4 可并行
```

## 执行建议

1. M2-T1/T2 是浏览器层基础，建议先做；M2-T3/T4/T5 可并行。
2. M2-T6 完成后，可立即开始 M2-T7/T8。
3. 所有真实浏览器/CDP 相关测试建议作为浏览器集成测试，普通单元测试使用 Mock。
4. 子 Agent Prompt 见 `tasks.json` 对应 `id` 的 `prompt` 字段。

## 阶段验收标准

- `scripts/login.ts` 能连接 CDP 并检测登录态
- `scripts/login-qr.ts` 能启动并展示二维码（如未登录）
- 验证码检测单元测试通过
- SessionManager 的缓存/刷新策略单元测试通过
- `npm run test:unit` 全部通过
