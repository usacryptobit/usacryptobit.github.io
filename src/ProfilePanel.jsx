import { useEffect, useState } from 'react'
import { Eye, EyeOff, ImagePlus, Save, ShieldCheck, UserRound, X } from 'lucide-react'
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

  useEffect(() => {
    setDisplayName(profile?.display_name || '')
    setPhoneNumber(profile?.phone_number || '')
    setShowMarketMovers(profile?.show_market_movers !== false)
    setAvatarPath(profile?.avatar_path || '')
  }, [profile])

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
  </section>
}
