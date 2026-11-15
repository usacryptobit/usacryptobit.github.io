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
const durations: Record<string, { ban: string; until: Date | null }> = {
  '24h': { ban: '24h', until: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  '7d': { ban: '168h', until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  '30d': { ban: '720h', until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  permanent: { ban: '876000h', until: null },
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')
  const serviceKey = secretMap.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Supabase server configuration is missing.' }, 500)

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Sign in is required.' }, 401)

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  const actor = authData.user
  if (authError || !actor) return json({ error: 'Your session is invalid or expired. Sign in again.' }, 401)

  const { data: roleRow, error: roleError } = await admin
    .from('user_roles').select('role').eq('user_id', actor.id).maybeSingle()
  if (roleError) return json({ error: 'Could not verify administrator access.' }, 500)
  if (roleRow?.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403)

  let body: { action?: string; user_id?: string; status?: string; reason?: string; duration?: string; asset?: string; amount?: number; withdrawal_id?: string; decision?: string; paused?: boolean }
  try { body = await request.json() } catch { return json({ error: 'Request body must be JSON.' }, 400) }

  if (body.action === 'list') {
    const allUsers = []
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return json({ error: error.message }, 502)
      allUsers.push(...data.users)
      if (data.users.length < 1000) break
    }
    const [{ data: controls, error: controlsError }, { data: roles, error: rolesError }, { data: actions, error: actionsError }, { data: wallets, error: walletsError }, { data: withdrawals, error: withdrawalsError }] = await Promise.all([
      admin.from('account_controls').select('user_id,status,reason,suspended_until,updated_at,withdrawals_paused,withdrawal_pause_reason'),
      admin.from('user_roles').select('user_id,role'),
      admin.from('admin_action_log').select('id,admin_id,target_user_id,action,reason,created_at').order('created_at', { ascending: false }).limit(40),
      admin.from('demo_wallets').select('user_id,asset,available,held'),
      admin.from('demo_withdrawals').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    if (controlsError || rolesError || actionsError || walletsError || withdrawalsError) return json({ error: 'Could not load customer controls and virtual wallets. Run the updated SQL setup first.' }, 500)
    const controlMap = new Map((controls ?? []).map((row) => [row.user_id, row]))
    const roleMap = new Map((roles ?? []).map((row) => [row.user_id, row.role]))
    const safeUsers = allUsers.map((user) => {
      const control = controlMap.get(user.id)
      return {
        id: user.id,
        email: user.email ?? '(no email)',
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        email_confirmed_at: user.email_confirmed_at,
        role: roleMap.get(user.id) ?? 'customer',
        status: control?.status === 'suspended' && control.suspended_until && new Date(control.suspended_until) <= new Date()
          ? 'active'
          : (control?.status ?? (user.banned_until ? 'suspended' : 'active')),
        reason: control?.reason ?? null,
        suspended_until: control?.suspended_until ?? user.banned_until ?? null,
        withdrawals_paused: control?.withdrawals_paused ?? false,
        withdrawal_pause_reason: control?.withdrawal_pause_reason ?? null,
        wallets: (wallets ?? []).filter((wallet) => wallet.user_id === user.id),
      }
    })
    const emailById = new Map(safeUsers.map((user) => [user.id, user.email]))
    return json({
      users: safeUsers,
      actions: (actions ?? []).map((item) => ({
        ...item,
        admin_email: emailById.get(item.admin_id) ?? 'Administrator',
        target_email: emailById.get(item.target_user_id) ?? 'Customer',
      })),
      withdrawals: (withdrawals ?? []).map((item) => ({ ...item, user_email: emailById.get(item.user_id) ?? 'Customer' })),
    })
  }

  if (body.action === 'fund_virtual_wallet') {
    const userId = body.user_id
    const asset = body.asset?.toUpperCase()
    const amount = Number(body.amount)
    const reason = body.reason?.trim() ?? ''
    if (!userId || !['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','TRX','LTC'].includes(asset ?? '') || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || reason.length < 3 || reason.length > 500) return json({ error: 'Enter a valid customer, asset, amount, and reason.' }, 400)
    const { data: role } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
    if (userId === actor.id || role?.role === 'admin') return json({ error: 'Virtual balances cannot be changed for administrator accounts.' }, 403)
    const { error } = await admin.rpc('admin_fund_demo_wallet', { p_admin_id: actor.id, p_user_id: userId, p_asset: asset, p_amount: amount, p_reason: reason })
    if (error) return json({ error: error.message }, 502)
    return json({ ok: true })
  }

  if (body.action === 'review_virtual_withdrawal') {
    const decisionMap: Record<string, string> = { hold: 'hold', release: 'release', approve: 'approve', reject: 'reject' }
    const decision = decisionMap[body.decision ?? '']
    const reason = body.reason?.trim() ?? ''
    if (!body.withdrawal_id || !decision || reason.length < 3 || reason.length > 500) return json({ error: 'Choose a valid request action and enter a reason.' }, 400)
    const { data: requestRow, error: requestError } = await admin.from('demo_withdrawals').select('user_id').eq('id', body.withdrawal_id).maybeSingle()
    if (requestError || !requestRow) return json({ error: 'Virtual withdrawal request not found.' }, 404)
    const { data: role } = await admin.from('user_roles').select('role').eq('user_id', requestRow.user_id).maybeSingle()
    if (requestRow.user_id === actor.id || role?.role === 'admin') return json({ error: 'Administrator withdrawal requests cannot be reviewed here.' }, 403)
    const { error } = await admin.rpc('admin_review_demo_withdrawal', { p_admin_id: actor.id, p_withdrawal_id: body.withdrawal_id, p_action: decision, p_reason: reason })
    if (error) return json({ error: error.message }, 502)
    return json({ ok: true })
  }

  if (body.action === 'set_virtual_withdrawals_paused') {
    const userId = body.user_id
    const reason = body.reason?.trim() ?? ''
    if (!userId || typeof body.paused !== 'boolean' || reason.length < 3 || reason.length > 500) return json({ error: 'Choose an account and enter a reason.' }, 400)
    const { data: role, error: roleCheckError } = await admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
    if (roleCheckError) return json({ error: 'Could not verify customer role.' }, 500)
    if (userId === actor.id || role?.role === 'admin') return json({ error: 'Administrator accounts cannot be changed here.' }, 403)
    const { data: oldControl, error: readError } = await admin.from('account_controls').select('*').eq('user_id', userId).maybeSingle()
    if (readError) return json({ error: 'Could not load the current account controls.' }, 500)
    const update = { ...(oldControl ?? {}), user_id: userId, withdrawals_paused: body.paused, withdrawal_pause_reason: body.paused ? reason : null, updated_by: actor.id, updated_at: new Date().toISOString() }
    const { error: writeError } = await admin.from('account_controls').upsert(update, { onConflict: 'user_id' })
    if (writeError) return json({ error: writeError.message }, 502)
    const { error: auditError } = await admin.from('admin_action_log').insert({ admin_id: actor.id, target_user_id: userId, action: body.paused ? 'withdrawal_paused' : 'withdrawal_unpaused', reason })
    if (auditError) console.error('Virtual withdrawal control changed, but audit logging failed:', auditError.message)
    return json({ ok: true })
  }

  if (body.action !== 'set_status') return json({ error: 'Unsupported action.' }, 400)
  const targetId = body.user_id
  const nextStatus = body.status
  const reason = body.reason?.trim() ?? ''
  if (!targetId || !['active', 'restricted', 'suspended'].includes(nextStatus ?? '')) return json({ error: 'Choose a valid customer and status.' }, 400)
  if (targetId === actor.id) return json({ error: 'You cannot change your own account status.' }, 400)
  if (reason.length < 3 || reason.length > 500) return json({ error: 'Enter a reason between 3 and 500 characters.' }, 400)
  if (nextStatus === 'suspended' && !durations[body.duration ?? '']) return json({ error: 'Choose a valid suspension duration.' }, 400)

  const { data: targetRole, error: targetRoleError } = await admin
    .from('user_roles').select('role').eq('user_id', targetId).maybeSingle()
  if (targetRoleError) return json({ error: 'Could not verify the customer role.' }, 500)
  if (targetRole?.role === 'admin') return json({ error: 'Administrators cannot change another administrator’s account from this screen.' }, 403)

  const selectedDuration = nextStatus === 'suspended' ? durations[body.duration!] : null
  const { data: oldControl } = await admin.from('account_controls').select('*').eq('user_id', targetId).maybeSingle()
  const controlUpdate = {
    ...(oldControl ?? {}),
    user_id: targetId,
    status: nextStatus,
    reason: nextStatus === 'active' ? null : reason,
    suspended_until: selectedDuration?.until?.toISOString() ?? null,
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  }
  const { error: controlError } = await admin.from('account_controls').upsert(controlUpdate, { onConflict: 'user_id' })
  if (controlError) return json({ error: controlError.message }, 502)

  const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, {
    ban_duration: nextStatus === 'suspended' ? selectedDuration!.ban : 'none',
  })
  if (authUpdateError) {
    if (oldControl) await admin.from('account_controls').upsert(oldControl, { onConflict: 'user_id' })
    else await admin.from('account_controls').delete().eq('user_id', targetId)
    return json({ error: authUpdateError.message }, 502)
  }

  const action = nextStatus === 'active' ? 'activated' : nextStatus
  const { error: auditError } = await admin.from('admin_action_log').insert({
    admin_id: actor.id,
    target_user_id: targetId,
    action,
    reason,
  })
  if (auditError) console.error('Customer access changed, but audit logging failed:', auditError.message)
  return json({ ok: true, status: nextStatus })
})
