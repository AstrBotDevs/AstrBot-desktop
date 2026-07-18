import { AppErrorBoundary } from '@/app/AppErrorBoundary';
import { AppProviders } from '@/app/AppProviders';
import { AppRouter } from '@/app/AppRouter';

export default function App() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </AppErrorBoundary>
  );
}
