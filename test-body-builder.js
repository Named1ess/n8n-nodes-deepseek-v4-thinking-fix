/**
 * test-body-builder.js
 *
 * Teste local sem API key — valida a lógica de construção do request body
 * contra a spec da DeepSeek Thinking Mode API.
 *
 * Rode: node test-body-builder.js
 */

'use strict';

// ─── Simulação da lógica do nó (espelho do DeepSeekV4.node.ts) ──────────────

function buildRequestBody({
  model,
  systemMessage,
  userMessage,
  thinkingMode,   // 'disabled' | 'enabled_high' | 'enabled_max'
  advancedOptions = {},
}) {
  const messages = [];
  if (systemMessage && systemMessage.trim() !== '') {
    messages.push({ role: 'system', content: systemMessage });
  }
  messages.push({ role: 'user', content: userMessage });

  const isThinkingEnabled = thinkingMode !== 'disabled';
  const reasoningEffort = thinkingMode === 'enabled_max' ? 'max' : 'high';

  const body = {
    model,
    messages,
    max_tokens: advancedOptions.maxTokens ?? 2048,
    thinking: { type: isThinkingEnabled ? 'enabled' : 'disabled' },
  };

  if (isThinkingEnabled) {
    body.reasoning_effort = reasoningEffort;
  }

  if (!isThinkingEnabled) {
    if (advancedOptions.temperature !== undefined) body.temperature = advancedOptions.temperature;
    if (advancedOptions.topP !== undefined && advancedOptions.topP !== 1) body.top_p = advancedOptions.topP;
    if (advancedOptions.presencePenalty !== undefined && advancedOptions.presencePenalty !== 0) body.presence_penalty = advancedOptions.presencePenalty;
    if (advancedOptions.frequencyPenalty !== undefined && advancedOptions.frequencyPenalty !== 0) body.frequency_penalty = advancedOptions.frequencyPenalty;
  }

  if (advancedOptions.stop && advancedOptions.stop.trim() !== '') {
    body.stop = advancedOptions.stop.split(',').map(s => s.trim()).filter(Boolean);
  }

  if (advancedOptions.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  return body;
}

// ─── Helpers de teste ────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(description, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.error(`  ❌ ${description}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function runTest(name, fn) {
  console.log(`\n📋 ${name}`);
  fn();
}

// ─── TESTES ──────────────────────────────────────────────────────────────────

runTest('Thinking DISABLED — body mínimo correto', () => {
  const body = buildRequestBody({
    model: 'deepseek-v4-flash',
    systemMessage: '',
    userMessage: 'Olá!',
    thinkingMode: 'disabled',
  });

  assert('thinking.type === "disabled"', body.thinking?.type === 'disabled');
  assert('sem reasoning_effort no body', body.reasoning_effort === undefined);
  assert('model correto', body.model === 'deepseek-v4-flash');
  assert('messages tem só user (sem system vazio)', body.messages.length === 1 && body.messages[0].role === 'user');
  assert('max_tokens default 2048', body.max_tokens === 2048);
  // Garante que temperature NÃO foi enviada (não foi passada nos advancedOptions)
  assert('temperature ausente quando não configurada', body.temperature === undefined);
});

runTest('Thinking DISABLED com system message', () => {
  const body = buildRequestBody({
    model: 'deepseek-v4-flash',
    systemMessage: 'Você é um assistente.',
    userMessage: 'Olá!',
    thinkingMode: 'disabled',
  });

  assert('messages tem system + user', body.messages.length === 2);
  assert('primeiro é system', body.messages[0].role === 'system');
  assert('segundo é user', body.messages[1].role === 'user');
});

runTest('Thinking DISABLED com temperature e top_p customizados', () => {
  const body = buildRequestBody({
    model: 'deepseek-v4-flash',
    systemMessage: '',
    userMessage: 'Teste',
    thinkingMode: 'disabled',
    advancedOptions: { temperature: 0.7, topP: 0.9 },
  });

  assert('temperature enviada', body.temperature === 0.7);
  assert('top_p enviado', body.top_p === 0.9);
  assert('thinking.type === "disabled"', body.thinking?.type === 'disabled');
  assert('sem reasoning_effort', body.reasoning_effort === undefined);
});

runTest('Thinking ENABLED_HIGH — spec API', () => {
  /**
   * Spec: reasoning_effort="high", thinking={"type":"enabled"}
   * Temperatura NÃO deve ser enviada
   */
  const body = buildRequestBody({
    model: 'deepseek-v4-pro',
    systemMessage: 'System',
    userMessage: 'Qual é maior: 9.11 ou 9.8?',
    thinkingMode: 'enabled_high',
    advancedOptions: { temperature: 0.5 }, // deve ser ignorado
  });

  assert('thinking.type === "enabled"', body.thinking?.type === 'enabled');
  assert('reasoning_effort === "high"', body.reasoning_effort === 'high');
  assert('temperature NÃO enviada (ignorada com thinking on)', body.temperature === undefined,
    `temperature estava: ${body.temperature}`);
  assert('top_p NÃO enviado', body.top_p === undefined);
  assert('presence_penalty NÃO enviado', body.presence_penalty === undefined);
  assert('frequency_penalty NÃO enviado', body.frequency_penalty === undefined);
});

runTest('Thinking ENABLED_MAX — spec API', () => {
  /**
   * Spec: reasoning_effort="max", thinking={"type":"enabled"}
   */
  const body = buildRequestBody({
    model: 'deepseek-v4-pro',
    systemMessage: '',
    userMessage: 'Resolva esse problema complexo.',
    thinkingMode: 'enabled_max',
  });

  assert('thinking.type === "enabled"', body.thinking?.type === 'enabled');
  assert('reasoning_effort === "max"', body.reasoning_effort === 'max');
  assert('temperatura ausente', body.temperature === undefined);
});

runTest('JSON Mode ativado', () => {
  const body = buildRequestBody({
    model: 'deepseek-v4-flash',
    systemMessage: '',
    userMessage: 'Retorne um JSON com nome e idade.',
    thinkingMode: 'disabled',
    advancedOptions: { jsonMode: true },
  });

  assert('response_format presente', body.response_format !== undefined);
  assert('response_format.type === "json_object"', body.response_format?.type === 'json_object');
});

runTest('Stop sequences parseadas corretamente', () => {
  const body = buildRequestBody({
    model: 'deepseek-v4-flash',
    systemMessage: '',
    userMessage: 'Teste',
    thinkingMode: 'disabled',
    advancedOptions: { stop: ' END, STOP , FIM' },
  });

  assert('stop é array', Array.isArray(body.stop));
  assert('3 elementos após trim', body.stop?.length === 3, JSON.stringify(body.stop));
  assert('trim aplicado corretamente', body.stop?.[0] === 'END');
});

runTest('max_tokens customizado', () => {
  const body = buildRequestBody({
    model: 'deepseek-v4-flash',
    systemMessage: '',
    userMessage: 'Teste',
    thinkingMode: 'disabled',
    advancedOptions: { maxTokens: 512 },
  });

  assert('max_tokens === 512', body.max_tokens === 512);
});

runTest('Validação do formato do body contra spec DeepSeek', () => {
  // Spec mínima esperada: model, messages, thinking
  // Ver: https://api-docs.deepseek.com/guides/thinking_mode
  const body = buildRequestBody({
    model: 'deepseek-v4-flash',
    systemMessage: '',
    userMessage: 'Oi',
    thinkingMode: 'disabled',
  });

  assert('campo "model" presente', 'model' in body);
  assert('campo "messages" presente', 'messages' in body);
  assert('campo "thinking" presente', 'thinking' in body);
  assert('campo "thinking.type" é string', typeof body.thinking.type === 'string');
  assert('messages é array', Array.isArray(body.messages));
  assert('cada message tem role e content',
    body.messages.every(m => typeof m.role === 'string' && typeof m.content === 'string'));
});

runTest('Modelo deepseek-chat (alias legacy) aceito', () => {
  const body = buildRequestBody({
    model: 'deepseek-chat',
    systemMessage: '',
    userMessage: 'Teste',
    thinkingMode: 'disabled',
  });

  assert('model passado como-está', body.model === 'deepseek-chat');
  assert('thinking.type === "disabled"', body.thinking?.type === 'disabled');
});

// ─── Resultado final ──────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${passed} ✅ passaram | ${failed} ❌ falharam`);
console.log(`${'─'.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
