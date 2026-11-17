import { useEffect, useState } from 'react'
import { ImagePlus, Save, ShieldCheck, UserRound, X } from 'lucide-react'
import { supabase } from './supabase'

const MAX_AVATAR_SIZE = 2 * 1024 * 1024
const EXTENSIONS = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }

export default function ProfilePanel({ currentUser, profile, onProfileChange, notify }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '')
  const [showMarketMovers, setShowMarketMovers] = useState(profile?.show_market_movers !== false)
  const [avatarPath, setAvatarPath] = useState(profile?.avatar_path || '')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setDisplayName(profile?.display_name || '')
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
    if (cleanName.length > 60) { setError('Display name must be 60 characters or fewer.'); return }
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
      const updatedProfile = { id:currentUser.id, display_name:cleanName || null, avatar_path:nextPath || null, show_market_movers:showMarketMovers, updated_at:new Date().toISOString() }
      const { data, error:saveError } = await supabase.from('profiles').upsert(updatedProfile, { onConflict:'id' }).select('display_name,avatar_path,show_market_movers').single()
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

  const removePicture = () => { setAvatarPath(''); setFile(null); setPreview('') }

  return <section className="profile-page">
    <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> ACCOUNT SETTINGS</div><h1>Your profile</h1><p>Choose how your account appears and set your market view.</p></div></div>
    <div className="profile-privacy"><ShieldCheck size={18}/><span>This profile stores only your display name, profile picture, and market display preference. It does not ask for identity documents or sensitive personal numbers.</span></div>
    <form className="profile-card" onSubmit={save}>
      <div className="profile-section-heading"><div><span className="section-eyebrow">PROFILE DETAILS</span><h2>Personalize your account</h2></div><UserRound size={19}/></div>
      <div className="profile-avatar-row">
        <div className="profile-avatar">{avatarUrl?<img src={avatarUrl} alt="Profile"/>:<span>{displayName.trim()?.[0]?.toUpperCase() || currentUser.email?.[0]?.toUpperCase() || '?'}</span>}</div>
        <div className="profile-avatar-actions"><label className="profile-upload"><ImagePlus size={15}/>{file?'Choose a different picture':'Upload profile picture'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile}/></label><small>JPG, PNG, or WebP · maximum 2 MB</small></div>
        {(avatarPath||file)&&<button type="button" className="profile-remove" onClick={removePicture} aria-label="Remove profile picture"><X size={16}/></button>}
      </div>
      <label className="profile-field">Display name<input value={displayName} onChange={event=>setDisplayName(event.target.value)} maxLength={60} placeholder="How you would like to be known" autoComplete="nickname"/><small>Optional · up to 60 characters</small></label>
      <div className="profile-email"><span>Email address</span><b>{currentUser.email}</b><small>Email changes are managed through account authentication.</small></div>
      <label className="profile-preference"><span><b>Show daily market movers</b><small>Display the Market Pulse section on your Overview page.</small></span><input type="checkbox" checked={showMarketMovers} onChange={event=>setShowMarketMovers(event.target.checked)}/></label>
      {error&&<div className="form-error">{error}</div>}
      <div className="profile-actions"><button className="submit-btn" disabled={busy}><Save size={15}/>{busy?'Saving…':'Save profile'}</button></div>
    </form>
  </section>
}
