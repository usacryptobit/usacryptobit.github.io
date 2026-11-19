import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pause, Play, RefreshCw, Wallet } from 'lucide-react'
import { supabase } from './supabase'
import AdminPagination, { ADMIN_PAGE_SIZE } from './AdminPagination.jsx'

const fmt = value => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 8 })
const cleanAdminCopy = value => String(value ?? '').replace(/\b(virtual|simulated?|simulation|practice|demo)\b/gi, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim()
const ASSETS = ['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC','USDT','USDC','DAI','USDS','USDE','PYUSD','FDUSD','RLUSD','USDG','USDP','GUSD','USD1','USDD']

export default function AdminWalletPanel({ notify, isAdmin = true, staffPermissions = [] }) {
  const [users, setUsers] = useState([])
  const [withdrawals, setWithdrawals] = useState([])
  const [deposits, setDeposits] = useState([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [funding, setFunding] = useState(null)
  const [asset, setAsset] = useState('BTC')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [resetUserId, setResetUserId] = useState('')
  const [resetReason, setResetReason] = useState('')
  const [balancePage, setBalancePage] = useState(1)
  const [withdrawalPage, setWithdrawalPage] = useState(1)
  const [depositPage, setDepositPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', { body: { action: 'list' } })
    if (invokeError) setError(cleanAdminCopy(invokeError.message))
    else {
      setUsers(data?.users ?? [])
      setWithdrawals(data?.withdrawals ?? [])
      setDeposits(data?.deposits ?? [])
      setError('')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const customers = useMemo(() => users.filter(user => user.role === 'customer'), [users])
  const balanceRows = useMemo(() => customers.flatMap(user => (user.wallets ?? []).map(wallet => ({ ...wallet, user }))), [customers])
  const canFund = isAdmin || staffPermissions.includes('wallet_funding')
  const canReview = isAdmin || staffPermissions.includes('wallet_requests')
  const balanceRowsPage = balanceRows.slice((balancePage - 1) * ADMIN_PAGE_SIZE, balancePage * ADMIN_PAGE_SIZE)
  const withdrawalRowsPage = withdrawals.slice((withdrawalPage - 1) * ADMIN_PAGE_SIZE, withdrawalPage * ADMIN_PAGE_SIZE)
  const depositRowsPage = deposits.slice((depositPage - 1) * ADMIN_PAGE_SIZE, depositPage * ADMIN_PAGE_SIZE)

  useEffect(() => { setBalancePage(page => Math.min(page, Math.max(1, Math.ceil(balanceRows.length / ADMIN_PAGE_SIZE)))) }, [balanceRows.length])
  useEffect(() => { setWithdrawalPage(page => Math.min(page, Math.max(1, Math.ceil(withdrawals.length / ADMIN_PAGE_SIZE)))) }, [withdrawals.length])
  useEffect(() => { setDepositPage(page => Math.min(page, Math.max(1, Math.ceil(deposits.length / ADMIN_PAGE_SIZE)))) }, [deposits.length])

  const action = async body => {
    setWorking(true)
    setError('')
    const { data, error: invokeError } = await supabase.functions.invoke('admin-users', { body })
    if (invokeError || data?.error) {
      setError(cleanAdminCopy(data?.error ?? invokeError?.message ?? 'The action could not be completed.'))
      setWorking(false)
      return false
    }
    let emailWarning = ''
    const emailEvent = body.action === 'review_virtual_withdrawal' ? 'withdrawal_reviewed' : body.action === 'review_virtual_deposit' ? 'deposit_reviewed' : null
    const requestId = body.withdrawal_id || body.deposit_request_id
    if (emailEvent && requestId) {
      try {
        const { data: mailData, error: mailError } = await supabase.functions.invoke('customer-email', { body: { event: emailEvent, request_id: requestId } })
        if (mailError || mailData?.error) emailWarning = ' The customer email could not be sent.'
      } catch { emailWarning = ' The customer email could not be sent.' }
    }
    notify(body.action === 'reset_virtual_wallet' ? 'Customer wallet reset' : 'Wallet control updated')
    setReason('')
    await load()
    if (emailWarning) setError(`The request was updated.${emailWarning}`)
    setWorking(false)
    return true
  }

  const submitFund = async event => {
    event.preventDefault()
    const success = await action({ action: 'fund_virtual_wallet', user_id: funding.id, asset, amount: Number(amount), reason })
    if (success) setFunding(null)
  }
  const fundUser = user => { setFunding(user); setAsset('BTC'); setAmount(''); setReason('') }
  const review = (row, decision) => {
    const note = window.prompt(`Reason for ${decision} (${row.asset} ${fmt(row.amount)}):`)
    if (note?.trim()) action({ action: 'review_virtual_withdrawal', withdrawal_id: row.id, decision, reason: note.trim() })
  }
  const reviewDeposit = (row, decision) => {
    const note = window.prompt(`Reason for ${decision} (${row.asset} ${fmt(row.amount)}):`)
    if (note?.trim()) action({ action: 'review_virtual_deposit', deposit_request_id: row.id, decision, reason: note.trim() })
  }
  const pause = user => {
    const paused = !user.withdrawals_paused
    const note = window.prompt(`Reason for ${paused ? 'pausing' : 'resuming'} withdrawal requests for ${user.email}:`)
    if (note?.trim()) action({ action: 'set_virtual_withdrawals_paused', user_id: user.id, paused, reason: note.trim() })
  }
  const resetWallet = async event => {
    event.preventDefault()
    const customer = customers.find(user => user.id === resetUserId)
    if (!customer) return
    if (!window.confirm(`Reset ${customer.email}'s wallet? This clears balances, wallet history, requests, and saved address references. Admin audit history will be retained.`)) return
    const success = await action({ action: 'reset_virtual_wallet', user_id: customer.id, reason: resetReason.trim() })
    if (success) { setResetUserId(''); setResetReason('') }
  }

  return <section className="admin-wallet-section">
    <div className="admin-list-heading"><div><span className="section-eyebrow">WALLET CONTROLS</span><h3>Balances, deposits & withdrawals</h3></div><button className="admin-refresh" onClick={load} disabled={loading}><RefreshCw size={14}/> Refresh</button></div>
    <div className="wallet-notice"><Wallet size={18}/><span>Balance updates and request decisions are recorded with a reason.</span></div>
    {error && <div className="admin-error">{error}</div>}
    {loading ? <div className="admin-empty">Loading wallet balances…</div> : <>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>CUSTOMER</th><th>ASSET</th><th>AVAILABLE</th><th>ON HOLD</th><th>WITHDRAWALS</th><th>CONTROLS</th></tr></thead><tbody>{balanceRowsPage.map(row => <tr key={`${row.user.id}-${row.asset}`}><td>{row.user.email}</td><td><b>{row.asset}</b></td><td>{fmt(row.available)}</td><td>{fmt(row.held)}</td><td>{row.user.withdrawals_paused ? <span className="status-badge status-suspended">Paused</span> : <span className="status-badge status-active">Open</span>}</td><td><div className="admin-row-actions">{canFund && <button className="restore-btn" onClick={() => fundUser(row.user)}>+ Fund</button>}{canReview && <button className={row.user.withdrawals_paused ? 'restore-btn' : 'restrict-btn'} onClick={() => pause(row.user)}>{row.user.withdrawals_paused ? <Play size={13}/> : <Pause size={13}/>} {row.user.withdrawals_paused ? 'Resume' : 'Pause'}</button>}</div></td></tr>)}</tbody></table>{balanceRows.length === 0 && <div className="admin-empty">No wallet balances found. Run the updated SQL and refresh.</div>}</div>
      {balanceRows.length > 0 && <AdminPagination total={balanceRows.length} page={balancePage} onPage={setBalancePage} label="wallets"/>}
    </>}

    {isAdmin && <form className="admin-wallet-reset" onSubmit={resetWallet}><div><span className="section-eyebrow">ADMIN ONLY · WALLET</span><h4>Reset a customer wallet</h4><p>Balances, wallet history, requests, and saved address references are cleared. The action and reason are recorded.</p></div><label className="admin-field">Customer<select required value={resetUserId} onChange={event => setResetUserId(event.target.value)}><option value="">Select a customer</option>{customers.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label><label className="admin-field">Reason<textarea required minLength={3} maxLength={500} rows={2} value={resetReason} onChange={event => setResetReason(event.target.value)} placeholder="Why are you resetting this wallet?"/></label><button className="wallet-reset-btn" type="submit" disabled={working || !resetUserId}>{working ? 'Resetting…' : 'Reset customer wallet'}</button></form>}

    {canReview && <><div className="admin-list-heading wallet-withdrawal-heading"><div><span className="section-eyebrow">REVIEW QUEUE</span><h3>Withdrawal requests</h3></div><span className="admin-total">{withdrawals.filter(row => ['pending','held'].includes(row.status)).length} open</span></div>
      {withdrawals.length ? <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>CUSTOMER</th><th>REQUEST</th><th>NETWORK / DESTINATION</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{withdrawalRowsPage.map(row => <tr key={row.id}><td>{row.user_email}</td><td>{fmt(row.amount)} {row.asset}</td><td><b className="destination-network">{row.destination_network || 'Network not specified'}</b><br/>{row.destination}</td><td><span className={`status-badge status-${row.status === 'approved' ? 'active' : row.status === 'rejected' ? 'suspended' : 'restricted'}`}>{row.status}</span></td><td><div className="admin-row-actions">{row.status === 'pending' && <button className="restrict-btn" onClick={() => review(row, 'hold')}>Hold</button>}{row.status === 'held' && <button className="restore-btn" onClick={() => review(row, 'release')}>Release</button>}{['pending','held'].includes(row.status) && <><button className="restore-btn" onClick={() => review(row, 'approve')}>Mark processed</button><button className="suspend-btn" onClick={() => review(row, 'reject')}>Reject</button></>}</div></td></tr>)}</tbody></table></div><AdminPagination total={withdrawals.length} page={withdrawalPage} onPage={setWithdrawalPage} label="requests"/></> : <p className="audit-empty">No withdrawal requests have been submitted.</p>}
      <div className="admin-list-heading wallet-withdrawal-heading"><div><span className="section-eyebrow">DEPOSIT REVIEW</span><h3>Deposit requests</h3></div><span className="admin-total">{deposits.filter(row => row.status === 'pending').length} pending</span></div>
      {deposits.length ? <><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>CUSTOMER</th><th>REQUESTED</th><th>REFERENCE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{depositRowsPage.map(row => <tr key={row.id}><td>{row.user_email}</td><td>{fmt(row.amount)} {row.asset}</td><td>{row.reference_note || '—'}</td><td><span className={`status-badge status-${row.status === 'approved' ? 'active' : row.status === 'rejected' ? 'suspended' : 'restricted'}`}>{row.status}</span></td><td><div className="admin-row-actions">{row.status === 'pending' && <><button className="restore-btn" onClick={() => reviewDeposit(row, 'approve')}>Approve</button><button className="suspend-btn" onClick={() => reviewDeposit(row, 'reject')}>Reject</button></>}</div></td></tr>)}</tbody></table></div><AdminPagination total={deposits.length} page={depositPage} onPage={setDepositPage} label="requests"/></> : <p className="audit-empty">No deposit requests have been submitted.</p>}
    </>}

    {funding && <div className="modal-backdrop" onClick={() => setFunding(null)}><section className="admin-action-modal" onClick={event => event.stopPropagation()}><span className="section-eyebrow">CUSTOMER WALLET</span><h2>Fund customer balance</h2><p>Customer: <b>{funding.email}</b></p><form onSubmit={submitFund}><label className="admin-field">Asset<select value={asset} onChange={event => setAsset(event.target.value)}>{ASSETS.map(item => <option key={item}>{item}</option>)}</select></label><label className="admin-field">Amount<input type="number" min="0.00000001" step="any" required value={amount} onChange={event => setAmount(event.target.value)}/></label><label className="admin-field">Reason<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)}/></label><div className="action-modal-buttons"><button type="button" className="cancel-btn" onClick={() => setFunding(null)}>Cancel</button><button className="confirm-action-btn" disabled={working}>{working ? 'Saving…' : 'Add balance'}</button></div></form></section></div>}
  </section>
}
