// Background service worker — auth, email fetch orchestration, alarms

import * as storage from '../lib/storage.js';

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

async function fetchAndClassifyEmails() {
  const { listMessages, getMessages } = await import('../lib/gmail-api.js');
  const { classifyEmails } = await import('../lib/classifier.js');
  const { detectUnsubscribe } = await import('../lib/unsubscribe-detector.js');
  const { scanSubscriptions } = await import('../lib/subscription-scanner.js');

  const token = await getAuthToken(false);

  // Fetch last 50 emails from the past 3 days
  const messageIds = await listMessages(token, { maxResults: 50, query: 'newer_than:3d' });

  if (!messageIds.length) {
    return { emails: [], classifications: {}, unsubscribe: {}, subscriptions: [] };
  }

  // Batch get all message details
  const emails = await getMessages(token, messageIds);

  // Check cache for existing classifications
  const cached = await storage.getBatchClassifications(messageIds);
  const uncachedEmails = emails.filter(e => !cached[e.id]);

  // Classify uncached emails
  let newClassifications = {};
  if (uncachedEmails.length > 0) {
    const apiKey = await storage.get('gemini_api_key');
    if (apiKey) {
      newClassifications = await classifyEmails(apiKey, uncachedEmails);
      // Cache new classifications
      for (const [id, classification] of Object.entries(newClassifications)) {
        await storage.setClassification(id, classification);
      }
    }
  }

  const classifications = { ...cached, ...newClassifications };

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
    subscriptions
  });

  return { emails, classifications, unsubscribe, subscriptions };
}

// Set up hourly alarm for background refresh
chrome.alarms.create('refreshEmails', { periodInMinutes: 60 });

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
