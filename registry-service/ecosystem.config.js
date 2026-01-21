module.exports = {
  apps: [{
    name: 'agent-bus-registry',
    script: 'server.js',
    interpreter: 'bun',
    env: {
      NODE_ENV: 'production',
      PORT: 3456
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
