import { useEffect, useState } from 'react';

import { chatTransportPreference, selectedModelPreference, selectedProviderPreference } from '@/config/preferences';

export type TransportMode = 'sse' | 'websocket';

export function useChatPreferences() {
  const [provider, setProvider] = useState(() => selectedProviderPreference.read());
  const [model, setModel] = useState(() => selectedModelPreference.read());
  const [streaming, setStreaming] = useState(true);
  const [transportMode] = useState<TransportMode>(() => chatTransportPreference.read());

  useEffect(() => {
    selectedProviderPreference.write(provider);
  }, [provider]);
  useEffect(() => {
    selectedModelPreference.write(model);
  }, [model]);
  return {
    model,
    provider,
    setModel,
    setProvider,
    setStreaming,
    streaming,
    transportMode,
  };
}
