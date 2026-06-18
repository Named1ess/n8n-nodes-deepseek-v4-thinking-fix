"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatDeepSeek = void 0;
const openai_1 = require("@langchain/openai");
const messages_1 = require("@langchain/core/messages");
/**
 * ChatDeepSeek = ChatOpenAI pointed at api.deepseek.com.
 *
 * Two correctness layers on top of the upstream LangChain client:
 *
 * 1. `reasoning_content` round-tripping. DeepSeek thinking mode requires every
 *    prior assistant message in the request to carry `reasoning_content`,
 *    even if empty. We capture it from responses and re-inject it (defaulting
 *    to "") on outgoing requests.
 *
 * 2. Strict tool schemas + arg self-repair. n8n's AI Agent uses Zod to
 *    validate tool_call arguments before executing the tool. The model
 *    sometimes omits "required" fields, producing
 *    `Received tool input did not match expected schema ✖ Required`.
 *    We fix this on two layers:
 *      - request-side: rewrite outgoing `tools[].function` to enable
 *        DeepSeek's `strict: true` mode (server-enforced JSON Schema).
 *      - response-side: if a tool_call is returned with missing required
 *        fields, fill them with type-appropriate defaults so the agent's
 *        Zod validator accepts the call.
 */
class ChatDeepSeek extends openai_1.ChatOpenAI {
    thinking;
    deepseekReasoningEffort;
    strictTools;
    autoRepairToolArgs;
    fetchTimeoutMs;
    /** Map<assistant content string, reasoning_content> populated per call. */
    _reasoningCache = new Map();
    constructor(fields) {
        const { thinking = true, deepseekReasoningEffort, strictTools = false, autoRepairToolArgs = true, configuration, timeout, ...rest } = fields;
        // Root-cause fix for "workflow stuck in queued": DeepSeek streaming SSE
        // responses can stall mid-flight in thinking mode with no FIN, no error
        // frame, no idle signal — leaving the AI Agent waiting on a promise that
        // never settles. The Agent only consumes the final AIMessage anyway, so
        // we default streaming OFF and use a single POST + JSON response which
        // has normal HTTP timeout semantics. The interceptor-based idle timer
        // remains as a defense-in-depth safety net.
        if (rest.streaming === undefined)
            rest.streaming = false;
        const fetchTimeoutMs = typeof timeout === 'number' && timeout > 0 ? timeout : 360_000;
        let selfRef = null;
        const userFetch = configuration?.fetch;
        const baseFetch = userFetch ?? globalThis.fetch?.bind(globalThis);
        const interceptFetch = async (input, init) => {
            // ---- Wall-clock + idle timeout via AbortController ------------------
            // Without this a stalled DeepSeek streaming response (frequent in
            // thinking mode) hangs the request forever. The OpenAI client's
            // `timeout` field only covers connect/non-streaming, not idle stream
            // bytes — we enforce both here so the workflow never sits in "queued"
            // forever. Aborts surface as normal network errors so the AI Agent
            // sees handleLLMError instead of waiting on a never-settling promise.
            const timeoutMs = selfRef?.fetchTimeoutMs ?? fetchTimeoutMs;
            const controller = new AbortController();
            const externalSignal = init?.signal;
            if (externalSignal) {
                if (externalSignal.aborted)
                    controller.abort(externalSignal.reason);
                else
                    externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
            }
            let idleTimer;
            const armIdleTimer = () => {
                if (idleTimer)
                    clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    controller.abort(new Error(`DeepSeek request idle for ${timeoutMs}ms — aborting`));
                }, timeoutMs);
            };
            const clearIdleTimer = () => {
                if (idleTimer) {
                    clearTimeout(idleTimer);
                    idleTimer = undefined;
                }
            };
            armIdleTimer();
            // ---- Request rewrite ------------------------------------------------
            if (init?.body && typeof init.body === 'string') {
                try {
                    const parsed = JSON.parse(init.body);
                    // Defensive strip: LangChain's ChatOpenAI re-injects `stream_options`
                    // on streaming requests; DeepSeek 400s on it. Same fix the official
                    // xAI Grok node applies via modelKwargs, mirrored here at the wire
                    // layer so it survives any future LangChain change.
                    if ('stream_options' in parsed)
                        delete parsed.stream_options;
                    rewriteRequest(parsed, selfRef);
                    console.log('\n=== OUTGOING DEEPSEEK REQUEST ===\n', JSON.stringify(parsed, null, 2), '\n=================================\n');
                    init = { ...init, body: JSON.stringify(parsed) };
                }
                catch {
                    /* fall through with original body */
                }
            }
            let response;
            try {
                response = await baseFetch(input, { ...init, signal: controller.signal });
            }
            catch (err) {
                clearIdleTimer();
                throw err;
            }
            // ---- Retry-After honoring on 429 -----------------------------------
            // When DeepSeek returns 429 we read its `Retry-After` hint (seconds or
            // HTTP-date) and surface it as a retryable error with `.retryAfter` so
            // LangChain's backoff waits the requested duration instead of blind
            // exponential. Matches official OpenAI/Grok node behavior.
            if (response.status === 429) {
                clearIdleTimer();
                const retryAfter = response.headers.get('retry-after');
                let waitMs = 0;
                if (retryAfter) {
                    const asNum = Number(retryAfter);
                    if (Number.isFinite(asNum)) {
                        waitMs = asNum * 1000;
                    }
                    else {
                        const asDate = Date.parse(retryAfter);
                        if (Number.isFinite(asDate))
                            waitMs = Math.max(0, asDate - Date.now());
                    }
                }
                const err = new Error(`DeepSeek rate limited (429)${waitMs ? ` — retry after ${Math.round(waitMs / 1000)}s` : ''}`);
                err.name = 'DeepSeekRateLimitError';
                err.status = 429;
                err.retryable = true;
                err.retryAfter = waitMs;
                if (waitMs > 0)
                    await new Promise((r) => setTimeout(r, waitMs));
                throw err;
            }
            // ---- Response rewrite (auto-repair tool_call arguments) -------------
            if (!selfRef?.autoRepairToolArgs)
                return wrapStreamForIdleTimeout(response, armIdleTimer, clearIdleTimer);
            const ct = response.headers.get('content-type') ?? '';
            // Streaming responses: wrap body so each chunk resets the idle timer.
            if (!ct.includes('application/json')) {
                return wrapStreamForIdleTimeout(response, armIdleTimer, clearIdleTimer);
            }
            try {
                const cloned = response.clone();
                const text = await cloned.text();
                clearIdleTimer();
                console.log('\n=== INCOMING DEEPSEEK RESPONSE ===\n', text, '\n==================================\n');
                const data = JSON.parse(text);
                // Recover the tool schemas we just sent so we know what to repair.
                let outgoingTools = [];
                let providedAnyTools = false;
                if (init?.body && typeof init.body === 'string') {
                    try {
                        const bodyObj = JSON.parse(init.body);
                        outgoingTools = bodyObj?.tools ?? [];
                        providedAnyTools = outgoingTools.length > 0 || (bodyObj?.functions && bodyObj.functions.length > 0);
                    }
                    catch {
                        /* ignore */
                    }
                }
                let mutated = false;
                // ---- Empty Response Check & Fallback --------------------------------
                if (data?.choices && Array.isArray(data.choices) && data.choices.length > 0) {
                    const firstMsg = data.choices[0]?.message;
                    if (firstMsg) {
                        let content = firstMsg.content;
                        const reasoning = firstMsg.reasoning_content;
                        const toolCalls = firstMsg.tool_calls;
                        const functionCall = firstMsg.function_call;
                        let hasContent = typeof content === 'string' && content.trim().length > 0;
                        const hasToolCalls = Array.isArray(toolCalls) && toolCalls.length > 0;
                        const hasFunctionCall = !!functionCall;
                        // If the model tried to call a tool but N8N didn't give it any tools, that's a hallucination!
                        const isToolCallHallucination = (hasToolCalls || hasFunctionCall) && !providedAnyTools;
                        // FIX: If content is empty but we have reasoning_content, use reasoning_content as a safe fallback
                        // so LangChain doesn't crash or get stuck in a loop.
                        if (!hasContent && reasoning && typeof reasoning === 'string' && (!hasToolCalls && !hasFunctionCall || isToolCallHallucination)) {
                            let candidate = reasoning;
                            const markers = ['<｜end▁of▁thinking｜>', '<|end_of_thinking|>', '<end_of_thinking>'];
                            for (const m of markers) {
                                const idx = candidate.lastIndexOf(m);
                                if (idx >= 0) {
                                    candidate = candidate.slice(idx + m.length);
                                    break;
                                }
                            }
                            const filteredLines = candidate.split('\n')
                                .map((line) => line.trim())
                                .filter((line) => line.length > 0)
                                .filter((line) => !/^wait,?\s+/i.test(line) && !/^i made an error/i.test(line) && !/^let me /i.test(line));
                            content = filteredLines.join('\n').trim();
                            if (!content) {
                                content = 'Understood. Please clarify which specific item you want to focus on.';
                            }
                            firstMsg.content = content;
                            hasContent = true;
                            mutated = true;
                        }
                        // BEST PRACTICE: Only throw if there's NO TEXT *AND* NO VALID TOOL CALL.
                        // Intermediate agent steps often legitimately return valid tool calls without text!
                        if (!hasContent && (!hasToolCalls && !hasFunctionCall || isToolCallHallucination)) {
                            const err = new Error('DeepSeek returned an empty response (no text, or hallucinated tools). Retrying...');
                            err.name = 'DeepSeekEmptyResponseError';
                            err.status = 500;
                            err.retryable = true;
                            throw err;
                        }
                    }
                }
                for (const choice of data?.choices ?? []) {
                    const msg = choice?.message;
                    const calls = msg?.tool_calls ?? [];
                    for (const call of calls) {
                        const fn = call?.function;
                        if (!fn?.name || typeof fn.arguments !== 'string')
                            continue;
                        const tool = outgoingTools.find((t) => t?.type === 'function' && t?.function?.name === fn.name);
                        const params = tool?.function?.parameters;
                        if (!params || params.type !== 'object' || !params.properties)
                            continue;
                        let args;
                        try {
                            args = JSON.parse(fn.arguments);
                        }
                        catch {
                            args = {};
                        }
                        if (!args || typeof args !== 'object')
                            args = {};
                        const required = Array.isArray(params.required) ? params.required : [];
                        for (const key of required) {
                            if (key in args)
                                continue;
                            const propSchema = params.properties[key];
                            args[key] = defaultForSchema(propSchema);
                            mutated = true;
                        }
                        if (mutated)
                            fn.arguments = JSON.stringify(args);
                    }
                }
                if (mutated) {
                    return new Response(JSON.stringify(data), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                    });
                }
            }
            catch (err) {
                if (err?.name === 'DeepSeekEmptyResponseError')
                    throw err;
                /* fall through */
            }
            finally {
                clearIdleTimer();
            }
            return response;
        };
        super({
            ...rest,
            timeout,
            configuration: {
                baseURL: strictTools
                    ? 'https://api.deepseek.com/beta'
                    : 'https://api.deepseek.com/v1',
                ...configuration,
                fetch: interceptFetch,
            },
        });
        this.thinking = thinking;
        this.deepseekReasoningEffort = deepseekReasoningEffort;
        this.strictTools = strictTools;
        this.autoRepairToolArgs = autoRepairToolArgs;
        this.fetchTimeoutMs = fetchTimeoutMs;
        selfRef = this;
    }
    _llmType() {
        return 'deepseek-chat';
    }
    invocationParams(options, extra) {
        const params = super.invocationParams(options, extra);
        params.thinking = { type: this.thinking ? 'enabled' : 'disabled' };
        if (this.thinking && this.deepseekReasoningEffort) {
            params.reasoning_effort = this.deepseekReasoningEffort;
        }
        return params;
    }
    _primeReasoningCache(messages) {
        this._reasoningCache.clear();
        for (const m of messages) {
            if (!m)
                continue;
            const isAi = m instanceof messages_1.AIMessage ||
                m._getType?.() === 'ai' ||
                m.role === 'assistant' ||
                m.role === 'ai';
            if (!isAi)
                continue;
            const r = (m.additional_kwargs?.reasoning_content ??
                m.reasoning_content);
            if (typeof r === 'string' && r.length > 0) {
                const content = m.content;
                const key = typeof content === 'string'
                    ? content
                    : content == null
                        ? ''
                        : JSON.stringify(content);
                this._reasoningCache.set(key, r);
            }
        }
    }
    async _generate(messages, options, runManager) {
        this._primeReasoningCache(messages);
        const result = await super._generate(messages, options, runManager);
        for (const generation of result.generations) {
            const msg = generation.message;
            const reasoning = msg?.response_metadata?.message?.reasoning_content ??
                msg?.response_metadata?.reasoning_content ??
                generation.generationInfo?.reasoning_content;
            if (reasoning && generation.message instanceof messages_1.AIMessage) {
                generation.message.additional_kwargs = {
                    ...generation.message.additional_kwargs,
                    reasoning_content: reasoning,
                };
            }
            // Surface DeepSeek's reasoning_tokens usage so n8n's Agent run view
            // and downstream cost trackers can see the thinking-token spend.
            const usage = msg?.response_metadata?.tokenUsage ??
                msg?.response_metadata?.usage ??
                generation.generationInfo?.usage;
            const reasoningTokens = msg?.response_metadata?.usage?.completion_tokens_details?.reasoning_tokens ??
                generation.generationInfo?.usage?.completion_tokens_details?.reasoning_tokens;
            if (typeof reasoningTokens === 'number' && usage && typeof usage === 'object') {
                usage.reasoningTokens = reasoningTokens;
            }
            normalizeGeneratedToolCalls(generation);
        }
        return result;
    }
    async *_streamResponseChunks(messages, options, runManager) {
        this._primeReasoningCache(messages);
        const stream = super._streamResponseChunks(messages, options, runManager);
        let lastFinishReason;
        for await (const chunk of stream) {
            const raw = chunk.generationInfo ?? {};
            const delta = raw.delta ?? raw.message ?? {};
            const reasoning = delta.reasoning_content;
            if (reasoning && chunk.message instanceof messages_1.AIMessageChunk) {
                const prev = chunk.message.additional_kwargs?.reasoning_content ?? '';
                chunk.message.additional_kwargs = {
                    ...chunk.message.additional_kwargs,
                    reasoning_content: prev + reasoning,
                };
            }
            if (raw.finish_reason)
                lastFinishReason = raw.finish_reason;
            yield chunk;
        }
        // Surface finish_reason="length" as a soft signal only — never throw.
        // Matches OpenAI Chat Model node: empty/truncated turns flow through.
        void lastFinishReason;
    }
}
exports.ChatDeepSeek = ChatDeepSeek;
// ---- helpers ----------------------------------------------------------------
function normalizeGeneratedToolCalls(generation) {
    const msg = generation.message;
    if (!msg)
        return;
    const rawToolCalls = getRawToolCalls(generation);
    if (rawToolCalls.length === 0)
        return;
    msg.additional_kwargs = {
        ...msg.additional_kwargs,
        tool_calls: msg.additional_kwargs?.tool_calls ?? rawToolCalls,
    };
    if (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) {
        const parsedToolCalls = rawToolCalls
            .map((toolCall) => toParsedToolCall(toolCall))
            .filter((toolCall) => toolCall !== null);
        if (parsedToolCalls.length > 0) {
            msg.tool_calls = parsedToolCalls;
        }
    }
}
function getRawToolCalls(entry) {
    const msg = entry?.message;
    const candidates = [
        msg?.tool_calls,
        msg?.additional_kwargs?.tool_calls,
        msg?.response_metadata?.message?.tool_calls,
        msg?.response_metadata?.tool_calls,
        entry?.generationInfo?.message?.tool_calls,
        entry?.generationInfo?.tool_calls,
        entry?.generationInfo?.delta?.tool_calls,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate) && candidate.length > 0) {
            return candidate;
        }
    }
    const functionCall = msg?.additional_kwargs?.function_call ??
        msg?.response_metadata?.message?.function_call ??
        msg?.response_metadata?.function_call ??
        entry?.generationInfo?.message?.function_call ??
        entry?.generationInfo?.function_call ??
        entry?.generationInfo?.delta?.function_call;
    if (functionCall?.name) {
        return [{
                id: functionCall.id,
                type: 'function',
                function: {
                    name: functionCall.name,
                    arguments: functionCall.arguments ?? '{}',
                },
            }];
    }
    return [];
}
function toParsedToolCall(toolCall) {
    const fn = toolCall?.function ?? toolCall;
    if (typeof fn?.name !== 'string' || fn.name.length === 0)
        return null;
    let args = {};
    if (typeof fn.arguments === 'string' && fn.arguments.length > 0) {
        try {
            const parsed = JSON.parse(fn.arguments);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                args = parsed;
            }
        }
        catch {
            args = {};
        }
    }
    else if (fn.arguments && typeof fn.arguments === 'object' && !Array.isArray(fn.arguments)) {
        args = fn.arguments;
    }
    return {
        name: fn.name,
        args,
        id: toolCall?.id,
        type: 'tool_call',
    };
}
function rewriteRequest(parsed, selfRef) {
    if (Array.isArray(parsed?.messages)) {
        // Hoist + merge system messages so any mid-conversation system reminder
        // (some n8n memory nodes inject these) is normalized to message[0].
        // Matches Anthropic-style handling — improves instruction following.
        let firstSystem = null;
        const rest = [];
        for (const m of parsed.messages) {
            if (m?.role === 'system') {
                const c = typeof m.content === 'string'
                    ? m.content
                    : Array.isArray(m.content)
                        ? m.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
                        : String(m.content ?? '');
                if (c.length > 0) {
                    if (firstSystem === null) {
                        firstSystem = c;
                    }
                    else {
                        // Append subsequent system messages (like output parser instructions) 
                        // to the last user message to preserve instruction recency.
                        let lastUserIdx = -1;
                        for (let i = rest.length - 1; i >= 0; i--) {
                            if (rest[i].role === 'user') {
                                lastUserIdx = i;
                                break;
                            }
                        }
                        if (lastUserIdx !== -1) {
                            const prev = rest[lastUserIdx].content;
                            if (Array.isArray(prev)) {
                                prev.push({ type: 'text', text: '\n\n' + c });
                            }
                            else {
                                rest[lastUserIdx].content = String(prev ?? '') + '\n\n' + c;
                            }
                        }
                        else {
                            rest.push({ role: 'user', content: c });
                        }
                    }
                }
            }
            else {
                rest.push(m);
            }
        }
        if (firstSystem !== null) {
            parsed.messages = [{ role: 'system', content: firstSystem }, ...rest];
        }
        else {
            parsed.messages = rest;
        }
        const cache = selfRef?._reasoningCache;
        for (let i = 0; i < parsed.messages.length; i++) {
            const m = parsed.messages[i];
            if (m && m.role === 'assistant') {
                if ('__raw_response' in m)
                    delete m.__raw_response;
                if (m.additional_kwargs)
                    delete m.additional_kwargs;
                let r = m.reasoning_content;
                if (typeof r !== 'string') {
                    if (cache && cache.size > 0) {
                        const key = typeof m.content === 'string'
                            ? m.content
                            : m.content == null
                                ? ''
                                : JSON.stringify(m.content);
                        r = cache.get(key);
                    }
                    r = r ?? '';
                }
                // DeepSeek requires reasoning_content to appear BEFORE content 
                // when serialized, otherwise it can cause empty generation or errors.
                const newMsg = {};
                for (const k in m) {
                    if (k === 'content')
                        continue;
                    if (k === 'reasoning_content')
                        continue;
                    newMsg[k] = m[k];
                }
                newMsg.reasoning_content = r;
                // Clean-up fallback content so the API doesn't get confused and duplicate it
                let isFallback = false;
                if (m.content === 'Understood. Please clarify which specific item you want to focus on.') {
                    isFallback = true;
                }
                else if (r && m.content && (!m.tool_calls || m.tool_calls.length === 0)) {
                    let candidate = r;
                    const markers = ['<｜end▁of▁thinking｜>', '<|end_of_thinking|>', '<end_of_thinking>'];
                    for (const mk of markers) {
                        const idx = candidate.lastIndexOf(mk);
                        if (idx >= 0) {
                            candidate = candidate.slice(idx + mk.length);
                            break;
                        }
                    }
                    const filteredLines = candidate.split('\n')
                        .map((line) => line.trim())
                        .filter((line) => line.length > 0)
                        .filter((line) => !/^wait,?\s+/i.test(line) && !/^i made an error/i.test(line) && !/^let me /i.test(line));
                    const recomputedFallback = filteredLines.join('\n').trim();
                    if (recomputedFallback.length > 0 && typeof m.content === 'string' && m.content.trim() === recomputedFallback) {
                        isFallback = true;
                    }
                }
                newMsg.content = isFallback ? '' : m.content;
                parsed.messages[i] = newMsg;
            }
        }
    }
    if (selfRef?.strictTools && Array.isArray(parsed?.tools)) {
        for (const t of parsed.tools) {
            if (t?.type !== 'function' || !t.function)
                continue;
            t.function.strict = true;
            const params = (t.function.parameters ??= { type: 'object', properties: {} });
            if (params.type === 'object') {
                params.additionalProperties = false;
                if (params.properties && typeof params.properties === 'object') {
                    const propKeys = Object.keys(params.properties);
                    const prevRequired = Array.isArray(params.required) ? params.required : [];
                    const prevRequiredSet = new Set(prevRequired);
                    for (const key of propKeys) {
                        if (!prevRequiredSet.has(key)) {
                            const p = params.properties[key];
                            if (p && typeof p === 'object') {
                                if (Array.isArray(p.type)) {
                                    if (!p.type.includes('null'))
                                        p.type.push('null');
                                }
                                else if (typeof p.type === 'string' && p.type !== 'null') {
                                    p.type = [p.type, 'null'];
                                }
                            }
                        }
                    }
                    params.required = propKeys;
                }
                stripUnsupportedSchemaKeywords(params);
            }
        }
    }
}
/** Recursively strip JSON-Schema keywords DeepSeek strict mode rejects. */
function stripUnsupportedSchemaKeywords(node) {
    if (!node || typeof node !== 'object')
        return;
    if (Array.isArray(node)) {
        for (const item of node)
            stripUnsupportedSchemaKeywords(item);
        return;
    }
    delete node.minLength;
    delete node.maxLength;
    delete node.pattern;
    delete node.format;
    for (const v of Object.values(node))
        stripUnsupportedSchemaKeywords(v);
}
/** Type-appropriate default value for a missing required field. */
function defaultForSchema(schema) {
    if (!schema)
        return null;
    let t = schema.type;
    if (Array.isArray(t))
        t = t.find((x) => x !== 'null') ?? t[0];
    switch (t) {
        case 'string':
            return '';
        case 'number':
        case 'integer':
            return 0;
        case 'boolean':
            return false;
        case 'array':
            return [];
        case 'object':
            return {};
        default:
            return null;
    }
}
/**
 * Wrap a streaming Response body so each chunk re-arms the idle timer and
 * stream end/error clears it. Without this, an SSE stream that goes silent
 * after headers (DeepSeek thinking-mode stalls do this) would never trip
 * any timeout — the AbortController only sees activity at request time.
 */
function wrapStreamForIdleTimeout(response, armIdleTimer, clearIdleTimer) {
    if (!response.body) {
        clearIdleTimer();
        return response;
    }
    const original = response.body;
    const wrapped = new ReadableStream({
        async start(controller) {
            const reader = original.getReader();
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done)
                        break;
                    armIdleTimer();
                    controller.enqueue(value);
                }
                controller.close();
            }
            catch (err) {
                controller.error(err);
            }
            finally {
                clearIdleTimer();
                try {
                    reader.releaseLock();
                }
                catch { /* ignore */ }
            }
        },
        cancel(reason) {
            clearIdleTimer();
            try {
                return original.cancel(reason);
            }
            catch { /* ignore */ }
        },
    });
    return new Response(wrapped, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
