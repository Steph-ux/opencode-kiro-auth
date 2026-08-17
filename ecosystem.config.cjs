module.exports = {
  apps: [
    {
      name: "kiro-proxy",
      script: "server.mjs",
      cwd: "C:\\Users\\stephanea\\.config\\opencode\\kiro-proxy",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
}
