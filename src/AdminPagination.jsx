import { useState } from 'react'
import './adminPagination.css'

export const ADMIN_PAGE_SIZE = 20

export default function AdminPagination({ total, page, onPage, label = 'records' }) {
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE))
  const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4))
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => firstPage + index)
  const [jump, setJump] = useState('')
  const jumpToPage = event => {
    event.preventDefault()
    const requested = Number(jump)
    if (Number.isInteger(requested) && requested >= 1 && requested <= pageCount) {
      onPage(requested)
      setJump('')
    }
  }
  const start = total ? (page - 1) * ADMIN_PAGE_SIZE + 1 : 0
  const end = Math.min(page * ADMIN_PAGE_SIZE, total)

  return <div className="admin-pagination-wrap">
    <p className="admin-pagination-summary">Showing {start}–{end} of {total} {label} · 20 per page</p>
    {pageCount > 1 && <nav className="wallet-pagination admin-pagination" aria-label={`${label} pages`}>
      <button type="button" className="wallet-page-step" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <div className="wallet-page-numbers">{pages.map(number => <button type="button" key={number} className={page === number ? 'wallet-page-number wallet-page-current' : 'wallet-page-number'} aria-current={page === number ? 'page' : undefined} onClick={() => onPage(number)}>{number}</button>)}</div>
      <button type="button" className="wallet-page-step" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
      <form className="wallet-page-jump" onSubmit={jumpToPage}><label>Jump to</label><input type="number" min="1" max={pageCount} step="1" value={jump} onChange={event => setJump(event.target.value)} aria-label={`Jump to ${label} page`} placeholder={`1–${pageCount}`}/><button type="submit" disabled={!jump}>Go</button></form>
    </nav>}
  </div>
}
