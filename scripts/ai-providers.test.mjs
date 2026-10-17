import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, TIERS, providerById, keyStorageId, cleanKey, classifyModel, rankModels, pickModel, tierCandidates, fetchModels, chat } from '../ai-providers.mjs';

test('provider registry covers the free providers and exposes helpers', () => {
  assert.deepEqual(TIERS, ['low', 'high', 'max']);
  for (const id of ['gemini', 'groq', 'openrouter', 'mistral', 'nvidia', 'llm7']) assert.ok(providerById(id), id + ' exists');
  assert.equal(providerById('unknown'), null);
  assert.equal(keyStorageId('gemini'), 'sai-ai-key-gemini');
  assert.equal(cleanKey('  sk-abc  '), 'sk-abc');
  assert.equal(cleanKey('x'.repeat(600)).length, 512);
  assert.ok(PROVIDERS.every(provider => provider.endpoint.startsWith('https://')));
});

test('models classify into Low, High and Max by name patterns only', () => {
  assert.equal(classifyModel('gemini-3.6-flash'), 'low');
  assert.equal(classifyModel('gemini-3.5-flash-lite'), 'low');
  assert.equal(classifyModel('gpt-oss-20b'), 'low');
  assert.equal(classifyModel('gemini-3.8-pro'), 'max');
  assert.equal(classifyModel('llama-3.3-70b-versatile'), 'max');
  assert.equal(classifyModel('deepseek-v4-pro'), 'max');
  assert.equal(classifyModel('whisper-large-v3'), 'max');
  assert.equal(classifyModel('qwen3.8-27b'), 'high');
  assert.equal(classifyModel('mystery-model-x'), 'high');
});

test('ranking prefers free routes, then stable names, then the newest numeric version', () => {
  assert.equal(rankModels(['deepseek/deepseek-v4:free', 'openai/gpt-oss-120b'])[0], 'deepseek/deepseek-v4:free');
  assert.equal(rankModels(['vendor/model-3.8-preview', 'vendor/model-3.8'])[0], 'vendor/model-3.8');
  assert.equal(rankModels(['vendor/model-3.8', 'vendor/model-3.10'])[0], 'vendor/model-3.10');
  assert.deepEqual(rankModels(['a', 'a']), ['a']);
});

test('tier picking chooses an exact candidate and falls back sensibly', () => {
  const ids = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-pro', 'gemini-mystery'];
  assert.equal(pickModel(ids, 'low'), 'gemini-3.6-flash');
  assert.equal(pickModel(ids, 'max'), 'gemini-3.8-pro');
  assert.equal(pickModel(ids, 'high'), 'gemini-mystery');
  assert.equal(pickModel(['fast-mini', 'plain'], 'max'), 'plain');
  assert.equal(pickModel(['plain', 'fast-mini'], 'low'), 'fast-mini');
  assert.equal(pickModel(['plain', 'mystery'], 'low'), 'plain');
  assert.equal(pickModel([], 'low'), '');
  assert.deepEqual(tierCandidates(['a-mini', 'b-pro'], 'high'), ['b-pro', 'a-mini']);
});

test('fetchModels lists live models for OpenAI-style providers with the user key', async () => {
  const seen = [];
  const fetchImpl = async (url, options = {}) => { seen.push({ url, options }); return { ok: true, status: 200, json: async () => ({ data: [{ id: 'alpha' }, { id: 'beta:free' }] }) }; };
  const ids = await fetchModels(providerById('groq'), ' key-1 ', fetchImpl);
  assert.deepEqual(ids, ['alpha', 'beta:free']);
  assert.equal(seen[0].url, 'https://api.groq.com/openai/v1/models');
  assert.equal(seen[0].options.headers.authorization, 'Bearer key-1');
});

test('fetchModels maps Gemini names and filters to generateContent models', async () => {
  const fetchImpl = async url => ({ ok: true, status: 200, json: async () => ({ models: [ { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed-1', supportedGenerationMethods: ['embedContent'] }, { name: 'models/gemini-3.8-pro' } ] }) });
  const ids = await fetchModels(providerById('gemini'), 'K', fetchImpl);
  assert.deepEqual(ids, ['gemini-3.6-flash', 'gemini-3.8-pro']);
});

test('fetchModels reports rejected keys and rate limits with friendly messages', async () => {
  await assert.rejects(fetchModels(providerById('groq'), 'bad', async () => ({ ok: false, status: 401 })), /key was rejected/);
  await assert.rejects(fetchModels(providerById('gemini'), 'busy', async () => ({ ok: false, status: 429 })), /limit/);
});

test('chat talks OpenAI-compatible providers and returns the reply text', async () => {
  let body;
  const fetchImpl = async (url, options) => { assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions'); body = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hello there' } }] }) }; };
  const reply = await chat(providerById('groq'), 'k', 'model-a', [{ role: 'user', content: 'hi' }], { fetchImpl });
  assert.equal(reply, 'hello there');
  assert.equal(body.model, 'model-a');
  assert.equal(body.messages[0].content, 'hi');
});

test('chat speaks Gemini with grounding when web search is on', async () => {
  let body; let url;
  const fetchImpl = async (target, options) => { url = target; body = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'part one ' }, { text: 'part two' }] } }] }) }; };
  const reply = await chat(providerById('gemini'), 'K', 'gemini-3.6-flash', [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'news?' }], { fetchImpl, webSearch: true });
  assert.equal(reply, 'part one part two');
  assert.ok(url.includes('/models/gemini-3.6-flash:generateContent?key=K'));
  assert.equal(body.contents[0].role, 'user');
  assert.ok(body.contents[0].parts[0].text.startsWith('be brief'));
  assert.deepEqual(body.tools, [{ google_search: {} }]);
});

test('chat surfaces rate limits without leaking the key', async () => {
  await assert.rejects(chat(providerById('mistral'), 'secret-key', 'm', [{ role: 'user', content: 'hi' }], { fetchImpl: async () => ({ ok: false, status: 429 }) }), error => !error.message.includes('secret-key') && /limit/.test(error.message));
});
