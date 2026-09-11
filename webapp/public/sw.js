/**
 * 앱 껍데기만 캐시하는 최소 서비스 워커.
 * 시트 데이터는 절대 캐시하지 않는다. 오래된 잔액을 보여 주는 것이 못 보는 것보다 나쁘다.
 */
const CACHE = 'family-budget-shell-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html'])))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // 구글 API 와 인증은 항상 네트워크로 보낸다.
  if (url.origin !== self.location.origin) return
  if (event.request.method !== 'GET') return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {})
        return response
      })
      .catch(() =>
        caches.match(event.request).then((hit) => hit || caches.match('./index.html'))
      )
  )
})
