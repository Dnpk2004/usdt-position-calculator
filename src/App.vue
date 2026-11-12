<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import NumberField from './components/NumberField.vue'
import { createCalculatorState, type Form } from './state'
import { money, percent, price, quantity } from './core/format'

const { form, result, storageWarning, symbolError, percentError, update: change, reset: clear } = createCalculatorState()
const touched = reactive(new Set<keyof Form>())
const copied = ref('')
const p = computed(() => result.value.position)
const common = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']
const riskLabels = { gray: '暂不判断', green: '满足参考缓冲', yellow: '缓冲不足', red: '可能先于止损强平' }
const riskDescriptions = {
  gray: '输入不完整或当前假设不适用，无法给出可靠结论。',
  green: '简化强平价位于止损之外，且满足设定的价格缓冲。',
  yellow: '简化强平价仍在止损之外，但未满足设定的额外缓冲。',
  red: '简化强平价已进入止损区域，或开仓权益未满足维持保证金要求。',
}
function update<K extends keyof Form>(key: K, value: Form[K]) {
  touched.add(key); copied.value = ''; change(key, value)
}
function error(key: keyof Form) {
  const show = touched.has(key) || !!form[key] || (key === 'stop' && touched.has('stopPercent')) || (key === 'take' && touched.has('takePercent'))
  return show ? result.value.issues[key as keyof typeof result.value.issues] : undefined
}
function reset() { clear(); touched.clear(); copied.value = '' }
async function copy(kind: 'notional' | 'quantity') {
  if (!p.value || symbolError.value) return
  try {
    await navigator.clipboard.writeText(p.value[kind].toFixed())
    copied.value = kind === 'notional' ? '已复制仓位名义价值' : '已复制开仓数量'
  } catch { copied.value = '当前浏览器无法复制，请选中结果数字后手动复制。' }
}
const symbol = computed(() => symbolError.value ? '币种' : form.symbol)
const visiblePosition = computed(() => symbolError.value ? null : p.value)
const status = computed(() => symbolError.value ? 'gray' : result.value.risk)
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 17V9m5 8V5m6 12v-5m5 5V3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>
        <div><h1>合约仓位计算器 <span class="version">V1.0</span></h1><p>USDT 本位永续 · 让每笔交易的风险更清晰</p></div>
      </div>
      <div class="local-badge"><span></span>本地计算 · 无需连接账户</div>
    </header>

    <main class="workspace">
      <section class="panel parameters" aria-labelledby="parameters-title">
        <div class="panel-heading"><h2 id="parameters-title"><span class="section-number">01</span>交易参数</h2><button class="text-button" data-testid="reset" @click="reset">↺ 重置</button></div>
        <div class="form-content">
          <div class="field"><label for="symbol">交易币种 <span class="tiny-label">USDT 永续</span></label>
            <div class="symbol-row"><div class="input-wrap symbol-input"><input id="symbol" :value="form.symbol" maxlength="24" autocomplete="off" spellcheck="false" :aria-invalid="!!symbolError" @input="update('symbol', ($event.target as HTMLInputElement).value)" /><span class="suffix">/ USDT</span></div><span class="contract-name">{{ symbol }}USDT</span></div>
            <div class="coin-buttons"><button v-for="coin in common" :key="coin" :data-testid="`symbol-${coin}`" :class="{ active: form.symbol === coin }" :aria-pressed="form.symbol === coin" @click="update('symbol', coin)">{{ coin }}</button></div>
            <p v-if="symbolError" class="field-error">{{ symbolError }}</p>
            <p v-if="!common.includes(form.symbol)" class="field-note">手动币种仅用于理论计算，不保证存在对应合约。</p>
          </div>

          <div class="two-columns switches">
            <div class="field"><label id="direction-label">交易方向</label><div class="segmented" role="group" aria-labelledby="direction-label"><button :class="{ 'long-active': form.direction === 'long' }" :aria-pressed="form.direction === 'long'" data-testid="long" @click="update('direction', 'long')">↗ 做多 <small>Long</small></button><button :class="{ 'short-active': form.direction === 'short' }" :aria-pressed="form.direction === 'short'" data-testid="short" @click="update('direction', 'short')">↘ 做空 <small>Short</small></button></div></div>
            <div class="field"><label id="mode-label">保证金模式</label><div class="segmented" role="group" aria-labelledby="mode-label"><button :class="{ active: form.mode === 'isolated' }" :aria-pressed="form.mode === 'isolated'" @click="update('mode', 'isolated')">逐仓</button><button :class="{ active: form.mode === 'cross' }" :aria-pressed="form.mode === 'cross'" data-testid="cross" @click="update('mode', 'cross')">简化全仓</button></div></div>
          </div>

          <NumberField id="entry" label="开仓价格" :model-value="form.entry" suffix="USDT" placeholder="手动输入计划开仓价格" :error="error('entry')" @update:model-value="update('entry', $event)" />
          <div class="two-columns price-pair">
            <NumberField id="stop" label="止损价格" :model-value="form.stop" suffix="USDT" :error="error('stop')" @update:model-value="update('stop', $event)" />
            <NumberField id="stopPercent" label="止损距离" :model-value="form.stopPercent" suffix="%" placeholder="与止损价联动" :error="percentError('stopPercent')" @update:model-value="update('stopPercent', $event)" />
          </div>
          <div class="two-columns price-pair">
            <NumberField id="take" label="止盈价格" optional :model-value="form.take" suffix="USDT" placeholder="不填则不计算收益" :error="error('take')" @update:model-value="update('take', $event)" />
            <NumberField id="takePercent" label="止盈距离" :model-value="form.takePercent" suffix="%" placeholder="与止盈价联动" :error="percentError('takePercent')" @update:model-value="update('takePercent', $event)" />
          </div>
          <NumberField id="risk" label="计划止损亏损" :model-value="form.risk" suffix="USDT" :error="error('risk')" @update:model-value="update('risk', $event)" />
          <p class="field-note risk-note">仅指按设定止损价成交时的理论价格亏损，不含手续费、滑点和资金费用。</p>

          <div class="divider"></div>
          <div class="two-columns leverage-row">
            <NumberField id="leverage" label="参考杠杆" :model-value="form.leverage" suffix="倍" :error="error('leverage')" @update:model-value="update('leverage', $event)" />
            <NumberField id="buffer" label="额外强平安全缓冲" :model-value="form.buffer" suffix="%" :error="error('buffer')" @update:model-value="update('buffer', $event)" />
          </div>
          <div class="leverage-buttons"><button v-for="l in [5, 10, 20, 50]" :key="l" :class="{ active: form.leverage === String(l) }" @click="update('leverage', String(l))">{{ l }}×</button></div>
          <div v-if="form.mode === 'isolated'" class="recommend-actions">
            <button :disabled="!result.highest || !!symbolError" @click="update('leverage', String(result.highest))">应用最高参考 <strong>{{ result.highest ? `${result.highest}×` : '—' }}</strong><span>↗</span></button>
            <button class="conservative-action" data-testid="apply-conservative" :disabled="!result.conservative || !!symbolError" @click="update('leverage', String(result.conservative))">应用保守推荐 <strong>{{ result.conservative ? `${result.conservative}×` : '—' }}</strong><span>↗</span></button>
          </div>
          <p class="field-note">1–125 倍仅为本地参考范围，不代表币安各币种可用档位。</p>
          <div v-if="form.mode === 'cross'" class="cross-wallet"><NumberField id="wallet" label="全仓钱包余额" :model-value="form.wallet" suffix="USDT" placeholder="填写余额以估算全仓强平价" :error="error('wallet')" @update:model-value="update('wallet', $event)" /><p class="field-note">假设没有其他全仓仓位、挂单或负债。此模式不提供逐仓杠杆推荐。</p></div>

          <details class="assumptions"><summary><span>估算假设 <span class="muted">· 本地模拟参数</span></span><span class="chevron">⌄</span></summary><div class="assumptions-body"><div class="two-columns"><NumberField id="mmr" label="参考维持保证金率" :model-value="form.mmr" suffix="%" :error="error('mmr')" @update:model-value="update('mmr', $event)" /><NumberField id="maintenance" label="参考维持保证金扣减额" :model-value="form.maintenance" suffix="USDT" :error="error('maintenance')" @update:model-value="update('maintenance', $event)" /></div><p>默认 MMR 0.5%、扣减额 0 USDT 为固定单档模拟假设，非任何币种的真实最新档位。维持保证金 = 数量 × 标记价格 × MMR − 扣减额。</p></div></details>
        </div>
      </section>

      <section class="results" aria-labelledby="results-title">
        <div class="panel result-panel">
          <div class="panel-heading"><h2 id="results-title"><span class="section-number">02</span>实时计算结果</h2><span class="calculation-badge"><i></i>输入即计算</span></div>
          <div class="results-content">
            <div class="result-context"><span class="contract-pill">{{ symbol }}USDT</span><span :class="form.direction === 'long' ? 'positive' : 'negative'">{{ form.direction === 'long' ? '↗ 做多' : '↘ 做空' }}</span><span>{{ form.mode === 'isolated' ? '逐仓' : '简化全仓' }} · {{ form.leverage || '—' }}×</span></div>
            <div class="primary-results">
              <article class="primary-result"><div class="primary-label">仓位名义价值<button class="copy-button" data-testid="copy-notional" :disabled="!visiblePosition" aria-label="复制仓位名义价值" title="复制完整精度数值" @click="copy('notional')"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="6" y="6" width="10" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M12 6V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4"/></svg></button></div><div class="primary-number" data-testid="notional">{{ money(visiblePosition?.notional) }}</div><span class="primary-unit">USDT</span></article>
              <article class="primary-result"><div class="primary-label">开仓数量<button class="copy-button" data-testid="copy-quantity" :disabled="!visiblePosition" aria-label="复制开仓数量" title="复制完整精度数值" @click="copy('quantity')"><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="6" y="6" width="10" height="11" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M12 6V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4"/></svg></button></div><div class="primary-number" data-testid="quantity">{{ quantity(visiblePosition?.quantity) }}</div><span class="primary-unit">{{ symbol }}</span></article>
            </div>
            <p v-if="!visiblePosition" class="result-hint">填写开仓价格与止损位置，按计划亏损自动计算仓位。</p>
            <p v-else class="result-hint">按止损风险计算仓位，调整杠杆只改变理论初始保证金。</p>
            <p v-if="visiblePosition?.quantity.lt('0.00000001')" class="precision-note">数量小于八位小数显示精度，非真实零；复制保留完整计算精度。</p>
            <p class="copy-status" role="status">{{ copied }}</p>
            <div class="metrics">
              <div><span>理论初始保证金</span><strong data-testid="margin">{{ money(visiblePosition?.initialMargin) }} <small>USDT</small></strong></div>
              <div><span>止损距离</span><strong>{{ percent(visiblePosition?.stopPercent) }}</strong></div>
              <div><span>理论止损亏损</span><strong class="negative">{{ money(visiblePosition?.loss) }} <small>USDT</small></strong></div>
              <div><span>预计止盈收益</span><strong :class="{ positive: visiblePosition?.profit }">{{ money(visiblePosition?.profit) }} <small v-if="visiblePosition?.profit">USDT</small></strong></div>
              <div><span>盈亏比 <small>收益 / 风险</small></span><strong data-testid="ratio">{{ visiblePosition?.ratio ? `${quantity(visiblePosition.ratio)} : 1` : '—' }}</strong></div>
              <div v-if="form.mode === 'cross'"><span>全仓钱包余额</span><strong>{{ form.wallet ? money(form.wallet && !result.issues.wallet ? form.wallet : null) : '—' }} <small>USDT</small></strong></div>
              <div v-else><span>合约类型</span><strong class="contract-type">USDT 线性永续</strong></div>
            </div>
            <div v-if="form.mode === 'isolated'" class="recommend-summary"><div><span>最高参考杠杆</span><strong>{{ result.highest && !symbolError ? `${result.highest}×` : '—' }}</strong></div><div><span>保守推荐杠杆 <small>含 {{ form.buffer || '—' }}% 缓冲</small></span><strong>{{ result.conservative && !symbolError ? `${result.conservative}×` : '—' }}</strong></div></div>
            <p v-if="visiblePosition && form.mode === 'isolated' && (!result.highest || !result.conservative)" class="field-note">无符合当前条件的推荐杠杆：{{ !result.highest ? '最高参考' : '' }}{{ !result.highest && !result.conservative ? '、' : '' }}{{ !result.conservative ? '保守推荐' : '' }}。</p>
            <p v-for="warning in result.warnings" :key="warning" class="warning-note">{{ warning }}</p>
          </div>
        </div>

        <div class="panel liquidation-panel" :class="`risk-${status}`" data-testid="risk" :data-state="status">
          <div class="liquidation-title"><h2>强平风险参考</h2><span class="estimate-tag">简化预估</span></div>
          <div class="liquidation-main"><div><span class="muted">预估强平价格</span><div class="liquidation-value">{{ price(symbolError ? null : result.liquidation) }} <small v-if="result.liquidation && !symbolError">USDT</small></div></div><span class="risk-badge"><i></i>{{ riskLabels[status] }}</span></div>
          <p class="risk-description">{{ riskDescriptions[status] }}</p>
          <p class="model-message">{{ symbolError || result.liquidationMessage }}</p>
          <div v-if="visiblePosition && result.bufferTarget" class="buffer-target">{{ form.buffer }}% 缓冲目标：强平价{{ form.direction === 'long' ? '不高于' : '不低于' }} <strong>{{ price(result.bufferTarget) }}</strong> USDT</div>
          <div class="risk-disclaimer">强平基于币安标记价格，止损单可能使用不同触发价格。颜色仅表示简化价格位置关系，不保证实际止损先于强平成交。</div>
        </div>

        <aside class="usage-note"><span class="info-icon">i</span><div><strong>计算有边界，交易需留余量</strong><p>结果未按币安下单数量步长与最小名义价值取整。实际维持保证金档位、其他持仓、追加保证金、手续费、资金费及滑点均可能影响结果；强平估算不保证与币安实际显示一致。</p></div></aside>
      </section>
    </main>
    <footer><span>手动价格 · 十进制计算 · 设置仅保存在本机浏览器</span><span>独立交易辅助工具</span></footer>
    <p v-if="storageWarning" class="storage-warning" role="status">{{ storageWarning }}</p>
  </div>
</template>
