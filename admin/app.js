/**
 * ============================================================
 * trunk 管理画面 - admin/app.js
 * ============================================================
 */

const ADMIN_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzbI4xCzAPOoZAMR06t5kKZAQuvu3EUF7pBNiqPDN7DIvvj38odiJfwLWGxB9jG_7lj1A/exec',
  LIFF_ID: '2009742884-8ACt2H8G',
};

// 06:00 〜 28:00 を30分刻みで生成
const TIME_OPTIONS = (() => {
  const options = [];
  for (let h = 6; h <= 28; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 28 && m > 0) break;
      options.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    }
  }
  return options;
})();

// ============================================================
// 状態管理
// ============================================================
const state = {
  phase: 'loading',
  tab: 'reservations',      // reservations | slots | slotStatus
  lineUserId: null,
  selectedDate: todayStr(),  // 予約タブで表示中の日付
  reservations: [],
  slots: [],
  // カレンダー
  calendarMonth: (() => {
    const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d;
  })(),
  monthSummary: {},  // { "2025-05-10": "open" | "reserved" } カレンダーマーカー用
  // スロット追加フォーム（スロット追加タブの選択日付）
  form: { date: '', startTime: '10:00', endTime: '12:00', note: '' },
  // スロット管理タブ：30分ブロックの開放状況
  dayStatus: [],
  originalDayStatus: [],  // サーバーから取得した元の状態（差分検出用）
  dayStatusLoading: false,
  savingSlots: false,
  // スロット編集
  editingSlotId: null,
  editForm: { startTime: '10:00', endTime: '12:00', note: '' },
};

// ============================================================
// 日付ユーティリティ
// ============================================================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const week = ['日','月','火','水','木','金','土'][d.getDay()];
  return `${d.getMonth()+1}月${d.getDate()}日（${week}）`;
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  return dateToStr(d);
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
// メイン画面（ヘッダー＋コンテンツ＋タブバー）
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
      <button class="admin-tab-btn ${state.tab==='reservations'?'active':''}" onclick="switchTab('reservations')">
        <span class="admin-tab-icon">📋</span>予約
      </button>
      <button class="admin-tab-btn ${state.tab==='slots'?'active':''}" onclick="switchTab('slots')">
        <span class="admin-tab-icon">➕</span>スロット追加
      </button>
      <button class="admin-tab-btn ${state.tab==='slotStatus'?'active':''}" onclick="switchTab('slotStatus')">
        <span class="admin-tab-icon">📅</span>枠の状況
      </button>
    </nav>`;
  renderContent();
}

function renderContent() {
  const el = document.getElementById('main-content');
  if (!el) return;
  if (state.tab === 'reservations')  el.innerHTML = renderReservationsTab();
  else if (state.tab === 'slots')    el.innerHTML = renderSlotsTab();
  else                               el.innerHTML = renderSlotStatusTab();
}

function switchTab(tab) {
  state.tab = tab;
  state.editingSlotId = null;
  renderMain();
  if (tab === 'slots') {
    loadSlots();
    loadMonthSummary(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1);
    // 日付選択済みの場合はブロックテーブルも再取得（枠の状況タブでの編集を反映）
    if (state.form.date) loadDayStatus(state.form.date);
  }
  if (tab === 'slotStatus') loadSlots();
}

// ============================================================
// カレンダーコンポーネント
// ============================================================
function changeCalendarMonth(delta) {
  const d = new Date(state.calendarMonth);
  d.setMonth(d.getMonth() + delta);
  state.calendarMonth = d;
  renderContent();
  loadMonthSummary(d.getFullYear(), d.getMonth() + 1);
}

async function loadMonthSummary(year, month) {
  try {
    const result = await apiGet({ action: 'getMonthSummary', year, month });
    if (result && typeof result === 'object' && !result.error) {
      state.monthSummary = result;
      renderContent();
    }
  } catch(err) {
    // サマリー取得失敗はマーカー非表示で無視
  }
}

function selectCalendarDate(dateStr) {
  state.form.date      = dateStr;
  state.dayStatus      = [];
  state.originalDayStatus = [];
  renderContent();
  loadDayStatus(dateStr);
}

function renderCalendar() {
  const year  = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);

  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let cells = '';
  for (let i = 0; i < firstDow; i++) {
    cells += `<div class="cal-cell"></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date    = new Date(year, month, d);
    const dateStr = dateToStr(date);
    const isPast  = date < today;
    const isSel   = state.form.date === dateStr;
    const isToday = dateStr === todayStr();
    const dow     = date.getDay();

    let cls = 'cal-cell cal-day';
    if (isPast)       cls += ' cal-past';
    else if (isSel)   cls += ' cal-selected';
    else if (isToday) cls += ' cal-today';

    let colorStyle = '';
    if (!isPast && !isSel) {
      if (dow === 0) colorStyle = 'style="color:#EF5350"';
      if (dow === 6) colorStyle = 'style="color:#1565C0"';
    }

    const onclick = isPast ? '' : `onclick="selectCalendarDate('${dateStr}')"`;

    // カレンダーマーカー（○=開放あり、予=予約あり、✕=全クローズ）
    const summary = state.monthSummary[dateStr];
    let markHtml = '';
    if (isPast) {
      markHtml = `<span class="cal-day-mark"></span>`;
    } else if (summary === 'reserved') {
      markHtml = `<span class="cal-day-mark reserved">予</span>`;
    } else if (summary === 'open') {
      markHtml = `<span class="cal-day-mark open">○</span>`;
    } else {
      markHtml = `<span class="cal-day-mark closed">✕</span>`;
    }

    cells += `<div class="${cls}" ${colorStyle} ${onclick}><span class="cal-day-num">${d}</span>${markHtml}</div>`;
  }

  return `
    <div class="calendar">
      <div class="cal-header">
        <button class="cal-nav-btn" onclick="changeCalendarMonth(-1)">‹</button>
        <span class="cal-month-label">${year}年${month+1}月</span>
        <button class="cal-nav-btn" onclick="changeCalendarMonth(1)">›</button>
      </div>
      <div class="cal-weekdays">
        <div class="cal-wd" style="color:#EF5350">日</div>
        <div class="cal-wd">月</div><div class="cal-wd">火</div>
        <div class="cal-wd">水</div><div class="cal-wd">木</div>
        <div class="cal-wd">金</div>
        <div class="cal-wd" style="color:#1565C0">土</div>
      </div>
      <div class="cal-grid">${cells}</div>
    </div>`;
}

// ============================================================
// 予約タブ
// ============================================================
function renderReservationsTab() {
  const dateLabel = formatDateLabel(state.selectedDate);

  let cards = '';
  if (state.reservations.length === 0) {
    cards = `<div class="empty-state">この日の予約はありません</div>`;
  } else {
    const sorted = [...state.reservations].sort((a,b) => a.startTime.localeCompare(b.startTime));
    cards = sorted.map(r => {
      const badgeClass = r.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';
      return `
        <div class="reservation-card">
          <div class="reservation-time">${r.startTime} 〜 ${r.endTime}</div>
          <div class="reservation-info">
            <span class="service-badge ${badgeClass}">${r.serviceType}</span>
            <span class="reservation-name">${r.customerName}</span>
          </div>
          <div class="reservation-menu">${r.menuName}（${r.duration}分）</div>
          ${r.address ? `<div class="reservation-menu" style="margin-top:4px;">📍 ${r.address}</div>` : ''}
        </div>`;
    }).join('');
  }

  return `
    <div class="date-nav">
      <button class="date-nav-btn" onclick="changeDate(-1)">‹</button>
      <span class="date-nav-label">${dateLabel}</span>
      <button class="date-nav-btn" onclick="changeDate(1)">›</button>
    </div>
    <div class="reservation-list">${cards}</div>`;
}

function changeDate(days) {
  state.selectedDate = shiftDate(state.selectedDate, days);
  loadReservations();
}

// ============================================================
// スロット管理タブ（カレンダー＋開放状況テーブル）
// ============================================================
// ローカル変更があるか判定
function isDirty() {
  if (!state.originalDayStatus.length) return false;
  return state.dayStatus.some((b, i) => {
    const orig = state.originalDayStatus[i];
    return orig && b.isOpen !== orig.isOpen;
  });
}

function renderSlotsTab() {
  let tableHtml = '';
  let saveBarHtml = '';

  if (!state.form.date) {
    tableHtml = `<div class="empty-state" style="padding:20px 0;">カレンダーから日付を選んでください</div>`;
  } else if (state.dayStatusLoading) {
    tableHtml = `<div class="empty-state" style="padding:32px 0;">
      <div class="spinner" style="margin:0 auto 12px;width:28px;height:28px;border-width:3px;"></div>
      読み込み中...
    </div>`;
  } else if (state.dayStatus.length === 0) {
    tableHtml = `<div class="empty-state">データを読み込めませんでした</div>`;
  } else {
    const rows = state.dayStatus.map(block => {
      const statusClass = block.isOpen ? 'open' : 'closed';
      const statusIcon  = block.isOpen ? '○' : '✕';

      let infoText  = '';
      let infoClass = '';
      if (block.reservation) {
        infoText  = `📌 ${block.reservation.customerName}・${block.reservation.menuName}`;
        infoClass = 'reserved';
      } else if (block.isOpen) {
        infoText = '予約なし';
      }

      const onclick = block.reservation
        ? `onclick="showToast('この時間帯には予約があります', true)"`
        : `onclick="localToggleSlot('${block.time}')"`;

      return `
        <div class="slot-row ${statusClass}" ${onclick}>
          <span class="slot-row-time">${block.time}</span>
          <span class="slot-row-status ${statusClass}">${statusIcon}</span>
          <span class="slot-row-info ${infoClass}">${infoText}</span>
        </div>`;
    }).join('');

    tableHtml = `<div class="slot-table">${rows}</div>`;

    // 変更がある場合のみ保存バーを表示
    if (isDirty()) {
      saveBarHtml = `
        <div class="slot-save-bar">
          <button class="btn btn-primary" style="width:100%;"
                  onclick="handleSaveDaySlots()" ${state.savingSlots ? 'disabled' : ''}>
            ${state.savingSlots ? '保存中...' : '変更を保存する'}
          </button>
        </div>`;
    }
  }

  const headerHtml = state.form.date
    ? `<div class="slot-table-header">▼ ${formatDateLabel(state.form.date)}の開放状況（タップで切り替え）</div>`
    : '';

  return `
    <div style="padding:12px 16px 0;">
      ${renderCalendar()}
    </div>
    ${headerHtml}
    ${tableHtml}
    ${saveBarHtml}`;
}

async function loadDayStatus(dateStr) {
  state.dayStatusLoading = true;
  renderContent();
  try {
    const result = await apiGet({ action: 'getDayStatus', date: dateStr });
    const blocks = Array.isArray(result) ? result : [];
    state.dayStatus         = blocks;
    state.originalDayStatus = blocks.map(b => ({ ...b })); // ディープコピー
  } catch(err) {
    state.dayStatus         = [];
    state.originalDayStatus = [];
  }
  state.dayStatusLoading = false;
  renderContent();
}

// ローカルのみのトグル（API呼び出しなし）
function localToggleSlot(time) {
  const block = state.dayStatus.find(b => b.time === time);
  if (block) {
    block.isOpen = !block.isOpen;
    renderContent();
  }
}

// 変更を一括保存
async function handleSaveDaySlots() {
  if (state.savingSlots) return;
  state.savingSlots = true;
  renderContent();

  const openTimes = state.dayStatus.filter(b => b.isOpen).map(b => b.time);

  try {
    const result = await apiPost({
      action: 'saveDaySlots',
      date: state.form.date,
      openTimes,
    });
    if (result.error) throw new Error(result.error);
    showToast('保存しました');
    // 保存後はサーバーから再取得して originalDayStatus とカレンダーマーカーを更新
    await Promise.all([
      loadDayStatus(state.form.date),
      loadMonthSummary(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1),
    ]);
  } catch(err) {
    showToast('保存に失敗しました: ' + err.message, true);
  }
  state.savingSlots = false;
  renderContent();
}

// ============================================================
// 枠の状況タブ（一覧・編集・削除）
// ============================================================
function renderSlotStatusTab() {
  if (state.slots.length === 0) {
    return `<div class="empty-state" style="padding-top:60px;">登録済みの受付スロットはありません</div>`;
  }

  const groups = {};
  state.slots.forEach(s => {
    if (!groups[s.date]) groups[s.date] = [];
    groups[s.date].push(s);
  });

  const timeOpts = (selected) =>
    TIME_OPTIONS.map(t =>
      `<option value="${t}" ${t===selected?'selected':''}>${t}</option>`
    ).join('');

  const html = Object.entries(groups).map(([date, slots]) => {
    const items = slots.map(s => {
      // 編集中
      if (state.editingSlotId === s.slotId) {
        return `
          <div class="slot-item slot-item-editing">
            <div class="time-grid" style="width:100%;">
              <div class="form-group" style="margin:0;">
                <label class="form-label">開始時間</label>
                <select class="form-input" onchange="state.editForm.startTime=this.value">
                  ${timeOpts(state.editForm.startTime)}
                </select>
              </div>
              <div class="form-group" style="margin:0;">
                <label class="form-label">終了時間</label>
                <select class="form-input" onchange="state.editForm.endTime=this.value">
                  ${timeOpts(state.editForm.endTime)}
                </select>
              </div>
            </div>
            <input type="text" class="form-input" placeholder="備考（任意）"
                   value="${state.editForm.note}"
                   oninput="state.editForm.note=this.value"
                   style="margin-top:10px;">
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button class="btn btn-primary" style="flex:1;padding:9px 0;font-size:13px;"
                      onclick="handleUpdateSlot('${s.slotId}')">保存</button>
              <button class="btn btn-secondary" style="flex:1;padding:9px 0;font-size:13px;"
                      onclick="cancelEditSlot()">キャンセル</button>
            </div>
          </div>`;
      }
      // 通常表示
      return `
        <div class="slot-item">
          <div>
            <div class="slot-time">${s.startTime} 〜 ${s.endTime}</div>
            ${s.note ? `<div class="slot-note">${s.note}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;">
            <button class="slot-edit-btn" onclick="startEditSlot('${s.slotId}')">編集</button>
            <button class="slot-delete-btn" onclick="handleDeleteSlot('${s.slotId}')">削除</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="slot-group">
        <div class="slot-group-date">${formatDateLabel(date)}</div>
        ${items}
      </div>`;
  }).join('');

  return `<div class="slot-list">${html}</div>`;
}

function startEditSlot(slotId) {
  const slot = state.slots.find(s => s.slotId === slotId);
  if (!slot) return;
  state.editingSlotId = slotId;
  state.editForm = { startTime: slot.startTime, endTime: slot.endTime, note: slot.note || '' };
  renderContent();
}

function cancelEditSlot() {
  state.editingSlotId = null;
  renderContent();
}

async function handleUpdateSlot(slotId) {
  const { startTime, endTime, note } = state.editForm;
  if (startTime >= endTime) { showToast('終了時間は開始時間より後にしてください', true); return; }

  try {
    const result = await apiPost({ action:'updateSlot', slotId, startTime, endTime, note });
    if (result.error) throw new Error(result.error);
    showToast('更新しました');
    state.editingSlotId = null;
    await loadSlots();
    loadMonthSummary(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1);
    // スロット追加タブで表示中の日付があれば再取得
    if (state.form.date) loadDayStatus(state.form.date);
  } catch(err) {
    showToast('更新に失敗しました: ' + err.message, true);
  }
}

async function handleDeleteSlot(slotId) {
  if (!confirm('このスロットを削除しますか？')) return;
  try {
    const result = await apiPost({ action:'deleteSlot', slotId });
    if (result.error) throw new Error(result.error);
    showToast('削除しました');
    await loadSlots();
    loadMonthSummary(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1);
    // スロット追加タブで表示中の日付があれば再取得
    if (state.form.date) loadDayStatus(state.form.date);
  } catch(err) {
    showToast('削除に失敗しました: ' + err.message, true);
  }
}

// ============================================================
// データ読み込み
// ============================================================
async function loadReservations() {
  try {
    const result = await apiGet({ action:'getReservations', date: state.selectedDate });
    state.reservations = Array.isArray(result) ? result : [];
  } catch(err) {
    state.reservations = [];
  }
  renderContent();
}

async function loadSlots() {
  try {
    const result = await apiGet({ action:'getSlotsList' });
    state.slots = Array.isArray(result) ? result : [];
  } catch(err) {
    state.slots = [];
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

    const profile = await liff.getProfile();
    state.lineUserId = profile.userId;

    const authResult = await apiGet({ action:'checkOwner', lineUserId: state.lineUserId });
    if (!authResult.isOwner) { renderAuthError(); return; }

    const reservations = await apiGet({ action:'getReservations', date: state.selectedDate });
    state.reservations = Array.isArray(reservations) ? reservations : [];
    state.phase = 'main';
    renderMain();
    // バックグラウンドでカレンダーマーカーを読み込む
    loadMonthSummary(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1);
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
