# ClearInbox AI — Chrome Extension

## Overview
AI-powered Gmail triage Chrome Extension that classifies, prioritizes, and surfaces only important emails. Uses Google Gemini API (free tier) for AI classification.

## Tech Stack
- Chrome Extension Manifest V3
- Vanilla JS with ES modules (no frameworks, no build tools, no npm)
- Google Gmail API (OAuth2, readonly scope)
- Google Gemini 2.5 Flash Lite API (free tier: 1,000 req/day)
- chrome.storage.local for caching

## File Structure
```
clearinbox-ai/
├── manifest.json           # Manifest V3 config, OAuth2, permissions
├── popup/
│   ├── popup.html          # Main popup UI (5 tabs)
│   ├── popup.css           # Styling
│   └── popup.js            # UI controller
├── background/
│   └── service-worker.js   # Auth, email fetch orchestration, alarms
├── lib/
│   ├── gmail-api.js        # Gmail REST API wrapper
│   ├── gemini-api.js       # Gemini API wrapper
│   ├── classifier.js       # Batch classification (10 emails/prompt)
│   ├── unsubscribe-detector.js
│   ├── subscription-scanner.js
│   └── storage.js          # chrome.storage abstraction + caching
├── options/
│   ├── options.html        # Settings page
│   ├── options.css
│   └── options.js
└── assets/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Setup & Running

### Step 1: Google Cloud Setup (required for Gmail auth)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Gmail API** (APIs & Services → Enable APIs)
4. Go to **Credentials** → Create Credentials → **OAuth Client ID**
   - Application type: **Chrome Extension**
   - You'll need your extension ID from Step 3 below
5. Copy the Client ID

### Step 2: Add your Client ID to manifest.json
Open `manifest.json` and replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual client ID.

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

## Conventions
- Vanilla JS, ES modules, no frameworks
- No build tools or bundlers
- Commit per implementation phase
- All AI calls use Gemini 2.5 Flash Lite
- Only `gmail.readonly` scope — no write access
- Batch 10 emails per AI prompt to stay within free tier limits
