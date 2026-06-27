---
name: write-test
description: |
  当你为新功能、修改的功能或修复的 bug 编写测试时必须使用本 Skill。
  任何涉及 `src/` 的代码改动，都应先确定测试类型（单元/集成），再按本 Skill 的规范编写测试。
compatibility: |
  项目使用 Vitest 作为测试框架，MSW 用于 API mock，Playwright 用于浏览器集成测试。
---

# Skill: 编写测试

## 用途

确保每次代码改动都有可自动验证的测试覆盖。单元测试验证业务逻辑，集成测试验证模块组合，避免回归。

## 何时使用

- 新增一个模块或函数时
- 修改现有功能时
- 修复 bug 时（先写复现测试，再修代码）
- 重构代码时
- 新增 mock 或 fixture 时

## 测试类型选择

| 场景 | 测试类型 | 位置 |
|------|---------|------|
| 验证单个函数/类的逻辑 | 单元测试 | `tests/unit/` |
| 验证多个模块协作 | 集成测试 | `tests/integration/` |
| 验证真实浏览器行为 | 浏览器集成测试 | `tests/browser/` |

## 步骤

1. **确定测试类型**
   - 如果只测纯逻辑、不依赖外部服务 → 单元测试
   - 如果涉及 API 调用、数据库、浏览器 → 集成测试

2. **单元测试**
   - mock 所有外部依赖（浏览器、网络、LLM、文件系统）
   - 测试文件放在 `tests/unit/`
   - 命名：`{模块名}.test.ts`

3. **集成测试**
   - 使用 HAR fixture 或 MSW handler 模拟网络响应
   - 测试文件放在 `tests/integration/`
   - fixture 放在 `tests/fixtures/`

4. **运行测试确认通过**
   ```bash
   npm run test:unit
   npm run test:integration
   npm test
   ```

5. **如果测试需要新增 mock/fixture，先创建它们**
   - mock 实现放在 `tests/__mocks__/`
   - fixture 放在 `tests/fixtures/`

## 示例

### 单元测试示例

```ts
// tests/unit/browser/page-pool.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PagePool } from '../../../src/browser/page-pool';

describe('PagePool', () => {
  it('should limit concurrent pages', async () => {
    const context = {
      newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
    } as any;

    const pool = new PagePool(context, 2);
    const p1 = await pool.acquire();
    const p2 = await pool.acquire();

    expect(context.newPage).toHaveBeenCalledTimes(2);
    await pool.release(p1);
    await pool.release(p2);
  });
});
```

### 集成测试示例

```ts
// tests/integration/platform/api.test.ts
import { describe, it, expect } from 'vitest';
import { server } from '../../src/test/msw/handlers';

describe('BossAPIClient', () => {
  it('returns job list from mocked API', async () => {
    // 使用 MSW handler 拦截请求
    const jobs = await apiClient.getRecommendJobs({ page: 1 });
    expect(jobs.length).toBeGreaterThan(0);
  });
});
```

## 输出

- 新增的测试文件
- 必要的 mock / fixture 文件
- 测试全部通过

## 易错点检查清单

- [ ] 不要 mock 被测试的模块本身。
- [ ] 集成测试不要依赖真实网络，使用 MSW 或 HAR fixture。
- [ ] 测试文件命名：`{模块名}.test.ts`。
- [ ] 一个测试只验证一个行为，避免大而全的测试。
- [ ] 测试失败时，先确认是代码问题还是测试断言问题。
- [ ] 新增的 mock 要能复用，不要每个测试文件都重复造轮子。
- [ ] 覆盖率目标：单元 + 集成合并不低于 70%。
