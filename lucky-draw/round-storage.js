/*
 * 场次数据隔离（需在抽奖程序之前加载）
 * 抽奖程序把配置/结果/名单存在固定的 localStorage 键里（config、result、newLottery、list），
 * 各专场会互相覆盖。这里按地址参数 ?round=100 / ?round=50 给键名加前缀：
 * - 200赛地专场（无参数）：沿用原键名，已有数据不受影响
 * - 100赛地专场：使用 r100:config 等独立键名
 * - 50赛地专场：使用 r50:config 等独立键名；抽奖总人数默认 100（只有100个名额）
 * 同时把"重置全部数据"用到的 localStorage.clear() 改成只清本场次的键，
 * 避免误删另一个场次和选号页的数据。
 */
(function () {
    var round = new URLSearchParams(location.search).get('round') || '200';
    var PREFIX = round === '200' ? '' : 'r' + round + ':';
    var KEYS = ['config', 'result', 'newLottery', 'list'];

    var proto = Storage.prototype;
    var getItem = proto.getItem;
    var setItem = proto.setItem;
    var removeItem = proto.removeItem;

    function key(k) { return KEYS.indexOf(k) >= 0 ? PREFIX + k : k; }

    proto.getItem = function (k) { return getItem.call(this, key(k)); };
    proto.setItem = function (k, v) { return setItem.call(this, key(k), v); };
    proto.removeItem = function (k) { return removeItem.call(this, key(k)); };
    proto.clear = function () {
        var self = this;
        KEYS.forEach(function (k) { removeItem.call(self, PREFIX + k); });
    };

    // 各专场的抽奖总人数（号码范围 1～N）；未列出的按抽奖程序默认 500
    var NUMBER_BY_ROUND = { '50': 100 };
    var number = NUMBER_BY_ROUND[round];
    if (number) {
        // 首次打开时写入默认配置，抽奖程序启动时会读取它
        if (!getItem.call(localStorage, PREFIX + 'config')) {
            setItem.call(localStorage, PREFIX + 'config', JSON.stringify({ name: '幸运抽大奖', number: number, firstPrize: 1 }));
        }
    }

    window.LUCKY_DRAW_ROUND = round;
    window.LUCKY_DRAW_NUMBER = number || null;
})();
