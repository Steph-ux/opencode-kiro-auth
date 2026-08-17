import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { CodeWhispererStreamingClient, GenerateAssistantResponseCommand } from "@aws/codewhisperer-streaming-client"
import { createToolNameRegistry, convertToolsToCodeWhisperer, restoreToolName } from "./transformers/tool-transformer.js"

const PORT = 8089
const ACCOUNTS_FILE = path.join(os.homedir(), ".config", "opencode", "kiro-accounts.json")
const LOG_FILE = path.join(os.homedir(), ".config", "opencode", "kiro-proxy", "proxy.log")

const SSO_OIDC_ENDPOINT = "https://oidc.us-east-1.amazonaws.com"
const USER_AGENT = "aws-sdk-js/3.738.0 ua/2.1 os/other lang/js md/browser#unknown_unknown api/sso-oidc#3.738.0 m/E KiroIDE"

function logToFile(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line, "utf8")
  } catch {}
}

const MODEL_MAP = {
  "claude-sonnet-4.5": "claude-sonnet-4.5",
  "sonnet-4.5": "claude-sonnet-4.5",
  "claude-3-7-sonnet": "CLAUDE_3_7_SONNET_20250219_V1_0",
  "sonnet": "CLAUDE_3_7_SONNET_20250219_V1_0",
  "claude-sonnet-4": "claude-sonnet-4",
  "sonnet-4": "claude-sonnet-4",
  "deepseek-3.2": "deepseek-3.2",
  "deepseek": "deepseek-3.2",
  "qwen3-coder-next": "qwen3-coder-next",
  "qwen": "qwen3-coder-next",
  "glm-5": "glm-5",
  "glm": "glm-5",
  "minimax-m2.5": "minimax-m2.5",
  "minimax": "minimax-m2.5",
  "auto": "auto",
}

class AccountPool {
  constructor() {
    this.data = this.load()
    this.clientCache = new Map()
  }

  load() {
    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"))
      }
    } catch (e) {
      console.error("[AccountPool] Error loading accounts:", e.message)
    }
    return { accounts: [], activeAccountIndex: 0 }
  }

  save() {
    try {
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(this.data, null, 2), "utf8")
    } catch (e) {
      console.error("[AccountPool] Error saving accounts:", e.message)
    }
  }

  get accounts() {
    return this.data.accounts.filter((a) => a.active !== false)
  }

  get activeAccount() {
    const accs = this.accounts
    if (!accs.length) return null
    let idx = Number(this.data.activeAccountIndex) || 0
    if (idx < 0 || idx >= accs.length) idx = 0
    return accs[idx] || null
  }

  rotate() {
    const accs = this.accounts
    if (!accs.length) return null
    let idx = Number(this.data.activeAccountIndex) || 0
    this.data.activeAccountIndex = (idx + 1) % accs.length
    this.save()
    console.log(`[AccountPool] Rotated to: ${this.activeAccount?.email || this.activeAccount?.id}`)
    return this.activeAccount
  }

  async refreshTokenIfNeeded(account) {
    if (!account.refreshToken) return account.accessToken
    const now = Date.now()
    if (account.expiresAt && account.expiresAt > now + 120000) {
      return account.accessToken
    }

    console.log(`[TokenRefresher] Refreshing token for ${account.email}...`)
    try {
      const res = await fetch(`${SSO_OIDC_ENDPOINT}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify({
          clientId: account.clientId,
          clientSecret: account.clientSecret,
          grantType: "refresh_token",
          refreshToken: account.refreshToken,
        }),
      })

      if (res.ok) {
        const json = await res.json()
        if (json.accessToken) {
          account.accessToken = json.accessToken
          if (json.refreshToken) account.refreshToken = json.refreshToken
          account.expiresAt = now + (json.expiresIn || 3600) * 1000
          this.save()
          this.clientCache.delete(account.id)
          console.log(`[TokenRefresher] Token refreshed successfully for ${account.email}`)
          return account.accessToken
        }
      }
    } catch (e) {
      console.warn(`[TokenRefresher] Token refresh failed for ${account.email}: ${e.message}`)
    }
    return account.accessToken
  }

  getClient(account) {
    let client = this.clientCache.get(account.id)
    if (!client) {
      client = new CodeWhispererStreamingClient({
        region: account.region || "us-east-1",
        endpoint: `https://q.${account.region || "us-east-1"}.amazonaws.com`,
        token: async () => {
          const freshToken = await this.refreshTokenIfNeeded(account)
          return { token: freshToken }
        },
        maxAttempts: 3,
        retryMode: "standard",
        customUserAgent: [["KiroIDE"]],
      })

      client.middlewareStack.add(
        (next) => async (args) => {
          args.request.headers["x-amzn-kiro-agent-mode"] = "vibe"
          return next(args)
        },
        { step: "build", name: "addKiroHeaders" }
      )

      this.clientCache.set(account.id, client)
    }
    return client
  }
}

const pool = new AccountPool()

function transformMessages(messages, targetModel) {
  let systemPrompt = ""
  const history = []
  let currentUserText = ""
  const currentToolResults = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === "system") {
      const txt = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${txt}` : txt
      continue
    }

    const isLast = i === messages.length - 1

    if (msg.role === "user") {
      const txt = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      if (isLast) {
        currentUserText = txt
      } else {
        history.push({
          userInputMessage: {
            content: txt,
            modelId: targetModel,
            origin: "AI_EDITOR",
          },
        })
      }
    } else if (msg.role === "assistant") {
      const txt = typeof msg.content === "string" ? msg.content : ""
      const toolUses = []

      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          toolUses.push({
            toolUseId: tc.id,
            name: tc.function?.name || "tool",
            input: typeof tc.function?.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {},
          })
        }
      }

      history.push({
        assistantResponseMessage: {
          content: txt,
          ...(toolUses.length > 0 ? { toolUses } : {}),
        },
      })
    } else if (msg.role === "tool") {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content)
      const tr = {
        toolUseId: msg.tool_call_id,
        status: "success",
        content: [{ text: content }],
      }
      if (isLast) {
        currentToolResults.push(tr)
      } else {
        history.push({
          userInputMessage: {
            content: "Tool result provided.",
            modelId: targetModel,
            origin: "AI_EDITOR",
            userInputMessageContext: { toolResults: [tr] },
          },
        })
      }
    }
  }

  // Prepend system prompt to the first user message or history
  if (systemPrompt) {
    if (history.length > 0 && history[0].userInputMessage) {
      history[0].userInputMessage.content = `${systemPrompt}\n\n${history[0].userInputMessage.content}`
    } else if (currentUserText) {
      currentUserText = `${systemPrompt}\n\n${currentUserText}`
    }
  }

  if (!currentUserText && currentToolResults.length > 0) {
    currentUserText = "Tool execution completed."
  }
  if (!currentUserText) {
    currentUserText = "Hello"
  }

  const userInputMessage = {
    content: currentUserText,
    modelId: targetModel,
    origin: "AI_EDITOR",
    ...(currentToolResults.length > 0 ? { userInputMessageContext: { toolResults: currentToolResults } } : {}),
  }

  return { history, userInputMessage }
}

function transformTools(tools) {
  if (!tools || !Array.isArray(tools) || tools.length === 0) return undefined
  return tools.map((t) => {
    const fn = t.function || t
    return {
      toolSpecification: {
        name: fn.name,
        description: fn.description || fn.name,
        inputSchema: { json: fn.parameters || { type: "object", properties: {} } },
      },
    }
  })
}

async function handleChatCompletions(req, res) {
  let bodyStr = ""
  req.on("data", (c) => (bodyStr += c))
  req.on("end", async () => {
    let body = {}
    try {
      body = JSON.parse(bodyStr)
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ error: "Invalid JSON" }))
    }

    const rawModel = body.model || "claude-sonnet-4.5"
    const targetModel = MODEL_MAP[rawModel] || rawModel
    const stream = body.stream !== false
    const convId = crypto.randomUUID()

    console.log(`[Proxy] Incoming chat request -> Model: ${rawModel} (${targetModel}), stream: ${stream}`)

    const registry = createToolNameRegistry(body.tools || [])
    const cwTools = body.tools && body.tools.length > 0 ? convertToolsToCodeWhisperer(body.tools, registry) : undefined
    const toolNameMap = registry.toOriginalMap()

    const { history, userInputMessage } = transformMessages(body.messages || [], targetModel)

    if (cwTools && cwTools.length > 0) {
      if (!userInputMessage.userInputMessageContext) userInputMessage.userInputMessageContext = {}
      userInputMessage.userInputMessageContext.tools = cwTools
    }

    const commandInput = {
      conversationState: {
        chatTriggerType: "MANUAL",
        conversationId: convId,
        currentMessage: { userInputMessage },
        ...(history.length > 0 ? { history } : {}),
      },
    }

    const maxRetries = pool.accounts.length || 1
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const account = pool.activeAccount
      if (!account) {
        res.writeHead(500, { "Content-Type": "application/json" })
        return res.end(JSON.stringify({ error: "No active Kiro accounts in pool" }))
      }

      try {
        const client = pool.getClient(account)
        const command = new GenerateAssistantResponseCommand(commandInput)
        const response = await client.send(command)

        if (stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          })

          let fullContent = ""
          let fullReasoning = ""

          for await (const chunk of response.generateAssistantResponseResponse) {
            if (chunk.reasoningContentEvent?.text) {
              const text = chunk.reasoningContentEvent.text
              fullReasoning += text
              const sse = {
                id: convId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: rawModel,
                choices: [{ index: 0, delta: { reasoning_content: text }, finish_reason: null }],
              }
              res.write(`data: ${JSON.stringify(sse)}\n\n`)
            }

            if (chunk.assistantResponseEvent?.content) {
              const text = chunk.assistantResponseEvent.content
              fullContent += text
              const sse = {
                id: convId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: rawModel,
                choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
              }
              res.write(`data: ${JSON.stringify(sse)}\n\n`)
            }

            if (chunk.assistantResponseEvent?.toolUse) {
              const tu = chunk.assistantResponseEvent.toolUse
              const origName = restoreToolName(tu.name, toolNameMap)
              const sse = {
                id: convId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: rawModel,
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: tu.toolUseId || crypto.randomUUID(),
                          type: "function",
                          function: {
                            name: origName,
                            arguments: typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input || {}),
                          },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              }
              res.write(`data: ${JSON.stringify(sse)}\n\n`)
            }
          }

          const doneSse = {
            id: convId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: rawModel,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: {
              prompt_tokens: Math.ceil((bodyStr.length / 4) * 0.8),
              completion_tokens: Math.ceil((fullContent.length + fullReasoning.length) / 4),
              total_tokens: Math.ceil((bodyStr.length + fullContent.length + fullReasoning.length) / 4),
            },
          }
          res.write(`data: ${JSON.stringify(doneSse)}\n\n`)
          res.write("data: [DONE]\n\n")
          return res.end()
        } else {
          let fullContent = ""
          let fullReasoning = ""
          const toolCalls = []

          for await (const chunk of response.generateAssistantResponseResponse) {
            if (chunk.reasoningContentEvent?.text) fullReasoning += chunk.reasoningContentEvent.text
            if (chunk.assistantResponseEvent?.content) fullContent += chunk.assistantResponseEvent.content
            if (chunk.assistantResponseEvent?.toolUse) {
              const tu = chunk.assistantResponseEvent.toolUse
              const origName = restoreToolName(tu.name, toolNameMap)
              toolCalls.push({
                id: tu.toolUseId || crypto.randomUUID(),
                type: "function",
                function: {
                  name: origName,
                  arguments: typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input || {}),
                },
              })
            }
          }

          const out = {
            id: convId,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: rawModel,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: fullContent || null,
                  ...(fullReasoning ? { reasoning_content: fullReasoning } : {}),
                  ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                },
                finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
              },
            ],
            usage: {
              prompt_tokens: Math.ceil((bodyStr.length / 4) * 0.8),
              completion_tokens: Math.ceil((fullContent.length + fullReasoning.length) / 4),
              total_tokens: Math.ceil((bodyStr.length + fullContent.length + fullReasoning.length) / 4),
            },
          }
          res.writeHead(200, { "Content-Type": "application/json" })
          return res.end(JSON.stringify(out, null, 2))
        }
      } catch (e) {
        console.error(`[Proxy] Error with account ${account.email}:`, e.name, e.message)
        logToFile(`[Error] ${account.email} failed: ${e.name} - ${e.message}`)
        pool.rotate()
      }
    }

    res.writeHead(502, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "All Kiro accounts exhausted or error occurred." } }))
  })
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

  if (req.method === "OPTIONS") {
    res.writeHead(200)
    return res.end()
  }

  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" })
    return res.end(
      JSON.stringify(
        {
          status: "ok",
          service: "kiro-proxy",
          port: PORT,
          accountsCount: pool.accounts.length,
          activeAccount: pool.activeAccount?.email,
          models: Object.keys(MODEL_MAP),
        },
        null,
        2
      )
    )
  }

  if (req.url === "/v1/models") {
    const list = Object.keys(MODEL_MAP).map((m) => ({ id: m, object: "model", created: 1786920000, owned_by: "amazon-q" }))
    res.writeHead(200, { "Content-Type": "application/json" })
    return res.end(JSON.stringify({ object: "list", data: list }, null, 2))
  }

  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    return handleChatCompletions(req, res)
  }

  res.writeHead(404, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ error: "Not Found" }))
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n=======================================================`)
  console.log(`  🚀 KIRO PROXY (AMAZON Q) ACTIF SUR http://127.0.0.1:${PORT}`)
  console.log(`=======================================================`)
  console.log(`  Comptes actifs : ${pool.accounts.length}`)
  console.log(`  Modèles        : ${Object.keys(MODEL_MAP).join(", ")}\n`)
})
