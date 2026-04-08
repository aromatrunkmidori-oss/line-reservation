'use strict';

// ============================================================
// ⚙️ 設定（デプロイ後にここを編集してください）
// ============================================================
const CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/https://script.google.com/macros/s/AKfycbzvp_61GStgXQxAH36eyyuSOXvT9OFZrLmqD9sQYBrDo1CyYQVINsvV7QztDHViv18nCg/exec/exec',
  LIFF_ID: '2009742884-e9ueuqGE',
};

// ============================================================
// 状態管理（State）
// ============================================================
const state = {
  phase:       'loading',   // loading | form | done | error
  step:         1,          // 1〜5
  errorMessage: '',
  lineUserId:   null,
  displayName:  '',
  pictureUrl:   '',
  customer:     null,       // 顧客情報（APIレスポンス）
  settings:     null,       // 公開設定（メニュー・営業時間等）
  karte:        null,       // カルテ履歴
  form: {
    serviceType: '',         // 来店 | 出張
    menu:        null,       // { name, duration, price }
    date:        '',         // yyyy-MM-dd
    timeSlot:    '',         // HH:mm
    endTime:     '',         // HH:mm
    name:        '',
    phone:       '',
    address:     '',
    isEditing:   false,      // 返客が情報を編集中かどうか
  },
  ui: {
    calendarYear:   new Date().getFullYear(),
    calendarMonth:  new Date().getMonth(),
    availableSlots: null,
    loadingSlots:   false,
  },
  reservation: null,        // 完了した予約情報
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
  // Content-Type: text/plain でCORSプリフライトを回避
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
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatJapanese(dateStr) {
  if (!dateStr) return '';
  const date     = new Date(dateStr + 'T00:00:00+09:00');
  const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${dayNames[date.getDay()]}）`;
}

function addMinutes(timeStr, min) {
  const [h, m] = timeStr.split(':').map(Number);
  const total  = h * 60 + m + min;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function isHoliday(dateStr, date, holidays) {
  const dayNames = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
  return holidays.includes(dayNames[date.getDay()]) || holidays.includes(dateStr);
}

function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function formatPrice(price) {
  return '¥' + Number(price).toLocaleString();
}

// ============================================================
// レンダリング（メイン）
// ============================================================
function render() {
  const app = document.getElementById('app');

  if (state.phase === 'loading') {
    app.innerHTML = `
      <div class="loading-screen">
        <div class="spinner"></div>
        <p>読み込み中...</p>
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

  // form フェーズ
  const stepTitles = ['種別選択', 'メニュー', '日付選択', '時間選択', 'お客様情報'];
  let stepContent = '';
  switch (state.step) {
    case 1: stepContent = renderStep1(); break;
    case 2: stepContent = renderStep2(); break;
    case 3: stepContent = renderStep3(); break;
    case 4: stepContent = renderStep4(); break;
    case 5: stepContent = renderStep5(); break;
  }

  app.innerHTML = `
    <div class="header">
      ${state.step > 1
        ? `<button class="header-back" onclick="goBack()">‹</button>`
        : `<div style="width:36px"></div>`}
      <span class="header-title">ご予約</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width:${(state.step / 5) * 100}%"></div>
    </div>
    <div class="progress-steps">
      ${stepTitles.map((t, i) => `
        <span class="progress-step ${i + 1 === state.step ? 'active' : i + 1 < state.step ? 'done' : ''}">
          ${i + 1 < state.step ? '✓' : i + 1}. ${t}
        </span>`).join('')}
    </div>
    <div class="content">${stepContent}</div>
    <div class="btn-area" id="btn-area"></div>`;

  renderButtons();
}

// ============================================================
// ボタンエリアのレンダリング
// ============================================================
function renderButtons() {
  const area = document.getElementById('btn-area');
  if (!area) return;

  switch (state.step) {
    case 1:
      area.innerHTML = ''; // Step1はカードタップで進む
      break;

    case 2:
      area.innerHTML = `
        <button class="btn btn-primary" id="next-btn"
          onclick="goNext()" ${!state.form.menu ? 'disabled' : ''}>
          次へ　›
        </button>`;
      break;

    case 3:
      area.innerHTML = `
        <button class="btn btn-primary" id="next-btn"
          onclick="onDateNext()" ${!state.form.date ? 'disabled' : ''}>
          この日で時間を選ぶ　›
        </button>`;
      break;

    case 4:
      area.innerHTML = `
        <button class="btn btn-primary" id="next-btn"
          onclick="goNext()" ${!state.form.timeSlot ? 'disabled' : ''}>
          次へ　›
        </button>`;
      break;

    case 5:
      area.innerHTML = `
        <button class="btn btn-primary" onclick="submitReservation()">
          予約を確定する
        </button>`;
      break;
  }
}

// ============================================================
// STEP 1：サービス種別
// ============================================================
function renderStep1() {
  return `
    <p class="section-title">サービス種別</p>
    <p class="section-sub">来店またはご自宅・ご指定場所への出張をお選びください</p>
    <div class="service-grid">
      <button class="service-btn ${state.form.serviceType === '来店' ? 'selected' : ''}"
        onclick="selectServiceType('来店')">
        <span class="icon">🏠</span>
        <span class="label">来店</span>
        <span class="desc">サロンにお越しください</span>
      </button>
      <button class="service-btn ${state.form.serviceType === '出張' ? 'selected' : ''}"
        onclick="selectServiceType('出張')">
        <span class="icon">🚗</span>
        <span class="label">出張</span>
        <span class="desc">ご指定場所へお伺いします</span>
      </button>
    </div>`;
}

function selectServiceType(type) {
  state.form.serviceType = type;
  state.form.menu        = null;
  state.form.date        = '';
  state.form.timeSlot    = '';
  state.step = 2;
  render();
}

// ============================================================
// STEP 2：メニュー選択
// ============================================================
function renderStep2() {
  const menus = state.settings?.menus || [];
  if (menus.length === 0) {
    return `<div class="no-slots">メニューが設定されていません。<br>設定シートをご確認ください。</div>`;
  }

  const items = menus.map(m => {
    const selected = state.form.menu?.name === m.name;
    return `
      <button class="menu-item ${selected ? 'selected' : ''}"
        onclick="selectMenu(${JSON.stringify(m).replace(/"/g, '&quot;')})">
        <div class="menu-info">
          <div class="menu-name">${m.name}</div>
          <div class="menu-meta">⏱ 約${m.duration}分</div>
        </div>
        <div class="menu-price">${m.price ? formatPrice(m.price) : ''}</div>
        <div class="menu-check">✓</div>
      </button>`;
  }).join('');

  return `
    <p class="section-title">コース選択</p>
    <p class="section-sub">ご希望のコースをお選びください</p>
    <div class="menu-list">${items}</div>`;
}

function selectMenu(menu) {
  state.form.menu     = menu;
  state.form.date     = '';
  state.form.timeSlot = '';
  state.ui.availableSlots = null;
  renderButtons();
  // カードの selected 状態を更新
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
}

// ============================================================
// STEP 3：日付選択（カレンダー）
// ============================================================
function renderStep3() {
  const { calendarYear: year, calendarMonth: month } = state.ui;
  const holidays   = state.settings?.holidays || [];
  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月',
                      '7月', '8月', '9月', '10月', '11月', '12月'];

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  const prevDisabled = (year < today.getFullYear() ||
    (year === today.getFullYear() && month <= today.getMonth()));

  let gridHtml = `
    <div class="calendar-grid">
      ${['日','月','火','水','木','金','土'].map(d =>
        `<div class="cal-day-header">${d}</div>`).join('')}
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
  state.step = 4;
  state.ui.loadingSlots   = true;
  state.ui.availableSlots = null;
  render();

  try {
    const res = await apiGet('getAvailableSlots', {
      date:     state.form.date,
      duration: state.form.menu.duration,
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
// STEP 4：時間スロット選択
// ============================================================
function renderStep4() {
  if (state.ui.loadingSlots) {
    return `
      <p class="section-title">時間選択</p>
      <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
      <div class="loading-overlay">
        <div class="spinner"></div>
        <span>空き枠を確認中...</span>
      </div>`;
  }

  const slotsData = state.ui.availableSlots;

  if (!slotsData || !slotsData.available) {
    return `
      <p class="section-title">時間選択</p>
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
      <p class="section-title">時間選択</p>
      <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
      <div class="no-slots">
        この日は満席です。<br>別の日付をお選びください。<br>
        <button class="btn btn-secondary" style="margin-top:16px;max-width:200px"
          onclick="goBack()">日付を選び直す</button>
      </div>`;
  }

  const duration = state.form.menu?.duration || 60;
  const slotBtns = slotsData.slots.map(s => {
    const end      = addMinutes(s.time, duration);
    const selected = state.form.timeSlot === s.time;
    const cls      = selected ? 'slot-btn selected' : s.available ? 'slot-btn available' : 'slot-btn unavailable';
    const onclick  = s.available ? `onclick="selectSlot('${s.time}', '${end}')"` : '';
    return `
      <button class="${cls}" ${onclick} ${!s.available ? 'disabled' : ''}>
        ${s.time}
        <span class="slot-end">〜${end}</span>
      </button>`;
  }).join('');

  return `
    <p class="section-title">時間選択</p>
    <p class="slot-date-label">${formatJapanese(state.form.date)}</p>
    <div class="slot-grid">${slotBtns}</div>`;
}

function selectSlot(time, endTime) {
  state.form.timeSlot = time;
  state.form.endTime  = endTime;
  render();
}

// ============================================================
// STEP 5：顧客情報
// ============================================================
function renderStep5() {
  const isReturning = state.customer?.exists;
  const f           = state.form;

  // 予約サマリー
  const summary = `
    <div class="summary-card">
      <div class="summary-row">
        <span class="summary-icon">🏠</span>
        <span class="summary-label">種別</span>
        <span class="summary-value">${f.serviceType}</span>
      </div>
      <div class="summary-row">
        <span class="summary-icon">💆</span>
        <span class="summary-label">コース</span>
        <span class="summary-value">${f.menu?.name}（約${f.menu?.duration}分）</span>
      </div>
      <div class="summary-row">
        <span class="summary-icon">📅</span>
        <span class="summary-label">日時</span>
        <span class="summary-value">${formatJapanese(f.date)}<br>${f.timeSlot}〜${f.endTime}</span>
      </div>
      ${f.menu?.price ? `
      <div class="summary-row">
        <span class="summary-icon">💴</span>
        <span class="summary-label">料金</span>
        <span class="summary-value">${formatPrice(f.menu.price)}</span>
      </div>` : ''}
    </div>`;

  // 返客で編集モードでない場合：確認表示
  if (isReturning && !f.isEditing) {
    const prevKarte = state.karte?.entries?.[0];
    return `
      <p class="section-title">お客様情報</p>
      <p class="section-sub">前回の情報を引き継いでいます。変更がある場合は「編集する」をタップしてください。</p>
      ${summary}
      <div class="card">
        <div class="info-row">
          <span class="info-key">お名前</span>
          <span class="info-value">${state.customer.name}</span>
        </div>
        <div class="info-row">
          <span class="info-key">電話番号</span>
          <span class="info-value">${state.customer.phone || '未登録'}</span>
        </div>
        ${f.serviceType === '出張' ? `
        <div class="info-row">
          <span class="info-key">訪問先住所</span>
          <span class="info-value">${state.customer.address || '未登録'}</span>
        </div>` : ''}
        <button class="edit-toggle" onclick="startEditing()">✏️ 編集する</button>
      </div>
      ${prevKarte ? `
      <div class="karte-prev">
        <div class="karte-prev-title">📋 前回の記録（${prevKarte.date}）</div>
        ${prevKarte.treatmentContent ? `<div class="karte-prev-row"><span class="karte-prev-label">施術：</span>${prevKarte.treatmentContent}</div>` : ''}
        ${prevKarte.nextNotes ? `<div class="karte-prev-row"><span class="karte-prev-label">申し送り：</span>${prevKarte.nextNotes}</div>` : ''}
      </div>` : ''}`;
  }

  // 新規または編集モード：フォーム表示
  const nameVal    = f.name    || (isReturning ? state.customer.name    : '');
  const phoneVal   = f.phone   || (isReturning ? state.customer.phone   : '');
  const addressVal = f.address || (isReturning ? state.customer.address : '');

  return `
    <p class="section-title">お客様情報</p>
    <p class="section-sub">ご予約に必要な情報をご入力ください</p>
    ${summary}
    <div class="card">
      <div class="form-group">
        <label class="form-label">お名前<span class="required">必須</span></label>
        <input class="form-input" type="text" id="input-name"
          placeholder="山田 花子" value="${nameVal}"
          oninput="state.form.name = this.value">
      </div>
      <div class="form-group">
        <label class="form-label">電話番号<span class="required">必須</span></label>
        <input class="form-input" type="tel" id="input-phone"
          placeholder="090-1234-5678" value="${phoneVal}"
          oninput="state.form.phone = this.value">
      </div>
      ${f.serviceType === '出張' ? `
      <div class="form-group">
        <label class="form-label">訪問先住所<span class="required">必須</span></label>
        <input class="form-input" type="text" id="input-address"
          placeholder="東京都渋谷区〇〇1-2-3" value="${addressVal}"
          oninput="state.form.address = this.value">
        <p class="form-hint">当日伺う住所をご入力ください</p>
      </div>` : ''}
    </div>`;
}

function startEditing() {
  state.form.isEditing = true;
  state.form.name    = state.customer?.name    || '';
  state.form.phone   = state.customer?.phone   || '';
  state.form.address = state.customer?.address || '';
  render();
}

// ============================================================
// 完了画面
// ============================================================
function renderDone() {
  const r = state.reservation;
  return `
    <div class="done-screen">
      <div class="done-icon">✓</div>
      <h2 class="done-title">予約が完了しました</h2>
      <p class="done-sub">
        LINEに予約確認メッセージをお送りしました。<br>
        前日にもリマインドをお送りします。
      </p>
      <div class="done-detail">
        <div class="summary-row">
          <span class="summary-icon">💆</span>
          <span class="summary-label">コース</span>
          <span class="summary-value">${r?.menuName || ''}</span>
        </div>
        <div class="summary-row">
          <span class="summary-icon">📅</span>
          <span class="summary-label">日時</span>
          <span class="summary-value">${formatJapanese(r?.date || '')}<br>${r?.startTime || ''}〜${r?.endTime || ''}</span>
        </div>
        <div class="summary-row">
          <span class="summary-icon">🏠</span>
          <span class="summary-label">種別</span>
          <span class="summary-value">${r?.serviceType || ''}</span>
        </div>
        ${r?.serviceType === '出張' && r?.address ? `
        <div class="summary-row">
          <span class="summary-icon">📍</span>
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
  if (state.step < 5) {
    state.step++;
    render();
    window.scrollTo(0, 0);
  }
}

function goBack() {
  if (state.step > 1) {
    if (state.step === 4) {
      // Step4→Step3：スロット情報をリセット
      state.form.timeSlot = '';
      state.form.endTime  = '';
    }
    if (state.step === 5) {
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
  // バリデーション
  const f           = state.form;
  const isReturning = state.customer?.exists;
  const nameVal     = f.name    || (isReturning && !f.isEditing ? state.customer?.name    : '');
  const phoneVal    = f.phone   || (isReturning && !f.isEditing ? state.customer?.phone   : '');
  const addressVal  = f.address || (isReturning && !f.isEditing ? state.customer?.address : '');

  if (!nameVal.trim()) {
    showToast('お名前を入力してください');
    document.getElementById('input-name')?.focus();
    return;
  }
  if (!phoneVal.trim()) {
    showToast('電話番号を入力してください');
    document.getElementById('input-phone')?.focus();
    return;
  }
  if (f.serviceType === '出張' && !addressVal.trim()) {
    showToast('訪問先住所を入力してください');
    document.getElementById('input-address')?.focus();
    return;
  }

  // 送信ボタンを無効化
  const btn = document.querySelector('.btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '送信中...'; }

  try {
    const result = await apiPost({
      action:       'createReservation',
      lineUserId:   state.lineUserId,
      customerName: nameVal.trim(),
      serviceType:  f.serviceType,
      menuName:     f.menu.name,
      duration:     f.menu.duration,
      date:         f.date,
      startTime:    f.timeSlot,
      address:      addressVal.trim(),
      phone:        phoneVal.trim(),
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
    // LIFF初期化
    await liff.init({ liffId: CONFIG.LIFF_ID });

    // LINEアプリ外アクセスのチェック
    if (!liff.isInClient()) {
      state.phase = 'error';
      state.errorMessage = 'このページはLINEアプリ内でのみご利用いただけます。\nLINEアプリから開いてください。';
      render();
      return;
    }

    // 未ログインの場合はログインへリダイレクト
    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    // LINEプロフィールを取得
    const profile     = await liff.getProfile();
    state.lineUserId  = profile.userId;
    state.displayName = profile.displayName;
    state.pictureUrl  = profile.pictureUrl;

    // 設定・顧客情報・カルテを並行取得
    const [settings, customer, karte] = await Promise.all([
      apiGet('getSettings'),
      apiGet('getCustomerInfo', { lineUserId: state.lineUserId }),
      apiGet('getKarte',        { lineUserId: state.lineUserId }),
    ]);

    state.settings = settings;
    state.customer = customer;
    state.karte    = karte;

    // 返客の場合は名前・電話・住所をフォームにセット
    if (customer?.exists) {
      state.form.name    = customer.name    || '';
      state.form.phone   = customer.phone   || '';
      state.form.address = customer.address || '';
    }

    state.phase = 'form';
    render();

  } catch (err) {
    console.error(err);
    state.phase        = 'error';
    state.errorMessage = err.message || '初期化に失敗しました。';
    render();
  }
}

// アプリ起動
init();
