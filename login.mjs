import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { exec } from "node:child_process"

const REGION = "us-east-1"
const SSO_OIDC_ENDPOINT = `https://oidc.${REGION}.amazonaws.com`
const BUILDER_ID_START_URL = "https://view.awsapps.com/start"
const USER_AGENT = "aws-sdk-js/3.738.0 ua/2.1 os/other lang/js md/browser#unknown_unknown api/sso-oidc#3.738.0 m/E KiroIDE"
const ACCOUNTS_FILE = path.join(os.homedir(), ".config", "opencode", "kiro-accounts.json")

const SCOPES = [
  "codewhisperer:completions",
  "codewhisperer:analysis",
  "codewhisperer:conversations",
  "codewhisperer:transformations",
  "codewhisperer:taskassist",
]

function openBrowser(url) {
  const start = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
  exec(`${start} "${url}"`, () => {})
}

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"))
    }
  } catch (e) {
    console.error("[AccountPool] Error reading kiro-accounts.json:", e.message)
  }
  return { accounts: [], activeAccountIndex: 0 }
}

function saveAccounts(data) {
  try {
    fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: !0 })
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), "utf8")
    const localP = path.join(process.cwd(), "accounts.json")
    fs.writeFileSync(localP, JSON.stringify(data, null, 2), "utf8")
  } catch (e) {
    console.error("[AccountPool] Error saving accounts:", e.message)
  }
}

async function getUserInfo(accessToken) {
  try {
    const res = await fetch("https://view.awsapps.com/api/user/info", {
      headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": USER_AGENT },
    })
    if (res.ok) {
      const j = await res.json()
      return j.email || j.userName || j.userId || null
    }
  } catch {}
  return null
}

async function main() {
  console.log("=======================================================")
  console.log("    KIRO / AMAZON Q - AJOUT DE COMPTE BUILDER ID       ")
  console.log("=======================================================\n")

  console.log("1. Registration du client OIDC...")
  const regRes = await fetch(`${SSO_OIDC_ENDPOINT}/client/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      clientName: "Kiro IDE",
      clientType: "public",
      scopes: SCOPES,
      grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    }),
  })
  const { clientId, clientSecret } = await regRes.json()

  console.log("2. Demande du code appareil...")
  const devRes = await fetch(`${SSO_OIDC_ENDPOINT}/device_authorization`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ clientId, clientSecret, startUrl: BUILDER_ID_START_URL }),
  })
  const devData = await devRes.json()
  const { deviceCode, userCode, verificationUriComplete, expiresIn = 600 } = devData
  const interval = (devData.interval || 5) * 1000

  console.log("\n=======================================================")
  console.log("  👉 CODE UTILISATEUR : \x1b[33m\x1b[1m" + userCode + "\x1b[0m")
  console.log("  👉 LIEN DE CONNEXION: \x1b[36m\x1b[4m" + verificationUriComplete + "\x1b[0m")
  console.log("=======================================================\n")

  openBrowser(verificationUriComplete)
  console.log("[*] Le navigateur s'est ouvert. Confirmez l'accès...")

  const start = Date.now()
  while (Date.now() - start < expiresIn * 1000) {
    await new Promise((r) => setTimeout(r, interval))

    try {
      const tokenRes = await fetch(`${SSO_OIDC_ENDPOINT}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
        body: JSON.stringify({
          clientId,
          clientSecret,
          deviceCode,
          grantType: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      })

      const json = await tokenRes.json()

      if (json.accessToken) {
        const email = (await getUserInfo(json.accessToken)) || `builder_id_${Date.now().toString(36)}`
        const pool = loadAccounts()

        const existingIdx = pool.accounts.findIndex((a) => a.email === email)
        const accountEntry = {
          id: `acc_kiro_${Date.now().toString(36)}`,
          email,
          accessToken: json.accessToken,
          refreshToken: json.refreshToken,
          expiresAt: Date.now() + (json.expiresIn || 3600) * 1000,
          clientId,
          clientSecret,
          region: REGION,
          active: true,
          addedAt: new Date().toISOString(),
        }

        if (existingIdx >= 0) {
          pool.accounts[existingIdx] = accountEntry
          console.log(`\n[+] Compte existant mis à jour : ${email}`)
        } else {
          pool.accounts.push(accountEntry)
          console.log(`\n[+] Nouveau compte ajouté au pool (${pool.accounts.length} comptes au total)`)
        }

        saveAccounts(pool)
        exec("pm2 restart kiro-proxy", () => {
          console.log("[+] Proxy kiro-proxy redémarré sur PM2")
        })

        console.log("\n=======================================================")
        console.log("  🎉 CONNEXION RÉUSSIE ! COMPTE SAUVEGARDÉ DANS LE POOL")
        console.log("=======================================================")
        console.log("  Email   :", email)
        console.log("  Fichier :", ACCOUNTS_FILE)
        return
      }

      if (json.error === "authorization_pending") {
        process.stdout.write(".")
      } else if (json.error === "slow_down") {
        process.stdout.write("s")
      } else if (json.error) {
        console.error(`\n[!] Erreur OIDC: ${json.error} - ${json.error_description || ""}`)
        return
      }
    } catch {}
  }
}

main().catch(console.error)
