import { type ReactNode } from 'react';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { paginationDefaults } from '@/config/defaults';
import { IconButton } from './IconButton';

export type PaginationLabels = {
  navigation: string;
  next: string;
  page?: (page: number, totalPages: number) => ReactNode;
  pageSize?: string;
  previous: string;
  range?: ReactNode;
};

export function Pagination({
  className = '',
  labels,
  numbered = false,
  onPageChange,
  onPageSizeChange,
  page,
  pageSize,
  pageSizeOptions = paginationDefaults.options,
  totalItems,
  totalPages: providedTotalPages,
}: {
  className?: string;
  labels: PaginationLabels;
  numbered?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  page: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  totalItems: number;
  totalPages?: number;
}) {
  const totalPages = Math.max(1, providedTotalPages ?? Math.ceil(totalItems / pageSize));
  const firstPage = Math.max(1, Math.min(page - 3, totalPages - 6));
  const visiblePages = Array.from({ length: Math.min(7, totalPages) }, (_, index) => firstPage + index);

  return (
    <nav aria-label={labels.navigation} className={`ui-pagination${className ? ` ${className}` : ''}`}>
      {onPageSizeChange ? (
        <label className="ui-pagination__size">
          <span>{labels.pageSize}</span>
          <select onChange={(event) => onPageSizeChange(Number(event.target.value))} value={pageSize}>
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {labels.range ? <span className="ui-pagination__range">{labels.range}</span> : null}
      <div className="ui-pagination__controls">
        <IconButton
          disabled={page <= 1}
          icon={<MdiIcon name="mdi-chevron-left" />}
          label={labels.previous}
          onClick={() => onPageChange(page - 1)}
          variant="text"
        />
        {numbered ? (
          visiblePages.map((number) => (
            <button
              aria-current={number === page ? 'page' : undefined}
              className="ui-pagination__page"
              key={number}
              onClick={() => onPageChange(number)}
              type="button"
            >
              {number}
            </button>
          ))
        ) : (
          <span className="ui-pagination__page-label">
            {labels.page?.(page, totalPages) ?? `${page}/${totalPages}`}
          </span>
        )}
        <IconButton
          disabled={page >= totalPages}
          icon={<MdiIcon name="mdi-chevron-right" />}
          label={labels.next}
          onClick={() => onPageChange(page + 1)}
          variant="text"
        />
      </div>
    </nav>
  );
}
