import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://wduxagzffigciuwidkvn.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_IUVT-wBn6VGAr6AR4ap9JA_j1ilAbZE'
export const supabaseReady = Boolean(url && key)
export const supabase = supabaseReady ? createClient(url, key) : null
