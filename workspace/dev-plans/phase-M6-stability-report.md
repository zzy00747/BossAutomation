# M6 稳定性、报告与测试

## 目标

补齐持久化存储、报告导出、内存管理、主 CLI 入口、完整测试覆盖与文档，让 Agent 达到可稳定运行、可观测、可维护的状态。

## 参考来源

- `workspace/ZhipinPlan.md`：SQLite WAL 模式与并发写入、SQLite 数据库设计、内存管理、报告导出、测试工程化、README/免责声明

## 依赖前置阶段

- M1-M5 全部或核心模块已完成

## 交付物

- `src/storage/store.ts`、`src/storage/write-queue.ts`：SQLite 存储
- `src/report/exporter.ts`：Markdown/CSV 报告
- `src/utils/memory-monitor.ts`、`src/utils/screenshot-cleanup.ts`：内存与截图清理
- `src/main.ts`：CLI 入口
- 完整单元/集成测试与 README

## 本阶段子任务

| 任务 ID | 任务名称 | 需要创建/修改的文件 | 依赖 | 验收要点 |
|---------|---------|-------------------|------|---------|
| M6-T1 | SQLite 存储与写入队列 | `src/storage/store.ts`、`src/storage/write-queue.ts`、测试 | M1-T2, M1-T3 | WAL、busy_timeout、IJobStorage 实现、并发写入 |
| M6-T2 | 报告导出（Markdown/CSV） | `src/report/exporter.ts`、测试 | M6-T1 | 统计摘要、状态表、Top N、CSV |
| M6-T3 | 内存管理与截图清理 | `src/utils/memory-monitor.ts`、`src/utils/screenshot-cleanup.ts`、修改 `manager.ts` | M2-T1, M2-T2, M6-T1 | 内存监控、截图过期清理、浏览器定时重启 |
| M6-T4 | 主 CLI 入口与运行模式 | `src/main.ts`、集成测试 | M5-T7, M6-T2, M6-T3 | Dry-run 默认、全局错误、报告输出 |
| M6-T5 | 补全单元与集成测试 | 新增集成测试、修改 `vitest.config.ts`、`package.json` | M6-T4 | unit+integration 通过；覆盖率 70% |
| M6-T6 | README、免责声明与运行手册 | `README.md` | M6-T4 | 配置/命令/验证/免责声明完整 |

## 阶段内依赖关系

```text
M6-T1 → M6-T2
M2-T1/T2, M6-T1 → M6-T3
M5-T7, M6-T2, M6-T3 → M6-T4
M6-T4 → M6-T5, M6-T6
```

## 执行建议

1. M6-T1 存储应尽早完成，因为 M2-M5 中多处依赖 storage；如果前面阶段使用 MockStorage，本阶段需要替换并回归测试。
2. M6-T5 覆盖率目标 70%（lines/functions/statements），建议逐步提高阈值。
3. README 必须包含免责声明，明确仅个人求职学习使用。
4. 子 Agent Prompt 见 `tasks.json` 对应 `id` 的 `prompt` 字段。

## 阶段验收标准

- `npm run test:unit` 全部通过
- `npm run test:integration` 全部通过
- `npm run test:coverage` 达到 70%
- `src/main.ts` 可运行 Dry-run 模式
- `README.md` 完整且包含免责声明
