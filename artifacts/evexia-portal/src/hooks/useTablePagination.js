import { useEffect, useState } from 'react';

export default function useTablePagination(rows) {
  const [requestedPage, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const startIndex = (page - 1) * pageSize;
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);

  return {
    page,
    pageSize,
    pageCount,
    startIndex,
    pageRows: rows.slice(startIndex, startIndex + pageSize),
    setPage,
    resetPage: () => setPage(1),
    setPageSize: (size) => { setPageSize(size); setPage(1); },
  };
}