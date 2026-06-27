# M4 LLM 筛选模块

## 目标

封装多 Provider LLM 客户端，设计 JD 筛选 Prompt 与 Zod 结构化输出，实现带缓存与阈值的筛选服务，并提供 LLM 不可用时的关键词 fallback，为投递流水线提供“是否值得投递”的决策能力。

## 参考来源

- `workspace/ZhipinPlan.md`：LLM JD 筛选设计、技术栈、推荐默认配置

## 依赖前置阶段

- M1 项目脚手架与抽象接口
- 职位详情模块 M3-T8 提供 JD 输入，但 LLM 客户端本身可并行开发

## 交付物

- `src/llm/client.ts`：OpenAI / Anthropic 统一客户端
- `src/llm/schema.ts`：Zod 输出结构
- `src/llm/prompts/jd-screen.ts`：JD 筛选 Prompt
- `src/llm/screener.ts`：筛选服务（缓存 + 阈值 + fallback）
- `src/intent/job-intent.ts`：岗位意图加载

## 本阶段子任务

| 任务 ID | 任务名称 | 需要创建/修改的文件 | 依赖 | 验收要点 |
|---------|---------|-------------------|------|---------|
| M4-T1 | 多 Provider LLM 客户端 | `src/llm/client.ts`、测试 | M1-T2, M1-T3 | 支持 openai/anthropic；JSON mode；错误分类 |
| M4-T2 | JD 筛选 Prompt 与 Zod Schema | `src/llm/prompts/jd-screen.ts`、`src/llm/schema.ts`、测试 | M1-T2, M4-T1 | 纯 JSON 输出；含 few-shot；schema 与 ScreenResult 一致 |
| M4-T3 | LLM Screener 服务（缓存 + 阈值） | `src/llm/screener.ts`、`src/intent/job-intent.ts`、测试 | M1-T2, M4-T2, M3-T8 | 7 天缓存；阈值判定；关键词 fallback |

## 阶段内依赖关系

```text
M4-T1 → M4-T2 → M4-T3
```

## 执行建议

1. M4 可与 M2/M3 并行，只要 M1 完成即可启动 M4-T1/T2。
2. M4-T3 依赖职位详情模块（M3-T8）与存储模块（用于缓存）。如果存储尚未完成，可先使用内存对象或 MockStorage，后续替换。
3. Prompt 工程建议多准备几个 fixtures 做 few-shot，提高输出稳定性。
4. 子 Agent Prompt 见 `tasks.json` 对应 `id` 的 `prompt` 字段。

## 阶段验收标准

- `llm/client.ts` 单元测试覆盖两个 provider 分支
- `llm/schema.ts` 对合法/非法输出解析正确
- `llm/screener.ts` 单元测试覆盖缓存命中、通过、不通过、fallback
- `npm run test:unit` 全部通过
