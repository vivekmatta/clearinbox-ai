// Gmail REST API wrapper — list + batch get messages

const GMAIL_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

export async function listMessages(token, { maxResults = 50, query = 'newer_than:3d' } = {}) {
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    q: query
  });

  const response = await fetch(`${GMAIL_BASE}/messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('AUTH_EXPIRED');
    throw new Error(`Gmail list failed: ${response.status}`);
  }

  const data = await response.json();
  return (data.messages || []).map(m => m.id);
}

export async function getMessages(token, messageIds) {
  // Use Gmail batch API — one HTTP request for all messages
  const boundary = 'batch_clearinbox_' + Date.now();

  const batchBody = messageIds.map((id, i) => {
    return [
      `--${boundary}`,
      'Content-Type: application/http',
      `Content-ID: <item${i}>`,
      '',
      `GET /gmail/v1/users/me/messages/${id}?format=full`,
      ''
    ].join('\r\n');
  }).join('\r\n') + `\r\n--${boundary}--`;

  const response = await fetch('https://www.googleapis.com/batch/gmail/v1', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/mixed; boundary=${boundary}`
    },
    body: batchBody
  });

  if (!response.ok) {
    if (response.status === 401) throw new Error('AUTH_EXPIRED');
    throw new Error(`Gmail batch failed: ${response.status}`);
  }

  const responseText = await response.text();
  return parseBatchResponse(responseText, messageIds);
}

function parseBatchResponse(responseText, messageIds) {
  const emails = [];

  // Split by boundary — find the boundary from the response
  const boundaryMatch = responseText.match(/--batch_\S+/);
  if (!boundaryMatch) {
    // Fallback: try to parse as individual JSON objects
    return [];
  }

  const boundary = boundaryMatch[0];
  const parts = responseText.split(boundary).filter(p => p.trim() && p.trim() !== '--');

  for (const part of parts) {
    // Find JSON body in each part
    const jsonMatch = part.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;

    try {
      const msg = JSON.parse(jsonMatch[0]);
      if (!msg.id) continue;

      emails.push(parseMessage(msg));
    } catch (e) {
      // Skip malformed parts
    }
  }

  return emails;
}

function parseMessage(msg) {
  const headers = msg.payload?.headers || [];
  const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = getHeader('Subject');
  const from = getHeader('From');
  const to = getHeader('To');
  const date = getHeader('Date');
  const listUnsubscribe = getHeader('List-Unsubscribe');
  const listUnsubscribePost = getHeader('List-Unsubscribe-Post');

  // Extract plain text body (first 500 chars for classification)
  const body = extractBody(msg.payload);

  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    from,
    to,
    date,
    snippet: msg.snippet || '',
    body,
    listUnsubscribe,
    listUnsubscribePost,
    labelIds: msg.labelIds || [],
    headers
  };
}

function extractBody(payload, maxLength = 500) {
  if (!payload) return '';

  // Direct body
  if (payload.body?.data) {
    return decodeBase64(payload.body.data).slice(0, maxLength);
  }

  // Multipart — prefer text/plain
  if (payload.parts) {
    // First try text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data).slice(0, maxLength);
      }
    }
    // Fallback to text/html (strip tags)
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64(part.body.data);
        return stripHtml(html).slice(0, maxLength);
      }
    }
    // Recurse into nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const result = extractBody(part, maxLength);
        if (result) return result;
      }
    }
  }

  return '';
}

function decodeBase64(data) {
  try {
    // Gmail uses URL-safe base64
    const decoded = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return decoded;
  } catch {
    return '';
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
