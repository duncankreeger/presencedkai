import cron from 'node-cron';
import { config } from '../config/index.js';
import {
  getOnboardingDay,
  markOnboardingSent,
  getMemorySnapshot,
  getRecentConversations,
} from '../memory/operations.js';
import {
  getOnboardingPrompt,
  buildPromptText,
  isOnboardingComplete,
  NO_REPLY_THRESHOLDS,
  DAILY_CALL_PROMPT,
} from './onboarding.js';
import { generateDailyCall } from '../llm/claude.js';
import { getJitteredDelay } from '../safety/monitor.js';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function isSkipDay() {
  const today = DAY_NAMES[new Date().getDay()];
  return config.timing.skipDays.includes(today);
}

function getConsecutiveNoReplies() {
  // Count consecutive outbound messages with no inbound reply after them
  const recent = getRecentConversations(30);
  let noReplies = 0;

  // Walk backwards through messages
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].direction === 'outbound') {
      noReplies++;
    } else {
      break; // Found a reply, stop counting
    }
  }
  return noReplies;
}

export function startTimingEngine(sendMessageFn) {
  const [hour, minute] = config.timing.morningPromptTime.split(':');
  const cronExpression = `${minute} ${hour} * * *`;

  cron.schedule(cronExpression, async () => {
    console.log(`[Timing] Cron fired at ${new Date().toISOString()}`);

    if (isSkipDay()) {
      console.log('[Timing] Skip day â silence is the message.');
      return;
    }

    // Add random 1-15 minute delay to avoid detection patterns
    const jitter = getJitteredDelay();
    const jitterMinutes = Math.floor(jitter / 60000);
    console.log(`[Timing] Adding ${jitterMinutes}m jitter delay...`);

    setTimeout(async () => {
      try {
        await sendMorningPrompt(sendMessageFn);
      } catch (err) {
        console.error('[Timing] Failed to send morning prompt:', err);
      }
    }, jitter);
  }, {
    timezone: 'Europe/London',
  });

  console.log(`[Timing] Morning prompt scheduled at ${hour}:${minute} (Europe/London)`);
  console.log(`[Timing] Skip days: ${config.timing.skipDays.join(', ')}`);
}

async function sendMorningPrompt(sendMessageFn) {
  // Check no-reply threshold first
  const noReplies = getConsecutiveNoReplies();

  if (noReplies >= NO_REPLY_THRESHOLDS.withdraw.days) {
    console.log(`[Timing] ${noReplies} consecutive no-replies. Withdrawing. Waiting for DK to initiate.`);
    return;
  }

  if (noReplies >= NO_REPLY_THRESHOLDS.acknowledge.days) {
    console.log(`[Timing] ${noReplies} consecutive no-replies. Sending acknowledgement.`);
    await sendMessageFn('Still here. No pressure.');
    return;
  }

  const dayNumber = getOnboardingDay();

  if (isOnboardingComplete(dayNumber)) {
    // Post-onboarding: Daily Call Engine
    await sendDailyCall(sendMessageFn, noReplies);
    return;
  }

  // Onboarding sequence
  const dayConfig = getOnboardingPrompt(dayNumber);
  if (!dayConfig) {
    console.log(`[Timing] No config for day ${dayNumber}`);
    return;
  }

  if (dayConfig.type === 'skip') {
    console.log(`[Timing] Day ${dayNumber} is a skip day (${dayConfig.intent})`);
    return;
  }

  // Build the prompt â static or dynamic
  const memory = getMemorySnapshot();
  const promptText = buildPromptText(dayConfig, memory);

  if (!promptText) {
    console.log(`[Timing] Day ${dayNumber} generated no prompt text`);
    return;
  }

  // Lighten if needed
  if (noReplies >= NO_REPLY_THRESHOLDS.lighten.days) {
    console.log(`[Timing] ${noReplies} no-replies â would send lighter prompt (using standard for now)`);
    // Future: swap to lighter prompt variant
  }

  console.log(`[Timing] Onboarding day ${dayNumber}: "${promptText.substring(0, 60)}..."`);
  await sendMessageFn(promptText, dayNumber);
  markOnboardingSent(dayNumber);
}

async function sendDailyCall(sendMessageFn, noReplies) {
  console.log('[Timing] Post-onboarding â generating daily call...');

  try {
    const memory = getMemorySnapshot();
    const message = await generateDailyCall(memory);

    if (!message || message === '__SKIP__') {
      console.log('[Timing] Daily Call Engine returned skip â nothing worth saying.');
      return;
    }

    await sendMessageFn(message);
    console.log(`[Timing] Daily call sent: "${message.substring(0, 60)}..."`);
  } catch (err) {
    console.error('[Timing] Daily call generation failed:', err);
  }
}

// Manual trigger for testing
export async function triggerMorningPrompt(sendMessageFn) {
  console.log('[Timing] Manual trigger...');
  await sendMorningPrompt(sendMessageFn);
}
