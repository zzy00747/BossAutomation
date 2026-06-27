import dotenv from 'dotenv';
import { z } from 'zod';

export const ConfigSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    DRY_RUN: z
      .preprocess(
        (val) => (typeof val === 'string' ? val === 'true' : Boolean(val)),
        z.boolean(),
      )
      .default(true),

    CDP_URL: z.string().default('http://localhost:9222'),
    CHROME_PATH: z.string().optional(),

    LLM_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'),
    LLM_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_BASE_URL: z.string().optional(),

    MATCH_SCORE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(75),
    APPLY_DAILY_LIMIT: z.coerce.number().int().positive().default(20),
    DETAIL_CONCURRENCY: z.coerce.number().int().positive().default(3),
    LLM_CONCURRENCY: z.coerce.number().int().positive().default(5),
    APPLY_CONCURRENCY: z.coerce.number().int().positive().default(1),

    SCREENSHOT_DIR: z.string().default('data/logs/screenshots'),
    DB_PATH: z.string().default('data/jobs.sqlite'),
  })
  .superRefine((data, ctx) => {
    if (data.LLM_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'LLM_PROVIDER=openai 时需要 OPENAI_API_KEY',
        path: ['OPENAI_API_KEY'],
      });
    }
    if (data.LLM_PROVIDER === 'anthropic' && !data.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'LLM_PROVIDER=anthropic 时需要 ANTHROPIC_API_KEY',
        path: ['ANTHROPIC_API_KEY'],
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | undefined;

export function resetConfig(): void {
  cachedConfig = undefined;
}

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  dotenv.config();

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `[${issue.path.join('.')}] ${issue.message}`,
    );
    throw new AggregateError(
      result.error.issues.map((issue) => new Error(`[${issue.path.join('.')}] ${issue.message}`)),
      `配置校验失败:\n${issues.join('\n')}`,
    );
  }

  cachedConfig = result.data;
  return cachedConfig;
}
