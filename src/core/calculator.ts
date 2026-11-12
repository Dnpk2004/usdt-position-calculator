import Decimal from 'decimal.js'

// A private constructor prevents other library consumers from changing our precision.
export const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP })
// Boundary decisions use finite cross-products of the bounded original inputs.
// 768 digits cover the polynomial products of our <=96-character operands;
// division (which may repeat forever) is only used to produce displayed values.
const X = Decimal.clone({ precision: 768 })
const rounded = (v: Decimal) => new D(v.toSignificantDigits(80).toString())
export type TradeInput = {
  direction: 'long' | 'short'; mode: 'isolated' | 'cross'; entry: string; stop: string;
  take: string; risk: string; leverage: string; buffer: string; wallet: string; mmr: string; maintenance: string;
}
export type RiskState = 'gray' | 'green' | 'yellow' | 'red'
export type Position = {
  quantity: Decimal; notional: Decimal; distance: Decimal; stopPercent: Decimal;
  loss: Decimal; initialMargin: Decimal | null; profit: Decimal | null; ratio: Decimal | null;
}
export type Calculation = {
  position: Position | null; issues: Partial<Record<keyof TradeInput, string>>;
  liquidation: Decimal | null; liquidationMessage: string; risk: RiskState;
  highest: number | null; conservative: number | null; bufferTarget: Decimal | null;
  warnings: string[];
}

/** Bounded decimal input, including temporary trailing decimal points. No JS Number arithmetic. */
export function parse(value: string): Decimal | null {
  const text = value.trim()
  if (!text || text.length > 96 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d{1,2})?$/i.test(text)) return null
  try {
    const v = new D(text)
    if (!v.isFinite() || v.abs().gt('1e18') || (!v.isZero() && v.abs().lt('1e-24'))) return null
    return v
  } catch { return null }
}

type Model = { price: Decimal | null; message: string; atEntry: boolean; numerator: Decimal; denominator: Decimal }
function liquidationModel(e: Decimal, distance: Decimal, risk: Decimal, margin: Decimal, isolated: boolean, rate: Decimal, amount: Decimal, long: boolean): Model {
  const r = new X(rate), c = new X(amount), d = new X(distance), a = new X(risk), entry = new X(e)
  // Multiply Equity=Maintenance by distance and, for isolated mode, leverage.
  const marginDenominator = isolated ? new X(margin) : new X(1)
  const marginNumerator = isolated ? a.mul(entry) : new X(margin).mul(d)
  const basis = a.mul(entry).mul(marginDenominator), deduction = c.mul(d).mul(marginDenominator)
  const maintenanceAtEntry = basis.mul(r).minus(deduction)
  const invalid = (message: string): Model => ({ price: null, message, atEntry: false, numerator: new X(0), denominator: new X(1) })
  if (maintenanceAtEntry.isNegative()) return invalid('参考扣减额导致负维持保证金，当前单档假设无实际意义')
  const numerator = long ? basis.minus(marginNumerator).minus(deduction) : basis.plus(marginNumerator).plus(deduction)
  const denominator = a.mul(long ? new X(1).minus(r) : new X(1).plus(r)).mul(marginDenominator)
  if (denominator.isZero()) return invalid('当前假设下无有效正价格强平估算')
  const p = rounded(numerator.div(denominator))
  if (!p.isFinite() || p.lte(0)) return invalid('当前假设下无有效正价格强平估算')
  if (a.mul(numerator).mul(r).minus(c.mul(d).mul(denominator)).lt(0)) return invalid('强平点维持保证金为负，当前单档假设无实际意义')
  const atEntry = marginNumerator.lte(maintenanceAtEntry)
  return { price: p, atEntry, numerator, denominator, message: atEntry ? '开仓权益已不满足参考维持保证金要求' : '仅依据简化模型的价格位置关系' }
}

function classify(model: Model, stop: Decimal, target: Decimal, long: boolean): RiskState {
  const stopBoundary = new X(stop).mul(model.denominator), targetBoundary = new X(target).mul(model.denominator)
  if (long ? model.numerator.gte(stopBoundary) : model.numerator.lte(stopBoundary)) return 'red'
  return (long ? model.numerator.lte(targetBoundary) : model.numerator.gte(targetBoundary)) ? 'green' : 'yellow'
}

export function calculate(input: TradeInput): Calculation {
  const out: Calculation = {
    position: null, issues: {}, liquidation: null, risk: 'gray', highest: null,
    conservative: null, bufferTarget: null, liquidationMessage: '请填写有效的开仓价、止损价和风险金额', warnings: [],
  }
  const { issues } = out
  const positive = (key: keyof TradeInput, label: string) => {
    const v = parse(input[key])
    if (!v || v.lte(0)) { issues[key] = `${label}须为有效正数（支持 1e-24 至 1e18）`; return null }
    return v
  }
  const e = positive('entry', '开仓价'), s = positive('stop', '止损价'), risk = positive('risk', '风险金额')
  const l = parse(input.leverage)
  if (!l || l.lt(1) || l.gt(125)) issues.leverage = '杠杆须在本地参考范围 1–125 倍内'
  const buffer = parse(input.buffer)
  if (!buffer || buffer.lt(0) || buffer.gt(10000)) issues.buffer = '安全缓冲须为 0–10000% 的有效数值'
  const rPercent = parse(input.mmr), c = parse(input.maintenance)
  if (!rPercent || rPercent.lt(0) || rPercent.gte(100)) issues.mmr = '参考维持保证金率须为 0%（含）至 100%（不含）'
  if (!c || c.lt(0)) issues.maintenance = '参考扣减额须为有效非负数'
  const wallet = parse(input.wallet)
  if (input.mode === 'cross' && input.wallet.trim() && (!wallet || wallet.lt(0))) issues.wallet = '全仓钱包余额须为有效非负数'
  const long = input.direction === 'long'
  if (e && s && (long ? s.gte(e) : s.lte(e))) issues.stop = long ? '做多止损价必须低于开仓价' : '做空止损价必须高于开仓价'
  if (!e || !s || !risk || issues.stop) return out
  const distance = new X(e).minus(s).abs(), q = rounded(new X(risk).div(distance)), n = rounded(new X(risk).mul(e).div(distance))
  if (n.gt('1e18') || q.gt('1e24')) {
    issues.stop = '止损距离过小或理论仓位异常大（名义价值上限 1e18 USDT，数量上限 1e24），请调整参数'
    return out
  }
  const p: Position = {
    quantity: q, notional: n, distance, stopPercent: distance.div(e).mul(100),
    loss: risk, initialMargin: !issues.leverage ? rounded(new X(risk).mul(e).div(distance.mul(l!))) : null, profit: null, ratio: null,
  }
  out.position = p
  if (p.stopPercent.lt('0.01')) out.warnings.push('止损距离小于 0.01%，理论仓位可能很大；手续费与滑点可能显著超过计划价格亏损。')
  if (input.take.trim()) {
    const t = positive('take', '止盈价')
    if (t && (long ? t.lte(e) : t.gte(e))) issues.take = long ? '做多止盈价必须高于开仓价' : '做空止盈价必须低于开仓价'
    if (t && !issues.take) {
      const gain = long ? new X(t).minus(e) : new X(e).minus(t)
      p.profit = rounded(new X(risk).mul(gain).div(distance))
      p.ratio = rounded(gain.div(distance))
    }
  }
  if (issues.buffer || issues.mmr || issues.maintenance) {
    out.liquidationMessage = '请修正安全缓冲或估算假设后查看强平参考'
    return out
  }
  const r = new X(rPercent!).div(100)
  const extra = distance.mul(buffer!).div(100)
  const target = long ? new X(s).minus(extra) : new X(s).plus(extra)
  out.bufferTarget = target
  if (input.mode === 'isolated') {
    // Recommendations use exactly the same model and classification as the displayed result.
    for (let leverage = 1; leverage <= 125; leverage++) {
      const model = liquidationModel(e, distance, risk, new X(leverage), true, r, c!, long)
      if (!model.price || model.atEntry) continue
      const status = classify(model, s, target, long)
      if (status === 'green' || status === 'yellow') out.highest = leverage
      if (status === 'green') out.conservative = leverage
    }
  }
  if (!p.initialMargin) { out.liquidationMessage = '请填写有效的参考杠杆'; return out }
  let m = l!
  if (input.mode === 'cross') {
    if (!input.wallet.trim()) { out.liquidationMessage = '填写全仓钱包余额后才能估算全仓强平价'; return out }
    if (!wallet || wallet.lt(0)) {
      issues.wallet = '全仓钱包余额须为有效非负数'
      out.liquidationMessage = issues.wallet; return out
    }
    if (new X(wallet).mul(distance).mul(l!).lt(new X(risk).mul(e))) {
      issues.wallet = '全仓钱包余额不足，无法按当前假设正常开仓'
      out.liquidationMessage = issues.wallet; return out
    }
    m = wallet
  }
  const model = liquidationModel(e, distance, risk, m, input.mode === 'isolated', r, c!, long)
  out.liquidation = model.price
  out.liquidationMessage = model.message
  if (model.price) out.risk = model.atEntry ? 'red' : classify(model, s, target, long)
  return out
}
