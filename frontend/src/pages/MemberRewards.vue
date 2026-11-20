<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { currentRoute, go, resume, safePath } from '../navigation'
import MemberPagination from './MemberPagination.vue'

const props = defineProps({ route: Object, member: Object })
const path = props.route.path
const home = '/red-packets'
const withdraw = home + '/withdraw'
const isHome = path === home
const isInvites = path === home + '/invites'
const isWithdraw = path === withdraw
const isPix = path === '/pix'
const next = safePath(props.route.query.get('next'), '')
const loading = ref(true)
const working = ref(false)
const error = ref('')
const info = ref('')
const packets = ref(null)
const records = ref(null)
const order = ref(null)
const account = ref(null)
const editing = ref(false)
const cpf = ref('')
const inviteInput = ref(null)
const linkVisible = ref(false)
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const statuses = { pending: '待审核', processing: '处理中', paid: '已到账', rejected: '未通过', failed: '提现失败', unresolved: '结果待确认' }
const round = computed(() => packets.value?.round)
const pageCopy = computed(() => packets.value?.page_copy)
const ready = computed(() => canWithdraw(round.value))
const inviteLink = computed(() => {
  const relative = packets.value?.invite_url
  if (typeof relative !== 'string') return ''
  try {
    const url = new URL(relative, location.origin)
    return url.origin === location.origin ? url.href : ''
  } catch {
    return ''
  }
})
const openKey = 'cash-club:red-packet-open:' + props.member?.id
const attempts = new Map()

function date(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function money(value) {
  return currency.format(Number(value) / 100)
}

function canWithdraw(value) {
  return Boolean(value && !value.closed_at && value.remaining_cents <= 0 && value.frozen_cents === 0 && value.available_cents > 0)
}

function showError(failure) {
  error.value = Object.values(failure.errors ?? {}).flat()[0] || failure.message
}

function getAttempt(key) {
  try {
    const previous = sessionStorage.getItem(key)
    if (previous) return previous
  } catch {}
  if (attempts.has(key)) return attempts.get(key)
  const id = crypto.randomUUID()
  attempts.set(key, id)
  try { sessionStorage.setItem(key, id) } catch {}
  return id
}

function clearAttempt(key) {
  attempts.delete(key)
  try { sessionStorage.removeItem(key) } catch {}
}

function pageLink(page) {
  go(path + (page > 1 ? '?page=' + page : ''), { replace: true })
}

function bindPix() {
  if (currentRoute.value.key === props.route.key) {
    go('/pix?' + new URLSearchParams({ next: withdraw }), { replace: true })
  }
}

async function load() {
  error.value = ''
  loading.value = true
  const page = Number(props.route.query.get('page')) || 1
  try {
    if (isHome) {
      const [activity, history] = await Promise.allSettled([api(home, { fresh: true }), api('/pix-withdrawals?page=' + page)])
      if (activity.status === 'fulfilled') {
        packets.value = activity.value.data
        if (round.value) clearAttempt(openKey)
      }
      if (history.status === 'fulfilled') records.value = history.value
      if (activity.status === 'rejected') throw activity.reason
      if (history.status === 'rejected') throw history.reason
    } else if (isInvites) {
      records.value = await api(home + '/invites?page=' + page)
    } else if (isPix) {
      account.value = (await api('/pix-account')).data
    } else if (isWithdraw) {
      const [activity, pix] = await Promise.all([api(home), api('/pix-account')])
      packets.value = activity.data
      account.value = pix.data
      if (ready.value && !account.value.masked_cpf) bindPix()
    } else {
      order.value = (await api('/pix-withdrawals/' + props.route.params.id)).data
    }
  } catch (failure) {
    showError(failure)
  } finally {
    loading.value = false
  }
}

async function open() {
  if (working.value || round.value || !packets.value) return
  error.value = ''
  info.value = ''
  working.value = true
  try {
    const { data } = await api(home + '/open', { body: { request_id: getAttempt(openKey) } })
    clearAttempt(openKey)
    if (data.closed_at) {
      await load()
      return
    }
    packets.value = { ...packets.value, round: data }
    info.value = '已拆开红包，初始奖励 ' + money(data.initial_cents) + '。'
  } catch (failure) {
    showError(failure)
  } finally {
    working.value = false
  }
}

async function copyInvite() {
  if (!inviteLink.value) return
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    info.value = '邀请链接已复制。'
  } catch {
    info.value = '请选中并复制邀请链接。'
    linkVisible.value = true
    requestAnimationFrame(() => { inviteInput.value?.focus(); inviteInput.value?.select() })
  }
}

async function shareInvite() {
  if (!inviteLink.value) return
  if (navigator.share) {
    try { await navigator.share({ title: pageCopy.value?.opening_title || '现金红包邀请', url: inviteLink.value }); return }
    catch (failure) { if (failure.name === 'AbortError') return }
  }
  linkVisible.value = true
  requestAnimationFrame(() => inviteInput.value?.focus())
}

async function savePix() {
  if (working.value) return
  error.value = ''
  info.value = ''
  working.value = true
  try {
    const value = cpf.value.trim()
    if (!/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(value)) throw new Error('请输入有效的 11 位 CPF。')
    account.value = (await api('/pix-account', { method: 'PUT', body: { cpf: value } })).data
    cpf.value = ''
    editing.value = false
    if (next && currentRoute.value.key === props.route.key) resume(next)
    else info.value = 'Pix 收款账户已保存。'
  } catch (failure) {
    showError(failure)
  } finally {
    working.value = false
  }
}

function cancelPixEdit() {
  if (next === withdraw) {
    resume(home)
    return
  }
  editing.value = false
  cpf.value = ''
  error.value = ''
}

async function confirmWithdrawal() {
  if (working.value || !ready.value || !account.value?.masked_cpf) return
  error.value = ''
  working.value = true
  const snapshot = { id: round.value.id, amount: round.value.available_cents, cpf: account.value.masked_cpf }
  try {
    const [activity, pix] = await Promise.all([api(home), api('/pix-account')])
    packets.value = activity.data
    account.value = pix.data
    if (!ready.value) throw new Error('当前红包余额不可提现，请返回查看处理记录。')
    if (!account.value.masked_cpf) {
      bindPix()
      return
    }
    if (round.value.id !== snapshot.id || round.value.available_cents !== snapshot.amount || account.value.masked_cpf !== snapshot.cpf) {
      throw new Error('红包金额或收款账户已更新，请重新核对后确认。')
    }
    if (currentRoute.value.key !== props.route.key) return
    const key = ['cash-club:pix-withdrawal', props.member.id, snapshot.id, snapshot.amount, snapshot.cpf].join(':')
    await api('/pix-withdrawals', { body: { request_id: getAttempt(key) } })
    clearAttempt(key)
    if (currentRoute.value.key === props.route.key) resume(home)
  } catch (failure) {
    showError(failure)
  } finally {
    working.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="member-page" :aria-busy="loading">
    <template v-if="isHome">
      <section v-if="packets && !round" class="surface stack member-reward">
        <svg class="member-envelope" :data-opening="working" viewBox="0 0 120 104" aria-hidden="true">
          <rect x="8" y="18" width="104" height="76" rx="14" fill="#b84462"/>
          <path d="M8 31Q8 18 22 18h76q14 0 14 13v12L69 70a17 17 0 0 1-18 0L8 43Z" fill="#e7677c"/>
          <circle cx="60" cy="64" r="15" fill="#f9cd7e"/>
          <path d="M60 55v18m-8-9h16" stroke="#a85e42" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <h2>{{ pageCopy?.opening_title || '现金红包' }}</h2>
        <p v-if="pageCopy?.opening_description" class="reward-opening-description">{{ pageCopy.opening_description }}</p>
        <div class="member-actions"><button class="primary" :disabled="working" @click="open">{{ working ? '正在拆开…' : (pageCopy?.open_label || '拆开红包') }}</button></div>
      </section>

      <section v-else-if="round" class="surface member-hero stack">
        <h2>{{ pageCopy?.balance_title || '本轮红包' }}</h2>
        <strong>{{ money(round.balance_cents) }}</strong>
        <progress class="member-progress" :value="round.balance_cents" :max="round.threshold_cents" aria-label="提现进度"></progress>
        <p>提现目标 {{ money(round.threshold_cents) }}</p>
        <p v-if="round.frozen_cents > 0">提现处理中 · {{ money(round.frozen_cents) }}</p>
        <p v-else-if="round.remaining_cents > 0">还差 {{ money(round.remaining_cents) }} 可提现</p>
        <p v-else>已达到提现目标</p>
        <div class="member-actions">
          <button class="primary" :disabled="!ready" @click="go(withdraw)">申请提现</button>
          <button class="quiet" :disabled="!inviteLink" @click="shareInvite">{{ pageCopy?.invite_label || '邀请好友' }}</button>
          <button class="quiet" :disabled="!inviteLink" @click="copyInvite">复制链接</button>
          <button class="quiet" @click="go(home + '/invites')">邀请明细</button>
        </div>
        <label v-if="linkVisible" class="field">邀请链接
          <input ref="inviteInput" :value="inviteLink" readonly @focus="$event.target.select()">
        </label>
      </section>

      <p v-if="info" class="surface" role="status">{{ info }}</p>

      <section v-if="pageCopy?.rules_html" class="surface stack">
        <details>
          <summary>{{ pageCopy.rules_title }}</summary>
          <div class="reward-rule-copy" v-html="pageCopy.rules_html"></div>
        </details>
      </section>

      <section v-if="records" class="surface stack">
        <h2>提现记录</h2>
        <ul v-if="records.data.length" class="row-list">
          <li v-for="record in records.data" :key="record.id">
            <button @click="go(home + '/withdrawals/' + record.id)">
              <span><strong>{{ money(record.amount_cents) }}</strong><small>{{ date(record.created_at) }}</small></span>
              <span>{{ statuses[record.status] || record.status }} ›</span>
            </button>
          </li>
        </ul>
        <p v-else class="muted">暂无提现记录。</p>
        <MemberPagination :page="records" :busy="loading" @page="pageLink" />
      </section>
    </template>

    <section v-else-if="isPix" class="surface stack">
      <form v-if="editing" class="stack" @submit.prevent="savePix">
        <label class="field">CPF
          <input v-model="cpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" maxlength="14" required :disabled="working">
        </label>
        <p class="muted">请填写已注册为 Pix 收款键的 CPF。</p>
        <div class="member-actions">
          <button class="primary" :disabled="working">{{ working ? '正在保存…' : '保存' }}</button>
          <button class="quiet" type="button" :disabled="working" @click="cancelPixEdit">取消</button>
        </div>
      </form>
      <template v-else-if="account">
        <p v-if="account.masked_cpf">CPF · {{ account.masked_cpf }}</p>
        <p v-else class="muted">尚未绑定 Pix 收款账户。</p>
        <div class="member-actions">
          <button class="primary" @click="editing = true; info = ''">{{ account.masked_cpf ? '更换 CPF' : '绑定 Pix' }}</button>
          <button v-if="next === withdraw" class="quiet" @click="resume(home)">返回红包</button>
        </div>
      </template>
      <p v-if="info" role="status">{{ info }}</p>
    </section>

    <section v-else-if="isWithdraw" class="surface stack">
      <h2>确认提现</h2>
      <template v-if="ready && account?.masked_cpf">
        <dl class="member-definition">
          <div><dt>提现金额</dt><dd>{{ money(round.available_cents) }}</dd></div>
          <div><dt>收款方式</dt><dd>Pix</dd></div>
          <div><dt>CPF</dt><dd>{{ account.masked_cpf }}</dd></div>
        </dl>
        <button class="primary" :disabled="working || loading" @click="confirmWithdrawal">{{ working ? '正在确认…' : '确认提现' }}</button>
      </template>
      <p v-else-if="packets && !loading" class="muted">当前没有可提现的红包余额。</p>
      <button class="quiet" :disabled="working" @click="resume(home)">返回红包</button>
    </section>

    <section v-else-if="isInvites" class="surface stack">
      <ul v-if="records?.data.length" class="row-list">
        <li v-for="invite in records.data" :key="invite.id" class="member-invite-row">
          <span><strong>{{ invite.settled_at ? '已结算' : '待结算' }}</strong><small>{{ date(invite.registered_at) }}</small></span>
          <span class="member-positive">{{ invite.settled_at ? '+' + money(invite.reward_cents) : '—' }}</span>
        </li>
      </ul>
      <p v-else-if="records" class="muted">暂无邀请记录。</p>
      <MemberPagination :page="records" :busy="loading" @page="pageLink" />
    </section>

    <section v-else-if="order" class="surface stack">
      <dl class="member-definition">
        <div><dt>订单号</dt><dd>{{ order.order_number }}</dd></div>
        <div><dt>申请金额</dt><dd>{{ money(order.amount_cents) }}</dd></div>
        <div><dt>Pix CPF</dt><dd>{{ order.masked_cpf }}</dd></div>
        <div><dt>申请时间</dt><dd>{{ date(order.created_at) }}</dd></div>
        <div><dt>处理状态</dt><dd>{{ statuses[order.status] || order.status }}</dd></div>
        <div v-if="order.paid_at"><dt>到账时间</dt><dd>{{ date(order.paid_at) }}</dd></div>
        <div v-if="order.review_reason"><dt>处理说明</dt><dd>{{ order.review_reason }}</dd></div>
      </dl>
      <div v-if="['failed', 'rejected'].includes(order.status)" class="member-actions">
        <button class="quiet" @click="go('/pix')">核对收款账户</button>
        <button class="quiet" @click="go(home)">返回红包</button>
      </div>
    </section>
    <p v-if="loading" role="status" class="muted">正在加载…</p>
    <div v-if="error" class="stack">
      <p class="error" role="alert">{{ error }}</p>
      <button v-if="!working && !editing && (isHome || !round) && !order" class="quiet" @click="load">重新加载</button>
    </div>
  </div>
</template>

<style scoped>
.reward-opening-description { text-align: center; white-space: pre-line; overflow-wrap: anywhere; }
.reward-rule-copy { display: grid; gap: 0.65rem; margin-top: 0.75rem; overflow-wrap: anywhere; }
.reward-rule-copy :deep(ul) { list-style: disc; padding-inline-start: 1.4rem; }
.reward-rule-copy :deep(ol) { list-style: decimal; padding-inline-start: 1.4rem; }
.reward-rule-copy :deep(blockquote) { border-inline-start: 2px solid var(--line); padding-inline-start: 0.75rem; }
.reward-rule-copy :deep(a) { text-decoration: underline; }
</style>
