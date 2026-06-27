---
name: playwright-login
description: |
  当你需要处理 Boss 直聘登录态、首次登录、会话过期重登、CDP 连接失败或二维码登录时必须使用本 Skill。
  任何涉及 Cookie 恢复、CDP 端口探测、security-check、fp 参数、__zp_stoken__ 的代码改动，都应该先读此 Skill。
compatibility: |
  需要 Playwright + Chromium，以及可以访问的 Boss 直聘账号（已登录 Chrome 或准备扫码登录）。
---

# Skill: Playwright 登录处理

## 用途

Boss 直聘的登录态复杂且容易过期（通常 2-4 小时）。本 Skill 规范了从 Cookie 恢复、CDP 连接、到二维码登录兜底的完整流程，确保登录逻辑可复现、可测试、不硬编码 Cookie。

## 何时使用

- 实现或修改登录相关代码（`src/platform/boss/auth.ts`、`session-manager.ts`）
- 浏览器启动后需要确认是否已登录
- Cookie 过期需要自动刷新或重新登录
- CDP 连接失败，需要降级到二维码登录
- 需要获取或刷新 `__zp_stoken__` 时

## 标准登录流程

```text
检查 data/session/boss.json 是否存在有效 Cookie
    ↓ 有
尝试用 storage_state 恢复会话
    ↓ 成功且未过期
完成
    ↓ 失败/过期
尝试 CDP 连接（端口 9222 → 9229 → 19222）
    ↓ 成功
检查登录态，保存 Cookie
    ↓ 失败
启动二维码登录
    ↓ 扫码确认后
生成 fp 参数 → 调用 dispatcher → 访问 security-check.html 获取 __zp_stoken__
    ↓ 成功
保存 Cookie 到 data/session/boss.json
```

## 步骤

1. **检查本地 session 文件**
   - 读取 `data/session/boss.json`。
   - 如果存在且未过期，使用 `context.addCookies()` 或 `browser.newContext({ storageState })` 恢复。

2. **验证登录态**
   - 访问 `https://www.zhipin.com`。
   - 检查 DOM 中是否存在 `.user-nav`、`.nav-figure`、`.menu-list`、`.btn-post-job` 等登录态元素。
   - 也可调用轻量 API（如推荐职位列表）探针确认。

3. **尝试 CDP 连接**
   - 依次尝试端口：`9222` → `9229` → `19222`。
   - 使用 `playwright.chromium.connect_over_cdp(cdpUrl)`。
   - 若失败且系统 Chrome 未启动，尝试自动启动系统 Chrome 并带 `--remote-debugging-port=9222`。

4. **CDP 失败时启动二维码登录**
   - 启动裸 Chromium。
   - 调用 `/wapi/zppassport/captcha/randkey` 获取 `qrId`。
   - 生成二维码图片并展示给用户扫码。
   - 长轮询 `/wapi/zppassport/qrcode/scan` 和 `/wapi/zppassport/qrcode/scanLogin`。

5. **获取 `__zp_stoken__`**
   - 生成 `fp` 参数（AES-128-CBC/PKCS7）。
   - 调用 `/wapi/zppassport/qrcode/dispatcher` 获取初始 Cookie。
   - 访问 `security-check.html`，从页面或 Cookie 中提取 `__zp_stoken__`。

6. **保存会话**
   - 使用 `context.storageState({ path: 'data/session/boss.json' })` 保存。
   - 更新内存中的登录状态缓存。

## 示例

### 用 storage_state 恢复会话

```ts
const context = await browser.newContext({
  storageState: 'data/session/boss.json',
});
const page = await context.newPage();
await page.goto('https://www.zhipin.com');

const isLoggedIn = await page.locator('.user-nav').count() > 0;
if (!isLoggedIn) {
  // 进入 CDP 或 QR 登录流程
}
```

### CDP 连接

```ts
const browser = await chromium.connect_over_cdp('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] || await context.newPage();
```

## 输出

- `data/session/boss.json` 包含有效的 storage_state / Cookie。
- `src/platform/boss/auth.ts` 和 `session-manager.ts` 中登录/刷新逻辑正确。
- 登录成功或失败的日志与截图。

## 易错点检查清单

- [ ] Cookie 有效期通常只有 2-4 小时，运行时需定期检查。
- [ ] CDP 端口探测顺序固定为 `9222 → 9229 → 19222`。
- [ ] 如果 Chrome 已经在运行但没有 `--remote-debugging-port`，需要先关闭再重启。
- [ ] 二维码登录时必须正确生成 `fp` 参数，否则 dispatcher 会失败。
- [ ] `__zp_stoken__` 获取后要验证其是否已写入 Cookie。
- [ ] 不要把 Cookie 字符串硬编码到代码中，只能通过 `.env` 或 session 文件读取。
- [ ] 登录失败时要有截图和明确的日志，便于排查。
