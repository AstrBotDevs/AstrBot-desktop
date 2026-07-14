import { createHashRouter, RouterProvider } from 'react-router-dom';

import { LegacyFallback } from '@/routes/LegacyFallback';
import { routeMigrationManifest } from '@/routes/migrationManifest';

const manifestRoutes = routeMigrationManifest.map((route) => ({
  path: route.path,
  element: route.runtime === 'legacy'
    ? <LegacyFallback />
    : <p>React route not registered: {route.path}</p>,
}));

const router = createHashRouter([
  ...manifestRoutes,
  {
    path: '*',
    element: <LegacyFallback />,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
