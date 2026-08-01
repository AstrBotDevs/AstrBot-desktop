import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectMenu } from '@/components/ui/SelectMenu';
import { chatTransportPreference } from '@/config/preferences';

type ChatTransportMode = 'sse' | 'websocket';

export function ChatTransportSetting() {
  const { t } = useTranslation();
  const prefix = 'features.settings.chat.transport';
  const [mode, setMode] = useState<ChatTransportMode>(() => chatTransportPreference.read());

  const changeMode = (value: string) => {
    if (value !== 'sse' && value !== 'websocket') return;
    chatTransportPreference.write(value);
    setMode(value);
  };

  return (
    <section className="settings-list-card route-card">
      <div className="settings-item">
        <div>
          <h2>{t(`${prefix}.title`)}</h2>
          <p>{t(`${prefix}.subtitle`)}</p>
        </div>
        <div className="settings-item__control settings-transport-control">
          <SelectMenu
            ariaLabel={t(`${prefix}.title`)}
            onChange={changeMode}
            options={(['sse', 'websocket'] as const).map((value) => ({
              id: value,
              name: t(`${prefix}.${value}`),
            }))}
            placeholder={t(`${prefix}.title`)}
            value={mode}
          />
        </div>
      </div>
    </section>
  );
}
