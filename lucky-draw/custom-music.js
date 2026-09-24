/*
 * 背景音乐（替代抽奖程序原有的内置音乐及其播放按钮）
 * - 固定音乐：media/fixed-music.mp3（1998韩国歌曲 哎），单曲循环，打开抽奖页即播放
 * - ♪ 按钮：单击 = 暂停 / 继续；双击 = 选择电脑里的其它音乐（可多选）
 * - 另选 1 首单曲循环；选多首按顺序循环播放
 * - 另选的音乐保存在本浏览器（IndexedDB），下次打开自动恢复；"清除音乐"回到固定音乐
 * - 抽奖开始/结束不会切换或打断歌曲
 * - 嵌在活动页里时，顶栏"抽奖结果"前面显示"返回"按钮，点击通知外层页面关闭抽奖页
 * - 嵌在活动页里时会被提前在后台加载：收到外层"显示"通知前不放音乐、3D球暂停
 */
(function () {
    var DB_NAME = 'custom-music';
    var STORE = 'files';
    var KEY = 'playlist';

    // 场次主色（round-storage.js 设置 window.LUCKY_DRAW_ROUND）
    var ROUND = window.LUCKY_DRAW_ROUND || '200';
    var ACCENT = ROUND === '100' ? '#FF9F1C' : ROUND === '50' ? '#2BE07A' : '#FFCC00';

    // 页面固定音乐
    var FIXED_TRACK = { name: '1998韩国歌曲 哎', nameEn: '1998 Korean Song "Ae"', url: 'media/fixed-music.mp3', fixed: true };

    var playlist = [FIXED_TRACK];   // [{ name, url, fixed? }]
    var idx = 0;
    var audio = null;
    var origLoad = HTMLMediaElement.prototype.load;
    var origPlay = HTMLMediaElement.prototype.play;
    var ui = {};
    var placeBack = null;         // 重新计算"返回"按钮位置（文字长度变化时调用）
    var userPaused = false;        // 用户主动暂停后，不再自动恢复播放
    // 嵌在活动页里时，页面会被提前在后台加载；外层通知"显示"之前保持静音、3D球暂停
    var embedded = window.parent !== window;
    var shown = !embedded;

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
        if (shown && audio.paused && !userPaused) audio.play().catch(function () {});
    }

    // ---------- 显示 / 隐藏（外层活动页通过 postMessage 通知） ----------
    function pauseSphere(pause) {
        if (!window.TagCanvas) return;
        try { window.TagCanvas[pause ? 'Pause' : 'Resume']('rootcanvas'); } catch (e) {}
    }

    function setShown(value) {
        shown = value;
        if (shown) {
            pauseSphere(false);
            tryAutoplay();
        } else {
            pauseSphere(true);
            audio.pause();
        }
    }

    // ---------- 中英文（外层活动页一键切换，通过 postMessage 同步） ----------
    var LANG = 'zh';
    try { if (localStorage.getItem('shopwin_lang') === 'en') LANG = 'en'; } catch (e) {}

    var UI = {
        zh: { back: '← 返回', clear: '清除音乐', paused: '⏸ 已暂停 · ', loop: '（单曲循环）', round: '赛地专场',
              pick: '单击：暂停 / 继续　双击：选择新音乐（可多选）' },
        en: { back: '← Back', clear: 'Clear music', paused: '⏸ Paused · ', loop: ' (loop)', round: ' Cedis Special',
              pick: 'Click: pause / play · Double-click: choose new music (multiple allowed)' }
    };
    function ui_(k) { return UI[LANG][k]; }

    // 抽奖程序界面文字（整句匹配的短词）
    var EXACT_EN = {
        '共': 'Total', '名': '', '剩余': 'Remaining', '开始': 'Start', '停止': 'Stop', '重置': 'Reset',
        '保存': 'Save', '取消': 'Cancel', '确定': 'OK', '提示': 'Notice', '警告': 'Warning',
        '请选择': 'Select', '清空': 'Clear', '删除': 'Delete', '全部': 'All', '返回': 'Back'
    };
    // 抽奖程序界面文字（包含即替换的短语，长的优先）
    var PHRASE_EN = [
        ['请输入对应的号码和名单(可直接从excel复制)，格式(号码 名字)，导入的名单将代替号码显示在抽奖中。如：',
         'Enter numbers and names (you can paste from Excel), one per line as "number name". Imported names are shown instead of numbers in the draw. Example:'],
        ['张三', 'Kwame'], ['李四', 'Ama'], ['王五', 'Kofi'],
        ['支持jpg和png，照片大小不能超过150kb,建议20-50kb，建议尺寸为160*160px', 'JPG/PNG only, max 150KB (20–50KB recommended), 160×160px'],
        ['(开启后将在全体成员[无论有无中奖]中抽奖)', '(draw from everyone, including previous winners)'],
        ['本次抽奖人数已超过本奖项的剩余人数', 'Exceeds the remaining winners for this prize'],
        ['此操作将移除该中奖号码，确认删除?', 'Remove this winning number?'],
        ['此操作将重置所选数据，是否继续?', 'This will reset the selected data. Continue?'],
        ['不允许上传大于150KB的图片', 'Images over 150KB are not allowed'],
        ['请选择本次抽取的奖项', 'Please choose a prize'],
        ['请选取本次抽取的奖项', 'Choose a prize'],
        ['请选取本次抽取方式', 'Choose a mode'],
        ['该奖项剩余人数不足', 'No winners left for this prize'],
        ['必须输入本次抽取人数', 'Enter the number of winners'],
        ['号码必须大于0的整数', 'Number must be a positive integer'],
        ['你的浏览器不支持audio标签', ''],
        ['(点击号码可以删除)', '(click a number to remove it)'],
        ['重置全部数据', 'Reset all data'],
        ['重置抽奖配置', 'Reset settings'],
        ['重置抽奖结果', 'Reset results'],
        ['重置名单', 'Reset list'],
        ['重置照片', 'Reset photos'],
        ['重置选项', 'Reset options'],
        ['确定重置', 'Confirm reset'],
        ['重置成功!', 'Reset done!'],
        ['删除成功!', 'Removed!'],
        ['幸运抽大奖', 'Lucky Grand Draw'],
        ['抽奖结果：', ' Results: '],
        ['抽奖结果:', ' Results: '],
        ['抽奖结果', 'Results'],
        ['抽奖配置', 'Settings'],
        ['保存配置', 'Save'],
        ['保存成功', 'Saved'],
        ['保存失败', 'Save failed'],
        ['导入名单', 'Import List'],
        ['导入照片', 'Import Photos'],
        ['立即抽奖', 'Draw Now'],
        ['增加奖项', 'Add Prize'],
        ['奖项名称', 'Prize name'],
        ['抽奖标题', 'Title'],
        ['抽奖总人数', 'Total entries'],
        ['抽奖号码', 'Number'],
        ['抽取奖项', 'Prize'],
        ['抽取方式', 'Mode'],
        ['抽取人数', 'Winners'],
        ['全员参与', 'Everyone'],
        ['一次抽取完', 'All at once'],
        ['自定义', 'Custom'],
        ['抽1人', '1 winner'],
        ['抽5人', '5 winners'],
        ['一等奖', 'First Prize'],
        ['暂未抽取', 'Not drawn yet'],
        ['暂未抽奖', 'Not drawn yet'],
        ['没有数据', 'No data'],
        ['已取消', 'Cancelled'],
        ['照片选择', 'Photo'],
        ['点击选择照片', 'Click to choose a photo'],
        ['已选照片', 'Selected'],
        ['暂未选择', 'None'],
        ['请选择照片', 'Please choose a photo'],
        // 下拉框组件自带提示
        ['无匹配数据', 'No match'],
        ['暂无数据', 'No data'],
        ['无数据', 'No data'],
        ['加载中', 'Loading'],
        ['请输入搜索内容', 'Search'],
        // 常见奖品名（只影响英文显示，不改动"抽奖配置"里保存的名称）
        ['特等奖', 'Grand Prize'],
        ['二等奖', 'Second Prize'],
        ['三等奖', 'Third Prize'],
        ['四等奖', 'Fourth Prize'],
        ['五等奖', 'Fifth Prize'],
        ['幸运奖', 'Lucky Prize'],
        ['参与奖', 'Participation Prize'],
        ['摩托车', 'Motorcycle'],
        ['电动车', 'E-bike'],
        ['自行车', 'Bicycle'],
        ['手机', 'Smartphone'],
        ['电视机', 'TV'],
        ['电视', 'TV'],
        ['冰箱', 'Refrigerator'],
        ['洗衣机', 'Washing Machine'],
        ['空调', 'Air Conditioner'],
        ['笔记本电脑', 'Laptop'],
        ['电脑', 'Computer'],
        ['平板', 'Tablet'],
        ['耳机', 'Headphones'],
        ['音响', 'Speaker'],
        ['现金', 'Cash'],
        ['红包', 'Cash Gift'],
        ['大奖', 'Grand Prize'],
        ['奖品', 'Prize'],
        // 中文标点 → 英文标点（放在最后）
        ['、', ', '], ['，', ', '], ['：', ': '], ['；', '; '], ['（', ' ('], ['）', ')'],
        ['！', '!'], ['？', '?'], ['。', '. ']
    ];

    function translateText(s) {
        var t = s.trim();
        if (!t || !/[一-鿿　-〿＀-￯]/.test(t)) return s; // 含中文字或中文标点才处理
        if (Object.prototype.hasOwnProperty.call(EXACT_EN, t)) return s.replace(t, EXACT_EN[t]);
        var out = s;
        for (var i = 0; i < PHRASE_EN.length; i++) {
            if (out.indexOf(PHRASE_EN[i][0]) >= 0) out = out.split(PHRASE_EN[i][0]).join(PHRASE_EN[i][1]);
        }
        return out;
    }
    function translateTree(root) {
        if (LANG !== 'en' || !root) return;
        if (root.nodeType === 3) {
            if (root.parentNode && root.parentNode.closest && root.parentNode.closest('#cm-box, script, style')) return;
            var v = translateText(root.nodeValue);
            if (v !== root.nodeValue) root.nodeValue = v;
            return;
        }
        if (root.nodeType !== 1) return;
        if (root.closest && root.closest('#cm-box, script, style')) return;
        if (root.placeholder) { var p = translateText(root.placeholder); if (p !== root.placeholder) root.placeholder = p; }
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
        var n;
        while ((n = walker.nextNode())) {
            if (n.nodeType === 1) {
                if (n.placeholder) { var q = translateText(n.placeholder); if (q !== n.placeholder) n.placeholder = q; }
                continue;
            }
            translateTree(n);
        }
    }
    // 下拉框（只读输入框）里显示的选项文字，如"一等奖""一次抽取完"：它们放在输入框的值里，需要单独翻译。
    // 只处理只读输入框，可输入的框（抽奖标题、奖项名称等）保持原值，避免改动保存的数据。
    function translateInputs() {
        if (LANG !== 'en') return;
        var inputs = document.querySelectorAll('input[readonly]');
        for (var i = 0; i < inputs.length; i++) {
            var v = translateText(inputs[i].value);
            if (v !== inputs[i].value) inputs[i].value = v;
        }
    }

    var langObserver = null;
    function startTranslating() {
        translateTree(document.body);
        translateInputs();
        document.title = translateText(document.title);
        if (langObserver) return;
        // 下拉框的值由程序直接写入，页面结构不变，定时检查一次
        setInterval(translateInputs, 250);
        document.addEventListener('click', function () { setTimeout(translateInputs, 0); }, true);
        langObserver = new MutationObserver(function (list) {
            list.forEach(function (m) {
                if (m.type === 'characterData') translateTree(m.target);
                else m.addedNodes.forEach(translateTree);
            });
            if (placeBack) placeBack(); // 顶栏按钮文字变长后，"返回"按钮位置跟着调整
        });
        langObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
        setTimeout(function () { if (placeBack) placeBack(); }, 300);
    }
    function applyCustomUIText() {
        var back = document.getElementById('cm-back');
        if (back) back.textContent = ui_('back');
        var round = document.getElementById('cm-round');
        if (round) round.textContent = ROUND + ui_('round');
        if (ui.reset) ui.reset.textContent = ui_('clear');
        if (ui.pick) ui.pick.title = ui_('pick');
        updateUI();
        if (placeBack) placeBack();
    }
    function setLang(l) {
        if (l !== 'en' && l !== 'zh') return;
        if (l === LANG) return;
        if (LANG === 'en' && l === 'zh') { location.reload(); return; } // 英文切回中文：重新加载恢复原文
        LANG = l;
        applyCustomUIText();
        startTranslating();
    }

    function listenParent() {
        if (!embedded) return;
        window.addEventListener('message', function (e) {
            if (e.source !== window.parent || !e.data) return;
            if (e.data.type === 'lucky-draw:lang') setLang(e.data.lang);
            if (e.data.type === 'lucky-draw:show') setShown(true);
            if (e.data.type === 'lucky-draw:hide') setShown(false);
        });
        // 隐藏期间保持 3D 球暂停（抽奖程序在窗口尺寸变化时会重建 3D 球）
        setInterval(function () { if (!shown) pauseSphere(true); }, 500);
        pauseSphere(true);
        // 告诉外层已加载完成，外层回复当前应显示还是隐藏
        window.parent.postMessage({ type: 'lucky-draw:ready' }, '*');
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
        roundLabel.textContent = ROUND + ui_('round');
        document.body.appendChild(roundLabel);

        var box = document.createElement('div');
        box.id = 'cm-box';
        box.innerHTML =
            '<button id="cm-pick" type="button" title="' + ui_('pick') + '">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>' +
            '</button>' +
            '<div id="cm-name"></div>' +
            '<button id="cm-reset" type="button">' + ui_('clear') + '</button>' +
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
        back.textContent = ui_('back');
        back.addEventListener('click', function () {
            setShown(false);   // 离开抽奖页时暂停音乐和3D球，避免隐藏后还在后台运行
            window.parent.postMessage({ type: 'lucky-draw:back' }, '*');
        });
        document.body.appendChild(back);

        placeBack = function () {
            var res = document.querySelector('#root header .el-button.res');
            if (!res) return;
            back.style.right = (window.innerWidth - res.getBoundingClientRect().left + 24) + 'px';
        };
        placeBack();
        window.addEventListener('resize', placeBack);
    }

    function updateUI() {
        if (!ui.name) return;
        ui.reset.style.display = isCustom() ? '' : 'none';
        var t = playlist[idx];
        var trackName = (LANG === 'en' && t.nameEn) ? t.nameEn : t.name;
        ui.name.textContent = (audio.paused ? ui_('paused') : '♪ ') + trackName +
            (playlist.length > 1 ? ' (' + (idx + 1) + '/' + playlist.length + ')' : ui_('loop'));
    }

    // ---------- 接管抽奖程序的播放器 ----------
    // 各专场名额少于500（50、100赛地专场100个，200赛地专场200个）：抽奖程序"重置抽奖配置 / 重置全部数据"会把抽奖总人数恢复成默认500，这里改回本专场名额
    function keepRoundNumber() {
        var number = window.LUCKY_DRAW_NUMBER;
        var root = document.getElementById('root');
        var store = number && root && root.__vue__ && root.__vue__.$store;
        if (!store) return;
        if (store.state.config.number === 500) store.state.config.number = number;
        store.subscribe(function (mutation, state) {
            if (mutation.type === 'setClearConfig' || mutation.type === 'setClearStore') {
                state.config.number = number;
            }
        });
    }

    function init(a) {
        audio = a;
        audio.autoplay = false;
        // 忽略程序切换原内置音乐时的重新加载，避免歌曲被打断或替换
        audio.load = function () {};
        // 抽奖程序开始抽奖时会自行调用 play()；用户已暂停时不理会
        audio.play = function () {
            if (userPaused || !shown) return Promise.resolve();
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
        keepRoundNumber();
        if (LANG === 'en') startTranslating();
        listenParent();
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
