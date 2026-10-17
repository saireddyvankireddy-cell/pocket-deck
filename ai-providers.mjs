// Provider-agnostic cloud AI. No model names are hardcoded: every list is fetched live with the user's own free key, and tiers are chosen by name patterns only.
export const TIERS = ['low', 'high', 'max'];
export const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', style: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', note: 'Free tier no card; the only free tier with Google Search grounding for live web answers.' },
  { id: 'groq', name: 'Groq', style: 'openai', endpoint: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', note: 'Free tier no card; fastest first-token — a great Low model.' },
  { id: 'openrouter', name: 'OpenRouter', style: 'openai', endpoint: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', note: 'Many free :free models behind one key, including DeepSeek-class free routes.' },
  { id: 'mistral', name: 'Mistral', style: 'openai', endpoint: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', note: 'Free Experiment tier after phone verification.' },
  { id: 'nvidia', name: 'NVIDIA NIM', style: 'openai', endpoint: 'https://integrate.api.nvidia.com/v1', keyUrl: 'https://build.nvidia.com', note: 'Free trial rate limits per model.' },
  { id: 'llm7', name: 'LLM7 (no signup)', style: 'openai', endpoint: 'https://api.llm7.io/v1', keyUrl: 'https://llm7.io', note: 'Free token with no signup; handy as a fallback.' },
];
export function providerById(id) { return PROVIDERS.find(provider => provider.id === id) || null; }
export function keyStorageId(providerId) { return 'sai-ai-key-' + String(providerId || ''); }
export function cleanKey(key) { return String(key || '').trim().slice(0, 512); }
const LOW_PATTERN = /(flash-lite|flash_lite|flash|small|(?<![a-z])mini|instant|nano|turbo|(?<![a-z])lite|lightning|(?<!\d)(8b|9b|1\.5b|2b|3b|4b|7b|20b)|scout|(?<![a-z])air|nemo|haiku|(?<![a-z])fast)/i;
const MAX_PATTERN = /(pro\b|pro-|ultra|large|max|opus|sonnet|405b|400b|550b|235b|120b|70b|reason|thinking|r1|v4\b|super|plus)/i;
// Cheap/fast names win Low; flagship names win Max; everything else is High. New models classify automatically.
export function classifyModel(id) {
  const name = String(id || '');
  if (LOW_PATTERN.test(name)) return 'low';
  if (MAX_PATTERN.test(name)) return 'max';
  return 'high';
}
export function rankModels(ids) {
  return [...new Set(ids)].sort((a, b) => {
    const freeA = /:free$/.test(a) ? 0 : 1; const freeB = /:free$/.test(b) ? 0 : 1;
    if (freeA !== freeB) return freeA - freeB;
    const draftA = /preview|experimental|exp\b|beta|alpha|nightly/i.test(a) ? 1 : 0; const draftB = /preview|experimental|exp\b|beta|alpha|nightly/i.test(b) ? 1 : 0;
    if (draftA !== draftB) return draftA - draftB;
    return String(b).localeCompare(String(a), undefined, { numeric: true });
  });
}
export function pickModel(ids, tier) {
  const ranked = rankModels(ids);
  const exact = ranked.filter(id => classifyModel(id) === tier);
  if (exact.length) return exact[0];
  const fallback = tier === 'low' ? ['high', 'max'] : tier === 'max' ? ['high', 'low'] : ['low', 'max'];
  for (const next of fallback) { const pool = ranked.filter(id => classifyModel(id) === next); if (pool.length) return pool[0]; }
  return ranked[0] || '';
}
export function tierCandidates(ids, tier) {
  const ranked = rankModels(ids);
  const primary = ranked.filter(id => classifyModel(id) === tier);
  const others = ranked.filter(id => classifyModel(id) !== tier);
  return [...primary, ...others];
}
function friendly(provider, status) {
  if (status === 401 || status === 403) return 'The ' + provider.name + ' key was rejected. Check the key and try again.';
  if (status === 404) return provider.name + ' did not recognise that model. Refresh the model list and pick again.';
  if (status === 429) return provider.name + ' free-tier limit reached. Wait a minute, or switch to another model in Settings → AI.';
  return provider.name + ' responded with status ' + status + '.';
}
export async function fetchModels(provider, key, fetchImpl = fetch) {
  const secret = cleanKey(key);
  if (provider.style === 'gemini') {
    const response = await fetchImpl(provider.endpoint + '/models?key=' + encodeURIComponent(secret));
    if (!response.ok) throw new Error(friendly(provider, response.status));
    const data = await response.json();
    return (data.models || []).filter(model => Array.isArray(model.supportedGenerationMethods) ? model.supportedGenerationMethods.includes('generateContent') : true).map(model => String(model.name || '').replace(/^models\//, '')).filter(Boolean);
  }
  const headers = secret ? { authorization: 'Bearer ' + secret } : {};
  const response = await fetchImpl(provider.endpoint + '/models', { headers });
  if (!response.ok) throw new Error(friendly(provider, response.status));
  const data = await response.json();
  return (data.data || []).map(model => String(model.id || '')).filter(Boolean);
}
export async function chat(provider, key, model, messages, options = {}) {
  const secret = cleanKey(key);
  const fetchImpl = options.fetchImpl || fetch;
  if (provider.style === 'gemini') {
    const system = messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
    const contents = messages.filter(message => message.role !== 'system').map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }));
    if (system && contents.length) contents[0].parts.unshift({ text: system + '\n\n' });
    const body = { contents, generationConfig: { temperature: options.temperature ?? 0.4, maxOutputTokens: options.maxTokens || 1024 } };
    if (options.webSearch) body.tools = [{ google_search: {} }];
    const response = await fetchImpl(provider.endpoint + '/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(secret), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: options.signal });
    if (!response.ok) throw new Error(friendly(provider, response.status));
    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map(part => part.text || '').join('').trim();
  }
  const headers = { 'content-type': 'application/json' };
  if (secret) headers.authorization = 'Bearer ' + secret;
  const response = await fetchImpl(provider.endpoint + '/chat/completions', { method: 'POST', headers, body: JSON.stringify({ model, messages, max_tokens: options.maxTokens || 1024, temperature: options.temperature ?? 0.4 }), signal: options.signal });
  if (!response.ok) throw new Error(friendly(provider, response.status));
  const data = await response.json();
  return String(data.choices?.[0]?.message?.content || '').trim();
}
