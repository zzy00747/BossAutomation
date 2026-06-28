# Boss 直聘 API 字段映射

本文件记录 TypeScript Agent 直接请求的 Boss 直聘 wapi 端点、请求参数与响应字段映射。任何涉及端点、请求参数、响应字段的代码修改，必须同步更新本文件（项目宪法第 5 条）。

URL 模板与选择器源码：`src/platform/boss/urls.ts`、`src/platform/boss/selectors.ts`。

## 基础

- **Base URL**：`https://www.zhipin.com`
- **直接 API 请求必须带 `Referer`**：缺少 `Referer: https://www.zhipin.com/` 易被风控返回 403。
- **`__zp_stoken__` 为 HttpOnly**：必须用 Playwright `context.cookies()` 读取，`document.cookie` 读不到。
- 请求头构造：`BossRequestBuilder.buildHeaders()`，含 Host、User-Agent、Accept、Accept-Language、Referer、Origin、X-Requested-With、Cookie、Sec-Fetch-*。

## 端点列表

| 端点 | URL | 方法 | 说明 |
|------|-----|------|------|
| 推荐职位列表 | `/wapi/zpgeek/pc/recommend/job/list.json` | GET | 推荐流，返回 `encryptJobId` |
| 职位详情 | `/wapi/zpgeek/job/detail.json` | GET | 需 `encryptJobId` + `lid`，返回含 `securityId` 的 `zpData` |
| 打招呼/沟通 | `/wapi/zpgeek/friend/add.json` | GET | 需要 `securityId` + `jobId` |
| security-check | `/web/common/security-check.html` | GET (页面) | 刷新 `__zp_stoken__` Cookie |
| QR randkey | `/wapi/zppassport/captcha/randkey` | POST | 获取 qrId |
| QR 二维码 | `/wapi/zpweixin/qrcode/getqrcode` | GET | 生成二维码图片 |
| QR 扫码状态 | `/wapi/zppassport/qrcode/scan` | GET | 轮询扫码状态 |
| QR 确认登录 | `/wapi/zppassport/qrcode/scanLogin` | GET | 轮询用户确认 |
| QR dispatcher | `/wapi/zppassport/qrcode/dispatcher` | GET | 换取登录态 Cookie，需 `qrId/pk/fp` |

## 推荐职位列表

- **请求参数**：`page`、`pageSize`、`cursor`、`experience`、`jobType`、`salary`、`encryptExpectId`、`_`(时间戳)。
- **响应**：
  ```jsonc
  {
    "code": 0,
    "message": "OK",
    "zpData": {
      "jobList": [/* RecommendJobItem */],
      "hasMore": true,
      "cursor": "cursor-1",
      "total": 100
    }
  }
  ```
- **字段映射**（`normalizeJob`，源 `src/platform/boss/normalize.ts`）：

| 规范化字段 | 候选原始字段（按优先级） |
|-----------|------------------------|
| `encryptJobId` | `encryptJobId` → `jobId` → `encryptId` → `id` → 从 `jobDetailUrl`/`detailUrl` 提取 |
| `securityId` | `securityId` → `encryptSecurityId` → `secId` |
| `encryptBossId` | `encryptBossId` → `bossId` |
| `lid` | `lid` → `lId` → `listId` |
| `jobName` | `jobName` → `title` → `name`（缺失则为「未知职位」） |
| `skills` | `skills`（数组，过滤空值） |
| `jobDetailUrl` | `jobDetailUrl` → `detailUrl` |

> 注意：推荐列表**只返回 `encryptJobId`，不含 `securityId`**；`securityId` 必须从详情接口获取。

## 职位详情

- **请求参数**：`encryptJobId`、`lid`（可选但实测必需，缺失返回 `code: 17 缺少必要参数`）、`_`(时间戳)。
- **响应**：
  ```jsonc
  {
    "code": 0,
    "zpData": {
      "encryptJobId": "...",
      "securityId": "...",
      "postDescription": "...",
      "brandName": "...",
      "skills": ["..."],
      "welfareList": ["..."]
    }
  }
  ```
- **缺失 `postDescription` 时抛 `BossAPIError('职位详情数据缺失')`。**

## 打招呼/沟通

- **请求参数**：`securityId`、`jobId`（即 `encryptJobId`）。
- **响应**：`{ code, message, zpData }`，`code === 0` 视为成功。
- `code === 3001` 或 HTTP 401 视为登录态过期。

## 风控与错误码

`BossAPIClient.requestWithSecurityCheck()` + `assertOk()` 的错误分类（`src/platform/boss/api.ts`）：

| HTTP status / 业务 code | 含义 | 处理 |
|------------------------|------|------|
| `code === 0` 且 2xx | 成功 | 正常返回 |
| HTTP 401 或 `code === 3001` | 登录态过期 | 抛 `BossAPIError`，上层触发会话刷新 |
| HTTP 403 或 `code === 403` | 风控拒绝 | 抛 `BossAPIError`，触发人工介入 |
| HTTP 429 或 `code === 429` | 请求限流 | 抛 `BossAPIError`，退避降速 |
| `code === 37` | 环境异常，需刷新 stoken | 见下方 |
| 其他 | 业务错误 | 抛 `BossAPIError`，携带 message |

### code 37 动态刷新

当响应 `code === 37` 且 `zpData` 含 `seed/name/ts` 时：

1. 提取 `{ seed: string, name: string, ts: number }`（`extractSecurityCheckPayload`）。
2. 调用注入的 `SecurityCheckHandler.refreshStoken(payload)`（`BrowserSecurityCheckHandler`）：
   - 构造 `https://www.zhipin.com/web/common/security-check.html?seed=...&name=...&ts=...&callbackUrl=...`。
   - `page.goto(url, { waitUntil: 'networkidle' })` + 延时。
   - 从 `context.cookies('https://www.zhipin.com')` 检查 `__zp_stoken__` 是否刷新成功。
3. 刷新成功 → 用新 Cookie 重试一次原请求。
4. 刷新失败或未注入 handler → 抛 `BossAPIError(code=37)`，由上层分类重试。

> **seed 必须用本次响应返回的新值**，不能复用旧 seed；`__zp_stoken__` 为 HttpOnly，必须用 `context.cookies()` 读取。

## QR 登录 Cookie 收集

`BossQRLoginService.getDispatcherCookie()`：

- 优先从浏览器 `context.cookies('https://www.zhipin.com')` 读取真实 Cookie（含 HttpOnly），并回填到 `cookieJar`。
- 仅对 context 未覆盖的字段回退到手工 `cookieJar`。
- 这样即使 dispatcher 的 HTTP `Set-Cookie` 未被 Node `fetch` 写入 cookieJar，也能拿到浏览器已有的登录态 Cookie，避免 `cookies` 为空字符串判定登录失败。
