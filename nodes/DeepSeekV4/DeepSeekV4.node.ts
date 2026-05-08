import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';

export class DeepSeekV4 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DeepSeek V4',
		name: 'deepSeekV4',
		icon: 'file:golden-deepseek.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["model"]}}',
		description: 'Interact with DeepSeek V4 models (deepseek-v4-flash, deepseek-v4-pro) via the DeepSeek API. Supports thinking mode control.',
		defaults: {
			name: 'DeepSeek V4',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'deepSeekApi',
				required: true,
			},
		],
		properties: [
			// ─── MODEL ──────────────────────────────────────────────────────────────
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{
						name: 'DeepSeek V4 Flash (deepseek-chat alias)',
						value: 'deepseek-v4-flash',
						description: 'Fast and cost-effective. Alias: deepseek-chat',
					},
					{
						name: 'DeepSeek V4 Pro (deepseek-reasoner alias)',
						value: 'deepseek-v4-pro',
						description: 'Most capable V4 model. Alias: deepseek-reasoner',
					},
					{
						name: 'DeepSeek Chat (legacy alias → V4 Flash)',
						value: 'deepseek-chat',
						description: 'Legacy name, maps to deepseek-v4-flash without thinking',
					},
					{
						name: 'DeepSeek Reasoner (legacy alias → V4 Flash thinking)',
						value: 'deepseek-reasoner',
						description: 'Legacy name, maps to deepseek-v4-flash with thinking enabled',
					},
				],
				default: 'deepseek-v4-flash',
				description: 'Which DeepSeek model to use',
				displayOptions: { show: { operation: ['chatCompletion'] } },
			},

			// ─── OPERATION ──────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Chat Completion',
						value: 'chatCompletion',
						description: 'Send a prompt to the model and get a response',
						action: 'Send a chat completion',
					},
					{
						name: 'Check Balance',
						value: 'checkBalance',
						description: 'Check your account balance on DeepSeek API',
						action: 'Check account balance',
					},
				],
				default: 'chatCompletion',
			},

			// ─── MESSAGES ───────────────────────────────────────────────────────────
			{
				displayName: 'System Message',
				name: 'systemMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				default: 'You are a helpful assistant.',
				description: 'System prompt sent before the user message. Leave blank to omit.',
				displayOptions: { show: { operation: ['chatCompletion'] } },
			},
			{
				displayName: 'User Message',
				name: 'userMessage',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description: 'The user prompt to send to the model',
				displayOptions: { show: { operation: ['chatCompletion'] } },
			},

			// ─── THINKING MODE ──────────────────────────────────────────────────────
			{
				displayName: 'Thinking Mode',
				name: 'thinkingMode',
				type: 'options',
				options: [
					{
						name: 'Disabled',
						value: 'disabled',
						description: 'Turn off chain-of-thought reasoning (faster, cheaper)',
					},
					{
						name: 'Enabled — High Effort',
						value: 'enabled_high',
						description: 'Enable thinking mode with high reasoning effort',
					},
					{
						name: 'Enabled — Max Effort',
						value: 'enabled_max',
						description: 'Enable thinking mode with maximum reasoning effort',
					},
				],
				default: 'disabled',
				description:
					'Control whether the model uses chain-of-thought reasoning before answering. Disabled is faster and cheaper. Thinking mode is not compatible with temperature/top_p parameters.',
				displayOptions: { show: { operation: ['chatCompletion'] } },
			},

			// ─── RETURN THINKING CONTENT ─────────────────────────────────────────────
			{
				displayName: 'Return Thinking Content',
				name: 'returnThinkingContent',
				type: 'boolean',
				default: false,
				description:
					'Whether to include the reasoning_content (chain-of-thought) in the output alongside the final answer',
				displayOptions: {
					show: {
						operation: ['chatCompletion'],
						thinkingMode: ['enabled_high', 'enabled_max'],
					},
				},
			},

			// ─── ADVANCED OPTIONS ────────────────────────────────────────────────────
			{
				displayName: 'Advanced Options',
				name: 'advancedOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { operation: ['chatCompletion'] } },
				options: [
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
						default: 1,
						description:
							'Sampling temperature (0–2). Ignored when thinking mode is enabled.',
					},
					{
						displayName: 'Max Tokens',
						name: 'maxTokens',
						type: 'number',
						typeOptions: { minValue: 1 },
						default: 2048,
						description: 'Maximum number of tokens to generate in the response',
					},
					{
						displayName: 'Top P',
						name: 'topP',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
						default: 1,
						description: 'Nucleus sampling (0–1). Ignored when thinking mode is enabled.',
					},
					{
						displayName: 'Stop Sequences',
						name: 'stop',
						type: 'string',
						default: '',
						description:
							'Comma-separated list of stop sequences. The model will stop generating when it encounters any of these.',
					},
					{
						displayName: 'Presence Penalty',
						name: 'presencePenalty',
						type: 'number',
						typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 2 },
						default: 0,
						description: 'Presence penalty (-2 to 2). Ignored when thinking mode is enabled.',
					},
					{
						displayName: 'Frequency Penalty',
						name: 'frequencyPenalty',
						type: 'number',
						typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 2 },
						default: 0,
						description: 'Frequency penalty (-2 to 2). Ignored when thinking mode is enabled.',
					},
					{
						displayName: 'JSON Output Mode',
						name: 'jsonMode',
						type: 'boolean',
						default: false,
						description:
							'Whether to force the model to return a valid JSON object (response_format: json_object)',
					},
					{
						displayName: 'Custom Base URL',
						name: 'customBaseUrl',
						type: 'string',
						default: '',
						description:
							'Override the base URL from credentials. Useful for proxies or OpenAI-compatible endpoints.',
					},
				],
			},
		],
	};

	// ─── EXECUTE ────────────────────────────────────────────────────────────────
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('deepSeekApi');
		const baseUrlFromCred = (credentials.baseUrl as string) || 'https://api.deepseek.com';
		const apiKey = credentials.apiKey as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const operation = this.getNodeParameter('operation', i) as string;

				if (operation === 'checkBalance') {
					const endpoint = `${baseUrlFromCred}/user/balance`.replace('v1/user/balance', 'user/balance');
					const response = await this.helpers.requestWithAuthentication.call(this, 'deepSeekApi', {
						method: 'GET',
						uri: endpoint,
						json: true,
					});
					
					returnData.push({
						json: response,
					});
					continue;
				}

				if (operation === 'chatCompletion') {
					const model = this.getNodeParameter('model', i) as string;
					const systemMessage = this.getNodeParameter('systemMessage', i, '') as string;
					const userMessage = this.getNodeParameter('userMessage', i) as string;
					const thinkingMode = this.getNodeParameter('thinkingMode', i) as string;
					const returnThinkingContent = this.getNodeParameter(
						'returnThinkingContent',
						i,
						false,
					) as boolean;
					const advancedOptions = this.getNodeParameter('advancedOptions', i, {}) as {
						temperature?: number;
						maxTokens?: number;
						topP?: number;
						stop?: string;
						presencePenalty?: number;
						frequencyPenalty?: number;
						jsonMode?: boolean;
						customBaseUrl?: string;
					};

					// Build messages array
					const messages: Array<{ role: string; content: string }> = [];
					if (systemMessage && systemMessage.trim() !== '') {
						messages.push({ role: 'system', content: systemMessage });
					}
					messages.push({ role: 'user', content: userMessage });

					// ─── Build request body ──────────────────────────────────────────
					const isThinkingEnabled = thinkingMode !== 'disabled';
					const reasoningEffort =
						thinkingMode === 'enabled_max' ? 'max' : 'high';

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const body: Record<string, any> = {
						model,
						messages,
						max_tokens: advancedOptions.maxTokens ?? 2048,
						// Thinking toggle (always explicit)
						thinking: { type: isThinkingEnabled ? 'enabled' : 'disabled' },
					};

					// reasoning_effort only when thinking is on
					if (isThinkingEnabled) {
						body.reasoning_effort = reasoningEffort;
					}

					// Temperature / top_p / penalties are ignored by the API in thinking
					// mode, but we only send them when thinking is OFF to keep payloads clean
					if (!isThinkingEnabled) {
						if (advancedOptions.temperature !== undefined) {
							body.temperature = advancedOptions.temperature;
						}
						if (advancedOptions.topP !== undefined && advancedOptions.topP !== 1) {
							body.top_p = advancedOptions.topP;
						}
						if (
							advancedOptions.presencePenalty !== undefined &&
							advancedOptions.presencePenalty !== 0
						) {
							body.presence_penalty = advancedOptions.presencePenalty;
						}
						if (
							advancedOptions.frequencyPenalty !== undefined &&
							advancedOptions.frequencyPenalty !== 0
						) {
							body.frequency_penalty = advancedOptions.frequencyPenalty;
						}
					}

					if (advancedOptions.stop && advancedOptions.stop.trim() !== '') {
						body.stop = advancedOptions.stop
							.split(',')
							.map((s: string) => s.trim())
							.filter(Boolean);
					}

					if (advancedOptions.jsonMode) {
						body.response_format = { type: 'json_object' };
					}

					// Determine base URL (custom overrides credentials)
					const baseUrl =
						(advancedOptions.customBaseUrl && advancedOptions.customBaseUrl.trim() !== ''
							? advancedOptions.customBaseUrl.trim()
							: baseUrlFromCred
						).replace(/\/$/, '');

					// ─── HTTP Request ────────────────────────────────────────────────
					const response = await this.helpers.httpRequest({
						method: 'POST',
						url: `${baseUrl}/chat/completions`,
						headers: {
							Authorization: `Bearer ${apiKey}`,
							'Content-Type': 'application/json',
						},
						body,
						json: true,
					});

					// ─── Extract response ────────────────────────────────────────────
					const choice = response?.choices?.[0];
					if (!choice) {
						throw new NodeOperationError(
							this.getNode(),
							'DeepSeek API returned an empty choices array.',
							{ itemIndex: i },
						);
					}

					const content: string = choice.message?.content ?? '';
					const reasoningContent: string = choice.message?.reasoning_content ?? '';

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const outputJson: Record<string, any> = {
						content,
						model: response.model ?? model,
						usage: response.usage ?? {},
						finish_reason: choice.finish_reason ?? '',
					};

					if (isThinkingEnabled && returnThinkingContent) {
						outputJson.reasoning_content = reasoningContent;
					}

					returnData.push({
						json: outputJson,
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					throw error;
				}
				throw new NodeApiError(this.getNode(), { message: (error as Error).message } as never, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
