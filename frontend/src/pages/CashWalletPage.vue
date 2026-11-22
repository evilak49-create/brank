<script setup>
import { createRequestId } from '../requestId.js'
import { useLocale } from '../locale.js'

import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { formatBrl, parseBrl } from '../money'
import { go } from '../navigation'
import MemberPagination from './MemberPagination.vue'

const { locale, t } = useLocale()

const props = defineProps({ member: Object })
const emit = defineEmits(['refresh-member'])
const wallet = ref(null)
const history = ref(null)
const amount = ref('')
const error = ref('')
const message = ref('')
const loading = ref(true)
const pending = ref(false)
const cents = computed(() => parseBrl(amount.value))
const busy = computed(() => loading.value || pending.value)
const attemptKey = 'cash-club:cash-withdrawal:' + props.member.id
let attempt
try { attempt = JSON.parse(sessionStorage.getItem(attemptKey) || 'null') } catch {}

const statuses = {
  pending: '待审核', processing: '出款处理中', unresolved: '结果待确认',
  paid: '已到账', failed: '出款失败，已退回', rejected: '已驳回，已退回', cancelled: '已取消，款项已退回',
}

function showError(failure) {
  error.value = Object.values(failure.errors ?? {}).flat()[0] || failure.message
}

async function load(page = 1) {
  loading.value = true
  error.value = ''
  try {
    const [summary, orders] = await Promise.all([
      api('/cash-wallet', { fresh: true }),
      api('/cash-wallet/withdrawals?page=' + page, { fresh: true }),
    ])
    wallet.value = summary.data
    history.value = orders
  } catch (failure) {
    showError(failure)
  } finally {
    loading.value = false
  }
}

async function submit() {
  const requested = cents.value
  if (busy.value || !wallet.value || !requested || requested > wallet.value.available_balance_cents || !wallet.value.masked_cpf) return

  pending.value = true
  error.value = ''
  message.value = ''
  if (attempt?.amount !== requested) {
    attempt = { amount: requested, id: createRequestId() }
    try { sessionStorage.setItem(attemptKey, JSON.stringify(attempt)) } catch {}
  }
  try {
    await api('/cash-wallet/withdrawals', { body: { request_id: attempt.id, amount_cents: requested } })
    attempt = null
    try { sessionStorage.removeItem(attemptKey) } catch {}
    amount.value = ''
    message.value = '提现申请已提交，请在下方查看审核进度。'
    emit('refresh-member')
    await load()
  } catch (failure) {
    showError(failure)
  } finally {
    pending.value = false
  }
}

onMounted(() => load())
</script>

<template>
  <div class="stack" :aria-busy="busy">
    <p v-if="error" class="form-error" role="alert">{{ t(error) }}</p>
    <p v-if="message" role="status">{{ t(message) }}</p>
    <button v-if="error && !pending" type="button" class="quiet" :disabled="loading" @click="load()">{{ t('刷新余额与记录') }}</button>
    <p v-if="loading && !wallet" class="muted" role="status">{{ t('正在加载余额…') }}</p>

    <section v-if="wallet" class="surface stack">
      <dl class="summary-list">
        <div><dt>{{ t('可用余额') }}</dt><dd>{{ formatBrl(wallet.available_balance_cents) }}</dd></div>
        <div v-if="wallet.held_balance_cents > 0"><dt>{{ t('提现处理中') }}</dt><dd>{{ formatBrl(wallet.held_balance_cents) }}</dd></div>
        <div v-if="wallet.masked_cpf"><dt>{{ t('Pix 收款账户') }}</dt><dd>{{ wallet.masked_cpf }}</dd></div>
      </dl>
      <button v-if="!wallet.masked_cpf" type="button" class="primary" @click="go('/pix?next=%2Fcash-wallet')">{{ t('绑定 Pix 收款账户') }}</button>
      <form v-else class="stack" @submit.prevent="submit">
        <label class="field">{{ t('提现金额（BRL）') }}
          <input v-model="amount" maxlength="18" inputmode="decimal" autocomplete="off" :disabled="busy" required>
        </label>
        <p v-if="amount && (!cents || cents > wallet.available_balance_cents)" class="muted">{{ t('请输入不超过可用余额的金额，最多两位小数。') }}</p>
        <button class="primary" :disabled="busy || !cents || cents > wallet.available_balance_cents">{{ pending ? t('正在提交…') : t('确认申请提现') }}</button>
      </form>
    </section>

    <section v-if="history" class="surface stack">
      <div class="member-actions">
        <h2>{{ t('余额提现记录') }}</h2>
        <button class="quiet" type="button" @click="go('/withdrawal-history')">{{ t('全部提现记录') }}</button>
      </div>
      <p v-if="!history.data.length" class="muted">{{ t('暂无余额提现记录。') }}</p>
      <article v-for="order in history.data" :key="order.id" class="stack">
        <strong>{{ formatBrl(order.amount_cents) }} · {{ t(order.rejection_deducted ? '已拒绝，款项已扣除' : statuses[order.status]) || order.status }}</strong>
        <time class="muted" :datetime="order.created_at">{{ new Date(order.created_at).toLocaleString(locale) }}</time>
        <p v-if="order.review_reason">{{ order.review_reason }}</p>
      </article>
      <MemberPagination :page="history" :busy="busy" @page="load" />
    </section>
  </div>
</template>
