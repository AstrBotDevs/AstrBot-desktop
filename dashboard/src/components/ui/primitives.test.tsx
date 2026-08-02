import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { DataTable } from './DataTable';
import { DisclosureButton } from './DisclosureButton';
import { DialogActions } from './DialogActions';
import { Pagination } from './Pagination';
import { SearchField } from './SearchField';
import { SelectMenu } from './SelectMenu';
import { SelectControl } from './SelectControl';
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

  it('gives native form controls a theme-aware baseline', () => {
    expect(primitiveStyles).toContain("input[type='text']");
    expect(primitiveStyles).toContain("input[type='checkbox']");
    expect(primitiveStyles).toContain('select,');
    expect(primitiveStyles).toContain('textarea');
    expect(primitiveStyles).toContain('var(--astrbot-radius-control)');
    expect(primitiveStyles).toContain(':focus');
  });

  it('styles expanded native select pickers with a themed fallback', () => {
    expect(primitiveStyles).toContain(':where(select option:checked)');
    expect(primitiveStyles).toContain('@supports (appearance: base-select)');
    expect(primitiveStyles).toContain('::picker(select)');
    expect(primitiveStyles).toContain('::picker-icon');
    expect(primitiveStyles).toContain('::checkmark');
    expect(primitiveStyles).toContain(':where(select:not(:disabled))');
    expect(primitiveStyles).toContain(':where(select:active, select:focus, select:focus-visible, select:open)');
    expect(primitiveStyles).toContain('border-color: transparent');
  });

  it('shares the custom select menu used by feature pages', () => {
    const markup = renderToStaticMarkup(
      <SelectMenu
        ariaLabel="Computer access"
        onChange={() => undefined}
        options={[
          { id: 'local', name: 'Allow' },
          { id: 'none', name: 'Deny' },
        ]}
        placeholder="Choose access"
        value="none"
      />,
    );

    expect(markup).toContain('ui-select-menu');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('Deny');
    expect(markup).not.toContain('Choose access');
  });

  it('adapts native option markup to the shared select menu', () => {
    const markup = renderToStaticMarkup(
      <SelectControl aria-label="Page size" value={20} onChange={() => undefined}>
        <option value={10}>10</option>
        <option value={20}>20</option>
      </SelectControl>,
    );

    expect(markup).toContain('ui-select-control__native');
    expect(markup).toContain('aria-label="Page size"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('>20<');
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

  it('keeps disclosure controls centered and exposes their current state', () => {
    const collapsed = renderToStaticMarkup(
      <DisclosureButton collapseLabel="Collapse" expanded={false} expandLabel="Expand" label="Config file" />,
    );
    const expanded = renderToStaticMarkup(
      <DisclosureButton
        collapseLabel="Collapse"
        compact
        direction="right"
        expanded
        expandLabel="Expand"
        label="Tool details"
      />,
    );

    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('aria-label="Expand: Config file"');
    expect(collapsed).toContain('ui-disclosure-button__icon');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('aria-label="Collapse: Tool details"');
    expect(expanded).toContain('ui-disclosure-button--compact');
    expect(expanded).toContain('ui-disclosure-button--tree');
    expect(expanded).toContain('mdi-chevron-right');
    expect(primitiveStyles).toContain(".ui-disclosure-button[aria-expanded='true']");
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
    expect(table).toContain('ui-data-table__table ui-selection-table');
    expect(table).toContain('ui-selection-checkbox');
    expect(primitiveStyles).toContain('.ui-selection-table tbody .ui-selection-checkbox:not(:checked)');
    expect(pagination).toContain('aria-label="Pagination"');
    expect(pagination).toContain('Items per page');
    expect(pagination).toContain('disabled=""');
  });
});
