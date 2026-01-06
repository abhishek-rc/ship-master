export default ({ env }) => ({
  // Deep Populate Plugin
  'deep-populate': {
    enabled: true,
    config: {
      useCache: true,        // caches queries
      replaceWildcard: true, // allows populate=*
    },
  },

  // Color Picker Plugin
  'color-picker': {
    enabled: true,
  },

  // Offline Sync Plugin
  'offline-sync': {
    enabled: true,
    resolve: './src/plugins/offline-sync',
    config: {
      mode: env('SYNC_MODE', 'replica'),
      shipId: env('SYNC_SHIP_ID'),
      kafka: {
        brokers: env('KAFKA_BROKERS', 'localhost:9092').split(','),
        ssl: env.bool('KAFKA_SSL_ENABLED', false),
        sasl: {
          mechanism: env('KAFKA_SASL_MECHANISM'),
          username: env('KAFKA_SASL_USERNAME'),
          password: env('KAFKA_SASL_PASSWORD'),
        },
        topics: {
          shipUpdates: env('KAFKA_TOPIC_SHIP_UPDATES', 'ship-updates'),
          masterUpdates: env('KAFKA_TOPIC_MASTER_UPDATES', 'master-updates'),
        },
      },
      sync: {
        batchSize: env.int('SYNC_BATCH_SIZE', 100),
        retryAttempts: env.int('SYNC_RETRY_ATTEMPTS', 3),
        retryDelay: env.int('SYNC_RETRY_DELAY', 5000),
        connectivityCheckInterval: env.int('SYNC_CONNECTIVITY_CHECK_INTERVAL', 30000),
        debounceMs: env.int('SYNC_DEBOUNCE_MS', 1000), // Debounce instant push (prevents spam)
      },
      contentTypes: env('SYNC_CONTENT_TYPES', '').split(',').filter(Boolean),
    },
  },


  // Upload Plugin (works for BOTH local + OSS)
  upload: {
    config: {
      // 🔴 Windows EPERM fix: disable ALL image processing
      sizeOptimization: false,
      responsiveDimensions: false,
      breakpoints: {},

      provider: env.bool('OSS_ENABLED', false)
        ? 'strapi-provider-upload-oss'
        : 'local',

      providerOptions: env.bool('OSS_ENABLED', false)
        ? {
          accessKeyId: env('OSS_ACCESS_KEY_ID'),
          accessKeySecret: env('OSS_ACCESS_KEY_SECRET'),
          region: env('OSS_REGION'),
          bucket: env('OSS_BUCKET'),
          uploadPath: env('OSS_UPLOAD_PATH', 'strapi-uploads'),
          baseUrl: env('OSS_BASE_URL'),
          timeout: env.int('OSS_TIMEOUT', 60000),
        }
        : {},

      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
});