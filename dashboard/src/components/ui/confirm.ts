import { confirmAction, type ConfirmOptions } from '@/stores/feedback';

export type IntentConfirmOptions = Omit<ConfirmOptions, 'danger' | 'intent'>;

function confirmWithIntent(intent: 'destructive' | 'warning', options: IntentConfirmOptions | string) {
  return confirmAction(typeof options === 'string' ? { intent, message: options } : { ...options, intent });
}

export function confirmDestructiveAction(options: IntentConfirmOptions | string) {
  return confirmWithIntent('destructive', options);
}

export function confirmWarningAction(options: IntentConfirmOptions | string) {
  return confirmWithIntent('warning', options);
}
