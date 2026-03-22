// Gemini API wrapper — calls gemini-2.5-flash-lite

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash-lite';

export async function callGemini(apiKey, prompt) {
  const url = `${GEMINI_BASE}/${MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status === 400) throw new Error('INVALID_API_KEY');
    throw new Error(`Gemini API error: ${response.status} — ${errorBody}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error('Empty Gemini response');

  return text;
}
