import { useEffect, useMemo, useState } from 'react'
import { Shield, UserPlus, UserRoundCog } from 'lucide-react'
import { supabase } from './supabase'

const PERMISSIONS=[
  {id:'customer_access',title:'Customer access',description:'Restrict, suspend, and restore assigned customer accounts.'},
  {id:'support_messages',title:'Support messages',description:'Read and reply to conversations for assigned customers.'},
  {id:'wallet_funding',title:'Wallet funding',description:'Add balance to assigned customer accounts.'},
  {id:'wallet_requests',title:'Deposit and withdrawal review',description:'Review assigned customers’ requests and pause withdrawals.'},
]

export default function StaffAccessManager({users=[],notify,onSaved}){
  const [accountId,setAccountId]=useState(''),[permissions,setPermissions]=useState([]),[customerIds,setCustomerIds]=useState([]),[working,setWorking]=useState(false),[error,setError]=useState('')
  const accounts=useMemo(()=>users.filter(user=>user.role==='customer'||user.role==='staff'),[users])
  const customers=useMemo(()=>users.filter(user=>user.role==='customer'),[users])
  const selected=accounts.find(user=>user.id===accountId)

  useEffect(()=>{
    setPermissions(selected?.role==='staff'?selected.staff_permissions??[]:[])
    setCustomerIds(selected?.role==='staff'?selected.assigned_customer_ids??[]:[])
    setError('')
  },[accountId,selected?.role,selected?.staff_permissions,selected?.assigned_customer_ids])

  const toggle=(list,setter,id)=>setter(previous=>previous.includes(id)?previous.filter(item=>item!==id):[...previous,id])
  const save=async enabled=>{
    if(!accountId||working)return
    if(enabled&&(!permissions.length||!customerIds.length)){setError('Choose at least one task and assign at least one customer.');return}
    setWorking(true);setError('')
    const {data,error:resultError}=await supabase.functions.invoke('admin-users',{body:{action:'set_staff_access',user_id:accountId,enabled,permissions,customer_ids:customerIds}})
    if(resultError||data?.error){setError(data?.error||resultError?.message||'Could not update staff access.');setWorking(false);return}
    notify?.(enabled?'Staff access saved':'Staff access removed')
    if(!enabled){setAccountId('');setPermissions([]);setCustomerIds([])}
    await onSaved?.()
    setWorking(false)
  }

  return <section className="staff-access-card">
    <div className="admin-list-heading"><div><span className="section-eyebrow">STAFF ACCESS</span><h3>Choose staff tasks and customers</h3></div><span className="staff-access-badge"><Shield size={13}/> Main admin only</span></div>
    <p className="staff-access-intro">A staff account must sign up on the site first. Select that account, choose its allowed tasks, then select the customer accounts it may handle. Staff cannot grant access or reset wallets.</p>
    <label className="admin-field staff-account-select">Staff account<select value={accountId} onChange={event=>setAccountId(event.target.value)}><option value="">Choose a registered account…</option><optgroup label="Customer accounts to promote">{accounts.filter(user=>user.role==='customer').map(user=><option key={user.id} value={user.id}>{user.email}</option>)}</optgroup><optgroup label="Current staff">{accounts.filter(user=>user.role==='staff').map(user=><option key={user.id} value={user.id}>{user.email}</option>)}</optgroup></select></label>
    {selected&&<>
      <div className="staff-access-section-title"><UserRoundCog size={15}/> Allowed tasks</div>
      <div className="staff-permission-grid">{PERMISSIONS.map(permission=><label className="staff-permission-option" key={permission.id}><input type="checkbox" checked={permissions.includes(permission.id)} onChange={()=>toggle(permissions,setPermissions,permission.id)}/><span><b>{permission.title}</b><small>{permission.description}</small></span></label>)}</div>
      <div className="staff-access-section-title"><UserPlus size={15}/> Customers this staff member can handle <small>{customerIds.length} selected</small></div>
      <div className="staff-customer-list">{customers.length?customers.map(customer=><label key={customer.id}><input type="checkbox" checked={customerIds.includes(customer.id)} onChange={()=>toggle(customerIds,setCustomerIds,customer.id)}/><span>{customer.email}</span></label>):<span className="staff-no-customers">No customer accounts are available to assign.</span>}</div>
      {error&&<div className="admin-error">{error}</div>}
      <div className="staff-access-actions"><button type="button" className="confirm-action-btn" disabled={working||!permissions.length||!customerIds.length} onClick={()=>save(true)}>{working?'Saving…':selected.role==='staff'?'Save staff access':'Grant staff access'}</button>{selected.role==='staff'&&<button type="button" className="suspend-btn" disabled={working} onClick={()=>save(false)}>Remove staff access</button>}</div>
    </>}
  </section>
}

