/*
 * 访问密码锁（主页面和抽奖页共用）
 * - 当前密码只以“加盐哈希”的形式保存在 GitHub 仓库的 auth.json 里，所有电脑共用这一份
 * - 每台设备打开时、切回窗口时、以及每 90 秒都会去 GitHub 核对一次；
 *   密码一旦在控制端被修改，其他设备会立刻（最多约 1~2 分钟）重新锁定，旧密码失效
 * - 断网时使用最后一次核对到的密码
 */
(function () {
    'use strict';
    var REPO = 'sgldlm/lucky-draw-200';
    var BRANCH = 'main';
    var FILE = 'auth.json';
    var DEFAULT = { salt: 'saidi200-init', hash: 'f3313ac198de41c5d6e5a65d9c3957ae183578bf793c6eebf46f233224a5fe68' };
    var K_KNOWN = 'saidi_auth_known';   // 最近一次核对到的密码哈希 {salt,hash}
    var K_OK = 'saidi_auth_ok';         // 本设备已解锁时对应的哈希
    var K_TOKEN = 'saidi_gh_token';     // 控制端的 GitHub 令牌（只存在本设备）
    var CHECK_MS = 90000;

    var scriptSrc = (document.currentScript && document.currentScript.src) || location.href;
    var LOCAL_URL = new URL(FILE, scriptSrc).href;

    function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    function known() { try { var o = JSON.parse(get(K_KNOWN)); if (o && o.salt && o.hash) return o; } catch (e) {} return DEFAULT; }

    /* ---------- SHA-256（浏览器自带的优先，否则用下面的纯 JS 版本） ---------- */
    function sha256js(str) {
        var bytes = unescape(encodeURIComponent(str)), i, j;
        var K = [], H = [], primes = 0, n = 2;
        function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
        while (primes < 64) { var p = true; for (j = 2; j * j <= n; j++) if (n % j === 0) { p = false; break; }
            if (p) { if (primes < 8) H[primes] = frac(Math.pow(n, 1 / 2)); K[primes] = frac(Math.pow(n, 1 / 3)); primes++; } n++; }
        var l = bytes.length, words = [];
        for (i = 0; i < l; i++) words[i >> 2] |= bytes.charCodeAt(i) << (24 - (i % 4) * 8);
        words[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
        words[(((l + 8) >> 6) << 4) + 15] = l * 8;
        function rr(x, c) { return (x >>> c) | (x << (32 - c)); }
        for (i = 0; i < words.length; i += 16) {
            var w = [], a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
            for (j = 0; j < 64; j++) {
                if (j < 16) w[j] = words[i + j] | 0;
                else { var s0 = rr(w[j - 15], 7) ^ rr(w[j - 15], 18) ^ (w[j - 15] >>> 3), s1 = rr(w[j - 2], 17) ^ rr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
                    w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0; }
                var t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
                var t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
            H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        }
        return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
    }
    function sha256(str) {
        if (window.crypto && crypto.subtle && window.TextEncoder) {
            return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
                return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
            }).catch(function () { return sha256js(str); });
        }
        return Promise.resolve(sha256js(str));
    }
    function hashOf(salt, pw) { return sha256(salt + ':' + pw); }

    /* ---------- 读取当前密码（GitHub API → 本站文件 → 本地缓存） ---------- */
    function b64decode(s) { return decodeURIComponent(escape(atob(s.replace(/\s/g, '')))); }
    function b64encode(s) { return btoa(unescape(encodeURIComponent(s))); }
    function apiHeaders(token) {
        var h = { 'Accept': 'application/vnd.github+json' };
        if (token) h.Authorization = 'Bearer ' + token;
        return h;
    }
    function fetchApi(token) {
        return fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE + '?ref=' + BRANCH + '&t=' + Date.now(),
            { cache: 'no-store', headers: apiHeaders(token) })
            .then(function (r) { if (r.status === 404) return { missing: true }; if (!r.ok) throw new Error('api ' + r.status); return r.json(); });
    }
    function remote() {
        return fetchApi(get(K_TOKEN))
            .then(function (j) { if (j.missing) return DEFAULT; return JSON.parse(b64decode(j.content)); })
            .catch(function () {
                return fetch(LOCAL_URL + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
                    if (!r.ok) throw new Error('local ' + r.status); return r.json();
                });
            })
            .then(function (o) { if (o && o.salt && o.hash) { set(K_KNOWN, JSON.stringify({ salt: o.salt, hash: o.hash })); return o; } throw new Error('bad'); });
    }

    /* ---------- 界面 ---------- */
    var css = '' +
        'html.saidi-locked body>*:not(#saidiGate){visibility:hidden!important}' +
        '#saidiGate,#saidiPwd{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(15,15,15,.92);font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif}' +
        '#saidiPwd{background:rgba(0,0,0,.6)}' +
        '.saidi-box{background:#fff;color:#111;border-radius:18px;padding:28px 26px;width:min(92vw,360px);box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center}' +
        '.saidi-box h2{margin:0 0 6px;font-size:20px;font-weight:800}' +
        '.saidi-box p{margin:0 0 16px;font-size:13px;color:#666}' +
        '.saidi-box input{display:block;width:100%;box-sizing:border-box;margin:0 0 10px;padding:11px 12px;border:1.5px solid #ddd;border-radius:10px;font-size:15px;outline:none}' +
        '.saidi-box input:focus{border-color:#FFCC00}' +
        '.saidi-box button{width:100%;padding:11px;border:0;border-radius:999px;background:#FFCC00;color:#111;font-size:15px;font-weight:700;cursor:pointer}' +
        '.saidi-box button.ghost{background:#eee;margin-top:8px}' +
        '.saidi-err{min-height:18px;margin:4px 0 8px;font-size:13px;color:#d33}' +
        '.saidi-ok{color:#18a058}' +
        '.saidi-box label{display:block;text-align:left;font-size:12px;color:#888;margin:2px 0 4px}' +
        '.saidi-box a{color:#0a66c2}';
    function addStyle() {
        if (document.getElementById('saidiGateCss')) return;
        var s = document.createElement('style'); s.id = 'saidiGateCss'; s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
    }
    function whenBody(fn) { if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn); }

    var gate = null;
    function lock() {
        addStyle();
        document.documentElement.classList.add('saidi-locked');
        whenBody(function () {
            if (gate) return;
            gate = document.createElement('div'); gate.id = 'saidiGate';
            gate.innerHTML = '<form class="saidi-box" autocomplete="off">' +
                '<h2>🔒 请输入访问密码</h2><p>Enter password to continue</p>' +
                '<input type="password" id="saidiGateInput" placeholder="密码 / Password" autocomplete="current-password">' +
                '<div class="saidi-err" id="saidiGateErr"></div>' +
                '<button type="submit">进入 / Enter</button></form>';
            document.body.appendChild(gate);
            var input = gate.querySelector('input'), err = gate.querySelector('#saidiGateErr');
            setTimeout(function () { input.focus(); }, 50);
            gate.querySelector('form').addEventListener('submit', function (ev) {
                ev.preventDefault();
                var pw = input.value; err.textContent = '';
                // 先联网核对最新密码，断网则用最后一次核对到的
                remote().catch(function () { return known(); }).then(function (cur) {
                    return hashOf(cur.salt, pw).then(function (h) {
                        if (h === cur.hash) { set(K_OK, h); unlock(); }
                        else { err.textContent = '密码错误 / Wrong password'; input.select(); }
                    });
                });
            });
        });
    }
    function unlock() {
        document.documentElement.classList.remove('saidi-locked');
        if (gate) { gate.remove(); gate = null; }
    }
    function isUnlocked() { return get(K_OK) === known().hash; }

    var lastCheck = 0;
    function check() {
        lastCheck = Date.now();
        return remote().then(function (cur) {
            if (get(K_OK) !== cur.hash) lock();
        }).catch(function () { /* 断网：保持现状 */ });
    }

    // 初始状态
    addStyle();
    if (!isUnlocked()) lock();
    check();
    setInterval(function () { if (!document.hidden) check(); }, CHECK_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden && Date.now() - lastCheck > 15000) check(); });
    window.addEventListener('focus', function () { if (Date.now() - lastCheck > 15000) check(); });
    // 同一台设备上其他窗口（例如抽奖页）改了状态，这里也同步
    window.addEventListener('storage', function (e) { if (e.key === K_OK || e.key === K_KNOWN) { if (isUnlocked()) unlock(); else lock(); } });

    /* ---------- 控制端：修改密码 ---------- */
    function openChange() {
        addStyle();
        if (document.getElementById('saidiPwd')) return;
        var box = document.createElement('div'); box.id = 'saidiPwd';
        var hasToken = !!get(K_TOKEN);
        box.innerHTML = '<form class="saidi-box" autocomplete="off">' +
            '<h2>修改访问密码</h2><p>修改后所有电脑上的旧密码立即失效</p>' +
            '<input type="password" id="spOld" placeholder="当前密码" autocomplete="current-password">' +
            '<input type="password" id="spNew" placeholder="新密码（至少 6 位）" autocomplete="new-password">' +
            '<input type="password" id="spNew2" placeholder="再次输入新密码" autocomplete="new-password">' +
            '<label>GitHub 令牌（只需在这台控制电脑上填一次）</label>' +
            '<input type="password" id="spTok" placeholder="' + (hasToken ? '已保存，留空即可' : 'github_pat_…') + '">' +
            '<div class="saidi-err" id="spErr"></div>' +
            '<button type="submit" id="spGo">确认修改</button>' +
            '<button type="button" class="ghost" id="spCancel">取消</button></form>';
        document.body.appendChild(box);
        var $ = function (id) { return box.querySelector('#' + id); };
        var err = $('spErr');
        $('spCancel').onclick = function () { box.remove(); };
        $('spOld').focus();
        box.querySelector('form').addEventListener('submit', function (ev) {
            ev.preventDefault();
            err.className = 'saidi-err'; err.textContent = '';
            var oldPw = $('spOld').value, n1 = $('spNew').value, n2 = $('spNew2').value;
            var token = $('spTok').value.trim() || get(K_TOKEN);
            if (n1.length < 6) { err.textContent = '新密码至少 6 位'; return; }
            if (n1 !== n2) { err.textContent = '两次输入的新密码不一致'; return; }
            if (!token) { err.textContent = '请填写 GitHub 令牌'; return; }
            $('spGo').disabled = true; $('spGo').textContent = '正在修改…';
            var cur, sha, newRec;
            fetchApi(token).then(function (j) {
                if (j.missing) { cur = DEFAULT; sha = null; }
                else { cur = JSON.parse(b64decode(j.content)); sha = j.sha; }
                return hashOf(cur.salt, oldPw);
            }).then(function (h) {
                if (h !== cur.hash) throw new Error('当前密码不正确');
                var rnd = new Uint8Array(12); crypto.getRandomValues(rnd);
                var salt = Array.prototype.map.call(rnd, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
                return hashOf(salt, n1).then(function (nh) { newRec = { salt: salt, hash: nh }; });
            }).then(function () {
                var body = { message: 'Change access password', branch: BRANCH,
                    content: b64encode(JSON.stringify(newRec, null, 2) + '\n') };
                if (sha) body.sha = sha;
                return fetch('https://api.github.com/repos/' + REPO + '/contents/' + FILE, {
                    method: 'PUT', headers: apiHeaders(token), body: JSON.stringify(body)
                });
            }).then(function (r) {
                if (r.status === 401) throw new Error('GitHub 令牌无效或已过期');
                if (r.status === 403 || r.status === 404) throw new Error('令牌没有修改此仓库的权限');
                if (!r.ok) throw new Error('GitHub 返回错误 ' + r.status);
                set(K_TOKEN, token);
                set(K_KNOWN, JSON.stringify(newRec));
                set(K_OK, newRec.hash);
                err.className = 'saidi-err saidi-ok';
                err.textContent = '✓ 已修改，其他设备的旧密码已失效';
                $('spGo').textContent = '完成';
                setTimeout(function () { box.remove(); }, 1500);
            }).catch(function (e) {
                err.textContent = (e && e.message) || '修改失败，请检查网络';
                if (/Failed to fetch|NetworkError/i.test(err.textContent)) err.textContent = '网络连接失败，请联网后再试';
                $('spGo').disabled = false; $('spGo').textContent = '确认修改';
            });
        });
    }

    window.SaidiAuth = { openChange: openChange, check: check };
})();
