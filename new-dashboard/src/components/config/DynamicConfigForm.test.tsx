import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { ConfigGroup, ConfigRichText } from './DynamicConfigForm';

const i18n = i18next.createInstance();
void i18n.init({ initAsync: false, lng: 'en', resources: { en: { translation: {} } } });

describe('DynamicConfigForm', () => {
  it('renders schema-backed objects as nested configuration sections', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ConfigGroup
          fieldsFromValue
          metadata={{
            type: 'object',
            items: {
              gm_safety_settings: {
                description: 'Safety filters',
                type: 'object',
                items: {
                  harassment: {
                    description: 'Harassment',
                    options: ['BLOCK_NONE', 'BLOCK_MEDIUM_AND_ABOVE'],
                    type: 'string',
                  },
                },
              },
            },
          }}
          onChange={() => undefined}
          translationPath="provider"
          value={{ gm_safety_settings: { harassment: 'BLOCK_MEDIUM_AND_ABOVE' } }}
          variant="inline"
        />
      </I18nextProvider>,
    );

    expect(markup).toContain('dynamic-config__nested');
    expect(markup).toContain('Safety filters');
    expect(markup).toContain('Harassment');
    expect(markup).toContain('BLOCK_MEDIUM_AND_ABOVE');
    expect(markup).not.toContain('dynamic-object__manage');
  });

  it('renders the embedding dimension detector for special metadata', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ConfigGroup
          fieldsFromValue
          metadata={{
            type: 'object',
            items: {
              embedding_dimensions: {
                _special: 'get_embedding_dim',
                description: 'Embedding dimensions',
                type: 'int',
              },
            },
          }}
          onChange={() => undefined}
          onGetEmbeddingDimension={() => undefined}
          translationPath="provider"
          value={{ embedding_dimensions: 768 }}
          variant="inline"
        />
      </I18nextProvider>,
    );

    expect(markup).toContain('dynamic-config__embedding-dimension');
    expect(markup).toContain('type="number"');
    expect(markup).toContain('768');
  });

  it('renders provider-owned hints as an information alert instead of a field', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ConfigGroup
          fieldsFromValue
          metadata={{
            type: 'object',
            items: {
              id: { description: 'ID', type: 'string' },
            },
          }}
          onChange={() => undefined}
          showValueHint
          translationPath="provider"
          value={{
            hint: 'API Key from https://elevenlabs.io/app/settings/api-keys',
            id: 'elevenlabs_tts',
          }}
          variant="inline"
        />
      </I18nextProvider>,
    );

    expect(markup).toContain('dynamic-config__value-hint');
    expect(markup).toContain('href="https://elevenlabs.io/app/settings/api-keys"');
    expect(markup).toContain('elevenlabs_tts');
    expect(markup).not.toContain('config-provider-hint');
  });

  it('renders markdown and bare URL links as anchors', () => {
    const markup = renderToStaticMarkup(
      <ConfigRichText>
        {'查看 [时区列表](https://data.iana.org/time-zones/tzdb-2021a/zone1970.tab)，或访问 https://docs.astrbot.app/'}
      </ConfigRichText>,
    );

    expect(markup).toContain('href="https://data.iana.org/time-zones/tzdb-2021a/zone1970.tab"');
    expect(markup).toContain('>时区列表</a>');
    expect(markup).toContain('href="https://docs.astrbot.app/"');
  });
});
