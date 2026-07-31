import { useRouteError } from 'react-router-dom';

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected route error occurred.';
}

export function RouteErrorPage() {
  const error = useRouteError();

  const reloadFreshDocument = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('_desktop_reload', Date.now().toString());
    window.location.replace(url.toString());
  };

  return (
    <main className="app-error" role="alert">
      <h1>Dashboard failed to load</h1>
      <p>{errorMessage(error)}</p>
      <button type="button" onClick={reloadFreshDocument}>
        Reload
      </button>
    </main>
  );
}
