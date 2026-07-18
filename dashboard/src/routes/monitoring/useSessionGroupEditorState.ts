import { useState } from 'react';

import type { SessionGroup } from './sessionManagementModel';

export function useSessionGroupEditorState() {
  const [groupOpen, setGroupOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SessionGroup>({ id: '', name: '', umos: [] });
  const [groupMode, setGroupMode] = useState<'create' | 'edit'>('create');
  const [availableSearch, setAvailableSearch] = useState('');
  const [selectedSearch, setSelectedSearch] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);

  return {
    availableSearch,
    editingGroup,
    groupMode,
    groupOpen,
    savingGroup,
    selectedSearch,
    setAvailableSearch,
    setEditingGroup,
    setGroupMode,
    setGroupOpen,
    setSavingGroup,
    setSelectedSearch,
  };
}
