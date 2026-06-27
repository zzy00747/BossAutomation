# Boss 直聘自动投递 Agent —— 最终实施方案

## Context

用户希望构建一个基于 **Playwright 浏览器自动化 + LLM JD 筛选** 的 Boss 直聘自动投递 Agent。在原有 `boss-agent-staged-cascade.md` 方案基础上，参考了：

- `mucsb/mcp-bosszp`：求职者端登录流程、API 端点、`fp` 生成、`__zp_stoken__` 获取
- `Snseam/boss-zhipin-mcp`：招聘者端 CDP 浏览器管理、验证码检测、SQLite/JSON 数据库设计、报告导出、工程化实践

本方案为最终可执行版本。

---

## 关键参考发现

### 1. 登录方式：CDP 优先 + 自动登录兜底

参考 `boss-zhipin-mcp` 的 `browser.py`：

```
1. 尝试连接 CDP_URL（http://localhost:9222）
2. 自动探测 9222/9229/19222 等常见端口
3. 未找到则自动启动系统 Chrome（带 --remote-debugging-port=9222）
4. 仍失败则 fallback 到裸 Chromium
```

**本方案采用 CDP 优先**：用户通常已在 Chrome 中登录 Boss 直聘，Agent 直接连接复用登录态，避免处理复杂的 `fp` 生成和 security-check。

**自动登录作为兜底**：当无可用浏览器/无登录态时，执行二维码登录流程（参考 `mcp-bosszp`）：

```
POST /wapi/zppassport/captcha/randkey        →  qrId
GET  /wapi/zpweixin/qrcode/getqrcode          →  二维码图片
GET  /wapi/zppassport/qrcode/scan             →  长轮询等扫码
GET  /wapi/zppassport/qrcode/scanLogin        →  长轮询等确认
GET  /wapi/zppassport/qrcode/dispatcher       →  Set-Cookie（需 fp 参数）
Playwright 访问 security-check.html          →  获取 __zp_stoken__
```

### 2. `fp` 设备指纹（仅自动登录兜底使用）

`fp` 基于 **AES-128-CBC/PKCS7** 生成：

```ts
import crypto from 'crypto';

export function generateFingerprint(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}
```

硬编码值参考 `mcp-bosszp`，并设计 fallback 从登录页 JS 动态提取。

### 3. 职位列表 API

参考 `mcp-bosszp`，实际可用的推荐职位接口：

```
GET https://www.zhipin.com/wapi/zpgeek/pc/recommend/job/list.json
```

参数中文 → 数字代码映射：

| 维度 | 中文值 | 代码 |
|------|--------|------|
| 经验 | 在校生 | 108 |
| 经验 | 应届生 | 102 |
| 经验 | 不限 | 101 |
| 经验 | 一年以内 | 103 |
| 经验 | 一到三年 | 104 |
| 经验 | 三到五年 | 105 |
| 经验 | 五到十年 | 106 |
| 经验 | 十年以上 | 107 |
| 类型 | 全职 | 1901 |
| 类型 | 兼职 | 1903 |
| 薪资 | 3k以下 | 402 |
| 薪资 | 3-5k | 403 |
| 薪资 | 5-10k | 404 |
| 薪资 | 10-20k | 405 |
| 薪资 | 20-50k | 406 |
| 薪资 | 50以上 | 407 |

### 4. 打招呼 API

```
GET https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId={securityId}&jobId={jobId}
```

### 5. 验证码/反爬检测（参考 `boss-zhipin-mcp`）

检测页面中：

- 选择器：`.verify-wrap`、`.captcha`、`.slider-verify`、`[class*="verify"]`、`[class*="captcha"]`
- 文本："安全验证"、"滑动验证"、"请完成验证"

发现验证时：

1. 自动截图保存到 `data/logs/screenshots/verification_*.png`
2. 暂停当前操作
3. 日志输出提示，等待人工完成验证后继续

### 6. 数据库设计（参考 `boss-zhipin-mcp`，改用 SQLite）

数据库是 Agent 的**状态中枢**，必须实现：

- **去重**：基于 `encryptJobId` 避免重复投递、重复 LLM 调用
- **投递记录**：公司、岗位、薪资、匹配分数、投递时间、结果、原因、截图路径
- **状态流转**：`new` → `screened` → `shortlisted` → `applied` → `responded` → `rejected`
- **LLM 缓存**：同一职位 7 天内不再重复调用 LLM
- **中断恢复**：再次启动时跳过已处理职位
- **黑名单**：标记不感兴趣/已拒公司
- **日报数据**：投递数、跳过数、成功率、成本估算

---

## 推荐技术方案

### 1. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js + TypeScript（`tsx` 运行，生产可编译） | 与 Playwright 生态一致 |
| 浏览器 | Playwright Chromium | 已安装 `chromium-1228`；**默认有头模式** |
| 反检测 | `playwright-extra` + `puppeteer-extra-plugin-stealth` + 自定义 patch | 覆盖 webdriver、plugins、chrome、Permissions、Canvas/WebGL |
| LLM | 抽象层，兼容 OpenAI 与 Anthropic | 统一封装 `openai` 与 `@anthropic-ai/sdk` |
| 结构化输出 | Zod + JSON mode / function calling | 校验 LLM 输出 |
| 配置/密钥 | `dotenv` + `.env.example` | API Key、搜索条件、阈值、登录模式 |
| 持久化 | **SQLite (`better-sqlite3`)** | 投递历史、LLM 缓存、状态流转、黑名单 |
| 日志 | `pino` | 分级日志，失败自动截图 |
| 测试 | **Vitest** + **MSW** + `@vitest/coverage-v8` | 单元/集成测试、API mock、LLM mock |
| 任务调度 | Node 定时器 / `node-cron`（可选） | 初期单次 CLI |

### 2. 目录结构

```
E:\Claude\Bossautomation\Agent
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── vitest.config.ts
├── vitest.setup.ts
├── data/
│   ├── session/               # Playwright storage_state / cookie
│   ├── logs/
│   │   └── screenshots/       # 失败/验证码自动截图
│   └── jobs.sqlite            # SQLite 数据库
├── scripts/
│   ├── login.ts               # CDP 模式：连接已登录 Chrome
│   └── login-qr.ts            # 自动登录兜底：二维码登录
├── src/
│   ├── config.ts              # 配置读取、校验
│   ├── logger.ts              # pino 封装
│   ├── types.ts               # JobDetail、ScreenResult 等类型
│   ├── interfaces/            # 抽象接口（便于测试注入）
│   │   ├── browser.ts         # IBrowserDriver, IPage
│   │   ├── api.ts             # IBossAPIClient
│   │   ├── llm.ts             # ILLMClient
│   │   └── storage.ts         # IJobStorage
│   ├── browser/
│   │   ├── manager.ts         # CDP 连接、自动启动 Chrome、Context 管理
│   │   ├── page-pool.ts       # 页面池，限制并发 page 数量
│   │   ├── stealth.ts         # JS 注入、反检测 patch
│   │   ├── human-actions.ts   # 类人鼠标移动、滚动、随机等待
│   │   └── verification.ts    # 验证码检测与暂停
│   ├── platform/
│   │   └── boss/
│   │       ├── urls.ts        # URL 模板
│   │       ├── selectors.ts   # DOM 选择器兜底
│   │       ├── normalize.ts   # 职位 ID/API 字段规范化
│   │       ├── field-detector.ts # 字段名自动探测
│   │       ├── state-extractor.ts # window.__NUXT__ / __INITIAL_STATE__ 抽取
│   │       ├── data-collector.ts # 多层数据获取（state/route/response/CDP/JS注入）
│   │       ├── cookie-manager.ts # Cookie 提取与管理
│   │       ├── request-builder.ts # 完整请求头构造
│   │       ├── api.ts         # API 调用（route 拦截 + 直接请求 fallback）
│   │       ├── auth.ts        # 登录态检查、CDP 连接、二维码登录兜底
│   │       ├── session-manager.ts # 登录态过期检测与自动刷新
│   │       ├── fingerprint.ts # fp 生成（仅自动登录兜底）
│   │       ├── security-check.ts # security-check 获取 stoken（仅自动登录兜底）
│   │       ├── search.ts      # 职位推荐/搜索、翻页、解析
│   │       ├── search-params.ts # 参数构造与映射
│   │       ├── job-detail.ts  # 职位详情/JD 获取（API + HTML 双轨）
│   │       ├── security-id-resolver.ts # securityId 多层解析
│   │       ├── errors.ts      # 错误分类
│   │       └── apply.ts       # 发起沟通、打招呼语
│   ├── llm/
│   │   ├── client.ts          # 多 provider 统一调用
│   │   ├── prompts/
│   │   │   └── jd-screen.ts   # JD 筛选 Prompt
│   │   └── schema.ts          # Zod 输出结构
│   ├── intent/
│   │   └── job-intent.ts      # 自然语言岗位意图描述
│   ├── storage/
│   │   ├── store.ts           # SQLite：投递记录、去重、缓存、黑名单
│   │   └── write-queue.ts     # 写入队列，避免并发冲突
│   ├── pipeline/
│   │   ├── queues.ts          # 流水线队列定义
│   │   ├── workers/           # 各阶段 worker
│   │   │   ├── browser-producer.ts
│   │   │   ├── detail-fetcher.ts
│   │   │   ├── llm-screener.ts
│   │   │   └── apply-worker.ts
│   │   └── orchestrator.ts    # 主流程编排
│   ├── report/
│   │   └── exporter.ts        # Markdown/CSV 报告导出
│   └── main.ts                # CLI 入口
└── src/test/
    ├── fixtures/              # mock 数据
    │   ├── jobs.ts
    │   ├── job-detail.ts
    │   └── llm-responses.ts
    ├── msw/                   # MSW handlers
    │   └── handlers.ts
    ├── __mocks__/             # mock 实现
    │   ├── mock-browser.ts
    │   ├── mock-api-client.ts
    │   ├── mock-llm-client.ts
    │   └── mock-storage.ts
    ├── unit/                  # 单元测试
    ├── integration/           # 集成测试
    └── browser/               # 浏览器集成测试
```

### 3. 核心流程

```
1. 浏览器启动
   a. CDP 模式（默认）：探测/启动 Chrome，连接已登录浏览器
   b. 自动登录兜底：启动裸 Chromium，执行二维码登录
2. 检查登录态：未登录则按配置模式处理
3. 验证码检测：若页面出现验证，截图并暂停等待人工处理
4. 循环搜索配置（城市 + 关键词 + 筛选条件）
   a. 抽取页面初始状态 window.__NUXT__ / __INITIAL_STATE__
   b. 通过 Playwright route 拦截推荐职位 API
   c. page.on('response') 监听所有 HTTP 响应
   d. CDP Network domain 底层网络监听
   e. JS 注入拦截 fetch/XHR/WebSocket
   f. fallback 到直接 API 请求（携带完整 Cookie/请求头）
   g. DOM 解析兜底
   h. 滚动加载/翻页，收集 jobList
   i. 字段名规范化（encryptJobId/jobId/encryptId → encryptJobId）
   j. 去重：跳过已处理 encryptJobId
5. 对每个职位
   a. 获取详情和 JD：优先 API，HTML 兜底补充
   b. 本地硬过滤：黑名单公司、排除关键词
   c. LLM 筛选：岗位意图 + JD → 结构化匹配结果
   d. 低于阈值 → 跳过并记录原因
   e. 高于阈值 → 进入投递
6. 投递
   a. 解析有效 securityId（列表 → 详情 API → 详情页 DOM/URL）
   b. 全自动模式：直接发起沟通，附带 LLM 生成的个性化打招呼语
   c. Dry-run 模式（DRY_RUN=true）：只浏览、筛选、记录，不投递
   d. 发送简历需等待 HR 索要，可配置自动/人工
7. 记录结果：已投递/已跳过/失败，含时间、原因、截图
8. 生成日报/报告（Markdown/CSV）
9. 结束：关闭浏览器
```

### 4. 登录模块详细设计

**文件**：`src/platform/boss/auth.ts`、`src/browser/manager.ts`

#### 4.1 CDP 模式（默认）

```ts
async function connectViaCDP(): Promise<BrowserContext>
```

实现：

1. 尝试 `CDP_URL`（默认 `http://localhost:9222`）
2. 探测端口列表 `[9222, 9229, 19222]`
3. 未找到则调用 `launchSystemChrome()` 启动系统 Chrome
4. 连接成功后，获取第一个 context 和 page
5. 检查登录态
6. 登录成功则保存 storage_state/cookie 到 `data/session/`

#### 4.2 自动启动 Chrome

```ts
async function launchSystemChrome(port: number = 9222): Promise<void>
```

实现：

- Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- Linux: `google-chrome`
- 参数：`--remote-debugging-port=9222 --user-data-dir=./data/chrome-profile`
- 等待 `http://localhost:9222/json/version` 可访问

#### 4.3 登录态检查

```ts
async function isLoggedIn(page: Page): Promise<boolean>
```

实现：

1. 若当前 URL 是 Boss 页面，不导航，直接检查 DOM
2. 检查 body class 是否含 `login`
3. 检查是否存在 `.user-nav`、`.nav-figure`、`.menu-list`、`.btn-post-job` 等元素
4. 若非 Boss 页面，导航到 `https://www.zhipin.com` 再检查

#### 4.4 自动登录兜底

当 CDP 模式无法获取登录态时使用，参考 `mcp-bosszp`：

1. 获取 `qrId`
2. 生成并保存二维码图片
3. 长轮询等待扫码和确认
4. 生成 `fp`，调用 dispatcher 获取初始 Cookie
5. Playwright 访问 security-check.html 获取 `__zp_stoken__`
6. 保存 Cookie

### 5. 登录态过期检测与自动刷新

**文件**：`src/platform/boss/session-manager.ts`

Boss 直聘 session 通常 2-4 小时可能失效，原因包括长时间无操作、多设备登录、网络中断、反爬检测等。不能只依赖启动时检查。

实现：

```ts
export class SessionManager implements ISessionManager {
  async checkLoginState(force = false): Promise<boolean> {
    // 5 分钟内检查过且有效，直接返回
    if (!force && Date.now() - this.state.lastCheckedAt < 5 * 60 * 1000) {
      return this.state.isLoggedIn;
    }

    // 1. 轻量 DOM 检查
    let isLoggedIn = await checkLoginByDOM(this.page);

    // 2. DOM 不确定时，用 API 探针
    if (!isLoggedIn) {
      isLoggedIn = await checkLoginByAPI(this.state.cookieString);
    }

    this.state.isLoggedIn = isLoggedIn;
    this.state.lastCheckedAt = Date.now();

    if (!isLoggedIn) {
      this.logger.warn('登录态已失效，尝试自动刷新');
      isLoggedIn = await this.refreshSession();
    }

    return isLoggedIn;
  }

  async refreshSession(): Promise<boolean> {
    // 策略1：尝试 CDP 重连
    if (await this.authService.reconnectCDP()) return true;

    // 策略2：刷新当前页面
    await this.page.reload({ waitUntil: 'networkidle' });
    if (await checkLoginByDOM(this.page)) {
      await this.saveSession();
      return true;
    }

    // 策略3：触发二维码登录兜底
    for (const cb of this.onExpiredCallbacks) cb();
    return await this.authService.loginWithQR();
  }
}
```

在关键位置调用：

- 每次搜索前
- 每处理 N 个职位时
- 每次投递前
- API 返回 401/登录相关错误时

### 6. 验证码检测模块

**文件**：`src/browser/verification.ts`

```ts
async function checkVerification(page: Page): Promise<VerificationResult | null>
```

实现：

1. 检查选择器：`.verify-wrap`、`.captcha`、`.slider-verify`、`[class*="verify"]`、`[class*="captcha"]`
2. 检查页面文本是否包含"安全验证"、"滑动验证"、"请完成验证"
3. 若检测到：
   - 截图保存到 `data/logs/screenshots/verification_${timestamp}.png`
   - 返回 `{ needsVerification: true, screenshotPath, message }`
   - 主流程暂停，等待用户完成验证后按任意键继续

### 7. 多层数据获取策略

**文件**：`src/platform/boss/data-collector.ts`

不能只依赖 `page.route()`，必须设计多层降级：

```text
Layer 0: window.__NUXT__ / __INITIAL_STATE__ 抽取  ← 页面加载后立即执行
Layer 1: Playwright page.route()                   ← 首选
Layer 2: page.on('response')                       ← 监听 HTTP 响应
Layer 3: CDP Network domain                        ← 底层网络监听
Layer 4: JavaScript 注入拦截 fetch/XHR/WS          ← 终极兜底
Fallback: 直接 API 请求（携带完整 Cookie/请求头）   ← 绕过浏览器
Final Fallback: DOM 解析                           ← 读页面文本
```

封装为 `BossDataCollector`：

```ts
export class BossDataCollector {
  private jobListBuffer: NormalizedJob[] = [];

  async collectFromPage(page: Page): Promise<NormalizedJob[]> {
    // 1. 先抽取页面初始状态
    const state = await extractPageState(page);
    const jobsFromState = extractJobsFromState(state);
    if (jobsFromState.length > 0) return jobsFromState;

    // 2. 等待 Layer 1-4 收集
    await sleep(3000);
    const jobsFromNetwork = this.getCollectedJobs();
    if (jobsFromNetwork.length > 0) return jobsFromNetwork;

    // 3. DOM 兜底
    return this.parseJobsFromDOM(page);
  }
}
```

每层都尝试解析 `jobList` 并做字段名规范化，记录每层捕获数量到日志。

### 8. 页面初始状态抽取

**文件**：`src/platform/boss/state-extractor.ts`

Boss 直聘是 Vue/Nuxt 应用，常在 `<script>` 中嵌入：

```html
<script>
window.__NUXT__ = { ... };
window.__INITIAL_STATE__ = { ... };
</script>
```

这些状态包含职位列表、详情、用户信息等结构化数据，比 API 拦截更稳定。

实现：

```ts
export async function extractPageState(page: Page): Promise<PageState> {
  return page.evaluate(() => ({
    nuxt: (window as any).__NUXT__,
    initialState: (window as any).__INITIAL_STATE__,
  }));
}

export function extractJobsFromState(state: PageState): NormalizedJob[] {
  const candidates = [
    state.nuxt?.data?.[0]?.jobList,
    state.nuxt?.state?.job?.jobList,
    state.nuxt?.state?.recommend?.jobList,
    state.initialState?.job?.jobList,
    state.initialState?.recommend?.jobList,
    state.initialState?.search?.jobList,
  ];

  for (const list of candidates) {
    if (Array.isArray(list) && list.length > 0) {
      return list.map(normalizeJob).filter(Boolean) as NormalizedJob[];
    }
  }

  return [];
}
```

### 9. 职位 ID 字段名规范化

**文件**：`src/platform/boss/normalize.ts`、`src/platform/boss/field-detector.ts`

不同 API 中职位 ID 字段名可能不同：

| 字段含义 | 可能的名字 |
|---------|-----------|
| 职位主键 | `encryptJobId`、`jobId`、`encryptId`、`id` |
| 安全令牌 | `securityId`、`encryptSecurityId`、`secId` |
| BOSS ID | `encryptBossId`、`bossId` |
| 列表追踪 | `lid`、`lId`、`listId` |

实现统一规范化：

```ts
export interface NormalizedJob {
  encryptJobId: string;   // 统一主键
  securityId?: string;
  encryptBossId?: string;
  lid?: string;
  jobName: string;
  // ...
}

export function normalizeJob(raw: any): NormalizedJob | null {
  const encryptJobId =
    raw.encryptJobId ||
    raw.jobId ||
    raw.encryptId ||
    raw.id ||
    extractJobIdFromUrl(raw.jobDetailUrl || raw.detailUrl);

  if (!encryptJobId) return null;

  return {
    encryptJobId: String(encryptJobId),
    securityId: String(raw.securityId || raw.encryptSecurityId || raw.secId || ''),
    encryptBossId: String(raw.encryptBossId || raw.bossId || ''),
    lid: String(raw.lid || raw.lId || raw.listId || ''),
    jobName: raw.jobName || raw.title || raw.name || '未知职位',
    // ...
  };
}
```

去重、存储、打招呼均使用规范化后的 `encryptJobId`。

### 10. 推荐列表参数与翻页

**文件**：`src/platform/boss/search-params.ts`、`src/platform/boss/search.ts`

#### 10.1 已知参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `page` | number | 页码，从 1 开始 |
| `pageSize` | number | 每页数量，默认 15 |
| `experience` | number | 经验代码 |
| `jobType` | number | 工作类型代码 |
| `salary` | number | 薪资代码 |
| `encryptExpectId` | string | 求职期望 ID |
| `_` | number | 时间戳毫秒 |

#### 10.2 未验证参数

| 参数 | 状态 | 处理方式 |
|------|------|---------|
| `city` / `cityCode` | 未验证 | 推荐接口可能依赖 `encryptExpectId`，先不发送 |
| `query` / `keyword` | 未验证 | 推荐接口通常不需要，搜索接口才需要 |
| `cursor` / `lastId` | 未验证 | 翻页可能使用，实现自适应 |

#### 10.3 自适应翻页

```ts
async function fetchAllPages(
  api: IBossAPIClient,
  baseParams: JobSearchParams,
  maxPages: number = 5
): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  let page = 1;
  let cursor: string | undefined;

  for (let i = 0; i < maxPages; i++) {
    const params: any = { ...baseParams, pageSize: 15 };
    if (cursor) params.cursor = cursor;
    else params.page = page;

    const response = await api.getRecommendJobs(params);
    jobs.push(...response.jobList);

    if (!response.hasMore) break;
    if (response.cursor) cursor = response.cursor;
    else page++;
  }

  return jobs;
}
```

### 11. 职位详情双轨获取

**文件**：`src/platform/boss/job-detail.ts`

| 维度 | API 详情 | HTML 详情页 |
|------|---------|------------|
| URL | `/wapi/zpgeek/job/detail.json` | `/job_detail/{encryptJobId}.html` |
| 内容 | 结构化字段 | 页面展示文本，可能更丰富 |
| 速度 | 快 | 慢 |
| 稳定性 | 依赖 Cookie/Header | 依赖页面结构 |

实现：

```ts
export class JobDetailService {
  async getJobDetail(job: NormalizedJob): Promise<JobDetail> {
    let detail = await this.getDetailFromAPI(job);
    if (!detail?.postDescription) {
      detail = await this.mergeWithHTMLDetail(job, detail);
    }
    if (detail?.postDescription) {
      const htmlDetail = await this.getDetailFromHTML(job);
      detail = this.mergeDetails(detail, htmlDetail);
    }
    return detail;
  }
}
```

详情数据缓存 7 天。

### 12. securityId 多层解析

**文件**：`src/platform/boss/security-id-resolver.ts`

```ts
export class SecurityIdResolver {
  async resolve(job: NormalizedJob, options?: { forceRefresh?: boolean }): Promise<string | null> {
    if (job.securityId && !options?.forceRefresh) {
      if (await this.validate(job.securityId, job.encryptJobId)) return job.securityId;
    }

    const detail = await this.api.getJobDetail(job.encryptJobId);
    if (detail?.securityId && await this.validate(detail.securityId, job.encryptJobId)) {
      return detail.securityId;
    }

    return this.extractFromJobPage(job.encryptJobId);
  }
}
```

### 13. 请求头/Cookie 完整模拟

**文件**：`src/platform/boss/cookie-manager.ts`、`src/platform/boss/request-builder.ts`

关键请求头字段：

| 字段 | 说明 |
|------|------|
| `Host` | `www.zhipin.com` |
| `User-Agent` | 与浏览器一致 |
| `Referer` | 当前页面 URL |
| `Origin` | `https://www.zhipin.com` |
| `X-Requested-With` | `XMLHttpRequest` |
| `Cookie` | `wt2`、`__zp_stoken__`、`zp_at` 等 |
| `Sec-Fetch-*` | same-origin / cors / empty |

从 CDP 浏览器 context 自动提取 Cookie：

```ts
export class CookieManager {
  constructor(private context: BrowserContext) {}

  async getCookieString(): Promise<string> {
    const cookies = await this.context.cookies('https://www.zhipin.com');
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }
}
```

请求头构造：

```ts
export class BossRequestBuilder {
  async buildHeaders(options: { referer?: string } = {}): Promise<Record<string, string>> {
    const cookieString = await this.cookieManager.getCookieString();
    return {
      Host: 'www.zhipin.com',
      'User-Agent': await this.getBrowserUserAgent(),
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      Referer: options.referer || this.page.url(),
      Origin: 'https://www.zhipin.com',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieString,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    };
  }
}
```

### 14. 分类重试策略

**文件**：`src/platform/boss/errors.ts`、`src/utils/retry.ts`

错误分类：

| 错误类型 | HTTP/业务码 | 处理策略 |
|---------|------------|---------|
| 登录过期 | 401 / code 3001 | 刷新 session 后重试 |
| 风控/拒绝 | 403 | 截图、暂停、等待人工介入 |
| 限流 | 429 | 指数退避 + 自适应降速 |
| 超时 | 408 / ECONNRESET | 指数退避重试 |
| 服务端错误 | 5xx | 指数退避重试 |
| 业务错误 | code != 0 | 按业务码查表处理 |

实现：

```ts
export enum BossErrorType {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',
  TIMEOUT = 'TIMEOUT',
  SERVER_ERROR = 'SERVER_ERROR',
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export class ClassifiedRetryExecutor {
  async execute<T>(operation: () => Promise<T>, context: { url: string; operationName: string }): Promise<T> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.sessionManager.checkLoginState();
        return await operation();
      } catch (error) {
        const classified = classifyError(error);

        if (classified.needsHumanIntervention) {
          await this.humanIntervention(classified);
          continue;
        }

        if (classified.needsAuthRefresh) {
          const refreshed = await this.sessionManager.refreshSession();
          if (!refreshed) throw new Error('刷新登录态失败');
          continue;
        }

        if (!classified.retryable || attempt === maxAttempts) throw classified;

        const delay = calculateBackoff(attempt) +
          (classified.type === BossErrorType.RATE_LIMITED ? this.rateLimiter.getPenaltyDelay() : 0);

        await sleep(delay);

        if (classified.type === BossErrorType.RATE_LIMITED) {
          this.rateLimiter.slowDown();
        }
      }
    }
  }
}
```

### 15. 并发流水线

**文件**：`src/pipeline/queues.ts`、`src/pipeline/orchestrator.ts`、`src/pipeline/workers/*`

采用生产者-消费者模型：

```
[Browser Producer] → [Raw Job Queue] → [Detail Fetcher] → [Detail Queue]
                                                          → [LLM Screener] → [Shortlisted Queue]
                                                                            → [Apply Worker] → [Storage]
```

关键约束：

- 浏览器操作必须单线程
- 详情获取可轻度并发（默认 3）
- LLM 筛选可并发（默认 5）
- 投递严格限流（默认串行）

```ts
export interface PipelineConfig {
  detailConcurrency: number;    // 默认 3
  llmConcurrency: number;       // 默认 5
  applyConcurrency: number;     // 默认 1
  pageTurnDelayMin: number;     // 默认 8s
  pageTurnDelayMax: number;     // 默认 15s
  applyDelayMin: number;        // 默认 10s
  applyDelayMax: number;        // 默认 20s
}
```

### 16. SQLite WAL 模式与并发写入

**文件**：`src/storage/store.ts`、`src/storage/write-queue.ts`

```ts
export class JobStorage implements IJobStorage {
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.initTables();
  }

  saveJob(job: JobRecord): void {
    this.writeQueue.enqueue(() => {
      this.db.prepare('INSERT OR IGNORE INTO jobs (...) VALUES (...)').run(...);
    });
  }
}
```

- WAL 模式提升并发读性能
- `busy_timeout = 5000` 自动等待锁
- 写操作通过 `SQLiteWriteQueue` 序列化
- 批量写入使用事务

### 17. 内存管理

**文件**：`src/browser/page-pool.ts`、`src/browser/manager.ts`

- 使用 `PagePool` 限制同时打开的页面数（默认 3）
- 详情页使用完立即关闭
- 浏览器运行超过 1 小时自动重启
- 定时清理 24 小时以上截图
- 定期输出内存使用日志

```ts
export class PagePool {
  private activePages: Set<Page> = new Set();
  private maxPages = 3;

  async acquire(): Promise<Page> {
    while (this.activePages.size >= this.maxPages) {
      await this.release(this.activePages.values().next().value);
    }
    const page = await this.context.newPage();
    this.activePages.add(page);
    return page;
  }

  async release(page: Page): Promise<void> {
    this.activePages.delete(page);
    try { await page.close(); } catch {}
  }
}
```

### 18. 反检测与合规策略

| 措施 | 实现 |
|------|------|
| 有头浏览器 | `headless: false`，`--disable-blink-features=AutomationControlled` |
| 指纹伪装 | `playwright-extra-stealth` + 自定义 JS patch |
| 人类行为 | 鼠标移动贝塞尔曲线；点击前停顿 200-800ms；分段滚动；翻页间隔 8-15s；连续操作随机休息 5-30s |
| 会话复用 | CDP 连接已登录 Chrome，Cookie/session 持久化 |
| 频率控制 | 单账号每小时最多 20-30 个职位，日上限默认 20 |
| 验证码处理 | 自动检测、截图、暂停、等待人工介入 |
| 代理（可选） | 多账号使用住宅/移动代理；单账号固定 IP |
| 数据最小化 | 仅保存投递日志与去重 ID |
| 法律免责声明 | README 明确：仅供个人求职学习使用，遵守用户协议 |

### 19. LLM JD 筛选设计

- **输入**：岗位意图描述 + 职位信息
- **Prompt**：求职顾问角色，JSON 输出，禁止额外解释
- **输出结构（Zod）**：
  ```ts
  {
    match_score: number;        // 0-100
    salary_match: boolean;
    location_match: boolean;
    skills_match: number;       // 0-100
    red_flags: string[];
    reason: string;
    suggested_greeting: string;
  }
  ```
- **阈值**：默认 `match_score >= 75` 且 `redFlags.length === 0`
- **缓存**：同一 `encryptJobId` 缓存 7 天
- **Fallback**：LLM 不可用时使用关键词匹配初筛

### 20. SQLite 数据库设计

**表结构**：

```sql
CREATE TABLE jobs (
  encrypt_job_id TEXT PRIMARY KEY,
  security_id TEXT,
  job_name TEXT,
  brand_name TEXT,
  city_name TEXT,
  area_district TEXT,
  salary_desc TEXT,
  job_experience TEXT,
  job_degree TEXT,
  skills TEXT,                  -- JSON array
  industry TEXT,
  brand_scale_name TEXT,
  full_text TEXT,
  api_detail_json TEXT,         -- API 原始详情
  html_detail_json TEXT,        -- HTML 抓取详情
  match_score INTEGER,
  salary_match INTEGER,
  location_match INTEGER,
  skills_match INTEGER,
  red_flags TEXT,               -- JSON array
  reason TEXT,
  suggested_greeting TEXT,
  status TEXT,                  -- new/screened/shortlisted/applied/responded/rejected
  result TEXT,                  -- success/skipped/failed
  skip_reason TEXT,
  source_keyword TEXT,
  first_seen TEXT,
  last_updated TEXT,
  applied_at TEXT,
  screenshot_path TEXT,
  llm_cached_at TEXT
);

CREATE TABLE blacklist (
  brand_id TEXT PRIMARY KEY,
  brand_name TEXT,
  reason TEXT,
  created_at TEXT
);

CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  total_seen INTEGER,
  screened INTEGER,
  shortlisted INTEGER,
  applied INTEGER,
  skipped INTEGER,
  failed INTEGER,
  llm_calls INTEGER,
  estimated_cost REAL
);
```

### 21. 测试工程化

**文件**：`vitest.config.ts`、`src/test/**/*`

#### 21.1 抽象接口与依赖注入

```ts
export interface IBrowserDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getPage(): Promise<IPage>;
}

export interface IPage {
  goto(url: string, options?: any): Promise<void>;
  route(pattern: string, handler: any): Promise<void>;
  evaluate<T>(script: any): Promise<T>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  screenshot(options?: any): Promise<Buffer>;
  url(): string;
}

export interface IBossAPIClient {
  getRecommendJobs(params: any): Promise<JobListResponse>;
  getJobDetail(params: any): Promise<JobDetail>;
  greetBoss(params: any): Promise<GreetResult>;
}

export interface ILLMClient {
  chat(messages: any[], options?: any): Promise<LLMResponse>;
}
```

#### 21.2 测试分层

| 层级 | 工具 | 说明 |
|------|------|------|
| 单元测试 | Vitest + mock | 离线验证业务逻辑 |
| 集成测试 | Vitest + MSW | 模块组合 + API mock |
| 浏览器集成测试 | Playwright Test + MSW | 真实浏览器 + mock API |
| E2E 手动验证 | 手动 | 真实浏览器 + 真实 Boss 直聘 |

#### 21.3 测试脚本

```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run src/test/unit",
    "test:integration": "vitest run src/test/integration",
    "test:coverage": "vitest run --coverage",
    "test:browser": "playwright test src/test/browser"
  }
}
```

#### 21.4 覆盖率目标

- 初期：unit + integration 合并 70%
- 后期：80% 以上

### 22. 报告导出

**文件**：`src/report/exporter.ts`

- **Markdown 报告**：Top N 职位表格、投递状态表、职位详情卡片、统计摘要
- **CSV 导出**：方便 Excel 分析
- 数据来源：SQLite 查询

### 23. 错误处理与可观测性

- 每步异常捕获并记录：错误类型、URL、选择器、请求、截图路径
- 分类重试：401 刷新、429 降速、403 人工介入、5xx/超时指数退避
- 登录态失效：自动刷新或触发重新登录
- 运行日报：投递数、跳过数、失败数、LLM 调用次数与费用估算
- 内存监控：定期输出 process.memoryUsage()

---

## 关键文件与模块

| 文件 | 职责 |
|------|------|
| `src/interfaces/*.ts` | 抽象接口定义（browser/api/llm/storage） |
| `src/browser/manager.ts` | CDP 连接、自动启动 Chrome、Context 管理、定期重启 |
| `src/browser/page-pool.ts` | 页面池，限制并发 page 数量 |
| `src/browser/stealth.ts` | 反检测 JS 注入 |
| `src/browser/human-actions.ts` | 人类行为模拟 |
| `src/browser/verification.ts` | 验证码检测与暂停 |
| `src/platform/boss/normalize.ts` | 职位 ID/API 字段规范化 |
| `src/platform/boss/field-detector.ts` | 字段名自动探测 |
| `src/platform/boss/state-extractor.ts` | window.__NUXT__ / __INITIAL_STATE__ 抽取 |
| `src/platform/boss/data-collector.ts` | 多层数据获取封装 |
| `src/platform/boss/cookie-manager.ts` | Cookie 提取与管理 |
| `src/platform/boss/request-builder.ts` | 完整请求头构造 |
| `src/platform/boss/security-id-resolver.ts` | securityId 多层解析 |
| `src/platform/boss/auth.ts` | 登录态检查、CDP 模式、二维码登录兜底 |
| `src/platform/boss/session-manager.ts` | 登录态过期检测与自动刷新 |
| `src/platform/boss/fingerprint.ts` | `fp` 生成（仅自动登录兜底） |
| `src/platform/boss/security-check.ts` | security-check 获取 stoken（仅自动登录兜底） |
| `src/platform/boss/urls.ts` | URL 模板集中管理 |
| `src/platform/boss/api.ts` | 推荐/搜索 API 调用 |
| `src/platform/boss/search-params.ts` | 参数构造与映射 |
| `src/platform/boss/search.ts` | 职位列表获取、翻页、解析 |
| `src/platform/boss/job-detail.ts` | 职位详情/JD 获取（API + HTML 双轨） |
| `src/platform/boss/errors.ts` | 错误分类 |
| `src/platform/boss/apply.ts` | 打招呼、发送简历 |
| `src/utils/retry.ts` | 分类重试执行器 |
| `src/llm/client.ts` | 多 provider LLM 客户端 |
| `src/llm/prompts/jd-screen.ts` | JD 筛选 Prompt |
| `src/llm/schema.ts` | Zod 输出结构 |
| `src/storage/store.ts` | SQLite 投递记录、去重、缓存、黑名单 |
| `src/storage/write-queue.ts` | 写入队列，避免并发冲突 |
| `src/pipeline/queues.ts` | 流水线队列 |
| `src/pipeline/workers/*.ts` | 各阶段 worker |
| `src/pipeline/orchestrator.ts` | 主流程编排 |
| `src/report/exporter.ts` | Markdown/CSV 报告导出 |
| `src/test/**` | fixtures、mock、MSW、测试用例 |
| `scripts/login.ts` | CDP 模式登录脚本 |
| `scripts/login-qr.ts` | 二维码登录兜底脚本 |
| `.env.example` | 配置模板 |
| `package.json` | TypeScript、Zod、LLM SDK、pino、SQLite、Playwright-extra、Vitest、MSW 依赖 |

---

## 开发里程碑

| 阶段 | 周期 | 交付物 |
|------|------|--------|
| M1 项目脚手架 | 2-3 天 | `package.json`、TypeScript、`pino`、Vitest、MSW、抽象接口、目录结构、基础测试 |
| M2 浏览器与会话 | 2-3 天 | CDP 连接、自动启动 Chrome、登录态检查、SessionManager 自动刷新、session 持久化、二维码登录兜底、验证码检测 |
| M3 职位获取 | 5-7 天 | 多层数据获取（含 state 抽取）、字段规范化、参数适配器、自适应翻页、API + HTML 双轨详情、去重、硬过滤、完整请求头 |
| M4 LLM 筛选 | 3-5 天 | LLM 客户端、Prompt、Zod 结构化输出、缓存、阈值配置 |
| M5 投递流程 | 5-7 天 | securityId 解析、分类重试、并发流水线、发起沟通、个性化打招呼语、结果记录、Dry-run 模式 |
| M6 稳定性与文档 | 4-5 天 | SQLite WAL/写入队列、内存管理、错误处理、截图、频率限制、报告导出、README、免责声明、单元/集成测试 |

> 注：因新增测试工程化、登录态刷新、多层数据获取、securityId 解析、分类重试、并发流水线、请求头模拟、WAL、内存管理等模块，整体周期比初版方案有所增加。

---

## 验证方式

### 手动验证

1. **CDP 连接验证**：运行 `npx tsx scripts/login.ts`，检查能否自动探测/启动 Chrome 并识别登录态。
2. **二维码登录兜底验证**：运行 `npx tsx scripts/login-qr.ts`，扫码后检查 `data/session/boss.json`。
3. **登录态刷新验证**：长时间运行后模拟 Cookie 失效，检查是否自动刷新。
4. **API 字段验证**：调用 `search.ts` 获取推荐职位，打印原始响应，确认 `encryptJobId`、`securityId` 等字段名。
5. **多层数据获取验证**：对比 state/route/response/CDP/JS 注入五层各自捕获的职位数量。
6. **securityId 解析验证**：对单个职位测试解析流程，确认最终拿到有效 securityId。
7. **详情双轨验证**：对比 API 详情和 HTML 详情，确认合并后数据完整。
8. **分类重试验证**：模拟 401/403/429/5xx，检查处理策略是否正确。
9. **验证码检测验证**：人为触发验证页面，检查是否自动截图并暂停。
10. **并发流水线验证**：观察多 worker 是否正常协作，无资源冲突。
11. **内存管理验证**：长时间运行观察内存是否稳定，页面是否及时关闭。
12. **Dry-run 验证**：运行主程序关闭自动投递，检查能否正确抓取并输出 LLM 筛选结果。
13. **单职位投递验证**：在人工确认模式下，对 1 个高匹配职位发起沟通。
14. **报告导出验证**：运行后检查生成的 Markdown/CSV 报告。
15. **频率/稳定性验证**：连续运行 30 分钟，观察日志与截图。

### 自动验证

16. **单元测试**：`npm run test:unit`
17. **集成测试**：`npm run test:integration`
18. **覆盖率检查**：`npm run test:coverage`

---

## 风险与应对

| 风险 | 应对 |
|------|------|
| 账号被封禁 | 有头模式、低频、session 复用、人类行为、不自动破解验证码 |
| CDP 连接失败 | 自动探测端口、自动启动 Chrome、fallback 到裸 Chromium + 二维码登录 |
| `fp`/security-check 参数失效 | 硬编码兜底 + 从页面 JS 动态提取 fallback + 人工介入 |
| 页面/API 结构变更 | 抽象 `urls.ts`、`selectors.ts`、`api.ts`，变更时集中修改 |
| API 字段名变更 | `field-detector.ts` 自动探测 + `normalize.ts` 规范化兜底 |
| route 拦截失效 | 六层数据获取自动降级 |
| securityId 失效 | `SecurityIdResolver` 多层解析 + 自动刷新重试 |
| Cookie/请求头不完整 | `CookieManager` + `RequestBuilder` 从真实浏览器自动同步 |
| 登录态运行中过期 | `SessionManager` 定期检测 + 自动刷新 |
| 请求失败 | `ClassifiedRetryExecutor` 分类处理 |
| SQLite 并发冲突 | WAL 模式 + busy_timeout + 写入队列 |
| 内存泄漏 | PagePool + 页面关闭 + 浏览器定期重启 + 截图清理 |
| 验证码/反爬升级 | 自动检测、截图、暂停、等待人工处理；必要时降低频率或更换 IP |
| LLM 输出不稳定 | Zod 校验 + 重试；Prompt 中加入示例与明确格式要求 |
| 法律合规 | 仅个人使用、不转售数据、不绕过安全措施、README 免责声明 |

---

## 推荐默认配置

- 运行模式：**Dry-run**（初期默认只筛选不投递）
- 登录模式：**CDP 优先**，自动启动 Chrome
- LLM Provider：**OpenAI / Anthropic 通用接口**
- 日投递上限：**20 个**
- 浏览器：**有头 Chromium**
- 数据库：**SQLite**
- 岗位意图：用户用自然语言描述目标岗位
- 流水线并发：详情 3，LLM 5，投递 1
- 浏览器重启间隔：**1 小时**

---

## 用户已确认事项

1. ✅ 全自动投递
2. ✅ LLM 兼容 OpenAI 与 Anthropic 通用接口
3. ✅ 无需简历，使用自然语言岗位意图描述
4. ✅ 吸收 `mcp-bosszp` 的登录/API 发现
5. ✅ 登录方式改为 **CDP 优先 + 自动登录兜底**
6. ✅ 加入验证码检测自动暂停机制
7. ✅ 数据库使用 **SQLite**
8. ✅ 需要自动探测/启动 Chrome
9. ✅ 需要 Markdown/CSV 报告导出
10. ✅ 测试工程化（抽象接口 + Vitest + MSW + mock）
11. ✅ 多层数据获取策略（state/route/response/CDP/JS注入 + fallback）
12. ✅ `securityId` 多层解析与验证
13. ✅ 职位 ID 规范化层
14. ✅ 推荐列表参数适配器 + 自适应翻页
15. ✅ 详情获取双轨方案（API + HTML）
16. ✅ 登录态过期检测与自动刷新
17. ✅ 请求失败分类重试策略
18. ✅ 并发流水线优化
19. ✅ `window.__NUXT__` / `__INITIAL_STATE__` 状态抽取
20. ✅ 请求头/Cookie 完整模拟
21. ✅ SQLite WAL 模式 + 写入队列
22. ✅ 内存管理策略

> 本方案不鼓励违反平台规则。实施前请阅读并确认仅用于个人求职，且能接受账号受限风险。全自动模式下请务必保持低频率，并建议在账号被封禁可接受的场景下使用。
