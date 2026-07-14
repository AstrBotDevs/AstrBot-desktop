import { createHashRouter, RouterProvider } from 'react-router-dom';

import { RequireAuth } from '@/auth/RequireAuth';
import { LegacyFallback } from '@/routes/LegacyFallback';
import { routeMigrationManifest, routeRequiresAuth } from '@/routes/migrationManifest';
import { NotFoundPage } from '@/routes/NotFoundPage';

const reactRouteElements: Partial<Record<string, React.ReactNode>> = {};

function resolveReactRoute(path: string) {
  const element = reactRouteElements[path];
  return element ?? <UnregisteredReactRoute path={path} />;
}

function UnregisteredReactRoute({ path }: { path: string }): never {
  throw new Error(`React route is not registered: ${path}`);
}

const manifestRoutes = routeMigrationManifest.map((route) => ({
  path: route.path,
  element: route.runtime === 'legacy'
    ? <LegacyFallback />
    : routeRequiresAuth(route.path)
      ? <RequireAuth>{resolveReactRoute(route.path)}</RequireAuth>
      : resolveReactRoute(route.path),
}));

const router = createHashRouter([
  ...manifestRoutes,
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
