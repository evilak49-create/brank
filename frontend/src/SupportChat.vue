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
const labels = computed(() => props.language === 'pt-BR' ? {
  records: 'Ver meus registros', contact: 'Atendimento humano', close: 'Fechar', copy: 'Copiar',
  copied: 'Contato copiado.', copyFailed: 'Não foi possível copiar. Selecione e copie o contato manualmente.',
  unavailable: 'O atendimento está indisponível no momento. Tente novamente.',
  noHuman: 'O atendimento humano está indisponível.', retry: 'Tentar novamente', loading: 'Carregando…',
} : {
  records: '查看个人记录', contact: '联系人工客服', close: '关闭', copy: '复制',
  copied: '已复制联系方式。', copyFailed: '无法自动复制，请手动选择联系方式。',
  unavailable: '客服暂不可用，请稍后重试。',
  noHuman: '人工客服暂不可用。', retry: '重试', loading: '正在加载…',
})
const supportName = computed(() => settings.value?.display_name || (props.language === 'pt-BR' ? 'Atendimento CASH CLUB' : 'CASH CLUB 客服'))
const avatar = computed(() => imageUrl(settings.value?.avatar_url))
const humanChannels = computed(() => messages.value.findLast(message => message.type === 'human')?.channels ?? settings.value?.channels ?? [])
const destinations = { '/orders': '/shop/redemptions', '/withdrawals': '/withdrawal-history', '/wallet': '/wallet' }
watch(() => props.topic, topic => {
  if (topic && !question.value.trim()) question.value = topic.slice(0, 500)
}, { immediate: true })

async function copyContact(channel) {
  try {
    await navigator.clipboard.writeText(channel.contact)
    copied.value = labels.value.copied
  } catch {
    copied.value = labels.value.copyFailed
  }
}

async function load() {
  error.value = ''
  try {
    settings.value = (await api('/support?' + new URLSearchParams({ language: props.language }))).data
  } catch (failure) {
    error.value = props.language === 'pt-BR' ? labels.value.unavailable : failure.message
  }
}

async function ask(text = question.value) {
  const value = text.trim()
  if (!value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const history = messages.value.filter(turn => turn.answer?.trim()).slice(-6).map(turn => ({
      question: turn.question,
      answer: Array.from(turn.answer).slice(0, 1400).join(''),
    }))
    const { data } = await api('/support/chat', {
      body: { question: value, language: props.language, history }, timeoutMs: 18000,
    })
    messages.value.push({ question: value, ...data })
    question.value = ''
    if (data.type === 'human' && !handoff.value.open) handoff.value.showModal()
  } catch (failure) {
    question.value = value
    error.value = props.language === 'pt-BR' ? labels.value.unavailable : failure.message
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
          <button v-if="message.type === 'personal'" class="text-button" @click="emit('account', destinations[message.link])">{{ labels.records }} →</button>
        </article>
      </div>
      <form class="search" @submit.prevent="ask()">
        <input v-model="question" maxlength="500" :aria-label="language === 'pt-BR' ? 'Sua pergunta' : '输入问题'">
        <button class="primary" :disabled="busy || !question.trim()">{{ language === 'pt-BR' ? 'Enviar' : '发送' }}</button>
      </form>
    </template>
    <p v-else-if="settings">{{ settings.answer }}</p>
    <button v-if="settings?.mode === 'chat' && humanChannels.length" class="quiet" @click="handoff.showModal()">{{ labels.contact }}</button>
    <ul v-if="settings && settings.mode !== 'chat' && humanChannels.length" class="channels row-list">
      <li v-for="(channel, index) in humanChannels" :key="index" class="channel-row">
        <a v-if="imageUrl(channel.url)" :href="imageUrl(channel.url)" target="_blank" rel="noopener noreferrer">{{ channel.name }}</a>
        <strong v-else>{{ channel.name }}</strong>
        <span v-if="channel.contact">{{ channel.contact }}</span>
        <button v-if="channel.contact" class="text-button" @click="copyContact(channel)">{{ labels.copy }}</button>
      </li>
    </ul>
    <p v-if="copied" role="status">{{ copied }}</p>
    <dialog ref="handoff" aria-labelledby="handoff-title">
      <div class="panel-header"><h2 id="handoff-title">{{ labels.contact }}</h2><form method="dialog"><button class="close-button" :aria-label="labels.close">×</button></form></div>
      <ul v-if="humanChannels.length" class="channels row-list">
        <li v-for="(channel, index) in humanChannels" :key="index" class="channel-row">
          <a v-if="imageUrl(channel.url)" :href="imageUrl(channel.url)" target="_blank" rel="noopener noreferrer">{{ channel.name }}</a>
          <strong v-else>{{ channel.name }}</strong>
          <span v-if="channel.contact">{{ channel.contact }}</span>
          <button v-if="channel.contact" class="text-button" @click="copyContact(channel)">{{ labels.copy }}</button>
        </li>
      </ul>
      <p v-else>{{ labels.noHuman }}</p>
      <p v-if="copied" role="status">{{ copied }}</p>
    </dialog>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <button v-if="error && !settings" class="text-button" @click="load">{{ labels.retry }}</button>
    <p v-if="(!settings && !error) || busy" role="status">{{ labels.loading }}</p>
  </div>
</template>

<style scoped>
.support-heading { display: flex; align-items: center; gap: 10px; overflow-wrap: anywhere; }
.support-heading img { flex: none; border-radius: 12px; object-fit: cover; }
.support-heading p { margin: 4px 0 0; color: var(--muted); }
</style>
