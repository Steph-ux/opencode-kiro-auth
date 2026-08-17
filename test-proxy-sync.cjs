async function testKiroProxy() {
  console.log("=== TESTING KIRO PROXY (http://127.0.0.1:8089) ===")
  const start = Date.now()
  const res = await fetch("http://127.0.0.1:8089/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonnet",
      messages: [{ role: "user", content: "Reponds en un seul mot: quelle est la capitale de l'Australie ?" }],
      stream: false
    })
  })
  const dur = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`Status: ${res.status} (took ${dur}s)`)
  const json = await res.json()
  console.log("Response:", JSON.stringify(json, null, 2))
}

testKiroProxy().catch(console.error)
