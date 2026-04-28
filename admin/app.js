/**
 * ============================================================
 * trunk 管理画面 - admin/app.js
 * ============================================================
 */

const ADMIN_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzbI4xCzAPOoZAMR06t5kKZAQuvu3EUF7pBNiqPDN7DIvvj38odiJfwLWGxB9jG_7lj1A/exec',
  LIFF_ID: '2009742884-8ACt2H8G',
};

// ============================================================
// 時間ユーティリティ（フロントエンド用）
// ============================================================
function minutesToTimeStr(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// グリッドに表示する時間帯：10:00〜26:00（30分刻み）
const GRID_TIMES = (() => {
  const times = [];
  for (let m = 10 * 60; m < 26 * 60; m += 30) times.push(minutesToTimeStr(m));
  return times;
})();

// ============================================================
// 状態管理
// ============================================================
const state = {
  phase: 'loading',
  tab: 'reservations',   // 'reservations' | 'grid'
  lineUserId: null,
  // 予約タブ
  futureReservations: [],
  // グリッドタブ
  gridData: null,          // { openSet, resMap, calMap, intervalSet }
  gridOriginalOpen: null,  // Set<"date_time"> — 保存済み状態
  gridLoading: false,
  gridSaving: false,
};

// ============================================================
// 日付ユーティリティ
// ============================================================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDateLabel(dateStr) {
  const d    = new Date(dateStr + 'T00:00:00+09:00');
  const week = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${week}）`;
}
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  return dateToStr(d);
}
// 今日から31日分の日付配列
function getGridDates() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dates = [];
  for (let i = 0; i < 31; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(dateToStr(d));
  }
  return dates;
}

// ============================================================
// API通信
// ============================================================
async function apiGet(params) {
  const url = new URL(ADMIN_CONFIG.GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}
async function apiPost(body) {
  const res = await fetch(ADMIN_CONFIG.GAS_URL, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

// ============================================================
// トースト通知
// ============================================================
function showToast(message, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ============================================================
// ローディング・エラー画面
// ============================================================
function renderLoading() {
  document.getElementById('app').innerHTML = `
    <div class="loading-screen">
      <div class="loading-logo">trunk</div>
      <div class="spinner"></div>
    </div>`;
}
function renderAuthError() {
  document.getElementById('app').innerHTML = `
    <div class="loading-screen">
      <div class="loading-logo">trunk</div>
      <p style="margin-top:24px;color:#EF5350;font-size:14px;">
        この画面はオーナー専用です。<br>アクセス権限がありません。
      </p>
    </div>`;
}

// ============================================================
// SVG アイコン定義
// ============================================================
const ICONS = {
  // 予約：クリップボードアイコン
  reservation: `<svg class="admin-tab-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/>
    <line x1="8" y1="17" x2="14" y2="17"/>
  </svg>`,
  // 予約枠：グリッドテーブルアイコン
  grid: `<svg class="admin-tab-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/>
    <line x1="9" y1="3" x2="9" y2="21"/>
  </svg>`,
};

// ============================================================
// メイン画面
// ============================================================
function renderMain() {
  document.getElementById('app').innerHTML = `
    <div class="header">
      <div class="header-content">
        <div class="header-title">trunk 管理</div>
      </div>
    </div>
    <div class="admin-content" id="main-content"></div>
    <nav class="admin-tab-bar">
      <button class="admin-tab-btn ${state.tab === 'reservations' ? 'active' : ''}"
              onclick="switchTab('reservations')">
        ${ICONS.reservation}予約
      </button>
      <button class="admin-tab-btn ${state.tab === 'grid' ? 'active' : ''}"
              onclick="switchTab('grid')">
        ${ICONS.grid}予約枠の管理
      </button>
    </nav>`;
  renderContent();
}

function renderContent() {
  const el = document.getElementById('main-content');
  if (!el) return;
  if (state.tab === 'reservations') el.innerHTML = renderReservationsTab();
  else                              el.innerHTML = renderGridTab();
}

function switchTab(tab) {
  state.tab = tab;
  renderMain();
  if (tab === 'grid' && !state.gridData) loadGridData();
  else if (tab === 'grid') renderContent();
  else if (tab === 'reservations') loadFutureReservations();
}

// ============================================================
// 予約タブ
// ============================================================
function renderReservationsTab() {
  if (state.futureReservations.length === 0) {
    return `<div class="empty-state">今後の予約はありません</div>`;
  }

  // 日付ごとにグループ化
  const byDate = {};
  state.futureReservations.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });

  const sections = Object.keys(byDate).sort().map(date => {
    const cards = byDate[date].map(r => {
      const isCancelled = r.status === 'cancelled';
      const badgeClass  = r.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';
      return `
        <div class="reservation-card tappable${isCancelled ? ' cancelled' : ''}"
             onclick="openReservationDetail('${r.reservationId}')">
          <div class="reservation-time">${r.startTime} 〜 ${r.endTime}</div>
          <div class="reservation-info">
            <span class="service-badge ${badgeClass}">${r.serviceType}</span>
            <span class="reservation-name">${r.customerName}</span>
            ${isCancelled ? '<span class="badge-cancelled">キャンセル済</span>' : ''}
          </div>
          <div class="reservation-menu">${r.menuName}（${r.duration}分）</div>
          ${r.address ? `<div class="reservation-menu" style="margin-top:4px;">📍 ${r.address}</div>` : ''}
        </div>`;
    }).join('');
    return `
      <div class="date-section-header">${formatDateLabel(date)}</div>
      ${cards}`;
  }).join('');

  return `<div class="reservation-list">${sections}</div>`;
}

// ============================================================
// 予約詳細モーダル
// ============================================================
function openReservationDetail(reservationId) {
  const r = state.futureReservations.find(x => x.reservationId === reservationId);
  if (!r) return;

  const isCancelled = r.status === 'cancelled';
  const badgeClass  = r.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'detail-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" id="detail-modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">予約詳細</span>
        <button class="modal-close" onclick="closeReservationDetail()">✕</button>
      </div>
      ${isCancelled ? '<div class="modal-cancelled-banner">キャンセル済みの予約です</div>' : ''}
      <div class="modal-body">
        <div class="detail-row">
          <span class="detail-label">日時</span>
          <span class="detail-value">${formatDateLabel(r.date)}<br>${r.startTime} 〜 ${r.endTime}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">お客様</span>
          <span class="detail-value">${r.customerName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">メニュー</span>
          <span class="detail-value">${r.menuName}（${r.duration}分）</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">種別</span>
          <span class="detail-value"><span class="service-badge ${badgeClass}">${r.serviceType}</span></span>
        </div>
        ${r.address ? `
        <div class="detail-row">
          <span class="detail-label">住所</span>
          <span class="detail-value">${r.address}</span>
        </div>` : ''}
      </div>
      ${!isCancelled ? `
      <div class="modal-footer">
        <button class="btn-cancel-reservation" id="cancel-reservation-btn"
                onclick="handleAdminCancel('${r.reservationId}')">
          この予約をキャンセルする
        </button>
      </div>` : ''}
    </div>`;

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeReservationDetail();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    const sheet = document.getElementById('detail-modal-sheet');
    if (sheet) sheet.classList.add('visible');
  });
}

function closeReservationDetail() {
  const overlay = document.getElementById('detail-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  const sheet = document.getElementById('detail-modal-sheet');
  if (sheet) sheet.classList.remove('visible');
  setTimeout(() => overlay.remove(), 300);
}

async function handleAdminCancel(reservationId) {
  const r = state.futureReservations.find(x => x.reservationId === reservationId);
  if (!r) return;

  const btn = document.getElementById('cancel-reservation-btn');

  // 確認ステップ：ボタンを「本当にキャンセル」に切り替え
  if (btn && btn.dataset.confirmed !== 'yes') {
    btn.dataset.confirmed = 'yes';
    btn.textContent = '本当にキャンセルする（お客様に通知が届きます）';
    btn.style.background = '#B71C1C';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'キャンセル処理中...'; }

  try {
    const result = await apiPost({ action: 'adminCancelReservation', reservationId });
    if (result.error) throw new Error(result.error);

    // ローカル状態を更新
    if (r) r.status = 'cancelled';

    closeReservationDetail();
    showToast('予約をキャンセルしました');
    renderContent();
  } catch(err) {
    showToast('キャンセルに失敗しました: ' + err.message, true);
    if (btn) {
      btn.disabled = false;
      btn.dataset.confirmed = '';
      btn.textContent = 'この予約をキャンセルする';
      btn.style.background = '';
    }
  }
}

// ============================================================
// 予約枠グリッドタブ
// ============================================================
function renderGridTab() {
  if (state.gridLoading) {
    return `<div class="empty-state" style="padding-top:80px;">
      <div class="spinner" style="margin:0 auto 16px;width:28px;height:28px;border-width:3px;"></div>
      読み込み中...
    </div>`;
  }
  if (!state.gridData) {
    return `<div class="empty-state">データを読み込めませんでした</div>`;
  }

  const dates    = getGridDates();
  const today    = todayStr();
  const { openSet, resMap } = state.gridData;
  const changes  = getGridChanges();
  const hasDirty = Object.keys(changes).length > 0;
  const changeCount = Object.keys(changes).length;

  // ヘッダー行
  const headerCells = dates.map(date => {
    const d   = new Date(date + 'T00:00:00+09:00');
    const dow = d.getDay();
    const m   = d.getMonth() + 1;
    const day = d.getDate();
    const wk  = ['日', '月', '火', '水', '木', '金', '土'][dow];
    let cls   = 'grid-date-th';
    if (date === today)  cls += ' today-col';
    else if (dow === 0)  cls += ' sun';
    else if (dow === 6)  cls += ' sat';
    return `<th class="${cls}" id="col-${date}">${m}/${day}<br><span style="font-weight:400;font-size:10px;">${wk}</span></th>`;
  }).join('');

  const { calMap, intervalSet } = state.gridData;

  // ボディ行
  const bodyRows = GRID_TIMES.map(time => {
    const cells = dates.map(date => {
      const key = `${date}_${time}`;
      const [cls, content, onclick] = _buildCell(key, date, time, { resMap, openSet, calMap, intervalSet, today });
      return `<td class="${cls}" id="cell-${key}" ${onclick}>${content}</td>`;
    }).join('');

    return `<tr><td class="grid-time-td">${time}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="grid-container">
      <div class="grid-toolbar">
        <span class="grid-toolbar-note" id="grid-toolbar-note">
          ${hasDirty
            ? `<span style="color:var(--primary);font-weight:600;">${changeCount}日分の変更あり</span>`
            : 'タップで○/✕を切り替え、保存で反映'}
        </span>
        <button class="grid-save-btn ${hasDirty ? '' : 'hidden'}" id="grid-save-btn"
                onclick="handleSaveGrid()"
                ${state.gridSaving ? 'disabled' : ''}>
          ${state.gridSaving ? '保存中...' : '保存する'}
        </button>
      </div>
      <div class="grid-scroll" id="grid-scroll">
        <table class="grid-table">
          <thead>
            <tr>
              <th class="grid-corner">時間</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;
}

// ============================================================
// グリッドのデータ操作
// ============================================================

// セルをローカルでトグル（スクロール位置を保持するため外科的DOM更新）
function localToggleGridCell(date, time) {
  const key = `${date}_${time}`;
  if (state.gridData.openSet.has(key)) {
    state.gridData.openSet.delete(key);
  } else {
    state.gridData.openSet.add(key);
  }
  updateGridCell(date, time);
  updateGridToolbar();
}

// 対象セルのみDOMを更新
function updateGridCell(date, time) {
  const key = `${date}_${time}`;
  const td  = document.getElementById(`cell-${key}`);
  if (!td) return;

  const { resMap, openSet, calMap, intervalSet } = state.gridData;
  const [cls, content] = _buildCell(key, date, time, { resMap, openSet, calMap, intervalSet, today: todayStr() });

  td.className = cls;
  td.innerHTML = content;
}

// ============================================================
// セル描画ヘルパー：[className, innerHTML, onclickAttr] を返す
// 優先順位: 予約 > pending変更 > カレンダー予定 > インターバル > open/closed
// ============================================================
function _buildCell(key, date, time, { resMap, openSet, calMap, intervalSet, today }) {
  const res      = resMap.get(key);
  const cal      = calMap ? calMap.get(key) : null;
  const inInterval = intervalSet ? intervalSet.has(key) : false;
  const isOpen   = openSet.has(key);
  const wasOpen  = state.gridOriginalOpen ? state.gridOriginalOpen.has(key) : isOpen;
  const modified = isOpen !== wasOpen;

  let cls     = 'grid-cell';
  let content = '';
  let onclick = '';

  if (date === today) cls += ' today-col';

  if (res) {
    // ── 施術予約あり（タップで詳細・変更不可）
    cls    += isOpen ? ' reserved-open' : ' reserved';
    const label = res.serviceType === '出張' ? '出' : '来';
    content = `<div class="cell-res-inner">${res.customerName}<span class="cell-type-dot ${res.serviceType === '出張' ? 'dot-mobile' : 'dot-visit'}">${label}</span></div>`;
    onclick = `onclick="showToast('${res.customerName}（${res.serviceType}）', false)"`;

  } else if (modified && isOpen) {
    cls    += ' pending-open';
    content = '○';
    onclick = `onclick="localToggleGridCell('${date}','${time}')"`;

  } else if (modified && !isOpen) {
    cls    += ' pending-close';
    content = '✕';
    onclick = `onclick="localToggleGridCell('${date}','${time}')"`;

  } else if (cal) {
    // ── プライベートカレンダー予定（トグル可能）
    cls    += isOpen ? ' cal-event-open' : ' cal-event';
    const shortTitle = cal.title.length > 5 ? cal.title.slice(0, 5) + '…' : cal.title;
    content = `<div class="cell-cal-inner">${shortTitle}</div>`;
    onclick = `onclick="localToggleGridCell('${date}','${time}')"`;

  } else if (inInterval) {
    // ── インターバル（受付不可）
    cls    += isOpen ? ' interval-open' : ' interval';
    content = '<span class="cell-interval-label">準備</span>';
    onclick = `onclick="localToggleGridCell('${date}','${time}')"`;

  } else if (isOpen) {
    cls    += ' open';
    content = '○';
    onclick = `onclick="localToggleGridCell('${date}','${time}')"`;

  } else {
    cls    += ' closed';
    content = '−';
    onclick = `onclick="localToggleGridCell('${date}','${time}')"`;
  }

  return [cls, content, onclick];
}

// ツールバー（変更件数・保存ボタン）だけ更新
function updateGridToolbar() {
  const changes    = getGridChanges();
  const hasDirty   = Object.keys(changes).length > 0;
  const changeCount = Object.keys(changes).length;

  const note = document.getElementById('grid-toolbar-note');
  const btn  = document.getElementById('grid-save-btn');
  if (note) {
    note.innerHTML = hasDirty
      ? `<span style="color:var(--primary);font-weight:600;">${changeCount}日分の変更あり</span>`
      : 'タップで○/✕を切り替え、保存で反映';
  }
  if (btn) {
    btn.className   = `grid-save-btn ${hasDirty ? '' : 'hidden'}`;
    btn.disabled    = state.gridSaving;
    btn.textContent = state.gridSaving ? '保存中...' : '保存する';
  }
}

// 変更があった日付とその開放時間リストを取得
function getGridChanges() {
  const changes = {};
  const dates   = getGridDates();
  dates.forEach(date => {
    const origTimes = GRID_TIMES.filter(t => state.gridOriginalOpen.has(`${date}_${t}`));
    const currTimes = GRID_TIMES.filter(t => state.gridData.openSet.has(`${date}_${t}`));
    if (JSON.stringify(origTimes) !== JSON.stringify(currTimes)) {
      changes[date] = currTimes;
    }
  });
  return changes;
}

// グリッドデータをGASから取得
async function loadGridData() {
  state.gridLoading = true;
  renderContent();

  try {
    const result = await apiGet({ action: 'getGridData', startDate: todayStr(), days: 31 });
    if (result.error) throw new Error(result.error);

    // ① スロットから開放セットを構築（範囲 → 30分ブロックに展開）
    const openSet = new Set();
    result.slots.forEach(slot => {
      const start = timeToMin(slot.startTime);
      const end   = timeToMin(slot.endTime);
      for (let m = start; m < end; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t)) openSet.add(`${slot.date}_${t}`);
      }
    });

    // ② 予約からマップを構築（開始〜終了の各ブロックにマッピング）
    const resMap = new Map();
    result.reservations.forEach(res => {
      const start = timeToMin(res.startTime);
      const end   = timeToMin(res.endTime);
      for (let m = start; m < end; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t)) {
          resMap.set(`${res.date}_${t}`, {
            customerName: res.customerName,
            menuName:     res.menuName,
            serviceType:  res.serviceType,
          });
        }
      }
    });

    // ③ カレンダーイベント（プライベート）からマップを構築
    const calMap = new Map();
    (result.calendarEvents || []).forEach(ev => {
      const start = timeToMin(ev.startTime);
      const end   = timeToMin(ev.endTime);
      // 重なるブロックを計算（ブロック T は [T, T+30) を占有）
      const blockStart = Math.floor(start / 30) * 30;
      const blockEnd   = end > start ? Math.ceil(end / 30) * 30 : blockStart + 30;
      for (let m = blockStart; m < blockEnd; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t)) {
          const key = `${ev.date}_${t}`;
          // 同ブロックに複数イベントがある場合は先着優先
          if (!calMap.has(key)) calMap.set(key, { title: ev.title });
        }
      }
    });

    // ④ インターバル不可ブロックを計算
    //   a) 予約終了後のバッファ（予約間インターバル）
    //   b) カレンダー予定の前後バッファ（calendarIntervalMobile）
    const intervalMin    = result.intervalMinutes        || 15;
    const calIntervalMin = result.calendarIntervalMobile || 90;
    const intervalSet    = new Set();

    // a) 予約後バッファ
    result.reservations.forEach(res => {
      const endMin    = timeToMin(res.endTime);
      const bufferEnd = endMin + intervalMin;
      for (let m = endMin; m < bufferEnd; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t)) intervalSet.add(`${res.date}_${t}`);
      }
    });

    // b) カレンダー予定の前後バッファ（予定ブロック自体は calMap が担当するので除く）
    (result.calendarEvents || []).forEach(ev => {
      const evStart = timeToMin(ev.startTime);
      const evEnd   = timeToMin(ev.endTime);
      // 前バッファ: [evStart - calIntervalMin, evStart)
      const preBufStart = evStart - calIntervalMin;
      for (let m = Math.floor(preBufStart / 30) * 30; m < evStart; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t) && !calMap.has(`${ev.date}_${t}`)) {
          intervalSet.add(`${ev.date}_${t}`);
        }
      }
      // 後バッファ: [evEnd, evEnd + calIntervalMin)
      const postBufEnd = evEnd + calIntervalMin;
      for (let m = evEnd; m < postBufEnd; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t) && !calMap.has(`${ev.date}_${t}`)) {
          intervalSet.add(`${ev.date}_${t}`);
        }
      }
    });

    state.gridData         = { openSet, resMap, calMap, intervalSet };
    state.gridOriginalOpen = new Set(openSet); // スナップショット保存

  } catch(err) {
    state.gridData = null;
    showToast('データの読み込みに失敗しました', true);
  }

  state.gridLoading = false;
  renderContent();

  // 今日の列までスクロール
  setTimeout(() => {
    const col = document.getElementById(`col-${todayStr()}`);
    if (col) col.scrollIntoView({ inline: 'start', behavior: 'smooth' });
  }, 100);
}

// 変更をまとめてGASに保存
async function handleSaveGrid() {
  if (state.gridSaving) return;
  const changes = getGridChanges();
  if (Object.keys(changes).length === 0) return;

  state.gridSaving = true;
  renderContent();

  try {
    const result = await apiPost({ action: 'saveGridSlots', changes });
    if (result.error) throw new Error(result.error);
    showToast('保存しました');
    // 保存済み状態を更新
    state.gridOriginalOpen = new Set(state.gridData.openSet);
  } catch(err) {
    showToast('保存に失敗しました: ' + err.message, true);
  }

  state.gridSaving = false;
  renderContent();
}

// ============================================================
// 予約データ読み込み（本日以降の全件）
// ============================================================
async function loadFutureReservations() {
  try {
    const result = await apiGet({ action: 'getFutureReservations' });
    state.futureReservations = Array.isArray(result) ? result : [];
  } catch(err) {
    state.futureReservations = [];
  }
  renderContent();
}

// ============================================================
// 初期化
// ============================================================
async function initApp() {
  renderLoading();
  try {
    await liff.init({ liffId: ADMIN_CONFIG.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login(); return; }

    const profile    = await liff.getProfile();
    state.lineUserId = profile.userId;

    const authResult = await apiGet({ action: 'checkOwner', lineUserId: state.lineUserId });
    if (!authResult.isOwner) { renderAuthError(); return; }

    const reservations = await apiGet({ action: 'getFutureReservations' });
    state.futureReservations = Array.isArray(reservations) ? reservations : [];
    state.phase = 'main';
    renderMain();

  } catch(err) {
    document.getElementById('app').innerHTML = `
      <div class="loading-screen">
        <div class="loading-logo">trunk</div>
        <p style="margin-top:24px;color:#EF5350;font-size:13px;">
          読み込みに失敗しました。<br>再度お試しください。<br><br>
          <small>${err.message}</small>
        </p>
      </div>`;
  }
}

initApp();
