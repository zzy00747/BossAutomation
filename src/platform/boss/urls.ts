export const BOSS_BASE_URL = 'https://www.zhipin.com';
export const LOGIN_PAGE_URL = `${BOSS_BASE_URL}/`;
export const RECOMMEND_JOBS_URL = `${BOSS_BASE_URL}/wapi/zpgeek/pc/recommend/job/list.json`;
export const JOB_DETAIL_API_URL = `${BOSS_BASE_URL}/wapi/zpgeek/job/detail.json`;
export const GREET_API_URL = `${BOSS_BASE_URL}/wapi/zpgeek/friend/add.json`;
export const SECURITY_CHECK_URL = `${BOSS_BASE_URL}/web/common/security-check.html`;

export interface RecommendUrlParams {
  page?: number;
  pageSize?: number;
  cursor?: string;
  experience?: number;
  jobType?: number;
  salary?: number;
  encryptExpectId?: string;
}

export function getRecommendJobsUrl(params: RecommendUrlParams = {}): string {
  const url = new URL(RECOMMEND_JOBS_URL);
  if (params.page) url.searchParams.set('page', String(params.page));
  if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
  if (params.cursor) url.searchParams.set('cursor', params.cursor);
  if (params.experience) url.searchParams.set('experience', String(params.experience));
  if (params.jobType) url.searchParams.set('jobType', String(params.jobType));
  if (params.salary) url.searchParams.set('salary', String(params.salary));
  if (params.encryptExpectId) url.searchParams.set('encryptExpectId', params.encryptExpectId);
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

export function getJobDetailApiUrl(encryptJobId: string): string {
  const url = new URL(JOB_DETAIL_API_URL);
  url.searchParams.set('encryptJobId', encryptJobId);
  url.searchParams.set('_', String(Date.now()));
  return url.toString();
}

export function getJobDetailPageUrl(encryptJobId: string): string {
  return `${BOSS_BASE_URL}/job_detail/${encryptJobId}.html`;
}

export function getGreetUrl(securityId: string, jobId: string): string {
  const url = new URL(GREET_API_URL);
  url.searchParams.set('securityId', securityId);
  url.searchParams.set('jobId', jobId);
  return url.toString();
}

export function getSecurityCheckUrl(): string {
  return SECURITY_CHECK_URL;
}

export interface QRApiUrls {
  randkey: string;
  qrcode: string;
  scan: string;
  scanLogin: string;
  dispatcher: string;
}

export function getQRApis(): QRApiUrls {
  return {
    randkey: `${BOSS_BASE_URL}/wapi/zppassport/captcha/randkey`,
    qrcode: `${BOSS_BASE_URL}/wapi/zpweixin/qrcode/getqrcode`,
    scan: `${BOSS_BASE_URL}/wapi/zppassport/qrcode/scan`,
    scanLogin: `${BOSS_BASE_URL}/wapi/zppassport/qrcode/scanLogin`,
    dispatcher: `${BOSS_BASE_URL}/wapi/zppassport/qrcode/dispatcher`,
  };
}
