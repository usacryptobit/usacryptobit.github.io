import { useEffect, useState } from 'react'
import { Download, Eye, EyeOff, ImagePlus, KeyRound, Save, ShieldCheck, UserRound, X } from 'lucide-react'
import { supabase } from './supabase'

const MAX_AVATAR_SIZE = 2 * 1024 * 1024
const EXTENSIONS = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }

export default function ProfilePanel({ currentUser, profile, onProfileChange, notify }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number || '')
  const [showMarketMovers, setShowMarketMovers] = useState(profile?.show_market_movers !== false)
  const [avatarPath, setAvatarPath] = useState(profile?.avatar_path || '')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [mfaFactors,setMfaFactors]=useState([])
  const [mfaSetup,setMfaSetup]=useState(null)
  const [mfaCode,setMfaCode]=useState('')
  const [mfaBusy,setMfaBusy]=useState(false)
  const [mfaError,setMfaError]=useState('')
  const [exportBusy,setExportBusy]=useState(false)

  const loadMfaFactors=async()=>{
    const {data,error}=await supabase.auth.mfa.listFactors()
    if(error){setMfaError(error.message);return}
    setMfaFactors(data?.totp??[])
  }

  useEffect(() => {
    setDisplayName(profile?.display_name || '')
    setPhoneNumber(profile?.phone_number || '')
    setShowMarketMovers(profile?.show_market_movers !== false)
    setAvatarPath(profile?.avatar_path || '')
  }, [profile])

  useEffect(()=>{loadMfaFactors()},[])

  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const avatarUrl = preview || (avatarPath ? supabase.storage.from('profile-avatars').getPublicUrl(avatarPath).data.publicUrl : '')

  const chooseFile = event => {
    const next = event.target.files?.[0]
    setError('')
    if (!next) return
    if (!EXTENSIONS[next.type]) { setError('Choose a JPG, PNG, or WebP image.'); event.target.value = ''; return }
    if (next.size > MAX_AVATAR_SIZE) { setError('Profile pictures must be 2 MB or smaller.'); event.target.value = ''; return }
    setFile(next)
  }

  const save = async event => {
    event.preventDefault()
    setError('')
    const cleanName = displayName.trim()
    const cleanPhone = phoneNumber.trim()
    if (cleanName.length > 60) { setError('Display name must be 60 characters or fewer.'); return }
    if (cleanPhone && (!/^[+0-9 ()-]{7,20}$/.test(cleanPhone) || cleanPhone.replace(/\D/g,'').length < 7 || cleanPhone.replace(/\D/g,'').length > 15)) { setError('Enter a valid phone number with country code, between 7 and 15 digits.'); return }
    setBusy(true)
    let nextPath = avatarPath
    let uploadedPath = ''
    const previousPath = profile?.avatar_path || ''
    try {
      if (file) {
        uploadedPath = `${currentUser.id}/${crypto.randomUUID()}.${EXTENSIONS[file.type]}`
        const { error: uploadError } = await supabase.storage.from('profile-avatars').upload(uploadedPath, file, { cacheControl:'3600', upsert:false, contentType:file.type })
        if (uploadError) throw uploadError
        nextPath = uploadedPath
      }
      const updatedProfile = { id:currentUser.id, display_name:cleanName || null, phone_number:cleanPhone || null, avatar_path:nextPath || null, show_market_movers:showMarketMovers, updated_at:new Date().toISOString() }
      const { data, error:saveError } = await supabase.from('profiles').upsert(updatedProfile, { onConflict:'id' }).select('display_name,phone_number,avatar_path,show_market_movers').single()
      if (saveError) throw saveError
      onProfileChange(data)
      if (previousPath && previousPath !== data.avatar_path) await supabase.storage.from('profile-avatars').remove([previousPath])
      setAvatarPath(data.avatar_path || '')
      setFile(null)
      notify('Profile saved')
    } catch (saveError) {
      if (uploadedPath) await supabase.storage.from('profile-avatars').remove([uploadedPath])
      setError(saveError.message || 'Could not save your profile.')
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async event => {
    event.preventDefault()
    setPasswordError(''); setPasswordMessage('')
    if(newPassword.length<8){setPasswordError('Choose a new password with at least 8 characters.');return}
    if(newPassword!==confirmPassword){setPasswordError('The new passwords do not match.');return}
    if(newPassword===currentPassword){setPasswordError('Choose a new password different from your current one.');return}
    setPasswordBusy(true)
    try{
      const {error:verifyError}=await supabase.auth.signInWithPassword({email:currentUser.email,password:currentPassword})
      if(verifyError)throw new Error('Current password is incorrect.')
      const {error:updateError}=await supabase.auth.updateUser({password:newPassword})
      if(updateError)throw updateError
      setCurrentPassword('');setNewPassword('');setConfirmPassword('')
      setPasswordMessage('Password updated successfully.')
      notify('Password updated')
    }catch(passwordUpdateError){setPasswordError(passwordUpdateError.message||'Could not update your password.')}
    finally{setPasswordBusy(false)}
  }

  const beginMfaSetup=async()=>{
    setMfaBusy(true);setMfaError('')
    try{
      const {data,error}=await supabase.auth.mfa.enroll({factorType:'totp',friendlyName:'USACryptoBit authenticator'})
      if(error)throw error
      setMfaSetup(data);setMfaCode('')
    }catch(error){setMfaError(error.message||'Could not start two-factor setup.')}
    finally{setMfaBusy(false)}
  }

  const verifyMfaSetup=async event=>{
    event.preventDefault();if(!mfaSetup)return
    setMfaBusy(true);setMfaError('')
    try{
      const {data:challenge,error:challengeError}=await supabase.auth.mfa.challenge({factorId:mfaSetup.id})
      if(challengeError)throw challengeError
      const {error}=await supabase.auth.mfa.verify({factorId:mfaSetup.id,challengeId:challenge.id,code:mfaCode.trim()})
      if(error)throw error
      setMfaSetup(null);setMfaCode('');await loadMfaFactors();notify('Two-factor authentication enabled')
    }catch(error){setMfaError(error.message||'The authenticator code could not be verified.')}
    finally{setMfaBusy(false)}
  }

  const cancelMfaSetup=async()=>{
    if(!mfaSetup){setMfaSetup(null);return}
    setMfaBusy(true);setMfaError('')
    try{const {error}=await supabase.auth.mfa.unenroll({factorId:mfaSetup.id});if(error)throw error;setMfaSetup(null);setMfaCode('');await loadMfaFactors()}
    catch(error){setMfaError(error.message||'Could not cancel authenticator setup.')}
    finally{setMfaBusy(false)}
  }

  const disableMfa=async factorId=>{
    if(!window.confirm('Disable two-factor authentication for this account?'))return
    setMfaBusy(true);setMfaError('')
    try{const {error}=await supabase.auth.mfa.unenroll({factorId});if(error)throw error;await loadMfaFactors();notify('Two-factor authentication disabled')}
    catch(error){setMfaError(error.message||'Could not disable two-factor authentication.')}
    finally{setMfaBusy(false)}
  }

  const exportAccountData=async()=>{
    setExportBusy(true);setError('')
    try{
      const tables=['profiles','watchlist','demo_wallets','customer_external_wallets','demo_wallet_ledger','demo_withdrawals','virtual_deposit_requests']
      const results=await Promise.all(tables.map(table=>supabase.from(table).select('*').eq(table==='profiles'?'id':'user_id',currentUser.id)))
      const failed=results.find(result=>result.error)
      if(failed)throw failed.error
      const {data:conversations,error:conversationError}=await supabase.from('support_conversations').select('*').eq('customer_id',currentUser.id)
      if(conversationError)throw conversationError
      const conversationIds=(conversations??[]).map(row=>row.id)
      const {data:messages,error:messagesError}=conversationIds.length?await supabase.from('support_messages').select('*').in('conversation_id',conversationIds):{data:[],error:null}
      if(messagesError)throw messagesError
      const payload={exported_at:new Date().toISOString(),account:{id:currentUser.id,email:currentUser.email},notice:'Wallet activity and balances in this export are simulated. No authentication secrets are included.',data:{...Object.fromEntries(tables.map((table,index)=>[table,results[index].data??[]])),support_conversations:conversations??[],support_messages:messages??[]}}
      const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='usacryptobit-account-data.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Account data exported')
    }catch(error){setError(`Could not export account data: ${error.message}`)}
    finally{setExportBusy(false)}
  }

  const removePicture = () => { setAvatarPath(''); setFile(null); setPreview('') }

  return <section className="profile-page">
    <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> ACCOUNT SETTINGS</div><h1>Your profile</h1><p>Choose how your account appears and set your market view.</p></div></div>
    <div className="profile-privacy"><ShieldCheck size={18}/><span>Your profile information is visible only to your signed-in account. Phone number is optional and is not used as a wallet credential.</span></div>
    <form className="profile-card" onSubmit={save}>
      <div className="profile-section-heading"><div><span className="section-eyebrow">PROFILE DETAILS</span><h2>Personalize your account</h2></div><UserRound size={19}/></div>
      <div className="profile-avatar-row">
        <div className="profile-avatar">{avatarUrl?<img src={avatarUrl} alt="Profile"/>:<span>{displayName.trim()?.[0]?.toUpperCase() || currentUser.email?.[0]?.toUpperCase() || '?'}</span>}</div>
        <div className="profile-avatar-actions"><label className="profile-upload"><ImagePlus size={15}/>{file?'Choose a different picture':'Upload profile picture'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile}/></label><small>JPG, PNG, or WebP · maximum 2 MB</small></div>
        {(avatarPath||file)&&<button type="button" className="profile-remove" onClick={removePicture} aria-label="Remove profile picture"><X size={16}/></button>}
      </div>
      <label className="profile-field">Display name<input value={displayName} onChange={event=>setDisplayName(event.target.value)} maxLength={60} placeholder="How you would like to be known" autoComplete="nickname"/><small>Optional · up to 60 characters</small></label>
      <label className="profile-field">Phone number<input type="tel" value={phoneNumber} onChange={event=>setPhoneNumber(event.target.value)} maxLength={20} placeholder="Include country code, e.g. +1 555 123 4567" autoComplete="tel"/><small>Optional · include your country code</small></label>
      <div className="profile-email"><span>Email address</span><b>{currentUser.email}</b><small>Email changes are managed through account authentication.</small></div>
      <label className="profile-preference"><span><b>Show daily market movers</b><small>Display the Market Pulse section on your Overview page.</small></span><input type="checkbox" checked={showMarketMovers} onChange={event=>setShowMarketMovers(event.target.checked)}/></label>
      {error&&<div className="form-error">{error}</div>}
      <div className="profile-actions"><button className="submit-btn" disabled={busy}><Save size={15}/>{busy?'Saving…':'Save profile'}</button></div>
    </form>
    <form className="profile-card password-change-card" onSubmit={changePassword}>
      <div className="profile-section-heading"><div><span className="section-eyebrow">ACCOUNT SECURITY</span><h2>Change password</h2></div><ShieldCheck size={19}/></div>
      <label className="profile-field">Current password<div className="password-field"><input type={showPasswords?'text':'password'} required autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/><button type="button" className="password-visibility" aria-label={showPasswords?'Hide passwords':'Show passwords'} onClick={()=>setShowPasswords(value=>!value)}>{showPasswords?<EyeOff size={15}/>:<Eye size={15}/>}</button></div></label>
      <label className="profile-field">New password<div className="password-field"><input type={showPasswords?'text':'password'} required minLength={8} autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} placeholder="At least 8 characters"/><button type="button" className="password-visibility" aria-label={showPasswords?'Hide passwords':'Show passwords'} onClick={()=>setShowPasswords(value=>!value)}>{showPasswords?<EyeOff size={15}/>:<Eye size={15}/>}</button></div></label>
      <label className="profile-field">Confirm new password<div className="password-field"><input type={showPasswords?'text':'password'} required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)}/><button type="button" className="password-visibility" aria-label={showPasswords?'Hide passwords':'Show passwords'} onClick={()=>setShowPasswords(value=>!value)}>{showPasswords?<EyeOff size={15}/>:<Eye size={15}/>}</button></div></label>
      {passwordError&&<div className="form-error">{passwordError}</div>}{passwordMessage&&<div className="form-message">{passwordMessage}</div>}
      <div className="profile-actions"><button className="submit-btn" disabled={passwordBusy}><ShieldCheck size={15}/>{passwordBusy?'Updating…':'Update password'}</button></div>
    </form>
    <section className="profile-card profile-security-card">
      <div className="profile-section-heading"><div><span className="section-eyebrow">SIGN-IN PROTECTION</span><h2>Two-factor authentication</h2></div><KeyRound size={19}/></div>
      <p className="profile-security-copy">Use an authenticator app to generate a one-time code when signing in. Only you can scan and verify the setup code.</p>
      {mfaError&&<div className="form-error">{mfaError}</div>}
      {mfaFactors.filter(factor=>factor.status==='verified').map(factor=><div className="mfa-factor-row" key={factor.id}><span><ShieldCheck size={15}/> Authenticator app enabled</span><button type="button" className="wallet-reset-btn" disabled={mfaBusy} onClick={()=>disableMfa(factor.id)}>Disable</button></div>)}
      {mfaSetup?<form className="mfa-setup" onSubmit={verifyMfaSetup}><p>Scan this QR code with an authenticator app, then enter its current six-digit code to finish setup.</p><img className="mfa-qr" alt="Authenticator setup QR code" src={`data:image/svg+xml;utf8,${encodeURIComponent(mfaSetup.totp.qr_code)}`}/><label className="profile-field">Setup key<input readOnly value={mfaSetup.totp.secret}/></label><label className="profile-field">Authenticator code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={mfaCode} onChange={event=>setMfaCode(event.target.value.replace(/\D/g,''))} placeholder="6-digit code"/></label><div className="profile-actions"><button className="submit-btn" disabled={mfaBusy}>{mfaBusy?'Verifying…':'Verify and enable'}</button><button type="button" className="cancel-btn" disabled={mfaBusy} onClick={cancelMfaSetup}>Cancel setup</button></div><small className="mfa-private-note">Keep this setup key private. Support staff and administrators will never ask for it.</small></form>:mfaFactors.some(factor=>factor.status==='verified')?null:<button type="button" className="submit-btn" disabled={mfaBusy} onClick={beginMfaSetup}><KeyRound size={15}/>{mfaBusy?'Starting setup…':'Set up authenticator'}</button>}
    </section>
    <section className="profile-card profile-export-card"><div className="profile-section-heading"><div><span className="section-eyebrow">YOUR INFORMATION</span><h2>Export account data</h2></div><Download size={19}/></div><p className="profile-security-copy">Download your profile, watchlist, virtual wallet records, saved address references, and support messages as a JSON file.</p><button type="button" className="admin-refresh" disabled={exportBusy} onClick={exportAccountData}><Download size={14}/>{exportBusy?'Preparing export…':'Download account data'}</button></section>
  </section>
}
