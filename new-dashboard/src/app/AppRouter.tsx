import { lazy, Suspense } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';

import { RequireAuth } from '@/auth/RequireAuth';
import { LegacyFallback } from '@/routes/LegacyFallback';
import { routeMigrationManifest, routeRequiresAuth } from '@/routes/migrationManifest';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { BlankLayout } from '@/layouts/blank/BlankLayout';
import { FullLayout } from '@/layouts/full/FullLayout';

const LoginPage = lazy(() => import('@/routes/auth/LoginPage'));
const SetupPage = lazy(() => import('@/routes/auth/SetupPage'));
const WelcomePage = lazy(() => import('@/routes/welcome/WelcomePage'));
const AboutPage = lazy(() => import('@/routes/about/AboutPage'));

function loading(element: React.ReactNode) {
  return <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>{element}</Suspense>;
}

const reactRouteElements: Partial<Record<string, React.ReactNode>> = {
  '/auth/login': <BlankLayout>{loading(<LoginPage />)}</BlankLayout>,
  '/auth/setup': <BlankLayout>{loading(<SetupPage />)}</BlankLayout>,
  '/welcome': <FullLayout>{loading(<WelcomePage />)}</FullLayout>,
  '/about': <FullLayout>{loading(<AboutPage />)}</FullLayout>,
};

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
