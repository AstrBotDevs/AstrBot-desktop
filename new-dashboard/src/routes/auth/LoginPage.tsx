import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { authApi } from '@/api/auth';
import { publicApi, type PublicVersionData } from '@/api/compat';
import { externalLinks } from '@/config/links';
import {
  formatRecoveryCode,
  isRecoveryCodeComplete,
  requireAuthSession,
  requiresTotp,
  type LoginStage,
} from '@/auth/authFlow';
import { checkOnboardingCompleted } from '@/auth/sessionFlow';
import { dispatchUpgradeRecovery, legacyUpgradeDetail } from '@/auth/upgradeRecovery';
import { createLoginSchema } from '@/forms/authSchemas';
import { useAuthStore } from '@/stores/auth';
import { AuthShell } from './AuthShell';

type AccountValues = { password: string; username: string };

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const completeSession = useAuthStore((state) => state.completeSession);
  const hasToken = useAuthStore((state) => state.hasToken);
  const setReturnUrl = useAuthStore((state) => state.setReturnUrl);
  const [stage, setStage] = useState<LoginStage>('account');
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [submittingCode, setSubmittingCode] = useState(false);
  const [apiError, setApiError] = useState('');
  const [versions, setVersions] = useState<PublicVersionData | null>(null);
  const schema = createLoginSchema((key) => t(`features.auth.setup.validation.${key}`));
  const form = useForm<AccountValues>({
    defaultValues: { password: '', username: '' },
    resolver: yupResolver(schema),
  });

  useEffect(() => {
    const redirect = searchParams.get('redirect');
    if (redirect) setReturnUrl(redirect);
    if (hasToken) {
      void checkOnboardingCompleted().then((complete) =>
        navigate(complete ? '/dashboard/default' : '/welcome', { replace: true }),
      );
      return;
    }
    void authApi
      .setupStatus()
      .then((response) => {
        const status = response.data.data;
        if (status?.setup_required && status.skip_default_password_auth) {
          void navigate('/auth/setup', { replace: true });
        }
      })
      .catch(() => undefined);
  }, [hasToken, navigate, searchParams, setReturnUrl]);

  useEffect(() => {
    let active = true;
    void publicApi
      .versions()
      .then((response) => {
        if (active) setVersions(response.data.data ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const submitCredentials = async (values: AccountValues, challengeCode?: string) => {
    const response = await authApi.login({
      code: challengeCode,
      password: values.password,
      trust_device_flag: challengeCode ? trustDevice : undefined,
      username: values.username,
    });
    const recovery = await legacyUpgradeDetail(response);
    if (recovery) {
      dispatchUpgradeRecovery(recovery, response.data.data?.token);
      return;
    }
    await completeSession(requireAuthSession(response), navigate);
  };

  const submitAccount = form.handleSubmit(async (values) => {
    setApiError('');
    try {
      await submitCredentials(values);
    } catch (cause) {
      if (requiresTotp(cause)) {
        setStage('totp');
        setCode('');
      } else setApiError(cause instanceof Error ? cause.message : String(cause));
    }
  });

  const submitCode = async () => {
    setSubmittingCode(true);
    setApiError('');
    try {
      await submitCredentials(form.getValues(), code);
    } catch (cause) {
      setApiError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmittingCode(false);
    }
  };

  const title = stage === 'account' ? t('features.auth.logo.title') : t('features.auth.logo.totpTitle');
  return (
    <AuthShell subtitle={stage === 'account' ? t('features.auth.logo.subtitle') : ''} title={title}>
      {stage === 'account' ? (
        <form className="auth-form" onSubmit={submitAccount}>
          <label>
            {t('features.auth.username')}
            <input autoComplete="username" {...form.register('username')} />
          </label>
          {form.formState.errors.username && <p className="field-error">{form.formState.errors.username.message}</p>}
          <label>
            {t('features.auth.password')}
            <input autoComplete="current-password" type="password" {...form.register('password')} />
          </label>
          {form.formState.errors.password && <p className="field-error">{form.formState.errors.password.message}</p>}
          <small>{t('features.auth.defaultHint')}</small>
          <button className="button--primary auth-form__submit" disabled={form.formState.isSubmitting} type="submit">
            {form.formState.isSubmitting ? '…' : t('features.auth.login')}
          </button>
        </form>
      ) : (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCode();
          }}
        >
          <div className="auth-stage-header">
            <strong>{form.getValues('username')}</strong>
            <button onClick={() => setStage('account')} type="button">
              {t('features.auth.setup.totp.back')}
            </button>
          </div>
          {stage === 'recovery' && <p className="auth-warning">{t('features.auth.recovery.totpDisableWarning')}</p>}
          <label>
            {t(stage === 'recovery' ? 'features.auth.recovery.code' : 'features.auth.totp.code')}
            <input
              autoComplete="one-time-code"
              inputMode={stage === 'totp' ? 'numeric' : 'text'}
              onChange={(event) =>
                setCode(stage === 'recovery' ? formatRecoveryCode(event.target.value) : event.target.value)
              }
              value={code}
            />
          </label>
          {stage === 'totp' && (
            <label className="auth-form__checkbox">
              <input checked={trustDevice} onChange={(event) => setTrustDevice(event.target.checked)} type="checkbox" />
              {t('features.auth.totp.trustDevice')}
            </label>
          )}
          <button
            className="button--primary auth-form__submit"
            disabled={submittingCode || !code || (stage === 'recovery' && !isRecoveryCodeComplete(code))}
            type="submit"
          >
            {t(stage === 'recovery' ? 'features.auth.recovery.submit' : 'features.auth.totp.verify')}
          </button>
          <button
            className="button--link"
            onClick={() => {
              setStage(stage === 'totp' ? 'recovery' : 'totp');
              setCode('');
            }}
            type="button"
          >
            {stage === 'totp' ? t('features.auth.recovery.useRecoveryCode') : t('features.auth.setup.totp.back')}
          </button>
        </form>
      )}
      {apiError && (
        <p className="auth-error" role="alert">
          {apiError}
        </p>
      )}
      {versions && <VersionStatus versions={versions} />}
    </AuthShell>
  );
}

function VersionStatus({ versions }: { versions: PublicVersionData }) {
  const { t } = useTranslation();
  const values = {
    code: String(versions.astrbot_code_version ?? '').trim(),
    runtime: String(versions.astrbot_version ?? '').trim(),
    webui: String(versions.webui_version ?? '').trim(),
  };
  const normalize = (value: string) => value.replace(/^v/i, '');
  const webMismatch = values.webui && values.runtime && normalize(values.webui) !== normalize(values.runtime);
  const runtimeMismatch = values.runtime && values.code && normalize(values.runtime) !== normalize(values.code);
  return (
    <div className="auth-versions">
      {values.webui && (
        <span>
          {t('features.auth.versions.webui')}: {values.webui}
        </span>
      )}
      {values.runtime && (
        <span>
          {t('features.auth.versions.astrbotRuntime')}: {values.runtime}
        </span>
      )}
      {runtimeMismatch && (
        <span>
          {t('features.auth.versions.astrbotCode')}: {values.code}
        </span>
      )}
      {(webMismatch || runtimeMismatch) && (
        <details>
          <summary>{t('features.auth.versions.mismatchTooltip')}</summary>
          {webMismatch && <p>{t('features.auth.versions.webuiMismatchMessage')}</p>}
          {runtimeMismatch && <p>{t('features.auth.versions.runtimeMismatchMessage')}</p>}
          <a href={externalLinks.docs.faq} rel="noreferrer" target="_blank">
            {t('features.auth.versions.faq')}
          </a>
        </details>
      )}
    </div>
  );
}
