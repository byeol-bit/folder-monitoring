module.exports = {
  apps: [{
    name: 'transfer-script',
    script: './run-transfer.sh',
    cwd: './',
    interpreter: '/bin/bash',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    },
    cron_restart: '*/5 * * * *',  // 5분마다 재시작
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
}; 