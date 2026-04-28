'use strict';

// ============================================================
// 設定
// ============================================================
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzbI4xCzAPOoZAMR06t5kKZAQuvu3EUF7pBNiqPDN7DIvvj38odiJfwLWGxB9jG_7lj1A/exec',
  LIFF_ID: '2009742884-e9ueuqGE',
};

// ============================================================
// マスタデータ
// ============================================================

const COURSES_VISIT = [
  { name: '矯正＋オイル', duration: 100, price: 13000 },
  { name: '矯正＋オイル', duration: 130, price: 15000 },
];

const OPTIONS_VISIT = [
  { name: 'オプションなし', price: 0,    duration: 0  },
  { name: 'ヘッド',         price: 3000, duration: 30 },
  { name: 'フット',         price: 3000, duration: 30 },
  { name: '腸モミ',         price: 3000, duration: 30 },
];

const COURSES_MOBILE = [
  'もみほぐし',
  'オイルトリートメント',
  'もみほぐし＋オイルトリートメント',
];

const DURATIONS = [60, 90, 120, 150, 180];

const ICONS = {
  store: `<svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20 4H4v2l-2 5h2v7c0 .55.45 1 1 1h5v-4h4v4h5c.55 0 1-.45 1-1v-7h2L20 6V4zm-5 7h-2V9h2v2zm-4 0H9V9h2v2z"/>
  </svg>`,
  car: `<svg width="52" height="52" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
  </svg>`,
};

// ============================================================
// 状態管理
// ============================================================
const state = {
  phase:       'loading',
  step:         1,
  errorMessage: '',
  lineUserId:   null,
  displayName:  '',
  pictureUrl:   '',
  customer:     null,
  settings:     null,
  karte:        null,
  form: {
    serviceType: '',
    course:      '',
    duration:    null,   // 基本施術時間（分）
    price:       0,      // 基本料金
    options:     [],     // 選択中オプション [{name, price, duration}]
    noOption:    false,  // 「オプションなし」選択フラグ
    date:        '',
    timeSlot:    '',
    endTime:     '',
    name:        '',
    address:     '',
    note:        '',
    isEditing:   false,
  },
  ui: {
    calendarYear:   new Date().getFullYear(),
    calendarMonth:  new Date().getMonth(),
    availableSlots: null,
    loadingSlots:   false,
    // 月間空き状況インジケーター
    monthAvailability:        {},   // dateStr → 'available'|'full'|'unavailable'|'past'|'holiday'
    monthAvailabilityKey:     '',   // キャッシュキー（月・種別・時間が変わったら再取得）
    monthAvailabilityLoading: false,
  },
  reservation: null,
};

// ============================================================
// ステップ構成
// 来店: 1=種別 2=コース 3=オプション 4=確認 5=日付 6=時間帯 7=顧客情報
// 出張: 1=種別 2=コース 3=時間     4=日付  5=時間帯 6=確認  7=顧客情報
// ============================================================
function isVisit() { return state.form.serviceType === '来店'; }
function getTotalSteps() { return 7; }
function getStepTitles() {
  return isVisit()
    ? ['種別', 'コース', 'オプション', '確認', '日付', '時間帯', 'お客様']
    : ['種別', 'コース', '時間', '日付', '時間帯', '確認', 'お客様'];
}
function stepNum(name) {
  const v = { serviceType:1, course:2, option:3, confirm:4, date:5, slot:6, customer:7 };
  const m = { serviceType:1, course:2, duration:3, date:4, slot:5, confirm:6, customer:7 };
  return (isVisit() ? v : m)[name] || 1;
}

// 出張料金：60分¥10,000、以降30分ごと+¥5,000
function getMobilePrice(duration) {
  return 10000 + ((duration - 60) / 30) * 5000;
}

// 深夜料金：終了時刻が24:00を超えた分を30分ブロックごとに+¥500
function calcMidnightSurcharge(startTime, duration) {
  if (!startTime || !duration) return 0;
  const [h, m] = startTime.split(':').map(Number);
  const endMin = h * 60 + m + duration;
  const midnightMin = 24 * 60;
  if (endMin <= midnightMin) return 0;
  const blocks = Math.ceil((endMin - midnightMin) / 30);
  return blocks * 500;
}

// 合計時間・合計料金（来店用）
function getTotalDuration() {
  const f = state.form;
  return (f.duration || 0) + f.options.reduce((s, o) => s + o.duration, 0);
}
function getTotalPrice() {
  const f = state.form;
  return f.price + f.options.reduce((s, o) => s + o.price, 0);
}

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
function formatPrice(n) {
  return '¥' + Number(n).toLocaleString();
}
// 「100分（1時間40分）」形式
function formatDuration(min) {
  const h  = Math.floor(min / 60);
  const m  = min % 60;
  const hm = m > 0 ? `${h}時間${m}分` : `${h}時間`;
  return `${min}分（${hm}）`;
}
// 短縮形「1時間40分」
function shortDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
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

  const totalSteps = state.step === 1 ? 6 : getTotalSteps();
  const titles     = state.step === 1
    ? ['種別', 'コース', '', '', '日付', '時間帯', 'お客様']
    : getStepTitles();

  let stepContent = '';
  if (state.step === 1) {
    stepContent = renderStep1();
  } else if (isVisit()) {
    switch (state.step) {
      case 2: stepContent = renderVisitCourse();  break;
      case 3: stepContent = renderVisitOption();  break;
      case 4: stepContent = renderVisitConfirm(); break;
      case 5: stepContent = renderDatePicker();   break;
      case 6: stepContent = renderSlots();        break;
      case 7: stepContent = renderCustomer();     break;
    }
  } else {
    switch (state.step) {
      case 2: stepContent = renderMobileCourse();   break;
      case 3: stepContent = renderMobileDuration(); break;
      case 4: stepContent = renderDatePicker();     break;
      case 5: stepContent = renderSlots();          break;
      case 6: stepContent = renderMobileConfirm();  break;
      case 7: stepContent = renderCustomer();       break;
    }
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
        <div class="progress-fill" style="width:${(state.step / totalSteps) * 100}%"></div>
      </div>
      <div class="progress-steps">
        ${titles.slice(0, totalSteps).map((t, i) => `
          <span class="progress-step ${i+1 === state.step ? 'active' : i+1 < state.step ? 'done' : ''}">
            ${i+1 < state.step ? '✓' : i+1}. ${t}
          </span>`).join('')}
      </div>
    </div>
    <div class="content">${stepContent}</div>
    <div class="btn-area" id="btn-area"></div>`;

  renderButtons();

  // 日付ステップを表示したとき、月間空き状況を非同期で取得
  if (state.phase === 'form' && state.step === stepNum('date')) {
    loadMonthAvailability();
  }
}

// ============================================================
// ボタンエリア
// ============================================================
function renderButtons() {
  const area = document.getElementById('btn-area');
  if (!area) return;
  const f = state.form;

  if (state.step === 1) { area.innerHTML = ''; return; }

  if (isVisit()) {
    const optionChosen = f.noOption || f.options.length > 0;
    switch (state.step) {
      case 2:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()"
          ${!f.course || !f.duration ? 'disabled' : ''}>次へ　›</button>`;
        break;
      case 3:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()"
          ${!optionChosen ? 'disabled' : ''}>内容を確認する　›</button>`;
        break;
      case 4:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()">日付を選ぶ　›</button>`;
        break;
      case 5:
        area.innerHTML = `<button class="btn btn-primary" onclick="onDateNext()"
          ${!f.date ? 'disabled' : ''}>この日で時間を選ぶ　›</button>`;
        break;
      case 6:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()"
          ${!f.timeSlot ? 'disabled' : ''}>次へ　›</button>`;
        break;
      case 7:
        area.innerHTML = `<button class="btn btn-primary" onclick="submitReservation()">予約を確定する</button>`;
        break;
    }
  } else {
    switch (state.step) {
      case 2:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()"
          ${!f.course ? 'disabled' : ''}>次へ　›</button>`;
        break;
      case 3:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()"
          ${!f.duration ? 'disabled' : ''}>次へ　›</button>`;
        break;
      case 4:
        area.innerHTML = `<button class="btn btn-primary" onclick="onDateNext()"
          ${!f.date ? 'disabled' : ''}>この日で時間を選ぶ　›</button>`;
        break;
      case 5:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()"
          ${!f.timeSlot ? 'disabled' : ''}>次へ　›</button>`;
        break;
      case 6:
        area.innerHTML = `<button class="btn btn-primary" onclick="goNext()">お客様情報を入力する　›</button>`;
        break;
      case 7:
        area.innerHTML = `<button class="btn btn-primary" onclick="submitReservation()">予約を確定する</button>`;
        break;
    }
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
  state.form.price       = 0;
  state.form.options     = [];
  state.form.noOption    = false;
  state.form.date        = '';
  state.form.timeSlot    = '';
  state.form.endTime     = '';
  state.form.note        = '';
  state.step = 2;
  render();
}

// ============================================================
// STEP 2（来店）：コース＋時間選択
// ============================================================
function renderVisitCourse() {
  const checkSvg = `<svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>`;
  const items = COURSES_VISIT.map((c, i) => {
    const selected = state.form.duration === c.duration && state.form.course === c.name;
    return `
      <button class="course-item ${selected ? 'selected' : ''}"
        onclick="selectVisitCourse(this, ${i})">
        <div>
          <div class="course-name">${c.name}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">
            ${formatDuration(c.duration)}　${formatPrice(c.price)}
          </div>
        </div>
        <span class="course-check">${checkSvg}</span>
      </button>`;
  }).join('');
  return `
    <p class="section-title">コース・時間選択</p>
    <p class="section-sub">ご希望のコースをお選びください</p>
    <div class="course-list">${items}</div>`;
}

function selectVisitCourse(el, index) {
  const c = COURSES_VISIT[index];
  state.form.course   = c.name;
  state.form.duration = c.duration;
  state.form.price    = c.price;
  // オプション・日時をリセット
  state.form.options  = [];
  state.form.noOption = false;
  state.form.date     = '';
  state.form.timeSlot = '';
  renderButtons();
  document.querySelectorAll('.course-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

// ============================================================
// STEP 3（来店）：オプション選択（複数可）
// ============================================================
function renderVisitOption() {
  const checkSvg = `<svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>`;
  const items = OPTIONS_VISIT.map((o, i) => {
    const isNoOpt  = o.name === 'オプションなし';
    const selected = isNoOpt
      ? state.form.noOption
      : state.form.options.some(x => x.name === o.name);
    const sub = isNoOpt
      ? '追加料金なし'
      : `+${formatDuration(o.duration)}　+${formatPrice(o.price)}`;
    return `
      <button class="course-item ${selected ? 'selected' : ''}"
        onclick="selectVisitOption(${i})">
        <div>
          <div class="course-name">${o.name}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${sub}</div>
        </div>
        <span class="course-check">${checkSvg}</span>
      </button>`;
  }).join('');
  return `
    <p class="section-title">オプション選択</p>
    <p class="section-sub">複数選択できます</p>
    <div class="course-list">${items}</div>
    <div style="background:var(--accent-pale);border:1px solid #E8D5C0;border-radius:var(--radius-sm);padding:12px 14px;margin-top:16px;font-size:12px;color:var(--accent);line-height:1.7">
      他のご要望などがある場合は、予約後にチャットにてご相談ください。
    </div>`;
}

function selectVisitOption(index) {
  const o = OPTIONS_VISIT[index];
  if (o.name === 'オプションなし') {
    state.form.options  = [];
    state.form.noOption = true;
  } else {
    state.form.noOption = false;
    const idx = state.form.options.findIndex(x => x.name === o.name);
    if (idx >= 0) {
      state.form.options.splice(idx, 1);
    } else {
      state.form.options.push(o);
    }
  }
  render();
}

// ============================================================
// STEP 4（来店）：確認ページ
// ============================================================
function renderVisitConfirm() {
  const f        = state.form;
  const totalDur = getTotalDuration();
  const total    = getTotalPrice();
  const hasOpts  = f.options.length > 0;

  const optRows = hasOpts
    ? f.options.map(o => `
      <div class="summary-row">
        <span class="summary-label">${o.name}</span>
        <span class="summary-value">+${formatDuration(o.duration)}　+${formatPrice(o.price)}</span>
      </div>`).join('')
    : `<div class="summary-row">
        <span class="summary-label">オプション</span>
        <span class="summary-value">なし</span>
      </div>`;

  return `
    <p class="section-title">ご予約内容の確認</p>
    <p class="section-sub">以下の内容でよろしければ日付を選んでください</p>
    <div class="summary-card">
      <div class="summary-row">
        <span class="summary-label">コース</span>
        <span class="summary-value">${f.course}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">基本時間</span>
        <span class="summary-value">${formatDuration(f.duration)}</span>
      </div>
      ${optRows}
    </div>
    <div style="background:var(--primary-pale);border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:13px;color:var(--text-secondary)">合計時間</span>
        <span style="font-size:16px;font-weight:700;color:var(--text-primary)">${formatDuration(totalDur)}</span>
      </div>
      <div style="height:1px;background:var(--border-light);margin-bottom:10px"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--text-secondary)">合計金額</span>
        <span style="font-size:26px;font-weight:700;color:var(--primary)">${formatPrice(total)}</span>
      </div>
    </div>`;
}

// ============================================================
// STEP 6（出張）：確認ページ（深夜料金反映）
// ============================================================
function renderMobileConfirm() {
  const f         = state.form;
  const basePrice = getMobilePrice(f.duration);
  const surcharge = calcMidnightSurcharge(f.timeSlot, f.duration);
  const total     = basePrice + surcharge;

  // 深夜料金の内訳（24:00を超えた分数）
  const [h, m]       = f.timeSlot.split(':').map(Number);
  const endMin       = h * 60 + m + f.duration;
  const midMin       = 24 * 60;
  const overMin      = surcharge > 0 ? endMin - midMin : 0;

  const surchargeRow = surcharge > 0 ? `
    <div class="summary-row">
      <span class="summary-label">深夜料金</span>
      <span class="summary-value" style="color:var(--accent)">
        +${formatPrice(surcharge)}<br>
        <span style="font-size:11px;font-weight:400;color:var(--text-secondary)">
          （24:00超 ${overMin}分）
        </span>
      </span>
    </div>` : '';

  return `
    <p class="section-title">ご予約内容の確認</p>
    <p class="section-sub">以下の内容でよろしければお客様情報を入力してください</p>
    <div class="summary-card">
      <div class="summary-row">
        <span class="summary-label">コース</span>
        <span class="summary-value">${f.course}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">時間</span>
        <span class="summary-value">${formatDuration(f.duration)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">日時</span>
        <span class="summary-value">${formatJapanese(f.date)}<br>${f.timeSlot}〜${formatTime(addMinutes(f.timeSlot, f.duration))}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">基本料金</span>
        <span class="summary-value">${formatPrice(basePrice)}</span>
      </div>
      ${surchargeRow}
    </div>
    <div style="background:var(--primary-pale);border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;margin-top:8px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--text-secondary)">合計金額</span>
        <span style="font-size:26px;font-weight:700;color:var(--primary)">${formatPrice(total)}</span>
      </div>
    </div>`;
}

// ============================================================
// STEP 2（出張）：コース選択
// ============================================================
function renderMobileCourse() {
  const checkSvg = `<svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>`;
  const items = COURSES_MOBILE.map(name => {
    const selected = state.form.course === name;
    return `
      <button class="course-item ${selected ? 'selected' : ''}"
        onclick="selectMobileCourse(this, '${name}')">
        <span class="course-name">${name}</span>
        <span class="course-check">${checkSvg}</span>
      </button>`;
  }).join('');
  return `
    <p class="section-title">コース選択</p>
    <p class="section-sub">ご希望のコースをお選びください</p>
    <div class="course-list">${items}</div>`;
}

function selectMobileCourse(el, name) {
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
// STEP 3（出張）：時間・料金選択
// ============================================================
function renderMobileDuration() {
  const checkSvg = `<svg viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>`;
  const items = DURATIONS.map(min => {
    const price    = getMobilePrice(min);
    const selected = state.form.duration === min;
    return `
      <button class="course-item ${selected ? 'selected' : ''}"
        onclick="selectDuration(this, ${min})">
        <div>
          <div class="course-name">${formatDuration(min)}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">${formatPrice(price)}</div>
        </div>
        <span class="course-check">${checkSvg}</span>
      </button>`;
  }).join('');
  return `
    <p class="section-title">時間・料金選択</p>
    <p class="section-sub">施術時間をお選びください</p>
    <div class="course-list">${items}</div>
    <div style="background:var(--accent-pale);border:1px solid #E8D5C0;border-radius:var(--radius-sm);padding:12px 14px;margin-top:16px;font-size:12px;color:var(--accent);line-height:1.9">
      <div>・24:00を超えた場合は30分につき500円増となります。（深夜料金）</div>
      <div>・都心部への出張の場合は90分以上からのご予約をお願いいたします。</div>
    </div>`;
}

function selectDuration(el, min) {
  // 選択済みをもう一度クリックしたら解除
  if (state.form.duration === min) {
    state.form.duration = null;
    state.form.date     = '';
    state.form.timeSlot = '';
    state.ui.availableSlots = null;
    render();
    return;
  }
  state.form.duration = min;
  state.form.date     = '';
  state.form.timeSlot = '';
  state.ui.availableSlots = null;
  renderButtons();
  document.querySelectorAll('.course-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
}

// ============================================================
// 日付選択
// ============================================================
function renderDatePicker() {
  const { calendarYear: year, calendarMonth: month } = state.ui;
  const holidays   = state.settings?.holidays || [];
  const today      = new Date(); today.setHours(0,0,0,0);
  const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const firstDay   = new Date(year, month, 1);
  const lastDay    = new Date(year, month + 1, 0);
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

    // ○/× インジケーター
    let availCls  = 'cal-avail';
    let availText = '';
    if (!isPast && !isHol) {
      const avStat = state.ui.monthAvailability[dateStr];
      if (avStat === 'available') {
        availCls  = 'cal-avail avail-ok';
        availText = '○';
      } else if (avStat === 'full' || avStat === 'unavailable') {
        availCls  = 'cal-avail avail-ng';
        availText = '×';
      } else if (state.ui.monthAvailabilityLoading) {
        availCls  = 'cal-avail avail-loading';
        availText = '…';
      }
    }

    gridHtml += `<div class="${classes}" data-date="${dateStr}"
      ${!isPast && !isHol ? `onclick="selectDate('${dateStr}')"` : ''}>
      ${d}<span class="${availCls}" id="avail-${dateStr}">${availText}</span>
    </div>`;
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
  state.ui.calendarMonth        = m;
  state.ui.calendarYear         = y;
  state.ui.monthAvailability    = {};  // 月が変わったらキャッシュクリア
  state.ui.monthAvailabilityKey = '';
  render();
  loadMonthAvailability();
}

// ============================================================
// 月間空き状況を非同期で取得し、インジケーターだけ外科的に更新
// ============================================================
async function loadMonthAvailability() {
  const duration = isVisit() ? getTotalDuration() : state.form.duration;
  if (!duration || !state.form.serviceType) return;

  const { calendarYear: year, calendarMonth: month } = state.ui;
  const cacheKey = `${year}-${month}-${state.form.serviceType}-${duration}`;
  if (state.ui.monthAvailabilityKey === cacheKey) return; // キャッシュ済み
  if (state.ui.monthAvailabilityLoading)           return; // 取得中

  state.ui.monthAvailabilityLoading = true;

  // ローディング表示（…）
  document.querySelectorAll('[id^="avail-"]').forEach(el => {
    if (!el.closest('.cal-day.disabled')) {
      el.className   = 'cal-avail avail-loading';
      el.textContent = '…';
    }
  });

  try {
    const result = await apiGet('getMonthAvailability', {
      year,
      month:       month + 1,  // JS は 0始まり、GAS は 1始まり
      duration,
      serviceType: state.form.serviceType,
    });
    state.ui.monthAvailability    = result;
    state.ui.monthAvailabilityKey = cacheKey;
  } catch(err) {
    console.error('月間空き確認失敗:', err);
    state.ui.monthAvailability = {};
  }

  state.ui.monthAvailabilityLoading = false;
  _updateCalendarIndicators();
}

// インジケータースパンだけDOMを外科的に更新（カレンダー全体は再描画しない）
function _updateCalendarIndicators() {
  const avail = state.ui.monthAvailability;
  Object.entries(avail).forEach(([dateStr, status]) => {
    const el = document.getElementById(`avail-${dateStr}`);
    if (!el) return;
    if (status === 'available') {
      el.className   = 'cal-avail avail-ok';
      el.textContent = '○';
    } else if (status === 'full' || status === 'unavailable') {
      el.className   = 'cal-avail avail-ng';
      el.textContent = '×';
    } else {
      el.className   = 'cal-avail';
      el.textContent = '';
    }
  });
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
  const slotStep = stepNum('slot');
  state.step = slotStep;
  state.ui.loadingSlots   = true;
  state.ui.availableSlots = null;
  render();

  // 来店はオプション込みの合計時間で空き枠を計算
  const duration = isVisit() ? getTotalDuration() : state.form.duration;

  try {
    const res = await apiGet('getAvailableSlots', {
      date:        state.form.date,
      duration,
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
// 時間スロット選択
// ============================================================
function renderSlots() {
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
        <button class="btn btn-ghost" onclick="goBack()">日付を選び直す</button>
      </div>`;
  }

  const available = slotsData.slots.filter(s => s.available);
  if (available.length === 0) {
    return `
      <p class="section-title">時間帯選択</p>
      <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
      <div class="no-slots">
        この日は満席です。別の日付をお選びください。<br>
        <button class="btn btn-ghost" onclick="goBack()">日付を選び直す</button>
      </div>`;
  }

  const duration = isVisit() ? getTotalDuration() : (state.form.duration || 90);
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
// 顧客情報
// ============================================================
function renderCustomer() {
  const isReturning = state.customer?.exists;
  const f           = state.form;
  const totalDur    = isVisit() ? getTotalDuration() : f.duration;
  const hasOpts     = f.options.length > 0;

  const summary = `
    <div class="summary-card">
      <div class="summary-row">
        <span class="summary-label">種別</span>
        <span class="summary-value">${f.serviceType}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">コース</span>
        <span class="summary-value">${f.course}</span>
      </div>
      ${isVisit() ? `
      <div class="summary-row">
        <span class="summary-label">オプション</span>
        <span class="summary-value">${hasOpts ? f.options.map(o => o.name).join('・') : 'なし'}</span>
      </div>` : ''}
      <div class="summary-row">
        <span class="summary-label">時間</span>
        <span class="summary-value">${formatDuration(totalDur)}</span>
      </div>
      <div class="summary-row">
        <span class="summary-label">日時</span>
        <span class="summary-value">${formatJapanese(f.date)}<br>${f.timeSlot}〜${formatTime(f.endTime)}</span>
      </div>
      ${isVisit() ? `
      <div class="summary-row">
        <span class="summary-label">合計金額</span>
        <span class="summary-value" style="font-weight:700;color:var(--primary)">${formatPrice(getTotalPrice())}</span>
      </div>` : (() => {
        const base = getMobilePrice(f.duration || 0);
        const sur  = calcMidnightSurcharge(f.timeSlot, f.duration || 0);
        return `
      <div class="summary-row">
        <span class="summary-label">合計金額</span>
        <span class="summary-value" style="font-weight:700;color:var(--primary)">${formatPrice(base + sur)}${sur > 0 ? `<br><span style="font-size:11px;font-weight:400;color:var(--accent)">深夜料金+${formatPrice(sur)}込</span>` : ''}</span>
      </div>`;
      })()}
    </div>`;

  if (isReturning && !f.isEditing) {
    const prevKarte = state.karte?.entries?.[0];
    return `
      <p class="section-title">お客様情報</p>
      <p class="section-sub">前回の情報を引き継いでいます。</p>
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
      </div>
      <div class="form-group" style="margin-bottom:0;margin-top:16px">
        <label class="form-label">セラピストへの事前メモ<span style="font-size:11px;color:var(--text-secondary);margin-left:6px;font-weight:400">任意</span></label>
        <textarea class="form-input" id="input-note" rows="4"
          placeholder="気になる部位・体の状態・ご要望など、事前に伝えたいことがあればご記入ください。"
          style="resize:vertical;line-height:1.7"
          oninput="state.form.note = this.value">${f.note || ''}</textarea>
        <p class="form-hint">空欄でも予約できます。当日チャットでも相談できます。</p>
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
        onclick="try{liff.closeWindow();}catch(e){window.history.back();}">閉じる</button>
    </div>`;
}

// ============================================================
// ナビゲーション
// ============================================================
function goNext() {
  const max = getTotalSteps();
  if (state.step < max) {
    state.step++;
    render();
    window.scrollTo(0, 0);
  }
}

function goBack() {
  if (state.step <= 1) return;
  const slotStep     = stepNum('slot');
  const customerStep = stepNum('customer');
  if (state.step === slotStep)     { state.form.timeSlot = ''; state.form.endTime = ''; }
  if (state.step === customerStep) { state.form.isEditing = false; }
  state.step--;
  render();
  window.scrollTo(0, 0);
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

  // メニュー名：来店はオプションを付加、出張はそのまま
  let menuName = f.course;
  if (isVisit() && f.options.length > 0) {
    menuName += '（' + f.options.map(o => o.name).join('・') + 'オプション）';
  }

  // 合計時間：来店はオプション込み
  const duration = isVisit() ? getTotalDuration() : f.duration;

  const btn = document.querySelector('.btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '送信中...'; }

  try {
    const result = await apiPost({
      action:       'createReservation',
      lineUserId:   state.lineUserId,
      customerName: nameVal.trim(),
      serviceType:  f.serviceType,
      menuName,
      duration,
      date:         f.date,
      startTime:    f.timeSlot,
      address:      addressVal.trim(),
      note:         f.note?.trim() || '',
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

    const [settings, customer] = await Promise.all([
      apiGet('getSettings'),
      apiGet('getCustomerInfo', { lineUserId: state.lineUserId }),
    ]);

    state.settings = settings;
    state.customer = customer;

    if (customer?.exists) {
      state.form.name    = customer.name    || '';
      state.form.address = customer.address || '';
    }

    state.phase = 'form';
    render();

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
