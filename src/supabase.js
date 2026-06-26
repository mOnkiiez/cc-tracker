import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://degixuuapxcfucytxwvx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_6yQJCRaHdaD0T8trMGDVEA_WhwWHiME'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export async function loadFromCloud() {
  try {
    const { data, error } = await supabase
      .from('cc_data')
      .select('data')
      .eq('id', 'main')
      .single()
    if (error || !data) return null
    return data.data
  } catch { return null }
}

export async function saveToCloud(payload) {
  try {
    await supabase
      .from('cc_data')
      .upsert({ id: 'main', data: payload, updated_at: new Date().toISOString() })
  } catch {}
}
