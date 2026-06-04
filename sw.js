const CACHE_NAME = 'express-v3';
const urlsToCache = [
    '.',
    'index.html',
    'app.js',
    'p2p.js',
    'peerjs.min.js',
    'html5-qrcode.min.js',
    'manifest.json',
    'icons/icon-192.png',
    'icons/icon-512.png'
];

// 安装时缓存所有文件
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(urlsToCache);
        })
    );
});

// 激活时清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        })
    );
});

// 拦截请求：优先缓存，缓存没有才联网
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            // 有缓存直接返回
            if (cachedResponse) return cachedResponse;
            
            // 没缓存就联网获取
            return fetch(event.request).then(response => {
                // 只缓存成功的 GET 请求
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            });
        }).catch(() => {
            // 完全离线时返回空
            return new Response('离线模式');
        })
    );
});
