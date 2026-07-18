import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getFirstNotice } from '@/api/openapi';
import { Markdown } from '@/components/content/Markdown';
import { Dialog } from '@/components/headless/Dialog';
import { Button } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { responseData, type JsonObject } from '@/routes/configuration/model';

export const FIRST_NOTICE_SEEN_KEY = 'astrbot:first_notice_seen:v1';

export function firstNoticeContent(data: JsonObject | undefined) {
  return typeof data?.content === 'string' ? data.content.trim() : '';
}

export function FirstNoticeDialog() {
  const { i18n, t } = useTranslation();
  const [content, setContent] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(FIRST_NOTICE_SEEN_KEY) === '1') return;
    let active = true;
    void getFirstNotice({ query: { locale: i18n.resolvedLanguage } })
      .then((response) => {
        if (!active) return;
        const data = responseData<JsonObject>(response);
        const next = firstNoticeContent(data);
        if (!next) {
          localStorage.setItem(FIRST_NOTICE_SEEN_KEY, '1');
          return;
        }
        setContent(next);
        setOpen(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [i18n.resolvedLanguage]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) localStorage.setItem(FIRST_NOTICE_SEEN_KEY, '1');
  };

  return (
    <Dialog
      onOpenChange={changeOpen}
      open={open}
      title={t('core.common.firstNotice.title')}
    >
      <div className="first-notice-dialog">
        {content
          ? <Markdown content={content} />
          : <p>{t('core.common.firstNotice.empty.subtitle')}</p>}
        <DialogActions>
          <Button onClick={() => changeOpen(false)} variant="primary">
            {t('core.common.confirm')}
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}
