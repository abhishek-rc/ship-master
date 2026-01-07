export default ({ strapi }: { strapi: any }) => {
  let isOnline = false;
  let wasOnline = false; // Track previous state for detecting reconnection
  let checkInterval: NodeJS.Timeout | null = null;
  let onReconnectCallback: (() => void) | null = null;

  return {
    /**
     * Start connectivity monitoring
     */
    async startMonitoring(interval: number = 30000): Promise<void> {
      if (checkInterval) {
        clearInterval(checkInterval);
      }

      // Do an initial connectivity check immediately
      await this.checkConnectivity();

      checkInterval = setInterval(async () => {
        await this.checkConnectivity();
      }, interval);

      strapi.log.info('Connectivity monitoring started');
    },

    /**
     * Stop connectivity monitoring
     */
    stopMonitoring(): void {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    },

    /**
     * Register a callback to be called when connectivity is restored
     */
    onReconnect(callback: () => void): void {
      onReconnectCallback = callback;
    },

    /**
     * Check connectivity to master
     */
    async checkConnectivity(): Promise<{ isOnline: boolean; wasReconnected: boolean; error?: string }> {
      // In Strapi 5, use strapi.config.get with plugin:: namespace
      const config = strapi.config.get('plugin::offline-sync', {});

      if (config.mode !== 'replica') {
        return { isOnline: true, wasReconnected: false };
      }

      const previousState = isOnline;

      try {
        const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');

        // First, try to connect if not connected
        if (!kafkaProducer.isConnected()) {
          await kafkaProducer.connect();
        }

        // Then do an actual health check to verify broker is reachable
        const healthy = await kafkaProducer.healthCheck();
        isOnline = healthy;

        // Detect reconnection (was offline, now online)
        const wasReconnected = !wasOnline && isOnline;
        wasOnline = isOnline;

        // Call reconnect callback if we just reconnected
        if (wasReconnected && onReconnectCallback) {
          strapi.log.info('[Connectivity] 🔄 Reconnected to master!');
          try {
            onReconnectCallback();
          } catch (callbackError: any) {
            strapi.log.debug(`[Connectivity] Reconnect callback error: ${callbackError.message}`);
          }
        }

        return { isOnline, wasReconnected };
      } catch (error: any) {
        const wasReconnected = false;
        isOnline = false;
        wasOnline = false;
        return { isOnline: false, wasReconnected, error: error.message };
      }
    },

    /**
     * Get current connectivity status
     */
    isConnected(): boolean {
      return isOnline;
    },

    /**
     * Check if we recently reconnected
     */
    wasRecentlyOffline(): boolean {
      return !wasOnline && isOnline;
    },
  };
};

