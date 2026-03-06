const VALID_MODES = new Set(['version', 'webui', 'backend', 'all']);

export const runModeTasks = async (mode, { prepareWebui, prepareBackend }) => {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unsupported mode: ${mode}. Expected version/webui/backend/all.`);
  }

  if (mode === 'version') {
    return;
  }

  if (mode === 'webui') {
    await prepareWebui();
    return;
  }

  if (mode === 'backend') {
    await prepareBackend();
    return;
  }

  await prepareWebui();
  await prepareBackend();
};
