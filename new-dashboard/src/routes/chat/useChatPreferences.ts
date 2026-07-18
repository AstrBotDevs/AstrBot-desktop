import { useEffect, useState } from 'react';

import { chatTransportPreference, selectedModelPreference, selectedProviderPreference } from '@/config/preferences';

export type TransportMode = 'sse' | 'websocket';
export type SettingsSubmenu = 'transport' | 'language' | null;

export function useChatPreferences() {
  const [provider, setProvider] = useState(() => selectedProviderPreference.read());
  const [model, setModel] = useState(() => selectedModelPreference.read());
  const [streaming, setStreaming] = useState(true);
  const [transportMode, setTransportMode] = useState<TransportMode>(() => chatTransportPreference.read());
  const [settingsSubmenu, setSettingsSubmenu] = useState<SettingsSubmenu>(null);

  useEffect(() => {
    selectedProviderPreference.write(provider);
  }, [provider]);
  useEffect(() => {
    selectedModelPreference.write(model);
  }, [model]);
  useEffect(() => {
    chatTransportPreference.write(transportMode);
  }, [transportMode]);

  return {
    model,
    provider,
    setModel,
    setProvider,
    setSettingsSubmenu,
    setStreaming,
    setTransportMode,
    settingsSubmenu,
    streaming,
    transportMode,
  };
}
