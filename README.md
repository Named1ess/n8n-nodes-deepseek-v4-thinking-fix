# n8n-nodes-deepseek-v4

Nó comunitário do n8n para os modelos **DeepSeek V4** (`deepseek-v4-flash` e `deepseek-v4-pro`), com controle completo do **Thinking Mode**.

## Modelos suportados

| Model ID | Alias legado | Thinking |
|---|---|---|
| `deepseek-v4-flash` | `deepseek-chat` | Opcional |
| `deepseek-v4-pro` | `deepseek-reasoner` | Opcional |
| `deepseek-chat` | — | Sem thinking por padrão |
| `deepseek-reasoner` | — | Com thinking por padrão |

## Features

- ✅ **Thinking Mode toggle** — Desabilite, habilite com `high` ou `max` effort
- ✅ Retorna `reasoning_content` separado do `content` (opcional)
- ✅ Parâmetros `temperature`, `top_p`, `presence_penalty`, `frequency_penalty` são automaticamente omitidos quando thinking está ativo (evita conflito com a API)
- ✅ Suporte a JSON Output Mode (`response_format: json_object`)
- ✅ Stop sequences configuráveis
- ✅ Custom Base URL (útil para proxies OpenAI-compatible)

## Instalação

### Via npm (produção)
```bash
npm install n8n-nodes-deepseek-v4
```

### Via n8n UI
Vá em **Settings → Community Nodes → Install** e busque `n8n-nodes-deepseek-v4`.

### Desenvolvimento local
```bash
cd n8n-nodes-deepseek-v4
npm install
npm run build
# Copie a pasta para ~/.n8n/custom/ ou use npm link
```

## Configuração da Credencial

1. Acesse [platform.deepseek.com](https://platform.deepseek.com/) e gere uma API Key
2. No n8n, vá em **Credentials → New → DeepSeek API**
3. Insira a API Key e salve

## Parâmetros do Nó

| Parâmetro | Descrição |
|---|---|
| **Model** | Modelo a usar (v4-flash, v4-pro, etc.) |
| **System Message** | Prompt de sistema (opcional) |
| **User Message** | Prompt do usuário |
| **Thinking Mode** | `Disabled` / `Enabled – High` / `Enabled – Max` |
| **Return Thinking Content** | Incluir `reasoning_content` no output |
| **Temperature** | Temperatura (ignorada com thinking ativo) |
| **Max Tokens** | Máximo de tokens gerados |
| **JSON Output Mode** | Força output como JSON válido |
| **Stop Sequences** | Sequências de parada (vírgula separadas) |

## Saída

```json
{
  "content": "Resposta final do modelo",
  "reasoning_content": "Chain-of-thought (apenas se thinking ativo e Return habilitado)",
  "model": "deepseek-v4-flash",
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  },
  "finish_reason": "stop"
}
```

## Por que desabilitar o Thinking?

O Thinking Mode **consome mais tokens** e é mais lento. Para tarefas simples (classificação, extração, tradução, geração de texto direto), desabilitá-lo é mais eficiente e barato. O nó envia explicitamente `{"thinking": {"type": "disabled"}}` para garantir que o modelo não use reasoning mesmo quando o default da API for `enabled`.

## Licença

MIT
