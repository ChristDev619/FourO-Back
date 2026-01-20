module.exports = {
  apps: [
    {
      name: 'fouro-api',
      script: 'index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_file: './logs/api-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true
    },
    {
      name: 'recalculation-worker',
      script: 'worker/recalculationWorker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_file: './logs/worker-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      restart_delay: 4000,
      max_restarts: 10
    },
    {
      name: 'notification-worker',
      script: 'worker/notificationWorker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      error_file: './logs/notification-error.log',
      out_file: './logs/notification-out.log',
      log_file: './logs/notification-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      restart_delay: 4000,
      max_restarts: 10
    },
    {
      name: 'orphaned-programs-worker',
      script: 'worker/orphanedProgramsWorker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      error_file: './logs/orphaned-programs-error.log',
      out_file: './logs/orphaned-programs-out.log',
      log_file: './logs/orphaned-programs-combined.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      time: true,
      restart_delay: 4000,
      max_restarts: 10
    }
  ]
}; 