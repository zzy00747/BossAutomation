# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库概览

本仓库用于开发一个 **Boss 直聘（zhipin.com）自动投递 Agent**。这是一个纯 AI 生成的项目，开发唯一依据是 `workspace/ZhipinPlan.md` 和 `workspace/dev-plans/`。`ReferenceProject/` 下的两个项目仅作参考，不要把它们当作正式开发目标去修改。

当前仓库包含：

- `workspace/ZhipinPlan.md` —— TypeScript + Playwright + LLM Agent 的最终实施方案。
- `workspace/dev-plans/` —— 将方案拆分为 7 个阶段、40 个可交给子 Agent 执行的任务。
- `ReferenceProject/mcp-bosszp/` —— 参考实现：求职者端 FastMCP 服务（登录、推荐职位、打招呼）。
- `ReferenceProject/boss-zhipin-mcp/` —— 参考实现：招聘者端 FastMCP 服务（候选人搜索、评分、报告导出）。

真正的 TypeScript 项目尚未创建，其预期架构和命令见 `workspace/ZhipinPlan.md` 与 `workspace/dev-plans/`。

## 会话工作流

1. **启动时先确认进度。** 每次会话开始时，阅读 `workspace/dev-plans/README.md` 和 `workspace/dev-plans/tasks.json`，了解哪些阶段/任务处于 pending、in-progress 或 completed 状态。
2. **选择下一个任务。** 优先选择依赖已满足的任务。执行子 Agent 时，可直接使用 `tasks.json` 中对应任务的 `prompt` 字段内容。
3. **退出时保存进度。** 会话结束前，把当前开发进度写入 memory，方便下一次启动恢复：
   - 写入 `C:\Users\Administrator\.claude\projects\E--Claude-Bossautomation-DesktopAPP\memory\` 下的一个笔记文件。
   - 在 `C:\Users\Administrator\.claude\projects\E--Claude-Bossautomation-DesktopAPP\memory\MEMORY.md` 中添加一行指向该笔记的索引。
   - 笔记内容应包括：已完成的任务 ID、当前阻塞、下一步推荐任务。

## 项目宪法

### 核心铁律（违反即失败）

1. **每次改动必须通过测试。** 完成任何代码修改后，必须运行 `npm test` 或相关测试文件。测试不通过 = 任务未完成。如果测试本身有问题，先修测试再修代码。
2. **小步提交，每完成一个可验证的功能点就 commit。** Commit message 格式：`[模块] 动词: 具体描述`，例如 `[browser] 实现 CDP 端口自动探测`、`[llm] 添加 JD 筛选 fallback 关键词匹配`。每个 commit 必须是可编译、可运行的状态，禁止一个大 commit 包含多个不相关的改动。
3. **遇到失败必须记录。** 任何花费超过 5 分钟才解决的问题，必须记录到 `docs/known-issues.md`，格式：`## [日期] 问题描述 → 根本原因 → 解决方案 → 预防措施`。如果是通用模式，提取为 Skill 放到 `.claude/skills/`。
4. **永不硬编码敏感信息。** API Key、Cookie、token 等一律通过 `.env` 读取；代码中只出现 `process.env.XXX` 或 `config.xxx`。发现现有代码有硬编码，立即修复。
5. **修改 API 相关代码必须更新字段映射文档。** 任何涉及 API 端点、请求参数、响应字段的修改，同步更新 `docs/api-field-mapping.md`。
6. **更新项目级内容后必须同步更新所有相关说明文件。** 任何涉及 Skill、脚本、命令、目录结构、依赖配置、开发流程、版本说明的变更，都要检查并同步更新 `CLAUDE.md`、`README.md`、版本说明、依赖配置文件（如 `package.json`、`requirements.txt`）等，确保文档与项目现状一致。

### 标准工作流

理解需求 → 阅读相关代码 → 确认影响范围 → 写/改代码 → 写/改测试（不可跳过） → 运行测试。

- 通过 → `git add` + `git commit`。
- 未通过 → 修复后回到测试步骤。

遇到困难时：

- 5 分钟内解决 → 继续。
- 超过 5 分钟 → 记录到 `docs/known-issues.md`，并考虑包装为 Skill。

### 错误学习机制

当 Agent 在完成任务过程中遇到以下情况时，必须执行“错误记录”流程：

- 代码运行报错，且排查超过 3 轮才修复
- 发现 API 行为与预期/文档不一致
- 同一个类型的错误出现了 2 次

执行流程：

1. **判断错误类型**
   - 是“一次性知识”（如某个 API 的特殊行为）→ 记录到 `docs/known-issues.md`
   - 是“可复用的操作流程”（如登录、API 逆向、加表）→ 包装为 Skill

2. **记录到 `docs/known-issues.md`**，格式：
   ```markdown
   ### [日期] 问题简短标题
   - **现象**：发生了什么
   - **根因**：为什么会发生
   - **解决**：怎么修好的
   - **预防**：以后怎么避免
   ```

3. **包装为 Skill（如果是可复用流程）**
   - 在 `.claude/skills/` 下创建新的 `.md` 文件
   - 格式参考已有的 skill 文件
   - 告知用户新 skill 已创建

4. **更新 `CLAUDE.md`（如果是通用规则）**
   - 在“已知易错点”部分新增一条
   - 保持简洁，一句话说清楚问题和解决方案

### Git 工作流

#### 分支策略

- `main`：稳定分支，永远可运行。
- `feat/xxx`：功能分支，从 `main` 切出。
- `fix/xxx`：修复分支，从 `main` 切出。

#### Commit 规范

每个 commit 必须满足：

1. **单一职责**：一个 commit 只做一件事。
2. **可编译**：`npx tsc --noEmit` 通过。
3. **测试通过**：`npm test` 通过。

Commit message 格式：`[模块] 动词: 具体描述`，例如 `[browser] 实现验证码自动检测与截图暂停`。

#### 工作流示例

Agent 接到任务“实现验证码检测功能”：

```bash
# Step 1: 创建分支
git checkout -b feat/verification-detection

# Step 2: 写代码
# 创建 src/browser/verification.ts

# Step 3: 写测试
# 创建 tests/unit/verification.test.ts

# Step 4: 运行测试
npm test

# Step 5: 测试通过 → 提交
git add src/browser/verification.ts tests/unit/verification.test.ts
git commit -m "[browser] 实现验证码自动检测与截图暂停"

# Step 6: 如果遇到坑 → 记录
# 编辑 docs/known-issues.md
git add docs/known-issues.md
git commit -m "[docs] 记录验证码选择器兼容性问题"
```

#### 禁止操作

- ❌ `git push --force` 到 `main`
- ❌ 跳过测试直接 commit
- ❌ 一个大 commit 包含 5 个不相关的文件修改
- ❌ commit message 写 `"fix"` 或 `"update"` 这种无意义内容

### 模块边界

修改代码前必须确认所属模块及依赖关系。

| 模块 | 文件范围 | 职责 | 依赖 |
|------|---------|------|------|
| browser | `src/browser/` | 浏览器生命周期、反检测、人类行为模拟 | 无 |
| platform/boss | `src/platform/boss/` | Boss 直聘特定 API 和 DOM 逻辑 | browser |
| llm | `src/llm/` | LLM 调用、筛选逻辑 | 无 |
| storage | `src/storage/` | SQLite 操作 | 无 |
| pipeline | `src/pipeline/` | 编排所有模块 | 以上所有 |
| report | `src/report/` | 报告导出 | storage |

- 修改一个模块时，检查是否有其他模块依赖它。
- 如果修改了接口/类型，必须同步更新 `src/types.ts`。

### 测试规范

#### 单元测试

- 每个模块的核心函数必须有单元测试。
- 使用 mock 隔离外部依赖（浏览器、网络、LLM）。
- 测试文件命名：`xxx.test.ts`，放在 `tests/` 目录下。

#### 集成测试

- 使用 HAR 文件或 MSW handler 模拟真实网络响应，fixture 放在 `tests/fixtures/`。
- 不要依赖真实的 Boss 直聘网站。

#### 运行测试

- `npm test` —— 运行所有测试
- `npm run test:unit` —— 只运行单元测试
- `npm run test:integration` —— 只运行集成测试

### Skill 使用规则

#### 何时使用 Skill

- 需要反向工程 API 参数 → 调用 `api-reverse` skill
- 需要处理 Playwright 登录 → 调用 `playwright-login` skill
- 需要新增数据库表 → 调用 `add-sqlite-table` skill
- 需要查询 Claude API / Anthropic SDK 用法 → 调用 `claude-api` skill
- 需要用 Playwright 测试本地 web 应用 → 调用 `webapp-testing` skill
- 需要创建/改进/评估 Skill → 调用 `skill-creator` skill
- 需要为新模块或修改写测试 → 调用 `write-test` skill

#### 何时创建新 Skill

- 同一个操作模式出现了 2 次以上
- 解决方案足够通用，可在其他场景复用
- 步骤多、容易出错的流程

创建 Skill 时使用 `/skill` 命令。

### 已知易错点（每次编码前必读）

#### Boss 直聘 API 相关
1. **`encryptJobId` 与 `securityId` 不要混淆。** 推荐列表返回 `encryptJobId`，但沟通/打招呼接口需要 `securityId`，两者不同，必须在详情页获取 `securityId`。
2. **API 字段名不一致。** 同一字段在不同接口中可能叫 `jobId`/`encryptId`/`id`，翻页可能是 `page`、`cursor` 或 `lastId`，务必以实际响应为准并查阅 `docs/api-field-mapping.md`。
3. **直接 API 请求必须带 `Referer`。** 如果请求头缺少 `Referer: https://www.zhipin.com/`，容易被风控返回 403。
4. **`__zp_stoken__` 可能是 HttpOnly。** 从 `document.cookie` 中可能读不到，需要用 Playwright 的 `context.cookies()` API 获取。

#### Playwright 相关
5. **`page.route()` 默认可能漏掉 `fetch` 请求。** 部分请求通过 `fetch()` 发起，建议显式匹配 `**/*`，必要时用 `page.evaluate()` 注入拦截器。
6. **有头模式下的窗口焦点。** Windows 上有头模式如果窗口最小化，某些 `waitForSelector` 可能超时，建议保持窗口可见。
7. **CDP 端口冲突。** 如果 Chrome 已经在运行但没有带 `--remote-debugging-port`，需要先关闭再重新启动，否则 session 数据目录会被锁定。

#### SQLite 相关
8. **并发写入导致 `SQLITE_BUSY`。** 默认 `journal_mode` 是 delete，必须改为 WAL 模式（`PRAGMA journal_mode=WAL`），且所有写入通过队列序列化。
9. **JSON 字段查询语法。** SQLite 不支持 `->` 操作符，需用 `json_extract(col, '$.key')`。

#### LLM 相关
10. **LLM JSON 输出不稳定。** 必须用 Zod 校验 + 重试机制，且 Prompt 中至少提供 2 个示例。

### 技术栈约定

- **禁止**引入新依赖而不说明原因，优先使用项目已有库。
- TypeScript 开启 strict 模式。
- 所有异步操作使用 async/await。
- 错误处理使用 try-catch + 日志，不要吞异常。

## 常用命令

### 参考 Python MCP 服务

两个参考项目都使用 Python 3.12+ 和 Playwright。

```bash
# mcp-bosszp（求职者端）
cd ReferenceProject/mcp-bosszp
pip install -r requirements.txt
playwright install chromium
python boss_zhipin_fastmcp_v2.py

# boss-zhipin-mcp（招聘者端）
cd ReferenceProject/boss-zhipin-mcp
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
python server.py
```

### 计划中的 TypeScript Agent（尚未实现）

`workspace/ZhipinPlan.md` 中的项目实现后，预期命令如下，具体以生成的 `package.json` 为准：

```bash
npm install
npm run test          # vitest
npm run test:unit
npm run test:integration
npm run test:coverage
npm run build         # tsc 编译
npm start             # 运行 CLI 入口
```

## 高层架构

### 参考项目

两个参考实现遵循同一模式：

- **FastMCP server** 暴露 tools/resources，例如 `login_full_auto`、`get_recommend_jobs`、`greet_boss_tool`、`boss_search_candidates`。
- **Playwright + CDP** 连接已登录的 Chrome（`--remote-debugging-port=9222`），或在未检测到时自动启动系统 Chrome。
- **直接 HTTP 请求** 访问 `www.zhipin.com/wapi/...`，携带从浏览器提取的 Cookie 和请求头。
- **本地持久化** 保存运行状态，例如 `candidates_db.json`、cookie 文件、`static/` 二维码图片。

`mcp-bosszp` 重点：

- 二维码登录 + 后台轮询。
- AES-128-CBC 设备指纹（`fp`）生成。
- 通过 `security-check.html` 自动获取 `__zp_stoken__`。
- 调用 `/wapi/zpgeek/pc/recommend/job/list.json` 和 `/wapi/zpgeek/friend/add.json`。

`boss-zhipin-mcp` 重点：

- 招聘者后台 SPA/iframe 页面中的候选人搜索。
- 多关键词批量搜索 + 跨关键词去重。
- 以 `expectId` 为键的 JSON 候选人数据库。
- 通过 `search_profile.yaml` 驱动的过滤与评分。
- Markdown 报告导出。

### 计划中的 TypeScript Agent（`workspace/ZhipinPlan.md`）

计划采用接口驱动的分层架构：

- **Interfaces**（`src/interfaces/*.ts`）：抽象 `IBrowserDriver`、`IPage`、`IBossAPIClient`、`ILLMClient`、`IJobStorage`，便于 mock 和测试注入。
- **Browser 层**（`src/browser/`）：CDP 连接、页面池、人类行为模拟、反检测补丁、验证码检测。
- **Platform 层**（`src/platform/boss/`）：Boss 直聘专属逻辑，包括 URL、选择器、页面状态抽取、职位规范化、Cookie/请求头构造、API 客户端、搜索翻页、详情获取、securityId 解析、错误分类、登录/会话管理。
- **LLM 层**（`src/llm/`）：兼容 OpenAI/Anthropic，使用 Zod 校验的 Prompt 进行 JD 筛选。
- **Storage 层**（`src/storage/`）：SQLite + WAL + 写入队列，用于去重、状态流转、LLM 缓存、日报统计。
- **Pipeline 层**（`src/pipeline/`）：生产者-消费者流水线：`BrowserProducer → DetailFetcher → LLMScreener → ApplyWorker`，由 `Orchestrator` 编排。

关键设计决策：

- **CDP 优先登录**，二维码登录作为兜底。
- **多层数据获取**：`window.__NUXT__` / `__INITIAL_STATE__` → `page.route()` → `page.on('response')` → CDP Network → JS 注入 → 直接 API → DOM 解析。
- **详情双轨获取**：优先 API 详情，HTML 详情页兜底补充。
- **分类重试**：401 刷新会话、403 暂停等待人工、429 退避并降速。
- **默认 Dry-run 模式** 与低频率限制，保护账号安全。

## 现有文档中的重要细节

### `mcp-bosszp`（求职者端）

- 入口：`python boss_zhipin_fastmcp_v2.py`。
- 登录流程：`randkey` → 二维码图片 → scan/scanLogin 轮询 → dispatcher（带 `fp`）→ `security-check.html` 获取 `__zp_stoken__`。
- `fp` 使用 AES-128-CBC/PKCS7，基于硬编码/base64 key 对明文加密生成。
- `get_recommend_jobs_tool` 接收中文经验/类型/薪资字符串，后端映射为数字代码。
- `greet_boss_tool` 需要 `security_id` 和 `job_id`。

### `boss-zhipin-mcp`（招聘者端）

- 入口：`python server.py`。
- 需要 Chrome 已登录 Boss 直聘**招聘者**账号。
- 使用 `search_profile.yaml` 配置岗位/关键词/过滤/评分（`cp search_profile.example.yaml search_profile.yaml`）。
- 主流程：`boss_multi_search(auto_view=True)` → `boss_filter_and_score(top_n=15)` → `boss_export_report(top_n=15)`。
- 数据库为 `candidates_db.json`，状态流转：`new → shortlisted → viewed → greeted`。
- 如果系统有代理（如 Clash），MCP 配置中需加 `"env": { "NO_PROXY": "localhost,127.0.0.1" }`，否则 localhost CDP 会返回 `400`。
- 简历使用 Canvas 渲染，工具通过截图方式获取内容。

### `workspace/ZhipinPlan.md` 与 `workspace/dev-plans/`

- `ZhipinPlan.md` 是 TypeScript Agent 实现的权威依据。
- `dev-plans/` 将其拆成 7 个阶段、40 个可执行任务；`tasks.json` 中每个任务包含依赖、交付物、验收标准和可直接复制给子 Agent 的 prompt。
- 开始实现 TypeScript 项目前，先阅读 `ZhipinPlan.md` 和对应的 `phase-M*.md`。

## 其他说明

- 本仓库没有 Cursor 规则（`.cursorrules` 或 `.cursor/rules/`）或 GitHub Copilot 指令（`.github/copilot-instructions.md`）。
- 不要把参考 Python 项目当作最终产品；它们仅用于提供 API 端点、登录流程细节和工程模式，供计划中的 TypeScript Agent 参考。
- 编辑 `ReferenceProject/` 下的文件时，保持改动隔离，确保它们继续可用作参考。
