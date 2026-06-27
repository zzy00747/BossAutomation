# M5 投递流程与并发流水线

## 目标

将“搜索 → 详情 → 筛选 → 投递”串成可并发的生产者-消费者流水线，实现打招呼/投递、限流、Dry-run、结果记录，并提供统一的 Orchestrator 入口，支持优雅退出与中断恢复。

## 参考来源

- `workspace/ZhipinPlan.md`：核心流程、并发流水线、打招呼 API、反检测与合规策略

## 依赖前置阶段

- M1 项目脚手架与抽象接口
- M2 浏览器与会话管理
- M3 职位数据获取与解析
- M4 LLM 筛选模块

## 交付物

- `src/platform/boss/apply.ts`：打招呼/投递服务
- `src/pipeline/queues.ts`：队列定义
- `src/pipeline/workers/browser-producer.ts`：职位生产者
- `src/pipeline/workers/detail-fetcher.ts`：详情获取 worker
- `src/pipeline/workers/llm-screener.ts`：筛选 worker
- `src/pipeline/workers/apply-worker.ts`：投递 worker
- `src/pipeline/orchestrator.ts`：主流程编排

## 本阶段子任务

| 任务 ID | 任务名称 | 需要创建/修改的文件 | 依赖 | 验收要点 |
|---------|---------|-------------------|------|---------|
| M5-T1 | 打招呼/投递服务（含 Dry-run） | `src/platform/boss/apply.ts`、测试 | M1-T2, M3-T5, M3-T9, M4-T3 | Dry-run 不投递；真实投递带 suggested_greeting；记录结果 |
| M5-T2 | Pipeline 队列定义 | `src/pipeline/queues.ts`、测试 | M1-T2, M4-T3 | BrowserJob/DetailedJob/ScreenedJob 消息结构；enqueue/dequeue |
| M5-T3 | Browser Producer Worker | `src/pipeline/workers/browser-producer.ts`、测试 | M3-T6, M5-T2 | 循环搜索；去重；黑名单/排除词过滤 |
| M5-T4 | Detail Fetcher Worker | `src/pipeline/workers/detail-fetcher.ts`、测试 | M3-T8, M5-T2 | 并发 3；失败标记；写入 DetailQueue |
| M5-T5 | LLM Screener Worker | `src/pipeline/workers/llm-screener.ts`、测试 | M4-T3, M5-T2 | 并发 5；阈值判定；写入 ShortlistedQueue |
| M5-T6 | Apply Worker 与限流 | `src/pipeline/workers/apply-worker.ts`、测试 | M5-T1, M5-T5 | 串行；日上限；间隔 10-20s |
| M5-T7 | Orchestrator 主流程编排 | `src/pipeline/orchestrator.ts`、集成测试 | M5-T3, M5-T4, M5-T5, M5-T6 | 启动 4 worker；SIGINT 退出；中断恢复；生成报告 |

## 阶段内依赖关系

```text
M5-T2 → M5-T3/T4/T5
M3-T6 → M5-T3
M3-T8 → M5-T4
M4-T3 → M5-T5
M5-T1, M5-T5 → M5-T6
M5-T3, M5-T4, M5-T5, M5-T6 → M5-T7
```

## 执行建议

1. M5-T2 队列定义先完成，四个 worker 可并行开发。
2. 开发 apply worker 时注意日上限与频率限制，优先保证账号安全。
3. Orchestrator 集成测试应使用全套 Mock，验证一次 Dry-run 流程。
4. 子 Agent Prompt 见 `tasks.json` 对应 `id` 的 `prompt` 字段。

## 阶段验收标准

- `apply.ts` 单元测试覆盖 Dry-run、成功、失败路径
- 四个 worker 单元测试覆盖并发、失败、日上限
- `orchestrator.ts` 集成测试通过一次完整 Dry-run
- `npm run test:unit` 与 `npm run test:integration` 全部通过
