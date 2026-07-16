import { describe, expect, it } from 'vitest';
import { chunkCount, documentCount, documentId, documentName, formatFileSize, retrievalPayload, scoreTone, taskIds } from './knowledgeModel';

describe('knowledge model', () => {
  it('supports legacy and current field aliases', () => {
    expect(documentId({ doc_id: 'doc' })).toBe('doc');
    expect(documentName({ file_name: 'guide.pdf' })).toBe('guide.pdf');
    expect(documentCount({ doc_count: 3 })).toBe(3);
    expect(documentCount({ doc_count: null, document_count: 4 })).toBe(4);
    expect(chunkCount({ chunks_count: 12 })).toBe(12);
  });

  it('formats file sizes', () => {
    expect(formatFileSize(1536)).toBe('1.50 KB');
    expect(formatFileSize(0)).toBe('');
    expect(formatFileSize(0, 'Not set')).toBe('Not set');
  });

  it('normalizes retrieval and upload task responses', () => {
    expect(retrievalPayload({ results: [{ chunk_id: '1' }], visualization: 'png' })).toEqual({ results: [{ chunk_id: '1' }], visualization: 'png' });
    expect(taskIds({ task_id: 'task' })).toEqual(['task']);
    expect(taskIds({ task_ids: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('maps scores to visual tones', () => {
    expect(scoreTone(.85)).toBe('success');
    expect(scoreTone(.5)).toBe('warning');
    expect(scoreTone(.1)).toBe('error');
  });
});
