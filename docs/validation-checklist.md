# Boss 直聘自动投递 Agent 验证清单

本清单依据 `workspace/ZhipinPlan.md` 中“验证方式”章节制定。标记规则：

- ✅ 通过：已通过自动化测试或可在当前环境复现验证
- ⏳ 待人工验证：需要真实 Chrome + Boss 直聘账号环境，当前 CI/ headless 无法覆盖
- ❌ 未通过：发现问题，已记录并在修复后重新验证

## 自动验证（CI 可覆盖）

### 1. Dry-run 模式可完整跑通一次搜索

- **状态**：✅ 通过
- **验证方式**：运行集成测试 `src/test/integration/main.spec.ts` 中“完整 Dry-run 流程”用例；同时真实运行 `npm run dev`
- **结果**：
  - `npm test` 通过，367 个测试全部 green
  - 真实运行 `npm run dev`（DRY_RUN=true）成功：CDP 连接 → 搜索职位 → 去重 → 流水线 → 报告导出
  - 控制台输出：`报告路径: data\reports\daily-report-2026-06-28.md`
- **日志/路径**：`npm run test:integration`、`npm run dev`

### 2. 报告导出

- **状态**：✅ 通过
- **验证方式**：单元测试 `src/test/unit/report/exporter.spec.ts` + 集成测试 `main.spec.ts` + 真实 Dry-run 运行
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

## 已人工验证（真实 Chrome + Boss 直聘账号）

### 7. CDP 连接

- **状态**：✅ 通过
- **验证步骤**：
  1. 启动 Chrome：`chrome --remote-debugging-port=9222 --user-data-dir=data/chrome-profile`
  2. 访问 `http://localhost:9222/json/version` 确认返回 JSON
  3. 运行 `npm run dev`，日志输出 `CDP 连接成功`
- **结果**：Agent 成功复用已登录浏览器上下文
- **注意**：运行结束后浏览器上下文会被 Agent 断开；下次运行需重新启动 Chrome

### 8. 二维码登录兜底

- **状态**：⚠️ 部分通过
- **验证步骤**：关闭 CDP Chrome，设置无可用端口，运行 Agent
- **结果**：
  - ✅ 自动启动裸 Chromium
  - ✅ 展示二维码、扫码成功、用户确认
  - ✅ dispatcher 返回 200
  - ✅ security-check 页面成功获取 `__zp_stoken__`
  - ❌ 后续 `loginWithQR` 因 `cookies` 为空字符串判断失败，未返回登录成功
- **修复**：见 `docs/known-issues.md` 2026-06-28 二维码登录 cookies 为空

### 9. 登录态刷新

- **状态**：✅ 通过（页面刷新路径）
- **验证步骤**：首次运行 `npm run dev` 时，SessionManager.checkLoginState 被调用
- **结果**：登录态检查通过，未触发激进 reconnect；refreshSession 优先尝试页面刷新，避免流水线运行时断开整个浏览器上下文

## 仍需进一步验证/优化

### 10. securityId 解析

- **状态**：⏳ 待验证
- **阻塞**：详情 API 在高频/连续请求下触发 `code 37 您的环境存在异常`，需要实现动态 security-check stoken 刷新
- **预期结果**：推荐列表只有 `encryptJobId`，详情页/接口能正确拿到 `securityId` 并用于打招呼

### 11. 详情双轨获取

- **状态**：⏳ 待验证
- **阻塞**：同 securityId 解析，API 详情受风控限制
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
| `src/main.ts` 入口判断在 `tsx` 下失效，`main()` 未执行 | ✅ 已修复 | `7673194` |
| 详情 API 缺少 `lid` 参数导致 code 17 | ✅ 已修复 | `7673194` |
| HTML 详情 `page.evaluate` 因 tsx 转译产生 `__name` 辅助函数报错 | ✅ 已修复 | `7673194` |
| security-check 页面禁止读取 `document.cookie` 导致 QR 登录异常 | ✅ 已修复 | `7673194` |
| SessionManager 运行中 reconnectCDP 会断开整个浏览器上下文 | ✅ 已缓解 | `7673194` |
| config 测试受 `.env` 文件影响 | ✅ 已修复 | `7673194` |
| 连续/高频请求触发 `code 37 您的环境存在异常` | ⏳ 待处理 | - |
| QR 登录 dispatcher 后 cookieJar 为空导致 `cookies` 空字符串 | ⏳ 待处理 | - |

## 结论

- **自动验证项**：6 项全部通过
- **已人工验证项**：2 项通过（CDP 连接、登录态检查），1 项部分通过（二维码登录）
- **待处理**：code 37 风控动态刷新、QR 登录 cookie 收集
- **当前状态**：Dry-run 模式可完整跑通搜索并生成报告；真实投递受 Boss 直聘风控限制，需进一步处理 security-check 动态刷新
