import 'dotenv/config';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const config = {
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  },
  whatsapp: {
    targetNumber: process.env.WHATSAPP_TARGET_NUMBER || '',
  },
  timing: {
    morningPromptTime: process.env.MORNING_PROMPT_TIME || '06:30',
    skipDays: (process.env.SKIP_DAYS || 'sunday').split(',').map(d => d.trim().toLowerCase()),
    timezone: process.env.TIMEZONE || 'Europe/London',
  },
  paths: {
    dbPath: process.env.DB_PATH || './data/presence.db',
    authPath: process.env.AUTH_PATH || './data/auth',
  },
  safety: {
    dailyApiLimit: parseInt(process.env.DAILY_API_LIMIT || '50', 10),
    monthlySpendCap: parseInt(process.env.MONTHLY_SPEND_CAP || '50', 10),
  },
};

export function validateConfig() {
  const errors = [];

  if (!config.anthropic.apiKey || config.anthropic.apiKey === 'sk-ant-...') {
    errors.push('ANTHROPIC_API_KEY is not set');
  }

  if (!config.whatsapp.targetNumber || config.whatsapp.targetNumber === '447XXXXXXXXX') {
    errors.push('WHATSAPP_TARGET_NUMBER is not set');
  }

  // Validate time format
  const timeMatch = config.timing.morningPromptTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    errors.push('MORNING_PROMPT_TIME must be HH:MM format');
  }

  if (errors.length > 0) {
    console.error('\n[Config] Configuration errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    console.error('\nCopy .env.example to .env and fill in your values.\n');
    process.exit(1);
  }

  // Ensure data directories exist
  const dbDir = dirname(config.paths.dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  if (!existsSync(config.paths.authPath)) {
    mkdirSync(config.paths.authPath, { recursive: true });
  }

  console.log('[Config] Validated.');
  console.log(`[Config] Target: ${config.whatsapp.targetNumber}`);
  console.log(`[Config] Model: ${config.anthropic.model}`);
  console.log(`[Config] Morning prompt: ${config.timing.morningPromptTime} (${config.timing.timezone})`);
}
