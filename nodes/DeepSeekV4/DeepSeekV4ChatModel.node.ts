import * as path from 'path';
import * as fs from 'fs';
import {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	NodeConnectionType,
} from 'n8n-workflow';

/* eslint-disable @typescript-eslint/no-var-requires */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireN8nDependency(dependencyName: string): any {
	// 1. Try normal require
	try {
		return require(dependencyName);
	} catch (e) {
		// ignore
	}

	// 2. Try resolving relative to require.main (n8n itself)
	if (require.main) {
		try {
			const resolvedPath = require.resolve(dependencyName, { paths: require.main.paths });
			return require(resolvedPath);
		} catch (e) {
			// ignore
		}
	}

	// 3. Try resolving relative to n8n-workflow
	try {
		const workflowPath = require.resolve('n8n-workflow');
		let currentDir = path.dirname(workflowPath);
		while (currentDir && currentDir !== path.parse(currentDir).root) {
			const potentialPath = path.join(currentDir, 'node_modules', dependencyName);
			try {
				if (fs.existsSync(potentialPath)) {
					return require(potentialPath);
				}
			} catch (e) {
				// ignore
			}
			currentDir = path.dirname(currentDir);
		}
	} catch (e) {
		// ignore
	}

	// 4. Fallback to hardcoded paths as a last resort
	const hardcodedPaths = [
		'/usr/local/lib/node_modules/n8n/node_modules',
		'/usr/local/lib/node_modules/n8n/packages/@n8n/nodes-langchain/node_modules',
		path.join(process.env.APPDATA || '', 'npm/node_modules/n8n/node_modules'),
		path.join(process.env.APPDATA || '', 'npm/node_modules/n8n/packages/@n8n/nodes-langchain/node_modules'),
	];

	for (const basePath of hardcodedPaths) {
		try {
			const potentialPath = path.join(basePath, dependencyName);
			return require(potentialPath);
		} catch (e) {
			// ignore
		}
	}

	throw new Error(`Could not resolve n8n dependency: ${dependencyName}`);
}
/* eslint-enable @typescript-eslint/no-var-requires */

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
				displayName: 'Return Thinking Content',
				name: 'returnThinkingContent',
				type: 'boolean',
				default: false,
				description: 'Se ativado, inclui o raciocinio (reasoning_content) na resposta com tags <think>. Se desativado, o pensamento e filtrado e nao aparece no output (recomendado para producao).',
				displayOptions: {
					show: {
						thinkingMode: ['enabled_high', 'enabled_max'],
					},
				},
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
		const returnThinkingContent = this.getNodeParameter('returnThinkingContent', itemIndex, false) as boolean;
		const maxTokens = this.getNodeParameter('maxTokens', itemIndex, 2048) as number;
		const temperature = this.getNodeParameter('temperature', itemIndex, 1) as number;
		const topP = this.getNodeParameter('topP', itemIndex, 1) as number;
		const frequencyPenalty = this.getNodeParameter('frequencyPenalty', itemIndex, 0) as number;
		const presencePenalty = this.getNodeParameter('presencePenalty', itemIndex, 0) as number;

		const isThinkingEnabled = thinkingMode !== 'disabled';
		// Só inclui pensamento no texto se thinking está ativo E o usuário pediu
		const shouldIncludeThinking = isThinkingEnabled && returnThinkingContent;
		const apiKey = credentials.apiKey as string;
		const baseUrl = ((credentials.baseUrl as string) || 'https://api.deepseek.com').replace(/\/$/, '');

		// Usa o resolver dinâmico para evitar caminhos absolutos travados
		const { ChatOpenAI } = requireN8nDependency('@langchain/openai');

		// Captura a flag para uso dentro da classe wrapper
		const includeThinking = shouldIncludeThinking;

		class DeepSeekV4Wrapper extends ChatOpenAI {
			// @ts-expect-error - Langchain base constructor parameters type differs
			constructor(...args) {
				super(...args);
			}

			// @ts-expect-error - Langchain base _generate method signature differs
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

					if (includeThinking) {
						// Usuário quer ver o pensamento: inclui com tags <think>
						generation.text = `<think>\n${reasoning}\n</think>\n\n${generation.text}`;
						generation.message.content = generation.text;
					}
					// Sempre preserva o reasoning nos metadados para debug no n8n,
					// mas sem poluir o content que vai pro AI Agent/WhatsApp
					generation.message.additional_kwargs.reasoning_content = reasoning;
				}
				return response;
			}

			// @ts-expect-error - Langchain base _streamResponseChunks method signature differs
			async *_streamResponseChunks(messages, options, runManager) {
				const stream = super._streamResponseChunks(messages, options, runManager);
				let isInThinkingPhase = false;
				for await (const chunk of stream) {
					const reasoning = chunk.message?.additional_kwargs?.reasoning_content;
					if (reasoning) {
						if (includeThinking) {
							// Usuário quer ver o pensamento no output
							if (!isInThinkingPhase) {
								isInThinkingPhase = true;
								chunk.message.content = '<think>\n' + reasoning;
								chunk.text = '<think>\n' + reasoning;
							} else {
								chunk.message.content = reasoning;
								chunk.text = reasoning;
							}
							yield chunk;
						} else {
							// Pensamento filtrado: não emite nada pro content,
							// marca que estamos em fase de thinking para saber
							// quando a resposta real começa
							isInThinkingPhase = true;
						}
					} else if (isInThinkingPhase && chunk.message?.content) {
						// Transição: terminou o thinking, começou o conteúdo normal
						isInThinkingPhase = false;
						if (includeThinking) {
							chunk.message.content = '\n</think>\n\n' + chunk.message.content;
							chunk.text = '\n</think>\n\n' + chunk.text;
						}
						yield chunk;
					} else {
						// Conteúdo normal (sem thinking ativo) — passa direto
						yield chunk;
					}
				}
				// Safety: se o stream terminou durante a fase de thinking
				// (API cortou a resposta), fecha a tag para evitar output malformado
				if (isInThinkingPhase && includeThinking) {
					yield {
						text: '\n</think>',
						message: { content: '\n</think>' },
					};
				}
			}
		}

		// Usa o resolver dinâmico para evitar caminhos absolutos travados
		const { N8nLlmTracing, makeN8nLlmFailedAttemptHandler } = requireN8nDependency('@n8n/ai-utilities');

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

