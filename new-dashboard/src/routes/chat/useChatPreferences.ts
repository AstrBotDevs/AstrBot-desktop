import { useEffect, useState } from 'react';

export type TransportMode = 'sse' | 'websocket';
export type SettingsSubmenu = 'transport' | 'language' | null;

export function useChatPreferences() {
  const [provider, setProvider] = useState(() => localStorage.getItem('selectedProvider') || '');
  const [model, setModel] = useState(() => localStorage.getItem('selectedProviderModel') || '');
  const [streaming, setStreaming] = useState(true);
  const [transportMode, setTransportMode] = useState<TransportMode>(() => localStorage.getItem('chat.transportMode') === 'websocket' ? 'websocket' : 'sse');
  const [settingsSubmenu, setSettingsSubmenu] = useState<SettingsSubmenu>(null);

  useEffect(() => { localStorage.setItem('selectedProvider', provider); }, [provider]);
  useEffect(() => { localStorage.setItem('selectedProviderModel', model); }, [model]);
  useEffect(() => { localStorage.setItem('chat.transportMode', transportMode); }, [transportMode]);

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
