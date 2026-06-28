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

const RawScreenResultSchema = z.object({
  matchScore: scoreField,
  salaryMatch: booleanField,
  locationMatch: booleanField,
  skillsMatch: scoreField,
  redFlags: stringArrayField,
  reason: z.string(),
  suggestedGreeting: z.string(),
});

const snakeKeySchema = z.object({
  match_score: scoreField,
  salary_match: booleanField,
  location_match: booleanField,
  skills_match: scoreField,
  red_flags: stringArrayField,
  reason: z.string(),
  suggested_greeting: z.string(),
});

export const ScreenResultSchema = z
  .union([RawScreenResultSchema, snakeKeySchema])
  .transform((data): ScreenResult => {
    if ('match_score' in data) {
      return {
        matchScore: data.match_score,
        salaryMatch: data.salary_match,
        locationMatch: data.location_match,
        skillsMatch: data.skills_match,
        redFlags: data.red_flags,
        reason: data.reason,
        suggestedGreeting: data.suggested_greeting,
      };
    }
    return data;
  });

export function parseScreenResult(raw: unknown): ScreenResult {
  const result = ScreenResultSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `[${i.path.join('.')}] ${i.message}`)
      .join('; ');
    throw new Error(`LLM 筛选输出格式不合法: ${issues}`);
  }
  return result.data;
}

export type ScreenResultInput = z.input<typeof ScreenResultSchema>;
