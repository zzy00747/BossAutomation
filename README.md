# Boss 直聘自动投递 Agent

> ⚠️ **仅供个人求职学习使用，请遵守 Boss 直聘用户协议与相关法律法规，低频率、有头模式运行。账号受限风险自负。**

基于 Playwright + TypeScript + LLM 的 Boss 直聘（zhipin.com）自动投递 Agent。

## 功能特性

- **CDP 优先连接**：复用已登录 Chrome，失败时自动探测/启动系统 Chrome，或回退二维码登录
- **多层数据获取**：`window.__NUXT__` / `__INITIAL_STATE__` → `page.route()` → `page.on('response')` → CDP Network → JS 注入 → 直接 API → DOM 兜底
- **LLM JD 筛选**：匹配打分（matchScore / salaryMatch / locationMatch / skillsMatch / redFlags），自动生成个性化打招呼语
- **SQLite 持久化**：WAL 模式 + 写入队列，支持去重、状态流转、7 天 LLM 缓存、黑名单、日报统计
- **流水线并发**：BrowserProducer → DetailFetcher → LLMScreener → ApplyWorker，由 Orchestrator 编排
- **稳定性保障**：内存监控、截图过期清理、浏览器定时重启、验证码检测并暂停等待人工处理
- **报告导出**：每日 Markdown 报告 + CSV 明细，输出到 `data/reports/`
- **Dry-run 默认开启**：不会真实发起沟通，保护账号安全

## 安装

```bash
npm install
npx playwright install chromium
```

## 配置

复制示例环境变量文件并填写：

```bash
cp .env.example .env
```

### 必填配置

| 环境变量 | 说明 | 示例 |
|----------|------|------|
| `LLM_PROVIDER` | LLM 提供商 | `openai` 或 `anthropic` |
| `OPENAI_API_KEY` | OpenAI API Key（provider=openai 时必填） | `sk-xxxxxxxx` |
| `ANTHROPIC_API_KEY` | Anthropic API Key（provider=anthropic 时必填） | `sk-ant-xxxxxxxx` |

### 浏览器配置

| 环境变量 | 说明 | 建议值 |
|----------|------|--------|
| `CDP_URL` | Chrome DevTools Protocol 地址 | `http://127.0.0.1:9222` |
| `CHROME_PATH` | 系统 Chrome 可执行文件路径，用于 CDP 不可用时 fallback | Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe` |

> **注意**：Windows 下 Playwright 可能把 `localhost` 解析为 `::1`（IPv6），而 Chrome 默认监听 `127.0.0.1`（IPv4），会导致 `ECONNREFUSED ::1:9222`。建议 `CDP_URL` 与启动参数都显式使用 `127.0.0.1`。

### 业务配置

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `DRY_RUN` | 是否仅模拟投递（默认 true） | `true` |
| `MATCH_SCORE_THRESHOLD` | LLM 匹配分阈值 | `75` |
| `APPLY_DAILY_LIMIT` | 每日最大投递数 | `20` |
| `DETAIL_CONCURRENCY` | 详情获取并发数 | `3` |
| `LLM_CONCURRENCY` | LLM 筛选并发数 | `5` |
| `APPLY_CONCURRENCY` | 投递并发数（建议保持 1） | `1` |
| `SEARCH_KEYWORDS` | 搜索关键词，逗号分隔 | 空（走默认推荐） |
| `SEARCH_MAX_PAGES` | 每个关键词最大翻页数 | `5` |

### 岗位意图

可通过以下任一方式配置：

1. `.env` 中设置 `JOB_INTENT`（环境变量优先）
2. 写入 `config/job-intent.txt`，例如：

```text
React TypeScript 前端工程师，期望薪资 25-40K，base 北京
```

## 运行

### 启动 Chrome 并开启 CDP（推荐）

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir=data/chrome-profile

# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --remote-debugging-address=127.0.0.1 ^
  --user-data-dir=data\chrome-profile
```

确保 Chrome 已登录 Boss 直聘求职者账号。

### 运行 Agent

```bash
# 默认 Dry-run 模式（不会真正投递）
npm run dev

# 生产模式（需先在 .env 设置 DRY_RUN=false）
npm start
```

运行结束后会在控制台打印报告路径：

```text
报告路径: data/reports/daily-report-2026-06-28.md
```

### 测试

```bash
npm test                 # 全部测试
npm run test:unit        # 单元测试
npm run test:integration # 集成测试
npm run test:coverage    # 覆盖率（阈值 lines/functions/statements=70%, branches=60%）
```

## 目录结构

```
├── src/
│   ├── browser/          # 浏览器管理、反检测、人类行为、验证码检测、页面池
│   ├── interfaces/       # 抽象接口（browser/api/storage/llm）
│   ├── platform/boss/    # Boss 直聘专属 API、DOM、登录、Cookie、请求头逻辑
│   ├── llm/              # LLM 客户端、Prompt、结构化输出、筛选器
│   ├── storage/          # SQLite 存储与写入队列
│   ├── pipeline/         # 流水线、队列、Orchestrator
│   ├── report/           # Markdown/CSV 报告导出
│   ├── utils/            # 内存监控、截图清理、分类重试
│   ├── intent/           # 岗位意图加载
│   ├── test/             # fixtures、mock、MSW、单元与集成测试
│   ├── config.ts         # 配置校验与加载
│   ├── logger.ts         # pino 日志
│   └── main.ts           # CLI 入口
├── scripts/              # 登录、调试脚本
├── data/                 # session、日志、数据库、报告、截图
├── config/               # 岗位意图文件
└── workspace/            # 开发计划与参考方案
```

## 验证步骤

1. **CDP 连接**：Chrome 启动后访问 `http://localhost:9222/json/version`，确认返回 JSON
2. **登录态**：运行 `npm run dev`，查看日志是否输出 `登录态检查通过`
3. **Dry-run**：首次运行保持 `DRY_RUN=true`，确认不调用 `greetBoss`
4. **报告**：运行结束后检查 `data/reports/daily-report-YYYY-MM-DD.md`
5. **生产模式**：确认岗位意图、日上限、关键词符合预期后，再设置 `DRY_RUN=false`

## 风险提示

- **账号受限风险**：自动化行为可能被平台识别，建议低频率、有头模式运行，日上限不宜过高
- **法律合规**：仅用于个人求职，禁止转售数据、批量采集他人信息、绕过安全措施
- **验证码/人机验证**：出现验证时会自动截图并暂停，需人工处理后继续
- **Cookie 与登录态**：使用 CDP 复用浏览器登录态，避免频繁登录触发风控
- **数据安全**：`.env` 与数据库包含敏感信息，请勿提交到 Git

## 免责声明

本项目仅用于个人求职效率提升与学习交流，不保证对平台规则的完全合规。使用者应自行评估风险，合理控制调用频率，避免对平台造成压力。因使用本项目导致的账号限制、数据丢失或其他损失，由使用者自行承担。

## License

MIT
