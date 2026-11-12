import { computed, reactive, ref } from 'vue'
import { calculate, D, parse, type TradeInput } from './core/calculator'

const Link = D.clone({ precision: 256 })

export const STORAGE_KEY = 'usdt-calculator-v1'
export type Form = TradeInput & { symbol: string; stopPercent: string; takePercent: string }
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function defaults(): Form {
  return {
    symbol: 'BTC', direction: 'long', mode: 'isolated', entry: '', stop: '', take: '',
    stopPercent: '', takePercent: '', risk: '50', leverage: '10', buffer: '50', wallet: '', mmr: '0.5', maintenance: '0',
  }
}

export function createCalculatorState(storage?: StorageLike) {
  const form = reactive<Form>(defaults())
  const storageWarning = ref('')
  let db = storage
  if (!db) {
    try { db = window.localStorage } catch { storageWarning.value = '浏览器不允许本地存储，本次设置不会保存。' }
  }
  let snapshot: Form = defaults()
  let stopSource: 'price' | 'percent' = 'price', takeSource: 'price' | 'percent' = 'price'
  const result = computed(() => calculate(form))

  function sync(kind: 'stop' | 'take', source: 'price' | 'percent') {
    const pctKey = kind === 'stop' ? 'stopPercent' : 'takePercent'
    const parsedEntry = parse(form.entry)
    const e = parsedEntry ? new Link(parsedEntry) : null
    const sign = (form.direction === 'long') === (kind === 'stop') ? -1 : 1
    if (source === 'price') {
      const p = parse(form[kind])
      form[pctKey] = e?.gt(0) && p?.gt(0) ? new Link(p).minus(e).mul(sign).div(e).mul(100).toSignificantDigits(12).toFixed() : ''
    } else {
      const pct = parse(form[pctKey])
      form[kind] = e?.gt(0) && pct?.gt(0) ? e.mul(new Link(1).plus(new Link(pct).div(100).mul(sign))).toFixed() : ''
    }
  }

  function normalizeSymbol(value: string): string {
    return value.trim().toUpperCase().replace(/USDT$/, '')
  }

  // Only known fields and valid individual settings can enter the restored form.
  function sanitize(raw: unknown): Form {
    const safe = defaults()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return safe
    const record = raw as Record<string, unknown>
    const validSymbol = typeof record.symbol === 'string' && /^[A-Z0-9]{1,20}$/.test(record.symbol)
    if (validSymbol) safe.symbol = record.symbol as string
    if (record.direction === 'long' || record.direction === 'short') safe.direction = record.direction
    if (record.mode === 'isolated' || record.mode === 'cross') safe.mode = record.mode
    for (const key of ['risk', 'leverage', 'buffer', 'mmr', 'maintenance', 'wallet'] as const) {
      const rawValue = record[key]
      if (typeof rawValue !== 'string') continue
      const n = parse(rawValue)
      const valid = n && (key === 'risk' ? n.gt(0) : key === 'leverage' ? n.gte(1) && n.lte(125) : key === 'mmr' ? n.gte(0) && n.lt(100) : key === 'buffer' ? n.gte(0) && n.lte(10000) : n.gte(0))
      if (valid) safe[key] = rawValue
    }
    for (const key of ['entry', 'stop', 'take'] as const) {
      if (typeof record[key] === 'string' && record[key].length <= 96) safe[key] = record[key]
    }
    const checked = calculate(safe)
    if (!checked.position || !validSymbol) { safe.entry = ''; safe.stop = ''; safe.take = '' }
    if (checked.issues.take) safe.take = ''
    return safe
  }

  try {
    const text = db?.getItem(STORAGE_KEY)
    if (text && text.length < 12000) {
      const raw = JSON.parse(text) as { version?: unknown; form?: unknown }
      if (raw && raw.version === 1) Object.assign(form, sanitize(raw.form))
    }
  } catch { storageWarning.value = '本地设置无法读取，已使用默认设置；仍可正常计算。' }
  sync('stop', 'price'); sync('take', 'price')
  snapshot = { ...form }

  function persist(clearPrices = false) {
    const validSettings = sanitize({ ...form, entry: '', stop: '', take: '' })
    const previous = snapshot
    snapshot = { ...validSettings }
    // Preserve the most recent valid preference instead of saving partial numeric drafts.
    const checks = calculate(form).issues
    for (const key of ['risk', 'leverage', 'buffer', 'mmr', 'maintenance', 'wallet'] as const) {
      if (key === 'wallet') {
        const n = parse(form.wallet)
        snapshot.wallet = !form.wallet.trim() ? '' : n && n.gte(0) ? form.wallet : previous.wallet
      } else if (checks[key] || !parse(form[key])) snapshot[key] = previous[key]
    }
    if (!clearPrices) {
      const checked = result.value
      const source = checked.position && !checked.issues.take && !percentError('takePercent') ? form : previous
      for (const key of ['entry', 'stop', 'take'] as const) snapshot[key] = source[key]
      // If direction changed with an invalid draft, never retain prices from the opposite direction.
      if (!calculate(snapshot).position) { snapshot.entry = ''; snapshot.stop = ''; snapshot.take = '' }
    }
    if (!/^[A-Z0-9]{1,20}$/.test(form.symbol)) { snapshot.entry = ''; snapshot.stop = ''; snapshot.take = '' }
    try { db?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, form: snapshot })) }
    catch { storageWarning.value = '浏览器不允许保存本地设置，本次修改仅在当前页面有效。' }
  }

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    if (key === 'symbol') {
      const symbol = normalizeSymbol(value)
      if (symbol === form.symbol) return
      form.symbol = symbol
      form.entry = ''; form.stop = ''; form.take = ''; form.stopPercent = ''; form.takePercent = ''
      stopSource = 'price'; takeSource = 'price'
      persist(true); return
    }
    if (key === 'direction') {
      if (value !== 'long' && value !== 'short') return
      if (value === form.direction) return
      const e = parse(form.entry), oldStop = parse(form.stop), oldTake = parse(form.take)
      form.direction = value === 'long' ? 'long' : 'short'
      if (stopSource === 'price') { form.stop = e?.gt(0) && oldStop?.gt(0) ? new Link(e).mul(2).minus(oldStop).toFixed() : ''; sync('stop', 'price') }
      else sync('stop', 'percent')
      if (takeSource === 'price') { form.take = e?.gt(0) && oldTake?.gt(0) ? new Link(e).mul(2).minus(oldTake).toFixed() : ''; sync('take', 'price') }
      else sync('take', 'percent')
    } else {
      // The edited input retains its exact text; only its paired field is calculated.
      form[key] = value
      if (key === 'entry') { sync('stop', stopSource); sync('take', takeSource) }
      if (key === 'stop' || key === 'take') {
        if (key === 'stop') stopSource = 'price'; else takeSource = 'price'
        sync(key, 'price')
      }
      if (key === 'stopPercent' || key === 'takePercent') {
        if (key === 'stopPercent') { stopSource = 'percent'; sync('stop', 'percent') }
        else { takeSource = 'percent'; sync('take', 'percent') }
      }
    }
    persist()
  }
  function reset() {
    Object.assign(form, defaults()); snapshot = defaults(); stopSource = 'price'; takeSource = 'price'
    try { db?.removeItem(STORAGE_KEY) } catch { storageWarning.value = '无法清除本地设置；当前页面已重置。' }
  }
  const symbolError = computed(() => /^[A-Z0-9]{1,20}$/.test(form.symbol) ? '' : '币种请填写 1–20 位英文字母或数字')
  function percentError(key: 'stopPercent' | 'takePercent') {
    const value = form[key]
    if (!value.trim()) return undefined
    const n = parse(value)
    return !n || n.lte(0) ? '距离百分比须为有效正数' : undefined
  }
  return { form, result, storageWarning, symbolError, percentError, update, reset }
}
