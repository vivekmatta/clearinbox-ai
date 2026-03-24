// Batch email classifier — 10 emails per prompt, returns structured JSON

import { callGemini } from './gemini-api.js';
import { incrementApiCallCount } from './storage.js';

const BATCH_SIZE = 15;

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
    body_preview: (email.body || email.snippet || '').slice(0, 200),
    gmail_labels: email.labelIds || []
  }));

  const prompt = `You are a strict email classifier for a busy person. Classify each email into exactly one category.

APPLY CATEGORIES IN THIS ORDER (first match wins):

1. "spam" — Phishing, scams, unsolicited outreach from strangers, SEO pitches, fake invoices.

2. "newsletter" — ANY email from a company, brand, store, SaaS product, or mailing list. This includes:
   - Marketing/promotional ("sale ends today", "limited time", "don't miss out", "clearance", "% off")
   - Product updates, release notes, changelogs
   - Digests, roundups, weekly summaries from services
   - Social media notifications (LinkedIn, Twitter/X, Facebook, Instagram)
   - Shipping confirmations, order updates from retailers
   - If gmail_labels includes CATEGORY_PROMOTIONS or CATEGORY_SOCIAL, it is almost certainly "newsletter"
   CRITICAL: Urgency language in marketing emails ("ENDS TODAY", "last chance", "act now") does NOT make them urgent. They are ALWAYS "newsletter".

3. "urgent" — ONLY these specific situations:
   - Bills or payments actually due within 48 hours (from your bank, utility, landlord — NOT a store sale)
   - Security alerts (password reset you didn't request, unusual login, 2FA codes, account compromise)
   - Calendar/meeting changes for today or tomorrow from a real person
   - Legal or compliance deadlines
   NEVER urgent: sales, promotions, coupons, product launches, webinar reminders, app notifications, clearance events

4. "needs_reply" — A real person (not a company or automated system) is directly asking you a question or requesting something. Must be a human writing to you personally.

5. "fyi" — Everything else that doesn't fit above.

For each email provide: category, importance (1-10), summary (one sentence), action_required (boolean), action_description (string or null).

Emails:
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

export async function generateSummary(apiKey, emails, classifications) {
  const important = emails
    .filter(e => {
      const c = classifications[e.id];
      return c && c.category !== 'spam' && c.category !== 'newsletter';
    })
    .map(e => ({
      category: classifications[e.id].category,
      from: e.from,
      subject: e.subject,
      summary: classifications[e.id].summary,
      action: classifications[e.id].action_description
    }));

  const counts = { urgent: 0, needs_reply: 0, fyi: 0, newsletter: 0, spam: 0 };
  for (const e of emails) {
    counts[classifications[e.id]?.category || 'fyi']++;
  }

  const prompt = `You are a personal email assistant. Write a detailed, scannable inbox digest.

Stats: ${JSON.stringify(counts)}

Important emails (non-newsletter, non-spam):
${JSON.stringify(important, null, 2)}

Write a 5-8 bullet summary:
- Start with the most urgent/actionable items
- Group related items ("2 bills due this week", "3 recruiters reached out")
- Mention who needs a reply and about what
- Include FYI items: receipts, confirmations, shipping updates
- Note job application updates if any (interviews, rejections, offers)
- End with a one-line note about newsletters/spam that can be skipped
- Be specific (use sender names, amounts, dates, job titles from subjects)
- Keep each bullet under 40 words
- Keep total under 300 words

Return JSON: { "headline": "one-line headline under 15 words", "bullets": ["...", "..."] }`;

  const responseText = await callGemini(apiKey, prompt);
  await incrementApiCallCount();
  return JSON.parse(responseText);
}
