import type { IBossAPIClient } from '../../interfaces/api.js';
import type {
  JobDetail,
  JobListResponse,
  JobSearchParams,
  NormalizedJob,
  GreetResult,
} from '../../types.js';
import { fixtureJobs } from '../fixtures/jobs.js';
import { fixtureJobDetail } from '../fixtures/job-detail.js';

export interface MockBossAPIClientOptions {
  jobs?: NormalizedJob[];
  detail?: JobDetail;
  greetSuccess?: boolean;
}

export class MockBossAPIClient implements IBossAPIClient {
  public getRecommendJobsCalls: JobSearchParams[] = [];
  public getJobDetailCalls: NormalizedJob[] = [];
  public greetBossCalls: Array<{
    securityId: string;
    encryptJobId: string;
    greeting?: string;
  }> = [];

  constructor(private options: MockBossAPIClientOptions = {}) {}

  async getRecommendJobs(params: JobSearchParams): Promise<JobListResponse> {
    this.getRecommendJobsCalls.push(params);
    return {
      code: 0,
      message: 'OK',
      jobList: this.options.jobs ?? fixtureJobs,
      hasMore: false,
    };
  }

  async getJobDetail(job: NormalizedJob): Promise<JobDetail> {
    this.getJobDetailCalls.push(job);
    return {
      ...fixtureJobDetail,
      encryptJobId: job.encryptJobId,
      securityId: job.securityId,
    };
  }

  async greetBoss(
    securityId: string,
    encryptJobId: string,
    greeting?: string,
  ): Promise<GreetResult> {
    this.greetBossCalls.push({ securityId, encryptJobId, greeting });
    return {
      success: this.options.greetSuccess ?? true,
      code: 0,
      message: 'success',
    };
  }
}
