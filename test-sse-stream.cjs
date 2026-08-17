async function testSse() {
  const start = Date.now()
  console.log("Sending streaming request to Kiro Proxy...")
  const res = await fetch("http://127.0.0.1:8089/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonnet",
      messages: [{ role: "user", content: "Reponds en un seul mot: quelle est la capitale du Japon ?" }],
      stream: true
    })
  })

  console.log("SSE Status:", res.status)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    process.stdout.write(chunk)
  }
  console.log(`\nStream completed in ${((Date.now() - start)/1000).toFixed(1)}s`)
}

testSse().catch(console.error)
