import {
  setIdentityFact,
  addPattern,
  addReflection,
  setActiveContext,
} from '../memory/operations.js';

// ============================================
// MEANING PROCESSOR
// ============================================
// Takes the structured JSON from Claude's extraction
// and writes it into the appropriate memory tables.

export function processMeaning(meaning) {
  if (!meaning || typeof meaning !== 'object') {
    return;
  }

  let stored = 0;

  // ââ Identity facts ââââââââââââââââââââââââââââââ
  if (meaning.identity_facts && typeof meaning.identity_facts === 'object') {
    for (const [key, value] of Object.entries(meaning.identity_facts)) {
      if (key && value) {
        setIdentityFact(key, String(value), 0.7, 'extraction');
        stored++;
      }
    }
  }

  // ââ Patterns ââââââââââââââââââââââââââââââââââââ
  if (Array.isArray(meaning.patterns)) {
    for (const pattern of meaning.patterns) {
      if (pattern && typeof pattern === 'string') {
        addPattern(pattern, 'extracted');
        stored++;
      }
    }
  }

  // ââ Emotional state â active context ââââââââââââ
  if (meaning.emotional_state) {
    setActiveContext('emotional_state', meaning.emotional_state);
    stored++;
  }

  // ââ Topics â active context âââââââââââââââââââââ
  if (Array.isArray(meaning.topics) && meaning.topics.length > 0) {
    setActiveContext('current_topics', meaning.topics.join(', '));
    stored++;
  }

  // ââ People â active context âââââââââââââââââââââ
  if (Array.isArray(meaning.people) && meaning.people.length > 0) {
    setActiveContext('people_mentioned', meaning.people.join(', '));
    stored++;
  }

  // ââ Decisions â active context ââââââââââââââââââ
  if (Array.isArray(meaning.decisions) && meaning.decisions.length > 0) {
    setActiveContext('pending_decisions', meaning.decisions.join(', '));
    stored++;
  }

  // ââ Priorities â active context âââââââââââââââââ
  if (Array.isArray(meaning.priorities) && meaning.priorities.length > 0) {
    setActiveContext('stated_priorities', meaning.priorities.join(', '));
    stored++;
  }

  // ââ Avoidance â active context ââââââââââââââââââ
  if (meaning.avoidance) {
    setActiveContext('avoidance', meaning.avoidance);
    stored++;
  }

  // ââ Should remember â reflection ââââââââââââââââ
  if (meaning.should_remember) {
    addReflection(
      meaning.should_remember,
      meaning.emotional_state || null,
      meaning.topics || null,
    );
    stored++;
  }

  console.log(`[Meaning] Processed ${stored} items into memory.`);
}
