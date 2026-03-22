// chrome.storage.local abstraction with TTL-based caching

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function remove(key) {
  await chrome.storage.local.remove(key);
}

export async function getCached(key) {
  const entry = await get(`cache_${key}`);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    await remove(`cache_${key}`);
    return null;
  }
  return entry.data;
}

export async function setCache(key, data) {
  await set(`cache_${key}`, { data, timestamp: Date.now() });
}

export async function getClassification(messageId) {
  return getCached(`class_${messageId}`);
}

export async function setClassification(messageId, classification) {
  await setCache(`class_${messageId}`, classification);
}

export async function getBatchClassifications(messageIds) {
  const results = {};
  const keys = messageIds.map(id => `cache_class_${id}`);
  const stored = await chrome.storage.local.get(keys);

  for (const id of messageIds) {
    const entry = stored[`cache_class_${id}`];
    if (entry && Date.now() - entry.timestamp <= CACHE_TTL) {
      results[id] = entry.data;
    }
  }
  return results;
}

export async function getApiCallCount() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await get('api_call_count');
  if (!data || data.date !== today) {
    return { date: today, count: 0 };
  }
  return data;
}

export async function incrementApiCallCount() {
  const current = await getApiCallCount();
  current.count += 1;
  await set('api_call_count', current);
  return current;
}
