import type {
  JobDetail,
  JobListResponse,
  JobSearchParams,
  GreetResult,
  NormalizedJob,
} from '../types.js';

export interface IBossAPIClient {
  getRecommendJobs(params: JobSearchParams): Promise<JobListResponse>;
  getJobDetail(job: NormalizedJob): Promise<JobDetail>;
  greetBoss(securityId: string, encryptJobId: string, greeting?: string): Promise<GreetResult>;
}
