import * as storage from '../lib/storage.js';

const apiKeyInput = document.getElementById('apiKey');
const toggleKeyBtn = document.getElementById('toggleKey');
const saveKeyBtn = document.getElementById('saveKey');
const keyStatus = document.getElementById('keyStatus');
const usageProgress = document.getElementById('usageProgress');
const usageText = document.getElementById('usageText');
const usageWarning = document.getElementById('usageWarning');
const accountInfo = document.getElementById('accountInfo');
const signOutBtn = document.getElementById('signOut');

// Load existing settings
async function init() {
  // Load API key
  const savedKey = await storage.get('gemini_api_key');
  if (savedKey) {
    apiKeyInput.value = savedKey;
    keyStatus.textContent = 'Key saved';
    keyStatus.className = 'status success';
  }

  // Load usage
  await updateUsage();

  // Load account info
  try {
    const response = await chrome.runtime.sendMessage({ type: 'getUserInfo' });
    if (response?.email) {
      accountInfo.textContent = `Signed in as ${response.email}`;
    }
  } catch {
    accountInfo.textContent = 'Not signed in';
  }
}

// Toggle key visibility
toggleKeyBtn.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
  document.getElementById('eyeIcon').textContent = isPassword ? '🙈' : '👁';
});

// Save key
saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = 'Please enter an API key';
    keyStatus.className = 'status error';
    return;
  }

  // Validate key with a test call
  keyStatus.textContent = 'Validating...';
  keyStatus.className = 'status';

  try {
    const { callGemini } = await import('../lib/gemini-api.js');
    await callGemini(key, 'Respond with just the word "ok"');
    await storage.set('gemini_api_key', key);
    keyStatus.textContent = 'Key saved and validated';
    keyStatus.className = 'status success';
  } catch (err) {
    if (err.message === 'INVALID_API_KEY') {
      keyStatus.textContent = 'Invalid API key. Please check and try again.';
    } else if (err.message === 'RATE_LIMITED') {
      // Key works but rate limited — save it anyway
      await storage.set('gemini_api_key', key);
      keyStatus.textContent = 'Key saved (currently rate limited — will work later)';
      keyStatus.className = 'status success';
      return;
    } else {
      keyStatus.textContent = `Validation failed: ${err.message}`;
    }
    keyStatus.className = 'status error';
  }
});

// Sign out
signOutBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'signOut' });
    accountInfo.textContent = 'Signed out';
  } catch (err) {
    accountInfo.textContent = `Error: ${err.message}`;
  }
});

async function updateUsage() {
  const { count } = await storage.getApiCallCount();
  const percent = Math.min(100, (count / 1000) * 100);

  usageProgress.style.width = `${percent}%`;
  usageText.textContent = `${count} / 1,000 calls used today`;

  usageProgress.classList.remove('warning', 'critical');
  if (count >= 900) {
    usageProgress.classList.add('critical');
    usageWarning.textContent = 'Critical: Almost at daily limit!';
    usageWarning.classList.remove('hidden');
  } else if (count >= 800) {
    usageProgress.classList.add('warning');
    usageWarning.textContent = 'Warning: Approaching daily limit';
    usageWarning.classList.remove('hidden');
  } else {
    usageWarning.classList.add('hidden');
  }
}

init();
