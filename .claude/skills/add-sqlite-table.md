---
name: add-sqlite-table
description: |
  当你需要新增 SQLite 表、修改表结构、添加 CRUD 方法或调整字段类型时必须使用本 Skill。
  任何涉及 `src/storage/store.ts` 的 schema 变更，都应先读此 Skill，确保 WAL、幂等、主键类型、JSON 字段处理一致。
compatibility: |
  使用 `better-sqlite3` 作为 SQLite 驱动，项目需开启 TypeScript strict 模式。
---

# Skill: 新增 SQLite 表

## 用途

本 Skill 规范了在项目中新增或修改 SQLite 表的完整步骤。Boss 直聘 Agent 的核心状态（投递记录、去重、LLM 缓存、黑名单、日报统计）都依赖 SQLite，schema 变更必须统一、幂等、可测试。

## 何时使用

- 需要新增一张表来存储新实体
- 需要为现有表新增/删除/修改字段
- 需要为某张表添加新的 CRUD 方法
- 需要调整字段类型（例如把字符串主键从 INTEGER 改为 TEXT）
- 需要新增索引或外键约束

## 步骤

1. **在 `src/storage/store.ts` 中添加 `CREATE TABLE IF NOT EXISTS` 语句。**
   - 必须使用 `IF NOT EXISTS`，避免重复启动时报错。
   - 表名使用小写 snake_case。

2. **选择正确的主键类型。**
   - Boss 直聘的职位 ID（`encryptJobId`）、公司 ID 等都是字符串，主键用 `TEXT`。
   - 自增 ID 仅在内部无业务含义时使用 `INTEGER PRIMARY KEY AUTOINCREMENT`。

3. **设计字段。**
   - 字符串：`TEXT`
   - 整数：`INTEGER`
   - 浮点数：`REAL`
   - 布尔：用 `INTEGER`（0/1）
   - JSON 数组/对象：用 `TEXT`，读写时用 `JSON.parse/JSON.stringify`
   - 时间：用 `TEXT` ISO 8601 格式（如 `2026-06-27T12:00:00Z`）

4. **添加对应的 TypeScript 类型到 `src/types.ts`。**
   - 类型名与表名对应，字段名使用 camelCase。

5. **在 `JobStorage` 类中添加 CRUD 方法。**
   - 查询类方法可同步返回。
   - 写入类方法应通过 `SQLiteWriteQueue` 序列化，避免并发冲突。

6. **编写单元测试。**
   - 使用内存数据库 `:memory:` 或临时文件。
   - 覆盖：创建表、插入、查询、更新、去重、JSON 字段读写、错误处理。

7. **如果项目已有迁移脚本，运行它。**
   - 例如：`npx tsx scripts/migrate.ts`（如不存在此脚本则跳过本步）。

## 示例

### 新增 `daily_stats` 表

```sql
CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  total_seen INTEGER DEFAULT 0,
  screened INTEGER DEFAULT 0,
  shortlisted INTEGER DEFAULT 0,
  applied INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  llm_calls INTEGER DEFAULT 0,
  estimated_cost REAL DEFAULT 0
);
```

对应 TypeScript 类型：

```ts
export interface DailyStats {
  date: string;
  totalSeen: number;
  screened: number;
  shortlisted: number;
  applied: number;
  skipped: number;
  failed: number;
  llmCalls: number;
  estimatedCost: number;
}
```

CRUD 方法示例：

```ts
saveDailyStats(stats: DailyStats): void {
  this.writeQueue.enqueue(() => {
    this.db
      .prepare(`
        INSERT INTO daily_stats (date, total_seen, screened, ...)
        VALUES (@date, @totalSeen, @screened, ...)
        ON CONFLICT(date) DO UPDATE SET
          total_seen = excluded.total_seen,
          screened = excluded.screened,
          ...
      `)
      .run(stats);
  });
}
```

## 输出

- `src/storage/store.ts` 中新增/更新表结构
- `src/types.ts` 中新增/更新对应类型
- `src/storage/store.ts` 中新增 CRUD 方法
- `src/test/unit/storage/store.spec.ts` 中新增单元测试
- 如适用，更新 `docs/api-field-mapping.md` 或 README 中相关说明

## 易错点检查清单

- [ ] 建表语句使用 `CREATE TABLE IF NOT EXISTS`。
- [ ] 字符串 ID 主键使用 `TEXT`，不是 `INTEGER`。
- [ ] JSON 字段存储为 `TEXT`，写入前 `JSON.stringify`，读取后 `JSON.parse`。
- [ ] 数据库启用 WAL 模式：`PRAGMA journal_mode=WAL`。
- [ ] 写入操作通过 `SQLiteWriteQueue` 序列化。
- [ ] 批量写入使用事务包裹。
- [ ] 时间字段统一使用 ISO 8601 字符串。
- [ ] 新增方法后必须写单元测试。
- [ ] 修改 schema 后，检查已有数据是否需要迁移。
