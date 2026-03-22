// Subscription/receipt scanner — regex-based cost detection

const RECEIPT_SUBJECT_PATTERNS = [
  /receipt/i,
  /payment/i,
  /invoice/i,
  /charged/i,
  /billing/i,
  /subscription/i,
  /order\s+confirm/i,
  /your\s+.*\s+plan/i,
  /renewal/i,
  /thank\s+you\s+for\s+(your\s+)?(purchase|payment|order)/i
];

const AMOUNT_PATTERNS = [
  /\$\s?(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/,         // $12.99, $ 12.99, $1,200.00
  /USD\s?(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/i,         // USD 12.99
  /(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|dollars)/i,  // 12.99 USD
  /total[:\s]+\$?\s?(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/i,   // Total: $12.99
  /amount[:\s]+\$?\s?(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/i   // Amount: $12.99
];

export function scanSubscriptions(emails) {
  const subscriptions = [];

  for (const email of emails) {
    const isReceipt = RECEIPT_SUBJECT_PATTERNS.some(p => p.test(email.subject));
    if (!isReceipt) continue;

    const text = `${email.subject} ${email.body || email.snippet || ''}`;
    const amount = extractAmount(text);

    if (amount !== null) {
      subscriptions.push({
        emailId: email.id,
        service: extractServiceName(email),
        amount,
        date: email.date,
        subject: email.subject,
        from: email.from,
        frequency: guessFrequency(text, amount)
      });
    }
  }

  // Deduplicate by service name
  return deduplicateSubscriptions(subscriptions);
}

function extractAmount(text) {
  for (const pattern of AMOUNT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ''));
      if (amount > 0 && amount < 10000) return amount; // Sanity check
    }
  }
  return null;
}

function extractServiceName(email) {
  // Try sender name first
  const from = email.from || '';
  const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) {
    const name = nameMatch[1].trim();
    // Clean up common suffixes
    return name
      .replace(/\s*(billing|payments?|noreply|no-reply|support|team)\s*/gi, '')
      .trim() || extractDomain(from);
  }

  return extractDomain(from);
}

function extractDomain(from) {
  const match = from.match(/@([^.>]+)/);
  if (match) {
    return match[1].charAt(0).toUpperCase() + match[1].slice(1);
  }
  return 'Unknown Service';
}

function guessFrequency(text, amount) {
  const lowerText = text.toLowerCase();
  if (/annual|yearly|per\s+year|\/yr/i.test(lowerText)) return 'annual';
  if (/quarterly|per\s+quarter/i.test(lowerText)) return 'quarterly';
  if (/weekly|per\s+week/i.test(lowerText)) return 'weekly';
  // Default to monthly for subscription-like amounts
  return 'monthly';
}

function deduplicateSubscriptions(subscriptions) {
  const byService = new Map();

  for (const sub of subscriptions) {
    const key = sub.service.toLowerCase();
    if (!byService.has(key) || new Date(sub.date) > new Date(byService.get(key).date)) {
      byService.set(key, sub);
    }
  }

  const deduped = Array.from(byService.values());

  // Calculate estimated monthly cost for each
  return deduped.map(sub => ({
    ...sub,
    monthlyCost: toMonthlyCost(sub.amount, sub.frequency)
  }));
}

function toMonthlyCost(amount, frequency) {
  switch (frequency) {
    case 'annual': return Math.round((amount / 12) * 100) / 100;
    case 'quarterly': return Math.round((amount / 3) * 100) / 100;
    case 'weekly': return Math.round(amount * 4.33 * 100) / 100;
    default: return amount;
  }
}
