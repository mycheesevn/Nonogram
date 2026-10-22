"use client";

import { useMemo, useState } from "react";

export function usePagination<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  const pageItems = useMemo(
    () => items.slice(safePage * pageSize, (safePage + 1) * pageSize),
    [items, safePage, pageSize]
  );
  return { page: safePage, pageCount, pageItems, setPage };
}

export function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="sud-pagination" role="navigation" aria-label="pagination">
      <button type="button" disabled={page === 0} onClick={() => onPage(0)}>
        ⏮
      </button>
      <button type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>
        ◀
      </button>
      <span>
        {page + 1} / {pageCount}
      </span>
      <button
        type="button"
        disabled={page === pageCount - 1}
        onClick={() => onPage(page + 1)}
      >
        ▶
      </button>
      <button
        type="button"
        disabled={page === pageCount - 1}
        onClick={() => onPage(pageCount - 1)}
      >
        ⏭
      </button>
    </div>
  );
}
