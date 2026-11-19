export async function api(path, { body, signal, timeoutMs = 10000, method = body === undefined ? 'GET' : 'POST' } = {}) {
  const multipart = body instanceof FormData
  const headers = { Accept: 'application/json' }
  if (method !== 'GET') {
    try {
      await api('/auth/csrf-cookie', { signal })
    } catch (error) {
      if (error.status !== 404 && error.status !== 405) throw error
      await api('/health', { signal })
    }
    const token = document.cookie.split('; ').find(cookie => cookie.startsWith('XSRF-TOKEN='))
    if (!token) throw new Error('无法初始化会话，请刷新后重试。')
    headers['X-XSRF-TOKEN'] = decodeURIComponent(token.slice('XSRF-TOKEN='.length))
    if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json'
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const response = await fetch('/api/v1' + path, {
    method,
    credentials: 'same-origin',
    headers,
    body: multipart ? body : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  })
  if (response.status === 204) return null

  const json = response.headers.get('content-type')?.includes('application/json')
  const result = json ? await response.json() : null
  if (!response.ok || !json) {
    if (response.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new Event('cash-club-session-expired'))
    }
    throw Object.assign(new Error(result?.message || '服务暂不可用，请稍后重试。'), {
      status: response.status,
      code: result?.code,
      errors: result?.errors,
      data: result?.data,
    })
  }
  return result
}

export function imageUrl(value) {
  if (!value) return ''
  try {
    const url = new URL(value, 'https://ht.1234.fund')
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}
