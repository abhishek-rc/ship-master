export default {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      default: true,
    },
    mode: {
      type: 'string',
      enum: ['master', 'replica'],
      default: 'replica',
    },
    shipId: {
      type: 'string',
      nullable: true,
    },
    kafka: {
      type: 'object',
      properties: {
        brokers: {
          type: 'array',
          items: { type: 'string' },
        },
        ssl: { type: 'boolean' },
        sasl: {
          type: 'object',
          properties: {
            mechanism: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' },
          },
        },
        topics: {
          type: 'object',
          properties: {
            shipUpdates: { type: 'string' },
            masterUpdates: { type: 'string' },
          },
        },
      },
    },
    sync: {
      type: 'object',
      properties: {
        batchSize: { type: 'integer', default: 100 },
        retryAttempts: { type: 'integer', default: 3 },
        retryDelay: { type: 'integer', default: 5000 },
        connectivityCheckInterval: { type: 'integer', default: 30000 },
      },
    },
    contentTypes: {
      type: 'array',
      items: { type: 'string' },
      default: [],
    },
  },
};

