import type { JobDetail } from '../../types.js';

const THRESHOLD_NOTE = `判定阈值说明：
- matchScore >= 75 且 redFlags 为空时，该岗位才会被纳入投递候选（shortlisted）。
- matchScore 综合衡量技术栈、经验、薪资、地域与岗位意图的契合度，0-100。
- skillsMatch 仅衡量技能关键词的覆盖度，0-100。
- redFlags 记录明显不匹配点（如核心方向不符、薪资过低、地点不符、可疑条款等）；无明显问题时返回空数组。`;

const OUTPUT_FORMAT = `输出 JSON 字段如下，禁止输出任何额外文字、解释或 Markdown 代码块标记：
{
  "matchScore": number,        // 0-100
  "salaryMatch": boolean,
  "locationMatch": boolean,
  "skillsMatch": number,       // 0-100
  "redFlags": string[],
  "reason": string,            // 简要说明匹配与不匹配理由
  "suggestedGreeting": string  // 个性化打招呼语，不匹配时可留空字符串
}`;

const FEW_SHOT = `示例 1：
岗位意图：5 年 React + TypeScript 前端，期望北京 25-40K，互联网行业。
职位：高级前端工程师 / 字节跳动 / 25-40K·15薪 / 北京·海淀区 / 技能: React,TypeScript,Node.js
JD 摘要：负责核心产品前端架构设计，精通 React 与 TypeScript，熟悉 Node.js 工程化。
输出：
{"matchScore":88,"salaryMatch":true,"locationMatch":true,"skillsMatch":85,"redFlags":[],"reason":"技术栈与候选人高度匹配，薪资与地域符合预期。","suggestedGreeting":"您好，我对贵司高级前端工程师岗位非常感兴趣，有5年 React + TypeScript 经验，熟悉工程化与性能优化，期待进一步沟通。"}

示例 2：
岗位意图：5 年 React + TypeScript 前端，期望北京 25-40K。
职位：Java 后端工程师 / 某公司 / 15-20K / 上海 / 技能: Java,Spring
JD 摘要：负责后端服务开发，精通 Java 与 Spring 框架。
输出：
{"matchScore":35,"salaryMatch":false,"locationMatch":false,"skillsMatch":10,"redFlags":["技术栈以 Java 后端为主，与前端方向偏差大","薪资低于预期","工作地点不符"],"reason":"方向与地域均不匹配。","suggestedGreeting":""}`;

function formatJob(job: JobDetail): string {
  const skills = job.skills?.length ? job.skills.join(',') : '无';
  const lines = [
    `职位：${job.jobName}`,
    `公司：${job.brandName}`,
    job.salary ? `薪资：${job.salary}` : null,
    job.location ? `地点：${job.location}` : null,
    job.experience ? `经验要求：${job.experience}` : null,
    job.degree ? `学历要求：${job.degree}` : null,
    `技能标签：${skills}`,
  ];
  const header = lines.filter(Boolean).join(' / ');

  const jdBody = job.postDescription?.trim() || '（无 JD 正文）';
  const company = job.companyDescription?.trim();

  return `${header}\nJD 正文：\n${jdBody}${company ? `\n公司简介：\n${company}` : ''}`;
}

export function buildJDScreenPrompt(jobIntent: string, job: JobDetail): string {
  return [
    '你是一名严谨的求职顾问，负责根据候选人的岗位意图评估 Boss 直聘职位是否值得投递。',
    '',
    OUTPUT_FORMAT,
    '',
    THRESHOLD_NOTE,
    '',
    FEW_SHOT,
    '',
    '现在请评估以下岗位：',
    '',
    `岗位意图：${jobIntent || '（未提供）'}`,
    formatJob(job),
    '',
    '请直接输出 JSON。',
  ].join('\n');
}
