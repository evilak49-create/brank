<script setup>
import { useLocale } from '../locale.js'

import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { formatBrl } from '../money'
import MemberPagination from './MemberPagination.vue'

const { locale, t } = useLocale()

const records = ref(null)
const loading = ref(true)
const error = ref('')
const requestedPage = ref(1)
let request

const statuses = { reviewing: '审核中', succeeded: '已成功', failed: '已失败', cancelled: '已取消，款项已退回' }
const sources = { red_packet: '红包提现', balance: '余额提现' }

async function load(page = 1) {
  request?.abort()
  request = new AbortController()
  const { signal } = request
  requestedPage.value = page
  loading.value = true
  error.value = ''
  try {
    const data = await api('/withdrawal-history?' + new URLSearchParams({ page }), { signal, fresh: true })
    if (!signal.aborted) records.value = data
  } catch (failure) {
    if (!signal.aborted) error.value = failure.message
  } finally {
    if (!signal.aborted) loading.value = false
  }
}

onMounted(() => load())
onUnmounted(() => request?.abort())
</script>

<template>
  <section class="surface stack" :aria-busy="loading">
    <p v-if="loading && !records" class="muted" role="status">{{ t('正在加载提现记录…') }}</p>
    <div v-if="error" class="stack">
      <p class="form-error" role="alert">{{ t(error) }}</p>
      <button class="quiet" type="button" @click="load(requestedPage)">{{ t('重试') }}</button>
    </div>
    <template v-else-if="records">
      <p v-if="!records.data.length" class="muted">{{ t('暂无提现记录。') }}</p>
      <ul v-else class="withdrawal-history">
        <li v-for="order in records.data" :key="order.id" class="stack withdrawal-order">
          <div class="withdrawal-summary">
            <strong>{{ t(sources[order.source]) }}</strong>
            <span class="withdrawal-status" :data-status="order.status">{{ t(order.rejection_deducted ? '已拒绝，款项已扣除' : statuses[order.status]) }}</span>
          </div>
          <strong>{{ formatBrl(order.amount_cents) }}</strong>
          <p class="muted withdrawal-order-number">{{ t('订单号') }} {{ order.order_number }}</p>
          <p class="muted">{{ t('申请时间') }} <time :datetime="order.created_at">{{ new Date(order.created_at).toLocaleString(locale) }}</time></p>
          <p v-if="order.paid_at" class="muted">{{ t('到账时间') }} <time :datetime="order.paid_at">{{ new Date(order.paid_at).toLocaleString(locale) }}</time></p>
          <p v-if="order.status === 'failed' && order.review_reason" class="muted">{{ order.review_reason }}</p>
        </li>
      </ul>
      <MemberPagination :page="records" :busy="loading" @page="load" />
    </template>
  </section>
</template>

<style scoped>
.withdrawal-history { display: grid; gap: 10px; list-style: none; padding: 0; margin: 0; }
.withdrawal-order { gap: 6px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; }
.withdrawal-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.withdrawal-status { padding: 2px 8px; border: 1px solid currentColor; border-radius: 999px; font-size: 12px; }
.withdrawal-status[data-status="reviewing"] { color: #f5d998; }
.withdrawal-status[data-status="succeeded"] { color: #8ee1b6; }
.withdrawal-status[data-status="failed"] { color: #ffb2c4; }
.withdrawal-order-number { overflow-wrap: anywhere; }
</style>
