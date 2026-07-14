import { useEffect } from 'react';

import { useMigrationRuntimeStore } from '@/stores/migrationRuntime';

export const LEGACY_ENTRY_URL = '/legacy/index.html';

export async function fetchLegacyDocument(signal?: AbortSignal) {
  const response = await fetch(LEGACY_ENTRY_URL, { signal });
  if (!response.ok) {
    throw new Error(`Failed to load legacy dashboard: ${response.status}`);
  }
  return response.text();
}

export function replaceCurrentDocument(html: string) {
  document.open();
  document.write(html);
  document.close();
}

export function LegacyFallback() {
  const error = useMigrationRuntimeStore((state) => state.error);
  const setLegacyError = useMigrationRuntimeStore((state) => state.setLegacyError);
  const setLegacyReady = useMigrationRuntimeStore((state) => state.setLegacyReady);
  const startLegacyLoad = useMigrationRuntimeStore((state) => state.startLegacyLoad);

  useEffect(() => {
    const controller = new AbortController();
    startLegacyLoad(window.location.hash);

    fetchLegacyDocument(controller.signal)
      .then((html) => {
        setLegacyReady();
        replaceCurrentDocument(html);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
        setLegacyError(loadError instanceof Error ? loadError.message : String(loadError));
      });

    return () => controller.abort();
  }, [setLegacyError, setLegacyReady, startLegacyLoad]);

  return (
    <main className="dashboard-bootstrap" role="status" aria-live="polite">
      {error ? (
        <div className="dashboard-bootstrap__error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      ) : null}
    </main>
  );
}
