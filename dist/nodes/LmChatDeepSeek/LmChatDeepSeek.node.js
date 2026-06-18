"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LmChatDeepSeek = void 0;
const ChatDeepSeek_1 = require("./ChatDeepSeek");
function loadAiUtils() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('@n8n/ai-utilities');
    }
    catch {
        return {};
    }
}
/**
 * DeepSeek-specific non-retryable error classifier. Layered on top of the
 * official `openAiFailedAttemptHandler` from @n8n/ai-utilities (401/403/429/
 * insufficient-quota are already handled there). We add the DeepSeek-only
 * cases that would otherwise cause the AI Agent to retry the whole turn —
 * which is what makes the connected memory node get hit repeatedly.
 */
function deepseekFailedAttemptHandler(error) {
    const status = error?.status ?? error?.response?.status;
    const msg = error?.message ?? error?.response?.data?.error?.message ?? '';
    const lower = msg.toLowerCase();
    const code = (error?.code ?? error?.cause?.code ?? '').toString();
    const fatal = status === 401 ||
        status === 402 ||
        status === 403 ||
        lower.includes('insufficient balance') ||
        lower.includes('authentication fails') ||
        lower.includes('invalid api key') ||
        lower.includes('invalid_request_error') ||
        lower.includes('reasoning_content must be passed back');
    if (fatal) {
        error.retryable = false;
        throw error;
    }
    // Mark transient transport-level failures as retryable so a single
    // hiccup during the (now non-streaming) POST is retried at the LLM
    // layer instead of bubbling up to the AI Agent and re-running the
    // entire turn (which would re-hit memory, tools, etc).
    const transient = error?.name === 'AbortError' ||
        error?.name === 'TimeoutError' ||
        error?.name === 'DeepSeekEmptyResponseError' ||
        error?.retryable === true ||
        lower.includes('aborted') ||
        lower.includes('idle for') ||
        lower.includes('fetch failed') ||
        lower.includes('socket hang up') ||
        lower.includes('network error') ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN' ||
        code.startsWith('UND_ERR') ||
        status === 408 ||
        status === 425 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;
    if (transient) {
        error.retryable = true;
    }
}
const FALLBACK_MODELS = [
    { name: 'DeepSeek V4 Pro', value: 'deepseek-v4-pro' },
    { name: 'DeepSeek V4 Flash', value: 'deepseek-v4-flash' },
    { name: 'DeepSeek Reasoner (legacy)', value: 'deepseek-reasoner' },
    { name: 'DeepSeek Chat (legacy)', value: 'deepseek-chat' },
];
class LmChatDeepSeek {
    description = {
        displayName: 'DeepSeek Chat Model',
        // eslint-disable-next-line n8n-nodes-base/node-class-description-name-miscased
        name: 'lmChatDeepSeek',
        icon: 'file:deepseek.svg',
        group: ['transform'],
        version: [1, 2],
        description: 'Use DeepSeek chat models (V4 Pro / V4 Flash) with thinking mode and reasoning_content output',
        defaults: {
            name: 'DeepSeek Chat Model',
        },
        codex: {
            categories: ['AI'],
            subcategories: {
                AI: ['Language Models', 'Root Nodes'],
                'Language Models': ['Chat Models (Recommended)'],
            },
            resources: {
                primaryDocumentation: [
                    {
                        url: 'https://api-docs.deepseek.com/guides/thinking_mode',
                    },
                ],
            },
        },
        inputs: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outputs: ['ai_languageModel'],
        outputNames: ['Model'],
        credentials: [
            {
                name: 'deepSeekApi',
                required: true,
            },
        ],
        requestDefaults: {
            ignoreHttpStatusErrors: true,
            baseURL: '={{ $credentials?.baseUrl ?? "https://api.deepseek.com/v1" }}',
        },
        properties: [
            // Connection-hint notice (lazy — falls back to nothing on old n8n).
            ...(() => {
                const u = loadAiUtils();
                if (typeof u.getConnectionHintNoticeField === 'function') {
                    try {
                        return [u.getConnectionHintNoticeField(['ai_chain', 'ai_agent'])];
                    }
                    catch {
                        return [];
                    }
                }
                return [];
            })(),
            {
                displayName: 'Model',
                name: 'model',
                type: 'options',
                description: 'The model which will generate the completion. Loaded live from /models. <a href="https://api-docs.deepseek.com/quick_start/pricing">Learn more</a>.',
                typeOptions: {
                    loadOptions: {
                        routing: {
                            request: {
                                method: 'GET',
                                url: '/models',
                            },
                            output: {
                                postReceive: [
                                    {
                                        type: 'rootProperty',
                                        properties: { property: 'data' },
                                    },
                                    {
                                        type: 'setKeyValue',
                                        properties: {
                                            name: '={{$responseItem.id}}',
                                            value: '={{$responseItem.id}}',
                                        },
                                    },
                                    {
                                        type: 'sort',
                                        properties: { key: 'name' },
                                    },
                                ],
                            },
                        },
                    },
                    loadOptionsMethod: 'fallbackModels',
                },
                routing: {
                    send: {
                        type: 'body',
                        property: 'model',
                    },
                },
                default: 'deepseek-v4-pro',
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                options: [
                    {
                        displayName: 'Thinking Mode',
                        name: 'thinking',
                        type: 'boolean',
                        default: true,
                        description: 'Whether to enable DeepSeek thinking mode. When enabled, the model emits reasoning_content (Chain-of-Thought) alongside the final answer.',
                    },
                    {
                        displayName: 'Reasoning Effort',
                        name: 'reasoningEffort',
                        type: 'options',
                        default: 'high',
                        description: 'Effort level for thinking mode. DeepSeek accepts only "high" and "max"; "low"/"medium" are mapped to "high" by the API.',
                        options: [
                            { name: 'High', value: 'high' },
                            { name: 'Max', value: 'max' },
                        ],
                    },
                    {
                        displayName: 'Maximum Number of Tokens',
                        name: 'maxTokens',
                        type: 'number',
                        default: 4096,
                        description: 'Maximum tokens to generate (including chain-of-thought). DeepSeek allows up to 64000 in thinking mode.',
                        typeOptions: { minValue: 1, maxValue: 64000 },
                    },
                    {
                        displayName: 'Temperature',
                        name: 'temperature',
                        type: 'number',
                        default: 0.7,
                        description: 'Ignored when thinking mode is enabled (DeepSeek silently drops it in that case).',
                        typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
                    },
                    {
                        displayName: 'Top P',
                        name: 'topP',
                        type: 'number',
                        default: 1,
                        description: 'Ignored when thinking mode is enabled.',
                        typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
                    },
                    {
                        displayName: 'Frequency Penalty',
                        name: 'frequencyPenalty',
                        type: 'number',
                        default: 0,
                        description: 'Ignored when thinking mode is enabled.',
                        typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 2 },
                    },
                    {
                        displayName: 'Presence Penalty',
                        name: 'presencePenalty',
                        type: 'number',
                        default: 0,
                        description: 'Ignored when thinking mode is enabled.',
                        typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 2 },
                    },
                    {
                        displayName: 'Response Format',
                        name: 'responseFormat',
                        type: 'options',
                        default: 'text',
                        description: 'Force the model to emit structured JSON. When set to "JSON Object" your prompt MUST also instruct the model to produce JSON (DeepSeek API requirement) or the request errors.',
                        options: [
                            { name: 'Text', value: 'text' },
                            { name: 'JSON Object', value: 'json_object' },
                        ],
                    },
                    {
                        displayName: 'Tool Choice',
                        name: 'toolChoice',
                        type: 'options',
                        default: 'auto',
                        description: 'Controls whether the model is allowed to / required to call a tool. "Required" forces a tool call (great for AI Agent reliability); "None" disables tool use.',
                        options: [
                            { name: 'Auto', value: 'auto' },
                            { name: 'Required', value: 'required' },
                            { name: 'None', value: 'none' },
                        ],
                    },
                    {
                        displayName: 'Seed',
                        name: 'seed',
                        type: 'number',
                        default: 0,
                        description: 'Deterministic sampling seed. Leave at 0 to disable. Same seed + same params = reproducible output (best-effort).',
                    },
                    {
                        displayName: 'Timeout (ms)',
                        name: 'timeout',
                        type: 'number',
                        default: 360000,
                        description: 'Request timeout in milliseconds. Reasoning calls can take a while.',
                    },
                    {
                        displayName: 'Max Retries',
                        name: 'maxRetries',
                        type: 'number',
                        default: 2,
                    },
                    {
                        displayName: 'Base URL Override',
                        name: 'baseUrlOverride',
                        type: 'string',
                        default: '',
                        placeholder: 'https://api.deepseek.com/v1',
                        description: 'Override the base URL set on the credential (useful for proxies).',
                    },
                    {
                        displayName: 'Strict Tool Schemas (Beta)',
                        name: 'strictTools',
                        type: 'boolean',
                        default: false,
                        description: 'Opt-in: enable DeepSeek server-enforced strict tool schemas. Routes traffic through https://api.deepseek.com/beta and rewrites every tool to set strict:true + additionalProperties:false. Off by default to match the official OpenAI-compatible behavior; turn it on only if you see persistent "tool input did not match expected schema" errors that auto-repair cannot handle.',
                    },
                    {
                        displayName: 'Auto-Repair Missing Tool Arguments',
                        name: 'autoRepairToolArgs',
                        type: 'boolean',
                        default: true,
                        description: 'Whether to fill missing required fields in tool_call arguments with type-appropriate defaults ("" for string, 0 for number, [] for array, {} for object) before n8n\'s validator sees them. Safety net for the rare case the model still omits a field.',
                    },
                    {
                        displayName: 'Enable Streaming',
                        name: 'streaming',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to stream the response from DeepSeek (SSE). Off by default — DeepSeek thinking-mode streams can stall mid-flight with no error frame, leaving the workflow stuck in "queued" forever. Turn on only if you need token-by-token streaming.',
                    },
                ],
            },
        ],
    };
    methods = {
        loadOptions: {
            // Fallback when the live /models routing call fails (e.g. no network
            // from the n8n host, credential not yet saved). Returns the canonical
            // DeepSeek model IDs so the dropdown is never empty.
            async fallbackModels() {
                return FALLBACK_MODELS;
            },
        },
    };
    async supplyData(itemIndex) {
        const credentials = (await this.getCredentials('deepSeekApi'));
        const model = this.getNodeParameter('model', itemIndex);
        const options = this.getNodeParameter('options', itemIndex, {});
        const strictTools = options.strictTools ?? false;
        const autoRepairToolArgs = options.autoRepairToolArgs ?? true;
        const timeout = options.timeout ?? 360000;
        const defaultBase = strictTools
            ? 'https://api.deepseek.com/beta'
            : 'https://api.deepseek.com/v1';
        const baseURL = options.baseUrlOverride && options.baseUrlOverride.length > 0
            ? options.baseUrlOverride
            : credentials.baseUrl ?? defaultBase;
        // ---- @n8n/ai-utilities plumbing (Grok-parity) ---------------------------
        const aiUtils = loadAiUtils();
        const callbacks = aiUtils.N8nLlmTracing
            ? [new aiUtils.N8nLlmTracing(this)]
            : undefined;
        const onFailedAttempt = aiUtils.makeN8nLlmFailedAttemptHandler
            ? aiUtils.makeN8nLlmFailedAttemptHandler(this, (err) => {
                if (typeof aiUtils.openAiFailedAttemptHandler === 'function') {
                    try {
                        aiUtils.openAiFailedAttemptHandler(err);
                    }
                    catch (e) {
                        throw e;
                    }
                }
                deepseekFailedAttemptHandler(err);
            })
            : undefined;
        const configuration = { baseURL };
        // modelKwargs: response_format, tool_choice, and strip stream_options.
        const modelKwargs = {
            stream_options: undefined,
        };
        if (options.responseFormat && options.responseFormat !== 'text') {
            modelKwargs.response_format = { type: options.responseFormat };
        }
        if (options.toolChoice && options.toolChoice !== 'auto') {
            modelKwargs.tool_choice = options.toolChoice;
        }
        if (typeof options.seed === 'number' && options.seed !== 0) {
            modelKwargs.seed = options.seed;
        }
        const llm = new ChatDeepSeek_1.ChatDeepSeek({
            apiKey: credentials.apiKey,
            model,
            thinking: options.thinking ?? true,
            deepseekReasoningEffort: options.reasoningEffort,
            strictTools,
            autoRepairToolArgs,
            temperature: options.temperature ?? 0.7,
            topP: options.topP,
            frequencyPenalty: options.frequencyPenalty,
            presencePenalty: options.presencePenalty,
            maxTokens: options.maxTokens ?? 4096,
            timeout,
            maxRetries: options.maxRetries ?? 2,
            streaming: options.streaming ?? false,
            modelKwargs,
            configuration,
            ...(callbacks ? { callbacks } : {}),
            ...(onFailedAttempt ? { onFailedAttempt } : {}),
        });
        return {
            response: llm,
        };
    }
}
exports.LmChatDeepSeek = LmChatDeepSeek;
