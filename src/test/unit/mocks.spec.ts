import { describe, it, expect } from 'vitest';
import { MockBrowserDriver, MockPage } from '../__mocks__/mock-browser.js';
import { MockBossAPIClient } from '../__mocks__/mock-api-client.js';
import { MockLLMClient } from '../__mocks__/mock-llm-client.js';
import { MockJobStorage } from '../__mocks__/mock-storage.js';
import { fixtureJobs } from '../fixtures/jobs.js';
import { fixtureScreenPass } from '../fixtures/llm-responses.js';

describe('mock infrastructure', () => {
  it('MockBrowserDriver connects and returns a page', async () => {
    const driver = new MockBrowserDriver();
    await driver.connect();
    expect(driver.connected).toBe(true);
    const page = await driver.getPage();
    expect(page).toBeInstanceOf(MockPage);
  });

  it('MockBossAPIClient returns fixture jobs', async () => {
    const api = new MockBossAPIClient();
    const res = await api.getRecommendJobs({ page: 1, pageSize: 15 });
    expect(res.jobList).toHaveLength(fixtureJobs.length);
  });

  it('MockLLMClient returns JSON screen result', async () => {
    const llm = new MockLLMClient({ screenResults: [fixtureScreenPass] });
    const response = await llm.chat([{ role: 'user', content: 'screen this' }]);
    const parsed = JSON.parse(response.content);
    expect(parsed.matchScore).toBe(fixtureScreenPass.matchScore);
  });

  it('MockJobStorage caches LLM results', async () => {
    const storage = new MockJobStorage();
    await storage.cacheLLMResult('job-001', fixtureScreenPass);
    const cached = await storage.getLLMCache('job-001');
    expect(cached).toBeDefined();
    expect(cached?.matchScore).toBe(fixtureScreenPass.matchScore);
  });
});
