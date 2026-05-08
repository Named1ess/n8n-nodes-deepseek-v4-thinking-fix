import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	NodeConnectionType,
} from 'n8n-workflow';

export class DeepSeekV4ChatModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'DeepSeek V4 Chat Model',
		name: 'deepSeekV4ChatModel',
		icon: 'file:golden-deepseek.png',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["model"]}}',
		description: 'DeepSeek V4 como Chat Model para o AI Agent. Thinking Mode desativado por padrão.',
		defaults: { name: 'DeepSeek V4 Chat Model' },
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
			},
			resources: {
				primaryDocumentation: [{ url: 'https://api-docs.deepseek.com/' }],
			},
		},
		inputs: [],
		outputs: ['ai_languageModel' as NodeConnectionType],
		outputNames: ['Model'],
		credentials: [{ name: 'deepSeekApi', required: true }],
		properties: [
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'DeepSeek V4 Flash (Rapido)', value: 'deepseek-v4-flash', description: 'Rapido e economico' },
					{ name: 'DeepSeek V4 Pro (Mais Capaz)', value: 'deepseek-v4-pro', description: 'Mais capaz' },
					{ name: 'deepseek-chat (alias legado)', value: 'deepseek-chat' },
					{ name: 'deepseek-reasoner (alias legado)', value: 'deepseek-reasoner' },
				],
				default: 'deepseek-v4-flash',
			},
			{
				displayName: 'Thinking Mode',
				name: 'thinkingMode',
				type: 'options',
				options: [
					{ name: 'Desativado (Padrao - Mais Rapido e Barato)', value: 'disabled' },
					{ name: 'Ativado - High Effort', value: 'enabled_high' },
					{ name: 'Ativado - Max Effort', value: 'enabled_max' },
				],
				default: 'disabled',
				description: 'Controla o raciocinio chain-of-thought. Desativado = mais rapido e barato.',
			},
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				default: 2048,
				typeOptions: { minValue: 1 },
				description: 'Máximo de tokens na resposta',
			},
			{
				displayName: 'Temperature',
				name: 'temperature',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
				description: 'Temperatura (ignorada quando thinking mode está ativo)',
				displayOptions: { show: { thinkingMode: ['disabled'] } },
			},
			{
				displayName: 'Top P',
				name: 'topP',
				type: 'number',
				default: 1,
				typeOptions: { minValue: 0, maxValue: 1, numberPrecision: 2 },
				description: 'Controla a diversidade (núcleo da amostragem). Use no lugar da Temperatura, não ambos.',
			},
			{
				displayName: 'Frequency Penalty',
				name: 'frequencyPenalty',
				type: 'number',
				default: 0,
				typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 2 },
				description: 'Penaliza tokens baseados na frequência no texto até o momento, reduzindo repetições.',
			},
			{
				displayName: 'Presence Penalty',
				name: 'presencePenalty',
				type: 'number',
				default: 0,
				typeOptions: { minValue: -2, maxValue: 2, numberPrecision: 2 },
				description: 'Penaliza tokens novos se eles já apareceram no texto, incentivando assuntos novos.',
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('deepSeekApi');
		const model = this.getNodeParameter('model', itemIndex) as string;
		const thinkingMode = this.getNodeParameter('thinkingMode', itemIndex) as string;
		const maxTokens = this.getNodeParameter('maxTokens', itemIndex, 2048) as number;
		const temperature = this.getNodeParameter('temperature', itemIndex, 1) as number;
		const topP = this.getNodeParameter('topP', itemIndex, 1) as number;
		const frequencyPenalty = this.getNodeParameter('frequencyPenalty', itemIndex, 0) as number;
		const presencePenalty = this.getNodeParameter('presencePenalty', itemIndex, 0) as number;

		const isThinkingEnabled = thinkingMode !== 'disabled';
		const apiKey = credentials.apiKey as string;
		const baseUrl = ((credentials.baseUrl as string) || 'https://api.deepseek.com').replace(/\/$/, '');

		// Usa o mesmo path que o n8n usa internamente (@langchain/openai v1.x)
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { ChatOpenAI } = require('/usr/local/lib/node_modules/n8n/node_modules/@langchain/openai');

		class DeepSeekV4Wrapper extends ChatOpenAI {
			// @ts-ignore
			constructor(...args) {
				super(...args);
			}

			// @ts-ignore
			async _generate(messages, options, runManager) {
				const response = await super._generate(messages, options, runManager);
				const generation = response.generations[0];
				if (
					generation &&
					generation.message &&
					generation.message.additional_kwargs &&
					generation.message.additional_kwargs.reasoning_content
				) {
					const reasoning = generation.message.additional_kwargs.reasoning_content;
					generation.text = `<think>\n${reasoning}\n</think>\n\n${generation.text}`;
					generation.message.content = generation.text;
				}
				return response;
			}

			// @ts-ignore
			async *_streamResponseChunks(messages, options, runManager) {
				const stream = super._streamResponseChunks(messages, options, runManager);
				let isThinking = false;
				for await (const chunk of stream) {
					const reasoning = chunk.message?.additional_kwargs?.reasoning_content;
					if (reasoning) {
						if (!isThinking) {
							isThinking = true;
							chunk.message.content = '<think>\n' + reasoning;
							chunk.text = '<think>\n' + reasoning;
						} else {
							chunk.message.content = reasoning;
							chunk.text = reasoning;
						}
					} else if (isThinking && chunk.message?.content) {
						// Terminou o thinking e comecou o conteudo normal
						isThinking = false;
						chunk.message.content = '\n</think>\n\n' + chunk.message.content;
						chunk.text = '\n</think>\n\n' + chunk.text;
					}
					yield chunk;
				}
			}
		}

		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { N8nLlmTracing, makeN8nLlmFailedAttemptHandler } = require('/usr/local/lib/node_modules/n8n/node_modules/@n8n/ai-utilities');

		const modelKwargs: Record<string, unknown> = {
			thinking: { type: isThinkingEnabled ? 'enabled' : 'disabled' },
		};
		if (isThinkingEnabled) {
			modelKwargs.reasoning_effort = thinkingMode === 'enabled_max' ? 'max' : 'high';
		}

		// Padrao identico ao no oficial LmChatDeepSeek do n8n (v1.x)
		const chatModel = new DeepSeekV4Wrapper({
			apiKey,
			model,
			maxTokens: maxTokens === -1 ? undefined : maxTokens,
			...(isThinkingEnabled ? {} : { temperature }),
			topP,
			frequencyPenalty,
			presencePenalty,
			configuration: {
				baseURL: baseUrl,
			},
			modelKwargs,
			callbacks: [new N8nLlmTracing(this)],
			onFailedAttempt: makeN8nLlmFailedAttemptHandler(this),
		});

		return { response: chatModel };
	}
}

