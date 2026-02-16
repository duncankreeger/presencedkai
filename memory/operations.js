import { getDb } from './setup.js';

// ââ Conversations âââââââââââââââââââââââââââââââââ

export function logMessage(direction, message, promptDay = null, extractedMeaning = null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO conversations (direction, message, prompt_day, extracted_meaning)
    VALUES (?, ?, ?, ?)
  `).run(direction, message, promptDay, extractedMeaning);
}

export function getRecentConversations(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT direction, message, prompt_day, timestamp
    FROM conversations
    WHERE message NOT LIKE '[meaning]%'
    ORDER BY id DESC
    LIMIT ?
  `).all(limit).reverse();
}

// ââ Onboarding ââââââââââââââââââââââââââââââââââââ

export function getOnboardingDay() {
  const db = getDb();

  // Find the highest day that has been sent
  const lastSent = db.prepare(`
    SELECT MAX(day) as maxDay FROM onboarding WHERE sent_at IS NOT NULL
  `).get();

  if (!lastSent || lastSent.maxDay === null) {
    return 1; // Haven't started yet
  }

  // Check if last sent day has been replied to
  const lastDay = db.prepare(`
    SELECT * FROM onboarding WHERE day = ?
  `).get(lastSent.maxDay);

  if (lastDay && lastDay.replied_at) {
    // Replied â next day
    return lastSent.maxDay + 1;
  }

  // Not yet replied â still on this day (waiting for response)
  return lastSent.maxDay + 1;
}

export function markOnboardingSent(day) {
  const db = getDb();
  db.prepare(`
    INSERT INTO onboarding (day, sent_at) VALUES (?, datetime('now'))
    ON CONFLICT(day) DO UPDATE SET sent_at = datetime('now')
  `).run(day);
}

export function markOnboardingReplied(day) {
  const db = getDb();
  db.prepare(`
    UPDATE onboarding SET replied_at = datetime('now') WHERE day = ?
  `).run(day);
}

// ââ Identity ââââââââââââââââââââââââââââââââââââââ

export function setIdentityFact(field, value, confidence = 0.7, source = null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO identity (field, value, confidence, source, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(field) DO UPDATE SET
      value = excluded.value,
      confidence = MAX(identity.confidence, excluded.confidence),
      source = COALESCE(excluded.source, identity.source),
      updated_at = datetime('now')
  `).run(field, value, confidence, source);
}

export function getIdentityFacts() {
  const db = getDb();
  const rows = db.prepare('SELECT field, value, confidence FROM identity ORDER BY confidence DESC').all();
  const facts = {};
  for (const row of rows) {
    facts[row.field] = row.confidence >= 0.9 ? row.value : `${row.value} (unconfirmed)`;
  }
  return facts;
}

// ââ Patterns ââââââââââââââââââââââââââââââââââââââ

export function addPattern(pattern, category = null) {
  const db = getDb();

  // Check if a similar pattern already exists
  const existing = db.prepare(`
    SELECT id, occurrences FROM patterns WHERE pattern = ?
  `).get(pattern);

  if (existing) {
    db.prepare(`
      UPDATE patterns SET occurrences = occurrences + 1, last_seen = datetime('now') WHERE id = ?
    `).run(existing.id);
  } else {
    db.prepare(`
      INSERT INTO patterns (pattern, category) VALUES (?, ?)
    `).run(pattern, category);
  }
}

export function getPatterns() {
  const db = getDb();
  return db.prepare(`
    SELECT pattern, category, occurrences, confirmed, first_seen, last_seen
    FROM patterns
    ORDER BY occurrences DESC, last_seen DESC
  `).all();
}

// ââ Reflections âââââââââââââââââââââââââââââââââââ

export function addReflection(moment, emotion = null, topics = null) {
  const db = getDb();
  db.prepare(`
    INSERT INTO reflections (moment, emotion, topics) VALUES (?, ?, ?)
  `).run(moment, emotion, topics ? JSON.stringify(topics) : null);
}

export function getRecentReflections(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT date, moment, emotion, topics FROM reflections ORDER BY id DESC LIMIT ?
  `).all(limit).reverse();
}

// ââ Active Context ââââââââââââââââââââââââââââââââ

export function setActiveContext(field, value) {
  const db = getDb();
  db.prepare(`
    INSERT INTO active_context (field, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(field) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(field, value);
}

export function getActiveContext() {
  const db = getDb();
  const rows = db.prepare('SELECT field, value FROM active_context').all();
  const context = {};
  for (const row of rows) {
    context[row.field] = row.value;
  }
  return context;
}

// ââ Memory Snapshot âââââââââââââââââââââââââââââââ
// Used to build context for Claude calls.

export function getMemorySnapshot() {
  return {
    identity: getIdentityFacts(),
    activeContext: getActiveContext(),
    patterns: getPatterns(),
    recentReflections: getRecentReflections(5),
    recentConversations: getRecentConversations(10),
  };
}
