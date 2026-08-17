# OpenCode Kiro Auth (Amazon Q / CodeWhisperer)

Proxy multi-comptes et adaptateur OpenAI pour **Amazon Q (CodeWhisperer / Kiro)** pour OpenCode.

## Modèles Disponibles

- **Claude 3.7 / 4.5 Sonnet** : `kiro/sonnet` (ou `claude-sonnet-4.5`, `CLAUDE_3_7_SONNET_20250219_V1_0`)
- **Claude Sonnet 4** : `kiro/sonnet-4` (ou `claude-sonnet-4`)
- **DeepSeek 3.2** : `kiro/deepseek`
- **Qwen 3 Coder Next** : `kiro/qwen`
- **GLM-5** : `kiro/glm`
- **MiniMax M2.5** : `kiro/minimax`

## Installation & Démarrage

```bash
# 1. Installer les dépendances
npm install

# 2. Ajouter un compte AWS Builder ID
npm run login

# 3. Démarrer avec PM2
pm2 start ecosystem.config.cjs
```

## Configuration OpenCode

Ajoutez à `~/.config/opencode/opencode.json` :

```json
{
  "provider": {
    "kiro": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:8089/v1",
        "apiKey": "kiro-local"
      },
      "models": {
        "sonnet": { "name": "Claude 3.7 / 4.5 Sonnet (Amazon Q)" },
        "sonnet-4": { "name": "Claude Sonnet 4 (Amazon Q)" },
        "deepseek": { "name": "DeepSeek 3.2 (Amazon Q)" },
        "qwen": { "name": "Qwen 3 Coder Next (Amazon Q)" },
        "glm": { "name": "GLM-5 (Amazon Q)" },
        "minimax": { "name": "MiniMax M2.5 (Amazon Q)" }
      }
    }
  }
}
```
