import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { ConfigGroup } from './DynamicConfigForm';

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
});
