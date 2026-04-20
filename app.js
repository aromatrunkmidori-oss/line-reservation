'use strict';

// ============================================================
// ⚙️ 設定（デプロイ後にここを編集してください）
// ============================================================
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzbI4xCzAPOoZAMR06t5kKZAQuvu3EUF7pBNiqPDN7DIvvj38odiJfwLWGxB9jG_7lj1A/exec',
  LIFF_ID: '2009742884-e9ueuqGE',
};

// ============================================================
// 固定マスタ
// ============================================================
const COURSES = [
  'もみほぐし',
  'オイルトリートメント',
  'もみほぐし＋オイルトリートメント',
];

const DURATIONS = [60, 90, 120, 150, 180];

// SVGアイコン定義
const ICONS = {
  store: `<svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3L2 9v12h7v-7h6v7h7V9L12 3zm5 16h-3v-6H10v6H7V9.8l5-3.33 5 3.33V19z"/>
  </svg>`,
  car: `<svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
  </svg>`,
  hands: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M21 7c0-1.1-.9-2-2-2h-3V3c0-1.1-.9-2-2-2H4C2.9 1 2 1.9 2 3v11c0 1.1.9 2 2 2h2v2c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7zm-11 9H4V3h10v11H10zm9 2H8v-2h6V9h6v9z"/>
  </svg>`,
  calendar: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/>
  </svg>`,
  clock: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
  </svg>`,
};

// ============================================================
// 状態管理（State）
// ============================================================
const state = {
  phase:       'loading',   // loading | form | done | error
  step:         1,          // 1〜6
  errorMessage: '',
  lineUserId:   null,
  displayName:  '',
  pictureUrl:   '',
  customer:     null,
  settings:     null,
  karte:        null,
  form: {
    serviceType: '',   // 来店 | 出張
    course:      '',   // コース名
    duration:    null, // 施術時間（分）
    date:        '',   // yyyy-MM-dd
    timeSlot:    '',   // HH:mm
    endTime:     '',   // HH:mm
    name:        '',
    phone:       '',
    address:     '',
    isEditing:   false,
  },
  ui: {
    calendarYear:   new Date().getFullYear(),
    calendarMonth:  new Date().getMonth(),
    availableSlots: null,
    loadingSlots:   false,
  },
  reservation: null,
};

// ============================================================
// API 通信
// ============================================================
async function apiGet(action, params = {}) {
  const url = new URL(CONFIG.GAS_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error('通信エラーが発生しました (GET ' + action + ')');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function apiPost(data) {
  const res = await fetch(CONFIG.GAS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error('通信エラーが発生しました (POST ' + data.action + ')');
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

// ============================================================
// ユーティリティ
// ============================================================
function formatDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function formatJapanese(dateStr) {
  if (!dateStr) return '';
  const date     = new Date(dateStr + 'T00:00:00+09:00');
  const dayNames = ['日','月','火','水','木','金','土'];
  return `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日（${dayNames[date.getDay()]}）`;
}

function addMinutes(timeStr, min) {
  const [h, m] = timeStr.split(':').map(Number);
  const total  = h * 60 + m + min;
  return String(Math.floor(total/60)).padStart(2,'0') + ':' + String(total%60).padStart(2,'0');
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (h >= 24) return '翌' + String(h - 24).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  return timeStr;
}

function isHoliday(dateStr, date, holidays) {
  const dayNames = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];
  return holidays.includes(dayNames[date.getDay()]) || holidays.includes(dateStr);
}

function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className   = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ============================================================
// レンダリング（メイン）
// ============================================================
function render() {
  const app = document.getElementById('app');

  if (state.phase === 'loading') {
    app.innerHTML = `
      <div class="loading-screen">
        <div class="loading-logo">trunk</div>
        <div class="spinner"></div>
      </div>`;
    return;
  }

  if (state.phase === 'error') {
    app.innerHTML = `
      <div class="error-screen">
        <div class="icon">⚠️</div>
        <h2>エラーが発生しました</h2>
        <p>${state.errorMessage || '予期せぬエラーが発生しました。'}</p>
        <button class="btn btn-primary" style="margin-top:16px;max-width:200px"
          onclick="location.reload()">再読み込み</button>
      </div>`;
    return;
  }

  if (state.phase === 'done') {
    app.innerHTML = renderDone();
    return;
  }

  const TOTAL_STEPS  = 6;
  const stepTitles   = ['種別', 'コース', '時間', '日付', '時間帯', 'お客様'];
  let   stepContent  = '';

  switch (state.step) {
    case 1: stepContent = renderStep1(); break;
    case 2: stepContent = renderStep2(); break;
    case 3: stepContent = renderStep3(); break;
    case 4: stepContent = renderStep4(); break;
    case 5: stepContent = renderStep5(); break;
    case 6: stepContent = renderStep6(); break;
  }

  app.innerHTML = `
    <div class="header">
      ${state.step > 1
        ? `<button class="header-back" onclick="goBack()">‹</button>`
        : `<div class="header-spacer"></div>`}
      <span class="header-logo">trunk</span>
      <div class="header-spacer"></div>
    </div>
    <div class="progress-wrap">
      <div class="progress-track">
        <div class="progress-fill" style="width:${(state.step / TOTAL_STEPS) * 100}%"></div>
      </div>
      <div class="progress-steps">
        ${stepTitles.map((t, i) => `
          <span class="progress-step ${i+1 === state.step ? 'active' : i+1 < state.step ? 'done' : ''}">
            ${i+1 < state.step ? '✓' : i+1}. ${t}
          </span>`).join('')}
      </div>
    </div>
    <div class="content">${stepContent}</div>
    <div class="btn-area" id="btn-area"></div>`;

  renderButtons();
}

// ============================================================
// ボタンエリア
// ============================================================
function renderButtons() {
  const area = document.getElementById('btn-area');
  if (!area) return;

  switch (state.step) {
    case 1:
      area.innerHTML = ''; // カードタップで進む
      break;
    case 2:
      area.innerHTML = `
        <button class="btn btn-primary" onclick="goNext()"
          ${!state.form.course ? 'disabled' : ''}>次へ　›</button>`;
      break;
    case 3:
      area.innerHTML = `
        <button class="btn btn-primary" onclick="goNext()"
          ${!state.form.duration ? 'disabled' : ''}>次へ　›</button>`;
      break;
    case 4:
      area.innerHTML = `
        <button class="btn btn-primary" onclick="onDateNext()"
          ${!state.form.date ? 'disabled' : ''}>この日で時間を選ぶ　›</button>`;
      break;
    case 5:
      area.innerHTML = `
        <button class="btn btn-primary" onclick="goNext()"
          ${!state.form.timeSlot ? 'disabled' : ''}>次へ　›</button>`;
      break;
    case 6:
      area.innerHTML = `
        <button class="btn btn-primary" onclick="submitReservation()">予約を確定する</button>`;
      break;
  }
}

// ============================================================
// STEP 1：来店 or 出張
// ============================================================
function renderStep1() {
  return `
    <p class="section-title">来店 or 出張</p>
    <p class="section-sub">ご希望のサービス形式をお選びください</p>
    <div class="service-grid">
      <button class="service-btn ${state.form.serviceType === '来店' ? 'selected' : ''}"
        onclick="selectServiceType('来店')">
        <span class="service-icon">${ICONS.store}</span>
        <span class="label">来店</span>
        <span class="desc">サロンにお越しください</span>
      </button>
      <button class="service-btn ${state.form.serviceType === '出張' ? 'selected' : ''}"
        onclick="selectServiceType('出張')">
        <span class="service-icon">${ICONS.car}</span>
        <span class="label">出張</span>
        <span class="desc">ご指定場所へお伺いします</span>
      </button>
    </div>`;
}

function selectServiceType(type) {
  state.form.serviceType = type;
  state.form.course      = '';
  state.form.duration    = null;
  state.form.date        = '';
  state.form.timeSlot    = '';
  state.step = 2;
  render();
}

// ============================================================
// STEP 2：コース選択（時間・料金なし）
// ============================================================
function renderStep2() {
  const checkSvg = `<svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>`;
  const items = COURSES.map(name => {
    const selected = state.form.course === name;
    return `
      <button class="course-item ${selected ? 'selected' : ''}"
        onclick="selectCourse(this, '${name}')">
        <span class="course-name">${name}</span>
        <span class="course-check">${checkSvg}</span>
      </button>`;
  }).join('');

  return `
    <p class="section-title">コース選択</p>
    <p class="section-sub">ご希望のコースをお選びください</p>
    <div class="course-list">${items}</div>`;
}

function selectCourse(el, name) {
  state.form.course   = name;
  state.form.duration = null;
  state.form.date     = '';
  state.form.timeSlot = '';
  state.ui.availableSlots = null;
  renderButtons();
  document.querySelectorAll('.course-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

// ============================================================
// STEP 3：時間選択（90 / 120 / 150 / 180分）
// ============================================================
function renderStep3() {
  const items = DURATIONS.map(min => {
    const selected = state.form.duration === min;
    const h  = Math.floor(min / 60);
    const m  = min % 60;
    const label = m > 0 ? `${h}時間${m}分` : `${h}時間`;
    return `
      <button class="duration-btn ${selected ? 'selected' : ''}"
        onclick="selectDuration(this, ${min})">
        <span class="duration-min">${min}分</span>
        <span class="duration-label">${label}</span>
      </button>`;
  }).join('');

  return `
    <p class="section-title">時間選択</p>
    <p class="section-sub">施術時間をお選びください</p>
    <div class="duration-grid">${items}</div>`;
}

function selectDuration(el, min) {
  state.form.duration = min;
  state.form.date     = '';
  state.form.timeSlot = '';
  state.ui.availableSlots = null;
  renderButtons();
  document.querySelectorAll('.duration-btn').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

// ============================================================
// STEP 4：日付選択（カレンダー）
// ============================================================
function renderStep4() {
  const { calendarYear: year, calendarMonth: month } = state.ui;
  const holidays   = state.settings?.holidays || [];
  const today      = new Date(); today.setHours(0,0,0,0);
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  const firstDay     = new Date(year, month, 1);
  const lastDay      = new Date(year, month + 1, 0);
  const prevDisabled = year < today.getFullYear() ||
    (year === today.getFullYear() && month <= today.getMonth());

  let gridHtml = `
    <div class="calendar-grid">
      ${['日','月','火','水','木','金','土'].map(d => `<div class="cal-day-header">${d}</div>`).join('')}
      ${Array(firstDay.getDay()).fill('<div class="cal-day empty"></div>').join('')}`;

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date    = new Date(year, month, d);
    const dateStr = formatDateStr(date);
    const isPast  = date < today;
    const isHol   = isHoliday(dateStr, date, holidays);
    const isSel   = dateStr === state.form.date;
    const isTod   = formatDateStr(date) === formatDateStr(today);
    const dow     = date.getDay();
    const classes = ['cal-day',
      isPast || isHol ? 'disabled' : '',
      isSel ? 'selected' : '',
      isTod ? 'today' : '',
      dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : '',
    ].filter(Boolean).join(' ');

    gridHtml += `<div class="${classes}"
      ${!isPast && !isHol ? `onclick="selectDate('${dateStr}')"` : ''}>
      ${d}</div>`;
  }
  gridHtml += '</div>';

  return `
    <p class="section-title">日付選択</p>
    <p class="section-sub">ご希望の日付をお選びください</p>
    <div class="calendar-wrap">
      <div class="calendar-nav">
        <button class="cal-nav-btn" onclick="changeMonth(-1)" ${prevDisabled ? 'disabled' : ''}>‹</button>
        <span class="cal-month-label">${year}年 ${monthNames[month]}</span>
        <button class="cal-nav-btn" onclick="changeMonth(1)">›</button>
      </div>
      ${gridHtml}
    </div>`;
}

function changeMonth(delta) {
  let m = state.ui.calendarMonth + delta;
  let y = state.ui.calendarYear;
  if (m < 0)  { m = 11; y--; }
  if (m > 11) { m = 0;  y++; }
  state.ui.calendarMonth = m;
  state.ui.calendarYear  = y;
  render();
}

function selectDate(dateStr) {
  state.form.date     = dateStr;
  state.form.timeSlot = '';
  state.form.endTime  = '';
  state.ui.availableSlots = null;
  render();
}

async function onDateNext() {
  if (!state.form.date) return;
  state.step = 5;
  state.ui.loadingSlots   = true;
  state.ui.availableSlots = null;
  render();

  try {
    const res = await apiGet('getAvailableSlots', {
      date:        state.form.date,
      duration:    state.form.duration,
      serviceType: state.form.serviceType,
    });
    state.ui.availableSlots = res;
  } catch (err) {
    showToast('空き枠の取得に失敗しました');
    state.ui.availableSlots = { available: false, reason: err.message, slots: [] };
  }

  state.ui.loadingSlots = false;
  render();
}

// ============================================================
// STEP 5：時間スロット選択
// ============================================================
function renderStep5() {
  if (state.ui.loadingSlots) {
    return `
      <p class="section-title">時間帯選択</p>
      <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
      <div class="loading-overlay">
        <div class="spinner"></div>
        <span>空き枠を確認中...</span>
      </div>`;
  }

  const slotsData = state.ui.availableSlots;

  if (!slotsData || !slotsData.available) {
    return `
      <p class="section-title">時間帯選択</p>
      <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
      <div class="no-slots">
        ${slotsData?.reason || 'この日は予約を受け付けていません。'}<br>
        <button class="btn btn-secondary" style="margin-top:16px;max-width:200px"
          onclick="goBack()">日付を選び直す</button>
      </div>`;
  }

  const available = slotsData.slots.filter(s => s.available);
  if (available.length === 0) {
    return `
      <p class="section-title">時間帯選択</p>
      <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
      <div class="no-slots">
        この日は満席です。別の日付をお選びください。<br>
        <button class="btn btn-secondary" style="margin-top:16px;max-width:200px"
          onclick="goBack()">日付を選び直す</button>
      </div>`;
  }

  const duration = state.form.duration || 90;
  const slotBtns = slotsData.slots.map(s => {
    const end      = addMinutes(s.time, duration);
    const selected = state.form.timeSlot === s.time;
    const cls      = selected ? 'slot-btn selected' : s.available ? 'slot-btn available' : 'slot-btn unavailable';
    const onclick  = s.available ? `onclick="selectSlot('${s.time}','${end}')"` : '';
    return `
      <button class="${cls}" ${onclick} ${!s.available ? 'disabled' : ''}>
        ${s.time}
        <span class="slot-end">〜${formatTime(end)}</span>
      </button>`;
  }).join('');

  return `
    <p class="section-title">時間帯選択</p>
    <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
    <div class="slot-grid">${slotBtns}</div>`;
}

function selectSlot(time, endTime) {
  state.form.timeSlot = time;
  state.form.endTime  = endTime;
  render();
}

// ============================================================
// STEP 6：お客様情報
// ============================================================
function renderStep6() {
  const isReturning = state.customer?.exists;
  const f           = state.form;
  const h = Math.floor(f.duration / 60);
  const m = f.duration % 60;
  const durationLabel = m > 0 ? `${h}時間${m}分` : `${h}時間`;

  const summary = `
    <div class="summary-card">
      <div class="summary-row">
        <span class="summary-icon">${f.serviceType === '来店' ? ICONS.store.replace('52','18').replace('52','18') : ''}</span>
        <span class="summary-label">種別</span>
        <span class="summary-value">${f.serviceType}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">コース</span>
        <span class="summary-value">${f.course}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">時間</span>
        <span class="summary-value">${f.duration}分（${durationLabel}）</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">日時</span>
        <span class="summary-value">${formatJapanese(f.date)}<br>${f.timeSlot}〜${formatTime(f.endTime)}</span>
      </div>
    </div>`;

  if (isReturning && !f.isEditing) {
    const prevKarte = state.karte?.entries?.[0];
    return `
      <p class="section-title">お客様情報</p>
      <p class="section-sub">前回の情報を引き継いでいます。変更がある場合は「編集する」をタップしてください。</p>
      ${summary}
      <div class="info-card">
        <div class="info-row">
          <span class="info-key">お名前</span>
          <span class="info-value">${state.customer.name}</span>
        </div>
        <button class="edit-toggle" onclick="startEditing()">編集する</button>
      </div>
      ${prevKarte ? `
      <div class="karte-prev">
        <div class="karte-prev-title">前回の記録（${prevKarte.date}）</div>
        ${prevKarte.treatmentContent ? `<div class="karte-prev-row"><span class="karte-prev-label">施術：</span>${prevKarte.treatmentContent}</div>` : ''}
        ${prevKarte.nextNotes ? `<div class="karte-prev-row"><span class="karte-prev-label">申し送り：</span>${prevKarte.nextNotes}</div>` : ''}
      </div>` : ''}`;
  }

  const nameVal    = f.name    || (isReturning ? state.customer.name    : '');
  const addressVal = f.address || (isReturning ? state.customer.address : '');

  return `
    <p class="section-title">お客様情報</p>
    <p class="section-sub">ご予約に必要な情報をご入力ください</p>
    ${summary}
    <div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:var(--radius);padding:18px;margin-bottom:12px;box-shadow:var(--shadow-sm)">
      <div class="form-group">
        <label class="form-label">お名前<span class="required">必須</span></label>
        <input class="form-input" type="text" id="input-name"
          placeholder="山田 花子" value="${nameVal}"
          oninput="state.form.name = this.value">
      </div>
      ${f.serviceType === '出張' ? `
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">訪問先住所<span class="required">必須</span></label>
        <input class="form-input" type="text" id="input-address"
          placeholder="東京都渋谷区〇〇1-2-3" value="${addressVal}"
          oninput="state.form.address = this.value">
        ${isReturning ? `<p class="form-hint">前回の住所を引き継いでいます。変更がある場合はご修正ください。</p>` : `<p class="form-hint">当日伺う住所をご入力ください</p>`}
      </div>` : ''}
    </div>`;
}

function startEditing() {
  state.form.isEditing = true;
  state.form.name      = state.customer?.name    || '';
  state.form.address   = state.customer?.address || '';
  render();
}

// ============================================================
// 完了画面
// ============================================================
function renderDone() {
  const r = state.reservation;
  return `
    <div class="done-screen">
      <div class="done-mark">
        <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6,16 13,23 26,9"/>
        </svg>
      </div>
      <h2 class="done-title">予約が完了しました</h2>
      <p class="done-sub">LINEに予約確認メッセージをお送りしました。<br>前日にもリマインドをお送りします。</p>
      <div class="done-detail">
        <div class="summary-row">
          <span class="summary-label">コース</span>
          <span class="summary-value">${r?.menuName || ''}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">日時</span>
          <span class="summary-value">${formatJapanese(r?.date || '')}<br>${r?.startTime || ''}〜${formatTime(r?.endTime || '')}</span>
        </div>
        <div class="summary-row">
          <span class="summary-label">種別</span>
          <span class="summary-value">${r?.serviceType || ''}</span>
        </div>
        ${r?.serviceType === '出張' && r?.address ? `
        <div class="summary-row">
          <span class="summary-label">住所</span>
          <span class="summary-value">${r.address}</span>
        </div>` : ''}
      </div>
      <button class="btn btn-primary" style="max-width:200px"
        onclick="liff.closeWindow()">閉じる</button>
    </div>`;
}

// ============================================================
// ナビゲーション
// ============================================================
function goNext() {
  if (state.step < 6) {
    state.step++;
    render();
    window.scrollTo(0, 0);
  }
}

function goBack() {
  if (state.step > 1) {
    if (state.step === 5) {
      state.form.timeSlot = '';
      state.form.endTime  = '';
    }
    if (state.step === 6) {
      state.form.isEditing = false;
    }
    state.step--;
    render();
    window.scrollTo(0, 0);
  }
}

// ============================================================
// 予約送信
// ============================================================
async function submitReservation() {
  const f           = state.form;
  const isReturning = state.customer?.exists;
  const nameVal     = f.name    || (isReturning && !f.isEditing ? state.customer?.name    : '');
  const addressVal  = f.address || (isReturning && !f.isEditing ? state.customer?.address : '');

  if (!nameVal.trim()) {
    showToast('お名前を入力してください');
    document.getElementById('input-name')?.focus();
    return;
  }
  if (f.serviceType === '出張' && !addressVal.trim()) {
    showToast('訪問先住所を入力してください');
    document.getElementById('input-address')?.focus();
    return;
  }

  const btn = document.querySelector('.btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '送信中...'; }

  try {
    const result = await apiPost({
      action:       'createReservation',
      lineUserId:   state.lineUserId,
      customerName: nameVal.trim(),
      serviceType:  f.serviceType,
      menuName:     f.course,          // コース名をメニュー名として送信
      duration:     f.duration,
      date:         f.date,
      startTime:    f.timeSlot,
      address:      addressVal.trim(),
    });

    state.reservation = result.reservation;
    state.phase       = 'done';
    render();
    window.scrollTo(0, 0);

  } catch (err) {
    showToast(err.message || '予約の送信に失敗しました');
    if (btn) { btn.disabled = false; btn.textContent = '予約を確定する'; }
  }
}

// ============================================================
// 初期化
// ============================================================
async function init() {
  try {
    await liff.init({ liffId: CONFIG.LIFF_ID });

    if (!liff.isInClient()) {
      state.phase        = 'error';
      state.errorMessage = 'このページはLINEアプリ内でのみご利用いただけます。\nLINEアプリから開いてください。';
      render();
      return;
    }

    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    const profile     = await liff.getProfile();
    state.lineUserId  = profile.userId;
    state.displayName = profile.displayName;
    state.pictureUrl  = profile.pictureUrl;

    // 必須の2件だけ先に取得してすぐ表示（カルテは後回し）
    const [settings, customer] = await Promise.all([
      apiGet('getSettings'),
      apiGet('getCustomerInfo', { lineUserId: state.lineUserId }),
    ]);

    state.settings = settings;
    state.customer = customer;

    if (customer?.exists) {
      state.form.name    = customer.name    || '';
      state.form.phone   = customer.phone   || '';
      state.form.address = customer.address || '';
    }

    // フォームをすぐ表示
    state.phase = 'form';
    render();

    // カルテはバックグラウンドで取得（表示をブロックしない）
    apiGet('getKarte', { lineUserId: state.lineUserId })
      .then(karte => { state.karte = karte; })
      .catch(() => { state.karte = { entries: [] }; });

  } catch (err) {
    console.error(err);
    state.phase        = 'error';
    state.errorMessage = err.message || '初期化に失敗しました。';
    render();
  }
}

init();
