import { useEffect, useRef, useState } from 'react'
import { Bell, Check, Clock3, X } from 'lucide-react'
import { supabase } from './supabase'

const amount = value => Number(value || 0).toLocaleString('en-US',{maximumFractionDigits:8})
const timeLabel = value => value ? new Date(value).toLocaleString() : ''

export default function NotificationCenter({ user, accountControl, onOpenWallet, onSignIn }) {
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[items,setItems]=useState([]),[error,setError]=useState('')
  const root=useRef(null)

  useEffect(()=>{
    const closeOnOutside=event=>{if(root.current&&!root.current.contains(event.target))setOpen(false)}
    const closeOnEscape=event=>{if(event.key==='Escape')setOpen(false)}
    document.addEventListener('pointerdown',closeOnOutside)
    document.addEventListener('keydown',closeOnEscape)
    return()=>{document.removeEventListener('pointerdown',closeOnOutside);document.removeEventListener('keydown',closeOnEscape)}
  },[])

  useEffect(()=>{
    if(!open||!user)return
    let live=true
    setLoading(true);setError('')
    Promise.all([
      supabase.from('virtual_deposit_requests').select('id,asset,amount,status,reason,created_at').order('created_at',{ascending:false}).limit(5),
      supabase.from('demo_withdrawals').select('id,asset,amount,status,reason,created_at').order('created_at',{ascending:false}).limit(5),
    ]).then(([depositResult,withdrawalResult])=>{
      if(!live)return
      if(depositResult.error||withdrawalResult.error){setError('Updates are unavailable right now.');setItems([]);return}
      const updates=[
        ...(depositResult.data||[]).map(row=>({id:`deposit-${row.id}`,title:`Deposit request ${row.status}`,detail:`${amount(row.amount)} ${row.asset}${row.reason?` · ${row.reason}`:''}`,created_at:row.created_at})),
        ...(withdrawalResult.data||[]).map(row=>({id:`withdrawal-${row.id}`,title:`Withdrawal request ${row.status}`,detail:`${amount(row.amount)} ${row.asset}${row.reason?` · ${row.reason}`:''}`,created_at:row.created_at})),
      ]
      if(accountControl?.status&&accountControl.status!=='active')updates.push({id:'account-status',title:`Account ${accountControl.status}`,detail:accountControl.reason||'Some account features may be limited.',created_at:null})
      if(accountControl?.withdrawals_paused)updates.push({id:'withdrawals-paused',title:'Withdrawals paused',detail:accountControl.withdrawal_pause_reason||'Withdrawal requests are temporarily unavailable.',created_at:null})
      setItems(updates.sort((a,b)=>(new Date(b.created_at||0))-(new Date(a.created_at||0))).slice(0,8))
    }).catch(()=>{if(live)setError('Updates are unavailable right now.')}).finally(()=>{if(live)setLoading(false)})
    return()=>{live=false}
  },[open,user,accountControl])

  const pendingCount=items.filter(item=>/pending|paused|restricted|suspended/i.test(item.title)).length
  return <div className="notification-wrap" ref={root}>
    <button className="icon-button notification" type="button" title="Notifications" aria-label="Notifications" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <Bell size={17}/>{pendingCount>0&&user&&<span className="notification-count">{pendingCount>9?'9+':pendingCount}</span>}
    </button>
    {open&&<section className="notification-panel" aria-label="Notifications">
      <div className="notification-panel-heading"><div><span className="section-eyebrow">ACCOUNT UPDATES</span><h3>Notifications</h3></div><button type="button" className="notification-close" onClick={()=>setOpen(false)} aria-label="Close notifications"><X size={16}/></button></div>
      {!user?<div className="notification-empty"><Bell size={20}/><b>Sign in to view updates</b><span>Account activity appears here.</span><button type="button" onClick={()=>{setOpen(false);onSignIn()}}>Sign in</button></div>:loading?<div className="notification-empty"><span className="spinner"/><span>Loading updates…</span></div>:error?<div className="notification-empty"><b>Could not load updates</b><span>{error}</span></div>:items.length?<div className="notification-list">{items.map(item=><button type="button" className="notification-item" key={item.id} onClick={()=>{setOpen(false);onOpenWallet()}}><span className="notification-item-icon">{/approved|processed/i.test(item.title)?<Check size={14}/>:<Clock3 size={14}/>}</span><span className="notification-item-copy"><b>{item.title}</b><span>{item.detail}</span><small>{timeLabel(item.created_at)}</small></span></button>)}</div>:<div className="notification-empty"><Check size={20}/><b>You’re all caught up</b><span>No account updates yet.</span></div>}
    </section>}
  </div>
}
