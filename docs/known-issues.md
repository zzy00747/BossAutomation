# 已知问题与易错点

## 2026-06-28 Zod union + transform 解析 LLM JSON 失败

- **现象**：用 `z.union([schemaA.transform(...), schemaB.transform(...)])` 同时兼容 camelCase / snake_case 的 LLM 输出时，合法输入（如 `redFlags: []`）被判定为 `Invalid input`，导致 screener 全部降级到关键词 fallback。
- **根因**：Zod 的 `z.union` 对两个都含 `.transform` 的对象 schema 存在歧义解析——它会尝试每个分支但 transform 改变了类型，导致空数组等边界值匹配失败。错误信息（`[] Invalid input`）也未暴露具体字段，难以定位。
- **解决**：放弃 union-of-transforms，改为 `z.preprocess(normalizeKeys, camelCaseSchema)`：先用 preprocess 把 snake_case 键统一转 camelCase，再喂给单一对象 schema 校验。键映射用纯对象查表，不依赖 union。
- **预防**：LLM 返回的是**字符串**（`response.content`），parse 时必须先 `JSON.parse` 再过 schema；schema 函数应同时接受 string 与 object。验证 LLM 链路时，先用 `parseScreenResult(JSON.stringify(fixture))` 单独跑通，再接入 screener，可快速隔离“解析失败”与“未调用 LLM”两类问题。

## 2026-06-28 Anthropic SDK create 返回类型为联合类型

- **现象**：`anthropic.messages.create(...)` 在 TypeScript strict 下返回 `(Stream<...> & {...}) | (Message & {...})`，直接访问 `.content` / `.usage` 报错 `Property does not exist on type Stream`。
- **根因**：SDK 的 `create` 同时支持流式与非流式，返回联合类型；TypeScript 无法从参数推断出非流式分支。
- **解决**：对返回值显式断言 `as Anthropic.Message`（先经 `as unknown as MessageCreateParams` 转入参）。
- **预防**：调用 LLM SDK 时优先查返回类型；遇到 union+stream 类型，显式断言非流式分支，避免 noUncheckedIndexedAccess / strict 下的误报。
