// Unsubscribe detection — List-Unsubscribe header + HTML body fallback

export function detectUnsubscribe(email) {
  // Method 1: List-Unsubscribe header (RFC 2369, required by Gmail/Yahoo since 2024)
  const headerLink = parseListUnsubscribeHeader(email.listUnsubscribe);
  if (headerLink) {
    return {
      method: 'header',
      url: headerLink,
      hasOneClick: Boolean(email.listUnsubscribePost),
      senderName: extractSenderName(email.from),
      senderEmail: extractSenderEmail(email.from)
    };
  }

  // Method 2: Regex scan HTML body for unsubscribe links
  const bodyLink = findUnsubscribeLinkInBody(email.body || '');
  if (bodyLink) {
    return {
      method: 'body',
      url: bodyLink,
      hasOneClick: false,
      senderName: extractSenderName(email.from),
      senderEmail: extractSenderEmail(email.from)
    };
  }

  return null;
}

function parseListUnsubscribeHeader(header) {
  if (!header) return null;

  // Header format: <https://example.com/unsub>, <mailto:unsub@example.com>
  const urlMatch = header.match(/<(https?:\/\/[^>]+)>/);
  if (urlMatch) return urlMatch[1];

  // Mailto fallback — return null (we only support URL-based unsubscribe)
  return null;
}

function findUnsubscribeLinkInBody(body) {
  if (!body) return null;

  // Look for links near "unsubscribe" text
  const patterns = [
    // href="..." near unsubscribe text
    /unsubscribe[^"]*?href=["'](https?:\/\/[^"']+)["']/i,
    /href=["'](https?:\/\/[^"']*unsubscribe[^"']*)["']/i,
    /href=["'](https?:\/\/[^"']*unsub[^"']*)["']/i,
    /href=["'](https?:\/\/[^"']*opt[_-]?out[^"']*)["']/i,
    /href=["'](https?:\/\/[^"']*remove[^"']*)["']/i,
    // Plain URLs with unsubscribe
    /(https?:\/\/\S*unsubscribe\S*)/i,
    /(https?:\/\/\S*unsub\S*)/i
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function extractSenderName(from) {
  if (!from) return 'Unknown';
  // "John Doe <john@example.com>" → "John Doe"
  const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) return nameMatch[1].trim();
  // "john@example.com" → domain name
  const emailMatch = from.match(/@([^.>]+)/);
  if (emailMatch) return emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1);
  return from;
}

function extractSenderEmail(from) {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/) || from.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1] : from;
}
