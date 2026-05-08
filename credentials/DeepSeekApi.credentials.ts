import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DeepSeekApi implements ICredentialType {
	name = 'deepSeekApi';
	displayName = 'DeepSeek API';
	documentationUrl = 'https://api-docs.deepseek.com/';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your DeepSeek API key from https://platform.deepseek.com/',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.deepseek.com',
			description: 'DeepSeek API base URL. Change only if using a proxy or custom endpoint.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/models',
			method: 'GET',
		},
	};
}
