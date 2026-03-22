// Batch email classifier — 10 emails per prompt, returns structured JSON

import { callGemini } from './gemini-api.js';
import { incrementApiCallCount } from './storage.js';

const BATCH_SIZE = 10;

export async function classifyEmails(apiKey, emails) {
  const results = {};
  const batches = [];

  // Split into batches of 10
  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    batches.push(emails.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    try {
      const batchResults = await classifyBatch(apiKey, batch);
      Object.assign(results, batchResults);
      await incrementApiCallCount();
    } catch (err) {
      if (err.message === 'RATE_LIMITED') throw err;
      // On error, assign defaults for this batch
      for (const email of batch) {
        results[email.id] = getDefaultClassification(email);
      }
    }
  }

  return results;
}

async function classifyBatch(apiKey, emails) {
  const emailSummaries = emails.map((email, i) => ({
    index: i,
    id: email.id,
    from: email.from,
    subject: email.subject,
    body_preview: (email.body || email.snippet || '').slice(0, 200)
  }));

  const prompt = `You are an email classifier. Analyze these emails and classify each one.

For each email, provide:
- category: one of "urgent", "needs_reply", "fyi", "newsletter", "spam"
- importance: 1-10 (10 = most important)
- summary: one sentence summary of the email
- action_required: boolean, and if true, a short description of the action needed

Classification guidelines:
- "urgent": time-sensitive, requires immediate attention (security alerts, meeting changes today, critical bugs)
- "needs_reply": someone is waiting for your response (direct questions, requests, invitations)
- "fyi": informational but relevant to you (team updates, project status, notifications you opted into)
- "newsletter": bulk/marketing emails, digests, newsletters, promotional content
- "spam": unwanted solicitations, phishing attempts, irrelevant marketing

Emails to classify:
${JSON.stringify(emailSummaries, null, 2)}

Respond with a JSON array where each element has: id, category, importance, summary, action_required (bool), action_description (string or null).`;

  const responseText = await callGemini(apiKey, prompt);
  const parsed = JSON.parse(responseText);

  const results = {};
  const classifications = Array.isArray(parsed) ? parsed : (parsed.classifications || parsed.emails || []);

  for (const item of classifications) {
    if (item.id) {
      results[item.id] = {
        category: validateCategory(item.category),
        importance: Math.min(10, Math.max(1, Number(item.importance) || 5)),
        summary: item.summary || '',
        action_required: Boolean(item.action_required),
        action_description: item.action_description || null
      };
    }
  }

  // Fill in any missing emails with defaults
  for (const email of emails) {
    if (!results[email.id]) {
      results[email.id] = getDefaultClassification(email);
    }
  }

  return results;
}

const VALID_CATEGORIES = ['urgent', 'needs_reply', 'fyi', 'newsletter', 'spam'];

function validateCategory(category) {
  const normalized = (category || '').toLowerCase().replace(/\s+/g, '_');
  return VALID_CATEGORIES.includes(normalized) ? normalized : 'fyi';
}

function getDefaultClassification(email) {
  return {
    category: 'fyi',
    importance: 5,
    summary: email.subject || 'No subject',
    action_required: false,
    action_description: null
  };
}
