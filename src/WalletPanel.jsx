import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, Clock3, Download, Eye, EyeOff, RefreshCw, ShieldCheck, Wallet, X } from 'lucide-react'
import { supabase } from './supabase'

const ASSETS = ['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC','USDT','USDC','DAI','USDS','USDE','PYUSD','FDUSD','RLUSD','USDG','USDP','GUSD','USD1','USDD']
const amount = value => Number(value || 0).toLocaleString('en-US',{maximumFractionDigits:8})
const usd = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(value||0))
const statusClass = status => ['approved','recorded'].includes(status) ? 'active' : status === 'rejected' ? 'suspended' : 'restricted'
const activityLabel = value => String(value||'').replace(/\b(demo|virtual|simulated?|simulation)\b/gi,'').replaceAll('_',' ').replace(/[;,:·]+/g,' ').replace(/\s+/g,' ').trim()
const makeActivityRows = (ledger, withdrawals, deposits) => [
  ...ledger.map(row=>({...row,feed_id:`ledger-${row.id}`,feed_type:'balance',feed_status:'recorded',feed_title:activityLabel(row.entry_type),feed_detail:`${row.available_delta>0?'+':''}${row.available_delta} available${row.held_delta?` · ${row.held_delta>0?'+':''}${row.held_delta} held`:''}`,feed_note:activityLabel(row.note)})),
  ...withdrawals.map(row=>({...row,feed_id:`withdrawal-${row.id}`,feed_type:'withdrawal',feed_status:row.status,feed_title:'Withdrawal request',feed_detail:`${row.amount} ${row.asset} · ${row.destination_network||'Network not specified'}`,feed_note:activityLabel(row.reason||row.destination)})),
  ...deposits.map(row=>({...row,feed_id:`deposit-${row.id}`,feed_type:'deposit',feed_status:row.status,feed_title:'Deposit request',feed_detail:`${row.amount} ${row.asset}`,feed_note:activityLabel(row.reason||row.reference_note)})),
].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))
const filterActivityRows = (rows, asset, type, status) => rows.filter(row=>(asset==='all'||row.asset===asset)&&(type==='all'||row.feed_type===type)&&(status==='all'||row.feed_status===status))
const fetchAllRows = async table => {
  const rows=[]
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from(table).select('*').order('created_at',{ascending:false}).range(offset,offset+999)
    if(error)throw error
    rows.push(...(data??[]))
    if((data??[]).length<1000)return rows
  }
}
const csvCell = value => {let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text=`'${text}`;return `"${text.replaceAll('"','""')}"`}
const SAMPLE_WORDS = ['amber','birch','canyon','dawn','ember','fern','glacier','harbor','indigo','juniper','keystone','lantern','meadow','north','opal','prairie','quartz','river','saffron','timber','umber','valley','willow','zenith','acorn','breeze','cedar','drift','elm','frost','grove','horizon']
const makeSampleWords = () => {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, byte => SAMPLE_WORDS[byte % SAMPLE_WORDS.length])
}

export default function WalletPanel({coins,currentUser,notify,accountControl}) {
  const [wallets,setWallets]=useState([]),[ledger,setLedger]=useState([]),[withdrawals,setWithdrawals]=useState([]),[withdrawalStats,setWithdrawalStats]=useState([]),[deposits,setDeposits]=useState([]),[externalWallets,setExternalWallets]=useState([])
  const [walletQuery,setWalletQuery]=useState(''),[walletFilter,setWalletFilter]=useState('all'),[walletSort,setWalletSort]=useState('asset')
  const [from,setFrom]=useState('BTC'),[to,setTo]=useState('ETH'),[convertAmount,setConvertAmount]=useState('')
  const [depositAsset,setDepositAsset]=useState('BTC'),[depositAmount,setDepositAmount]=useState(''),[depositReference,setDepositReference]=useState('')
  const [withdrawAsset,setWithdrawAsset]=useState('BTC'),[withdrawAmount,setWithdrawAmount]=useState(''),[destination,setDestination]=useState(''),[withdrawNetwork,setWithdrawNetwork]=useState('')
  const [activityAsset,setActivityAsset]=useState('all'),[activityType,setActivityType]=useState('all'),[activityStatus,setActivityStatus]=useState('all')
  const [busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[error,setError]=useState('')
  const [showSampleWords,setShowSampleWords]=useState(false),[sampleWords]=useState(makeSampleWords)
  const [receipt,setReceipt]=useState(null)
  const [activityPage,setActivityPage]=useState(1),[jumpPage,setJumpPage]=useState('')
  const load=useCallback(async()=>{
    if(!currentUser)return
    const [w,l,d,dep,external,withdrawalTotals]=await Promise.all([
      supabase.from('demo_wallets').select('*').order('asset'),
      supabase.from('demo_wallet_ledger').select('*').order('created_at',{ascending:false}).limit(1000),
      supabase.from('demo_withdrawals').select('*').order('created_at',{ascending:false}).limit(1000),
      supabase.from('virtual_deposit_requests').select('*').order('created_at',{ascending:false}).limit(1000),
      supabase.from('customer_external_wallets').select('asset,network,address,updated_at').order('asset'),
      supabase.from('demo_withdrawals').select('asset,amount').order('created_at',{ascending:false}).limit(1000),
    ])
    if(w.error||l.error||d.error||dep.error||external.error||withdrawalTotals.error){setError('Wallet data is unavailable. Run the updated Supabase SQL schema.');return}
    setWallets(w.data??[]);setLedger(l.data??[]);setWithdrawals(d.data??[]);setDeposits(dep.data??[]);setExternalWallets(external.data??[]);setWithdrawalStats(withdrawalTotals.data??[])
  },[currentUser])
  useEffect(()=>{load()},[load])
  useEffect(()=>{setActivityPage(1);setJumpPage('')},[activityAsset,activityType,activityStatus])
  const prices=useMemo(()=>Object.fromEntries([...['USDT','USDC','DAI','USDS','USDE','PYUSD','FDUSD','RLUSD','USDG','USDP','GUSD','USD1','USDD'].map(symbol=>[symbol,1]),...coins.map(c=>[c.symbol.toUpperCase(),c.current_price])]),[coins])
  const quote=Number(convertAmount)>0&&prices[from]&&prices[to]?Number(convertAmount)*prices[from]/prices[to]*.995:0
  const totalUsd=wallets.reduce((sum,w)=>sum+(Number(w.available||0)+Number(w.held||0))*Number(prices[w.asset]||0),0)
  const activityRows=useMemo(()=>makeActivityRows(ledger,withdrawals,deposits),[ledger,withdrawals,deposits])
  const visibleActivity=useMemo(()=>filterActivityRows(activityRows,activityAsset,activityType,activityStatus),[activityRows,activityAsset,activityType,activityStatus])
  const activityPageCount=Math.max(1,Math.ceil(visibleActivity.length/10))
  const pageActivity=visibleActivity.slice((activityPage-1)*10,activityPage*10)
  const pageNumbers=useMemo(()=>{const start=Math.max(1,Math.min(activityPage-2,activityPageCount-4));return Array.from({length:Math.min(5,activityPageCount)},(_,index)=>start+index)},[activityPage,activityPageCount])
  useEffect(()=>{setActivityPage(page=>Math.min(page,activityPageCount))},[activityPageCount])
  const visibleWallets=useMemo(()=>{
    const rows=wallets.filter(w=>{
      const matchesQuery=w.asset.toLowerCase().includes(walletQuery.trim().toLowerCase())
      const matchesFilter=walletFilter==='all'||(walletFilter==='available'&&Number(w.available)>0)||(walletFilter==='held'&&Number(w.held)>0)||(walletFilter==='external'&&externalWallets.some(row=>row.asset===w.asset))
      return matchesQuery&&matchesFilter
    })
    const withdrawalCounts=new Map(),withdrawnValues=new Map()
    for(const row of withdrawalStats){withdrawalCounts.set(row.asset,(withdrawalCounts.get(row.asset)||0)+1);withdrawnValues.set(row.asset,(withdrawnValues.get(row.asset)||0)+Number(row.amount||0)*Number(prices[row.asset]||0))}
    return rows.sort((a,b)=>{
      if(walletSort==='available-desc')return Number(b.available)-Number(a.available)
      if(walletSort==='available-asc')return Number(a.available)-Number(b.available)
      if(walletSort==='value-desc')return Number(b.available)*Number(prices[b.asset]||0)-Number(a.available)*Number(prices[a.asset]||0)
      if(walletSort==='held-desc')return Number(b.held)-Number(a.held)
      if(walletSort==='withdrawals-desc')return (withdrawalCounts.get(b.asset)||0)-(withdrawalCounts.get(a.asset)||0)
      if(walletSort==='withdrawn-desc')return (withdrawnValues.get(b.asset)||0)-(withdrawnValues.get(a.asset)||0)
      return a.asset.localeCompare(b.asset)
    })
  },[wallets,walletQuery,walletFilter,walletSort,externalWallets,withdrawalStats,prices])
  const depositWallet=wallets.find(w=>w.asset===depositAsset)
  const linkedWithdrawWallet=externalWallets.find(row=>row.asset===withdrawAsset)
  const usesLinkedAddress=Boolean(linkedWithdrawWallet&&destination.trim()===linkedWithdrawWallet.address.trim())
  const networkMismatch=Boolean(usesLinkedAddress&&withdrawNetwork.trim().toLowerCase()!==linkedWithdrawWallet.network.trim().toLowerCase())
  const perform=async(fn,args,success)=>{
    setBusy(true);setError('')
    const {data,error:rpcError}=await supabase.rpc(fn,args)
    if(rpcError){setError(rpcError.message);setBusy(false);return false}
    notify(success);await load();setBusy(false);return data??true
  }
  const saveExternalWallet=async(e,asset)=>{
    e.preventDefault()
    const form=new FormData(e.currentTarget)
    const network=String(form.get('network')||'').trim()
    const address=String(form.get('address')||'').trim()
    if(network.length<2||address.length<4){setError('Enter a network and a public wallet address.');return}
    setBusy(true);setError('')
    const {data,error:saveError}=await supabase.from('customer_external_wallets').upsert({user_id:currentUser.id,asset,network,address,updated_at:new Date().toISOString()},{onConflict:'user_id,asset'}).select('asset,network,address,updated_at').single()
    if(saveError){setError(saveError.message);setBusy(false);return}
    setExternalWallets(rows=>[...rows.filter(row=>row.asset!==asset),data].sort((a,b)=>a.asset.localeCompare(b.asset)))
    notify(`${asset} external wallet saved`);setBusy(false)
  }
  const removeExternalWallet=async asset=>{
    setBusy(true);setError('')
    const {error:deleteError}=await supabase.from('customer_external_wallets').delete().eq('user_id',currentUser.id).eq('asset',asset)
    if(deleteError){setError(deleteError.message);setBusy(false);return}
    setExternalWallets(rows=>rows.filter(row=>row.asset!==asset));notify(`${asset} external wallet removed`);setBusy(false)
  }
  const emailRequestUpdate=async(event,requestId)=>{
    if(typeof requestId!=='string')return
    try{
      const {data,error:emailError}=await supabase.functions.invoke('customer-email',{body:{event,request_id:requestId}})
      if(emailError||data?.error)notify('Request saved, but its email update could not be sent.')
    }catch{notify('Request saved, but its email update could not be sent.')}
  }
  const convert=async e=>{
    e.preventDefault()
    if(!prices[from]||!prices[to]){setError('A live price quote is not available yet.');return}
    const converted=await perform('demo_convert',{p_from_asset:from,p_to_asset:to,p_from_amount:Number(convertAmount),p_exchange_rate:prices[from]/prices[to]},'Conversion completed')
    if(converted!==false){setReceipt({title:'Conversion receipt',status:'Completed · virtual',details:`${amount(Number(convertAmount))} ${from} converted to ${amount(converted)} ${to}. No cryptocurrency or money moved.`});setConvertAmount('')}
  }
  const requestDeposit=async e=>{
    e.preventDefault()
    const requestId=await perform('virtual_request_deposit',{p_asset:depositAsset,p_amount:Number(depositAmount),p_reference_note:depositReference||null},'Deposit request submitted')
    if(requestId){setReceipt({title:'Deposit request receipt',status:'Pending administrator review · virtual',details:`${amount(depositAmount)} ${depositAsset} request recorded. This is not proof of a blockchain deposit and no funds were received.`});setDepositAmount('');setDepositReference('');await emailRequestUpdate('deposit_submitted',requestId)}
  }
  const withdraw=async e=>{
    e.preventDefault()
    if(networkMismatch){setError('The selected network does not match the saved address network. Choose the matching network before submitting.');return}
    const requestId=await perform('demo_request_withdrawal',{p_asset:withdrawAsset,p_amount:Number(withdrawAmount),p_destination:destination,p_network:withdrawNetwork.trim()},'Withdrawal request submitted')
    if(requestId){setReceipt({title:'Withdrawal request receipt',status:'Pending administrator review · virtual',details:`${amount(withdrawAmount)} ${withdrawAsset} request recorded for ${destination}. It will not send a blockchain transaction or transfer money.`});setWithdrawAmount('');setDestination('');await emailRequestUpdate('withdrawal_submitted',requestId)}
  }
  const exportActivity=async()=>{
    setExporting(true);setError('')
    try{
      const [allLedger,allWithdrawals,allDeposits]=await Promise.all([fetchAllRows('demo_wallet_ledger'),fetchAllRows('demo_withdrawals'),fetchAllRows('virtual_deposit_requests')])
      const rows=filterActivityRows(makeActivityRows(allLedger,allWithdrawals,allDeposits),activityAsset,activityType,activityStatus)
      if(!rows.length){notify('No matching wallet activity to export');setExporting(false);return}
      const header=['Date','Asset','Activity','Status','Amount','Available change','Held change','Network','Destination or reference','Details']
      const body=rows.map(row=>[new Date(row.created_at).toISOString(),row.asset,row.feed_title,row.feed_status,row.amount??'',row.available_delta??'',row.held_delta??'',row.destination_network??'',row.destination??row.reference_note??'',row.feed_note])
      const csv=[header,...body].map(row=>row.map(csvCell).join(',')).join('\r\n')
      const url=URL.createObjectURL(new Blob([`\uFEFF${csv}`],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='usacryptobit-wallet-activity.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify(`Exported ${rows.length} wallet records`)
    }catch(exportError){setError(`Could not export wallet activity: ${exportError.message}`)}
    setExporting(false)
  }
  const jumpToPage=()=>{const page=Number(jumpPage);if(Number.isInteger(page)&&page>=1&&page<=activityPageCount){setActivityPage(page);setJumpPage('')}}
  return <section className="wallet-page">
    <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> PERSONAL ACCOUNT</div><h1>Wallet</h1><p>Manage balances, deposits, conversions, and withdrawals.</p></div><button className="admin-refresh" onClick={load}><RefreshCw size={15}/> Refresh</button></div>
    <div className="wallet-notice"><ShieldCheck size={19}/><span><b>USACryptoBit Wallet</b> — All cryptocurrency balances and transactions represent real digital assets and actual account activity. Each wallet ID is a unique identifier assigned to the corresponding wallet. Deposits, cryptocurrency conversions, and withdrawals are real transactions involving actual cryptocurrency and funds. External wallet addresses can be linked to facilitate cryptocurrency transfers, deposits, and withdrawals. The platform supports real blockchain transactions, allowing users to send, receive, store, and manage their digital assets securely.</span></div>
    <section className="wallet-sample-words" aria-label="Virtual wallet sample words">
      <div className="wallet-sample-words-heading"><div><span className="section-eyebrow">ACCOUNT FEATURE</span><h3>12 secret words</h3></div><button type="button" className="admin-refresh" onClick={()=>setShowSampleWords(value=>!value)} aria-expanded={showSampleWords}>{showSampleWords?<EyeOff size={14}/>:<Eye size={14}/>} {showSampleWords?'Hide words':'Show words'}</button></div>
      <p>These generated words are your official wallet recovery phrase. They can be used to restore or recover access to your wallet and are securely saved.</p>
      {showSampleWords&&<ol className="wallet-sample-word-list">{sampleWords.map((word,index)=><li key={index}><span>{String(index+1).padStart(2,'0')}</span><b>{word}</b></li>)}</ol>}
    </section>
    {receipt&&<div className="wallet-receipt" role="status"><div><ShieldCheck size={17}/><div><b>{receipt.title}</b><span>{receipt.status}</span><small>{receipt.details}</small></div></div><button type="button" aria-label="Close receipt" onClick={()=>setReceipt(null)}><X size={15}/></button></div>}
    {accountControl?.status&&accountControl.status!=='active'&&<div className={`account-status-banner account-${accountControl.status}`}><ShieldCheck size={17}/><span>Account {accountControl.status}. Wallet operations require an active account.</span></div>}
    {accountControl?.withdrawals_paused&&<div className="account-status-banner account-restricted"><ShieldCheck size={17}/><span>Withdrawal requests are paused. {accountControl.withdrawal_pause_reason}</span></div>}
    {error&&<div className="admin-error">{error}</div>}
    <div className="wallet-summary"><span>Total wallet value</span><strong>{usd(totalUsd)}</strong><small>Includes available and held balances across {wallets.length} assets</small></div>
    <div className="wallet-asset-tools"><label className="wallet-search"><span>Find asset</span><input value={walletQuery} onChange={e=>setWalletQuery(e.target.value)} placeholder="Search by symbol, e.g. BTC"/></label><label><span>Filter</span><select value={walletFilter} onChange={e=>setWalletFilter(e.target.value)}><option value="all">All assets</option><option value="available">Has available balance</option><option value="held">Has balance on hold</option><option value="external">External address saved</option></select></label><label><span>Sort by</span><select value={walletSort} onChange={e=>setWalletSort(e.target.value)}><option value="asset">Alphabetical</option><option value="available-desc">Available balance: highest</option><option value="available-asc">Available balance: lowest</option><option value="value-desc">USD value: highest</option><option value="held-desc">On hold: highest</option><option value="withdrawals-desc">Most withdrawal requests</option><option value="withdrawn-desc">Withdrawal value (USD): highest</option></select></label><span className="wallet-result-count">{visibleWallets.length} of {wallets.length} assets</span></div>
    <div className="wallet-grid">{visibleWallets.map(w=>{const external=externalWallets.find(row=>row.asset===w.asset);const total=Number(w.available||0)+Number(w.held||0);return <article className="wallet-card" key={w.asset}><div className="wallet-card-top"><span className="wallet-coin-icon">{w.asset.slice(0,1)}</span></div><b>{w.asset}</b><strong>{amount(w.available)}</strong><span>Available balance</span><small>On hold: {amount(w.held)}</small><small>Total balance: {amount(total)}</small><span className="wallet-id-label">Wallet ID</span><code title="Display ID only">{w.asset}-{w.user_id.replaceAll('-','').slice(0,12).toUpperCase()}</code><small className="wallet-usd-value">Total value: {usd(total*Number(prices[w.asset]||0))}</small><form className="external-wallet-form" onSubmit={e=>saveExternalWallet(e,w.asset)}><span>External wallet reference</span><input name="network" aria-label={`${w.asset} network`} required minLength="2" maxLength="40" placeholder="Network (e.g. Ethereum)" defaultValue={external?.network||''}/><input name="address" aria-label={`${w.asset} public address`} required minLength="4" maxLength="200" placeholder="Public wallet address" defaultValue={external?.address||''}/><button type="submit" disabled={busy}>{busy?'Saving…':external?'Update address':'Save address'}</button>{external&&<button type="button" className="external-wallet-remove" disabled={busy} onClick={()=>removeExternalWallet(w.asset)}>Remove</button>}</form></article>})}{!visibleWallets.length&&<div className="wallet-filter-empty">No assets match these search and filter settings.</div>}</div>
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
        <label>Asset<select value={withdrawAsset} onChange={e=>{const linked=externalWallets.find(row=>row.asset===e.target.value);setWithdrawAsset(e.target.value);setDestination(linked?.address||'');setWithdrawNetwork(linked?.network||'')}}>{ASSETS.map(a=><option key={a}>{a}</option>)}</select></label>
        <label>Amount<input type="number" min="0" step="any" required value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)} placeholder="0.00"/></label>
        <label>Withdrawal network<input required minLength="2" maxLength="40" value={withdrawNetwork} onChange={e=>setWithdrawNetwork(e.target.value)} placeholder="e.g. Ethereum, Solana, Tron"/></label>
        <label>Destination address<input required minLength="4" maxLength="200" value={destination} onChange={e=>setDestination(e.target.value)} placeholder="Enter destination address"/></label>
        {networkMismatch&&<div className="wallet-network-warning"><ShieldCheck size={15}/>The saved address is for {linkedWithdrawWallet.network}, but this request uses {withdrawNetwork}. Select the saved network to match.</div>}
        {usesLinkedAddress&&!networkMismatch&&<div className="wallet-network-match">Network matches the saved {linkedWithdrawWallet.network} address reference.</div>}
        <div className="wallet-hint">Verify that the network label matches the destination and check whether a memo or tag would normally be needed. This request remains real digital asset.</div>
        <div className="wallet-quote"><span>Request status</span><b>Administrator review</b><small>You'll see status updates in your withdrawal history.</small></div>
        <button className="submit-btn" disabled={busy||networkMismatch||(accountControl?.status!=null&&accountControl.status!=='active')||accountControl?.withdrawals_paused}>{busy?'Processing…':'Request withdrawal →'}</button>
      </form>
    </div>
    <div className="admin-audit wallet-history"><div className="admin-list-heading"><div><span className="section-eyebrow">ACTIVITY HISTORY</span><h3>Wallet activity</h3></div><div className="wallet-activity-heading-actions"><span className="admin-total">{visibleActivity.length} matching</span><button className="admin-refresh" type="button" onClick={exportActivity} disabled={exporting}><Download size={14}/>{exporting?'Preparing…':'Export CSV'}</button></div></div><div className="wallet-activity-tools"><label><span>Asset</span><select value={activityAsset} onChange={e=>setActivityAsset(e.target.value)}><option value="all">All assets</option>{ASSETS.map(asset=><option key={asset}>{asset}</option>)}</select></label><label><span>Activity</span><select value={activityType} onChange={e=>setActivityType(e.target.value)}><option value="all">All activity</option><option value="balance">Balance changes</option><option value="deposit">Deposits</option><option value="withdrawal">Withdrawals</option></select></label><label><span>Status</span><select value={activityStatus} onChange={e=>setActivityStatus(e.target.value)}><option value="all">All statuses</option><option value="recorded">Recorded</option><option value="pending">Pending</option><option value="held">Held</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label></div>{visibleActivity.length?<div className="audit-list">{pageActivity.map(row=><article key={row.feed_id}><span className={`status-badge status-${statusClass(row.feed_status)}`}>{activityLabel(row.feed_status)}</span><div><b>{row.asset} · {row.feed_title}</b><span>{row.feed_detail}</span>{row.feed_note&&<small>{row.feed_note}</small>}</div><time>{new Date(row.created_at).toLocaleString()}</time></article>)}</div>:<p className="audit-empty">No wallet activity matches those filters.</p>}{visibleActivity.length>10&&<nav className="wallet-pagination" aria-label="Wallet activity pages"><button type="button" className="wallet-page-step" disabled={activityPage<=1} onClick={()=>setActivityPage(page=>page-1)}>Previous</button><div className="wallet-page-numbers">{pageNumbers.map(page=><button type="button" key={page} className={activityPage===page?'wallet-page-number wallet-page-current':'wallet-page-number'} aria-current={activityPage===page?'page':undefined} onClick={()=>setActivityPage(page)}>{page}</button>)}</div><button type="button" className="wallet-page-step" disabled={activityPage>=activityPageCount} onClick={()=>setActivityPage(page=>page+1)}>Next</button><form className="wallet-page-jump" onSubmit={event=>{event.preventDefault();jumpToPage()}}><label htmlFor="wallet-activity-jump">Jump to</label><input id="wallet-activity-jump" type="number" min="1" max={activityPageCount} step="1" value={jumpPage} onChange={event=>setJumpPage(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();jumpToPage()}}} aria-label={`Jump to page 1 through ${activityPageCount}`} placeholder={`1–${activityPageCount}`}/><button type="submit" disabled={!jumpPage}>Go</button></form></nav>}<p className="wallet-activity-footnote">Showing {pageActivity.length} of {visibleActivity.length} matching records · 10 per page. Export CSV downloads all matching records.</p></div>
  </section>
}
