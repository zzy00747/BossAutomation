// 登录态检测元素（任一存在即视为已登录）
export const LOGIN_CHECK_SELECTORS = [
  '.user-nav',
  '.nav-figure',
  '.menu-list',
  '.btn-post-job',
  '.user-info',
  '[class*="user-name"]',
];

// 推荐列表 - 职位卡片容器
export const JOB_CARD_SELECTOR = '.job-card-wrapper';
export const JOB_CARD_ALT_SELECTORS = [
  '.job-card-body',
  '.job-list li',
  'li[ka="search-job-list-card"]',
];

// 职位卡片内部字段选择器
export const JOB_TITLE_SELECTOR = '.job-name';
export const JOB_SALARY_SELECTOR = '.salary';
export const JOB_AREA_SELECTOR = '.job-area';
export const JOB_LINK_SELECTOR = '.job-card-left a, .job-name a';
export const COMPANY_NAME_SELECTOR = '.company-name a, .company-info a';
export const COMPANY_SCALE_SELECTOR = '.company-text .company-scale';
export const BOSS_NAME_SELECTOR = '.boss-name';
export const BOSS_TITLE_SELECTOR = '.boss-title';
export const SKILL_TAGS_SELECTOR = '.tag-list .tag-item, .job-tags .tag-item';

// 职位详情页（HTML）选择器
export const DETAIL_TITLE_SELECTOR = '.job-banner .name h1, .name .job-title';
export const DETAIL_SALARY_SELECTOR = '.job-banner .salary, .salary';
export const DETAIL_CONTENT_SELECTOR = '.job-sec-text, .job-detail .job-sec-text';
export const DETAIL_COMPANY_SELECTOR = '.company-info .name, .job-banner .company-info';
export const DETAIL_LOCATION_SELECTOR = '.location-address, .job-detail .job-location';
export const DETAIL_EXPERIENCE_SELECTOR = '.job-banner .info-primary p, .text-desc';

// 验证码 / 风控检测
export const VERIFY_SELECTORS = [
  '.verify-wrap',
  '.captcha',
  '.slider-verify',
  '[class*="verify"]',
  '[class*="captcha"]',
];

export const VERIFY_TEXT_PATTERNS = [
  '安全验证',
  '滑动验证',
  '请完成验证',
  '验证码',
  '拖动滑块',
];

// 登录相关元素
export const LOGIN_FORM_SELECTOR = '.login-form';
export const LOGIN_QR_SELECTOR = '.qrcode-box, .login-scan-wrap';
