import * as storage from '../lib/storage.js';

// DOM Elements
const authScreen = document.getElementById('authScreen');
const mainScreen = document.getElementById('mainScreen');
const signInBtn = document.getElementById('signInBtn');
const refreshBtn = document.getElementById('refreshBtn');
const settingsBtn = document.getElementById('settingsBtn');
const userEmail = document.getElementById('userEmail');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const errorBar = document.getElementById('errorBar');
const errorText = document.getElementById('errorText');
const errorDismiss = document.getElementById('errorDismiss');

// State
let currentData = null;
let dismissedUnsubs = new Set();

// Initialize
async function init() {
  // Load dismissed unsubs
  const saved = await storage.get('dismissedUnsubs');
  if (saved) dismissedUnsubs = new Set(saved);

  try {
    const response = await chrome.runtime.sendMessage({ type: 'getUserInfo' });
    if (response?.email) {
      showMainScreen(response.email);
      await loadCachedData();
    } else {
      showAuthScreen();
    }
  } catch {
    showAuthScreen();
  }
}

// Auth
signInBtn.addEventListener('click', async () => {
  signInBtn.disabled = true;
  signInBtn.textContent = 'Signing in...';

  try {
    const tokenResp = await chrome.runtime.sendMessage({ type: 'getAuthToken' });
    if (tokenResp.error) throw new Error(tokenResp.error);

    const infoResp = await chrome.runtime.sendMessage({ type: 'getUserInfo' });
    if (infoResp.error) throw new Error(infoResp.error);

    showMainScreen(infoResp.email);
    await fetchEmails();
  } catch (err) {
    showError(`Sign-in failed: ${err.message}`);
    signInBtn.disabled = false;
    signInBtn.textContent = 'Sign in with Google';
  }
});

// Refresh
refreshBtn.addEventListener('click', () => fetchEmails());

// Settings
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Error dismiss
errorDismiss.addEventListener('click', () => {
  errorBar.classList.add('hidden');
});

// Tab navigation
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// Screen management
function showAuthScreen() {
  authScreen.classList.remove('hidden');
  mainScreen.classList.add('hidden');
}

function showMainScreen(email) {
  authScreen.classList.add('hidden');
  mainScreen.classList.remove('hidden');
  userEmail.textContent = email;
}

function showLoading(text = 'Loading emails...') {
  loadingOverlay.classList.remove('hidden');
  loadingText.textContent = text;
  refreshBtn.classList.add('spinning');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
  refreshBtn.classList.remove('spinning');
}

function showError(message) {
  errorText.textContent = message;
  errorBar.classList.remove('hidden');
  setTimeout(() => errorBar.classList.add('hidden'), 8000);
}

// Data loading
async function loadCachedData() {
  const cached = await storage.get('lastFetch');
  if (cached) {
    currentData = cached;
    renderAll();
  }
}

async function fetchEmails() {
  const apiKey = await storage.get('gemini_api_key');
  if (!apiKey) {
    showError('Please set your Gemini API key in Settings');
    return;
  }

  showLoading('Fetching emails...');

  try {
    showLoading('Classifying with AI...');
    const result = await chrome.runtime.sendMessage({ type: 'fetchEmails' });

    if (result.error) {
      if (result.error === 'AUTH_EXPIRED') {
        showError('Session expired. Please sign in again.');
        showAuthScreen();
        return;
      }
      throw new Error(result.error);
    }

    currentData = result;
    renderAll();
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoading();
  }
}

// Rendering
function renderAll() {
  if (!currentData) return;
  renderDigestTab();
  renderPriorityTab();
  renderAllTab();
  renderUnsubTab();
  renderCostsTab();
  attachCardListeners();
}

// Category config
const CATEGORIES = {
  urgent: { label: 'Urgent', color: '#ef4444', bg: '#fef2f2', icon: '!!' },
  needs_reply: { label: 'Reply', color: '#f59e0b', bg: '#fffbeb', icon: '\u21a9' },
  fyi: { label: 'FYI', color: '#3b82f6', bg: '#eff6ff', icon: 'i' },
  newsletter: { label: 'News', color: '#8b5cf6', bg: '#f5f3ff', icon: '\ud83d\udcf0' },
  spam: { label: 'Spam', color: '#6b7280', bg: '#f9fafb', icon: '\ud83d\udeab' }
};

function renderPriorityTab() {
  const { emails, classifications } = currentData;
  const priority = emails
    .filter(e => {
      const c = classifications[e.id];
      return c && (c.category === 'urgent' || c.category === 'needs_reply');
    })
    .sort((a, b) => (classifications[b.id]?.importance || 0) - (classifications[a.id]?.importance || 0));

  const container = document.getElementById('priorityList');

  if (!priority.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">\u2728</div>
        <p class="empty-title">All clear!</p>
        <p>No urgent emails need your attention</p>
      </div>`;
    return;
  }

  container.innerHTML = priority.map(email => renderEmailCard(email, classifications[email.id])).join('');
}

function renderAllTab() {
  const { emails, classifications } = currentData;

  // Group by category
  const groups = {};
  for (const email of emails) {
    const cat = classifications[email.id]?.category || 'fyi';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(email);
  }

  const container = document.getElementById('allList');
  const order = ['urgent', 'needs_reply', 'fyi', 'newsletter', 'spam'];

  container.innerHTML = order
    .filter(cat => groups[cat]?.length)
    .map(cat => {
      // Group emails by sender within each category
      const senderGroups = {};
      for (const email of groups[cat]) {
        const senderKey = extractEmail(email.from).toLowerCase();
        if (!senderGroups[senderKey]) senderGroups[senderKey] = [];
        senderGroups[senderKey].push(email);
      }

      const senderEntries = Object.values(senderGroups);
      const cardsHtml = senderEntries.map(senderEmails => {
        if (senderEmails.length === 1) {
          return renderEmailCard(senderEmails[0], classifications[senderEmails[0].id]);
        }
        // Stacked sender group
        const first = senderEmails[0];
        const from = extractName(first.from);
        return `
          <div class="sender-stack" data-expanded="false">
            <div class="sender-stack-header">
              <span class="category-badge small" style="background:${CATEGORIES[cat].bg};color:${CATEGORIES[cat].color}">
                ${CATEGORIES[cat].label}
              </span>
              <span class="sender-stack-name">${escapeHtml(from)}</span>
              <span class="sender-stack-count">${senderEmails.length}</span>
              <span class="sender-stack-chevron">\u203a</span>
            </div>
            <div class="sender-stack-emails">
              ${senderEmails.map(email => renderEmailCard(email, classifications[email.id])).join('')}
            </div>
          </div>`;
      }).join('');

      return `
        <div class="category-group">
          <div class="category-header">
            <span class="category-badge" style="background:${CATEGORIES[cat].bg};color:${CATEGORIES[cat].color}">
              ${CATEGORIES[cat].label}
            </span>
            <span class="category-count">${groups[cat].length}</span>
          </div>
          ${cardsHtml}
        </div>`;
    }).join('');
}

function renderDigestTab() {
  const { emails, classifications, aiSummary } = currentData;

  const counts = { urgent: 0, needs_reply: 0, fyi: 0, newsletter: 0, spam: 0 };
  for (const email of emails) {
    const cat = classifications[email.id]?.category || 'fyi';
    counts[cat]++;
  }

  const attention = counts.urgent + counts.needs_reply;

  // AI Summary section
  const summaryHtml = aiSummary ? `
    <div class="digest-ai-section">
      <div class="digest-ai-headline">${escapeHtml(aiSummary.headline || 'Your Inbox Summary')}</div>
      <div class="digest-ai-bullets">
        ${(aiSummary.bullets || aiSummary.summary_bullets || []).map(bullet => `
          <div class="digest-ai-bullet">${escapeHtml(bullet)}</div>
        `).join('')}
      </div>
    </div>
  ` : '';

  document.getElementById('digestContent').innerHTML = `
    ${summaryHtml}
    <div class="digest-stats-row">
      <div class="digest-stat-box">
        <div class="digest-stat-number">${emails.length}</div>
        <div class="digest-stat-label">scanned</div>
      </div>
      <div class="digest-stat-box digest-stat-attention">
        <div class="digest-stat-number">${attention}</div>
        <div class="digest-stat-label">need action</div>
      </div>
    </div>
    <div class="digest-breakdown">
      ${Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([cat, count]) => `
          <div class="digest-row">
            <span class="category-badge small" style="background:${CATEGORIES[cat].bg};color:${CATEGORIES[cat].color}">
              ${CATEGORIES[cat].label}
            </span>
            <span class="digest-count">${count}</span>
            <div class="digest-bar" style="width:${(count / emails.length) * 100}%;background:${CATEGORIES[cat].color}"></div>
          </div>
        `).join('')}
    </div>`;
}

function renderUnsubTab() {
  const { emails, unsubscribe } = currentData;
  const container = document.getElementById('unsubList');

  const unsubEmails = emails.filter(e => unsubscribe[e.id]);

  // Deduplicate by sender email
  const senderMap = {};
  for (const email of unsubEmails) {
    const unsub = unsubscribe[email.id];
    const key = unsub.senderEmail.toLowerCase();
    if (dismissedUnsubs.has(key)) continue;
    if (!senderMap[key]) {
      senderMap[key] = { ...unsub, count: 1 };
    } else {
      senderMap[key].count++;
    }
  }

  const uniqueSenders = Object.values(senderMap);

  if (!uniqueSenders.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No newsletters detected</p>
        <p>Unsubscribe links will appear here</p>
      </div>`;
    return;
  }

  container.innerHTML = uniqueSenders.map(unsub => {
    const key = unsub.senderEmail.toLowerCase();
    return `
      <div class="unsub-card" data-sender="${escapeHtml(key)}">
        <div class="unsub-info">
          <div class="unsub-sender">
            ${escapeHtml(unsub.senderName)}
            ${unsub.count > 1 ? `<span class="unsub-count">${unsub.count}</span>` : ''}
          </div>
          <div class="unsub-email">${escapeHtml(unsub.senderEmail)}</div>
        </div>
        <div class="unsub-actions">
          <a href="${escapeHtml(unsub.url)}" target="_blank" class="btn-unsub" data-sender="${escapeHtml(key)}" title="Opens unsubscribe page in new tab">
            Unsubscribe
          </a>
        </div>
      </div>`;
  }).join('');

  // Attach unsub click handlers
  container.querySelectorAll('.btn-unsub').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const card = btn.closest('.unsub-card');
      const actions = card.querySelector('.unsub-actions');
      const senderKey = btn.dataset.sender;

      // After clicking, show confirmation
      setTimeout(() => {
        actions.innerHTML = `
          <div class="unsub-confirm">
            <span class="unsub-confirm-text">Unsubscribed?</span>
            <button class="btn-unsub-yes" data-sender="${escapeHtml(senderKey)}">Yes</button>
            <button class="btn-unsub-no" data-sender="${escapeHtml(senderKey)}">No</button>
          </div>`;

        actions.querySelector('.btn-unsub-yes').addEventListener('click', async () => {
          dismissedUnsubs.add(senderKey);
          await storage.set('dismissedUnsubs', [...dismissedUnsubs]);
          card.style.animation = 'cardOut 0.2s ease-out forwards';
          setTimeout(() => {
            card.remove();
            // Check if empty
            if (!container.querySelector('.unsub-card')) {
              container.innerHTML = `
                <div class="empty-state">
                  <p class="empty-title">All cleaned up!</p>
                  <p>No more newsletters to unsubscribe from</p>
                </div>`;
            }
          }, 200);
        });

        actions.querySelector('.btn-unsub-no').addEventListener('click', () => {
          actions.innerHTML = `
            <a href="${escapeHtml(card.querySelector('.unsub-email')?.textContent || '')}" target="_blank" class="btn-unsub" data-sender="${escapeHtml(senderKey)}" title="Opens unsubscribe page in new tab">
              Unsubscribe
            </a>`;
          // Re-attach the unsub url from original data
          renderUnsubTab();
        });
      }, 500);
    });
  });
}

function renderCostsTab() {
  const { subscriptions } = currentData;
  const container = document.getElementById('costsList');

  if (!subscriptions?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-title">No subscriptions detected</p>
        <p>Receipt and payment emails will be scanned</p>
      </div>`;
    return;
  }

  const totalMonthly = subscriptions.reduce((sum, s) => sum + s.monthlyCost, 0);

  container.innerHTML = `
    <div class="costs-total">
      <div class="costs-amount">$${totalMonthly.toFixed(2)}</div>
      <div class="costs-label">estimated monthly</div>
    </div>
    <div class="costs-table">
      ${subscriptions.map(sub => `
        <div class="cost-row">
          <div class="cost-service">${escapeHtml(sub.service)}</div>
          <div class="cost-details">
            <span class="cost-amount">$${sub.amount.toFixed(2)}</span>
            <span class="cost-freq">${sub.frequency}</span>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderEmailCard(email, classification) {
  const cat = classification?.category || 'fyi';
  const catConfig = CATEGORIES[cat];
  const from = extractName(email.from);
  const timeAgo = formatTimeAgo(email.date);
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${email.id}`;

  return `
    <div class="email-card" data-email-id="${email.id}">
      <div class="email-header">
        <span class="category-badge small" style="background:${catConfig.bg};color:${catConfig.color}">
          ${catConfig.label}
        </span>
        <div class="email-header-right">
          <span class="importance" title="Importance: ${classification?.importance || 5}/10">
            ${'\u25cf'.repeat(Math.ceil((classification?.importance || 5) / 2))}${'\u25cb'.repeat(5 - Math.ceil((classification?.importance || 5) / 2))}
          </span>
          <span class="card-chevron">\u203a</span>
        </div>
      </div>
      <div class="email-from">${escapeHtml(from)}</div>
      <div class="email-subject">${escapeHtml(email.subject || '(no subject)')}</div>
      <div class="email-time">${escapeHtml(timeAgo)}</div>
      <div class="email-expand">
        ${classification?.summary ? `<div class="email-summary">${escapeHtml(classification.summary)}</div>` : ''}
        ${classification?.action_required ? `<div class="email-action">\u2192 ${escapeHtml(classification.action_description || 'Action needed')}</div>` : ''}
        <a href="${gmailUrl}" target="_blank" class="btn-gmail" onclick="event.stopPropagation()">Open in Gmail \u2197</a>
      </div>
    </div>`;
}

// Attach click listeners for expandable cards and sender stacks
function attachCardListeners() {
  // Email card expand/collapse
  document.querySelectorAll('.email-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-gmail')) return;
      card.classList.toggle('expanded');
    });
  });

  // Sender stack expand/collapse
  document.querySelectorAll('.sender-stack-header').forEach(header => {
    header.addEventListener('click', () => {
      const stack = header.closest('.sender-stack');
      const expanded = stack.dataset.expanded === 'true';
      stack.dataset.expanded = expanded ? 'false' : 'true';
    });

    // After expanding a sender stack, attach card listeners to new cards
    header.addEventListener('click', () => {
      const stack = header.closest('.sender-stack');
      stack.querySelectorAll('.email-card').forEach(card => {
        if (!card.dataset.listenerAttached) {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-gmail')) return;
            card.classList.toggle('expanded');
          });
          card.dataset.listenerAttached = 'true';
        }
      });
    });
  });
}

// Helpers
function extractName(from) {
  if (!from) return 'Unknown';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.split('@')[0];
}

function extractEmail(from) {
  if (!from) return '';
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return '';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Start
init();
