# M1 项目脚手架与抽象接口

## 目标

搭建 Node.js + TypeScript 项目骨架，统一配置、日志、接口定义与测试基础设施，让后续所有模块可以并行开发、测试和依赖注入。

## 参考来源

- `workspace/ZhipinPlan.md`：推荐技术方案、目录结构、测试工程化、抽象接口

## 交付物

- 可运行的项目依赖与脚本
- 核心抽象接口（IBrowserDriver/IPage/IBossAPIClient/ILLMClient/IJobStorage）
- 类型定义与配置加载器
- pino 日志封装
- Vitest + MSW + Mock 实现

## 本阶段子任务

| 任务 ID | 任务名称 | 需要创建/修改的文件 | 依赖 | 验收要点 |
|---------|---------|-------------------|------|---------|
| M1-T1 | 初始化项目脚手架与依赖 | `package.json`、`tsconfig.json`、`vitest.config.ts`、`.env.example`、`.gitignore`、`README.md` | - | `npm install`、`npx tsc --noEmit`、`npm run test` 通过 |
| M1-T2 | 定义核心类型与抽象接口 | `src/types.ts`、`src/interfaces/*.ts` | M1-T1 | 接口覆盖 plan 中方法签名，类型与数据库 schema 对应 |
| M1-T3 | 实现配置加载与环境校验 | `src/config.ts`、单元测试 | M1-T1, M1-T2 | 支持 `.env`，默认值符合推荐配置，非法值报错 |
| M1-T4 | 实现 pino 日志与截图辅助 | `src/logger.ts`、单元测试 | M1-T1, M1-T3 | 日志分级、子 logger、错误结构化字段 |
| M1-T5 | 初始化测试基础设施与 Mock | `src/test/fixtures/*`、`src/test/msw/handlers.ts`、`src/test/__mocks__/*`、`vitest.setup.ts` | M1-T2, M1-T3 | MSW 启用、Mock 实现接口、fixtures 可用 |

## 执行建议

1. M1-T1 必须最先完成，否则后续子 Agent 无法安装依赖。
2. M1-T2 与 M1-T1 可部分并行，但建议先完成 M1-T1 的 `tsconfig.json` 与目录结构。
3. M1-T5 依赖 M1-T2 的接口定义，是后续所有模块单元测试的基础。
4. 每个子任务的完整 **子 Agent Prompt** 位于 `tasks.json` 中对应 `id` 的 `prompt` 字段，可直接复制给 `Agent` 工具执行。

## 阶段验收标准

- `npm install` 成功
- `npx tsc --noEmit` 无类型错误
- `npm run test` 至少有一个占位测试通过
- 所有接口与类型可在测试中被实现
