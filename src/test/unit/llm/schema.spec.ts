import { describe, it, expect } from 'vitest';
import {
  ScreenResultSchema,
  ScreenResultInputSchema,
  parseScreenResult,
} from '../../../llm/schema.js';
import { buildJDScreenPrompt } from '../../../llm/prompts/jd-screen.js';
import { fixtureJobDetail } from '../../fixtures/job-detail.js';

describe('ScreenResultSchema', () => {
  it('解析合法 camelCase 输入', () => {
    const result = ScreenResultSchema.parse({
      matchScore: 88,
      salaryMatch: true,
      locationMatch: true,
      skillsMatch: 85,
      redFlags: [],
      reason: '匹配',
      suggestedGreeting: '您好',
    });

    expect(result.matchScore).toBe(88);
    expect(result.salaryMatch).toBe(true);
    expect(result.redFlags).toEqual([]);
  });

  it('解析合法 snake_case 输入并归一化为 camelCase', () => {
    const result = ScreenResultInputSchema.parse({
      match_score: 90,
      salary_match: true,
      location_match: false,
      skills_match: 80,
      red_flags: ['薪资低'],
      reason: '部分匹配',
      suggested_greeting: '',
    });

    expect(result.matchScore).toBe(90);
    expect(result.salaryMatch).toBe(true);
    expect(result.locationMatch).toBe(false);
    expect(result.skillsMatch).toBe(80);
    expect(result.redFlags).toEqual(['薪资低']);
    expect(result.suggestedGreeting).toBe('');
  });

  it('matchScore 超出 100 视为非法', () => {
    const result = ScreenResultSchema.safeParse({
      matchScore: 150,
      salaryMatch: true,
      locationMatch: true,
      skillsMatch: 50,
      redFlags: [],
      reason: 'x',
      suggestedGreeting: '',
    });

    expect(result.success).toBe(false);
  });

  it('matchScore 为负数视为非法', () => {
    const result = ScreenResultSchema.safeParse({
      matchScore: -5,
      salaryMatch: true,
      locationMatch: true,
      skillsMatch: 50,
      redFlags: [],
      reason: 'x',
      suggestedGreeting: '',
    });

    expect(result.success).toBe(false);
  });

  it('缺失字段视为非法', () => {
    const result = ScreenResultSchema.safeParse({
      matchScore: 80,
      salaryMatch: true,
    });

    expect(result.success).toBe(false);
  });

  it('字符串形式的分数可被转换为数字', () => {
    const result = ScreenResultSchema.parse({
      matchScore: '82',
      salaryMatch: 'true',
      locationMatch: false,
      skillsMatch: '70',
      redFlags: [],
      reason: '匹配',
      suggestedGreeting: 'hi',
    });

    expect(result.matchScore).toBe(82);
    expect(result.salaryMatch).toBe(true);
    expect(result.skillsMatch).toBe(70);
  });

  it('redFlags 字符串可被拆分为数组', () => {
    const result = ScreenResultSchema.parse({
      matchScore: 60,
      salaryMatch: false,
      locationMatch: true,
      skillsMatch: 50,
      redFlags: '薪资低，方向不符',
      reason: '部分匹配',
      suggestedGreeting: '',
    });

    expect(result.redFlags).toEqual(['薪资低', '方向不符']);
  });

  it('redFlags 字段缺失时返回空数组', () => {
    const result = ScreenResultSchema.parse({
      matchScore: 60,
      salaryMatch: false,
      locationMatch: true,
      skillsMatch: 50,
      redFlags: [],
      reason: 'ok',
      suggestedGreeting: '',
    });

    expect(result.redFlags).toEqual([]);
  });
});

describe('parseScreenResult', () => {
  it('合法输入返回 ScreenResult', () => {
    const result = parseScreenResult({
      match_score: 88,
      salary_match: true,
      location_match: true,
      skills_match: 85,
      red_flags: [],
      reason: '匹配',
      suggested_greeting: '您好',
    });

    expect(result.matchScore).toBe(88);
  });

  it('非法输入抛出带原因的错误', () => {
    expect(() => parseScreenResult({ matchScore: 'abc' })).toThrow(
      /格式不合法/,
    );
  });
});

describe('buildJDScreenPrompt', () => {
  it('包含岗位意图、职位名与 JD 正文', () => {
    const prompt = buildJDScreenPrompt(
      '5 年 React + TypeScript 前端，期望北京 25-40K',
      fixtureJobDetail,
    );

    expect(prompt).toContain('5 年 React + TypeScript 前端，期望北京 25-40K');
    expect(prompt).toContain(fixtureJobDetail.jobName);
    expect(prompt).toContain(fixtureJobDetail.brandName);
    expect(prompt).toContain(fixtureJobDetail.postDescription);
  });

  it('要求纯 JSON 输出', () => {
    const prompt = buildJDScreenPrompt('前端工程师', fixtureJobDetail);
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('禁止输出任何额外文字');
  });

  it('包含 few-shot 示例', () => {
    const prompt = buildJDScreenPrompt('前端工程师', fixtureJobDetail);
    expect(prompt).toContain('示例 1');
    expect(prompt).toContain('示例 2');
  });

  it('说明阈值含义', () => {
    const prompt = buildJDScreenPrompt('前端工程师', fixtureJobDetail);
    expect(prompt).toContain('matchScore >= 75');
    expect(prompt).toContain('redFlags');
  });

  it('输出字段定义与 ScreenResult 一致', () => {
    const prompt = buildJDScreenPrompt('前端工程师', fixtureJobDetail);
    expect(prompt).toContain('matchScore');
    expect(prompt).toContain('salaryMatch');
    expect(prompt).toContain('locationMatch');
    expect(prompt).toContain('skillsMatch');
    expect(prompt).toContain('redFlags');
    expect(prompt).toContain('reason');
    expect(prompt).toContain('suggestedGreeting');
  });

  it('JD 缺失技能标签时显示无', () => {
    const prompt = buildJDScreenPrompt('前端', {
      ...fixtureJobDetail,
      skills: undefined,
    });
    expect(prompt).toContain('技能标签：无');
  });
});
