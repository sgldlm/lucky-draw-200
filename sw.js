/*
 * Service Worker：离线缓存
 * - 首次打开时预缓存本站全部文件（含抽奖页与音乐）
 * - 网页本身优先联网取最新版（刷新即更新），断网时用缓存
 * - 其它文件优先用缓存秒开，同时在后台联网更新缓存（stale-while-revalidate）
 * - 外部 CDN（Tailwind、图标字体）也会缓存，断网时页面样式不丢
 * 更新网站文件后，把 CACHE_VERSION 改一个新值，用户下次打开会自动换成新版本
 */
const CACHE_VERSION = 'v15';
const CACHE_NAME = 'saidi200-' + CACHE_VERSION;

const PRECACHE = [
    './',
    'index.html',
    'manifest.json',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
    'images/trophy.svg',
    'images/gifts.svg',
    'lucky-draw/index.html',
    'lucky-draw/custom-music.js',
    'lucky-draw/round-storage.js',
    'lucky-draw/favicon.ico',
    'lucky-draw/css/app.e4465651.css',
    'lucky-draw/css/chunk-vendors.d39e9fad.css',
    'lucky-draw/js/app.d4e7f888.js',
    'lucky-draw/js/chunk-vendors.6207d9e8.js',
    'lucky-draw/img/bg1.786b8a54.jpg',
    'lucky-draw/fonts/element-icons.535877f5.woff',
    'lucky-draw/fonts/element-icons.732389de.ttf',
    'lucky-draw/media/fixed-music.mp3',
    'lucky-draw/media/bg.6fab370c.mp3',
    'lucky-draw/media/begin.2772e4d4.mp3'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// 音频播放会按区段（Range）请求；从缓存里的完整文件切出对应片段返回，断网也能播放
async function rangeFromCache(req) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req.url, { ignoreSearch: true });
    if (!cached) return fetch(req);
    const buf = await cached.arrayBuffer();
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
    const size = buf.byteLength;
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (m && !m[1] && m[2]) { start = size - parseInt(m[2], 10); end = size - 1; } // bytes=-N
    end = Math.min(end, size - 1);
    return new Response(buf.slice(start, end + 1), {
        status: 206,
        headers: {
            'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes'
        }
    });
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    if (req.headers.has('range')) {
        event.respondWith(rangeFromCache(req));
        return;
    }

    // 网页本身（index.html 等）：优先联网取最新版，刷新就能看到更新；断网时再用缓存
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
                    return res;
                })
                .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(req, { ignoreSearch: true })))
        );
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) =>
            cache.match(req, { ignoreSearch: true }).then((cached) => {
                const network = fetch(req)
                    .then((res) => {
                        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
                        return res;
                    })
                    .catch(() => cached);
                return cached || network;
            })
        )
    );
});
