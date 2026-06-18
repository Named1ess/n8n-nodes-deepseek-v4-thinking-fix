import { ChatOpenAI } from '@langchain/openai';
import type { OpenAIChatInput, ClientOptions } from '@langchain/openai';
import type { ChatGenerationChunk, ChatResult } from '@langchain/core/outputs';
export interface ChatDeepSeekFields extends Partial<Omit<OpenAIChatInput, 'reasoningEffort'>> {
    apiKey: string;
    configuration?: ClientOptions;
    maxRetries?: number;
    /** Enable DeepSeek thinking mode. Default true. */
    thinking?: boolean;
    /** DeepSeek-only effort. Accepts "high" | "max". */
    deepseekReasoningEffort?: 'high' | 'max';
    /** Enable DeepSeek strict-mode tool schemas (Beta). Default true. */
    strictTools?: boolean;
    /** Auto-fill missing required fields in tool_call arguments. Default true. */
    autoRepairToolArgs?: boolean;
    /** Hard wall-clock + idle timeout in ms for the fetch interceptor. */
    timeout?: number;
}
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
export declare class ChatDeepSeek extends ChatOpenAI {
    thinking: boolean;
    deepseekReasoningEffort?: 'high' | 'max';
    strictTools: boolean;
    autoRepairToolArgs: boolean;
    fetchTimeoutMs: number;
    /** Map<assistant content string, reasoning_content> populated per call. */
    private _reasoningCache;
    constructor(fields: ChatDeepSeekFields);
    _llmType(): string;
    invocationParams(options?: this['ParsedCallOptions'], extra?: {
        streaming?: boolean;
    }): any;
    private _primeReasoningCache;
    _generate(messages: Parameters<ChatOpenAI['_generate']>[0], options: this['ParsedCallOptions'], runManager?: Parameters<ChatOpenAI['_generate']>[2]): Promise<ChatResult>;
    _streamResponseChunks(messages: Parameters<ChatOpenAI['_streamResponseChunks']>[0], options: this['ParsedCallOptions'], runManager?: Parameters<ChatOpenAI['_streamResponseChunks']>[2]): AsyncGenerator<ChatGenerationChunk>;
}
