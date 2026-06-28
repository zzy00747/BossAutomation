import { describe, it, expect } from 'vitest';
import type {
  IBrowserDriver,
  IBrowserContext,
  IPage,
  ILocator,
} from '../../interfaces/browser.js';
import type { IBossAPIClient } from '../../interfaces/api.js';
import type { ILLMClient } from '../../interfaces/llm.js';
import type { IJobStorage } from '../../interfaces/storage.js';
import type {
  NormalizedJob,
  JobListResponse,
  JobDetail,
  GreetResult,
  Message,
  LLMResponse,
  JobRecord,
  ScreenResult,
  PageState,
} from '../../types.js';

describe('core interfaces are implementable', () => {
  it('IBrowserDriver', () => {
    class FakeDriver implements IBrowserDriver {
      async connect() {}
      async disconnect() {}
      async getContext(): Promise<IBrowserContext> {
        throw new Error('not implemented');
      }
      async getPage(): Promise<IPage> {
        throw new Error('not implemented');
      }
    }
    expect(new FakeDriver()).toBeDefined();
  });

  it('IPage', () => {
    class FakePage implements IPage {
      async goto() {}
      async route() {}
      async unroute() {}
      async evaluate<T = unknown, Arg = unknown>(
        _pageFunction: (arg: Arg) => T,
        _arg?: Arg,
      ): Promise<T> {
        return undefined as T;
      }
      async click() {}
      async fill() {}
      async screenshot() {
        return Buffer.from('');
      }
      async url() {
        return '';
      }
      async close() {}
      async content() {
        return '';
      }
      on() {}
      off() {}
      locator(): ILocator {
        throw new Error('not implemented');
      }
    }
    expect(new FakePage()).toBeDefined();
  });

  it('IBossAPIClient', () => {
    class FakeApi implements IBossAPIClient {
      async getRecommendJobs(): Promise<JobListResponse> {
        return { code: 0, message: 'OK', jobList: [], hasMore: false };
      }
      async getJobDetail(): Promise<JobDetail> {
        throw new Error('not implemented');
      }
      async greetBoss(): Promise<GreetResult> {
        return { success: true, code: 0 };
      }
    }
    expect(new FakeApi()).toBeDefined();
  });

  it('ILLMClient', () => {
    class FakeLlm implements ILLMClient {
      async chat(messages: Message[]): Promise<LLMResponse> {
        return { content: messages[messages.length - 1]?.content ?? '' };
      }
    }
    expect(new FakeLlm()).toBeDefined();
  });

  it('IJobStorage', () => {
    class FakeStorage implements IJobStorage {
      async saveJob() {}
      async getJobById(): Promise<JobRecord | undefined> {
        return undefined;
      }
      async hasJob(): Promise<boolean> {
        return false;
      }
      async updateJobStatus() {}
      async blacklistCompany() {}
      async isBlacklisted(): Promise<boolean> {
        return false;
      }
      async getBlacklist() {
        return [];
      }
      async saveDailyStats() {}
      async getDailyStats() {
        return undefined;
      }
      async cacheLLMResult() {}
      async getLLMCache(): Promise<ScreenResult | undefined> {
        return undefined;
      }
      async getJobsByDate(): Promise<JobRecord[]> {
        return [];
      }
    }
    expect(new FakeStorage()).toBeDefined();
  });

  it('types have required fields', () => {
    const job: NormalizedJob = {
      encryptJobId: 'abc',
      jobName: 'test',
      brandName: 'brand',
    };
    expect(job.encryptJobId).toBe('abc');

    const state: PageState = {
      nuxt: { data: [] },
      initialState: {},
    };
    expect(state).toBeDefined();
  });
});
