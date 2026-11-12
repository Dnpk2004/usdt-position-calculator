import type Decimal from 'decimal.js'
import { D, parse } from './calculator'

function decimal(value: Decimal.Value | null | undefined): Decimal | null {
  if (value == null) return null
  if (typeof value === 'string') return parse(value)
  try { const v = new D(value); return v.isFinite() && v.abs().lte('1e100') ? v : null } catch { return null }
}

function group(text: string): string {
  const [whole, fraction] = text.split('.')
  return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`)
}
export function money(value: Decimal.Value | null | undefined): string {
  const v = decimal(value)
  if (!v) return '—'
  if (v.gt(0) && v.lt('0.01')) return '<0.01'
  return group(v.toFixed(2))
}
export function quantity(value: Decimal.Value | null | undefined): string {
  const v = decimal(value)
  if (!v) return '—'
  if (v.gt(0) && v.lt('0.00000001')) return '<0.00000001'
  return group(v.toDecimalPlaces(8).toFixed())
}
export function price(value: Decimal.Value | null | undefined): string {
  const v = decimal(value)
  if (!v) return '—'
  return group(v.abs().gte(100) ? v.toFixed(2) : v.abs().gte(1) ? v.toDecimalPlaces(4).toFixed() : v.toSignificantDigits(10).toFixed())
}
export function percent(value: Decimal.Value | null | undefined): string {
  const v = decimal(value)
  if (!v) return '—'
  return `${v.gt(0) && v.lt('0.0001') ? '<0.0001' : v.toDecimalPlaces(4).toFixed()}%`
}
