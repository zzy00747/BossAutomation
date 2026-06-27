import { describe, it, expect } from 'vitest';
import { PagePool } from '../../../browser/page-pool.js';
import { MockBrowserContext, MockPage } from '../../__mocks__/mock-browser.js';

describe('PagePool', () => {
  it('acquires pages up to max concurrency', async () => {
    const context = new MockBrowserContext();
    const pool = new PagePool(context, { maxPages: 2 });

    const p1 = await pool.acquire();
    await pool.acquire(); // second page at max capacity
    expect(pool.size()).toBe(2);

    const p3 = await pool.acquire();
    expect(pool.size()).toBe(2);
    expect(p1).not.toBe(p3);
  });

  it('releases a page', async () => {
    const context = new MockBrowserContext();
    const pool = new PagePool(context, { maxPages: 2 });
    const page = await pool.acquire();
    await pool.release(page);
    expect(pool.size()).toBe(0);
    expect(page).toBeInstanceOf(MockPage);
  });

  it('releases all pages', async () => {
    const context = new MockBrowserContext();
    const pool = new PagePool(context, { maxPages: 3 });
    await pool.acquire();
    await pool.acquire();
    await pool.releaseAll();
    expect(pool.size()).toBe(0);
  });
});
