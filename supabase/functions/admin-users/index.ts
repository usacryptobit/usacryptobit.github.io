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

  let body: { action?: string; user_id?: string; status?: string; reason?: string; duration?: string }
  try { body = await request.json() } catch { return json({ error: 'Request body must be JSON.' }, 400) }

  if (body.action === 'list') {
    const allUsers = []
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return json({ error: error.message }, 502)
      allUsers.push(...data.users)
      if (data.users.length < 1000) break
    }
    const [{ data: controls, error: controlsError }, { data: roles, error: rolesError }, { data: actions, error: actionsError }] = await Promise.all([
      admin.from('account_controls').select('user_id,status,reason,suspended_until,updated_at'),
      admin.from('user_roles').select('user_id,role'),
      admin.from('admin_action_log').select('id,admin_id,target_user_id,action,reason,created_at').order('created_at', { ascending: false }).limit(40),
    ])
    if (controlsError || rolesError || actionsError) return json({ error: 'Could not load customer controls. Run the admin SQL setup first.' }, 500)
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
    })
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
