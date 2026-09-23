/*
 * 背景音乐（替代抽奖程序原有的内置音乐及其播放按钮）
 * - 固定音乐：media/fixed-music.mp3（1998韩国歌曲 哎），单曲循环，打开抽奖页即播放
 * - ♪ 按钮：单击 = 暂停 / 继续；双击 = 选择电脑里的其它音乐（可多选）
 * - 另选 1 首单曲循环；选多首按顺序循环播放
 * - 另选的音乐保存在本浏览器（IndexedDB），下次打开自动恢复；"清除音乐"回到固定音乐
 * - 抽奖开始/结束不会切换或打断歌曲
 * - 嵌在活动页里时，顶栏"抽奖结果"前面显示"返回"按钮，点击通知外层页面关闭抽奖页
 */
(function () {
    var DB_NAME = 'custom-music';
    var STORE = 'files';
    var KEY = 'playlist';

    // 场次主色（round-storage.js 设置 window.LUCKY_DRAW_ROUND）
    var ROUND = window.LUCKY_DRAW_ROUND || '200';
    var ACCENT = ROUND === '100' ? '#FF9F1C' : '#FFCC00';

    // 页面固定音乐
    var FIXED_TRACK = { name: '1998韩国歌曲 哎', url: 'media/fixed-music.mp3', fixed: true };

    var playlist = [FIXED_TRACK];   // [{ name, url, fixed? }]
    var idx = 0;
    var audio = null;
    var origLoad = HTMLMediaElement.prototype.load;
    var origPlay = HTMLMediaElement.prototype.play;
    var ui = {};
    var userPaused = false;        // 用户主动暂停后，不再自动恢复播放

    // ---------- IndexedDB 存取 ----------
    function openDB() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbRun(mode, fn) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, mode);
                var req = fn(tx.objectStore(STORE));
                tx.oncomplete = function () { resolve(req && req.result); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function saveFiles(files) {
        var items = files.map(function (f) { return { name: f.name, blob: f }; });
        return dbRun('readwrite', function (s) { return s.put(items, KEY); });
    }
    function loadFiles() { return dbRun('readonly', function (s) { return s.get(KEY); }); }
    function clearFiles() { return dbRun('readwrite', function (s) { return s.delete(KEY); }); }

    // ---------- 播放控制 ----------
    // items 为空时回到固定音乐
    function setPlaylist(items) {
        playlist.forEach(function (t) { if (!t.fixed) URL.revokeObjectURL(t.url); });
        playlist = items.length ? items.map(function (it) {
            return { name: it.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(it.blob) };
        }) : [FIXED_TRACK];
        idx = 0;
    }

    function isCustom() { return !playlist[0].fixed; }

    function applyTrack(autoplay) {
        var t = playlist[idx];
        audio.src = t.url;                    // audio 的 src 优先于内置 <source>
        audio.loop = playlist.length === 1;   // 单曲循环
        origLoad.call(audio);
        if (autoplay) audio.play().catch(function () {});
        updateUI();
    }

    function clearMusic() {
        var wasPlaying = !audio.paused;
        setPlaylist([]);
        applyTrack(wasPlaying);
    }

    function tryAutoplay() {
        if (audio.paused && !userPaused) audio.play().catch(function () {});
    }

    // ---------- 界面 ----------
    function buildUI() {
        var style = document.createElement('style');
        style.textContent =
            '#root .audio{display:none!important}' + // 隐藏内置音乐播放按钮
            '#root .copy-right{color:#000!important}' + // 右下角版权文字改成与底色一致的黑色（授权声明保留在 LICENSE 文件中）
            // MoMo 风格：点缀色统一为场次主色（200赛地专场 MoMo 黄，100赛地专场 橙色；原为蓝色/红色）
            '#root .c-Publicity .item.actiname .title,#resbox p{color:' + ACCENT + '!important}' +
            '#root header .el-button--text{color:' + ACCENT + '!important}' +
            '#tool .el-button--primary{background:' + ACCENT + '!important;border-color:' + ACCENT + '!important;color:#111!important;font-weight:700}' +
            '#cm-box{position:fixed;top:100px;right:30px;z-index:10000;display:flex;flex-direction:column;align-items:flex-end;gap:6px}' +
            '#cm-pick{width:40px;height:40px;border:1px solid ' + ACCENT + ';border-radius:50%;background:transparent;color:' + ACCENT + ';cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
            '#cm-pick:hover{background:' + ACCENT + '26}' +
            '#cm-name{max-width:180px;color:#ddd;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}' +
            '#cm-reset{color:' + ACCENT + ';font-size:12px;cursor:pointer;background:none;border:0;padding:0}' +
            '#cm-back{position:fixed;top:0;height:50px;line-height:50px;z-index:10000;background:none;border:0;padding:0;color:' + ACCENT + ';font-size:14px;cursor:pointer}' +
            '#cm-back:hover{opacity:.8}' +
            '#cm-round{position:fixed;top:0;left:20px;height:50px;line-height:50px;z-index:10000;color:' + ACCENT + ';font-size:14px;font-weight:700}';
        document.head.appendChild(style);

        // 顶栏左侧显示当前场次
        var roundLabel = document.createElement('div');
        roundLabel.id = 'cm-round';
        roundLabel.textContent = ROUND + '赛地专场';
        document.body.appendChild(roundLabel);

        var box = document.createElement('div');
        box.id = 'cm-box';
        box.innerHTML =
            '<button id="cm-pick" type="button" title="单击：暂停 / 继续　双击：选择新音乐（可多选）">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>' +
            '</button>' +
            '<div id="cm-name"></div>' +
            '<button id="cm-reset" type="button">清除音乐</button>' +
            '<input id="cm-file" type="file" accept="audio/*" multiple hidden>';
        document.body.appendChild(box);

        ui.pick = box.querySelector('#cm-pick');
        ui.name = box.querySelector('#cm-name');
        ui.reset = box.querySelector('#cm-reset');
        ui.file = box.querySelector('#cm-file');

        // 单击暂停/继续，双击选择新音乐：单击延迟执行，若在延迟内出现双击则取消单击
        var clickTimer = null;
        ui.pick.addEventListener('click', function () {
            if (clickTimer) return; // 双击的第二下
            clickTimer = setTimeout(function () {
                clickTimer = null;
                if (audio.paused) {
                    userPaused = false;
                    audio.play().catch(function () {});
                } else {
                    userPaused = true;
                    audio.pause();
                }
            }, 250);
        });
        ui.pick.addEventListener('dblclick', function () {
            clearTimeout(clickTimer);
            clickTimer = null;
            ui.file.click();
        });
        ui.file.addEventListener('change', function () {
            var files = Array.prototype.slice.call(ui.file.files);
            ui.file.value = '';
            if (!files.length) return;
            userPaused = false;
            setPlaylist(files.map(function (f) { return { name: f.name, blob: f }; }));
            applyTrack(true);
            saveFiles(files).catch(function (e) { console.warn('音乐保存失败（下次需重新选择）', e); });
        });
        ui.reset.addEventListener('click', function () {
            clearMusic();
            clearFiles().catch(function () {});
        });
        buildBackButton();
        updateUI();
    }

    // 嵌在活动页里时，在顶栏"抽奖结果"前面放"返回"按钮
    function buildBackButton() {
        if (window.parent === window) return;
        var back = document.createElement('button');
        back.id = 'cm-back';
        back.type = 'button';
        back.textContent = '← 返回';
        back.addEventListener('click', function () {
            audio.pause();   // 离开抽奖页时暂停，避免隐藏后还在后台播放
            window.parent.postMessage({ type: 'lucky-draw:back' }, '*');
        });
        // 外层页面再次打开抽奖页时通知这里，继续播放
        window.addEventListener('message', function (e) {
            if (e.source === window.parent && e.data && e.data.type === 'lucky-draw:show') tryAutoplay();
        });
        document.body.appendChild(back);

        function place() {
            var res = document.querySelector('#root header .el-button.res');
            if (!res) return;
            back.style.right = (window.innerWidth - res.getBoundingClientRect().left + 24) + 'px';
        }
        place();
        window.addEventListener('resize', place);
    }

    function updateUI() {
        if (!ui.name) return;
        ui.reset.style.display = isCustom() ? '' : 'none';
        var t = playlist[idx];
        ui.name.textContent = (audio.paused ? '⏸ 已暂停 · ' : '♪ ') + t.name +
            (playlist.length > 1 ? '（' + (idx + 1) + '/' + playlist.length + '）' : '（单曲循环）');
    }

    // ---------- 接管抽奖程序的播放器 ----------
    function init(a) {
        audio = a;
        audio.autoplay = false;
        // 忽略程序切换原内置音乐时的重新加载，避免歌曲被打断或替换
        audio.load = function () {};
        // 抽奖程序开始抽奖时会自行调用 play()；用户已暂停时不理会
        audio.play = function () {
            if (userPaused) return Promise.resolve();
            return origPlay.call(audio);
        };
        audio.addEventListener('play', updateUI);
        audio.addEventListener('pause', updateUI);
        // 多首时按顺序播放，播完回到第一首
        audio.addEventListener('ended', function () {
            if (playlist.length > 1) {
                idx = (idx + 1) % playlist.length;
                applyTrack(true);
            }
        });
        buildUI();
        applyTrack(false);   // 先装载固定音乐
        loadFiles().then(function (items) {
            if (items && items.length) {   // 之前另选过音乐则恢复
                setPlaylist(items);
                applyTrack(false);
            }
        }).catch(function () {}).then(tryAutoplay);
        // 浏览器禁止自动播放时，在页面上第一次点击后开始播放
        document.addEventListener('pointerdown', function first(e) {
            if (e.target.closest && e.target.closest('#cm-pick')) return; // ♪ 按钮自己处理
            document.removeEventListener('pointerdown', first, true);
            tryAutoplay();
        }, true);
    }

    (function waitForAudio() {
        var a = document.getElementById('audiobg');
        if (a) init(a); else setTimeout(waitForAudio, 200);
    })();
})();
