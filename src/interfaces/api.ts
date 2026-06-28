import type {
  JobDetail,
  JobListResponse,
  JobSearchParams,
  GreetResult,
  NormalizedJob,
} from '../types.js';

export interface SecurityCheckPayload {
  seed: string;
  name: string;
  ts: number;
}

export interface SecurityCheckHandler {
  /** 根据 code 37 响应中的 seed/name/ts 刷新 __zp_stoken__，返回是否成功。 */
  refreshStoken(payload: SecurityCheckPayload): Promise<boolean>;
}

export interface IBossAPIClient {
  getRecommendJobs(params: JobSearchParams): Promise<JobListResponse>;
  getJobDetail(job: NormalizedJob): Promise<JobDetail>;
  greetBoss(securityId: string, encryptJobId: string, greeting?: string): Promise<GreetResult>;
}
