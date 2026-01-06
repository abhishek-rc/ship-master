export default ({ strapi }: { strapi: any }) => {
  let isOnline = false;
  let checkInterval: NodeJS.Timeout | null = null;

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
     * Check connectivity to master
     */
    async checkConnectivity(): Promise<{ isOnline: boolean; error?: string }> {
      // In Strapi 5, use strapi.config.get with plugin:: namespace
      const config = strapi.config.get('plugin::offline-sync', {});
      
      if (config.mode !== 'replica') {
        return { isOnline: true };
      }

      try {
        const kafkaProducer = strapi.plugin('offline-sync').service('kafka-producer');
        
        // First, try to connect if not connected
        if (!kafkaProducer.isConnected()) {
          await kafkaProducer.connect();
        }
        
        // Then do an actual health check to verify broker is reachable
        const healthy = await kafkaProducer.healthCheck();
        isOnline = healthy;
        
        return { isOnline };
      } catch (error: any) {
        isOnline = false;
        return { isOnline: false, error: error.message };
      }
    },

    /**
     * Get current connectivity status
     */
    isConnected(): boolean {
      return isOnline;
    },
  };
};

