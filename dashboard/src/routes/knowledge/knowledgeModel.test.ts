import { describe, expect, it } from 'vitest';
import {
  chunkCount,
  documentCount,
  documentId,
  documentName,
  formatFileSize,
  knowledgeFileUploadBody,
  knowledgeUrlImportBody,
  retrievalPayload,
  scoreTone,
  taskIds,
  validKnowledgeImportSettings,
} from './knowledgeModel';

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
    expect(retrievalPayload({ results: [{ chunk_id: '1' }], visualization: 'png' })).toEqual({
      results: [{ chunk_id: '1' }],
      visualization: 'png',
    });
    expect(taskIds({ task_id: 'task' })).toEqual(['task']);
    expect(taskIds({ task_ids: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('maps scores to visual tones', () => {
    expect(scoreTone(0.85)).toBe('success');
    expect(scoreTone(0.5)).toBe('warning');
    expect(scoreTone(0.1)).toBe('error');
  });

  it('builds the legacy multi-file and URL import payloads', () => {
    const settings = {
      batch_size: 32,
      chunk_overlap: 50,
      chunk_size: 512,
      cleaning_provider_id: 'chat',
      enable_cleaning: true,
      max_retries: 3,
      tasks_limit: 3,
    };
    const files = [new Blob(['a']), new Blob(['b'])];
    const body = knowledgeFileUploadBody(files, settings);
    expect(body.file0).toBe(files[0]);
    expect(body.file1).toBe(files[1]);
    expect(body).toMatchObject({ chunk_size: 512, chunk_overlap: 50, batch_size: 32, tasks_limit: 3, max_retries: 3 });
    expect(knowledgeUrlImportBody(' https://example.com ', settings)).toEqual({
      url: 'https://example.com',
      chunk_size: 512,
      chunk_overlap: 50,
      batch_size: 32,
      tasks_limit: 3,
      max_retries: 3,
      enable_cleaning: true,
      cleaning_provider_id: 'chat',
    });
    expect(validKnowledgeImportSettings(settings)).toBe(true);
    expect(validKnowledgeImportSettings({ ...settings, chunk_overlap: 512 })).toBe(false);
  });
});
