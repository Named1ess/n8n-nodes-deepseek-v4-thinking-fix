# n8n-nodes-deepseek

Community n8n node that exposes [DeepSeek](https://api-docs.deepseek.com/) chat models — including **DeepSeek V4 Pro** and **DeepSeek V4 Flash** — as a LangChain chat-model sub-node, so you can drop it into the **AI Agent** or **Basic LLM Chain** the same way as the OpenAI / OpenRouter chat-model nodes.

DeepSeek's [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode) is supported out of the box: the chain-of-thought is captured into `reasoning_content` and surfaced on the AI message as `additional_kwargs.reasoning_content`, ready to be used by downstream nodes.

## Features

- Models: `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-reasoner`, `deepseek-chat`, plus a free-form **Custom** option for future models.
- Thinking-mode toggle (on by default) and `reasoning_effort` control (`high` / `max`).
- Streaming and non-streaming both surface `reasoning_content`.
- Tool calling supported (DeepSeek V4 thinking mode supports tools).
- Drop-in replacement for `lmChatOpenRouter` / `lmChatOpenAi` in any AI Agent workflow.

## Install

In your n8n instance:

1. Settings → **Community Nodes** → **Install**.
2. Enter `n8n-nodes-deepseek`.
3. Reload, then add credentials of type **DeepSeek API** (your key from <https://platform.deepseek.com/api_keys>).
4. Add the **DeepSeek Chat Model** node and wire its `Model` output into an **AI Agent** node.

## Reading the chain-of-thought

After the AI Agent runs, the assistant message has both:

- `output` (or `content`) — the final answer.
- `additional_kwargs.reasoning_content` — the model's chain-of-thought.

Example workflow JSON snippet:

```json
{
  "nodes": [
    {
      "parameters": {
        "model": "deepseek-v4-pro",
        "options": { "thinking": true, "reasoningEffort": "high" }
      },
      "type": "n8n-nodes-deepseek.lmChatDeepSeek",
      "typeVersion": 1,
      "position": [1312, 1824],
      "id": "deepseek-pro",
      "name": "DeepSeek Chat Model",
      "credentials": {
        "deepSeekApi": { "id": "REPLACE", "name": "My DeepSeek key" }
      }
    }
  ],
  "connections": {
    "DeepSeek Chat Model": { "ai_languageModel": [[]] }
  }
}
```

## Develop / publish

```bash
cd packages/n8n-nodes-deepseek
npm install
npm run build
# verify the dist/ folder, then:
npm publish --access public
```

Make sure `package.json` has your real `name`, `author`, and `repository` URL before publishing.

## License

MIT
