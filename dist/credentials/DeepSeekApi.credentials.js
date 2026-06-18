"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepSeekApi = void 0;
class DeepSeekApi {
    name = 'deepSeekApi';
    displayName = 'DeepSeek API';
    documentationUrl = 'https://api-docs.deepseek.com/';
    properties = [
        {
            displayName: 'API Key',
            name: 'apiKey',
            type: 'string',
            typeOptions: { password: true },
            default: '',
            required: true,
            description: 'Get one at https://platform.deepseek.com/api_keys',
        },
        {
            displayName: 'Base URL',
            name: 'baseUrl',
            type: 'string',
            default: 'https://api.deepseek.com/v1',
            description: 'Override only if you proxy DeepSeek through a custom OpenAI-compatible gateway.',
        },
    ];
    authenticate = {
        type: 'generic',
        properties: {
            headers: {
                Authorization: '=Bearer {{$credentials.apiKey}}',
            },
        },
    };
    test = {
        request: {
            baseURL: '={{$credentials.baseUrl}}',
            url: '/models',
            method: 'GET',
        },
    };
}
exports.DeepSeekApi = DeepSeekApi;
