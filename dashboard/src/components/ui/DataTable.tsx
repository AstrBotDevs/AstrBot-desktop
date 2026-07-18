import { type ReactNode } from 'react';

import { AsyncState } from './AsyncState';

export type DataTableColumn<Row> = {
  className?: string;
  header: ReactNode;
  id: string;
  render: (row: Row) => ReactNode;
};

export type DataTableSelection<Row> = {
  allSelected: boolean;
  headerLabel: string;
  isSelected: (row: Row) => boolean;
  onToggle: (row: Row) => void;
  onToggleAll: () => void;
  rowLabel: (row: Row) => string;
};

export function DataTable<Row>({
  className = '',
  columns,
  empty,
  error,
  getRowKey,
  loading,
  loadingLabel,
  rows,
  selection,
  tableClassName = '',
}: {
  className?: string;
  columns: DataTableColumn<Row>[];
  empty: { action?: ReactNode; description?: ReactNode; icon?: ReactNode; title: ReactNode };
  error?: ReactNode;
  getRowKey: (row: Row) => string;
  loading?: boolean;
  loadingLabel: ReactNode;
  rows: Row[];
  selection?: DataTableSelection<Row>;
  tableClassName?: string;
}) {
  return (
    <div className={`ui-data-table${className ? ` ${className}` : ''}`}>
      <table className={`ui-data-table__table${tableClassName ? ` ${tableClassName}` : ''}`}>
        <thead>
          <tr>
            {selection ? (
              <th className="ui-data-table__selection">
                <input
                  aria-label={selection.headerLabel}
                  checked={selection.allSelected}
                  onChange={selection.onToggleAll}
                  type="checkbox"
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th className={column.className} key={column.id}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {selection ? (
                <td className="ui-data-table__selection">
                  <input
                    aria-label={selection.rowLabel(row)}
                    checked={selection.isSelected(row)}
                    onChange={() => selection.onToggle(row)}
                    type="checkbox"
                  />
                </td>
              ) : null}
              {columns.map((column) => (
                <td className={column.className} key={column.id}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <AsyncState
        empty={!loading && !error && rows.length === 0 ? empty : undefined}
        error={error}
        loading={loading && rows.length === 0}
        loadingLabel={loadingLabel}
      >
        {null}
      </AsyncState>
    </div>
  );
}
