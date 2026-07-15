import type { JsonObject } from '@/routes/configuration/model';

export type ChatPart = JsonObject & { type: string; text?: string; think?: string; attachment_id?: string; filename?: string; stored_filename?: string };
export type ChatRecord = JsonObject & { id?: string | number; content: { type: string; message: ChatPart[]; reasoning?: string; isLoading?: boolean; agentStats?: JsonObject } };
export type ChatSession = JsonObject & { session_id: string; display_name?: string; updated_at?: string };
export type StagedAttachmentType = 'image' | 'record' | 'file';

export function contextTokenCount(stats?: JsonObject) {
  if (!stats) return 0;
  if (stats.current_context_tokens != null) return readTokenCount(stats.current_context_tokens);
  const usage = stats.token_usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return 0;
  const tokenUsage = usage as JsonObject;
  return readTokenCount(tokenUsage.input_other) + readTokenCount(tokenUsage.input_cached) + readTokenCount(tokenUsage.output);
}

export function stagedAttachmentType(serverType: unknown, mimeType: string): StagedAttachmentType {
  if (serverType === 'image' || serverType === 'record') return serverType;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'record';
  return 'file';
}

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
  const rawStats = rawContent.agentStats || rawContent.agent_stats;
  return { ...record, content: { type: String(rawContent.type || (record.sender_id === 'bot' ? 'bot' : 'user')), message: normalizeParts(rawContent.message), reasoning: typeof rawContent.reasoning === 'string' ? rawContent.reasoning : undefined, agentStats: rawStats && typeof rawStats === 'object' && !Array.isArray(rawStats) ? rawStats as JsonObject : undefined } } as ChatRecord;
}

export function appendStreamPayload(record: ChatRecord, payload: unknown) {
  if (!payload || typeof payload !== 'object') return false;
  const raw = payload as JsonObject; const normalized = raw.ct === 'chat' ? { ...raw, type: raw.type || raw.t } : raw;
  const type = String(normalized.type || normalized.t || ''); const chain = String(normalized.chain_type || ''); const data = normalized.data;
  if (['session_id', 'session_bound', 'user_message_saved'].includes(type)) return false;
  if (type === 'message_saved' && data && typeof data === 'object') { const saved = data as JsonObject; record.id = typeof saved.id === 'string' || typeof saved.id === 'number' ? saved.id : record.id; record.created_at = saved.created_at || record.created_at; record.llm_checkpoint_id = saved.llm_checkpoint_id || record.llm_checkpoint_id; record.content.isLoading = false; return true; }
  if ((type === 'agent_stats' || chain === 'agent_stats') && data && typeof data === 'object' && !Array.isArray(data)) { record.content.agentStats = data as JsonObject; record.content.isLoading = false; return true; }
  if (type === 'error') { appendPlain(record, `\n\n${String(data ?? 'Unknown error')}`); return true; }
  if (['complete', 'break'].includes(type)) { if (!plainText(record)) appendPlain(record, payloadText(data), false); record.content.isLoading = false; return true; }
  if (type === 'end') { record.content.isLoading = false; return true; }
  if (type === 'plain') { if (chain === 'reasoning') { appendReasoning(record, payloadText(data)); } else if (chain !== 'tool_call' && chain !== 'tool_call_result') appendPlain(record, payloadText(data), normalized.streaming !== false); return true; }
  if (['image', 'record', 'file', 'video'].includes(type)) { const rawName = String(data ?? '').replace(/^\[(IMAGE|RECORD|FILE|VIDEO)\]/, ''); const split = rawName.indexOf('|'); const stored = split >= 0 ? rawName.slice(0, split) : rawName; const filename = split >= 0 ? rawName.slice(split + 1) : stored; record.content.message.push({ type, filename, ...(stored !== filename ? { stored_filename: stored } : {}) }); return true; }
  return false;
}

function payloadText(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const data = value as JsonObject;
    if (typeof data.text === 'string') return data.text;
    if (typeof data.content === 'string') return data.content;
    if (typeof data.message === 'string') return data.message;
  }
  return String(value ?? '');
}
function plainText(record: ChatRecord) { return record.content.message.filter((part) => part.type === 'plain').map((part) => part.text || '').join(''); }
function appendPlain(record: ChatRecord, text: string, streaming = true) { const last = record.content.message.at(-1); if (streaming && last?.type === 'plain') last.text = `${last.text || ''}${text}`; else if (text) record.content.message.push({ type: 'plain', text }); record.content.isLoading = false; }
function appendReasoning(record: ChatRecord, text: string) {
  record.content.reasoning = `${record.content.reasoning || ''}${text}`;
  const last = record.content.message.at(-1);
  if (last?.type === 'think') last.think = `${last.think || ''}${text}`;
  else if (text) record.content.message.push({ type: 'think', think: text });
}

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

function readTokenCount(value: unknown) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
