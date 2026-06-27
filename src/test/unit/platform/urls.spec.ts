import { describe, it, expect } from 'vitest';
import {
  BOSS_BASE_URL,
  getRecommendJobsUrl,
  getJobDetailApiUrl,
  getJobDetailPageUrl,
  getGreetUrl,
  getSecurityCheckUrl,
  getQRApis,
  type RecommendUrlParams,
} from '../../../platform/boss/urls.js';
import {
  LOGIN_CHECK_SELECTORS,
  JOB_CARD_SELECTOR,
  VERIFY_SELECTORS,
} from '../../../platform/boss/selectors.js';

describe('boss urls', () => {
  it('getRecommendJobsUrl 拼接基础参数', () => {
    const url = new URL(getRecommendJobsUrl({ page: 2, pageSize: 15 }));
    expect(url.origin).toBe(BOSS_BASE_URL);
    expect(url.pathname).toBe('/wapi/zpgeek/pc/recommend/job/list.json');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('pageSize')).toBe('15');
  });

  it('getRecommendJobsUrl 仅在传值时写入参数', () => {
    const url = new URL(getRecommendJobsUrl({}));
    expect(url.searchParams.get('page')).toBeNull();
    expect(url.searchParams.get('pageSize')).toBeNull();
    expect(url.searchParams.get('cursor')).toBeNull();
    expect(url.searchParams.get('experience')).toBeNull();
  });

  it('getRecommendJobsUrl 写入 cursor 与筛选代码', () => {
    const params: RecommendUrlParams = {
      page: 1,
      pageSize: 15,
      cursor: 'abc123',
      experience: 104,
      jobType: 1901,
      salary: 404,
      encryptExpectId: 'expect-xyz',
    };
    const url = new URL(getRecommendJobsUrl(params));
    expect(url.searchParams.get('cursor')).toBe('abc123');
    expect(url.searchParams.get('experience')).toBe('104');
    expect(url.searchParams.get('jobType')).toBe('1901');
    expect(url.searchParams.get('salary')).toBe('404');
    expect(url.searchParams.get('encryptExpectId')).toBe('expect-xyz');
  });

  it('getRecommendJobsUrl 带时间戳防缓存', () => {
    const url = new URL(getRecommendJobsUrl({ page: 1 }));
    const ts = url.searchParams.get('_');
    expect(ts).not.toBeNull();
    expect(Number(ts)).toBeGreaterThan(0);
  });

  it('getJobDetailApiUrl 拼接 encryptJobId 与时间戳', () => {
    const url = new URL(getJobDetailApiUrl('job-abc'));
    expect(url.pathname).toBe('/wapi/zpgeek/job/detail.json');
    expect(url.searchParams.get('encryptJobId')).toBe('job-abc');
    expect(url.searchParams.get('_')).not.toBeNull();
  });

  it('getJobDetailPageUrl 生成 HTML 详情页地址', () => {
    expect(getJobDetailPageUrl('job-abc')).toBe(
      `${BOSS_BASE_URL}/job_detail/job-abc.html`,
    );
  });

  it('getGreetUrl 拼接 securityId 与 jobId', () => {
    const url = new URL(getGreetUrl('sec-1', 'job-1'));
    expect(url.pathname).toBe('/wapi/zpgeek/friend/add.json');
    expect(url.searchParams.get('securityId')).toBe('sec-1');
    expect(url.searchParams.get('jobId')).toBe('job-1');
  });

  it('getSecurityCheckUrl 返回安全校验页', () => {
    expect(getSecurityCheckUrl()).toBe(
      `${BOSS_BASE_URL}/web/common/security-check.html`,
    );
  });

  it('getQRApis 返回完整二维码登录端点', () => {
    const apis = getQRApis();
    expect(apis.randkey).toContain('/wapi/zppassport/captcha/randkey');
    expect(apis.qrcode).toContain('/wapi/zpweixin/qrcode/getqrcode');
    expect(apis.scan).toContain('/wapi/zppassport/qrcode/scan');
    expect(apis.scanLogin).toContain('/wapi/zppassport/qrcode/scanLogin');
    expect(apis.dispatcher).toContain('/wapi/zppassport/qrcode/dispatcher');
  });
});

describe('boss selectors', () => {
  it('登录态选择器非空', () => {
    expect(LOGIN_CHECK_SELECTORS.length).toBeGreaterThan(0);
    expect(LOGIN_CHECK_SELECTORS).toContain('.user-nav');
  });

  it('职位卡片选择器存在', () => {
    expect(JOB_CARD_SELECTOR).toBe('.job-card-wrapper');
  });

  it('验证码选择器覆盖多种形态', () => {
    expect(VERIFY_SELECTORS).toContain('.captcha');
    expect(VERIFY_SELECTORS.some((s: string) => s.includes('verify'))).toBe(true);
  });
});
