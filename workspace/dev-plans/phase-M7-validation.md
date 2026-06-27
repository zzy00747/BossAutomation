# M7 集成验收与文档

## 目标

按照 `workspace/ZhipinPlan.md` 中的验证清单进行端到端验证，修复发现的问题，输出可复现的验证报告，确保 Dry-run 模式与核心人工验证项可用。

## 参考来源

- `workspace/ZhipinPlan.md`：验证方式、风险与应对

## 依赖前置阶段

- M1-M6 全部完成

## 交付物

- `docs/validation-checklist.md`：逐项验证记录
- Bug 修复与回归测试
- 最终可运行的主分支

## 本阶段子任务

| 任务 ID | 任务名称 | 需要创建/修改的文件 | 依赖 | 验收要点 |
|---------|---------|-------------------|------|---------|
| M7-T1 | 端到端验证清单与问题修复 | `docs/validation-checklist.md` | M6-T5, M6-T6 | 完成至少 8 项手动验证；Dry-run 可跑通；验证码检测可截图暂停 |

## 执行建议

1. 优先验证 Dry-run、CDP 连接、API 字段、报告导出这 4 项核心能力。
2. 验证真实投递时务必在人工确认模式下进行，且只针对 1 个职位。
3. 将每个问题记录为 checklist 中的一行，附上修复 commit 或 issue 链接。
4. 子 Agent Prompt 见 `tasks.json` 对应 `id` 的 `prompt` 字段。

## 阶段验收标准

- `docs/validation-checklist.md` 存在且至少 6 项核心验证标记为通过
- Dry-run 模式能完整跑完一次搜索并生成报告
- 未发现阻塞性 P0/P1 问题
- 所有自动测试通过
