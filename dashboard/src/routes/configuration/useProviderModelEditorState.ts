import { useState } from 'react';

import type { JsonObject } from './model';

export type AvailableProviderModel = { metadata?: JsonObject; name: string };

export function useProviderModelEditorState() {
  const [availableModels, setAvailableModels] = useState<AvailableProviderModel[]>([]);
  const [availableMetadata, setAvailableMetadata] = useState<JsonObject>({});
  const [modelSearch, setModelSearch] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [manualModelOpen, setManualModelOpen] = useState(false);
  const [manualModelId, setManualModelId] = useState('');
  const [modelEditor, setModelEditor] = useState<JsonObject | null>(null);
  const [modelEditorOriginalId, setModelEditorOriginalId] = useState('');

  return {
    availableMetadata,
    availableModels,
    loadingModels,
    manualModelId,
    manualModelOpen,
    modelEditor,
    modelEditorOriginalId,
    modelSearch,
    setAvailableMetadata,
    setAvailableModels,
    setLoadingModels,
    setManualModelId,
    setManualModelOpen,
    setModelEditor,
    setModelEditorOriginalId,
    setModelSearch,
  };
}
