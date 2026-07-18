import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { DataTable } from './DataTable';
import { DialogActions } from './DialogActions';
import { Pagination } from './Pagination';
import { SearchField } from './SearchField';
import { StatusChip } from './StatusChip';

const primitiveStyles = readFileSync(new URL('../../styles/components/_primitives.scss', import.meta.url), 'utf8');

describe('shared UI primitives', () => {
  it('applies a consistent button variant while preserving caller classes', () => {
    const markup = renderToStaticMarkup(
      <Button className="feature-action" disabled variant="primary">
        Save
      </Button>,
    );

    expect(markup).toContain('ui-button ui-button--primary feature-action');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('type="button"');
  });

  it('keeps optional leading actions separate from the primary action group', () => {
    const markup = renderToStaticMarkup(
      <DialogActions leading={<Button variant="text">Reset</Button>}>
        <Button>Cancel</Button>
        <Button variant="primary">Confirm</Button>
      </DialogActions>,
    );

    expect(markup).toContain('dialog-actions ui-dialog-actions');
    expect(markup).toContain('ui-dialog-actions__leading');
    expect(markup).toContain('Reset');
    expect(markup).toContain('Confirm');
  });

  it('gives legacy dialog actions and semantic button classes the shared button appearance', () => {
    expect(primitiveStyles).toContain(':where(.dialog-actions) > button');
    expect(primitiveStyles).toContain('.button--danger');
    expect(primitiveStyles).toContain('.button--warning');
  });

  it('gives search and status controls consistent accessible markup', () => {
    const markup = renderToStaticMarkup(
      <>
        <SearchField clearLabel="Clear search" label="Search plugins" onChange={() => undefined} value="calendar" />
        <StatusChip tone="success">Enabled</StatusChip>
      </>,
    );

    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-label="Search plugins"');
    expect(markup).toContain('aria-label="Clear search"');
    expect(markup).toContain('ui-status-chip--success');
  });

  it('shares table selection, empty state and pagination structure', () => {
    const table = renderToStaticMarkup(
      <DataTable
        columns={[{ header: 'Name', id: 'name', render: (row) => row.name }]}
        empty={{ title: 'No plugins' }}
        getRowKey={(row) => row.id}
        loading={false}
        loadingLabel="Loading"
        rows={[{ id: 'one', name: 'Calendar' }]}
        selection={{
          allSelected: false,
          headerLabel: 'Select all plugins',
          isSelected: () => false,
          onToggle: () => undefined,
          onToggleAll: () => undefined,
          rowLabel: (row) => `Select ${row.name}`,
        }}
      />,
    );
    const pagination = renderToStaticMarkup(
      <Pagination
        labels={{
          navigation: 'Pagination',
          next: 'Next page',
          pageSize: 'Items per page',
          previous: 'Previous page',
        }}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        page={1}
        pageSize={20}
        totalItems={40}
      />,
    );

    expect(table).toContain('aria-label="Select all plugins"');
    expect(table).toContain('aria-label="Select Calendar"');
    expect(pagination).toContain('aria-label="Pagination"');
    expect(pagination).toContain('Items per page');
    expect(pagination).toContain('disabled=""');
  });
});
