<script setup>
import { computed, onMounted, ref } from 'vue'
import { api } from '../api'
import { currentRoute, go, resume, safePath } from '../navigation'
import MemberPagination from './MemberPagination.vue'

const props = defineProps({ route: Object, member: Object })
const emit = defineEmits(['logout', 'refresh-member'])
const path = props.route.path
const query = props.route.query
const destination = safePath(query.get('next'), '')
const isWallet = path === '/wallet'
const isAddress = path === '/address'
const isCenter = path === '/member'
const direction = ['credit', 'debit'].includes(query.get('direction')) ? query.get('direction') : ''
const platformId = /^[1-9]\d*$/.test(query.get('platform_id') ?? '') ? query.get('platform_id') : ''
const loading = ref(true)
const error = ref('')
const working = ref(false)
const checkin = ref(null)
const balance = ref(null)
const records = ref(null)
const entry = ref(null)
const address = ref(null)
const edit = ref(null)
const message = ref('')
const fields = [
  ['recipient', '收件人', 'name', 120], ['phone', '联系电话', 'tel', 20],
  ['postal_code', '邮编（CEP）', 'postal-code', 9], ['state', '州', 'address-level1', 2],
  ['city', '城市', 'address-level2', 120], ['district', '街区', 'address-level3', 120],
  ['street', '街道', 'street-address', 200], ['number', '门牌号', 'off', 32],
  ['complement', '地址补充信息（选填）', 'address-line2', 200],
]
const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')
const links = [
  ['/red-packets', '我的红包'], ['/protection', '我的保障'], ['/shop/redemptions', '商城兑换记录'],
  ['/bindings', '已绑定平台'], ['/address', '收货地址'], ['/pix', '收款账户'], ['/reset-password', '修改密码'],
]
const entryStatuses = {
  confirmed: '已到账', pending: '待处理', shipped: '已发货', cancelled: '已取消', processing: '处理中',
  paid: '已到账', rejected: '未通过', failed: '未成功', unresolved: '结果待确认', expired: '已过期',
}
const relatedPath = computed(() => {
  const related = entry.value?.related
  if (!related) return ''
  if (related.type === 'deposit') return '/points/quotes/' + related.id
  const type = related.type === 'shop_order' ? 'goods' : 'funds'
  return '/shop/redemptions/' + related.id + '?type=' + type
})
function date(value) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function showError(failure) {
  error.value = Object.values(failure.errors ?? {}).flat()[0] || failure.message
}

function walletQuery(nextDirection, page, nextPlatform = platformId) {
  const params = new URLSearchParams()
  if (nextDirection) params.set('direction', nextDirection)
  if (nextPlatform) params.set('platform_id', nextPlatform)
  if (page > 1) params.set('page', page)
  return params.toString()
}

function walletPage(nextDirection, page = 1, nextPlatform = platformId) {
  const params = walletQuery(nextDirection, page, nextPlatform)
  go('/wallet' + (params ? '?' + params : ''), { replace: true })
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (isCenter) checkin.value = (await api('/check-in')).data
    else if (isAddress) address.value = (await api('/shipping-address')).data
    else if (isWallet) {
      const [wallet, page] = await Promise.all([
        api('/wallet'), api('/wallet/entries?' + walletQuery(direction, Number(query.get('page')) || 1)),
      ])
      balance.value = wallet.data.points_balance
      records.value = page
    } else entry.value = (await api('/wallet/entries/' + props.route.params.id)).data
  } catch (failure) {
    showError(failure)
  } finally {
    loading.value = false
  }
}

async function recordCheckin() {
  if (working.value || checkin.value?.checked_in) return
  working.value = true
  error.value = ''
  try {
    checkin.value = (await api('/check-in', { method: 'POST' })).data
    emit('refresh-member')
  } catch (failure) {
    showError(failure)
  } finally {
    working.value = false
  }
}

async function editAddress() {
  if (working.value) return
  working.value = true
  error.value = ''
  message.value = ''
  try {
    const current = address.value ? (await api('/shipping-address?for_edit=1')).data : null
    edit.value = Object.fromEntries(fields.map(([key]) => [key, current?.[key] ?? '']))
  } catch (failure) {
    showError(failure)
  } finally {
    working.value = false
  }
}

async function saveAddress() {
  if (working.value) return
  working.value = true
  error.value = ''
  try {
    address.value = (await api('/shipping-address', { method: 'PUT', body: { ...edit.value } })).data
    edit.value = null
    if (destination && currentRoute.value.key === props.route.key) resume(destination)
    else message.value = '收货地址已保存。'
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
    <template v-if="isCenter">
      <section class="surface stack">
        <div class="member-account-head">
          <span class="member-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21a7.5 7.5 0 1 1 15 0"/></svg></span>
          <strong>{{ member?.phone || '—' }}</strong>
        </div>
        <div class="member-actions">
          <button class="primary" :disabled="working || loading || !checkin || checkin.checked_in" @click="recordCheckin">
            {{ checkin?.checked_in ? '今日已签到' : '签到' }}
          </button>
          <span v-if="checkin" role="status" class="muted">
            连续 {{ checkin.streak }} 天<span v-if="checkin.checked_in"> · 今日获得 {{ checkin.reward_points }} 积分</span>
          </span>
        </div>
      </section>
      <section class="surface member-hero stack">
        <p>可用积分</p>
        <strong>{{ member?.points_balance ?? '—' }}</strong>
        <button class="quiet" @click="go('/wallet')">查看积分钱包 →</button>
      </section>
      <nav aria-label="个人中心入口">
        <ul class="row-list">
          <li v-for="[link, label] in links" :key="link"><button @click="go(link)">{{ label }}<span aria-hidden="true">›</span></button></li>
        </ul>
      </nav>
      <button class="quiet" @click="emit('logout')">退出登录</button>
    </template>

    <template v-else-if="isWallet">
      <section class="surface member-hero stack">
        <p>可用积分</p><strong>{{ balance ?? '—' }}</strong>
        <div class="member-actions">
          <button class="primary" @click="go('/points')">兑换积分</button>
          <button class="quiet" @click="go('/shop')">去商城</button>
        </div>
      </section>
      <section class="surface stack">
        <h2>积分明细</h2>
        <div class="segmented" aria-label="积分明细筛选">
          <button v-for="[key, label] in [['', '全部'], ['credit', '获得'], ['debit', '支出']]"
            :key="key" :aria-pressed="direction === key" @click="walletPage(key)">{{ label }}</button>
        </div>
        <div v-if="platformId" class="member-actions">
          <span class="muted">当前按平台筛选</span>
          <button class="quiet" @click="walletPage(direction, 1, '')">清除平台筛选</button>
        </div>
        <ul v-if="records?.data.length" class="row-list">
          <li v-for="record in records.data" :key="record.id">
            <button @click="go('/wallet/' + record.id)">
              <span><strong>{{ record.source_label }}</strong><small>{{ date(record.created_at) }}</small></span>
              <span :class="{ 'member-positive': record.direction === 'credit' }">{{ record.direction === 'credit' ? '+' : '−' }}{{ record.amount }} 积分 ›</span>
            </button>
          </li>
        </ul>
        <p v-else-if="records" class="muted">暂无积分明细。</p>
        <MemberPagination :page="records" :busy="loading" @page="walletPage(direction, $event)" />
      </section>
    </template>

    <section v-else-if="isAddress" class="surface stack">
      <form v-if="edit" class="stack" @submit.prevent="saveAddress">
        <label v-for="[key, label, autocomplete, maxlength] in fields" :key="key" class="field">
          {{ label }}
          <select v-if="key === 'state'" v-model="edit.state" required :autocomplete="autocomplete" :disabled="working">
            <option value="">选择州</option><option v-for="state in states" :key="state">{{ state }}</option>
          </select>
          <input v-else v-model.trim="edit[key]" :type="key === 'phone' ? 'tel' : 'text'"
            :inputmode="key === 'postal_code' ? 'numeric' : undefined" :required="key !== 'complement'"
            :maxlength="maxlength" :autocomplete="autocomplete" :disabled="working">
        </label>
        <div class="member-actions">
          <button class="primary" :disabled="working">{{ working ? '正在保存…' : '保存地址' }}</button>
          <button class="quiet" type="button" :disabled="working" @click="edit = null; error = ''">取消</button>
        </div>
      </form>
      <template v-else-if="!loading">
        <template v-if="address">
          <p>{{ address.recipient }} · {{ address.masked_phone }}</p>
          <p class="muted">{{ address.street }} {{ address.number }} · {{ address.district }}<br>
            {{ address.city }} / {{ address.state }} · CEP {{ address.postal_code }}<br v-if="address.complement">
            {{ address.complement }}</p>
        </template>
        <p v-else-if="!error" class="muted">暂无收货地址。</p>
        <div v-if="address || !error || working" class="member-actions">
          <button class="primary" :disabled="working" @click="editAddress">{{ address ? '编辑' : '添加收货地址' }}</button>
        </div>
        <p v-if="message" role="status">{{ message }}</p>
      </template>
    </section>

    <section v-else-if="entry" class="surface stack">
      <h2>{{ entry.source_label }}</h2>
      <dl class="member-definition">
        <div><dt>积分变动</dt><dd>{{ entry.direction === 'credit' ? '+' : '−' }}{{ entry.amount }} 积分</dd></div>
        <div><dt>变动前余额</dt><dd>{{ entry.balance_before }}</dd></div>
        <div><dt>变动后余额</dt><dd>{{ entry.balance_after }}</dd></div>
        <div><dt>时间</dt><dd>{{ date(entry.created_at) }}</dd></div>
        <div v-if="entry.related?.name"><dt>平台或商品</dt><dd>{{ entry.related.name }}</dd></div>
        <div v-if="entry.related?.status"><dt>处理状态</dt><dd>{{ entryStatuses[entry.related.status] || entry.related.status }}</dd></div>
      </dl>
      <button v-if="relatedPath" class="quiet" @click="go(relatedPath)">查看关联兑换记录</button>
    </section>

    <p v-if="loading" role="status" class="muted">正在加载…</p>
    <div v-if="error" class="stack">
      <p role="alert" class="error">{{ error }}</p>
      <button v-if="!edit && !working" class="quiet" @click="load">重新加载</button>
    </div>
  </div>
</template>
