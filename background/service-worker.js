// Background service worker — auth, email fetch orchestration, alarms

import * as storage from '../lib/storage.js';
import { listMessages, getMessages } from '../lib/gmail-api.js';
import { classifyEmails, generateSummary } from '../lib/classifier.js';
import { detectUnsubscribe } from '../lib/unsubscribe-detector.js';
import { scanSubscriptions } from '../lib/subscription-scanner.js';

// Handle messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getAuthToken') {
    getAuthToken(message.interactive !== false)
      .then(token => sendResponse({ token }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // async response
  }

  if (message.type === 'getUserInfo') {
    getUserInfo()
      .then(info => sendResponse(info))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'signOut') {
    signOut()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'fetchEmails') {
    fetchAndClassifyEmails()
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function getUserInfo() {
  const token = await getAuthToken(false);
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error('Failed to fetch user info');
  return response.json();
}

async function signOut() {
  const token = await getAuthToken(false);
  // Revoke the token
  await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
  // Remove cached token
  return new Promise((resolve, reject) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

const DAILY_BUDGET = 18;

async function fetchAndClassifyEmails() {
  const token = await getAuthToken(false);

  // Two-pass fetch: primary inbox + sample of promotions for Unsub/Costs
  const primaryIds = await listMessages(token, {
    maxResults: 30,
    query: 'category:primary newer_than:3d'
  });
  const promoIds = await listMessages(token, {
    maxResults: 15,
    query: '(category:promotions OR category:updates OR category:social) newer_than:3d'
  });

  // Deduplicate
  const seen = new Set();
  const allIds = [];
  for (const id of [...primaryIds, ...promoIds]) {
    if (!seen.has(id)) {
      seen.add(id);
      allIds.push(id);
    }
  }

  if (!allIds.length) {
    return { emails: [], classifications: {}, unsubscribe: {}, subscriptions: [], aiSummary: null };
  }

  // Batch get all message details
  const emails = await getMessages(token, allIds);

  // Check cache for existing classifications
  const cached = await storage.getBatchClassifications(allIds);
  const uncachedEmails = emails.filter(e => !cached[e.id]);

  // Pre-classify obvious promotions/social locally (no API call)
  const preClassified = {};
  const needsAI = [];
  for (const email of uncachedEmails) {
    const labels = email.labelIds || [];
    if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('CATEGORY_SOCIAL')) {
      preClassified[email.id] = {
        category: 'newsletter',
        importance: 2,
        summary: email.subject || 'Newsletter',
        action_required: false,
        action_description: null
      };
    } else {
      needsAI.push(email);
    }
  }

  // Cache pre-classified emails
  for (const [id, classification] of Object.entries(preClassified)) {
    await storage.setClassification(id, classification);
  }

  // Classify remaining emails with AI (budget check)
  let aiClassifications = {};
  const apiKey = await storage.get('gemini_api_key');
  if (needsAI.length > 0 && apiKey) {
    const { count } = await storage.getApiCallCount();
    if (count < DAILY_BUDGET) {
      aiClassifications = await classifyEmails(apiKey, needsAI);
      for (const [id, classification] of Object.entries(aiClassifications)) {
        await storage.setClassification(id, classification);
      }
    }
  }

  const classifications = { ...cached, ...preClassified, ...aiClassifications };

  // Generate AI summary
  let aiSummary = null;
  if (apiKey) {
    const { count } = await storage.getApiCallCount();
    if (count < DAILY_BUDGET) {
      try {
        aiSummary = await generateSummary(apiKey, emails, classifications);
      } catch (e) {
        aiSummary = null;
      }
    }
  }

  // Detect unsubscribe links
  const unsubscribe = {};
  for (const email of emails) {
    const unsub = detectUnsubscribe(email);
    if (unsub) {
      unsubscribe[email.id] = unsub;
    }
  }

  // Scan for subscriptions/receipts
  const subscriptions = scanSubscriptions(emails);

  // Store results for popup
  await storage.set('lastFetch', {
    timestamp: Date.now(),
    emails,
    classifications,
    unsubscribe,
    subscriptions,
    aiSummary
  });

  return { emails, classifications, unsubscribe, subscriptions, aiSummary };
}

// Set up hourly alarm for background refresh
chrome.alarms.create('refreshEmails', { periodInMinutes: 180 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshEmails') {
    try {
      // Only refresh if user is authenticated
      const token = await getAuthToken(false);
      if (token) {
        await fetchAndClassifyEmails();
      }
    } catch (e) {
      // Silent fail on background refresh — user not signed in
    }
  }
});
