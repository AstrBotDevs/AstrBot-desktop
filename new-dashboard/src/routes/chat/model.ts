import type { JsonObject } from '@/routes/configuration/model';

export type ChatPart = JsonObject & { type: string; text?: string; think?: string; attachment_id?: string; filename?: string; stored_filename?: string };
export type ChatRecord = JsonObject & { id?: string | number; content: { type: string; message: ChatPart[]; reasoning?: string; isLoading?: boolean } };
export type ChatSession = JsonObject & { session_id: string; display_name?: string; updated_at?: string };

export function normalizeParts(value: unknown): ChatPart[] {
  if (typeof value === 'string') return value ? [{ type: 'plain', text: value }] : [];
  if (!Array.isArray(value)) return [];
  return value.map((part) => {
    if (!part || typeof part !== 'object') return { type: 'plain', text: String(part ?? '') };
    const item = part as ChatPart;
    return item.type === 'reasoning' ? { ...item, type: 'think', think: String(item.think ?? item.text ?? '') } : { ...item };
  });
}

export function normalizeRecord(value: unknown): ChatRecord {
  const record = value && typeof value === 'object' ? value as JsonObject : {};
  const rawContent = record.content && typeof record.content === 'object' ? record.content as JsonObject : {};
  return { ...record, content: { type: String(rawContent.type || (record.sender_id === 'bot' ? 'bot' : 'user')), message: normalizeParts(rawContent.message), reasoning: typeof rawContent.reasoning === 'string' ? rawContent.reasoning : undefined } } as ChatRecord;
}

export function appendStreamPayload(record: ChatRecord, payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  const raw = payload as JsonObject; const normalized = raw.ct === 'chat' ? { ...raw, type: raw.type || raw.t } : raw;
  const type = String(normalized.type || normalized.t || ''); const chain = String(normalized.chain_type || ''); const data = normalized.data;
  if (['session_id', 'session_bound', 'user_message_saved'].includes(type)) return false;
  if (type === 'message_saved' && data && typeof data === 'object') { const saved = data as JsonObject; record.id = typeof saved.id === 'string' || typeof saved.id === 'number' ? saved.id : record.id; record.content.isLoading = false; return true; }
  if (type === 'error') { appendPlain(record, `\n\n${String(data ?? 'Unknown error')}`); return true; }
  if (['complete', 'break'].includes(type)) { if (!plainText(record)) appendPlain(record, payloadText(data), false); record.content.isLoading = false; return true; }
  if (type === 'end') { record.content.isLoading = false; return true; }
  if (type === 'plain') { if (chain === 'reasoning') { const text = payloadText(data); record.content.reasoning = `${record.content.reasoning || ''}${text}`; record.content.message.push({ type: 'think', think: text }); } else if (chain !== 'tool_call' && chain !== 'tool_call_result') appendPlain(record, payloadText(data), normalized.streaming !== false); return true; }
  if (['image', 'record', 'file', 'video'].includes(type)) { const rawName = String(data ?? '').replace(/^\[(IMAGE|RECORD|FILE|VIDEO)\]/, ''); const split = rawName.indexOf('|'); const stored = split >= 0 ? rawName.slice(0, split) : rawName; const filename = split >= 0 ? rawName.slice(split + 1) : stored; record.content.message.push({ type, filename, ...(stored !== filename ? { stored_filename: stored } : {}) }); return true; }
  return false;
}

function payloadText(value: unknown) { return typeof value === 'string' ? value : value && typeof value === 'object' && 'text' in value ? String((value as JsonObject).text ?? '') : String(value ?? ''); }
function plainText(record: ChatRecord) { return record.content.message.filter((part) => part.type === 'plain').map((part) => part.text || '').join(''); }
function appendPlain(record: ChatRecord, text: string, streaming = true) { const last = record.content.message.at(-1); if (streaming && last?.type === 'plain') last.text = `${last.text || ''}${text}`; else if (text) record.content.message.push({ type: 'plain', text }); record.content.isLoading = false; }

export function parseSseEvents(buffer: string, flush = false) {
  const normalized = buffer.replace(/\r\n/g, '\n'); const blocks = normalized.split('\n\n'); const remainder = flush ? '' : blocks.pop() || ''; const payloads: unknown[] = [];
  for (const block of blocks) { const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'); if (!data) continue; try { payloads.push(JSON.parse(data)); } catch { /* Ignore non-JSON keepalive events. */ } }
  return { payloads, remainder };
}

export function sessionList(value: unknown): ChatSession[] {
  const data = value && typeof value === 'object' ? value as JsonObject : {};
  const list = Array.isArray(value) ? value : Array.isArray(data.items) ? data.items : Array.isArray(data.sessions) ? data.sessions : [];
  return list.filter((item): item is ChatSession => Boolean(item && typeof item === 'object' && typeof (item as JsonObject).session_id === 'string'));
}
