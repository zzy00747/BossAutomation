import { z } from 'zod';
import type { ScreenResult } from '../types.js';

const scoreField = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isNaN(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `期望数字，收到: ${String(v)}`,
      });
      return z.NEVER;
    }
    return n;
  })
  .pipe(z.number().min(0).max(100));

const booleanField = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  });

const stringArrayField = z
  .union([z.array(z.union([z.string(), z.number()])), z.string()])
  .transform((v) => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    const trimmed = v.trim();
    if (!trimmed) return [];
    return trimmed
      .split(/[,，;；\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  });

const SNAKE_TO_CAMEL: Record<string, string> = {
  match_score: 'matchScore',
  salary_match: 'salaryMatch',
  location_match: 'locationMatch',
  skills_match: 'skillsMatch',
  red_flags: 'redFlags',
  suggested_greeting: 'suggestedGreeting',
};

function normalizeKeys(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return input;
  }
  const obj = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[SNAKE_TO_CAMEL[key] ?? key] = value;
  }
  return out;
}

export const ScreenResultSchema = z
  .object({
    matchScore: scoreField,
    salaryMatch: booleanField,
    locationMatch: booleanField,
    skillsMatch: scoreField,
    redFlags: stringArrayField,
    reason: z.string(),
    suggestedGreeting: z.string(),
  })
  .transform((data): ScreenResult => data);

export const ScreenResultInputSchema = z.preprocess(normalizeKeys, ScreenResultSchema);

export function parseScreenResult(raw: unknown): ScreenResult {
  let input: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('LLM 筛选输出为空');
    }
    try {
      input = JSON.parse(trimmed);
    } catch {
      throw new Error(`LLM 筛选输出不是合法 JSON: ${trimmed.slice(0, 120)}`);
    }
  }

  const result = ScreenResultInputSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `[${i.path.join('.')}] ${i.message}`)
      .join('; ');
    throw new Error(`LLM 筛选输出格式不合法: ${issues}`);
  }
  return result.data;
}

export type ScreenResultInput = z.input<typeof ScreenResultSchema>;
