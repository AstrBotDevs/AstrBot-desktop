import { useEffect } from 'react';

export default function App() {
  useEffect(() => {
    const controller = new AbortController();

    fetch('/legacy/index.html', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load legacy dashboard: ${response.status}`);
        return response.text();
      })
      .then((html) => {
        document.open();
        document.write(html);
        document.close();
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error(error);
      });

    return () => controller.abort();
  }, []);

  return <div role="status" aria-live="polite" className="dashboard-bootstrap" />;
}
