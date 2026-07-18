import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';

import { RequireAuth } from '@/auth/RequireAuth';
import { routeLayout, routeManifest, type RouteLayout } from '@/routes/routeManifest';
import { NotFoundPage } from '@/routes/NotFoundPage';
import { BlankLayout } from '@/layouts/blank/BlankLayout';
import { FullLayout } from '@/layouts/full/FullLayout';
import { coreRouteModuleLoaders } from '@/app/coreRouteModules';

const LoginPage = lazy(() => import('@/routes/auth/LoginPage'));
const SetupPage = lazy(() => import('@/routes/auth/SetupPage'));
const WelcomePage = lazy(() => import('@/routes/welcome/WelcomePage'));
const AboutPage = lazy(() => import('@/routes/about/AboutPage'));
const StatsPage = lazy(() => import('@/routes/monitoring/StatsPage'));
const ConsolePage = lazy(() => import('@/routes/monitoring/ConsolePage'));
const TracePage = lazy(() => import('@/routes/monitoring/TracePage'));
const ConversationPage = lazy(() => import('@/routes/monitoring/ConversationPage'));
const PlatformPage = lazy(() => import('@/routes/configuration/PlatformPage'));
const ConfigPage = lazy(() => import('@/routes/configuration/ConfigPage'));
const SettingsPage = lazy(() => import('@/routes/configuration/SettingsPage'));
const PersonaPage = lazy(() => import('@/routes/configuration/PersonaPage'));
const SubagentPage = lazy(() => import('@/routes/configuration/SubagentPage'));
const CronPage = lazy(() => import('@/routes/configuration/CronPage'));
const PluginPage = lazy(() => import('@/routes/extensions/PluginPage'));
const KnowledgeBaseDetailPage = lazy(() => import('@/routes/knowledge/KnowledgeBaseDetailPage'));
const DocumentDetailPage = lazy(() => import('@/routes/knowledge/DocumentDetailPage'));

const ChatPage = lazy(coreRouteModuleLoaders['/chat']);
const ExtensionPage = lazy(coreRouteModuleLoaders['/extension']);
const KnowledgeBaseListPage = lazy(coreRouteModuleLoaders['/knowledge-base']);
const ProviderPage = lazy(coreRouteModuleLoaders['/providers']);
const SessionManagementPage = lazy(coreRouteModuleLoaders['/session-management']);

function RouteLoading() {
  const { t } = useTranslation();
  return (
    <div className="route-loading" role="status">
      {t('core.common.loading')}
    </div>
  );
}

function loading(element: React.ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

const reactRouteElements: Partial<Record<string, React.ReactNode>> = {
  '/': <Navigate replace to="/welcome" />,
  '/main': <Navigate replace to="/welcome" />,
  '/auth/login': loading(<LoginPage />),
  '/auth/setup': loading(<SetupPage />),
  '/welcome': loading(<WelcomePage />),
  '/about': loading(<AboutPage />),
  '/dashboard/default': loading(<StatsPage />),
  '/console': loading(<ConsolePage />),
  '/trace': loading(<TracePage />),
  '/conversation': loading(<ConversationPage />),
  '/session-management': loading(<SessionManagementPage />),
  '/platforms': loading(<PlatformPage />),
  '/providers': loading(<ProviderPage />),
  '/config': loading(<ConfigPage />),
  '/normal': <Navigate replace to="/config" />,
  '/system': <Navigate replace to="/settings#system-config" />,
  '/settings': loading(<SettingsPage />),
  '/persona': loading(<PersonaPage />),
  '/subagent': loading(<SubagentPage />),
  '/cron': loading(<CronPage />),
  '/extension': loading(<ExtensionPage />),
  '/extension/:pluginId': loading(<ExtensionPage />),
  '/extension-marketplace': loading(<ExtensionPage />),
  '/plugin-page/:pluginName/:pageName': loading(<PluginPage />),
  '/knowledge-base': loading(<KnowledgeBaseListPage />),
  '/knowledge-base/:kbId': loading(<KnowledgeBaseDetailPage />),
  '/knowledge-base/:kbId/document/:docId': loading(<DocumentDetailPage />),
  '/alkaid/knowledge-base': loading(<KnowledgeBaseListPage />),
  '/chat': loading(<ChatPage />),
  '/chat/:conversationId': loading(<ChatPage />),
  '/chatbox': loading(<ChatPage chatbox />),
  '/chatbox/:conversationId': loading(<ChatPage chatbox />),
};

function resolveReactRoute(path: string) {
  const element = reactRouteElements[path];
  return element ?? <UnregisteredReactRoute path={path} />;
}

function UnregisteredReactRoute({ path }: { path: string }): never {
  throw new Error(`React route is not registered: ${path}`);
}

function routesForLayout(layout: RouteLayout) {
  return routeManifest
    .filter((route) => routeLayout(route.path) === layout)
    .map((route) => ({ path: route.path, element: resolveReactRoute(route.path) }));
}

const router = createHashRouter([
  {
    element: <BlankLayout />,
    children: routesForLayout('public-blank'),
  },
  {
    element: (
      <RequireAuth>
        <BlankLayout />
      </RequireAuth>
    ),
    children: routesForLayout('protected-blank'),
  },
  {
    element: (
      <RequireAuth>
        <FullLayout />
      </RequireAuth>
    ),
    children: [...routesForLayout('protected-full'), { path: '*', element: <NotFoundPage /> }],
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
