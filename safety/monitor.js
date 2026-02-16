import { config } from '../config/index.js';
import { getDb } from '../memory/setup.js';

// ============================================
// API CALL TRACKING
// ============================================

let dailyApiCalls = 0;
let dailyApiDate = new Date().toDateString();
const DAILY_API_LIMIT = 50;

export function trackApiCall() {
  const today = new Date().toDateString();
  if (today !== dailyApiDate) {
    dailyApiCalls = 0;
    dailyApiDate = today;
  }
  dailyApiCalls++;

  if (dailyApiCalls > DAILY_API_LIMIT) {
    console.error(`[Safety] API call limit exceeded: ${dailyApiCalls}/${DAILY_API_LIMIT}. Pausing.`);
    return false; // Signal to caller: don't make the call
  }

  return true;
}

export function getApiCallCount() {
  return { count: dailyApiCalls, limit: DAILY_API_LIMIT, date: dailyApiDate };
}


// ============================================
// MESSAGE TIMING JITTER
// ============================================
// Don't send at exactly the same time every day.
// Add 1-15 minutes of random delay to avoid detection patterns.

export function getJitteredDelay() {
  const minDelay = 60 * 1000;        // 1 minute minimum
  const maxDelay = 15 * 60 * 1000;   // 15 minutes maximum
  return Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
}


// ============================================
// CONNECTION WATCHDOG
// ============================================

let lastConnectionTime = null;
let lastMessageSent = null;
let lastMessageReceived = null;

export function markConnected() {
  lastConnectionTime = new Date();
}

export function markMessageSent() {
  lastMessageSent = new Date();
}

export function markMessageReceived() {
  lastMessageReceived = new Date();
}

export function getHealthStatus() {
  const now = new Date();
  const connectionAge = lastConnectionTime
    ? Math.floor((now - lastConnectionTime) / 1000 / 60)
    : null;
  const lastSentAge = lastMessageSent
    ? Math.floor((now - lastMessageSent) / 1000 / 60)
    : null;
  const lastReceivedAge = lastMessageReceived
    ? Math.floor((now - lastMessageReceived) / 1000 / 60)
    : null;

  return {
    connected: lastConnectionTime !== null,
    connectionAge: connectionAge !== null ? `${connectionAge}m` : 'never',
    lastSent: lastSentAge !== null ? `${lastSentAge}m ago` : 'never',
    lastReceived: lastReceivedAge !== null ? `${lastReceivedAge}m ago` : 'never',
    apiCalls: getApiCallCount(),
    dbSize: getDatabaseSize(),
  };
}

function getDatabaseSize() {
  try {
    const db = getDb();
    const messages = db.prepare('SELECT COUNT(*) as count FROM conversations').get();
    const identity = db.prepare('SELECT COUNT(*) as count FROM identity').get();
    const patterns = db.prepare('SELECT COUNT(*) as count FROM patterns').get();
    const reflections = db.prepare('SELECT COUNT(*) as count FROM reflections').get();

    return {
      messages: messages.count,
      identity: identity.count,
      patterns: patterns.count,
      reflections: reflections.count,
    };
  } catch {
    return { error: 'db not initialised' };
  }
}


// ============================================
// RESPONSE SAFETY CHECKS
// ============================================
// Catch tone drift before it reaches DK.

const BANNED_PHRASES = [
  'great question',
  'that\'s a great',
  'i understand',
  'that makes sense',
  'thanks for sharing',
  'i appreciate you',
  'absolutely',
  'of course!',
  'no worries',
  'happy to help',
  'let me help you',
  'i\'m here for you',
  'that\'s wonderful',
  'how exciting',
];

export function checkResponseQuality(response) {
  const issues = [];
  const lower = response.toLowerCase();

  // Check banned phrases
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push(`Contains banned phrase: "${phrase}"`);
    }
  }

  // Check length
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length > 4) {
    issues.push(`Too long: ${sentences.length} sentences (max 3-4)`);
  }

  // Check for emojis
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  if (emojiRegex.test(response)) {
    issues.push('Contains emoji');
  }

  // Check for exclamation marks (more than 0 is suspect, more than 1 is wrong)
  const exclamations = (response.match(/!/g) || []).length;
  if (exclamations > 1) {
    issues.push(`Too many exclamation marks: ${exclamations}`);
  }

  // Check for bullet points or numbered lists
  if (response.includes('- ') || response.match(/^\d+\./m)) {
    issues.push('Contains list formatting');
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}


// ============================================
// DATABASE BACKUP
// ============================================

import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

export function backupDatabase() {
  const dbPath = config.paths.dbPath;
  const backupDir = join(dirname(dbPath), 'backups');
  mkdirSync(backupDir, { recursive: true });

  const date = new Date().toISOString().split('T')[0];
  const backupPath = join(backupDir, `presence-${date}.db`);

  try {
    copyFileSync(dbPath, backupPath);
    console.log(`[Backup] Database backed up to ${backupPath}`);

    // Rotate: keep last 30 backups
    const backups = readdirSync(backupDir)
      .filter(f => f.startsWith('presence-') && f.endsWith('.db'))
      .sort()
      .reverse();

    for (const old of backups.slice(30)) {
      unlinkSync(join(backupDir, old));
      console.log(`[Backup] Rotated old backup: ${old}`);
    }

    return backupPath;
  } catch (err) {
    console.error(`[Backup] Failed: ${err.message}`);
    return null;
  }
}
