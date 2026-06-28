# 已知问题与易错点

## 2026-06-28 Zod union + transform 解析 LLM JSON 失败

- **现象**：用 `z.union([schemaA.transform(...), schemaB.transform(...)])` 同时兼容 camelCase / snake_case 的 LLM 输出时，合法输入（如 `redFlags: []`）被判定为 `Invalid input`，导致 screener 全部降级到关键词 fallback。
- **根因**：Zod 的 `z.union` 对两个都含 `.transform` 的对象 schema 存在歧义解析——它会尝试每个分支但 transform 改变了类型，导致空数组等边界值匹配失败。错误信息（`[] Invalid input`）也未暴露具体字段，难以定位。
- **解决**：放弃 union-of-transforms，改为 `z.preprocess(normalizeKeys, camelCaseSchema)`：先用 preprocess 把 snake_case 键统一转 camelCase，再喂给单一对象 schema 校验。键映射用纯对象查表，不依赖 union。
- **预防**：LLM 返回的是**字符串**（`response.content`），parse 时必须先 `JSON.parse` 再过 schema；schema 函数应同时接受 string 与 object。验证 LLM 链路时，先用 `parseScreenResult(JSON.stringify(fixture))` 单独跑通，再接入 screener，可快速隔离“解析失败”与“未调用 LLM”两类问题。

## 2026-06-28 Anthropic SDK create 返回类型为联合类型

- **现象**：`anthropic.messages.create(...)` 在 TypeScript strict 下返回 `(Stream<...> & {...}) | (Message & {...})`，直接访问 `.content` / `.usage` 报错 `Property does not exist on type Stream`。
- **根因**：SDK 的 `create` 同时支持流式与非流式，返回联合类型；TypeScript 无法从参数推断出非流式分支。
- **解决**：对返回值显式断言 `as Anthropic.Message`（先经 `as unknown as MessageCreateParams` 转入参）。
- **预防**：调用 LLM SDK 时优先查返回类型；遇到 union+stream 类型，显式断言非流式分支，避免 noUncheckedIndexedAccess / strict 下的误报。

## 2026-06-28 Dry-run 真实环境验证发现的问题汇总

### 1. `src/main.ts` 入口判断在 `tsx` 下失效

- **现象**：运行 `npm run dev`（`tsx src/main.ts`）时，`main()` 未被调用，进程无输出地挂起或立即退出。
- **根因**：原入口判断使用 `path.resolve(process.argv[1]) === path.resolve(__filename)`，在 `tsx` 等 loader 下 `__filename` 与 `process.argv[1]` 不一致，导致 `isDirectEntry` 为 false。
- **解决**：改用 `import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href` 判断。
- **预防**：CLI 入口判断优先使用 `import.meta.url` 与 `pathToFileURL`，兼容 tsx/ts-node/编译后二进制多种启动方式。

### 2. 详情 API 缺少 `lid` 参数

- **现象**：`BossAPIClient.getJobDetail` 调用 Boss 直聘详情接口返回 `code: 17, message: 缺少必要参数`。
- **根因**：URL 只带了 `encryptJobId`，实际接口还需要推荐列表返回的 `lid`。
- **解决**：`getJobDetailApiUrl` 增加可选 `lid` 参数，`getJobDetail` 传入 `job.lid`。
- **预防**：Boss 直聘不同接口对同一职位要求的参数不同，务必以实际响应/浏览器网络请求为准，维护 `docs/api-field-mapping.md`。

### 3. HTML 详情 `page.evaluate` 因 tsx 转译报错 `__name is not defined`

- **现象**：`JobDetailService.getDetailFromHTML` 中 `page.evaluate(() => { ... })` 在真实浏览器上下文执行时报 `ReferenceError: __name is not defined`。
- **根因**：tsx/esbuild 转译 TypeScript 箭头函数时可能注入 `__name` 辅助函数，但浏览器页面上下文没有该辅助函数。
- **解决**：将 evaluate 函数体改为字符串传入，避免 tsx 转译引入辅助函数；同时放宽 `IPage.evaluate` 类型为 `string | function`。
- **预防**：在 Playwright `page.evaluate` 中避免复杂 TypeScript 类型/局部函数；对需要在页面上下文执行的代码使用字符串函数体或独立 JS 文件。

### 4. security-check 页面禁止读取 `document.cookie`

- **现象**：二维码登录流程访问 `security-check.html` 后，通过 `page.evaluate(() => document.cookie)` 读取 Cookie 抛 `SecurityError: Access is denied for this document`。
- **根因**：security-check 页面为跨域/安全限制页面，禁止 JS 读取 document.cookie。
- **解决**：不再读取 JS cookie，改从 `context.cookies('https://www.zhipin.com')` 直接获取 `__zp_stoken__`。
- **预防**：HttpOnly / 安全限制页面应优先使用 Playwright `context.cookies()`，而非 `document.cookie`。

### 5. SessionManager 运行中 reconnectCDP 会断开整个浏览器上下文

- **现象**：流水线运行期间一旦 `checkLoginState` 失败，`refreshSession` 调用 `reconnectCDP()`，先 `disconnect()` 再 `connect()`，导致 DetailFetcher 等 worker 持有的 page/context 全部失效。
- **根因**：`reconnectCDP` 作为刷新登录态的默认手段过于激进。
- **解决**：`refreshSession` 优先尝试 `page.goto(LOGIN_PAGE_URL)` 轻量刷新；仅当 page 无效时才回退到 `reconnectCDP`。
- **预防**：流水线运行期间避免主动断开浏览器；登录态刷新应优先页面 reload，重连作为最后手段。

### 6. 连续/高频请求触发 `code 37 您的环境存在异常`

- **现象**：第一个搜索配置成功，第二个搜索配置或详情 API 返回 `code: 37, message: 您的环境存在异常`，响应体含 `seed/name/ts`。
- **根因**：Boss 直聘安全校验 `__zp_stoken__` 具有时效性，连续请求会触发风控要求刷新 stoken。
- **解决**：已在 `BossAPIClient` 实现 code 37 动态刷新：检测到 `code === 37` 且响应 `zpData` 含 `seed/name/ts` 时，调用注入的 `SecurityCheckHandler`（`BrowserSecurityCheckHandler`）访问 `security-check.html` 刷新 `__zp_stoken__` Cookie，刷新成功后自动重试一次原请求。刷新失败或未注入 handler 时抛 `BossAPIError(code=37)` 由上层分类重试处理。
- **预防**：Boss 直聘风控要求刷新 stoken 时会返回 `seed/name/ts`，需以这三个参数构造 `security-check.html` URL 才能正确刷新，不能复用旧 seed。`__zp_stoken__` 为 HttpOnly，必须用 `context.cookies()` 读取。

### 7. 二维码登录 dispatcher 后 cookieJar 为空

- **现象**：二维码登录扫码、确认、dispatcher 均成功，security-check 也拿到 stoken，但 `loginWithQR` 判断 `result.cookies` 为空字符串，判定登录失败。
- **根因**：`BossQRLoginService.getDispatcherCookie` 仅从手工维护的 `this.cookieJar` 拼接 Cookie，但 dispatcher 的 HTTP 响应 `Set-Cookie` 未被 Node `fetch` 写入 cookieJar（部分登录态 Cookie 由浏览器上下文持有，且可能是 HttpOnly），导致拼接结果为空。
- **解决**：`getDispatcherCookie` 改为优先从浏览器 `context.cookies('https://www.zhipin.com')` 读取真实 Cookie（含 HttpOnly），并回填到 cookieJar；仅对 context 未覆盖的字段回退到 cookieJar。这样即使 HTTP `Set-Cookie` 为空，也能拿到浏览器已有的登录态 Cookie。
- **预防**：QR 登录兜底涉及 HttpOnly Cookie，应优先使用 Playwright `context.cookies()` 而非手工维护 cookieJar。CDP 优先模式下通常不需要 QR 登录。
