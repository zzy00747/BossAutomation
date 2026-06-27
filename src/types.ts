export interface NormalizedJob {
  encryptJobId: string;
  securityId?: string;
  encryptBossId?: string;
  lid?: string;
  jobName: string;
  brandName: string;
  cityName?: string;
  areaDistrict?: string;
  salaryDesc?: string;
  jobExperience?: string;
  jobDegree?: string;
  skills?: string[];
  industry?: string;
  brandScaleName?: string;
  jobDetailUrl?: string;
  bossName?: string;
  bossTitle?: string;
}

export interface JobDetail {
  encryptJobId: string;
  securityId?: string;
  jobName: string;
  brandName: string;
  salary?: string;
  location?: string;
  experience?: string;
  degree?: string;
  skills?: string[];
  postDescription: string;
  companyDescription?: string;
  industry?: string;
  brandScaleName?: string;
  stageName?: string;
  welfareList?: string[];
  fetchedAt: number;
}

export interface ScreenResult {
  matchScore: number;
  salaryMatch: boolean;
  locationMatch: boolean;
  skillsMatch: number;
  redFlags: string[];
  reason: string;
  suggestedGreeting: string;
}

export type JobStatus =
  | 'new'
  | 'screened'
  | 'shortlisted'
  | 'applied'
  | 'responded'
  | 'rejected'
  | 'failed'
  | 'skipped';

export interface JobRecord {
  encryptJobId: string;
  securityId?: string;
  encryptBossId?: string;
  lid?: string;
  jobName: string;
  brandName: string;
  cityName?: string;
  salaryDesc?: string;
  status: JobStatus;
  screenResultJson?: string;
  apiDetailJson?: string;
  htmlDetailJson?: string;
  llmCachedAt?: number;
  detailCachedAt?: number;
  appliedAt?: number;
  failedReason?: string;
  skipReason?: string;
  screenshotPath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PipelineConfig {
  dryRun: boolean;
  matchScoreThreshold: number;
  applyDailyLimit: number;
  detailConcurrency: number;
  llmConcurrency: number;
  applyConcurrency: number;
  screenshotDir: string;
  dbPath: string;
}

export interface VerificationResult {
  needsVerification: boolean;
  screenshotPath?: string;
  message?: string;
}

export interface PageState {
  nuxt?: Record<string, unknown>;
  initialState?: Record<string, unknown>;
}

export interface JobSearchParams {
  page?: number;
  pageSize?: number;
  cursor?: string;
  experience?: number;
  jobType?: number;
  salary?: number;
  encryptExpectId?: string;
}

export type BossErrorType =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'SERVER_ERROR'
  | 'BUSINESS_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export interface BossErrorClassified {
  type: BossErrorType;
  retryable: boolean;
  needsAuthRefresh: boolean;
  needsHumanIntervention: boolean;
  original: unknown;
}

export interface RecommendJobItem extends Record<string, unknown> {
  encryptJobId?: string;
  jobId?: string;
  encryptId?: string;
  id?: string;
  securityId?: string;
  encryptSecurityId?: string;
  secId?: string;
  encryptBossId?: string;
  bossId?: string;
  lid?: string;
  lId?: string;
  listId?: string;
  jobName?: string;
  title?: string;
  name?: string;
  brandName?: string;
  cityName?: string;
  areaDistrict?: string;
  salaryDesc?: string;
  jobExperience?: string;
  jobDegree?: string;
  skills?: string[];
  jobDetailUrl?: string;
  detailUrl?: string;
}

export interface JobListResponse {
  code: number;
  message: string;
  jobList: NormalizedJob[];
  hasMore: boolean;
  cursor?: string;
  total?: number;
}

export interface GreetResult {
  success: boolean;
  code: number;
  message?: string;
  data?: Record<string, unknown>;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface DailyStats {
  date: string;
  totalSeen: number;
  applied: number;
  skipped: number;
  failed: number;
  llmCalls: number;
}

export interface BlacklistEntry {
  companyName: string;
  reason?: string;
  createdAt: number;
}
