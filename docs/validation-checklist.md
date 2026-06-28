# Boss 直聘自动投递 Agent 验证清单

本清单依据 `workspace/ZhipinPlan.md` 中“验证方式”章节制定。标记规则：

- ✅ 通过：已通过自动化测试或可在当前环境复现验证
- ⏳ 待人工验证：需要真实 Chrome + Boss 直聘账号环境，当前 CI/ headless 无法覆盖
- ❌ 未通过：发现问题，已记录并在修复后重新验证

## 自动验证（CI 可覆盖）

### 1. Dry-run 模式可完整跑通一次搜索

- **状态**：✅ 通过
- **验证方式**：运行集成测试 `src/test/integration/main.spec.ts` 中“完整 Dry-run 流程”用例
- **结果**：`npm test` 通过，367 个测试全部 green；Dry-run 模式下 `greetBoss` 不会被调用，storage 正确记录 `status=applied, skipReason=dry-run`
- **日志/路径**：`npm run test:integration`

### 2. 报告导出

- **状态**：✅ 通过
- **验证方式**：单元测试 `src/test/unit/report/exporter.spec.ts` + 集成测试 `main.spec.ts`
- **结果**：Markdown 报告包含统计摘要、投递状态表、Top N 职位卡片；CSV 字段与数据库一致；文件输出到 `data/reports/daily-report-{date}.md` 与 `jobs-{date}.csv`

### 3. 并发流水线

- **状态**：✅ 通过
- **验证方式**：单元测试 `src/test/unit/pipeline/*.spec.ts` + 集成测试 `src/test/integration/pipeline/orchestrator.spec.ts`
- **结果**：BrowserProducer → DetailFetcher → LLMScreener → ApplyWorker 正常协作，无资源冲突；队列关闭链正确

### 4. 分类重试

- **状态**：✅ 通过
- **验证方式**：单元测试 `src/test/unit/utils/retry.spec.ts` 与 `src/test/unit/platform/errors.spec.ts`
- **结果**：401 触发刷新会话、403 触发人工介入、429 触发退避并降速、网络错误指数退避

### 5. API 字段与响应解析

- **状态**：✅ 通过
- **验证方式**：单元测试 `src/test/unit/platform/api.spec.ts` + 集成测试 `src/test/integration/platform/api.spec.ts`（MSW 拦截）
- **结果**：`encryptJobId`、`securityId` 等字段正确解析；`zpData` 解包正常；403/业务错误正确抛出 `BossAPIError`

### 6. 多层数据获取策略

- **状态**：✅ 通过（代码层面 + 单元测试）
- **验证方式**：审查 `src/platform/boss/data-collector.ts` 与相关测试
- **结果**：state → route → response → CDP Network → JS 注入 → 直接 API → DOM 解析六层降级链路已实现，单元测试覆盖各层 fallback

## 需真实浏览器/账号环境验证

### 7. CDP 连接

- **状态**：⏳ 待人工验证
- **验证步骤**：
  1. 启动 Chrome：`chrome --remote-debugging-port=9222 --user-data-dir=data/chrome-profile`
  2. 访问 `http://localhost:9222/json/version` 确认返回 JSON
  3. 运行 `npm run dev`，观察日志是否输出 `CDP 连接成功`
- **预期结果**：Agent 成功复用已登录浏览器上下文

### 8. 二维码登录兜底

- **状态**：⏳ 待人工验证
- **验证步骤**：关闭 CDP Chrome，设置无可用端口，运行 Agent
- **预期结果**：自动启动裸 Chromium，展示二维码，扫码后保存 session 到 `data/session/boss.json`

### 9. 登录态刷新

- **状态**：⏳ 待人工验证
- **验证步骤**：长时间运行或手动清除关键 Cookie，观察 SessionManager 行为
- **预期结果**：检测到登录过期后自动 reconnect 或触发重新登录

### 10. securityId 解析

- **状态**：⏳ 待人工验证
- **验证步骤**：对单个职位运行详情获取流程
- **预期结果**：推荐列表只有 `encryptJobId`，详情页/接口能正确拿到 `securityId` 并用于打招呼

### 11. 详情双轨获取

- **状态**：⏳ 待人工验证
- **验证步骤**：对比 API 详情与 HTML 详情页兜底补充后的字段
- **预期结果**：合并后数据完整，包含 `postDescription`、`skills`、`welfareList` 等

### 12. 验证码/反爬检测

- **状态**：⏳ 待人工验证
- **验证步骤**：人为触发验证页面（如频繁刷新）
- **预期结果**：自动截图保存到 `SCREENSHOT_DIR`，Agent 暂停等待人工处理

### 13. 单职位真实投递

- **状态**：⏳ 待人工验证
- **验证步骤**：
  1. 在 `.env` 设置 `DRY_RUN=false`
  2. 设置 `APPLY_DAILY_LIMIT=1`
  3. 选择 1 个高匹配职位，人工确认后运行 `npm start`
- **预期结果**：成功发起沟通，storage 记录 `status=applied` 与 `appliedAt`
- **风险提示**：此操作会真实投递，请务必在低频率、个人账号可接受风险范围内进行

## 回归测试命令

```bash
npx tsc --noEmit
npm test
npm run test:coverage
```

## 已知问题与修复

| 问题 | 状态 | 修复提交 |
|------|------|---------|
| 暂无阻塞性问题 | - | - |

## 结论

- 自动验证项：6 项全部通过
- 待人工验证项：7 项，需真实 Chrome + Boss 直聘账号环境
- 当前无阻塞性 P0/P1 问题
- 项目满足 `workspace/ZhipinPlan.md` 中 Dry-run、API 字段、报告导出、并发流水线、分类重试等核心自动验证要求
