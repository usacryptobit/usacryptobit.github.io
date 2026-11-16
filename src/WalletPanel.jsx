import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, Clock3, RefreshCw, ShieldCheck, Wallet } from 'lucide-react'
import { supabase } from './supabase'

const ASSETS = ['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC']
const amount = value => Number(value || 0).toLocaleString('en-US',{maximumFractionDigits:8})
const usd = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(value||0))
const statusClass = status => status === 'approved' ? 'active' : status === 'rejected' ? 'suspended' : 'restricted'
const activityLabel = value => (value||'').replace(/demo/gi,'').replaceAll('_',' ').replace(/\s+/g,' ').trim()

export default function WalletPanel({coins,currentUser,notify,accountControl}) {
  const [wallets,setWallets]=useState([]),[ledger,setLedger]=useState([]),[withdrawals,setWithdrawals]=useState([]),[deposits,setDeposits]=useState([])
  const [from,setFrom]=useState('BTC'),[to,setTo]=useState('ETH'),[convertAmount,setConvertAmount]=useState('')
  const [depositAsset,setDepositAsset]=useState('BTC'),[depositAmount,setDepositAmount]=useState(''),[depositReference,setDepositReference]=useState('')
  const [withdrawAsset,setWithdrawAsset]=useState('BTC'),[withdrawAmount,setWithdrawAmount]=useState(''),[destination,setDestination]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const load=useCallback(async()=>{
    if(!currentUser)return
    const [w,l,d,dep]=await Promise.all([
      supabase.from('demo_wallets').select('*').order('asset'),
      supabase.from('demo_wallet_ledger').select('*').order('created_at',{ascending:false}).limit(12),
      supabase.from('demo_withdrawals').select('*').order('created_at',{ascending:false}).limit(8),
      supabase.from('virtual_deposit_requests').select('*').order('created_at',{ascending:false}).limit(8),
    ])
    if(w.error||l.error||d.error||dep.error){setError('Wallet data is unavailable. Run the updated Supabase SQL schema.');return}
    setWallets(w.data??[]);setLedger(l.data??[]);setWithdrawals(d.data??[]);setDeposits(dep.data??[])
  },[currentUser])
  useEffect(()=>{load()},[load])
  const prices=useMemo(()=>Object.fromEntries(coins.map(c=>[c.symbol.toUpperCase(),c.current_price])),[coins])
  const quote=Number(convertAmount)>0&&prices[from]&&prices[to]?Number(convertAmount)*prices[from]/prices[to]*.995:0
  const totalUsd=wallets.reduce((sum,w)=>sum+Number(w.available||0)*Number(prices[w.asset]||0),0)
  const depositWallet=wallets.find(w=>w.asset===depositAsset)
  const perform=async(fn,args,success)=>{
    setBusy(true);setError('')
    const {error:rpcError}=await supabase.rpc(fn,args)
    if(rpcError){setError(rpcError.message);setBusy(false);return false}
    notify(success);await load();setBusy(false);return true
  }
  const convert=async e=>{
    e.preventDefault()
    if(!prices[from]||!prices[to]){setError('A live price quote is not available yet.');return}
    if(await perform('demo_convert',{p_from_asset:from,p_to_asset:to,p_from_amount:Number(convertAmount),p_exchange_rate:prices[from]/prices[to]},'Conversion completed'))setConvertAmount('')
  }
  const requestDeposit=async e=>{
    e.preventDefault()
    if(await perform('virtual_request_deposit',{p_asset:depositAsset,p_amount:Number(depositAmount),p_reference_note:depositReference||null},'Deposit request submitted')){setDepositAmount('');setDepositReference('')}
  }
  const withdraw=async e=>{
    e.preventDefault()
    if(await perform('demo_request_withdrawal',{p_asset:withdrawAsset,p_amount:Number(withdrawAmount),p_destination:destination},'Withdrawal request submitted')){setWithdrawAmount('');setDestination('')}
  }
  return <section className="wallet-page">
    <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> PERSONAL ACCOUNT</div><h1>Wallet</h1><p>Manage balances, deposits, conversions, and withdrawals.</p></div><button className="admin-refresh" onClick={load}><RefreshCw size={15}/> Refresh</button></div>
    <div className="wallet-notice"><ShieldCheck size={19}/><span><b>Virtual Wallet</b> — balances and transactions are simulated. Wallet IDs are for display only. Deposits, transfers, and withdrawals do not move cryptocurrency or money.</span></div>
    {accountControl?.status&&accountControl.status!=='active'&&<div className={`account-status-banner account-${accountControl.status}`}><ShieldCheck size={17}/><span>Account {accountControl.status}. Wallet operations require an active account.</span></div>}
    {accountControl?.withdrawals_paused&&<div className="account-status-banner account-restricted"><ShieldCheck size={17}/><span>Withdrawal requests are paused. {accountControl.withdrawal_pause_reason}</span></div>}
    {error&&<div className="admin-error">{error}</div>}
    <div className="wallet-summary"><span>Total wallet value</span><strong>{usd(totalUsd)}</strong><small>Across {wallets.length} assets</small></div>
    <div className="wallet-grid">{wallets.map(w=><article className="wallet-card" key={w.asset}><div className="wallet-card-top"><span className="wallet-coin-icon">{w.asset.slice(0,1)}</span></div><b>{w.asset}</b><strong>{amount(w.available)}</strong><span>Available balance</span><small>On hold: {amount(w.held)}</small><span className="wallet-id-label">Wallet ID</span><code title="Display ID only">{w.asset}-{w.user_id.replaceAll('-','').slice(0,12).toUpperCase()}</code><small className="wallet-usd-value">{usd(Number(w.available)*Number(prices[w.asset]||0))}</small></article>)}</div>
    <div className="wallet-actions-grid">
      <form className="wallet-form-card" onSubmit={requestDeposit}>
        <div className="section-title"><div><span className="section-eyebrow">ADD FUNDS</span><h3>Deposit</h3></div><Wallet size={19}/></div>
        <label>Asset<select value={depositAsset} onChange={e=>setDepositAsset(e.target.value)}>{ASSETS.map(a=><option key={a}>{a}</option>)}</select></label>
        <label>Amount<input type="number" min="0" step="any" required value={depositAmount} onChange={e=>setDepositAmount(e.target.value)} placeholder="0.00"/></label>
        <label>Reference (optional)<input maxLength="200" value={depositReference} onChange={e=>setDepositReference(e.target.value)} placeholder="Add a reference for review"/></label>
        <div className="wallet-quote"><span>Wallet ID</span><b className="wallet-reference">{depositWallet?`${depositAsset}-${depositWallet.user_id.replaceAll('-','').slice(0,12).toUpperCase()}`:'Loading…'}</b><small>Use this ID as the reference for your deposit request.</small></div>
        <button className="submit-btn" disabled={busy||(accountControl?.status!=null&&accountControl.status!=='active')}>{busy?'Processing…':'Submit deposit request →'}</button>
      </form>
      <form className="wallet-form-card" onSubmit={convert}>
        <div className="section-title"><div><span className="section-eyebrow">MARKET CONVERSION</span><h3>Convert</h3></div><ArrowDownUp size={19}/></div>
        <label>From<select value={from} onChange={e=>{setFrom(e.target.value);if(to===e.target.value)setTo(ASSETS.find(a=>a!==e.target.value))}}>{ASSETS.map(a=><option key={a}>{a}</option>)}</select></label>
        <label>Amount<input type="number" min="0" step="any" required value={convertAmount} onChange={e=>setConvertAmount(e.target.value)} placeholder="0.00"/></label>
        <label>To<select value={to} onChange={e=>setTo(e.target.value)}>{ASSETS.filter(a=>a!==from).map(a=><option key={a}>{a}</option>)}</select></label>
        <div className="wallet-quote"><span>Estimated amount</span><b>{amount(quote)} {to}</b><small>Market quote includes a 0.5% conversion fee.</small></div>
        <button className="submit-btn" disabled={busy||(accountControl?.status!=null&&accountControl.status!=='active')}>{busy?'Processing…':'Convert now →'}</button>
      </form>
      <form className="wallet-form-card" onSubmit={withdraw}>
        <div className="section-title"><div><span className="section-eyebrow">SEND FUNDS</span><h3>Withdraw</h3></div><Wallet size={19}/></div>
        <label>Asset<select value={withdrawAsset} onChange={e=>setWithdrawAsset(e.target.value)}>{ASSETS.map(a=><option key={a}>{a}</option>)}</select></label>
        <label>Amount<input type="number" min="0" step="any" required value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)} placeholder="0.00"/></label>
        <label>Destination address<input required minLength="4" maxLength="200" value={destination} onChange={e=>setDestination(e.target.value)} placeholder="Enter destination address"/></label>
        <div className="wallet-quote"><span>Request status</span><b>Administrator review</b><small>You'll see status updates in your withdrawal history.</small></div>
        <button className="submit-btn" disabled={busy||(accountControl?.status!=null&&accountControl.status!=='active')||accountControl?.withdrawals_paused}>{busy?'Processing…':'Request withdrawal →'}</button>
      </form>
    </div>
    <div className="admin-audit wallet-history"><div className="admin-list-heading"><div><span className="section-eyebrow">ACTIVITY</span><h3>Recent wallet activity</h3></div><span className="admin-total">{ledger.length} entries</span></div>{ledger.length?<div className="audit-list">{ledger.map(row=><article key={row.id}><span className="audit-icon"><Clock3 size={15}/></span><div><b>{row.asset} · {activityLabel(row.entry_type)}</b><span>{row.available_delta>0?'+':''}{amount(row.available_delta)} available{row.held_delta?` · ${row.held_delta>0?'+':''}${amount(row.held_delta)} held`:''}</span><small>{activityLabel(row.note)}</small></div><time>{new Date(row.created_at).toLocaleString()}</time></article>)}</div>:<p className="audit-empty">Wallet activity will appear here.</p>}</div>
    <div className="admin-audit wallet-history"><div className="admin-list-heading"><div><span className="section-eyebrow">DEPOSITS</span><h3>Deposit history</h3></div><span className="admin-total">{deposits.length} requests</span></div>{deposits.length?<div className="audit-list">{deposits.map(row=><article key={row.id}><span className={`status-badge status-${statusClass(row.status)}`}>{row.status}</span><div><b>{amount(row.amount)} {row.asset}</b><span>{row.reference_note||'Deposit request'}</span><small>{row.reason||'Awaiting review'}</small></div><time>{new Date(row.created_at).toLocaleString()}</time></article>)}</div>:<p className="audit-empty">No deposit requests yet.</p>}</div>
    <div className="admin-audit wallet-history"><div className="admin-list-heading"><div><span className="section-eyebrow">WITHDRAWALS</span><h3>Withdrawal history</h3></div><span className="admin-total">{withdrawals.length} requests</span></div>{withdrawals.length?<div className="audit-list">{withdrawals.map(row=><article key={row.id}><span className={`status-badge status-${statusClass(row.status)}`}>{row.status}</span><div><b>{amount(row.amount)} {row.asset}</b><span>{row.destination}</span><small>{row.reason||'Awaiting review'}</small></div><time>{new Date(row.created_at).toLocaleString()}</time></article>)}</div>:<p className="audit-empty">No withdrawal requests yet.</p>}</div>
  </section>
}
