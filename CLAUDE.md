# ClearInbox AI — Chrome Extension

## Overview
AI-powered Gmail triage Chrome Extension that classifies, prioritizes, and surfaces only important emails. Uses Google Gemini API (free tier) for AI classification with smart pre-filtering to minimize API usage.

## Tech Stack
- Chrome Extension Manifest V3
- Vanilla JS with ES modules (no frameworks, no build tools, no npm)
- Google Gmail API (OAuth2, readonly scope)
- Google Gemini 2.5 Flash Lite API (free tier: 20 req/day)
- chrome.storage.local for caching

## File Structure
```
clearinbox-ai/
├── manifest.json           # Manifest V3 config, OAuth2, permissions
├── popup/
│   ├── popup.html          # Main popup UI (5 tabs: Digest, Priority, All, Unsub, $)
│   ├── popup.css           # Dark obsidian theme styling
│   └── popup.js            # UI controller, expandable cards, unsub flow
├── background/
│   └── service-worker.js   # Auth, two-pass email fetch, classification orchestration
├── lib/
│   ├── gmail-api.js        # Gmail REST API wrapper (batch fetch)
│   ├── gemini-api.js       # Gemini API wrapper
│   ├── classifier.js       # Strict batch classification + AI summary generation
│   ├── unsubscribe-detector.js  # RFC 2369 + regex unsub link detection
│   ├── subscription-scanner.js  # Receipt/payment pattern matching
│   └── storage.js          # chrome.storage abstraction + TTL caching
├── options/
│   ├── options.html        # Settings page (API key, usage, account)
│   ├── options.css
│   └── options.js
└── assets/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Architecture

### Email Fetch Pipeline (service-worker.js)
1. Two-pass fetch: 30 from `category:primary` + 15 from promotions/updates/social
2. Deduplicate by message ID
3. Pre-classify Gmail Promotions/Social as "newsletter" locally (no API call)
4. Batch classify remaining emails with Gemini (10 per prompt)
5. Generate AI summary digest (1 Gemini call)
6. Detect unsubscribe links + scan for subscriptions
7. Cache everything to chrome.storage.local

### Classification Categories (strict decision tree)
- **spam** → phishing, scams, unsolicited outreach
- **newsletter** → ANY company/brand/store email, marketing with urgency ("ends today") = always newsletter
- **urgent** → bills due, security alerts, meeting changes, legal deadlines (never marketing)
- **needs_reply** → real humans asking questions personally
- **fyi** → everything else

### API Budget (~3 calls per refresh)
- Pre-classified promos: 0 calls
- Classification batches: ~2 calls
- AI summary: 1 call
- Daily budget guard: stops at 18 calls/day
- Background refresh: every 3 hours

## Setup & Running

### Step 1: Google Cloud Setup (required for Gmail auth)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Gmail API** (APIs & Services → Enable APIs)
4. Go to **Credentials** → Create Credentials → **OAuth Client ID**
   - Application type: **Chrome Extension**
   - You'll need your extension ID from Step 3 below
5. Copy the Client ID
6. Go to **OAuth consent screen** → **Audience** → Add your email as a **test user**

### Step 2: Add your Client ID to manifest.json
Open `manifest.json` and replace the client_id value with your actual client ID.

### Step 3: Load in Chrome
1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `clearinbox-ai/` folder
5. Copy the **Extension ID** shown — you'll need it for the OAuth Client ID in Step 1

> Note: It's a bit circular — load the extension first to get the ID, then create the OAuth credential with that ID, then reload.

### Step 4: Get Gemini API Key
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a free API key
3. Click the extension icon → sign in → go to **Settings** (gear icon) → paste the key

### Step 5: Use it
Click the extension icon in Chrome toolbar → **Sign in with Google** → hit the refresh button to fetch and classify emails.

## UI Features
- **Digest tab** (default) — AI-generated summary bullets + stats breakdown
- **Priority tab** — Only urgent + needs_reply emails, sorted by importance
- **All tab** — Grouped by category, repeated senders stacked/collapsible
- **Unsub tab** — Deduplicated senders with unsubscribe confirmation flow (Yes/No after clicking)
- **Costs tab** — Detected subscription receipts with monthly cost estimate
- **Expandable cards** — Click any email card to see AI summary + "Open in Gmail" link

## Conventions
- Vanilla JS, ES modules, no frameworks
- No build tools or bundlers
- All AI calls use Gemini 2.5 Flash Lite
- Only `gmail.readonly` scope — no write access
- Static imports only in service worker (no dynamic import())
- Pre-classify obvious promotions locally to save API budget
- Batch 10 emails per AI prompt
