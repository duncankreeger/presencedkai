import { config, validateConfig } from './config/index.js';
import { setupDatabase } from './memory/setup.js';
import {
  logMessage,
  getOnboardingDay,
  markOnboardingReplied,
  getMemorySnapshot,
} from './memory/operations.js';
import { startGateway, onMessage, sendMessage } from './gateway/whatsapp.js';
import { startTimingEngine, triggerMorningPrompt } from './timing/engine.js';
import { generateResponse, extractMeaning } from './llm/claude.js';
import { processMeaning } from './llm/meaning.js';
import {
  getOnboardingPrompt,
  getExtractionTargets,
  isOnboardingComplete,
} from './timing/onboarding.js';
import {
  getHealthStatus,
  markConnected,
  markMessageSent,
  markMessageReceived,
  backupDatabase,
} from './safety/monitor.js';

console.log(`
ââââââââââââââââââââââââââââââââââââââââ
â         P R E S E N C E             â
â       Mentorship with Memory        â
â              v0.1                   â
ââââââââââââââââââââââââââââââââââââââââ
`);

// ââ Startup ââââââââââââââââââââââââââââââââââââââââââ
validateConfig();
setupDatabase();

// ââ Message sending wrapper ââââââââââââââââââââââââââ
async function sendPresenceMessage(text, promptDayNumber = null) {
  await sendMessage(text, promptDayNumber);
  logMessage('outbound', text);
  markMessageSent();
}

// ââ Incoming message handler âââââââââââââââââââââââââ
async function handleIncomingMessage(text) {
  console.log(`[Core] Processing: "${text.substring(0, 80)}"`);
  markMessageReceived();

  // Log inbound
  logMessage('inbound', text);

  // Determine onboarding context
  const currentDay = getOnboardingDay();
  const previousDay = currentDay ? currentDay - 1 : null;
  const previousDayConfig = previousDay ? getOnboardingPrompt(previousDay) : null;

  // Get extraction targets for the day we're responding to
  const extractionTargets = previousDay ? getExtractionTargets(previousDay) : null;

  // Get the prompt text that was sent (for context)
  const promptContext = previousDayConfig?.prompt || null;

  // Extract meaning with day-specific targets
  const meaning = await extractMeaning(text, promptContext, extractionTargets);

  if (meaning) {
    processMeaning(meaning);
    // Update the log entry with extracted meaning
    logMessage('inbound', `[meaning] ${JSON.stringify(meaning)}`, null, JSON.stringify(meaning));
  }

  // Mark onboarding replied
  if (previousDay && previousDay >= 1) {
    markOnboardingReplied(previousDay);
  }

  // Generate response using day-specific rules
  const onboardingDay = previousDay || null;
  const response = await generateResponse(text, onboardingDay);

  if (response) {
    await sendPresenceMessage(response);
  } else {
    console.warn('[Core] No response generated (API limit or error). Staying silent.');
  }
}

// ââ CLI ââââââââââââââââââââââââââââââââââââââââââââââ
process.stdin.setEncoding('utf-8');
process.stdin.on('data', async (data) => {
  const cmd = data.trim().toLowerCase();

  if (cmd === 'send') {
    console.log('[CLI] Triggering morning prompt...');
    await triggerMorningPrompt(sendPresenceMessage);
  } else if (cmd === 'status') {
    const day = getOnboardingDay();
    if (isOnboardingComplete(day)) {
      console.log('[CLI] Onboarding complete. Daily Call Engine active.');
    } else {
      console.log(`[CLI] Onboarding day: ${day}/14`);
      const dayConfig = getOnboardingPrompt(day);
      if (dayConfig) {
        console.log(`[CLI] Type: ${dayConfig.type}`);
        console.log(`[CLI] Intent: ${dayConfig.intent}`);
      }
    }
  } else if (cmd === 'memory') {
    const snapshot = getMemorySnapshot();
    console.log('\n[CLI] Memory Snapshot:');
    console.log(JSON.stringify(snapshot, null, 2));
  } else if (cmd === 'health') {
    const health = getHealthStatus();
    console.log('\n[CLI] Health Status:');
    console.log(JSON.stringify(health, null, 2));
  } else if (cmd === 'backup') {
    console.log('[CLI] Backing up database...');
    const path = backupDatabase();
    if (path) console.log(`[CLI] Backup saved: ${path}`);
  } else if (cmd === 'quit' || cmd === 'exit') {
    console.log('[CLI] Shutting down...');
    process.exit(0);
  } else if (cmd === 'help') {
    console.log('[CLI] Commands: send, status, memory, health, backup, quit, help');
  }
});

// ââ Start ââââââââââââââââââââââââââââââââââââââââââââ
async function start() {
  try {
    onMessage(handleIncomingMessage);

    console.log('[Core] Connecting to WhatsApp...');
    await startGateway();

    startTimingEngine(sendPresenceMessage);

    console.log('[Core] Presence is running.');
    console.log('[Core] Commands: send | status | memory | help');
  } catch (err) {
    console.error('[Core] Fatal error:', err);
    process.exit(1);
  }
}

start();
