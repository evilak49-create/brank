<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { api, imageUrl } from './api'

const props = defineProps({ language: String, topic: String })
const emit = defineEmits(['follow', 'account'])
const settings = ref(null)
const messages = ref([])
const question = ref('')
const busy = ref(false)
const error = ref('')
const copied = ref('')
const handoff = ref(null)
const supportName = computed(() => settings.value?.display_name || (props.language === 'pt-BR' ? 'Atendimento CASH CLUB' : 'CASH CLUB 客服'))
const avatar = computed(() => imageUrl(settings.value?.avatar_url))
const humanChannels = computed(() => messages.value.findLast(message => message.type === 'human')?.channels ?? settings.value?.channels ?? [])
const destinations = { '/orders': '/shop/redemptions', '/withdrawals': '/red-packets', '/wallet': '/wallet' }
watch(() => props.topic, topic => {
  if (topic && !question.value.trim()) question.value = topic.slice(0, 500)
}, { immediate: true })

async function copyContact(channel) {
  try {
    await navigator.clipboard.writeText(channel.contact)
    copied.value = '已复制 ' + channel.name
  } catch {
    copied.value = '无法自动复制，请手动选择联系方式。'
  }
}

async function load() {
  error.value = ''
  try {
    settings.value = (await api('/support?' + new URLSearchParams({ language: props.language }))).data
  } catch (failure) {
    error.value = failure.message
  }
}

async function ask(text = question.value) {
  const value = text.trim()
  if (!value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const { data } = await api('/support/chat', { body: { question: value, language: props.language }, timeoutMs: 18000 })
    messages.value.push({ question: value, ...data })
    question.value = ''
    if (data.type === 'human' && !handoff.value.open) handoff.value.showModal()
  } catch (failure) {
    question.value = value
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="shortcut-panel">
    <header v-if="settings" class="support-heading">
      <img v-if="avatar" :src="avatar" width="40" height="40" alt="">
      <div>
        <strong>{{ supportName }}</strong>
        <p v-if="settings.description">{{ settings.description }}</p>
      </div>
    </header>
    <template v-if="settings?.mode === 'chat'">
      <p v-if="settings.welcome">{{ settings.welcome }}</p>
      <div v-if="!messages.length" class="chat-suggestions">
        <button v-for="item in settings.suggestions" :key="item.id" class="text-button" :disabled="busy" @click="ask(item.question)">{{ item.question }}</button>
      </div>
      <div class="chat-history" aria-live="polite">
        <article v-for="(message, index) in messages" :key="index">
          <p class="chat-question">{{ message.question }}</p>
          <p>{{ message.answer }}</p>
          <button v-if="message.help" class="text-button" @click="emit('follow', message.help.link)">{{ message.help.title }} →</button>
          <button v-if="message.type === 'personal'" class="text-button" @click="emit('account', destinations[message.link])">查看个人记录 →</button>
        </article>
      </div>
      <form class="search" @submit.prevent="ask()">
        <input v-model="question" maxlength="500" :aria-label="language === 'pt-BR' ? 'Sua pergunta' : '输入问题'">
        <button class="primary" :disabled="busy || !question.trim()">{{ language === 'pt-BR' ? 'Enviar' : '发送' }}</button>
      </form>
    </template>
    <p v-else-if="settings">{{ settings.answer }}</p>
    <button v-if="settings?.mode === 'chat' && humanChannels.length" class="quiet" @click="handoff.showModal()">联系人工客服</button>
    <ul v-if="settings && settings.mode !== 'chat' && humanChannels.length" class="channels row-list">
      <li v-for="(channel, index) in humanChannels" :key="index" class="channel-row">
        <a v-if="imageUrl(channel.url)" :href="imageUrl(channel.url)" target="_blank" rel="noopener noreferrer">{{ channel.name }}</a>
        <strong v-else>{{ channel.name }}</strong>
        <span v-if="channel.contact">{{ channel.contact }}</span>
        <button v-if="channel.contact" class="text-button" @click="copyContact(channel)">复制</button>
      </li>
    </ul>
    <p v-if="copied" role="status">{{ copied }}</p>
    <dialog ref="handoff" aria-labelledby="handoff-title">
      <div class="panel-header"><h2 id="handoff-title">联系人工客服</h2><form method="dialog"><button class="close-button" aria-label="关闭">×</button></form></div>
      <ul v-if="humanChannels.length" class="channels row-list">
        <li v-for="(channel, index) in humanChannels" :key="index" class="channel-row">
          <a v-if="imageUrl(channel.url)" :href="imageUrl(channel.url)" target="_blank" rel="noopener noreferrer">{{ channel.name }}</a>
          <strong v-else>{{ channel.name }}</strong>
          <span v-if="channel.contact">{{ channel.contact }}</span>
          <button v-if="channel.contact" class="text-button" @click="copyContact(channel)">复制</button>
        </li>
      </ul>
      <p v-else>人工客服暂不可用。</p>
      <p v-if="copied" role="status">{{ copied }}</p>
    </dialog>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <button v-if="error && !settings" class="text-button" @click="load">重试</button>
    <p v-if="(!settings && !error) || busy" role="status">正在加载…</p>
  </div>
</template>

<style scoped>
.support-heading { display: flex; align-items: center; gap: 10px; overflow-wrap: anywhere; }
.support-heading img { flex: none; border-radius: 12px; object-fit: cover; }
.support-heading p { margin: 4px 0 0; color: var(--muted); }
</style>
