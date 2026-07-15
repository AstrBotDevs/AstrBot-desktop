import { lazy, Suspense } from 'react';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';

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
const StatsPage = lazy(() => import('@/routes/monitoring/StatsPage'));
const ConsolePage = lazy(() => import('@/routes/monitoring/ConsolePage'));
const TracePage = lazy(() => import('@/routes/monitoring/TracePage'));
const ConversationPage = lazy(() => import('@/routes/monitoring/ConversationPage'));
const SessionManagementPage = lazy(() => import('@/routes/monitoring/SessionManagementPage'));
const PlatformPage = lazy(() => import('@/routes/configuration/PlatformPage'));
const ProviderPage = lazy(() => import('@/routes/configuration/ProviderPage'));
const ConfigPage = lazy(() => import('@/routes/configuration/ConfigPage'));
const SettingsPage = lazy(() => import('@/routes/configuration/SettingsPage'));
const PersonaPage = lazy(() => import('@/routes/configuration/PersonaPage'));
const SubagentPage = lazy(() => import('@/routes/configuration/SubagentPage'));
const CronPage = lazy(() => import('@/routes/configuration/CronPage'));
const ExtensionPage = lazy(() => import('@/routes/extensions/ExtensionPage'));
const PluginPage = lazy(() => import('@/routes/extensions/PluginPage'));
const KnowledgeBaseListPage = lazy(() => import('@/routes/knowledge/KnowledgeBaseListPage'));
const KnowledgeBaseDetailPage = lazy(() => import('@/routes/knowledge/KnowledgeBaseDetailPage'));
const DocumentDetailPage = lazy(() => import('@/routes/knowledge/DocumentDetailPage'));
const ChatPage = lazy(() => import('@/routes/chat/ChatPage'));

function loading(element: React.ReactNode) {
  return <Suspense fallback={<div className="route-loading" role="status">Loading…</div>}>{element}</Suspense>;
}

const reactRouteElements: Partial<Record<string, React.ReactNode>> = {
  '/auth/login': <BlankLayout>{loading(<LoginPage />)}</BlankLayout>,
  '/auth/setup': <BlankLayout>{loading(<SetupPage />)}</BlankLayout>,
  '/welcome': <FullLayout>{loading(<WelcomePage />)}</FullLayout>,
  '/about': <FullLayout>{loading(<AboutPage />)}</FullLayout>,
  '/dashboard/default': <FullLayout>{loading(<StatsPage />)}</FullLayout>,
  '/console': <FullLayout>{loading(<ConsolePage />)}</FullLayout>,
  '/trace': <FullLayout>{loading(<TracePage />)}</FullLayout>,
  '/conversation': <FullLayout>{loading(<ConversationPage />)}</FullLayout>,
  '/session-management': <FullLayout>{loading(<SessionManagementPage />)}</FullLayout>,
  '/platforms': <FullLayout>{loading(<PlatformPage />)}</FullLayout>,
  '/providers': <FullLayout>{loading(<ProviderPage />)}</FullLayout>,
  '/config': <FullLayout>{loading(<ConfigPage />)}</FullLayout>,
  '/normal': <Navigate replace to="/config" />,
  '/system': <Navigate replace to="/settings#system-config" />,
  '/settings': <FullLayout>{loading(<SettingsPage />)}</FullLayout>,
  '/persona': <FullLayout>{loading(<PersonaPage />)}</FullLayout>,
  '/subagent': <FullLayout>{loading(<SubagentPage />)}</FullLayout>,
  '/cron': <FullLayout>{loading(<CronPage />)}</FullLayout>,
  '/extension': <FullLayout>{loading(<ExtensionPage />)}</FullLayout>,
  '/extension/:pluginId': <FullLayout>{loading(<ExtensionPage />)}</FullLayout>,
  '/extension-marketplace': <FullLayout>{loading(<ExtensionPage />)}</FullLayout>,
  '/plugin-page/:pluginName/:pageName': <FullLayout>{loading(<PluginPage />)}</FullLayout>,
  '/knowledge-base': <FullLayout>{loading(<KnowledgeBaseListPage />)}</FullLayout>,
  '/knowledge-base/:kbId': <FullLayout>{loading(<KnowledgeBaseDetailPage />)}</FullLayout>,
  '/knowledge-base/:kbId/document/:docId': <FullLayout>{loading(<DocumentDetailPage />)}</FullLayout>,
  '/alkaid/knowledge-base': <FullLayout>{loading(<KnowledgeBaseListPage legacy />)}</FullLayout>,
  '/chat': <FullLayout>{loading(<ChatPage />)}</FullLayout>,
  '/chat/:conversationId': <FullLayout>{loading(<ChatPage />)}</FullLayout>,
  '/chatbox': <BlankLayout>{loading(<ChatPage chatbox />)}</BlankLayout>,
  '/chatbox/:conversationId': <BlankLayout>{loading(<ChatPage chatbox />)}</BlankLayout>,
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
