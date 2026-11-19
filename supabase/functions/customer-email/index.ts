import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})
const htmlEscapes: Record<string, string> = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => htmlEscapes[char])
const formatAmount = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(value)
const validUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const assets = ['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC','USDT','USDC','DAI','USDS','USDE','PYUSD','FDUSD','RLUSD','USDG','USDP','GUSD','USD1','USDD']

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
  const serviceKey = secretMap.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!url || !serviceKey) return json({ error: 'Supabase server configuration is missing.' }, 500)
  if (!resendKey || !from) return json({ error: 'Email sending is not configured. Add RESEND_API_KEY and EMAIL_FROM to Supabase secrets.' }, 503)

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sign in is required.' }, 401)
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  const actor = authData.user
  if (authError || !actor) return json({ error: 'Your session is invalid or expired. Sign in again.' }, 401)

  let body: { event?: string; request_id?: string }
  try { body = await request.json() } catch { return json({ error: 'Request body must be JSON.' }, 400) }
  const event = body.event
  const requestId = body.request_id
  if (!requestId || !validUuid(requestId) || !['deposit_submitted','withdrawal_submitted','deposit_reviewed','withdrawal_reviewed'].includes(event ?? '')) {
    return json({ error: 'Choose a valid wallet update.' }, 400)
  }

  const isDeposit = event!.startsWith('deposit_')
  const submitted = event!.endsWith('_submitted')
  const table = isDeposit ? 'virtual_deposit_requests' : 'demo_withdrawals'
  const { data: row, error: rowError } = await admin.from(table)
    .select('id,user_id,asset,amount,status,reason,created_at')
    .eq('id', requestId).maybeSingle()
  if (rowError || !row || !assets.includes(row.asset) || !Number.isFinite(Number(row.amount))) return json({ error: 'Wallet request not found.' }, 404)

  if (submitted) {
    if (row.user_id !== actor.id) return json({ error: 'You can only receive updates about your own request.' }, 403)
    if (row.status !== 'pending') return json({ error: 'Only newly submitted requests can generate this email.' }, 409)
  } else {
    const { data: role, error: roleError } = await admin.from('user_roles').select('role').eq('user_id', actor.id).maybeSingle()
    if (roleError) return json({ error: 'Could not verify administrator access.' }, 500)
    if (role?.role === 'staff') {
      const [{ data: permission, error: permissionError }, { data: assignment, error: assignmentError }] = await Promise.all([
        admin.from('staff_permissions').select('permission').eq('staff_user_id', actor.id).eq('permission', 'wallet_requests').maybeSingle(),
        admin.from('staff_customer_assignments').select('customer_user_id').eq('staff_user_id', actor.id).eq('customer_user_id', row.user_id).maybeSingle(),
      ])
      if (permissionError || assignmentError) return json({ error: 'Could not verify staff request access.' }, 500)
      if (!permission || !assignment) return json({ error: 'Staff access to this customer request is required.' }, 403)
    } else if (role?.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403)
  }

  const { data: customerResult, error: customerError } = await admin.auth.admin.getUserById(row.user_id)
  const customerEmail = customerResult?.user?.email
  if (customerError || !customerEmail) return json({ error: 'Customer email address is unavailable.' }, 404)

  const type = isDeposit ? 'deposit' : 'withdrawal'
  const status = String(row.status)
  const subject = `Simulated ${type} request ${status}`
  const amount = `${formatAmount(Number(row.amount))} ${row.asset}`
  const reason = row.reason ? `Reason: ${String(row.reason).slice(0, 500)}` : ''
  const siteUrl = Deno.env.get('SITE_URL') || 'https://usacryptobit.github.io/'
  const safeReason = escapeHtml(reason)
  const safeStatus = escapeHtml(status)
  const safeAmount = escapeHtml(amount)
  const text = [
    'USA CryptoBit account update', '',
    `Your ${type} request for ${amount} is ${status}.`,
    reason, '',
    'SIMULATED WALLET NOTICE: This site uses simulated balances and transactions. This email is not proof of a real deposit or payout. No money or cryptocurrency moved.', '',
    `Open your account: ${siteUrl}`,
  ].filter(Boolean).join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#0b1117;color:#e8edf1;font-family:Arial,sans-serif"><div style="max-width:600px;margin:32px auto;padding:28px;background:#111a22;border:1px solid #2b3944;border-radius:12px"><p style="color:#c8f27b;font-size:12px;letter-spacing:1px">USA CRYPTOBIT · ACCOUNT UPDATE</p><h1 style="font-size:22px;font-weight:600">${escapeHtml(subject)}</h1><p>Your ${type} request for <strong>${safeAmount}</strong> is <strong>${safeStatus}</strong>.</p>${safeReason?`<p style="color:#aab5bd">${safeReason}</p>`:''}<div style="margin:24px 0;padding:14px;background:#1a241e;border:1px solid #405137;border-radius:8px;color:#e1ebd5"><strong>SIMULATED WALLET NOTICE</strong><br/>This site uses simulated balances and transactions. This email is not proof of a real deposit or payout. No money or cryptocurrency moved.</div><p><a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:11px 16px;background:#c8f27b;color:#11170d;text-decoration:none;border-radius:6px;font-weight:700">Open your account</a></p></div></body></html>`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `wallet-${event}-${requestId}-${status}`,
    },
    body: JSON.stringify({ from, to: [customerEmail], subject, text, html }),
  })
  if (!response.ok) {
    const details = await response.text()
    console.error('Email provider rejected message:', response.status, details)
    return json({ error: 'The email provider could not send this update.' }, 502)
  }
  return json({ ok: true })
})
