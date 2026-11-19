import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Clock3, LockKeyhole, RefreshCw, Search, Shield, ShieldCheck, UnlockKeyhole, Users, X } from 'lucide-react'
import { supabase } from './supabase'
import AdminWalletPanel from './AdminWalletPanel.jsx'
import SupportMessagesPanel from './SupportMessagesPanel.jsx'

const dateTime = value => value ? new Date(value).toLocaleString() : '—'
const shortId = value => value ? `${value.slice(0, 8)}…` : '—'

export default function AdminPanel({ currentUser, notify }) {
  const [users, setUsers] = useState([])
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [target, setTarget] = useState(null)
  const [nextStatus, setNextStatus] = useState('restricted')
  const [duration, setDuration] = useState('7d')
  const [reason, setReason] = useState('')

  const loadUsers = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', { body: { action: 'list' } })
    if (invokeError) {
      let message = invokeError.message
      try { const body = await invokeError.context?.json(); if (body?.error) message = body.error } catch {}
      setError(`${message}. Deploy the admin-users Edge Function and run the admin SQL setup if you have not done so.`)
    } else {
      setUsers(data?.users ?? [])
      setActions(data?.actions ?? [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const visibleUsers = useMemo(() => users.filter(user =>
    (statusFilter === 'all' || user.status === statusFilter) &&
    `${user.email} ${user.id}`.toLowerCase().includes(query.toLowerCase())
  ), [users, statusFilter, query])
  const counts = useMemo(() => ({
    total: users.filter(user => user.role !== 'admin').length,
    restricted: users.filter(user => user.status === 'restricted').length,
    suspended: users.filter(user => user.status === 'suspended').length,
  }), [users])

  const openAction = (customer, status) => {
    setTarget(customer)
    setNextStatus(status)
    setReason('')
    setDuration('7d')
  }

  const saveAction = async event => {
    event.preventDefault()
    if (!target || working) return
    setWorking(true)
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
      body: { action: 'set_status', user_id: target.id, status: nextStatus, duration, reason },
    })
    if (invokeError) {
      let message = invokeError.message
      try { const body = await invokeError.context?.json(); if (body?.error) message = body.error } catch {}
      setError(message)
    } else if (data?.ok) {
      setTarget(null)
      notify(nextStatus === 'active' ? 'Customer access restored' : `Customer ${nextStatus}`)
      await loadUsers()
    }
    setWorking(false)
  }

  return <section className="admin-page">
    <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> TRUST & SAFETY</div><h1>Customer administration</h1><p>Review accounts and manage access. Every change requires a reason and is recorded.</p></div><button className="admin-refresh" onClick={loadUsers} disabled={loading}><RefreshCw size={15} className={loading?'spin':''}/> Refresh</button></div>
    <div className="admin-notice"><ShieldCheck size={17}/><span>Administrator: <b>{currentUser?.email}</b>. Other administrators and your own account are protected from status changes here.</span></div>
    <div className="admin-stats"><article><span><Users size={16}/> CUSTOMERS</span><b>{counts.total}</b><small>Registered customer accounts</small></article><article><span><AlertTriangle size={16}/> RESTRICTED</span><b>{counts.restricted}</b><small>Can view, cannot change watchlists</small></article><article><span><Ban size={16}/> SUSPENDED</span><b>{counts.suspended}</b><small>Sign-in and account data blocked</small></article></div>
    {error&&<div className="admin-error"><AlertTriangle size={17}/><span>{error}</span><button onClick={()=>setError('')} aria-label="Dismiss"><X size={15}/></button></div>}
    <div className="admin-list-card"><div className="admin-list-heading"><div><span className="section-eyebrow">ACCOUNT OVERSIGHT</span><h3>Customer accounts</h3></div><span className="admin-total">{visibleUsers.length} shown</span></div><div className="admin-toolbar"><label className="admin-search"><Search size={15}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search email or account ID"/></label><select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)} aria-label="Filter by account status"><option value="all">All statuses</option><option value="active">Active</option><option value="restricted">Restricted</option><option value="suspended">Suspended</option></select></div>
      {loading?<div className="admin-empty"><span className="spinner"/>Loading customer accounts…</div>:visibleUsers.length===0?<div className="admin-empty"><Users size={21}/><b>No customer accounts found</b><span>Try a different search or status filter.</span></div>:<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>CUSTOMER</th><th>STATUS</th><th>JOINED</th><th>LAST SIGN IN</th><th>EMAIL</th><th>ACTIONS</th></tr></thead><tbody>{visibleUsers.map(customer=><tr key={customer.id}><td><div className="customer-cell"><span className="customer-avatar">{customer.email?.[0]?.toUpperCase()??'?'}</span><span><b>{customer.email}</b><small title={customer.id}>{shortId(customer.id)}{customer.role==='admin'?' · ADMIN':''}</small></span></div></td><td><span className={`status-badge status-${customer.status}`}><i/>{customer.status}</span>{customer.status==='suspended'&&customer.suspended_until&&<small className="until-date">Until {dateTime(customer.suspended_until)}</small>}</td><td>{dateTime(customer.created_at)}</td><td>{dateTime(customer.last_sign_in_at)}</td><td><span className={`verified ${customer.email_confirmed_at?'verified-yes':'verified-no'}`}>{customer.email_confirmed_at?'Verified':'Pending'}</span></td><td><div className="admin-row-actions">{customer.role==='admin'||customer.id===currentUser?.id?<span className="protected-label"><Shield size={14}/> Protected</span>:customer.status==='active'?<><button className="restrict-btn" onClick={()=>openAction(customer,'restricted')}><LockKeyhole size={14}/> Restrict</button><button className="suspend-btn" onClick={()=>openAction(customer,'suspended')}><Ban size={14}/> Suspend</button></>:customer.status==='restricted'?<><button className="restore-btn" onClick={()=>openAction(customer,'active')}><UnlockKeyhole size={14}/> Restore</button><button className="suspend-btn" onClick={()=>openAction(customer,'suspended')}><Ban size={14}/> Suspend</button></>:<button className="restore-btn" onClick={()=>openAction(customer,'active')}><UnlockKeyhole size={14}/> Restore</button>}</div></td></tr>)}</tbody></table></div>}
    </div>
    <div className="admin-audit"><div className="admin-list-heading"><div><span className="section-eyebrow">ADMIN AUDIT TRAIL</span><h3>Recent admin actions</h3></div><span className="admin-total">Showing {Math.min(actions.length,20)} of {actions.length}</span></div>{actions.length===0?<p className="audit-empty">Admin access, wallet funding, and request decisions will be recorded here with a reason.</p>:<div className="audit-list">{actions.slice(0,20).map(action=><article key={action.id}><span className={`audit-icon audit-${action.action}`}><Clock3 size={15}/></span><div><b>{action.admin_email}</b><span>{action.action==='demo_funding'?'virtual funding':action.action.replaceAll('_',' ')} <strong>{action.target_email}</strong></span><small>{action.reason}</small></div><time>{dateTime(action.created_at)}</time></article>)}</div>}</div>
    <div className="admin-footnote"><LockKeyhole size={14}/> Suspensions block future sign-ins through Supabase Auth and block watchlist access through row-level security. Restrictions keep sign-in available but make the watchlist read-only.</div>
    <AdminWalletPanel notify={notify}/>
    <SupportMessagesPanel currentUser={currentUser} isAdmin customers={users} notify={notify}/>

    {target&&<div className="modal-backdrop" onClick={()=>setTarget(null)}><section className="admin-action-modal" onClick={event=>event.stopPropagation()}><button className="modal-close" onClick={()=>setTarget(null)} aria-label="Close"><X size={18}/></button><span className="section-eyebrow">CUSTOMER ACCESS</span><h2>{nextStatus==='active'?'Restore customer access':nextStatus==='restricted'?'Restrict customer account':'Suspend customer account'}</h2><p>Account: <b>{target.email}</b></p>{nextStatus==='suspended'&&<label className="admin-field">Suspension duration<select value={duration} onChange={event=>setDuration(event.target.value)}><option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="permanent">Permanent (100 years)</option></select></label>}<form onSubmit={saveAction}><label className="admin-field">Reason for this change<textarea required minLength="3" maxLength="500" rows="4" value={reason} onChange={event=>setReason(event.target.value)} placeholder="Explain the policy or safety reason. This is recorded in the admin log."/></label><div className="action-modal-note"><ShieldCheck size={15}/>{nextStatus==='active'?'This restores sign-in and watchlist access.':nextStatus==='restricted'?'This keeps sign-in enabled but blocks watchlist changes.':'This blocks sign-in and immediately blocks watchlist access.'}</div><div className="action-modal-buttons"><button type="button" className="cancel-btn" onClick={()=>setTarget(null)}>Cancel</button><button className={nextStatus==='suspended'?'confirm-suspend-btn':'confirm-action-btn'} disabled={working}>{working?'Saving…':nextStatus==='active'?'Restore access':nextStatus==='restricted'?'Apply restriction':'Suspend account'}</button></div></form></section></div>}
  </section>
}
