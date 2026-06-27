# M3 职位数据获取与解析

## 目标

实现从 Boss 直聘获取职位列表、职位详情、securityId 的完整数据链路，覆盖页面 state、route 拦截、response 监听、CDP、JS 注入、直接 API、DOM 解析共六层降级，并完成字段规范化、去重、硬过滤、请求头模拟与错误分类重试。

## 参考来源

- `workspace/ZhipinPlan.md`：多层数据获取策略、职位 ID 规范化、推荐列表参数与翻页、职位详情双轨获取、securityId 多层解析、请求头/Cookie 完整模拟、分类重试策略

## 依赖前置阶段

- M1 项目脚手架与抽象接口
- M2 浏览器与会话管理（依赖浏览器与 CDP 的部分）

## 交付物

- `src/platform/boss/urls.ts`、`selectors.ts`：URL 与选择器常量
- `src/platform/boss/state-extractor.ts`、`field-detector.ts`：页面状态与字段探测
- `src/platform/boss/normalize.ts`：字段规范化
- `src/platform/boss/cookie-manager.ts`、`request-builder.ts`：Cookie 与请求头
- `src/platform/boss/api.ts`：API 客户端
- `src/platform/boss/search-params.ts`、`search.ts`：参数映射与翻页
- `src/platform/boss/data-collector.ts`：多层数据获取
- `src/platform/boss/job-detail.ts`：详情双轨
- `src/platform/boss/security-id-resolver.ts`：securityId 解析
- `src/platform/boss/errors.ts`、`src/utils/retry.ts`：错误分类与重试

## 本阶段子任务

| 任务 ID | 任务名称 | 需要创建/修改的文件 | 依赖 | 验收要点 |
|---------|---------|-------------------|------|---------|
| M3-T1 | URL/常量与选择器兜底 | `src/platform/boss/urls.ts`、`selectors.ts` | M1-T1, M1-T2 | 覆盖所有 API/页面 URL；选择器常量 |
| M3-T2 | 页面状态抽取与字段探测 | `src/platform/boss/state-extractor.ts`、`field-detector.ts`、测试 | M1-T2, M3-T1 | 从 `__NUXT__`/`__INITIAL_STATE__` 提取 jobList；字段探测 |
| M3-T3 | 职位 ID 与字段规范化 | `src/platform/boss/normalize.ts`、测试 | M1-T2, M3-T2 | 多字段别名 fallback；URL 提取；缺失主键返回 null |
| M3-T4 | CookieManager 与 RequestBuilder | `src/platform/boss/cookie-manager.ts`、`request-builder.ts`、测试 | M1-T2, M2-T1 | 自动提取 Cookie；完整请求头 |
| M3-T5 | BossAPIClient（route 拦截 + 直接请求 fallback） | `src/platform/boss/api.ts`、测试 | M1-T2, M2-T1, M3-T4 | 实现 IBossAPIClient；API 错误封装 |
| M3-T6 | 搜索参数适配器与翻页 | `src/platform/boss/search-params.ts`、`search.ts`、测试 | M1-T2, M3-T1, M3-T5 | 中文→代码映射；page/cursor 自适应；去重 |
| M3-T7 | 多层数据获取器（DataCollector） | `src/platform/boss/data-collector.ts`、测试 | M1-T2, M2-T1, M3-T2, M3-T3 | 六层降级；每层命中数量日志 |
| M3-T8 | 职位详情双轨获取 | `src/platform/boss/job-detail.ts`、测试 | M1-T2, M3-T3, M3-T5 | API+HTML；合并后 postDescription 非空；7 天缓存 |
| M3-T9 | securityId 多层解析 | `src/platform/boss/security-id-resolver.ts`、测试 | M1-T2, M3-T5, M3-T8 | 列表→详情 API→详情页；validate |
| M3-T10 | 错误分类与分类重试执行器 | `src/platform/boss/errors.ts`、`src/utils/retry.ts`、测试 | M1-T2, M2-T8 | 401/403/429/5xx 分类；刷新/人工/退避策略 |

## 阶段内依赖关系

```text
M3-T1 → M3-T2 → M3-T3
M3-T4 → M3-T5
M3-T5 → M3-T6, M3-T8, M3-T9
M3-T2, M3-T3 → M3-T7
M3-T8 → M3-T9
M2-T8 → M3-T10
```

## 执行建议

1. M3-T1/T2/T3/T4 可在 M1 完成后立即开始，不依赖真实浏览器。
2. M3-T5/T6/T7/T8/T9 依赖 M2 的浏览器/CDP 能力，建议 M2 完成后再启动。
3. M3-T10 需要 M2 的 SessionManager，建议放在 M2 之后。
4. 数据解析模块建议编写大量单元测试，fixtures 在 M1-T5 已准备。
5. 子 Agent Prompt 见 `tasks.json` 对应 `id` 的 `prompt` 字段。

## 阶段验收标准

- `search-params.ts` 映射测试全部正确
- `normalize.ts` 对各种字段别名返回一致的 `encryptJobId`
- `data-collector.ts` 单元测试验证六层降级顺序
- `retry.ts` 对 401/403/429 的处理路径测试通过
- `npm run test:unit` 全部通过
- `npm run test:integration` 中 API mock 测试通过
