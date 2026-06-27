---
name: api-reverse
description: |
  当你需要搞清楚 Boss 直聘某个 API 的完整参数、请求头或响应结构时必须使用本 Skill。
  触发场景包括但不限于：新增 API 调用、推荐列表/详情/打招呼接口字段不确定、翻页参数变化、
  接口返回异常、需要验证 Cookie/Header 是否完整。不要凭记忆猜测字段名，先反向工程。
compatibility: |
  需要已安装 Playwright 并可以连接已登录 Boss 直聘的浏览器（CDP 或裸 Chromium）。
---

# Skill: API 反向工程

## 用途

Boss 直聘的 API 字段名、参数名、请求头要求经常变化（例如 `encryptJobId` 在不同接口中可能叫 `jobId`/`encryptId`/`id`，翻页可能是 `page` 也可能是 `cursor`）。本 Skill 指导你通过浏览器拦截真实请求，捕获一手数据，避免拍脑袋写死字段。

## 何时使用

- 新增任何调用 Boss 直聘 API 的代码前
- 现有 API 突然返回错误、字段缺失或数据结构变化时
- 不确定某个接口需要哪些 query params / headers / body 时
- 需要验证 `Referer`、`__zp_stoken__`、`zp_at` 等关键 Cookie 是否必须携带时
- 翻页逻辑异常，不确定是 `page` 还是 `cursor` 时

## 步骤

1. 使用 Playwright 打开目标页面（例如推荐职位页、职位详情页）。
2. 通过 `page.route()` 拦截所有匹配 `https://www.zhipin.com/wapi/**` 的网络请求。
3. 执行触发目标 API 的操作：搜索、翻页、点击职位卡片、点击打招呼按钮等。
4. 捕获请求信息：
   - HTTP 方法（GET / POST）
   - URL 与 query params
   - 请求头（重点看 `Referer`、`Cookie`、`X-Requested-With`、`Origin`）
   - 请求 body（POST 时）
   - 响应 JSON（重点关注 `code`、`zpData` / `data` 结构）
5. 将结果整理后记录到 `docs/api-field-mapping.md`。
6. 更新 `src/platform/boss/api.ts` 与 `src/types.ts` 中的类型定义。

## 示例

### 反向工程推荐职位列表接口

```ts
await page.route('**/wapi/zpgeek/pc/recommend/job/list.json*', route => {
  const request = route.request();
  console.log('URL:', request.url());
  console.log('Headers:', await request.allHeaders());
  route.continue();
});

await page.on('response', async response => {
  if (response.url().includes('/pc/recommend/job/list.json')) {
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  }
});
```

捕获后应提取：

| 字段 | 示例值 | 说明 |
|------|--------|------|
| `encryptJobId` | `abc123...` | 职位主键 |
| `securityId` | `def456...` | 打招呼所需令牌 |
| `page` / `cursor` | `2` / `lastId=xxx` | 翻页方式 |
| `experience` | `104` | 经验代码（中文映射见 `search-params.ts`） |

## 输出

- `docs/api-field-mapping.md` 中新增一条记录，包含：
  - 接口 URL
  - 方法
  - 必需请求头
  - 参数及示例值
  - 响应字段映射
  - 翻页方式
- `src/platform/boss/api.ts` 中新增/更新接口类型
- `src/types.ts` 中新增/更新 `JobListResponse`、`JobDetail` 等类型

## 易错点检查清单

- [ ] 区分 GET/POST，不要把 body 参数写到 query 里。
- [ ] `Referer` 必须与当前页面 URL 一致，否则可能被风控。
- [ ] `__zp_stoken__` 过期后请求会 401，需先通过 `security-check.html` 刷新。
- [ ] 翻页参数可能是 `page`、`cursor` 或 `lastId`，不要假设。
- [ ] 响应外层通常有 `code` 和 `zpData`，真正数据在 `zpData` 里。
- [ ] 同一字段在不同接口中名字可能不同，务必以实际响应为准。
