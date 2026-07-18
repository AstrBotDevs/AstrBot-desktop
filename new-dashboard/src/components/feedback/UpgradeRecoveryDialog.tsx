import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authApi } from '@/api/auth';
import { statsApi } from '@/api/compat';
import {
  getLegacyStartTime,
  normalizeVersion,
  restartPollDecision,
  restartLegacyCore,
  UPGRADE_RECOVERY_EVENT,
  UPGRADE_RECOVERY_TOKEN_KEY,
  type UpgradeRecoveryDetail,
  versionsMismatch,
} from '@/auth/upgradeRecovery';
import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';

const MAX_RESTART_ATTEMPTS = 90;

function displayVersion(version?: string) {
  const normalized = normalizeVersion(version);
  return normalized ? `v${normalized}` : 'unknown';
}

export function UpgradeRecoveryDialog() {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<UpgradeRecoveryDetail | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [status, setStatus] = useState('');
  const initialStartTime = useRef<number | string | null>(null);
  const timer = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current != null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback(async (next: UpgradeRecoveryDetail) => {
    if (!versionsMismatch(next.version, next.dashboard_version)) return;
    const dismissKey = `astrbot-upgrade-recovery-dismissed:${displayVersion(next.version)}:${displayVersion(next.dashboard_version)}`;
    if (!next.blocking && sessionStorage.getItem(dismissKey)) return;
    initialStartTime.current = await getLegacyStartTime().catch(() => null);
    setDetail(next);
  }, []);

  useEffect(() => {
    const handle = (event: Event) => {
      void show((event as CustomEvent<UpgradeRecoveryDetail>).detail ?? {});
    };
    window.addEventListener(UPGRADE_RECOVERY_EVENT, handle);
    void authApi.setupStatus()
      .then(async (response) => {
        if (!response.legacyFallback) return;
        const versionResponse = await statsApi.version();
        await show(versionResponse.data.data ?? {});
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener(UPGRADE_RECOVERY_EVENT, handle);
      stopTimer();
    };
  }, [show, stopTimer]);

  const dismiss = () => {
    if (!detail || detail.blocking || restarting) return;
    sessionStorage.setItem(
      `astrbot-upgrade-recovery-dismissed:${displayVersion(detail.version)}:${displayVersion(detail.dashboard_version)}`,
      '1',
    );
    sessionStorage.removeItem(UPGRADE_RECOVERY_TOKEN_KEY);
    setDetail(null);
  };

  const restart = async () => {
    setRestarting(true);
    setStatus(t('core.common.upgradeRecovery.restarting'));
    try {
      initialStartTime.current = initialStartTime.current ?? await getLegacyStartTime();
      await restartLegacyCore();
      setStatus(t('core.common.upgradeRecovery.waiting'));
      let attempts = 0;
      stopTimer();
      timer.current = window.setInterval(() => {
        attempts += 1;
        void getLegacyStartTime().then((next) => {
          const decision = restartPollDecision(
            initialStartTime.current,
            next,
            attempts,
            MAX_RESTART_ATTEMPTS,
          );
          if (decision === 'reloaded') {
            stopTimer();
            sessionStorage.removeItem(UPGRADE_RECOVERY_TOKEN_KEY);
            const url = new URL(window.location.href);
            url.searchParams.set('_r', Date.now().toString());
            window.location.replace(url.toString());
          } else if (decision === 'timeout') {
            stopTimer();
            setRestarting(false);
              setStatus(t('core.common.upgradeRecovery.failed'));
            }
          }).catch(() => {
            if (restartPollDecision(initialStartTime.current, null, attempts, MAX_RESTART_ATTEMPTS) === 'timeout') {
              stopTimer();
              setRestarting(false);
              setStatus(t('core.common.upgradeRecovery.failed'));
            }
          });
        }, 1000);
    } catch {
      setRestarting(false);
      setStatus(t('core.common.upgradeRecovery.failed'));
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => { if (!open) dismiss(); }}
      open={detail !== null}
      title={t('core.common.upgradeRecovery.title')}
    >
      <div className="upgrade-recovery-dialog">
        <p>{t('core.common.upgradeRecovery.description', {
          coreVersion: displayVersion(detail?.version),
          dashboardVersion: displayVersion(detail?.dashboard_version),
        })}</p>
        <div className="auth-warning"><MdiIcon name="mdi-alert" />{t('core.common.upgradeRecovery.hint')}</div>
        {restarting && <progress />}
        {status && <p aria-live="polite">{status}</p>}
        <DialogActions>
          {!detail?.blocking && <Button disabled={restarting} onClick={dismiss}>{t('core.common.upgradeRecovery.laterButton')}</Button>}
          <Button disabled={restarting} onClick={() => void restart()} variant="primary">
            <MdiIcon name="mdi-restart" />{t('core.common.upgradeRecovery.restartButton')}
          </Button>
        </DialogActions>
      </div>
    </Dialog>
  );
}
