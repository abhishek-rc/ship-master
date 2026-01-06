import syncRoutes from './sync';
import conflictRoutes from './conflict';
import healthRoutes from './health';

export default {
  'content-api': {
    type: 'content-api',
    routes: [
      ...syncRoutes,
      ...conflictRoutes,
    ],
  },
  health: healthRoutes,
};

