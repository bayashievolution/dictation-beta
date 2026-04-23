/**
 * dictation — ライブ字幕ウィンドウ
 *
 * 聴覚障害のある方向けの OSD。サイドパネル（母艦）が録音・整形した transcript を
 * localStorage 経由でポーリング・storage イベントで同期して大きく表示する。
 *
 * 設計:
 * - 別ウィンドウとして chrome-extension://.../captions.html で開く
 * - 母艦は dictation:sessions / dictation:activeTab を localStorage に書いているので
 *   こちらは読み取り専用で購読する
 * - 字幕スタイルは dictation:captionsSettings に保存
 * - 字幕ボックスの位置・サイズは dictation:captionsBox に保存
 */

const SESSIONS_KEY = 'dictation:sessions';
const ACTIVE_TAB_KEY = 'dictation:activeTab';
const SETTINGS_KEY = 'dictation:captionsSettings';
const BOX_KEY = 'dictation:captionsBox';

const DEFAULT_SETTINGS = {
  fontSize: 64,
  fontFamily: "'Noto Sans JP', sans-serif",
  fontWeight: 600,
  color: '#ffffff',
  bgColor: '#000000',
  bgAlpha: 70,            // 0-100
  strokeOn: false,
  strokeColor: '#000000',
  strokeWidth: 2,
  shadowOn: true,
  shadowColor: '#000000',
  shadowBlur: 6,
  lineHeightTenth: 14,    // 1.4 を 14 で保持（range が整数のため）
  paraCount: 2,
  followLive: true,

  // 配信モード（OBS向け）
  broadcastMode: false,
  keyColor: '#ff00ff',    // クロマキー用。マゼンタが既定（文字・影に通常含まれない色）
};

const DEFAULT_BOX = {
  left: null,   // null = デフォルト位置を使う
  top: null,
  width: null,
  height: null,
};

/* ───────── 設定ロード/セーブ ───────── */

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
function loadBox() {
  try {
    const raw = localStorage.getItem(BOX_KEY);
    if (raw) return { ...DEFAULT_BOX, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_BOX };
}
function saveBox(b) {
  try { localStorage.setItem(BOX_KEY, JSON.stringify(b)); } catch {}
}

let settings = loadSettings();
let box = loadBox();

/* ───────── 要素参照 ───────── */
const els = {
  body: document.body,
  canvas: document.getElementById('cap-canvas'),
  box: document.getElementById('cap-box'),
  text: document.getElementById('cap-box-text'),
  boxScroll: document.getElementById('cap-box-scroll'),
  status: document.getElementById('cap-status'),
  sessionTitle: document.getElementById('cap-session-title'),
  btnSettings: document.getElementById('cap-btn-settings'),
  btnFullscreen: document.getElementById('cap-btn-fullscreen'),
  btnPip: document.getElementById('cap-btn-pip'),
  btnResetPos: document.getElementById('cap-btn-reset-pos'),
  settings: document.getElementById('cap-settings'),
  settingsClose: document.getElementById('cap-settings-close'),
  inFontSize: document.getElementById('cap-font-size'),
  outFontSize: document.getElementById('cap-font-size-out'),
  inFontFamily: document.getElementById('cap-font-family'),
  inFontWeight: document.getElementById('cap-font-weight'),
  inColor: document.getElementById('cap-color'),
  inBgColor: document.getElementById('cap-bg-color'),
  inBgAlpha: document.getElementById('cap-bg-alpha'),
  outBgAlpha: document.getElementById('cap-bg-alpha-out'),
  inStrokeOn: document.getElementById('cap-stroke-on'),
  inStrokeColor: document.getElementById('cap-stroke-color'),
  inStrokeWidth: document.getElementById('cap-stroke-width'),
  outStrokeWidth: document.getElementById('cap-stroke-width-out'),
  inShadowOn: document.getElementById('cap-shadow-on'),
  inShadowColor: document.getElementById('cap-shadow-color'),
  inShadowBlur: document.getElementById('cap-shadow-blur'),
  outShadowBlur: document.getElementById('cap-shadow-blur-out'),
  inLineHeight: document.getElementById('cap-line-height'),
  outLineHeight: document.getElementById('cap-lh-out'),
  inParaCount: document.getElementById('cap-para-count'),
  inFollowLive: document.getElementById('cap-follow-live'),
  inBroadcast: document.getElementById('cap-broadcast-mode'),
  inKeyColor: document.getElementById('cap-key-color'),
  keyColorName: document.getElementById('cap-key-color-name'),
  btnReset: document.getElementById('cap-btn-reset'),
};

/* ───────── ユーティリティ ───────── */

function hexToRgba(hex, alphaPct) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${(alphaPct|0)/100})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${(alphaPct|0)/100})`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ───────── 設定適用 ───────── */

function applySettings() {
  const root = document.documentElement;
  root.style.setProperty('--cap-font-size', settings.fontSize + 'px');
  root.style.setProperty('--cap-font-family', settings.fontFamily);
  root.style.setProperty('--cap-font-weight', String(settings.fontWeight));
  root.style.setProperty('--cap-font-color', settings.color);
  root.style.setProperty('--cap-bg-color', hexToRgba(settings.bgColor, settings.bgAlpha));
  root.style.setProperty('--cap-line-height', String(settings.lineHeightTenth / 10));

  // シャドウ
  if (settings.shadowOn) {
    root.style.setProperty('--cap-text-shadow', `0 2px ${settings.shadowBlur}px ${settings.shadowColor}`);
  } else {
    root.style.setProperty('--cap-text-shadow', 'none');
  }

  // 縁取り
  if (settings.strokeOn) {
    root.style.setProperty('--cap-stroke', `${settings.strokeWidth}px ${settings.strokeColor}`);
  } else {
    root.style.setProperty('--cap-stroke', 'none');
  }

  // 配信モード
  root.style.setProperty('--cap-key-color', settings.keyColor);
  document.body.classList.toggle('broadcast-mode', !!settings.broadcastMode);
  updateKeyColorName();
}

/** キー色の名前表示を更新（よくある色は日本語で） */
function updateKeyColorName() {
  if (!els.keyColorName) return;
  const c = (settings.keyColor || '').toLowerCase();
  const names = {
    '#ff00ff': 'マゼンタ（推奨）',
    '#00ff00': 'グリーン',
    '#00ffff': 'シアン',
    '#ff0000': 'レッド',
    '#0000ff': 'ブルー',
  };
  els.keyColorName.textContent = names[c] || 'カスタム';
}

/** 配信モードONを押した瞬間に、OBS向けの最適プリセットを適用 */
function applyBroadcastPreset() {
  // シャドウ=純黒・厚めに
  settings.shadowOn = true;
  settings.shadowColor = '#000000';
  settings.shadowBlur = Math.max(settings.shadowBlur, 8);
  // 縁取り=OFF（キー抜け不良になりやすいので）
  settings.strokeOn = false;
  // 文字色が暗い色なら白に寄せる（キー色マゼンタとの対比）
  const color = (settings.color || '').toLowerCase();
  if (color === '#000000' || color === settings.keyColor.toLowerCase()) {
    settings.color = '#ffffff';
  }
}

function applyBox() {
  const b = box;
  // 位置
  if (Number.isFinite(b.left)) els.box.style.left = b.left + 'px';
  else els.box.style.left = '';
  if (Number.isFinite(b.top)) els.box.style.top = b.top + 'px';
  else els.box.style.top = '';
  // サイズ（未指定なら inline style をクリアしてCSS デフォルトに戻す）
  els.box.style.width = Number.isFinite(b.width) ? (b.width + 'px') : '';
  els.box.style.height = Number.isFinite(b.height) ? (b.height + 'px') : '';
  // left を直接指定したら translate を外す（デフォルトは中央寄せのために使われている）
  if (Number.isFinite(b.left)) {
    els.box.style.transform = 'none';
    els.box.style.bottom = '';
  } else {
    els.box.style.transform = '';
    els.box.style.bottom = '';
  }
}

function resetBox() {
  box = { ...DEFAULT_BOX };
  saveBox(box);
  // inline styleを明示的に全部クリア → CSS 側の %幅・中央寄せ translate に戻る
  els.box.style.left = '';
  els.box.style.top = '';
  els.box.style.width = '';
  els.box.style.height = '';
  els.box.style.transform = '';
  els.box.style.bottom = '';
  applyBox();
}

/* ───────── 設定UIバインディング ───────── */

function reflectSettingsToUI() {
  els.inFontSize.value = settings.fontSize;
  els.outFontSize.textContent = settings.fontSize + 'px';
  els.inFontFamily.value = settings.fontFamily;
  els.inFontWeight.value = settings.fontWeight;
  els.inColor.value = settings.color;
  els.inBgColor.value = settings.bgColor;
  els.inBgAlpha.value = settings.bgAlpha;
  els.outBgAlpha.textContent = settings.bgAlpha + '%';
  els.inStrokeOn.checked = settings.strokeOn;
  els.inStrokeColor.value = settings.strokeColor;
  els.inStrokeWidth.value = settings.strokeWidth;
  els.outStrokeWidth.textContent = settings.strokeWidth + 'px';
  els.inShadowOn.checked = settings.shadowOn;
  els.inShadowColor.value = settings.shadowColor;
  els.inShadowBlur.value = settings.shadowBlur;
  els.outShadowBlur.textContent = settings.shadowBlur + 'px';
  els.inLineHeight.value = settings.lineHeightTenth;
  els.outLineHeight.textContent = (settings.lineHeightTenth / 10).toFixed(1);
  els.inParaCount.value = String(settings.paraCount);
  els.inFollowLive.checked = settings.followLive;
  if (els.inBroadcast) els.inBroadcast.checked = !!settings.broadcastMode;
  if (els.inKeyColor) els.inKeyColor.value = settings.keyColor;
}

function commit() {
  saveSettings(settings);
  applySettings();
}

function bindSettingsUI() {
  els.inFontSize.addEventListener('input', () => {
    settings.fontSize = Number(els.inFontSize.value);
    els.outFontSize.textContent = settings.fontSize + 'px';
    commit();
  });
  els.inFontFamily.addEventListener('change', () => { settings.fontFamily = els.inFontFamily.value; commit(); });
  els.inFontWeight.addEventListener('change', () => { settings.fontWeight = Number(els.inFontWeight.value); commit(); });
  els.inColor.addEventListener('input', () => { settings.color = els.inColor.value; commit(); });
  els.inBgColor.addEventListener('input', () => { settings.bgColor = els.inBgColor.value; commit(); });
  els.inBgAlpha.addEventListener('input', () => {
    settings.bgAlpha = Number(els.inBgAlpha.value);
    els.outBgAlpha.textContent = settings.bgAlpha + '%';
    commit();
  });
  els.inStrokeOn.addEventListener('change', () => { settings.strokeOn = els.inStrokeOn.checked; commit(); });
  els.inStrokeColor.addEventListener('input', () => { settings.strokeColor = els.inStrokeColor.value; commit(); });
  els.inStrokeWidth.addEventListener('input', () => {
    settings.strokeWidth = Number(els.inStrokeWidth.value);
    els.outStrokeWidth.textContent = settings.strokeWidth + 'px';
    commit();
  });
  els.inShadowOn.addEventListener('change', () => { settings.shadowOn = els.inShadowOn.checked; commit(); });
  els.inShadowColor.addEventListener('input', () => { settings.shadowColor = els.inShadowColor.value; commit(); });
  els.inShadowBlur.addEventListener('input', () => {
    settings.shadowBlur = Number(els.inShadowBlur.value);
    els.outShadowBlur.textContent = settings.shadowBlur + 'px';
    commit();
  });
  els.inLineHeight.addEventListener('input', () => {
    settings.lineHeightTenth = Number(els.inLineHeight.value);
    els.outLineHeight.textContent = (settings.lineHeightTenth / 10).toFixed(1);
    commit();
  });
  els.inParaCount.addEventListener('change', () => {
    settings.paraCount = Number(els.inParaCount.value);
    commit();
    renderLatest();
  });
  els.inFollowLive.addEventListener('change', () => { settings.followLive = els.inFollowLive.checked; commit(); });

  // 配信モードトグル
  if (els.inBroadcast) {
    els.inBroadcast.addEventListener('change', () => {
      settings.broadcastMode = els.inBroadcast.checked;
      if (settings.broadcastMode) {
        applyBroadcastPreset(); // シャドウ厚め、縁取りOFF等
        reflectSettingsToUI();  // プリセット反映でUI更新
      }
      commit();
    });
  }
  if (els.inKeyColor) {
    els.inKeyColor.addEventListener('input', () => {
      settings.keyColor = els.inKeyColor.value;
      commit();
    });
  }

  els.btnReset.addEventListener('click', () => {
    if (!confirm('字幕の表示設定をすべて初期値に戻しますか？')) return;
    settings = { ...DEFAULT_SETTINGS };
    reflectSettingsToUI();
    commit();
  });

  els.btnSettings.addEventListener('click', () => els.settings.classList.toggle('hidden'));
  els.settingsClose.addEventListener('click', () => els.settings.classList.add('hidden'));

  els.btnFullscreen.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) { console.warn('fullscreen failed', e); }
  });

  // デスクトップオーバーレイ（Document Picture-in-Picture）
  if (els.btnPip) {
    els.btnPip.addEventListener('click', togglePipOverlay);
  }

  els.btnResetPos.addEventListener('click', () => {
    if (!confirm('字幕ボックスの位置とサイズを初期値に戻しますか？')) return;
    resetBox();
  });
}

/* ───────── デスクトップオーバーレイ（Document Picture-in-Picture） ─────────
 * UX: ボタンを押したら「親ウィンドウが形を変えた」ように見せるため、
 * PiPウィンドウに字幕を移動→親ウィンドウを閉じる。
 * PiP側には自己完結で動く captions スクリプトを inject しておき、
 * 親が消えても字幕表示が止まらないようにする。
 * 右クリックで「通常モードに戻る」→ 親を開き直して PiP を閉じる。 */

async function togglePipOverlay() {
  if (!('documentPictureInPicture' in window)) {
    alert('このブラウザではデスクトップオーバーレイ（Document Picture-in-Picture）に対応していません。\n\nChrome 116以上で試してください。');
    return;
  }
  try {
    const rect = els.box.getBoundingClientRect();
    const pipWin = await documentPictureInPicture.requestWindow({
      width: Math.max(320, Math.round(rect.width) || 720),
      height: Math.max(120, Math.round(rect.height) || 180),
    });

    // 現ドキュメントのスタイルシートをPiP側へコピー（link と同様に相対解決するよう絶対URL化）
    [...document.styleSheets].forEach(ss => {
      try {
        if (ss.href) {
          const link = pipWin.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = ss.href;
          pipWin.document.head.appendChild(link);
        } else {
          const style = pipWin.document.createElement('style');
          style.textContent = [...ss.cssRules].map(r => r.cssText).join('\n');
          pipWin.document.head.appendChild(style);
        }
      } catch (e) { /* CORSで読めないシートはスキップ */ }
    });
    pipWin.document.body.classList.add('cap-body', 'pip-mode');
    pipWin.document.title = '字幕（デスクトップオーバーレイ）';

    // 字幕ボックスを PiP に移動（MOVE: DOM参照はそのまま、ただし親が閉じたらJSは動かなくなる）
    pipWin.document.body.appendChild(els.box);

    // 親のJSコンテキストが死んでも PiP 側で字幕更新が続くよう、
    // 自己完結スクリプトを注入（localStorage を直接購読）
    const captionsUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('captions.html')
      : location.href;
    injectPipSelfContainedScript(pipWin, captionsUrl);

    // 親ウィンドウを閉じる（PiP が親の「変身形態」のように見える）
    // 少しだけ遅延してPiPの初期化が確実に終わってから。
    setTimeout(() => {
      try { window.close(); } catch {}
    }, 50);
  } catch (e) {
    console.warn('PiP オーバーレイ起動失敗:', e);
    alert('デスクトップオーバーレイの起動に失敗しました。\n\n' + (e.message || e));
  }
}

/**
 * PiP ウィンドウに、親が閉じても動作する自己完結型の字幕更新スクリプトを注入する。
 * - localStorage を storage イベント＋1秒ポーリングで監視し最新発話を表示
 * - 右クリックで「通常モードに戻る」メニュー（親を再オープンしてPiPを閉じる）
 */
function injectPipSelfContainedScript(pipWin, captionsUrl) {
  const script = pipWin.document.createElement('script');
  // テンプレートリテラルの中に実際のJSコードを入れる。同origin（chrome-extension://）で動く
  script.textContent = `
(function() {
  var SESSIONS_KEY = 'dictation:sessions';
  var ACTIVE_TAB_KEY = 'dictation:activeTab';
  var SETTINGS_KEY = 'dictation:captionsSettings';

  function getActiveSession() {
    try {
      var raw = localStorage.getItem(SESSIONS_KEY);
      if (!raw) return null;
      var sessions = JSON.parse(raw);
      if (!Array.isArray(sessions) || sessions.length === 0) return null;
      var activeRaw = localStorage.getItem(ACTIVE_TAB_KEY);
      var activeId = null;
      if (activeRaw) { try { activeId = JSON.parse(activeRaw); } catch (e) { activeId = activeRaw; } }
      return sessions.find(function(s) { return s.id === activeId; }) || sessions[sessions.length - 1];
    } catch (e) { return null; }
  }
  function getSettings() {
    try { var r = localStorage.getItem(SETTINGS_KEY); if (r) return JSON.parse(r); } catch (e) {}
    return { paraCount: 2, followLive: true };
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
  }

  function renderLatest() {
    var session = getActiveSession();
    var settings = getSettings();
    var textEl = document.getElementById('cap-box-text');
    var scrollEl = document.getElementById('cap-box-scroll');
    if (!textEl) return;
    if (!session) { textEl.innerHTML = ''; return; }
    var tmp = document.createElement('div');
    tmp.innerHTML = session.transcript || '';
    var paras = Array.from(tmp.querySelectorAll('.paragraph'));
    if (paras.length === 0 && (tmp.textContent || '').trim()) {
      paras = tmp.textContent.trim().split(/\\n{2,}/).map(function(t) {
        var d = document.createElement('div'); d.textContent = t; return d;
      });
    }
    var n = Math.max(1, Math.min(5, settings.paraCount || 2));
    var latest = paras.slice(-n);
    if (latest.length === 0) { textEl.innerHTML = ''; }
    else {
      textEl.innerHTML = latest.map(function(p, idx) {
        var isLast = idx === latest.length - 1;
        var cls = 'cap-para' + (isLast ? ' latest' : '');
        var h2 = p.querySelector && p.querySelector('h2');
        if (h2) {
          var heading = escapeHtml((h2.textContent || '').trim());
          var bodyEl = p.querySelector('.p-body');
          var bodyText = escapeHtml(((bodyEl ? bodyEl.textContent : (p.textContent || '').replace(h2.textContent, '')) || '').trim());
          return '<p class="' + cls + '"><strong>' + heading + '</strong><br>' + bodyText + '</p>';
        }
        var txt = escapeHtml(((p.textContent || '')).trim());
        return '<p class="' + cls + '">' + txt + '</p>';
      }).join('');
    }
    if (settings.followLive !== false && scrollEl) {
      requestAnimationFrame(function() { scrollEl.scrollTop = scrollEl.scrollHeight; });
    }
  }

  // ライブ同期
  window.addEventListener('storage', function(e) {
    if (e.key === SESSIONS_KEY || e.key === ACTIVE_TAB_KEY || e.key === SETTINGS_KEY) renderLatest();
  });
  setInterval(renderLatest, 1000);
  renderLatest();

  // 右クリック: 通常モードに戻す or 閉じる
  var CAPTIONS_URL = ${JSON.stringify(captionsUrl)};
  function showPipMenu(x, y) {
    var old = document.getElementById('pip-ctx-menu');
    if (old) old.remove();
    var menu = document.createElement('div');
    menu.id = 'pip-ctx-menu';
    menu.setAttribute('style',
      'position:fixed;z-index:9999;min-width:200px;padding:6px;' +
      'background:#23232a;border:1px solid #3a3a44;border-radius:10px;' +
      'box-shadow:0 12px 36px rgba(0,0,0,0.6);font-family:Noto Sans JP,sans-serif;' +
      'font-size:13px;color:#e8e8eb;user-select:none;');
    var items = [
      { label: '🪟 通常モードに戻る', act: function() {
          try { window.open(CAPTIONS_URL, 'dictation-captions', 'popup=yes,width=960,height=540,resizable=yes'); } catch(e) {}
          setTimeout(function() { window.close(); }, 30);
        } },
      { label: '⛶ 全画面切替', act: function() {
          try {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else document.exitFullscreen();
          } catch(e) {}
        } },
      { label: '✕ オーバーレイを閉じる', act: function() { window.close(); } },
    ];
    items.forEach(function(it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.setAttribute('style',
        'display:block;width:100%;padding:8px 12px;background:transparent;' +
        'color:#e8e8eb;border:0;border-radius:6px;text-align:left;font:inherit;cursor:pointer;');
      b.addEventListener('mouseenter', function() { b.style.background = '#2d2d36'; });
      b.addEventListener('mouseleave', function() { b.style.background = 'transparent'; });
      b.addEventListener('click', function(e) { e.stopPropagation(); menu.remove(); it.act(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    var vw = window.innerWidth, vh = window.innerHeight;
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, vw - r.width - 4) + 'px';
    menu.style.top  = Math.min(y, vh - r.height - 4) + 'px';
    setTimeout(function() {
      var close = function(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close, true); } };
      document.addEventListener('click', close, true);
    }, 0);
  }
  document.addEventListener('contextmenu', function(e) {
    e.preventDefault();
    showPipMenu(e.clientX, e.clientY);
  });
  // 画面下部に小さな目印（右クリックでメニュー）
  var hint = document.createElement('div');
  hint.setAttribute('style',
    'position:fixed;bottom:4px;right:8px;font-size:10px;color:rgba(255,255,255,0.35);' +
    'pointer-events:none;user-select:none;z-index:8000;');
  hint.textContent = '右クリック: メニュー';
  document.body.appendChild(hint);
  setTimeout(function() { hint.style.transition = 'opacity 0.6s'; hint.style.opacity = '0'; }, 3500);
})();
`;
  pipWin.document.body.appendChild(script);
}

/* ───────── ドラッグ・リサイズ ───────── */

function bindBoxInteractions() {
  let dragging = false;
  let resizing = null;  // 'br' | 'tl' | 'tr' | 'bl' | null
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0, startWidth = 0, startHeight = 0;

  els.box.addEventListener('pointerdown', (e) => {
    // リサイズハンドル優先
    const handle = e.target.closest('.cap-resize');
    const rect = els.box.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    startWidth = rect.width; startHeight = rect.height;

    if (handle) {
      resizing = handle.dataset.resize;
      els.box.classList.add('resizing');
    } else {
      // 本体つかみ = ドラッグ移動
      dragging = true;
    }
    try { els.box.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
    e.stopPropagation();
  });

  els.box.addEventListener('pointermove', (e) => {
    if (!dragging && !resizing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const vw = window.innerWidth, vh = window.innerHeight;
    const MIN_W = 120, MIN_H = 50;

    if (dragging) {
      let nl = startLeft + dx;
      let nt = startTop + dy;
      // ビューポート内に収める
      nl = Math.max(0, Math.min(vw - startWidth, nl));
      nt = Math.max(0, Math.min(vh - startHeight, nt));
      els.box.style.transform = 'none';
      els.box.style.bottom = '';
      els.box.style.left = nl + 'px';
      els.box.style.top = nt + 'px';
    } else if (resizing) {
      let newLeft = startLeft, newTop = startTop, newW = startWidth, newH = startHeight;
      if (resizing === 'br') { newW = startWidth + dx; newH = startHeight + dy; }
      else if (resizing === 'tl') { newLeft = startLeft + dx; newTop = startTop + dy; newW = startWidth - dx; newH = startHeight - dy; }
      else if (resizing === 'tr') { newTop = startTop + dy; newW = startWidth + dx; newH = startHeight - dy; }
      else if (resizing === 'bl') { newLeft = startLeft + dx; newW = startWidth - dx; newH = startHeight + dy; }
      newW = Math.max(MIN_W, newW);
      newH = Math.max(MIN_H, newH);
      // 左側を縮めたいときは left を上書き
      if (resizing === 'tl' || resizing === 'bl') newLeft = Math.max(0, Math.min(startLeft + startWidth - MIN_W, newLeft));
      if (resizing === 'tl' || resizing === 'tr') newTop = Math.max(0, Math.min(startTop + startHeight - MIN_H, newTop));
      els.box.style.transform = 'none';
      els.box.style.bottom = '';
      els.box.style.left = newLeft + 'px';
      els.box.style.top = newTop + 'px';
      els.box.style.width = newW + 'px';
      els.box.style.height = newH + 'px';
    }
  });

  const endDrag = (e) => {
    if (!dragging && !resizing) return;
    dragging = false;
    resizing = null;
    els.box.classList.remove('resizing');
    try { els.box.releasePointerCapture(e.pointerId); } catch {}
    // 位置・サイズを保存
    const rect = els.box.getBoundingClientRect();
    box = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    saveBox(box);
  };
  els.box.addEventListener('pointerup', endDrag);
  els.box.addEventListener('pointercancel', endDrag);
}

/* ───────── セッションの読取・表示 ───────── */

function loadActiveSession() {
  try {
    const sessionsRaw = localStorage.getItem(SESSIONS_KEY);
    const activeRaw = localStorage.getItem(ACTIVE_TAB_KEY);
    if (!sessionsRaw) return null;
    const sessions = JSON.parse(sessionsRaw);
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    let activeId = null;
    if (activeRaw) {
      // activeTab は文字列のID そのまま、もしくはJSON化かもしれないので両対応
      try { activeId = JSON.parse(activeRaw); } catch { activeId = activeRaw; }
    }
    return sessions.find(s => s.id === activeId) || sessions[sessions.length - 1];
  } catch (e) {
    console.warn('loadActiveSession failed', e);
    return null;
  }
}

/**
 * 対象セッションの transcript HTML から「最新 N 段落の文字列」を取り出して字幕に表示。
 */
function renderLatest() {
  const session = loadActiveSession();
  if (!session) {
    els.text.innerHTML = '';
    els.sessionTitle.textContent = '';
    setStatus('idle', '待機');
    return;
  }
  els.sessionTitle.textContent = session.title || '';

  // transcript は HTML 文字列。DOM として parse して .paragraph を拾う
  const tmp = document.createElement('div');
  tmp.innerHTML = session.transcript || '';

  let paras = Array.from(tmp.querySelectorAll('.paragraph'));
  if (paras.length === 0 && tmp.textContent.trim()) {
    // .paragraph 構造がない生テキストの場合は、改行で分割
    paras = tmp.textContent.trim().split(/\n{2,}/).map(t => {
      const d = document.createElement('div');
      d.textContent = t;
      return d;
    });
  }

  const n = Math.max(1, Math.min(5, settings.paraCount || 2));
  const latest = paras.slice(-n);

  if (latest.length === 0) {
    els.text.innerHTML = '';
  } else {
    els.text.innerHTML = latest.map((p, idx) => {
      const isLast = idx === latest.length - 1;
      const cls = 'cap-para' + (isLast ? ' latest' : '');
      // 段落内に h2（見出し）がある場合は <strong> で強調し見出し感を残す
      const h2 = p.querySelector && p.querySelector('h2');
      if (h2) {
        const heading = escapeHtml(h2.textContent.trim());
        const bodyEl = p.querySelector('.p-body');
        const bodyText = escapeHtml((bodyEl ? bodyEl.textContent : (p.textContent || '').replace(h2.textContent, '')).trim());
        return `<p class="${cls}"><strong>${heading}</strong><br>${bodyText}</p>`;
      }
      const text = escapeHtml((p.textContent || '').trim());
      return `<p class="${cls}">${text}</p>`;
    }).join('');
  }

  if (settings.followLive) {
    // 常に最下部へ（最新が見える）
    requestAnimationFrame(() => {
      const sc = els.boxScroll;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
  }

  // 録音中かどうかの簡易判定: 更新から 15秒以内なら listening 扱い
  const updated = Number(session.updatedAt) || 0;
  const live = Date.now() - updated < 15000;
  setStatus(live ? 'listening' : 'idle', live ? '● 受信中' : '● 待機');
}

function setStatus(mode, label) {
  els.status.className = 'cap-status ' + mode;
  els.status.textContent = label;
}

/* ───────── 同期（localStorage 購読） ───────── */

function bindSync() {
  // 同一オリジンの別ページ（サイドパネル index.html）での localStorage.setItem が storage イベントとしてここに届く
  window.addEventListener('storage', (e) => {
    if (e.key === SESSIONS_KEY || e.key === ACTIVE_TAB_KEY) {
      renderLatest();
    }
  });
  // 保険のため、1秒ごとのポーリングも（storageイベントは別タブに対してしか発火しないが、
  // どのタイミングでも確実に最新が出るように）
  setInterval(renderLatest, 1000);
}

/* ───────── init ───────── */

function init() {
  reflectSettingsToUI();
  applySettings();
  applyBox();
  bindSettingsUI();
  bindBoxInteractions();
  bindSync();
  renderLatest();
  document.title = '字幕（ライブキャプション）';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
