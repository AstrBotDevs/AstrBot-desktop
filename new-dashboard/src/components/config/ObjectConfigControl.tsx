import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { toast } from '@/stores/feedback';
import {
  isConfigRecord,
  type ConfigItemMetadata,
  type ConfigRecord,
} from './configFormModel';

type ObjectValueType = 'boolean' | 'json' | 'number' | 'string';
type ObjectPair = { id: number; jsonError: boolean; key: string; originalKey: string; type: ObjectValueType; value: unknown };

const objectValueType = (value: unknown): ObjectValueType => {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (isConfigRecord(value) || Array.isArray(value)) return 'json';
  return 'string';
};
const normalizedObjectType = (type: unknown): ObjectValueType => {
  if (type === 'bool' || type === 'boolean') return 'boolean';
  if (type === 'int' || type === 'float' || type === 'number') return 'number';
  if (type === 'json' || type === 'dict' || type === 'object' || type === 'list') return 'json';
  return 'string';
};
const objectDraftValue = (value: unknown, type = objectValueType(value)) => type === 'json' ? JSON.stringify(value ?? {}, null, 2) : value;
const defaultObjectValue = (type: ObjectValueType) => type === 'boolean' ? false : type === 'number' ? 0 : type === 'json' ? '{}' : '';

export function ObjectConfigControl({ disabled, metadata, onChange, value }: { disabled?: boolean; metadata: ConfigItemMetadata; onChange: (value: unknown) => void; value: ConfigRecord }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<ObjectPair[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<ObjectValueType>('string');
  const keys = Object.keys(value);
  const templateSchema = isConfigRecord(metadata.template_schema) ? metadata.template_schema : {};
  const regularPairs = pairs.filter((pair) => !isConfigRecord(templateSchema[pair.key]));

  const showDialog = () => {
    setPairs(Object.entries(value).map(([key, item], index) => {
      const template: ConfigRecord | null = isConfigRecord(templateSchema[key]) ? templateSchema[key] as ConfigRecord : null;
      const type = template ? normalizedObjectType(template.type) : objectValueType(item);
      return { id: index, jsonError: false, key, originalKey: key, type, value: objectDraftValue(item, type) };
    }));
    setNewKey('');
    setNewType('string');
    setOpen(true);
  };
  const updatePair = (id: number, patch: Partial<ObjectPair>) => setPairs((current) => current.map((pair) => pair.id === id ? { ...pair, ...patch } : pair));
  const removePair = (id: number) => setPairs((current) => current.filter((pair) => pair.id !== id));
  const addPair = () => {
    const key = newKey.trim();
    if (!key) return;
    if (pairs.some((pair) => pair.key === key)) {
      toast.warning(t('core.common.objectEditor.keyExists'));
      return;
    }
    setPairs((current) => [...current, { id: current.reduce((max, pair) => Math.max(max, pair.id), -1) + 1, jsonError: false, key, originalKey: key, type: newType, value: defaultObjectValue(newType) }]);
    setNewKey('');
  };
  const validateKey = (pair: ObjectPair) => {
    const key = pair.key.trim();
    if (!key || pairs.some((item) => item.id !== pair.id && item.key === key)) {
      toast.warning(t('core.common.objectEditor.keyExists'));
      updatePair(pair.id, { key: pair.originalKey });
      return;
    }
    updatePair(pair.id, { key, originalKey: key });
  };
  const save = () => {
    const next: ConfigRecord = {};
    let invalid = false;
    const validated = pairs.map((pair) => {
      if (!pair.key.trim()) return pair;
      try {
        next[pair.key.trim()] = pair.type === 'json'
          ? JSON.parse(String(pair.value))
          : pair.type === 'number'
            ? Number(pair.value)
            : pair.type === 'boolean'
              ? Boolean(pair.value)
              : String(pair.value ?? '');
        return { ...pair, jsonError: false };
      } catch {
        invalid = true;
        return { ...pair, jsonError: true };
      }
    });
    setPairs(validated);
    if (invalid) return;
    onChange(next);
    setOpen(false);
  };
  const renderValue = (pair: ObjectPair) => {
    if (pair.type === 'boolean') return <label className="dynamic-switch"><input checked={Boolean(pair.value)} onChange={(event) => updatePair(pair.id, { value: event.target.checked })} type="checkbox" /><span className="dynamic-switch__track" /></label>;
    return <div className="dynamic-object-dialog__value">
      <input
        aria-invalid={pair.jsonError}
        onBlur={() => {
          if (pair.type !== 'json') return;
          try { JSON.parse(String(pair.value)); updatePair(pair.id, { jsonError: false }); } catch { updatePair(pair.id, { jsonError: true }); }
        }}
        onChange={(event) => updatePair(pair.id, { value: pair.type === 'number' ? event.target.valueAsNumber : event.target.value })}
        placeholder={t(`core.common.objectEditor.placeholders.${pair.type === 'number' ? 'numberValue' : pair.type === 'json' ? 'jsonValue' : 'stringValue'}`)}
        type={pair.type === 'number' ? 'number' : 'text'}
        value={typeof pair.value === 'number' || typeof pair.value === 'string' ? pair.value : ''}
      />
      {pair.jsonError && <small>{t('core.common.objectEditor.invalidJson')}</small>}
    </div>;
  };

  return <div className="dynamic-object">
    <div className="dynamic-object__preview">
      {keys.length
        ? <><span>{keys[0]}</span>{keys.length > 1 && <span>+{keys.length - 1}</span>}</>
        : <em>{t('core.common.objectEditor.noItems')}</em>}
    </div>
    {!disabled && <button className="dynamic-object__manage" onClick={showDialog} type="button">{t('core.common.list.modifyButton')}</button>}
    <Dialog onOpenChange={setOpen} open={open} title={t('core.common.objectEditor.dialogTitle')}>
      <div className="dynamic-object-dialog">
        <div className="dynamic-object-dialog__body">
          {regularPairs.map((pair) => <div className="dynamic-object-dialog__pair" key={pair.id}>
            <input onBlur={() => validateKey(pair)} onChange={(event) => updatePair(pair.id, { key: event.target.value })} placeholder={t('core.common.objectEditor.placeholders.keyName')} value={pair.key} />
            {renderValue(pair)}
            <button aria-label={t('features.config.actions.delete')} onClick={() => removePair(pair.id)} type="button"><MdiIcon name="mdi-delete" /></button>
          </div>)}
          {Object.entries(templateSchema).length > 0 && <div className="dynamic-object-dialog__templates">
            <span>{t('core.common.objectEditor.presets')}</span>
            {Object.entries(templateSchema).map(([key, rawTemplate]) => {
              if (!isConfigRecord(rawTemplate)) return null;
              const pair = pairs.find((item) => item.key === key);
              const type = normalizedObjectType(rawTemplate.type);
              const temporary: ObjectPair = pair ?? { id: -1, jsonError: false, key, originalKey: key, type, value: objectDraftValue(rawTemplate.default ?? defaultObjectValue(type), type) };
              const updateTemplate = (patch: Partial<ObjectPair>) => {
                if (pair) updatePair(pair.id, patch);
                else setPairs((current) => [...current, { ...temporary, ...patch, id: current.reduce((max, item) => Math.max(max, item.id), -1) + 1 }]);
              };
              return <div className={`dynamic-object-dialog__template${pair ? '' : ' is-inactive'}`} key={key}>
                <div><strong>{String(rawTemplate.name || rawTemplate.description || key)}</strong>{Boolean(rawTemplate.hint) && <small>{String(rawTemplate.hint)}</small>}</div>
                <div onChangeCapture={() => undefined}>{pair ? renderValue(pair) : type === 'boolean'
                  ? <label className="dynamic-switch"><input checked={Boolean(temporary.value)} onChange={(event) => updateTemplate({ value: event.target.checked })} type="checkbox" /><span className="dynamic-switch__track" /></label>
                  : <input onChange={(event) => updateTemplate({ value: type === 'number' ? event.target.valueAsNumber : event.target.value })} type={type === 'number' ? 'number' : 'text'} value={typeof temporary.value === 'string' || typeof temporary.value === 'number' ? temporary.value : ''} />}</div>
                {pair ? <button aria-label={t('features.config.actions.delete')} onClick={() => removePair(pair.id)} type="button"><MdiIcon name="mdi-close" /></button> : <span />}
              </div>;
            })}
          </div>}
          {!regularPairs.length && !Object.keys(templateSchema).length && <div className="dynamic-editor-empty"><MdiIcon name="mdi-code-json" /><p>{t('core.common.objectEditor.noParams')}</p></div>}
        </div>
        <div className="dynamic-object-dialog__add">
          <input onChange={(event) => setNewKey(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addPair(); } }} placeholder={t('core.common.objectEditor.newKeyLabel')} value={newKey} />
          <label><span>{t('core.common.objectEditor.valueTypeLabel')}</span><select onChange={(event) => setNewType(event.target.value as ObjectValueType)} value={newType}><option value="string">string</option><option value="number">number</option><option value="boolean">boolean</option><option value="json">json</option></select></label>
          <button className="dynamic-editor-button--tonal" disabled={!newKey.trim()} onClick={addPair} type="button"><MdiIcon name="mdi-plus" />{t('core.common.add')}</button>
        </div>
        <DialogActions><Button onClick={() => setOpen(false)}>{t('core.common.cancel')}</Button><Button onClick={save} variant="primary">{t('core.common.confirm')}</Button></DialogActions>
      </div>
    </Dialog>
  </div>;
}
