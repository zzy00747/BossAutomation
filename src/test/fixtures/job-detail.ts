import type { JobDetail } from '../../types.js';

export const fixtureJobDetail: JobDetail = {
  encryptJobId: 'job-001',
  securityId: 'sec-001',
  jobName: '高级前端工程师',
  brandName: '字节跳动',
  salary: '25-40K·15薪',
  location: '北京·海淀区',
  experience: '3-5年',
  degree: '本科',
  skills: ['React', 'TypeScript', 'Node.js'],
  postDescription: '负责公司核心产品的前端架构设计与开发。\n任职要求：\n1. 精通 React 与 TypeScript；\n2. 熟悉 Node.js 与工程化；\n3. 具备良好的沟通能力。',
  companyDescription: '字节跳动成立于2012年，是全球增长最快的科技公司之一。',
  industry: '互联网',
  brandScaleName: '10000人以上',
  stageName: '不需要融资',
  welfareList: ['五险一金', '补充医疗保险', '免费三餐'],
  fetchedAt: Date.now(),
};
