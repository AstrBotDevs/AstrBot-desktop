export function headerUpdateRuntime(isDesktop: boolean) {
  return isDesktop ? 'desktop' : 'web';
}

export async function runHeaderUpdateAction(
  isDesktop: boolean,
  desktopAction: () => Promise<unknown>,
  webAction: () => Promise<unknown>,
) {
  return headerUpdateRuntime(isDesktop) === 'desktop' ? desktopAction() : webAction();
}
