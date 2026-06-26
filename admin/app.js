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
  for (let m = 10 * 60; m < 27 * 60; m += 30) times.push(minutesToTimeStr(m));
  return times;
})();

// ============================================================
// 予約変更フォームの一時状態
// ============================================================
// _reschedule: null のとき非アクティブ
// アクティブ時は予約変更グリッド画面を表示する
let _reschedule = null;

function _defaultReschedule(r) {
  return {
    reservationId:    r.reservationId,
    serviceType:      r.serviceType,
    duration:         r.duration,
    customerName:     r.customerName,
    menuName:         r.menuName,
    currentDate:      r.date,
    currentStartTime: r.startTime,
    currentEndTime:   r.endTime,
    step:             'grid',  // 'grid' | 'confirm'
    // グリッド状態
    gridStartDate:    todayStr(),
    gridAvailability: null,
    gridDetailData:   null,
    gridLoading:      false,
    gridCacheKey:     '',
    selectedDate:     '',
    selectedStartTime: null,
    submitting:       false,
  };
}

// ============================================================
// 代理予約 — マスタデータ
// ============================================================
const VISIT_COURSES = [
  { name: '矯正＋オイル', duration: 100 },
  { name: '矯正＋オイル', duration: 130 },
];
const VISIT_OPTIONS = [
  { name: 'オプションなし', duration: 0  },
  { name: 'ヘッド',         duration: 30 },
  { name: 'フット',         duration: 30 },
  { name: '腸モミ',         duration: 30 },
];
const MOBILE_DURATIONS = [60, 90, 120, 150, 180];
const BK_GRID_DAYS = 14;

// 出張コース名リスト（設定取得後に上書き）
let _bkMobileCourses = ['もみほぐし', 'オイルトリートメント', 'もみほぐし＋オイルトリートメント'];

// ============================================================
// 代理予約フォームの状態
// step: 'info' | 'grid' | 'confirm' | 'success'
// ============================================================
function _defaultBkForm() {
  return {
    step:         'info',
    serviceType:  null,        // '来店' | '出張'
    // 顧客情報
    customerName: '',
    phone:        '',
    address:      '',
    // 来店
    courseIdx:    null,        // index into VISIT_COURSES
    options:      [],          // 選択中オプション名の配列
    // 出張
    mobileCourse: null,        // string
    duration:     null,        // number（分）
    // グリッド（page2）
    gridStartDate:     '',
    gridAvailability:  null,   // { date: [times] | null }
    gridDetailData:    null,   // { resMap, calMap, intervalSet } — 表示用詳細
    gridLoading:       false,
    gridCacheKey:      '',
    selectedDate:      '',
    selectedStartTime: null,
    // submit
    submitting:   false,
    successInfo:  null,
  };
}
let _bkForm = _defaultBkForm();

// ============================================================
// 状態管理
// ============================================================
// 定休日リスト（getGridData / getSettings から取得後にセット）
let _holidays = [];
// 定休日例外解放リスト（来店・出張で分離）
let _holidayOverridesVisit  = [];
let _holidayOverridesMobile = [];

// 日付文字列が定休日かどうかを判定（現在のgridServiceTypeを参照）
function _isHoliday(dateStr) {
  const overrides = state.gridServiceType === '来店' ? _holidayOverridesVisit : _holidayOverridesMobile;
  if (overrides.includes(dateStr)) return false;
  const d   = new Date(dateStr + 'T00:00:00+09:00');
  const dow = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'][d.getDay()];
  return _holidays.includes(dow) || _holidays.includes(dateStr);
}

const state = {
  phase: 'loading',
  tab: 'reservations',   // 'reservations' | 'grid' | 'booking' | 'customers'
  lineUserId: null,
  // 予約タブ
  futureReservations: [],
  // グリッドタブ
  gridData: null,           // { openSet, resMap, calMap, intervalSet }
  gridOriginalOpen: null,   // Set<"date_time"> — 出張保存済み状態
  visitBlockSet: null,      // Set<"date_time"> — 来店ブロック
  gridOriginalBlock: null,  // Set<"date_time"> — 来店ブロック保存済み状態
  gridServiceType: '出張',  // '来店' | '出張'
  gridTabStartDate: null,   // null = today（遅延初期化）
  gridLoading: false,
  gridSaving: false,
  // 顧客カルテタブ
  customerList: [],
  customerLoading: false,
  customerSearch: '',
  selectedCustomer: null,          // { customer, history }
  selectedCustomerLoading: false,
  karteSaving: {},                 // { karteId: 'saving'|'saved'|null }
  customerEditMode: false,
  customerSaving: false,
  // 売上タブ
  sales: {
    year:           new Date().getFullYear(),
    monthlySummary: null,  // { year, months: [{month,count,total,visitTotal,mobileTotal,missingCount}] }
    selectedMonth:  null,  // 'yyyy-MM'。null の場合は現在月を初期選択
    monthDetail:    null,  // { menuBreakdown, serviceTypeBreakdown, listData }
    loading:        false,
    monthLoading:   false,
  },
};

// カタカナ→ひらがな変換（検索正規化用）
function _toHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

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
// 00:00〜02:59 に開始する予約は前日の24:xx〜26:xx としてグリッドに配置する
// （例: 2026-06-08 01:00〜02:00 → 2026-06-07 25:00〜26:00）
function _normalizeMidnightRes(res) {
  if (timeToMin(res.startTime) >= 3 * 60) return res;
  const startMin = timeToMin(res.startTime) + 24 * 60;
  const endMin   = timeToMin(res.endTime)   + 24 * 60;
  return { ...res, date: shiftDate(res.date, -1), startTime: minutesToTimeStr(startMin), endTime: minutesToTimeStr(endMin) };
}
// gridTabStartDate から31日分の日付配列
function getGridDates() {
  const start = state.gridTabStartDate || todayStr();
  const d0    = new Date(start + 'T00:00:00+09:00');
  const dates = [];
  for (let i = 0; i < 31; i++) {
    const d = new Date(d0);
    d.setDate(d0.getDate() + i);
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
  if (!res.ok) throw new Error('通信エラー (HTTP ' + res.status + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
async function apiPost(body) {
  const res = await fetch(ADMIN_CONFIG.GAS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error('通信エラー (HTTP ' + res.status + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
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
  reservation: `<svg class="admin-tab-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/>
    <line x1="8" y1="17" x2="14" y2="17"/>
  </svg>`,
  grid: `<svg class="admin-tab-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/>
    <line x1="9" y1="3" x2="9" y2="21"/>
  </svg>`,
  booking: `<svg class="admin-tab-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
    <line x1="12" y1="14" x2="12" y2="18"/>
    <line x1="10" y1="16" x2="14" y2="16"/>
  </svg>`,
  customers: `<svg class="admin-tab-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87"/>
    <path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>`,
  sales: `<svg class="admin-tab-icon" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="20" x2="12" y2="10"/>
    <line x1="18" y1="20" x2="18" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="16"/>
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
        ${ICONS.grid}枠の管理
      </button>
      <button class="admin-tab-btn ${state.tab === 'booking' ? 'active' : ''}"
              onclick="switchTab('booking')">
        ${ICONS.booking}代理予約
      </button>
      <button class="admin-tab-btn ${state.tab === 'customers' ? 'active' : ''}"
              onclick="switchTab('customers')">
        ${ICONS.customers}顧客
      </button>
      <button class="admin-tab-btn ${state.tab === 'sales' ? 'active' : ''}"
              onclick="switchTab('sales')">
        ${ICONS.sales}売上
      </button>
    </nav>`;
  renderContent();
}

function renderContent() {
  const el = document.getElementById('main-content');
  if (!el) return;
  if      (_reschedule)                  el.innerHTML = renderRescheduleGrid();
  else if (state.tab === 'reservations') el.innerHTML = renderReservationsTab();
  else if (state.tab === 'grid')         el.innerHTML = renderGridTab();
  else if (state.tab === 'customers')    el.innerHTML = renderCustomersTab();
  else if (state.tab === 'sales')        el.innerHTML = renderSalesTab();
  else                                   el.innerHTML = renderBookingTab();
  if (!_reschedule && state.tab === 'sales') _renderSalesCharts();
}

function switchTab(tab) {
  state.tab = tab;
  state.selectedCustomer = null;
  state.customerSearch   = '';
  renderMain();
  if      (tab === 'grid' && !state.gridData) loadGridData();
  else if (tab === 'grid')         renderContent();
  else if (tab === 'reservations') loadFutureReservations();
  else if (tab === 'booking')      loadBookingMenus();
  else if (tab === 'customers')    loadCustomerList();
  else if (tab === 'sales')        loadSalesYear(state.sales.year);
}

function refreshCurrentTab() {
  if (state.tab === 'reservations') {
    loadFutureReservations();
  } else if (state.tab === 'grid') {
    state.gridData          = null;
    state.visitBlockSet     = null;
    state.gridOriginalOpen  = null;
    state.gridOriginalBlock = null;
    loadGridData();
  } else if (state.tab === 'customers') {
    state.selectedCustomer = null;
    state.customerLoading  = false;
    loadCustomerList();
  } else if (state.tab === 'sales') {
    loadSalesYear(state.sales.year);
  }
}

// ============================================================
// 予約タブ
// ============================================================
function renderReservationsTab() {
  const header = `<div class="tab-header"><span class="tab-header-title">予約</span><button class="refresh-btn" onclick="refreshCurrentTab()">↻ 更新</button></div>`;
  if (state.futureReservations.length === 0) {
    return header + `<div class="empty-state">今後の予約はありません</div>`;
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
      const isWeb       = r.source === 'WEB';
      const isCal       = r.source === 'CALENDAR';
      const badgeClass  = r.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';
      return `
        <div class="reservation-card tappable${isCancelled ? ' cancelled' : ''}"
             onclick="openReservationDetail('${r.reservationId}')">
          <div class="reservation-time">${r.startTime} 〜 ${r.endTime}</div>
          <div class="reservation-info">
            <span class="service-badge ${badgeClass}">${r.serviceType}</span>
            ${isWeb ? '<span class="service-badge badge-web">WEB</span>' : ''}
            ${isCal ? '<span class="service-badge badge-cal">CAL</span>' : ''}
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

  return header + `<div class="reservation-list">${sections}</div>`;
}

// ============================================================
// 予約詳細モーダル
// ============================================================
function openReservationDetail(reservationId) {
  const r = state.futureReservations.find(x => x.reservationId === reservationId);
  if (!r) return;

  const isCancelled = r.status === 'cancelled';
  const isWeb       = r.source === 'WEB';
  const isCal       = r.source === 'CALENDAR';
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
          <span class="detail-value"><span class="service-badge ${badgeClass}">${r.serviceType}</span>${isWeb ? ' <span class="service-badge badge-web">WEB</span>' : ''}${isCal ? ' <span class="service-badge badge-cal">CAL</span>' : ''}</span>
        </div>
        ${r.address ? `
        <div class="detail-row">
          <span class="detail-label">住所</span>
          <span class="detail-value">${r.address}</span>
        </div>` : ''}
      </div>
      ${!isCancelled ? `
      <div class="modal-footer" id="modal-footer">
        <button class="btn-reschedule-reservation" onclick="showRescheduleForm('${r.reservationId}')">
          日時を変更する
        </button>
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
// 予約日時変更フォーム
// ============================================================
// 予約変更ボタン → モーダルを閉じてグリッド画面へ
function showRescheduleForm(reservationId) {
  const r = state.futureReservations.find(x => x.reservationId === reservationId);
  if (!r) return;
  _reschedule = _defaultReschedule(r);
  closeReservationDetail();
  renderContent();
  _loadRsGrid();
}

// 予約変更グリッド画面を描画（step に応じてディスパッチ）
function renderRescheduleGrid() {
  if (_reschedule.step === 'confirm') return _renderRsConfirm();

  const rs    = _reschedule;
  const today = todayStr();
  const start = rs.gridStartDate || today;
  const startMs = new Date(start + 'T00:00:00+09:00').getTime();
  const dates = [];
  for (let i = 0; i < BK_GRID_DAYS; i++)
    dates.push(dateToStr(new Date(startMs + i * 86400000)));

  // ヘッダー：変更前の予約情報
  const currentInfo = `
    <div class="rs-header">
      <button class="btn-back-reschedule" onclick="cancelReschedule()">← 戻る</button>
      <div class="rs-current">
        <span class="rs-current-label">変更前</span>
        <span class="rs-current-val">${formatDateLabel(rs.currentDate)}&nbsp;${rs.currentStartTime}〜${rs.currentEndTime}</span>
      </div>
      <div class="rs-current">
        <span class="rs-current-label">お客様</span>
        <span class="rs-current-val">${_bkEsc(rs.customerName)}（${rs.duration}分）</span>
      </div>
    </div>`;

  let gridHtml;
  if (rs.gridLoading || !rs.gridAvailability) {
    gridHtml = `<div class="bk-grid-loading"><div class="spinner"></div><span>空き枠を確認中...</span></div>`;
  } else {
    const avail       = rs.gridAvailability;
    const detail      = rs.gridDetailData;
    const selectedKey = rs.selectedDate && rs.selectedStartTime
      ? `${rs.selectedDate}_${rs.selectedStartTime}` : null;

    const hasAnyAvail = dates.some(d => Array.isArray(avail[d]) && avail[d].length > 0);

    let visibleTimes;
    if (hasAnyAvail) {
      const allAvailSet = new Set();
      dates.forEach(d => { if (Array.isArray(avail[d])) avail[d].forEach(t => allAvailSet.add(t)); });
      const minIdx = GRID_TIMES.findIndex(t => allAvailSet.has(t));
      const maxIdx = GRID_TIMES.reduce((acc, t, i) => allAvailSet.has(t) ? i : acc, minIdx);
      visibleTimes = GRID_TIMES.slice(Math.max(0, minIdx - 1), maxIdx + 2);
    } else {
      visibleTimes = GRID_TIMES;
    }

    const noAvailNotice = hasAnyAvail ? '' :
      `<p class="bk-no-avail">予約可能な時間帯がありません。</p>`;

    const headerCells = dates.map(date => {
      const d   = new Date(date + 'T00:00:00+09:00');
      const dow = d.getDay();
      const wk  = ['日','月','火','水','木','金','土'][dow];
      const m   = d.getMonth() + 1;
      const day = d.getDate();
      if (_isHoliday(date)) return `<th class="bk-cg-th bk-cg-holiday">${m}/${day}<br><span class="bk-cg-dow">${wk}</span></th>`;
      let cls = 'bk-cg-th';
      if (date === today)  cls += ' bk-cg-today';
      else if (dow === 0)  cls += ' bk-cg-sun';
      else if (dow === 6)  cls += ' bk-cg-sat';
      return `<th class="${cls}">${m}/${day}<br><span class="bk-cg-dow">${wk}</span></th>`;
    }).join('');

    const numRows = visibleTimes.length;
    const bodyRows = visibleTimes.map((time, rowIdx) => {
      const cells = dates.map(date => {
        if (_isHoliday(date)) {
          return rowIdx === 0
            ? `<td class="bk-cg-cell bk-cg-holiday-col" rowspan="${numRows}"><span class="grid-holiday-text">定休日</span></td>`
            : '';
        }
        const key     = `${date}_${time}`;
        const isAvail = Array.isArray(avail[date]) && avail[date].includes(time);
        const isSel   = key === selectedKey;
        if (isSel) return `<td class="bk-cg-cell bk-cg-sel" id="rscg-${key}" onclick="rsSelectSlot('${date}','${time}')">○</td>`;
        if (isAvail) return `<td class="bk-cg-cell bk-cg-open" id="rscg-${key}" onclick="rsSelectSlot('${date}','${time}')">○</td>`;
        if (detail) {
          const res = detail.resMap.get(key);
          if (res) {
            const tc = res.serviceType === '出張' ? 'dot-mobile' : 'dot-visit';
            return `<td class="bk-cg-cell bk-cg-reserved"><div class="cell-res-inner"><span class="cell-name">${_bkEsc(res.customerName)}</span><span class="cell-type-tag ${tc}">${res.serviceType}</span></div></td>`;
          }
          const cal = detail.calMap.get(key);
          if (cal) {
            const calCls = cal.source === 'reservation_calendar' ? 'bk-cg-cal-direct' : 'bk-cg-cal';
            return `<td class="bk-cg-cell ${calCls}"><div class="cell-cal-inner">${_bkEsc(cal.title.length > 5 ? cal.title.slice(0,5)+'…' : cal.title)}</div></td>`;
          }
          if (detail.intervalSet.has(key)) return `<td class="bk-cg-cell bk-cg-interval"><span class="cell-interval-label">準備</span></td>`;
        }
        return `<td class="bk-cg-cell bk-cg-closed">−</td>`;
      }).join('');
      return `<tr><td class="bk-cg-time">${time}</td>${cells}</tr>`;
    }).join('');

    const prevDate     = dateToStr(new Date(startMs - BK_GRID_DAYS * 86400000));
    const prevDisabled = prevDate < today;
    const nav = `
      <div class="bk-cg-nav">
        <button class="bk-cg-nav-btn" onclick="rsChangeGrid(-${BK_GRID_DAYS})"
                ${prevDisabled ? 'disabled' : ''}>‹ 前の${BK_GRID_DAYS}日</button>
        <button class="bk-cg-nav-btn" onclick="rsChangeGrid(${BK_GRID_DAYS})">次の${BK_GRID_DAYS}日 ›</button>
      </div>`;

    const selBanner = (rs.selectedDate && rs.selectedStartTime) ? `
      <div class="bk-cg-banner">
        ${formatDateLabel(rs.selectedDate)}&nbsp;
        ${rs.selectedStartTime}〜${minutesToTimeStr(timeToMin(rs.selectedStartTime) + rs.duration)}
      </div>` : '';

    gridHtml = `
      ${nav}
      ${noAvailNotice}
      ${selBanner}
      <div class="bk-cg-scroll">
        <table class="bk-cg-table">
          <thead><tr><th class="bk-cg-corner">時間</th>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
  }

  const canConfirm = !!(rs.selectedDate && rs.selectedStartTime);
  const endTime    = canConfirm ? minutesToTimeStr(timeToMin(rs.selectedStartTime) + rs.duration) : '';

  return `
    <div class="bk-scroll">
      ${currentInfo}
      ${gridHtml}
      <div class="bk-grid-footer" style="margin-top:12px;">
        <button class="bk-btn-secondary" style="width:auto;padding:14px 18px;"
                onclick="rsGoBack()">← 戻る</button>
        <button class="bk-submit-btn bk-submit-inline" id="rs-confirm-btn"
                ${canConfirm ? '' : 'disabled'}
                onclick="rsGoToConfirm()">
          ${canConfirm ? '確認へ →' : '日時を選んでください'}
        </button>
      </div>
    </div>`;
}

// グリッドデータ取得
async function _loadRsGrid() {
  const rs = _reschedule;
  if (!rs) return;
  const cacheKey = `${rs.serviceType}-${rs.duration}-${rs.gridStartDate}`;
  if (rs.gridCacheKey === cacheKey && rs.gridAvailability) return;
  if (rs.gridLoading) return;
  rs.gridLoading = true;
  renderContent();
  try {
    const [availResult, detailResult] = await Promise.all([
      apiGet({ action: 'getAvailableGrid', startDate: rs.gridStartDate, days: BK_GRID_DAYS, duration: rs.duration, serviceType: rs.serviceType }),
      apiGet({ action: 'getGridData', startDate: rs.gridStartDate, days: BK_GRID_DAYS }),
    ]);
    rs.gridAvailability = availResult;
    rs.gridDetailData   = _parseBkGridDetail(detailResult);
    rs.gridCacheKey     = cacheKey;
  } catch(e) {
    rs.gridAvailability = {};
    rs.gridDetailData   = null;
  }
  rs.gridLoading = false;
  renderContent();
}

// 前後ナビゲーション
function rsChangeGrid(delta) {
  const rs = _reschedule;
  if (!rs) return;
  const today = todayStr();
  const d = new Date((rs.gridStartDate || today) + 'T00:00:00+09:00');
  d.setDate(d.getDate() + delta);
  const next = dateToStr(d);
  rs.gridStartDate    = next < today ? today : next;
  rs.gridAvailability = null;
  rs.gridDetailData   = null;
  rs.gridCacheKey     = '';
  rs.selectedDate     = '';
  rs.selectedStartTime = null;
  renderContent();
  _loadRsGrid();
}

// スロット選択（DOM外科更新）
function rsSelectSlot(date, time) {
  const rs = _reschedule;
  if (!rs) return;
  rs.selectedDate      = date;
  rs.selectedStartTime = time;

  document.querySelectorAll('.bk-cg-cell.bk-cg-open, .bk-cg-cell.bk-cg-sel').forEach(el => {
    el.className = el.className.replace('bk-cg-sel', 'bk-cg-open');
  });
  const el = document.getElementById(`rscg-${date}_${time}`);
  if (el) el.className = el.className.replace('bk-cg-open', 'bk-cg-sel');

  // バナーと確定ボタンを更新
  const endTime = minutesToTimeStr(timeToMin(time) + rs.duration);
  const bannerHtml = `${formatDateLabel(date)}&nbsp;${time}〜${endTime}`;
  const existing = document.querySelector('.bk-cg-banner');
  if (existing) {
    existing.innerHTML = bannerHtml;
  } else {
    const nav = document.querySelector('.bk-cg-nav');
    if (nav) {
      const b = document.createElement('div');
      b.className = 'bk-cg-banner';
      b.innerHTML = bannerHtml;
      nav.insertAdjacentElement('afterend', b);
    }
  }
  const btn = document.getElementById('rs-confirm-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = `${formatDateLabel(date)} ${time}〜${endTime} に変更する`;
  }
}

// グリッドで選択後 → 確認画面へ
function rsGoToConfirm() {
  if (!_reschedule.selectedDate || !_reschedule.selectedStartTime) return;
  _reschedule.step = 'confirm';
  renderContent();
}

// 確認画面の描画
function _renderRsConfirm() {
  const rs      = _reschedule;
  const newEnd  = minutesToTimeStr(timeToMin(rs.selectedStartTime) + rs.duration);
  const badgeCls = rs.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';

  return `
    <div class="bk-scroll">
      <div class="rs-header">
        <div class="rs-current">
          <span class="rs-current-label">お客様</span>
          <span class="rs-current-val">${_bkEsc(rs.customerName)}　<span class="service-badge ${badgeCls}">${rs.serviceType}</span></span>
        </div>
        <div class="rs-current">
          <span class="rs-current-label">コース</span>
          <span class="rs-current-val">${_bkEsc(rs.menuName)}（${rs.duration}分）</span>
        </div>
      </div>

      <div class="bk-success-detail">
        <div class="bk-success-row">
          <span class="bk-success-label">変更前</span>
          <span style="color:var(--text-secondary);text-decoration:line-through;">
            ${formatDateLabel(rs.currentDate)}<br>${rs.currentStartTime}〜${rs.currentEndTime}
          </span>
        </div>
        <div class="bk-success-row">
          <span class="bk-success-label">変更後</span>
          <span style="font-weight:600;">
            ${formatDateLabel(rs.selectedDate)}<br>${rs.selectedStartTime}〜${newEnd}
          </span>
        </div>
      </div>

      <p style="font-size:12px;color:var(--text-secondary);margin:12px 0 0;text-align:center;">
        変更確定後、お客様にLINE通知が届きます
      </p>

      <div class="bk-grid-footer" style="margin-top:16px;">
        <button class="bk-btn-secondary" style="width:auto;padding:14px 18px;"
                onclick="rsGoBack()">← 戻る</button>
        <button class="bk-submit-btn bk-submit-inline" id="rs-confirm-btn"
                ${rs.submitting ? 'disabled' : ''}
                onclick="handleAdminReschedule()">
          ${rs.submitting ? '変更中...' : 'この日時に変更する'}
        </button>
      </div>
    </div>`;
}

// 戻る（確認 → グリッド、グリッド → 予約一覧）
function rsGoBack() {
  if (_reschedule.step === 'confirm') {
    _reschedule.step = 'grid';
    renderContent();
  } else {
    cancelReschedule();
  }
}

// 確定
async function handleAdminReschedule() {
  const rs = _reschedule;
  if (!rs || !rs.selectedDate || !rs.selectedStartTime) return;
  rs.submitting = true;
  const btn = document.getElementById('rs-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = '変更中...'; }
  try {
    const result = await apiPost({
      action:        'adminUpdateReservation',
      reservationId: rs.reservationId,
      newDate:       rs.selectedDate,
      newStartTime:  rs.selectedStartTime,
    });
    if (result.error) throw new Error(result.error);
    const r = state.futureReservations.find(x => x.reservationId === rs.reservationId);
    if (r) {
      r.date      = rs.selectedDate;
      r.startTime = rs.selectedStartTime;
      r.endTime   = result.newEndTime || minutesToTimeStr(timeToMin(rs.selectedStartTime) + rs.duration);
    }
    _reschedule = null;
    showToast('予約の日時を変更しました');
    renderContent();
  } catch(err) {
    rs.submitting = false;
    showToast('変更に失敗しました: ' + err.message, true);
    renderContent();
  }
}

// キャンセル → 予約一覧に戻る
function cancelReschedule() {
  _reschedule = null;
  renderContent();
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
    const isHol = _isHoliday(date);
    let cls = 'grid-date-th';
    if (isHol)          cls += ' grid-holiday-th';
    else if (date === today) cls += ' today-col';
    else if (dow === 0)      cls += ' sun';
    else if (dow === 6)      cls += ' sat';
    const allOpen  = _isDayAllOpen(date);
    const bulkLabel = allOpen ? '全×' : '全○';
    const bulkTitle = allOpen ? '全クローズ' : '全開放';
    const bulkBtn  = `<button class="grid-bulk-btn${allOpen ? ' all-open' : ''}" id="bulk-btn-${date}" onclick="bulkToggleDay('${date}')" title="${bulkTitle}">${bulkLabel}</button>`;
    const _curOverrides = state.gridServiceType === '来店' ? _holidayOverridesVisit : _holidayOverridesMobile;
    const isOverridden = _curOverrides.includes(date);
    const holidayBadge = (isHol || isOverridden)
      ? `<button class="grid-holiday-badge${isOverridden ? ' active' : ''}" id="override-btn-${date}" onclick="handleToggleHolidayOverride('${date}')" title="${isOverridden ? 'クリックで解放を解除' : 'クリックで顧客に解放'}">${isOverridden ? '解放中' : '定休'}</button>`
      : '';
    return `<th class="${cls}" id="col-${date}">${m}/${day}<br><span style="font-weight:400;font-size:10px;">${wk}</span>${holidayBadge}${bulkBtn}</th>`;
  }).join('');

  const { calMap, intervalSet } = state.gridData;
  const numRows = GRID_TIMES.length;
  const _isVisit = state.gridServiceType === '来店';

  // スパン情報を事前計算（rowspan 用）
  const { resSpanStart, resSkipSet, calSpanStart, calSkipSet } = buildSpanMaps(dates, resMap, calMap);

  // ボディ行
  const bodyRows = GRID_TIMES.map((time) => {
    const cells = dates.map(date => {
      const key = `${date}_${time}`;

      // 上位 rowspan に包含されるセルはスキップ
      if (resSkipSet.has(key) || calSkipSet.has(key)) return '';

      // ── 予約スパンセル（rowspan あり）
      const resSpan = resSpanStart.get(key);
      if (resSpan) {
        const { rowspan, res, startTime, endTime } = resSpan;
        const isOpen    = _isVisit ? !state.visitBlockSet.has(key) : openSet.has(key);
        const typeClass = res.serviceType === '出張' ? 'dot-mobile' : 'dot-visit';
        let cls = `grid-cell ${isOpen ? 'reserved-open' : 'reserved'} span-cell`;
        if (date === today)   cls += ' today-col';
        if (_isHoliday(date)) cls += ' holiday-col';
        const menuHtml  = res.menuName ? `<span class="cell-menu">${res.menuName}</span>` : '';
        const content   = `<div class="cell-res-inner"><span class="cell-res-time">${startTime}〜${endTime}</span><span class="cell-name">${res.customerName}</span><span class="cell-type-tag ${typeClass}">${res.serviceType}</span>${menuHtml}</div>`;
        return `<td class="${cls}" id="cell-${key}" rowspan="${rowspan}" onclick="showToast('${res.customerName}（${res.serviceType} ${startTime}〜${endTime}）', false)">${content}</td>`;
      }

      // ── カレンダーイベントスパンセル（rowspan あり）
      const calSpan = calSpanStart.get(key);
      if (calSpan) {
        const { rowspan, cal, startTime, endTime } = calSpan;
        const isOpen  = _isVisit ? !state.visitBlockSet.has(key) : openSet.has(key);
        const srcCls  = cal.source === 'reservation_calendar' ? 'cal-direct' : 'cal-event';
        let cls = `grid-cell ${srcCls}${isOpen ? '-open' : ''} span-cell`;
        if (date === today)   cls += ' today-col';
        if (_isHoliday(date)) cls += ' holiday-col';
        const startIdx = GRID_TIMES.indexOf(startTime);
        const content  = `<div class="cell-cal-inner cell-cal-span"><span class="cell-cal-title">${cal.title}</span><span class="cell-cal-timerange">${startTime}〜${endTime}</span>${_calBadgeHtml(cal.source)}</div>`;
        return `<td class="${cls}" id="cell-${key}" rowspan="${rowspan}" onclick="localToggleGridCellSpan('${date}', ${startIdx}, ${rowspan})">${content}</td>`;
      }

      // ── 通常セル
      const [cls, content, onclick] = _buildCell(key, date, time, { resMap, openSet, calMap, intervalSet, today });
      return `<td class="${cls}" id="cell-${key}" ${onclick}>${content}</td>`;
    }).join('');

    return `<tr><td class="grid-time-td">${time}</td>${cells}</tr>`;
  }).join('');

  const isVisitMode = state.gridServiceType === '来店';
  const hintText = isVisitMode
    ? 'タップで○/×を切り替え（×=ブロック）、保存で反映'
    : 'タップで○/✕を切り替え、保存で反映';

  return `
    <div class="grid-container">
      <div class="grid-type-toggle">
        <button class="type-btn ${isVisitMode ? 'active' : ''}" onclick="setGridServiceType('来店')">来店</button>
        <button class="type-btn ${!isVisitMode ? 'active' : ''}" onclick="setGridServiceType('出張')">出張</button>
      </div>
      <div class="grid-toolbar">
        <span class="grid-toolbar-note" id="grid-toolbar-note">
          ${hasDirty
            ? `<span style="color:var(--primary);font-weight:600;">${changeCount}日分の変更あり</span>`
            : hintText}
        </span>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="refresh-btn" onclick="refreshCurrentTab()">↻ 更新</button>
          <button class="grid-save-btn ${hasDirty ? '' : 'hidden'}" id="grid-save-btn"
                  onclick="handleSaveGrid()"
                  ${state.gridSaving ? 'disabled' : ''}>
            ${state.gridSaving ? '保存中...' : '保存する'}
          </button>
        </div>
      </div>
      <div class="bk-cg-nav" style="padding:8px 0;">
        <button class="bk-cg-nav-btn" onclick="changeGridTab(-31)"
                ${shiftDate(state.gridTabStartDate || today, -31) < today ? 'disabled' : ''}>‹ 前の31日</button>
        <span style="font-size:13px;color:var(--text-secondary);">${formatDateLabel(dates[0]).split('（')[0]} 〜 ${formatDateLabel(dates[dates.length - 1]).split('（')[0]}</span>
        <button class="bk-cg-nav-btn" onclick="changeGridTab(31)">次の31日 ›</button>
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
// スパンマップを構築（予約・カレンダーイベントの連続スロットを検出）
// ============================================================
function buildSpanMaps(dates, resMap, calMap) {
  const resSpanStart = new Map(); // "date_time" → { rowspan, res, startTime, endTime }
  const resSkipSet   = new Set(); // 上位 rowspan に包含されるスロット（td を生成しない）
  const calSpanStart = new Map();
  const calSkipSet   = new Set();

  dates.forEach(date => {
    // 予約スパン
    let i = 0;
    while (i < GRID_TIMES.length) {
      const time = GRID_TIMES[i];
      const key  = `${date}_${time}`;
      const res  = resMap.get(key);
      if (res) {
        let span = 1;
        while (i + span < GRID_TIMES.length) {
          const nk   = `${date}_${GRID_TIMES[i + span]}`;
          const nRes = resMap.get(nk);
          if (nRes && nRes.customerName === res.customerName && nRes.serviceType === res.serviceType) {
            resSkipSet.add(nk);
            span++;
          } else break;
        }
        const endTime = minutesToTimeStr(timeToMin(GRID_TIMES[i + span - 1]) + 30);
        resSpanStart.set(key, { rowspan: span, res, startTime: time, endTime });
        i += span;
      } else {
        i++;
      }
    }

    // カレンダーイベントスパン（予約が存在するスロットは除外）
    let j = 0;
    while (j < GRID_TIMES.length) {
      const time = GRID_TIMES[j];
      const key  = `${date}_${time}`;
      if (calMap && calMap.has(key) && !resMap.has(key)) {
        const cal = calMap.get(key);
        let span  = 1;
        while (j + span < GRID_TIMES.length) {
          const nk   = `${date}_${GRID_TIMES[j + span]}`;
          const nCal = calMap.get(nk);
          if (nCal && !resMap.has(nk) && nCal.title === cal.title && nCal.source === cal.source) {
            calSkipSet.add(nk);
            span++;
          } else break;
        }
        const endTime = minutesToTimeStr(timeToMin(GRID_TIMES[j + span - 1]) + 30);
        calSpanStart.set(key, { rowspan: span, cal, startTime: time, endTime });
        j += span;
      } else {
        j++;
      }
    }
  });

  return { resSpanStart, resSkipSet, calSpanStart, calSkipSet };
}

// ============================================================
// グリッドのデータ操作
// ============================================================

async function handleToggleHolidayOverride(date) {
  const serviceType = state.gridServiceType;
  try {
    const result = await apiPost({ action: 'toggleHolidayOverride', date, serviceType });
    if (result.error) throw new Error(result.error);
    if (serviceType === '来店') {
      if (result.override) {
        if (!_holidayOverridesVisit.includes(date)) _holidayOverridesVisit.push(date);
      } else {
        _holidayOverridesVisit = _holidayOverridesVisit.filter(d => d !== date);
      }
    } else {
      if (result.override) {
        if (!_holidayOverridesMobile.includes(date)) _holidayOverridesMobile.push(date);
      } else {
        _holidayOverridesMobile = _holidayOverridesMobile.filter(d => d !== date);
      }
    }
    showToast(result.override ? '顧客向けに解放しました' : '解放を解除しました');
    _updateHolidayOverrideBtn(date);
  } catch(err) {
    showToast('更新に失敗しました: ' + err.message, true);
  }
}

function _updateHolidayOverrideBtn(date) {
  const btn = document.getElementById(`override-btn-${date}`);
  if (!btn) return;
  const overrides   = state.gridServiceType === '来店' ? _holidayOverridesVisit : _holidayOverridesMobile;
  const isOverridden = overrides.includes(date);
  btn.className   = `grid-holiday-badge${isOverridden ? ' active' : ''}`;
  btn.title       = isOverridden ? 'クリックで解放を解除' : 'クリックで顧客に解放';
  btn.textContent = isOverridden ? '解放中' : '定休';
}

// その日の全非予約スロットが開放済みか判定
function _isDayAllOpen(date) {
  const isVisitMode = state.gridServiceType === '来店';
  const { resMap, openSet } = state.gridData;
  return GRID_TIMES.every(time => {
    const key = `${date}_${time}`;
    if (resMap.has(key)) return true; // 予約済みはスキップ（全開とみなす）
    return isVisitMode ? !state.visitBlockSet.has(key) : openSet.has(key);
  });
}

// その日の全非予約スロットを一括トグル
function bulkToggleDay(date) {
  const isVisitMode = state.gridServiceType === '来店';
  const { resMap, openSet } = state.gridData;
  const openAll = !_isDayAllOpen(date);
  GRID_TIMES.forEach(time => {
    const key = `${date}_${time}`;
    if (resMap.has(key)) return;
    if (isVisitMode) {
      if (openAll) state.visitBlockSet.delete(key);
      else         state.visitBlockSet.add(key);
    } else {
      if (openAll) openSet.add(key);
      else         openSet.delete(key);
    }
    updateGridCell(date, time);
  });
  updateGridToolbar();
  _updateBulkBtn(date);
}

// 一括トグルボタンの表示を更新
function _updateBulkBtn(date) {
  const btn = document.getElementById(`bulk-btn-${date}`);
  if (!btn) return;
  const allOpen = _isDayAllOpen(date);
  btn.textContent = allOpen ? '全×' : '全○';
  btn.className   = `grid-bulk-btn${allOpen ? ' all-open' : ''}`;
  btn.title       = allOpen ? '全クローズ' : '全開放';
}

function changeGridTab(delta) {
  const changes = getGridChanges();
  if (Object.keys(changes).length > 0) {
    if (!confirm('未保存の変更があります。移動すると変更が失われます。')) return;
  }
  const today = todayStr();
  const cur   = state.gridTabStartDate || today;
  const d     = new Date(cur + 'T00:00:00+09:00');
  d.setDate(d.getDate() + delta);
  const next = dateToStr(d);
  state.gridTabStartDate = next < today ? today : next;
  state.gridData = null;
  renderContent();
  loadGridData();
}

function setGridServiceType(type) {
  if (state.gridServiceType === type) return;
  state.gridServiceType = type;
  renderContent();
}

// セルをローカルでトグル（スクロール位置を保持するため外科的DOM更新）
function localToggleGridCell(date, time) {
  const key = `${date}_${time}`;
  if (state.gridServiceType === '来店') {
    if (state.visitBlockSet.has(key)) {
      state.visitBlockSet.delete(key); // ブロック解除 → ○
    } else {
      state.visitBlockSet.add(key);    // ブロック → ×
    }
  } else {
    if (state.gridData.openSet.has(key)) {
      state.gridData.openSet.delete(key);
    } else {
      state.gridData.openSet.add(key);
    }
  }
  updateGridCell(date, time);
  updateGridToolbar();
}

// スパン全スロットをまとめてトグル（カレンダーイベントの merged cell 用）
function localToggleGridCellSpan(date, startIdx, span) {
  for (let s = 0; s < span; s++) {
    const time = GRID_TIMES[startIdx + s];
    if (!time) continue;
    const key = `${date}_${time}`;
    if (state.gridServiceType === '来店') {
      if (state.visitBlockSet.has(key)) state.visitBlockSet.delete(key);
      else                              state.visitBlockSet.add(key);
    } else {
      if (state.gridData.openSet.has(key)) state.gridData.openSet.delete(key);
      else                                 state.gridData.openSet.add(key);
    }
  }
  updateGridToolbar();
  // スパンセル（先頭スロット）の背景色だけ切り替え
  const firstTime = GRID_TIMES[startIdx];
  const key = `${date}_${firstTime}`;
  const td  = document.getElementById(`cell-${key}`);
  if (!td) return;
  const cal = state.gridData.calMap && state.gridData.calMap.get(key);
  if (!cal) return;
  const isOpen  = state.gridServiceType === '来店'
    ? !state.visitBlockSet.has(key)
    : state.gridData.openSet.has(key);
  const srcCls  = cal.source === 'reservation_calendar' ? 'cal-direct' : 'cal-event';
  let cls = `grid-cell ${srcCls}${isOpen ? '-open' : ''} span-cell`;
  if (date === todayStr())  cls += ' today-col';
  if (_isHoliday(date))    cls += ' holiday-col';
  td.className = cls;
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

// カレンダーイベント種別バッジ HTML を返す
function _calBadgeHtml(source) {
  if (source === 'reservation_calendar') return '<span class="cell-type-tag dot-direct">プライベート</span>';
  return '<span class="cell-type-tag dot-private">プライベート</span>';
}

// ============================================================
// セル描画ヘルパー：[className, innerHTML, onclickAttr] を返す
// 優先順位: 予約 > pending変更 > カレンダー予定 > インターバル > open/closed
// ============================================================
function _buildCell(key, date, time, { resMap, openSet, calMap, intervalSet, today }) {
  const isVisitMode = state.gridServiceType === '来店';
  const res         = resMap.get(key);
  const cal         = calMap ? calMap.get(key) : null;
  const inInterval  = intervalSet ? intervalSet.has(key) : false;

  let isOpen, wasOpen;
  if (isVisitMode) {
    const bs = state.visitBlockSet || new Set();
    isOpen  = !bs.has(key); // 来店: ブロックされていない = open
    wasOpen = state.gridOriginalBlock ? !state.gridOriginalBlock.has(key) : isOpen;
  } else {
    isOpen  = openSet.has(key);
    wasOpen = state.gridOriginalOpen ? state.gridOriginalOpen.has(key) : isOpen;
  }
  const modified = isOpen !== wasOpen;

  let cls     = 'grid-cell';
  let content = '';
  let onclick = '';

  if (date === today)   cls += ' today-col';
  if (_isHoliday(date)) cls += ' holiday-col';

  if (res) {
    // ── 施術予約あり（タップで詳細・変更不可）
    cls    += isOpen ? ' reserved-open' : ' reserved';
    const typeClass = res.serviceType === '出張' ? 'dot-mobile' : 'dot-visit';
    content = `<div class="cell-res-inner"><span class="cell-name">${res.customerName}</span><span class="cell-type-tag ${typeClass}">${res.serviceType}</span></div>`;
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
    // ── カレンダー予定（予約カレンダー直接入力 or プライベート）
    if (cal.source === 'reservation_calendar') {
      cls += isOpen ? ' cal-direct-open' : ' cal-direct';
    } else {
      cls += isOpen ? ' cal-event-open' : ' cal-event';
    }
    const shortTitle = cal.title.length > 5 ? cal.title.slice(0, 5) + '…' : cal.title;
    content = `<div class="cell-cal-inner">${shortTitle}${_calBadgeHtml(cal.source)}</div>`;
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

  } else if (isVisitMode) {
    cls    += ' visit-blocked';
    content = '×';
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

// 変更があった日付とその時間リストを取得
function getGridChanges() {
  const changes = {};
  const dates   = getGridDates();
  if (state.gridServiceType === '来店') {
    dates.forEach(date => {
      const origBlocks = GRID_TIMES.filter(t => state.gridOriginalBlock.has(`${date}_${t}`));
      const currBlocks = GRID_TIMES.filter(t => state.visitBlockSet.has(`${date}_${t}`));
      if (JSON.stringify(origBlocks) !== JSON.stringify(currBlocks)) {
        changes[date] = currBlocks;
      }
    });
  } else {
    dates.forEach(date => {
      const origTimes = GRID_TIMES.filter(t => state.gridOriginalOpen.has(`${date}_${t}`));
      const currTimes = GRID_TIMES.filter(t => state.gridData.openSet.has(`${date}_${t}`));
      if (JSON.stringify(origTimes) !== JSON.stringify(currTimes)) {
        changes[date] = currTimes;
      }
    });
  }
  return changes;
}

// グリッドデータをGASから取得
async function loadGridData() {
  state.gridLoading = true;
  renderContent();

  try {
    const result = await apiGet({ action: 'getGridData', startDate: state.gridTabStartDate || todayStr(), days: 31 });
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
    // 00:00〜02:59 開始の予約は前日の 24:xx〜26:xx にリマップして表示する
    const resMap = new Map();
    result.reservations.forEach(res => {
      const norm  = _normalizeMidnightRes(res);
      const start = timeToMin(norm.startTime);
      const end   = timeToMin(norm.endTime);
      for (let m = start; m < end; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t)) {
          resMap.set(`${norm.date}_${t}`, {
            customerName: res.customerName,
            menuName:     res.menuName,
            serviceType:  res.serviceType,
          });
        }
      }
    });

    // ③ カレンダーイベントからマップを構築（source を保持して描画で区別）
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
          if (!calMap.has(key)) calMap.set(key, { title: ev.title, source: ev.source });
        }
      }
    });

    // ④ インターバル不可ブロックを計算
    //   a) 予約終了後のバッファ（予約間インターバル）
    //   b) カレンダー予定の前後バッファ（calendarIntervalMobile）
    const intervalMinVisit   = result.intervalMinutesVisit  || 60;
    const intervalMinMobile  = result.intervalMinutesMobile || 90;
    const calIntervalMin     = result.calendarIntervalMobile || 90;
    const intervalSet        = new Set();

    // a) 予約終了後バッファ・開始前バッファ（serviceTypeごとに来店60分・出張90分を適用）
    result.reservations.forEach(res => {
      const norm         = _normalizeMidnightRes(res);
      const intervalMin  = res.serviceType === '来店' ? intervalMinVisit : intervalMinMobile;
      const startMin     = timeToMin(norm.startTime);
      const endMin       = timeToMin(norm.endTime);
      // 終了後バッファ（終了が30分境界でない場合も次の境界から正しくカバー）
      const postBufStart = Math.ceil(endMin / 30) * 30;
      for (let m = postBufStart; m < endMin + intervalMin; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t)) intervalSet.add(`${norm.date}_${t}`);
      }
      // 開始前バッファ（予約ブロック自体は resMap が担当するので除く）
      for (let m = startMin - intervalMin; m < startMin; m += 30) {
        if (m < 0) continue;
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t) && !resMap.has(`${norm.date}_${t}`)) {
          intervalSet.add(`${norm.date}_${t}`);
        }
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
      for (let m = Math.ceil(evEnd / 30) * 30; m < postBufEnd; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t) && !calMap.has(`${ev.date}_${t}`)) {
          intervalSet.add(`${ev.date}_${t}`);
        }
      }
    });

    // 来店ブロックセットを構築
    const visitBlockSet = new Set();
    (result.visitBlocks || []).forEach(block => {
      const start = timeToMin(block.startTime);
      const end   = timeToMin(block.endTime);
      for (let m = start; m < end; m += 30) {
        const t = minutesToTimeStr(m);
        if (GRID_TIMES.includes(t)) visitBlockSet.add(`${block.date}_${t}`);
      }
    });

    state.gridData          = { openSet, resMap, calMap, intervalSet };
    state.gridOriginalOpen  = new Set(openSet);
    state.visitBlockSet     = visitBlockSet;
    state.gridOriginalBlock = new Set(visitBlockSet);
    if (Array.isArray(result.holidays))                _holidays               = result.holidays;
    if (Array.isArray(result.holidayOverridesVisit))  _holidayOverridesVisit  = result.holidayOverridesVisit;
    if (Array.isArray(result.holidayOverridesMobile)) _holidayOverridesMobile = result.holidayOverridesMobile;

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
    const result = await apiPost({
      action:      'saveGridSlots',
      changes,
      serviceType: state.gridServiceType,
    });
    if (result.error) throw new Error(result.error);
    showToast('保存しました');
    if (state.gridServiceType === '来店') {
      state.gridOriginalBlock = new Set(state.visitBlockSet);
    } else {
      state.gridOriginalOpen = new Set(state.gridData.openSet);
    }
  } catch(err) {
    showToast('保存に失敗しました: ' + err.message, true);
  }

  state.gridSaving = false;
  renderContent();
}

// ============================================================
// 顧客カルテタブ
// ============================================================

function setCustomerSearch(q) {
  state.customerSearch = q;
  const listEl = document.getElementById('ct-list-container');
  if (listEl) listEl.innerHTML = _buildCustomerCards();
}

async function loadCustomerList() {
  if (state.customerLoading) return;
  state.customerLoading = true;
  renderContent();
  try {
    const result = await apiGet({ action: 'getCustomerList' });
    state.customerList = result.customers || [];
  } catch(e) {
    state.customerList = [];
  }
  state.customerLoading = false;
  renderContent();
}

async function openCustomerDetail(lineUserId) {
  state.selectedCustomer         = null;
  state.selectedCustomerLoading  = true;
  state.karteSaving              = {};
  renderContent();
  try {
    const result = await apiGet({ action: 'getCustomerDetail', lineUserId });
    state.selectedCustomer = result;
  } catch(e) {
    showToast('顧客情報の取得に失敗しました', true);
  }
  state.selectedCustomerLoading = false;
  renderContent();
}

function closeCustomerDetail() {
  state.selectedCustomer        = null;
  state.selectedCustomerLoading = false;
  state.karteSaving             = {};
  state.customerEditMode        = false;
  state.customerSaving          = false;
  renderContent();
}

function toggleCustomerEditMode() {
  state.customerEditMode = !state.customerEditMode;
  renderContent();
}

async function saveCustomerInfo() {
  const c = (state.selectedCustomer || {}).customer || {};
  const name     = (document.getElementById('ct-edit-name')     || {}).value || '';
  const furigana = (document.getElementById('ct-edit-furigana') || {}).value || '';
  const phone    = (document.getElementById('ct-edit-phone')    || {}).value || '';
  const address  = (document.getElementById('ct-edit-address')  || {}).value || '';
  const notes    = (document.getElementById('ct-edit-notes')    || {}).value || '';

  if (!name.trim()) { showToast('氏名を入力してください', true); return; }

  state.customerSaving = true;
  renderContent();
  try {
    await apiPost({ action: 'updateCustomer', lineUserId: c.lineUserId, name: name.trim(), furigana: furigana.trim(), phone, address, notes });
    state.selectedCustomer.customer = Object.assign({}, c, { name: name.trim(), furigana: furigana.trim(), phone, address, notes });
    state.customerEditMode = false;
    if (state.customerList.length > 0) loadCustomerList();
  } catch(e) {
    showToast('保存に失敗しました', true);
  }
  state.customerSaving = false;
  renderContent();
}

async function saveKarteMemo(karteId) {
  const el = document.getElementById('memo-' + karteId);
  if (!el) return;
  const memo = el.value;

  state.karteSaving = Object.assign({}, state.karteSaving, { [karteId]: 'saving' });
  _updateMemoBtn(karteId, '保存中...');

  try {
    const result = await apiPost({ action: 'saveKarte', karteId, treatmentContent: memo });
    if (result.error) throw new Error(result.error);
    // re-render前にstateを更新して旧テキストが再表示されないようにする
    if (state.selectedCustomer && state.selectedCustomer.history) {
      const item = state.selectedCustomer.history.find(r => r.karteId === karteId);
      if (item) item.memo = memo;
    }
    state.karteSaving = Object.assign({}, state.karteSaving, { [karteId]: 'saved' });
    _updateMemoBtn(karteId, '保存済み ✓');
    // 顧客一覧の最新メモも更新（バックグラウンド）
    if (state.customerList.length > 0) loadCustomerList();
    setTimeout(() => {
      state.karteSaving = Object.assign({}, state.karteSaving, { [karteId]: null });
      _updateMemoBtn(karteId, '保存する');
    }, 2000);
  } catch(e) {
    state.karteSaving = Object.assign({}, state.karteSaving, { [karteId]: null });
    _updateMemoBtn(karteId, '保存する');
    showToast('保存に失敗しました: ' + e.message, true);
  }
}

function _updateMemoBtn(karteId, text) {
  const btn = document.getElementById('memo-btn-' + karteId);
  if (btn) btn.textContent = text;
}

// ── 顧客一覧レンダリング ──
function renderCustomersTab() {
  if (state.selectedCustomerLoading) {
    return `<div style="display:flex;flex-direction:column;align-items:center;padding:64px 0;gap:16px;">
      <div class="spinner"></div>
      <span style="font-size:13px;color:var(--text-secondary);">顧客情報を読み込み中...</span>
    </div>`;
  }

  if (state.selectedCustomer) return _renderCustomerDetail();

  if (state.customerLoading) {
    return `<div style="display:flex;flex-direction:column;align-items:center;padding:64px 0;gap:16px;">
      <div class="spinner"></div>
      <span style="font-size:13px;color:var(--text-secondary);">読み込み中...</span>
    </div>`;
  }

  const custHeader = `
    <div class="tab-header"><span class="tab-header-title">顧客</span><button class="refresh-btn" onclick="refreshCurrentTab()">↻ 更新</button></div>
    <div class="ct-search-bar">
      <input id="ct-search-input" class="ct-search-input" type="search" placeholder="名前で検索..."
             value="${_bkEsc(state.customerSearch)}"
             oninput="setCustomerSearch(this.value)">
    </div>`;

  return custHeader + `<div class="ct-list" id="ct-list-container">${_buildCustomerCards()}</div>`;
}

function _buildCustomerCards() {
  if (state.customerList.length === 0) {
    return `<div class="empty-state">まだ顧客データがありません</div>`;
  }

  const q  = _toHiragana(state.customerSearch.trim().toLowerCase());
  const filtered = q
    ? state.customerList.filter(c => {
        const name     = _toHiragana((c.name     || '').toLowerCase());
        const furigana = _toHiragana((c.furigana || '').toLowerCase());
        return name.startsWith(q) || furigana.startsWith(q);
      })
    : state.customerList;

  if (filtered.length === 0) {
    return `<div class="empty-state">「${_bkEsc(state.customerSearch)}」に一致する顧客が見つかりません</div>`;
  }

  return filtered.map(c => {
    const prevBadge = c.lastTreatmentServiceType === '来店' ? 'badge-visit' : 'badge-mobile';
    const prevSnip = c.lastTreatmentDate
      ? `<div class="ct-card-mid">
          <span class="service-badge ${prevBadge}">${c.lastTreatmentServiceType}</span>
          <span class="ct-latest-date">前回　${formatDateLabel(c.lastTreatmentDate)}</span>
        </div>`
      : '';
    const nextSnip = c.nextDate
      ? `<div class="ct-card-next">次回　${formatDateLabel(c.nextDate)}　${c.nextStartTime}〜</div>`
      : '';
    const addrSnip = c.address
      ? `<div class="ct-card-address">${_bkEsc(c.address)}</div>`
      : '';
    const memoSnip = c.latestMemo
      ? `<div class="ct-card-memo">${_bkEsc(c.latestMemo.slice(0, 40))}${c.latestMemo.length > 40 ? '…' : ''}</div>`
      : '';
    return `
      <div class="ct-card" onclick="openCustomerDetail('${_bkEsc(c.lineUserId)}')">
        <div class="ct-card-top">
          <span class="ct-name">${_bkEsc(c.name)}</span>
          <span class="ct-visit-count">${c.visitCount}回</span>
        </div>
        ${prevSnip}
        ${nextSnip}
        ${addrSnip}
        ${memoSnip}
      </div>`;
  }).join('');
}

// ── 顧客詳細レンダリング ──
function _renderCustomerDetail() {
  const { customer, history } = state.selectedCustomer;
  const c = customer || {};

  // 編集モード
  if (state.customerEditMode) {
    const saving = state.customerSaving;
    return `
      <div class="ct-detail">
        <div class="ct-detail-header">
          <button class="btn-back-reschedule" onclick="toggleCustomerEditMode()" ${saving ? 'disabled' : ''}>← キャンセル</button>
          <span class="ct-detail-name">顧客情報を編集</span>
        </div>
        <div class="ct-edit-form">
          <div class="ct-edit-row">
            <label class="ct-edit-label">氏名 <span style="color:#c62828">*</span></label>
            <input class="ct-edit-input" id="ct-edit-name" type="text" value="${_bkEsc(c.name || '')}" placeholder="氏名">
          </div>
          <div class="ct-edit-row">
            <label class="ct-edit-label">ふりがな</label>
            <input class="ct-edit-input" id="ct-edit-furigana" type="text" value="${_bkEsc(c.furigana || '')}" placeholder="たなか はなこ">
          </div>
          <div class="ct-edit-row">
            <label class="ct-edit-label">電話</label>
            <input class="ct-edit-input" id="ct-edit-phone" type="tel" value="${_bkEsc(c.phone || '')}" placeholder="09012345678">
          </div>
          <div class="ct-edit-row">
            <label class="ct-edit-label">住所</label>
            <input class="ct-edit-input" id="ct-edit-address" type="text" value="${_bkEsc(c.address || '')}" placeholder="住所">
          </div>
          <div class="ct-edit-row">
            <label class="ct-edit-label">備考</label>
            <textarea class="ct-memo-textarea" id="ct-edit-notes" rows="3" placeholder="備考・アレルギー等">${_bkEsc(c.notes || '')}</textarea>
          </div>
        </div>
        <div class="ct-edit-actions">
          <button class="btn btn-ghost" onclick="toggleCustomerEditMode()" ${saving ? 'disabled' : ''}>キャンセル</button>
          <button class="btn btn-primary" onclick="saveCustomerInfo()" ${saving ? 'disabled' : ''}>${saving ? '保存中...' : '保存する'}</button>
        </div>
      </div>`;
  }

  // 表示モード
  const infoRows = [
    c.phone   ? `<div class="ct-info-row"><span class="ct-info-label">電話</span><span>${_bkEsc(c.phone)}</span></div>` : '',
    c.address ? `<div class="ct-info-row"><span class="ct-info-label">住所</span><span>${_bkEsc(c.address)}</span></div>` : '',
    c.firstVisitDate ? `<div class="ct-info-row"><span class="ct-info-label">初回</span><span>${formatDateLabel(c.firstVisitDate)}</span></div>` : '',
    c.notes   ? `<div class="ct-info-row"><span class="ct-info-label">備考</span><span style="white-space:pre-wrap">${_bkEsc(c.notes)}</span></div>` : '',
  ].filter(Boolean).join('');

  const items = (history || []).map(r => {
    const isCancelled = r.status === 'cancelled';
    const badgeCls    = r.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';
    const saving      = state.karteSaving[r.karteId];
    const btnText     = saving === 'saving' ? '保存中...' : saving === 'saved' ? '保存済み ✓' : '保存する';
    const memoSection = r.karteId ? `
      <div class="ct-memo-section">
        <textarea class="ct-memo-textarea" id="memo-${_bkEsc(r.karteId)}"
                  placeholder="施術メモを入力..."
                  rows="3">${_bkEsc(r.memo)}</textarea>
        <button class="ct-save-btn" id="memo-btn-${_bkEsc(r.karteId)}"
                onclick="saveKarteMemo('${_bkEsc(r.karteId)}')">${btnText}</button>
      </div>` : `<p class="ct-no-karte">カルテ未作成</p>`;

    const hasPrice  = r.price !== '' && r.price !== null && r.price !== undefined;
    const priceArg  = hasPrice ? Number(r.price) : "''";
    const priceHtml = hasPrice
      ? `<span class="sales-price">¥${Number(r.price).toLocaleString()}</span>
         <span class="price-badge ${r.priceType === 'manual' ? 'price-badge-manual' : 'price-badge-auto'}">${r.priceType === 'manual' ? '手入力' : '自動'}</span>`
      : `<span class="price-missing">金額未入力</span>`;

    return `
      <div class="ct-history-item${isCancelled ? ' ct-cancelled' : ''}">
        <div class="ct-history-header">
          <span class="ct-history-date">${formatDateLabel(r.date)}</span>
          <span class="ct-history-time">${r.startTime}〜${r.endTime}</span>
          <span class="service-badge ${badgeCls}">${r.serviceType}</span>
          ${isCancelled ? '<span class="badge-cancelled">キャンセル済</span>' : ''}
        </div>
        <div class="ct-history-menu">${_bkEsc(r.menuName)}（${r.duration}分）</div>
        <div class="ct-history-price-row">
          ${priceHtml}
          <button class="sales-edit-btn" onclick="openPriceEditModal('${r.reservationId}', ${priceArg}, 'customer')">${hasPrice ? '編集' : '入力'}</button>
        </div>
        ${memoSection}
      </div>`;
  }).join('');

  return `
    <div class="ct-detail">
      <div class="ct-detail-header">
        <button class="btn-back-reschedule" onclick="closeCustomerDetail()">← 一覧に戻る</button>
        <span class="ct-detail-name">${_bkEsc(c.name || '')}</span>
        <button class="ct-edit-btn" onclick="toggleCustomerEditMode()">編集</button>
      </div>
      ${infoRows ? `<div class="ct-info-block">${infoRows}</div>` : ''}
      <div class="ct-history-label">施術履歴（${(history||[]).length}件）</div>
      <div class="ct-history-list">${items || '<div class="empty-state">履歴がありません</div>'}</div>
    </div>`;
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
// 代理予約タブ
// ============================================================

// メニュー一覧をAPIから取得
// 設定からコース名リストを取得（初回のみ）
let _bkMenusLoaded = false;
async function loadBookingMenus() {
  if (_bkMenusLoaded) return;
  _bkMenusLoaded = true;
  try {
    const result = await apiGet({ action: 'getSettings' });
    if (Array.isArray(result.menus) && result.menus.length > 0)
      _bkMobileCourses = result.menus.map(m => (typeof m === 'string' ? m : m.name));
    if (Array.isArray(result.holidays) && _holidays.length === 0)
      _holidays = result.holidays;
    renderContent();
  } catch(e) { /* デフォルト値を使う */ }
}

// ============================================================
// 代理予約 — 算出ヘルパー
// ============================================================
function _bkEsc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 最終的なメニュー名を返す
function _bkMenuName() {
  const f = _bkForm;
  if (f.serviceType === '来店') {
    if (f.courseIdx === null) return null;
    const course = VISIT_COURSES[f.courseIdx];
    const opts = f.options.filter(o => o !== 'オプションなし');
    return opts.length > 0 ? `${course.name}（${opts.join('・')}）` : course.name;
  }
  return f.mobileCourse || null;
}

// 合計施術時間（分）を返す
function _bkTotalDuration() {
  const f = _bkForm;
  if (f.serviceType === '来店') {
    if (f.courseIdx === null) return null;
    let dur = VISIT_COURSES[f.courseIdx].duration;
    if (!f.options.includes('オプションなし')) {
      f.options.forEach(name => {
        const opt = VISIT_OPTIONS.find(o => o.name === name);
        if (opt) dur += opt.duration;
      });
    }
    return dur;
  }
  return f.duration || null;
}

// Page1 の必須項目がすべて揃っているか
function _bkPage1Valid() {
  const f = _bkForm;
  if (!f.customerName.trim() || !f.serviceType) return false;
  if (f.serviceType === '来店') {
    return f.courseIdx !== null;
  } else {
    return !!f.mobileCourse && !!f.duration && !!f.address.trim();
  }
}

// テキスト入力の現在値を _bkForm に同期（再レンダー前に呼ぶ）
function _bkSyncInputs() {
  const nameEl    = document.getElementById('bk-name');
  const phoneEl   = document.getElementById('bk-phone');
  const addressEl = document.getElementById('bk-address');
  if (nameEl)    _bkForm.customerName = nameEl.value;
  if (phoneEl)   _bkForm.phone        = phoneEl.value;
  if (addressEl) _bkForm.address      = addressEl.value;
}

// ============================================================
// 代理予約 — Page 1: 顧客情報・コース
// ============================================================
function _renderBkInfo() {
  const f      = _bkForm;
  const isVisit = f.serviceType === '来店';
  const isMobile = f.serviceType === '出張';

  // 来店：コース選択
  const courseSection = `
    <div class="bk-section">
      <div class="bk-section-title">コース</div>
      <div class="bk-pill-col">
        ${VISIT_COURSES.map((c, i) => `
          <button class="bk-pill bk-pill-wide ${f.courseIdx === i ? 'active' : ''}"
                  onclick="bkSetCourse(${i})">
            ${_bkEsc(c.name)}（${c.duration}分）
          </button>`).join('')}
      </div>
    </div>`;

  // 来店：オプション選択
  const optionSection = f.courseIdx !== null ? `
    <div class="bk-section">
      <div class="bk-section-title">オプション</div>
      <div class="bk-pill-col">
        ${VISIT_OPTIONS.map(o => `
          <button class="bk-pill bk-pill-wide ${f.options.includes(o.name) ? 'active' : ''}"
                  data-opt="${_bkEsc(o.name)}"
                  onclick="bkToggleOption(this.dataset.opt)">
            ${_bkEsc(o.name)}${o.duration > 0 ? `（+${o.duration}分）` : ''}
          </button>`).join('')}
      </div>
    </div>` : '';

  // 出張：コース選択
  const mobileCourseSection = `
    <div class="bk-section">
      <div class="bk-section-title">コース</div>
      <div class="bk-pill-col">
        ${_bkMobileCourses.map(name => `
          <button class="bk-pill bk-pill-wide ${f.mobileCourse === name ? 'active' : ''}"
                  data-name="${_bkEsc(name)}"
                  onclick="bkSetMobileCourse(this.dataset.name)">
            ${_bkEsc(name)}
          </button>`).join('')}
      </div>
    </div>`;

  // 出張：時間選択
  const durationSection = `
    <div class="bk-section">
      <div class="bk-section-title">施術時間</div>
      <div class="bk-pill-group">
        ${MOBILE_DURATIONS.map(d =>
          `<button class="bk-pill ${f.duration === d ? 'active' : ''}"
                   onclick="bkSetDuration(${d})">${d}分</button>`
        ).join('')}
      </div>
    </div>`;

  const p1Valid = _bkPage1Valid();

  return `
    <div class="bk-scroll">
      <div class="bk-step-bar">
        <span class="bk-step active">1</span>
        <span class="bk-step-line"></span>
        <span class="bk-step">2</span>
        <span class="bk-step-line"></span>
        <span class="bk-step">3</span>
      </div>

      <!-- 顧客情報 -->
      <div class="bk-section">
        <div class="bk-section-title">顧客情報</div>
        <div class="bk-field">
          <label class="bk-label">氏名 <span class="bk-required">*</span></label>
          <input type="text" class="bk-input" id="bk-name"
                 value="${_bkEsc(f.customerName)}"
                 placeholder="山田 太郎"
                 oninput="bkUpdateNextBtn()">
        </div>
        <div class="bk-field">
          <label class="bk-label">電話番号</label>
          <input type="tel" class="bk-input" id="bk-phone"
                 value="${_bkEsc(f.phone)}"
                 placeholder="090-0000-0000">
        </div>
      </div>

      <!-- 種別 -->
      <div class="bk-section">
        <div class="bk-section-title">種別</div>
        <div class="bk-pill-group">
          <button class="bk-pill ${isVisit ? 'active' : ''}"
                  onclick="bkSetServiceType('来店')">来店</button>
          <button class="bk-pill ${isMobile ? 'active' : ''}"
                  onclick="bkSetServiceType('出張')">出張</button>
        </div>
      </div>

      ${isVisit  ? courseSection + optionSection : ''}
      ${isMobile ? mobileCourseSection + durationSection + `
        <div class="bk-section">
          <div class="bk-section-title">出張先住所 <span class="bk-required">*</span></div>
          <input type="text" class="bk-input" id="bk-address"
                 value="${_bkEsc(f.address)}"
                 placeholder="東京都渋谷区..."
                 oninput="bkUpdateNextBtn()">
        </div>` : ''}

      <div class="bk-submit-area">
        <button class="bk-submit-btn" id="bk-next-btn" ${p1Valid ? '' : 'disabled'}
                onclick="bkGoToGrid()">
          日時を選ぶ →
        </button>
      </div>
    </div>`;
}

// ============================================================
// 代理予約 — Page 2: 予約枠グリッド
// ============================================================
function _renderBkGrid() {
  const f     = _bkForm;
  const today = todayStr();
  const start = f.gridStartDate || today;
  const startMs = new Date(start + 'T00:00:00+09:00').getTime();
  const dates = [];
  for (let i = 0; i < BK_GRID_DAYS; i++) {
    dates.push(dateToStr(new Date(startMs + i * 86400000)));
  }

  let gridHtml;
  if (f.gridLoading || !f.gridAvailability) {
    gridHtml = `<div class="bk-grid-loading"><div class="spinner"></div><span>空き枠を確認中...</span></div>`;
  } else {
    const avail = f.gridAvailability;
    const selectedKey = f.selectedDate && f.selectedStartTime
      ? `${f.selectedDate}_${f.selectedStartTime}` : null;

    const hasAnyAvail = dates.some(d => Array.isArray(avail[d]) && avail[d].length > 0);

    // 表示する時間帯の範囲（空き枠がある時間の前後1行 or 全体）
    let visibleTimes;
    if (hasAnyAvail) {
      const allAvailSet = new Set();
      dates.forEach(d => { if (Array.isArray(avail[d])) avail[d].forEach(t => allAvailSet.add(t)); });
      const minIdx = GRID_TIMES.findIndex(t => allAvailSet.has(t));
      const maxIdx = GRID_TIMES.reduce((acc, t, i) => allAvailSet.has(t) ? i : acc, minIdx);
      visibleTimes = GRID_TIMES.slice(Math.max(0, minIdx - 1), maxIdx + 2);
    } else {
      visibleTimes = GRID_TIMES;
    }

    const noAvailNotice = hasAnyAvail ? '' :
      `<p class="bk-no-avail">予約可能な時間帯がありません。</p>`;

    const headerCells = dates.map(date => {
      const d   = new Date(date + 'T00:00:00+09:00');
      const dow = d.getDay();
      const wk  = ['日','月','火','水','木','金','土'][dow];
      const m   = d.getMonth() + 1;
      const day = d.getDate();
      if (_isHoliday(date)) {
        return `<th class="bk-cg-th bk-cg-holiday">${m}/${day}<br><span class="bk-cg-dow">${wk}</span></th>`;
      }
      let cls = 'bk-cg-th';
      if (date === today)  cls += ' bk-cg-today';
      else if (dow === 0)  cls += ' bk-cg-sun';
      else if (dow === 6)  cls += ' bk-cg-sat';
      return `<th class="${cls}">${m}/${day}<br><span class="bk-cg-dow">${wk}</span></th>`;
    }).join('');

    const detail    = f.gridDetailData;
    const numRows   = visibleTimes.length;

    const bodyRows = visibleTimes.map((time, rowIdx) => {
      const cells = dates.map(date => {
        if (_isHoliday(date)) {
          if (rowIdx === 0) {
            return `<td class="bk-cg-cell bk-cg-holiday-col" rowspan="${numRows}"><span class="grid-holiday-text">定休日</span></td>`;
          }
          return '';
        }
        const key     = `${date}_${time}`;
        const isAvail = Array.isArray(avail[date]) && avail[date].includes(time);
        const isSel   = key === selectedKey;

        if (isSel) {
          return `<td class="bk-cg-cell bk-cg-sel" id="bkcg-${key}"
                      onclick="bkSelectGridSlot('${date}','${time}')">○</td>`;
        }
        if (isAvail) {
          return `<td class="bk-cg-cell bk-cg-open" id="bkcg-${key}"
                      onclick="bkSelectGridSlot('${date}','${time}')">○</td>`;
        }

        // 詳細データがあれば理由を表示
        if (detail) {
          const res = detail.resMap.get(key);
          if (res) {
            const tc = res.serviceType === '出張' ? 'dot-mobile' : 'dot-visit';
            return `<td class="bk-cg-cell bk-cg-reserved">
              <div class="cell-res-inner">
                <span class="cell-name">${_bkEsc(res.customerName)}</span>
                <span class="cell-type-tag ${tc}">${res.serviceType}</span>
              </div></td>`;
          }
          const cal = detail.calMap.get(key);
          if (cal) {
            const calCls = cal.source === 'reservation_calendar' ? 'bk-cg-cal-direct' : 'bk-cg-cal';
            const t = cal.title.length > 5 ? cal.title.slice(0, 5) + '…' : cal.title;
            return `<td class="bk-cg-cell ${calCls}"><div class="cell-cal-inner">${_bkEsc(t)}</div></td>`;
          }
          if (detail.intervalSet.has(key)) {
            return `<td class="bk-cg-cell bk-cg-interval"><span class="cell-interval-label">準備</span></td>`;
          }
        }

        return `<td class="bk-cg-cell bk-cg-closed">−</td>`;
      }).join('');
      return `<tr><td class="bk-cg-time">${time}</td>${cells}</tr>`;
    }).join('');

    const prevDate     = dateToStr(new Date(startMs - BK_GRID_DAYS * 86400000));
    const prevDisabled = prevDate < today;
    const nav = `
      <div class="bk-cg-nav">
        <button class="bk-cg-nav-btn" onclick="bkChangeGrid(-${BK_GRID_DAYS})"
                ${prevDisabled ? 'disabled' : ''}>‹ 前の${BK_GRID_DAYS}日</button>
        <button class="bk-cg-nav-btn" onclick="bkChangeGrid(${BK_GRID_DAYS})">
          次の${BK_GRID_DAYS}日 ›</button>
      </div>`;

    const selBanner = (f.selectedDate && f.selectedStartTime) ? `
      <div class="bk-cg-banner">
        ${formatDateLabel(f.selectedDate)}&nbsp; ${f.selectedStartTime}〜${minutesToTimeStr(timeToMin(f.selectedStartTime) + (_bkTotalDuration() || 0))}
      </div>` : '';

    gridHtml = `
      ${nav}
      ${noAvailNotice}
      ${selBanner}
      <div class="bk-cg-scroll">
        <table class="bk-cg-table">
          <thead><tr><th class="bk-cg-corner">時間</th>${headerCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>`;
  }

  return `
    <div class="bk-scroll">
      <div class="bk-step-bar">
        <span class="bk-step done">1</span>
        <span class="bk-step-line active"></span>
        <span class="bk-step active">2</span>
        <span class="bk-step-line"></span>
        <span class="bk-step">3</span>
      </div>

      ${gridHtml}

      <div class="bk-grid-footer">
        <button class="bk-btn-secondary" onclick="bkGoBack()">← 戻る</button>
        <button class="bk-submit-btn bk-submit-inline"
                ${f.selectedDate && f.selectedStartTime ? '' : 'disabled'}
                onclick="bkGoToConfirm()">確認へ →</button>
      </div>
    </div>`;
}

// ============================================================
// 代理予約 — Page 3: 確認
// ============================================================
function _renderBkConfirm() {
  const f        = _bkForm;
  const menuName = _bkMenuName();
  const dur      = _bkTotalDuration();
  const endTime  = minutesToTimeStr(timeToMin(f.selectedStartTime) + dur);
  const badgeCls = f.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';

  return `
    <div class="bk-scroll">
      <div class="bk-step-bar">
        <span class="bk-step done">1</span>
        <span class="bk-step-line active"></span>
        <span class="bk-step done">2</span>
        <span class="bk-step-line active"></span>
        <span class="bk-step active">3</span>
      </div>

      <div class="bk-section-title" style="margin:0 0 12px">予約内容の確認</div>
      <div class="bk-success-detail">
        <div class="bk-success-row">
          <span class="bk-success-label">お客様</span>
          <span>${_bkEsc(f.customerName)}${f.phone ? '　' + _bkEsc(f.phone) : ''}</span>
        </div>
        <div class="bk-success-row">
          <span class="bk-success-label">種別</span>
          <span><span class="service-badge ${badgeCls}">${f.serviceType}</span></span>
        </div>
        <div class="bk-success-row">
          <span class="bk-success-label">コース</span>
          <span>${_bkEsc(menuName)}（${dur}分）</span>
        </div>
        <div class="bk-success-row">
          <span class="bk-success-label">日時</span>
          <span>${formatDateLabel(f.selectedDate)}<br>${f.selectedStartTime} 〜 ${endTime}</span>
        </div>
        ${f.address ? `<div class="bk-success-row">
          <span class="bk-success-label">住所</span>
          <span>${_bkEsc(f.address)}</span>
        </div>` : ''}
      </div>

      <div class="bk-grid-footer" style="margin-top:24px">
        <button class="bk-btn-secondary" onclick="bkGoBack()">← 戻る</button>
        <button class="bk-submit-btn bk-submit-inline" id="bk-submit-btn"
                ${f.submitting ? 'disabled' : ''}
                onclick="bkSubmit()">
          ${f.submitting ? '処理中...' : '予約を確定する'}
        </button>
      </div>
    </div>`;
}

// ============================================================
// 代理予約 — renderBookingTab（ディスパッチ）
// ============================================================
function renderBookingTab() {
  if (_bkForm.successInfo) {
    const info     = _bkForm.successInfo;
    const badgeCls = info.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';
    return `
      <div class="bk-success">
        <div class="bk-success-icon">✓</div>
        <div class="bk-success-title">予約を登録しました</div>
        <div class="bk-success-detail">
          <div class="bk-success-row">
            <span class="bk-success-label">お客様</span>
            <span>${_bkEsc(info.customerName)}${info.phone ? '　' + _bkEsc(info.phone) : ''}</span>
          </div>
          <div class="bk-success-row">
            <span class="bk-success-label">日時</span>
            <span>${formatDateLabel(info.date)}<br>${info.startTime} 〜 ${info.endTime}</span>
          </div>
          <div class="bk-success-row">
            <span class="bk-success-label">コース</span>
            <span>${_bkEsc(info.menuName)}（${info.duration}分）</span>
          </div>
          <div class="bk-success-row">
            <span class="bk-success-label">種別</span>
            <span><span class="service-badge ${badgeCls}">${info.serviceType}</span></span>
          </div>
          ${info.address ? `<div class="bk-success-row">
            <span class="bk-success-label">住所</span>
            <span>${_bkEsc(info.address)}</span>
          </div>` : ''}
        </div>
        <button class="bk-btn-primary" onclick="bkReset()">続けて予約を取る</button>
        <button class="bk-btn-secondary" onclick="switchTab('reservations')">予約一覧を見る</button>
      </div>`;
  }

  switch (_bkForm.step) {
    case 'info':    return _renderBkInfo();
    case 'grid':    return _renderBkGrid();
    case 'confirm': return _renderBkConfirm();
    default:        return _renderBkInfo();
  }
}

// ============================================================
// 代理予約 — ページ遷移
// ============================================================
// Page1 の「日時を選ぶ」ボタンの disabled を DOM 直接更新（再描画なし）
function bkUpdateNextBtn() {
  const nameEl    = document.getElementById('bk-name');
  const addressEl = document.getElementById('bk-address');
  if (nameEl)    _bkForm.customerName = nameEl.value;
  if (addressEl) _bkForm.address      = addressEl.value;
  const btn = document.getElementById('bk-next-btn');
  if (btn) btn.disabled = !_bkPage1Valid();
}

function bkGoToGrid() {
  _bkSyncInputs();
  if (!_bkPage1Valid()) return;
  _bkForm.step             = 'grid';
  _bkForm.selectedDate     = '';
  _bkForm.selectedStartTime = null;
  if (!_bkForm.gridStartDate) _bkForm.gridStartDate = todayStr();
  renderContent();
  _loadBkGrid();
}

function bkGoToConfirm() {
  if (!_bkForm.selectedDate || !_bkForm.selectedStartTime) return;
  _bkForm.step = 'confirm';
  renderContent();
}

function bkGoBack() {
  if (_bkForm.step === 'grid')    _bkForm.step = 'info';
  else if (_bkForm.step === 'confirm') _bkForm.step = 'grid';
  renderContent();
}

// ============================================================
// 代理予約 — Page1 ピル操作
// ============================================================
function bkSetServiceType(type) {
  _bkSyncInputs();
  _bkForm.serviceType   = type;
  _bkForm.courseIdx     = null;
  _bkForm.options       = [];
  _bkForm.mobileCourse  = null;
  _bkForm.duration      = null;
  renderContent();
}

function bkSetCourse(idx) {
  _bkSyncInputs();
  _bkForm.courseIdx = idx;
  _bkForm.options   = [];          // コース変更でオプションリセット
  renderContent();
}

function bkToggleOption(name) {
  _bkSyncInputs();
  const f = _bkForm;
  if (name === 'オプションなし') {
    f.options = f.options.includes('オプションなし') ? [] : ['オプションなし'];
  } else {
    f.options = f.options.filter(o => o !== 'オプションなし');
    if (f.options.includes(name)) {
      f.options = f.options.filter(o => o !== name);
    } else {
      f.options = [...f.options, name];
    }
  }
  renderContent();
}

function bkSetMobileCourse(name) {
  _bkSyncInputs();
  _bkForm.mobileCourse = name;
  renderContent();
}

function bkSetDuration(mins) {
  _bkSyncInputs();
  _bkForm.duration = mins;
  renderContent();
}

// ============================================================
// 代理予約 — Page2 グリッド操作
// ============================================================
async function _loadBkGrid() {
  const dur = _bkTotalDuration();
  if (!dur || !_bkForm.serviceType) return;

  const cacheKey = `${_bkForm.serviceType}-${dur}-${_bkForm.gridStartDate}`;
  if (_bkForm.gridCacheKey === cacheKey && _bkForm.gridAvailability) return;
  if (_bkForm.gridLoading) return;

  _bkForm.gridLoading = true;
  renderContent();

  try {
    // 空き枠（getAvailableGrid）と詳細（getGridData）を並列取得
    const [availResult, detailResult] = await Promise.all([
      apiGet({
        action:      'getAvailableGrid',
        startDate:   _bkForm.gridStartDate,
        days:        BK_GRID_DAYS,
        duration:    dur,
        serviceType: _bkForm.serviceType,
      }),
      apiGet({
        action:    'getGridData',
        startDate: _bkForm.gridStartDate,
        days:      BK_GRID_DAYS,
      }),
    ]);

    _bkForm.gridAvailability = availResult;
    _bkForm.gridCacheKey     = cacheKey;
    _bkForm.gridDetailData   = _parseBkGridDetail(detailResult);
  } catch(e) {
    _bkForm.gridAvailability = {};
    _bkForm.gridDetailData   = null;
  }

  _bkForm.gridLoading = false;
  renderContent();
}

// getGridData のレスポンスを resMap / calMap / intervalSet に変換
function _parseBkGridDetail(result) {
  if (!result || result.error) return null;

  const resMap = new Map();
  (result.reservations || []).forEach(res => {
    const norm  = _normalizeMidnightRes(res);
    const start = timeToMin(norm.startTime);
    const end   = timeToMin(norm.endTime);
    for (let m = start; m < end; m += 30) {
      const t = minutesToTimeStr(m);
      if (GRID_TIMES.includes(t))
        resMap.set(`${norm.date}_${t}`, { customerName: res.customerName, serviceType: res.serviceType });
    }
  });

  const calMap = new Map();
  (result.calendarEvents || []).forEach(ev => {
    const start      = timeToMin(ev.startTime);
    const end        = timeToMin(ev.endTime);
    const blockStart = Math.floor(start / 30) * 30;
    const blockEnd   = end > start ? Math.ceil(end / 30) * 30 : blockStart + 30;
    for (let m = blockStart; m < blockEnd; m += 30) {
      const t = minutesToTimeStr(m);
      if (GRID_TIMES.includes(t) && !calMap.has(`${ev.date}_${t}`))
        calMap.set(`${ev.date}_${t}`, { title: ev.title, source: ev.source });
    }
  });

  const intervalMinVisit   = result.intervalMinutesVisit  || 60;
  const intervalMinMobile  = result.intervalMinutesMobile || 90;
  const calIntervalMin     = result.calendarIntervalMobile || 90;
  const intervalSet        = new Set();

  (result.reservations || []).forEach(res => {
    const norm         = _normalizeMidnightRes(res);
    const intervalMin  = res.serviceType === '来店' ? intervalMinVisit : intervalMinMobile;
    const startMin     = timeToMin(norm.startTime);
    const endMin       = timeToMin(norm.endTime);
    // 終了後バッファ（終了が30分境界でない場合も次の境界から正しくカバー）
    const postBufStart = Math.ceil(endMin / 30) * 30;
    for (let m = postBufStart; m < endMin + intervalMin; m += 30) {
      const t = minutesToTimeStr(m);
      if (GRID_TIMES.includes(t)) intervalSet.add(`${norm.date}_${t}`);
    }
    // 開始前バッファ（予約ブロック自体は resMap が担当するので除く）
    for (let m = startMin - intervalMin; m < startMin; m += 30) {
      if (m < 0) continue;
      const t = minutesToTimeStr(m);
      if (GRID_TIMES.includes(t) && !resMap.has(`${norm.date}_${t}`)) {
        intervalSet.add(`${norm.date}_${t}`);
      }
    }
  });
  (result.calendarEvents || []).forEach(ev => {
    const evStart = timeToMin(ev.startTime);
    const evEnd   = timeToMin(ev.endTime);
    for (let m = Math.floor((evStart - calIntervalMin) / 30) * 30; m < evStart; m += 30) {
      const t = minutesToTimeStr(m);
      if (GRID_TIMES.includes(t) && !calMap.has(`${ev.date}_${t}`)) intervalSet.add(`${ev.date}_${t}`);
    }
    for (let m = Math.ceil(evEnd / 30) * 30; m < evEnd + calIntervalMin; m += 30) {
      const t = minutesToTimeStr(m);
      if (GRID_TIMES.includes(t) && !calMap.has(`${ev.date}_${t}`)) intervalSet.add(`${ev.date}_${t}`);
    }
  });

  return { resMap, calMap, intervalSet };
}

function bkChangeGrid(delta) {
  const today = todayStr();
  const cur   = _bkForm.gridStartDate || today;
  const d     = new Date(cur + 'T00:00:00+09:00');
  d.setDate(d.getDate() + delta);
  const next = dateToStr(d);
  _bkForm.gridStartDate    = next < today ? today : next;
  _bkForm.gridAvailability = null;
  _bkForm.gridDetailData   = null;
  _bkForm.gridCacheKey     = '';
  _bkForm.selectedDate     = '';
  _bkForm.selectedStartTime = null;
  renderContent();
  _loadBkGrid();
}

function bkSelectGridSlot(date, time) {
  _bkForm.selectedDate      = date;
  _bkForm.selectedStartTime = time;

  // セルのハイライトだけ外科的に更新
  document.querySelectorAll('.bk-cg-cell.bk-cg-open, .bk-cg-cell.bk-cg-sel').forEach(el => {
    el.className = el.className.replace('bk-cg-sel', 'bk-cg-open');
  });
  const key = `bkcg-${date}_${time}`;
  const el  = document.getElementById(key);
  if (el) el.className = el.className.replace('bk-cg-open', 'bk-cg-sel');

  // 選択バナーを更新
  const bannerEl = document.querySelector('.bk-cg-banner');
  const dur = _bkTotalDuration();
  const bannerHtml = `${formatDateLabel(date)}&nbsp; ${time}〜${minutesToTimeStr(timeToMin(time) + (dur || 0))}`;
  if (bannerEl) {
    bannerEl.innerHTML = bannerHtml;
  } else {
    // バナー挿入（navの後）
    const nav = document.querySelector('.bk-cg-nav');
    if (nav) {
      const b = document.createElement('div');
      b.className = 'bk-cg-banner';
      b.innerHTML = bannerHtml;
      nav.insertAdjacentElement('afterend', b);
    }
  }

  // 確認へボタンを有効化
  const nextBtn = document.querySelector('.bk-submit-inline');
  if (nextBtn) nextBtn.disabled = false;
}

// ============================================================
// 代理予約 — 予約確定
// ============================================================
async function bkSubmit() {
  if (_bkForm.submitting) return;
  _bkSyncInputs();

  const menuName = _bkMenuName();
  const dur      = _bkTotalDuration();

  if (!_bkForm.serviceType || !_bkForm.customerName.trim() ||
      !menuName || !dur || !_bkForm.selectedStartTime) {
    showToast('必須項目を入力してください', true);
    return;
  }
  if (_bkForm.serviceType === '出張' && !_bkForm.address.trim()) {
    showToast('出張先住所を入力してください', true);
    return;
  }

  _bkForm.submitting = true;
  renderContent();

  try {
    const result = await apiPost({
      action:       'adminCreateReservation',
      customerName: _bkForm.customerName,
      phone:        _bkForm.phone,
      address:      _bkForm.address,
      serviceType:  _bkForm.serviceType,
      menuName,
      duration:     dur,
      date:         _bkForm.selectedDate,
      startTime:    _bkForm.selectedStartTime,
    });
    if (result.error) throw new Error(result.error);

    const endTime = minutesToTimeStr(timeToMin(_bkForm.selectedStartTime) + dur);
    _bkForm.successInfo = {
      reservationId: result.reservationId,
      endTime,
      customerName:  _bkForm.customerName,
      phone:         _bkForm.phone,
      serviceType:   _bkForm.serviceType,
      menuName,
      duration:      dur,
      date:          _bkForm.selectedDate,
      startTime:     _bkForm.selectedStartTime,
      address:       _bkForm.address,
    };
    _bkForm.submitting = false;

    loadFutureReservations();
    renderContent();

  } catch(err) {
    _bkForm.submitting = false;
    showToast('予約の登録に失敗しました: ' + err.message, true);
    renderContent();
  }
}

// フォームをリセット
function bkReset() {
  _bkForm = _defaultBkForm();
  renderContent();
}

// ============================================================
// 売上タブ
// ============================================================
const SALES_MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
let _salesMonthlyChart   = null;
let _salesBreakdownChart = null;
let _priceEditContext    = null; // 'sales' | 'customer'

function _ymStr(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}
function _currentYearMonth() {
  const d = new Date();
  return _ymStr(d.getFullYear(), d.getMonth() + 1);
}
function _lastDayOfMonth(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function renderSalesTab() {
  const s = state.sales;
  if (s.loading) {
    return `<div style="display:flex;flex-direction:column;align-items:center;padding:64px 0;gap:16px;">
      <div class="spinner"></div>
      <span style="font-size:13px;color:var(--text-secondary);">売上データを読み込み中...</span>
    </div>`;
  }

  const months      = (s.monthlySummary && s.monthlySummary.months) || [];
  const yearTotal    = months.reduce((sum, m) => sum + m.total, 0);
  const yearMissing  = months.reduce((sum, m) => sum + m.missingCount, 0);
  const selectedMonth = s.selectedMonth || _currentYearMonth();

  const header = `
    <div class="tab-header"><span class="tab-header-title">売上</span><button class="refresh-btn" onclick="refreshCurrentTab()">↻ 更新</button></div>
    <div class="date-nav" style="position:static;">
      <button class="date-nav-btn" onclick="changeSalesYear(-1)">‹</button>
      <span class="date-nav-label">${s.year}年</span>
      <button class="date-nav-btn" onclick="changeSalesYear(1)">›</button>
    </div>
    <div class="sales-summary-row">
      <div class="sales-summary-card">
        <div class="sales-summary-label">年間売上（実施済み分）</div>
        <div class="sales-summary-value">¥${yearTotal.toLocaleString()}</div>
      </div>
      ${yearMissing > 0 ? `
      <div class="sales-summary-card sales-summary-warn">
        <div class="sales-summary-label">金額未入力</div>
        <div class="sales-summary-value">${yearMissing}件</div>
      </div>` : ''}
    </div>
    <div class="sales-chart-wrap"><canvas id="sales-monthly-chart" height="180"></canvas></div>
    <div class="sales-month-picker">
      ${months.map(m => `
        <button class="sales-month-pill ${selectedMonth === _ymStr(s.year, m.month) ? 'active' : ''}"
                onclick="selectSalesMonth('${_ymStr(s.year, m.month)}')">${SALES_MONTH_NAMES[m.month - 1]}</button>
      `).join('')}
    </div>
    ${renderSalesMonthDetail()}
  `;
  return header;
}

function renderSalesMonthDetail() {
  const s = state.sales;
  if (s.monthLoading) {
    return `<div style="display:flex;flex-direction:column;align-items:center;padding:32px 0;gap:12px;">
      <div class="spinner"></div>
    </div>`;
  }
  const detail = s.monthDetail;
  if (!detail) return '';

  const list = detail.listData || [];
  const listHtml = list.length === 0
    ? `<div class="empty-state">この月の実施済み予約はありません</div>`
    : list.map(r => {
        const badgeCls  = r.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';
        const hasPrice  = r.price !== '' && r.price !== null && r.price !== undefined;
        const priceArg  = hasPrice ? Number(r.price) : "''";
        const priceHtml = hasPrice
          ? `<span class="sales-price">¥${Number(r.price).toLocaleString()}</span>
             <span class="price-badge ${r.priceType === 'manual' ? 'price-badge-manual' : 'price-badge-auto'}">${r.priceType === 'manual' ? '手入力' : '自動'}</span>`
          : `<span class="price-missing">金額未入力</span>`;
        return `
          <div class="sales-list-item">
            <div class="sales-list-main">
              <span class="sales-list-date">${formatDateLabel(r.date)}</span>
              <span class="ct-history-time">${r.startTime}〜${r.endTime}</span>
              <span class="service-badge ${badgeCls}">${r.serviceType}</span>
            </div>
            <div class="sales-list-sub">
              <span class="sales-list-name">${_bkEsc(r.customerName)}</span>
              <span class="sales-list-menu">${_bkEsc(r.menuName)}</span>
            </div>
            <div class="sales-list-price-row">
              ${priceHtml}
              <button class="sales-edit-btn" onclick="openPriceEditModal('${r.reservationId}', ${priceArg}, 'sales')">${hasPrice ? '編集' : '入力'}</button>
            </div>
          </div>`;
      }).join('');

  return `
    <div class="sales-chart-wrap"><canvas id="sales-breakdown-chart" height="180"></canvas></div>
    <div class="ct-history-label">予約詳細（${list.length}件）</div>
    <div class="sales-list">${listHtml}</div>
  `;
}

// Chart.js は再描画のたびに canvas が作り直されるため、既存インスタンスを破棄してから再生成する
function _renderSalesCharts() {
  if (typeof Chart === 'undefined') return;

  const s = state.sales;
  const monthlyCanvas = document.getElementById('sales-monthly-chart');
  if (monthlyCanvas && s.monthlySummary) {
    if (_salesMonthlyChart) _salesMonthlyChart.destroy();
    const months = s.monthlySummary.months;
    _salesMonthlyChart = new Chart(monthlyCanvas, {
      type: 'bar',
      data: {
        labels: months.map(m => SALES_MONTH_NAMES[m.month - 1]),
        datasets: [{
          label: '売上',
          data: months.map(m => m.total),
          backgroundColor: 'rgba(46,125,50,0.55)',
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: v => '¥' + v.toLocaleString() } } },
      },
    });
  }

  const breakdownCanvas = document.getElementById('sales-breakdown-chart');
  if (breakdownCanvas && s.monthDetail) {
    if (_salesBreakdownChart) _salesBreakdownChart.destroy();
    const breakdown = s.monthDetail.menuBreakdown || [];
    if (breakdown.length > 0) {
      _salesBreakdownChart = new Chart(breakdownCanvas, {
        type: 'doughnut',
        data: {
          labels: breakdown.map(b => b.menuName),
          datasets: [{
            data: breakdown.map(b => b.total),
            backgroundColor: ['#2E7D32','#E65100','#1565C0','#6A1B9A','#C62828','#00695C','#AD8B00'],
          }],
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } },
      });
    }
  }
}

async function loadSalesYear(year) {
  state.sales.year    = year;
  state.sales.loading = true;
  renderContent();
  try {
    const result = await apiGet({ action: 'getSalesMonthlySummary', year });
    state.sales.monthlySummary = result;
  } catch (e) {
    state.sales.monthlySummary = null;
    showToast('売上データの取得に失敗しました', true);
  }
  state.sales.loading = false;
  renderContent();

  // 年を切り替えても同じ「月」のまま追従させる（初回は現在月）
  const baseMonth = state.sales.selectedMonth
    ? Number(state.sales.selectedMonth.split('-')[1])
    : new Date().getMonth() + 1;
  loadSalesMonthDetail(_ymStr(year, baseMonth));
}

async function loadSalesMonthDetail(yearMonth) {
  state.sales.selectedMonth = yearMonth;
  state.sales.monthLoading  = true;
  renderContent();

  const startDate = yearMonth + '-01';
  const endDate   = yearMonth + '-' + String(_lastDayOfMonth(yearMonth)).padStart(2, '0');

  try {
    const [breakdown, list] = await Promise.all([
      apiGet({ action: 'getSalesMenuBreakdown', yearMonth }),
      apiGet({ action: 'getSalesList', startDate, endDate }),
    ]);
    const today = todayStr();
    state.sales.monthDetail = {
      menuBreakdown: breakdown.menuBreakdown || [],
      serviceTypeBreakdown: breakdown.serviceTypeBreakdown || {},
      listData: (list || []).filter(r => r.date <= today).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)),
    };
  } catch (e) {
    state.sales.monthDetail = null;
    showToast('売上詳細の取得に失敗しました', true);
  }
  state.sales.monthLoading = false;
  renderContent();
}

function changeSalesYear(diff) {
  loadSalesYear(state.sales.year + diff);
}

function selectSalesMonth(yearMonth) {
  loadSalesMonthDetail(yearMonth);
}

// ============================================================
// 金額の手動入力・編集モーダル（売上タブ・顧客タブ共通）
// ============================================================
function openPriceEditModal(reservationId, currentPrice, context) {
  _priceEditContext = context;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'price-modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet" id="price-modal-sheet">
      <div class="modal-handle"></div>
      <div class="modal-header">
        <span class="modal-title">金額を入力</span>
        <button class="modal-close" onclick="closePriceEditModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="bk-field">
          <label class="bk-label">金額（円）</label>
          <input class="bk-input" id="price-modal-input" type="number" inputmode="numeric" min="0" step="100"
                 value="${currentPrice === '' ? '' : currentPrice}" placeholder="例：13000">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-confirm-reschedule" id="price-modal-save-btn"
                onclick="submitPriceEdit('${reservationId}')">保存する</button>
      </div>
    </div>`;

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closePriceEditModal();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    const sheet = document.getElementById('price-modal-sheet');
    if (sheet) sheet.classList.add('visible');
    const input = document.getElementById('price-modal-input');
    if (input) input.focus();
  });
}

function closePriceEditModal() {
  const overlay = document.getElementById('price-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  const sheet = document.getElementById('price-modal-sheet');
  if (sheet) sheet.classList.remove('visible');
  setTimeout(() => overlay.remove(), 300);
}

async function submitPriceEdit(reservationId) {
  const input = document.getElementById('price-modal-input');
  const btn   = document.getElementById('price-modal-save-btn');
  if (!input) return;

  const amount = Number(input.value);
  if (input.value === '' || !Number.isFinite(amount) || amount < 0) {
    showToast('金額を正しく入力してください', true);
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
  try {
    const result = await apiPost({ action: 'updateReservationPrice', reservationId, amount });
    if (result.error) throw new Error(result.error);
    showToast('金額を保存しました');
    closePriceEditModal();

    if (_priceEditContext === 'customer' && state.selectedCustomer && state.selectedCustomer.history) {
      const item = state.selectedCustomer.history.find(r => r.reservationId === reservationId);
      if (item) { item.price = amount; item.priceType = 'manual'; }
      renderContent();
    } else if (_priceEditContext === 'sales') {
      // 編集により月次集計・内訳も変わるため、サーバーから再取得する
      loadSalesYear(state.sales.year);
    }
  } catch (e) {
    showToast('保存に失敗しました: ' + e.message, true);
    if (btn) { btn.disabled = false; btn.textContent = '保存する'; }
  }
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

// ページが非表示→表示に戻ったとき（他タブから戻ってきたとき）に予約一覧を自動更新
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.phase === 'main') {
    if (state.tab === 'reservations' && !_reschedule) {
      loadFutureReservations();
    }
  }
});
