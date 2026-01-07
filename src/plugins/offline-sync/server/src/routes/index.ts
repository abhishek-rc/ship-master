import syncRoutes from './sync';
import conflictRoutes from './conflict';
import healthRoutes from './health';
import initialSyncRoutes from './initial-sync';

export default {
  'content-api': {
    type: 'content-api',
    routes: [
      ...syncRoutes,
      ...conflictRoutes,
      ...initialSyncRoutes,
    ],
  },
  health: healthRoutes,
};

