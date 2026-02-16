import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { getMemorySnapshot } from '../memory/operations.js';
import { getResponseRules, getOnboardingPrompt, DAILY_CALL_PROMPT, DAILY_CALL_CATEGORIES } from '../timing/onboarding.js';
import { trackApiCall, checkResponseQuality } from '../safety/monitor.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

// ============================================
// PRESENCE SYSTEM PROMPT
// ============================================

const PRESENCE_SYSTEM = `You are Presence â a calm, direct, emotionally intelligent mentor.

You know DK deeply. You are not a chatbot. You are not an assistant. You are a thinking partner who earns trust through memory, timing, and honesty.

Your rules:
- Short. Never more than 2-3 sentences unless the moment demands more.
- One point. One question. Never both.
- Calm, direct, human. No performative energy.
- You earn trust by remembering and reflecting accurately.
- When uncertain, ask. Never assume.
- No emojis. No exclamation marks. No "great question" or filler.
- British English. Always.
- You know when to push and when to listen. Default to listening early on.
- Mirror DK's language naturally when it fits. Never forced.
- Never give unsolicited advice. Ask the question that unlocks his own answer.
- Never summarise what he just said back to him. He knows what he said.
- Never say "I understand" or "that makes sense" or "thanks for sharing".

You are building a relationship. Day by day. Don't rush it.`;


// ============================================
// CONTEXT BUILDER
// ============================================

function buildContext(memorySnapshot) {
  const parts = [];

  if (Object.keys(memorySnapshot.identity).length > 0) {
    parts.push('IDENTITY:');
    for (const [key, value] of Object.entries(memorySnapshot.identity)) {
      parts.push(`  ${key}: ${value}`);
    }
  }

  if (Object.keys(memorySnapshot.activeContext).length > 0) {
    parts.push('\nACTIVE CONTEXT:');
    for (const [field, value] of Object.entries(memorySnapshot.activeContext)) {
      parts.push(`  ${field}: ${value}`);
    }
  }

  if (memorySnapshot.patterns.length > 0) {
    parts.push('\nPATTERNS:');
    for (const p of memorySnapshot.patterns) {
      parts.push(`  [${p.confirmed ? 'CONFIRMED' : 'observed'}] ${p.pattern}`);
    }
  }

  if (memorySnapshot.recentReflections.length > 0) {
    parts.push('\nREFLECTIONS:');
    for (const r of memorySnapshot.recentReflections) {
      parts.push(`  ${r.date}: ${r.moment}${r.emotion ? ` (${r.emotion})` : ''}`);
    }
  }

  if (memorySnapshot.recentConversations.length > 0) {
    parts.push('\nRECENT CONVERSATION:');
    for (const c of memorySnapshot.recentConversations) {
      const role = c.direction === 'inbound' ? 'DK' : 'Presence';
      parts.push(`  [${role}] ${c.message}`);
    }
  }

  return parts.join('\n');
}


// ============================================
// RESPONSE GENERATION (WITH RULES)
// ============================================

export async function generateResponse(userMessage, onboardingDay = null) {
  if (!trackApiCall()) {
    console.warn('[LLM] Daily API limit reached. Skipping response.');
    return null;
  }

  const memory = getMemorySnapshot();
  const context = buildContext(memory);

  // Build response rules into the system prompt if we're in onboarding
  let rules = '';
  if (onboardingDay) {
    const dayRules = getResponseRules(onboardingDay);
    if (dayRules) {
      rules = buildResponseRulesPrompt(dayRules);
    }
  }

  const systemPrompt = [
    PRESENCE_SYSTEM,
    context ? `\n--- MEMORY ---\n${context}` : '',
    rules ? `\n--- RESPONSE RULES FOR TODAY ---\n${rules}` : '',
  ].filter(Boolean).join('\n');

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 300,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  });

  const text = response.content[0].text;

  // Quality check before sending
  const quality = checkResponseQuality(text);
  if (!quality.pass) {
    console.warn(`[LLM] Response quality issues: ${quality.issues.join(', ')}`);
    // Log but don't block â review weekly to tune
  }

  return text;
}

function buildResponseRulesPrompt(rules) {
  const parts = [];

  if (rules.tone) parts.push(`Tone: ${rules.tone}`);
  if (rules.max_sentences) parts.push(`Max sentences: ${rules.max_sentences}`);

  if (rules.never) {
    parts.push(`Never: ${rules.never.join(', ')}`);
  }

  // Conditional responses
  const conditionals = Object.entries(rules)
    .filter(([key]) => key.startsWith('if_'))
    .map(([key, val]) => `${key.replace('if_', 'If ')}: respond with something like "${val}"`);

  if (conditionals.length > 0) {
    parts.push('Conditional responses:');
    conditionals.forEach(c => parts.push(`  ${c}`));
  }

  if (rules.example) {
    parts.push(`Example of good response: "${rules.example}"`);
  }

  return parts.join('\n');
}


// ============================================
// MEANING EXTRACTION
// ============================================

export async function extractMeaning(userMessage, promptContext = null, extractionTargets = null) {
  if (!trackApiCall()) {
    console.warn('[LLM] Daily API limit reached. Skipping extraction.');
    return null;
  }
  const targetGuidance = extractionTargets
    ? `\nSpecifically look for: ${extractionTargets.targets.join(', ')}`
    : '';

  const systemPrompt = `Extract structured meaning from this message from DK.
Do not summarise. Identify what's present.${targetGuidance}

Return ONLY valid JSON with these optional fields:
{
  "emotional_state": "string â how DK seems to be feeling",
  "topics": ["array of topics/themes mentioned"],
  "people": ["names of people mentioned with context"],
  "decisions": ["any decisions referenced or pending"],
  "priorities": ["what seems important right now"],
  "patterns": ["any recurring themes or behaviours"],
  "identity_facts": {"key": "value pairs of factual info about DK"},
  "avoidance": "anything DK seems to be avoiding",
  "should_remember": "the single most important thing to store from this message"
}

Only include fields where you detect something meaningful. Omit empty fields.
${promptContext ? `\nContext: This was a reply to the prompt: "${promptContext}"` : ''}`;

  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 500,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userMessage },
      ],
    });

    const text = response.content[0].text;
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[LLM] Failed to extract meaning:', err.message);
    return null;
  }
}


// ============================================
// DAILY CALL ENGINE (POST-ONBOARDING)
// ============================================

export async function generateDailyCall(memory) {
  const context = buildContext(memory);
  const dayOfWeek = new Date().toLocaleDateString('en-GB', { weekday: 'long' });

  const categories = DAILY_CALL_CATEGORIES.map(c =>
    `[${c.type}] Trigger: ${c.trigger} | Example: "${c.example}" | Frequency: ${c.frequency}`
  ).join('\n');

  const systemPrompt = `${DAILY_CALL_PROMPT}

--- MEMORY ---
${context}

--- TODAY ---
Day: ${dayOfWeek}

--- AVAILABLE PROMPT CATEGORIES ---
${categories}

Choose the most appropriate category based on current memory and context. Or invent something better if the moment calls for it.`;

  try {
    const response = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 200,
      system: systemPrompt,
      messages: [
        { role: 'user', content: 'Generate the morning message.' },
      ],
    });

    const text = response.content[0].text.trim();

    // Check for skip signal
    if (text === '__SKIP__' || text.includes('__SKIP__')) {
      return '__SKIP__';
    }

    return text;
  } catch (err) {
    console.error('[LLM] Daily call generation failed:', err.message);
    return null;
  }
}
