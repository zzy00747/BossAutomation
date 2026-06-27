import type { ScreenResult } from '../../types.js';

export const fixtureScreenPass: ScreenResult = {
  matchScore: 88,
  salaryMatch: true,
  locationMatch: true,
  skillsMatch: 85,
  redFlags: [],
  reason: '岗位技术栈与候选人高度匹配，薪资范围符合预期。',
  suggestedGreeting:
    '您好，我对贵司的高级前端工程师岗位非常感兴趣。我有5年 React + TypeScript 经验，熟悉前端工程化与性能优化，期待与您进一步沟通。',
};

export const fixtureScreenFail: ScreenResult = {
  matchScore: 45,
  salaryMatch: false,
  locationMatch: true,
  skillsMatch: 40,
  redFlags: ['要求 Java 为主技术栈', '薪资低于预期'],
  reason: '技术栈以 Java 后端为主，与候选人前端方向偏差较大。',
  suggestedGreeting: '',
};
