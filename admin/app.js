/**
 * ============================================================
 * trunk 管理画面 - admin/app.js
 * オーナー専用LIFF管理アプリ
 * ============================================================
 */

// ============================================================
// 設定（GAS_URLとLIFF_IDを自分の値に書き換えてください）
// ============================================================
const ADMIN_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzbI4xCzAPOoZAMR06t5kKZAQuvu3EUF7pBNiqPDN7DIvvj38odiJfwLWGxB9jG_7lj1A/exec',
  LIFF_ID: '2009742884-8ACt2H8G',
};

// ============================================================
// 時間の選択肢（06:00 〜 28:00 を30分刻みで生成）
// 28:00 = 翌日の04:00（日付跨ぎ対応）
// ============================================================
const TIME_OPTIONS = (() => {
  const options = [];
  for (let h = 6; h <= 28; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 28 && m > 0) break; // 28:00まで
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      options.push(`${hh}:${mm}`);
    }
  }
  return options;
})();

// ============================================================
// アプリ全体の状態管理
// ============================================================
const state = {
  phase: 'loading',       // loading | auth-error | main
  tab: 'reservations',    // reservations | slots
  lineUserId: null,
  selectedDate: todayStr(), // 表示中の日付（YYYY-MM-DD）
  reservations: [],
  slots: [],
  showAddForm: false,
  form: {
    date: '',
    startTime: '10:00',
    endTime: '12:00',
    note: '',
  },
};

// ============================================================
// 今日の日付をYYYY-MM-DD形式で返す
// ============================================================
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ============================================================
// 日付をYYYY-MM-DD → M月D日（曜日）に整形
// ============================================================
function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const month = d.getMonth() + 1;
  const day   = d.getDate();
  const week  = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${month}月${day}日（${week}）`;
}

// ============================================================
// 日付を1日ずらす
// ============================================================
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// GAS への GET リクエスト
// ============================================================
async function apiGet(params) {
  const url = new URL(ADMIN_CONFIG.GAS_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

// ============================================================
// GAS への POST リクエスト
// ============================================================
async function apiPost(body) {
  const res = await fetch(ADMIN_CONFIG.GAS_URL, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json();
}

// ============================================================
// トースト通知を表示（2秒後に消える）
// ============================================================
function showToast(message, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ============================================================
// ローディング画面を描画
// ============================================================
function renderLoading() {
  document.getElementById('app').innerHTML = `
    <div class="loading-screen">
      <div class="loading-logo">trunk</div>
      <div class="spinner"></div>
    </div>`;
}

// ============================================================
// 認証エラー画面を描画
// ============================================================
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
// メイン画面を描画
// ============================================================
function renderMain() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- ヘッダー -->
    <div class="header">
      <div class="header-content">
        <div class="header-title">trunk 管理</div>
      </div>
    </div>

    <!-- コンテンツエリア -->
    <div class="admin-content" id="main-content"></div>

    <!-- タブバー -->
    <nav class="admin-tab-bar">
      <button class="admin-tab-btn ${state.tab === 'reservations' ? 'active' : ''}"
              onclick="switchTab('reservations')">
        <span class="admin-tab-icon">📋</span>予約
      </button>
      <button class="admin-tab-btn ${state.tab === 'slots' ? 'active' : ''}"
              onclick="switchTab('slots')">
        <span class="admin-tab-icon">🗓</span>受付スロット
      </button>
    </nav>`;

  renderContent();
}

// ============================================================
// コンテンツ部分だけ更新（タブ切り替え時など）
// ============================================================
function renderContent() {
  const el = document.getElementById('main-content');
  if (!el) return;
  if (state.tab === 'reservations') {
    el.innerHTML = renderReservationsTab();
  } else {
    el.innerHTML = renderSlotsTab();
  }
}

// ============================================================
// タブを切り替える
// ============================================================
function switchTab(tab) {
  state.tab = tab;
  renderMain();
  if (tab === 'slots') loadSlots();
}

// ============================================================
// 【予約タブ】HTML生成
// ============================================================
function renderReservationsTab() {
  const dateLabel = formatDateLabel(state.selectedDate);

  let cards = '';
  if (state.reservations.length === 0) {
    cards = `<div class="empty-state">この日の予約はありません</div>`;
  } else {
    // 開始時間順にソート
    const sorted = [...state.reservations].sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );
    cards = sorted.map(r => {
      const badgeClass = r.serviceType === '来店' ? 'badge-visit' : 'badge-mobile';
      const badgeLabel = r.serviceType === '来店' ? '来店' : '出張';
      return `
        <div class="reservation-card">
          <div class="reservation-time">${r.startTime} 〜 ${r.endTime}</div>
          <div class="reservation-info">
            <span class="service-badge ${badgeClass}">${badgeLabel}</span>
            <span class="reservation-name">${r.customerName}</span>
          </div>
          <div class="reservation-menu">${r.menuName}（${r.duration}分）</div>
          ${r.address ? `<div class="reservation-menu" style="margin-top:4px;">📍 ${r.address}</div>` : ''}
        </div>`;
    }).join('');
  }

  return `
    <!-- 日付ナビ -->
    <div class="date-nav">
      <button class="date-nav-btn" onclick="changeDate(-1)">‹</button>
      <span class="date-nav-label">${dateLabel}</span>
      <button class="date-nav-btn" onclick="changeDate(1)">›</button>
    </div>

    <!-- 予約一覧 -->
    <div class="reservation-list">${cards}</div>`;
}

// ============================================================
// 日付を変更して予約を再読み込み
// ============================================================
function changeDate(days) {
  state.selectedDate = shiftDate(state.selectedDate, days);
  loadReservations();
}

// ============================================================
// 【受付スロットタブ】HTML生成
// ============================================================
function renderSlotsTab() {
  // スロットを日付ごとにグループ化
  const groups = {};
  state.slots.forEach(s => {
    if (!groups[s.date]) groups[s.date] = [];
    groups[s.date].push(s);
  });

  let groupsHtml = '';
  if (Object.keys(groups).length === 0) {
    groupsHtml = `<div class="empty-state">登録済みの受付スロットはありません</div>`;
  } else {
    groupsHtml = Object.entries(groups).map(([date, slots]) => {
      const items = slots.map(s => `
        <div class="slot-item">
          <div>
            <div class="slot-time">${s.startTime} 〜 ${s.endTime}</div>
            ${s.note ? `<div class="slot-note">${s.note}</div>` : ''}
          </div>
          <button class="slot-delete-btn" onclick="handleDeleteSlot('${s.slotId}')">削除</button>
        </div>`).join('');
      return `
        <div class="slot-group">
          <div class="slot-group-date">${formatDateLabel(date)}</div>
          ${items}
        </div>`;
    }).join('');
  }

  // 追加フォーム
  const timeSelectOptions = (selected) =>
    TIME_OPTIONS.map(t => `<option value="${t}" ${t === selected ? 'selected' : ''}>${t}</option>`).join('');

  const addFormHtml = state.showAddForm ? `
    <div class="add-slot-form">
      <div class="add-slot-form-title">受付スロットを追加</div>
      <div class="form-group">
        <label class="form-label">日付</label>
        <input type="date" class="form-input" id="form-date"
               value="${state.form.date || todayStr()}"
               min="${todayStr()}"
               oninput="state.form.date = this.value">
      </div>
      <div class="time-grid">
        <div class="form-group">
          <label class="form-label">開始時間</label>
          <select class="form-input" id="form-start" onchange="state.form.startTime = this.value">
            ${timeSelectOptions(state.form.startTime)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">終了時間</label>
          <select class="form-input" id="form-end" onchange="state.form.endTime = this.value">
            ${timeSelectOptions(state.form.endTime)}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">備考（任意）</label>
        <input type="text" class="form-input" id="form-note"
               placeholder="例：○○地区限定"
               value="${state.form.note}"
               oninput="state.form.note = this.value">
      </div>
      <div style="display:flex;gap:10px;margin-top:4px;">
        <button class="btn btn-primary" style="flex:1;" onclick="handleAddSlot()">追加する</button>
        <button class="btn btn-secondary" style="flex:1;" onclick="toggleAddForm()">キャンセル</button>
      </div>
    </div>` : `
    <div style="padding:12px 16px;">
      <button class="btn btn-primary" style="width:100%;" onclick="toggleAddForm()">
        ＋ 受付スロットを追加
      </button>
    </div>`;

  return `
    ${addFormHtml}
    <div class="slot-list">${groupsHtml}</div>`;
}

// ============================================================
// 追加フォームの表示/非表示を切り替え
// ============================================================
function toggleAddForm() {
  state.showAddForm = !state.showAddForm;
  if (state.showAddForm) {
    // フォームの初期値をリセット
    state.form = { date: todayStr(), startTime: '10:00', endTime: '12:00', note: '' };
  }
  renderContent();
}

// ============================================================
// 受付スロットを追加する
// ============================================================
async function handleAddSlot() {
  const { date, startTime, endTime, note } = state.form;

  if (!date) { showToast('日付を選択してください', true); return; }
  if (startTime >= endTime) { showToast('終了時間は開始時間より後にしてください', true); return; }

  try {
    const result = await apiPost({
      action: 'addSlot',
      type: '出張',
      date,
      startTime,
      endTime,
      note,
    });

    if (result.error) throw new Error(result.error);

    showToast('受付スロットを追加しました');
    state.showAddForm = false;
    await loadSlots();
  } catch (err) {
    showToast('追加に失敗しました: ' + err.message, true);
  }
}

// ============================================================
// 受付スロットを削除する
// ============================================================
async function handleDeleteSlot(slotId) {
  if (!confirm('このスロットを削除しますか？')) return;

  try {
    const result = await apiPost({ action: 'deleteSlot', slotId });
    if (result.error) throw new Error(result.error);

    showToast('削除しました');
    await loadSlots();
  } catch (err) {
    showToast('削除に失敗しました: ' + err.message, true);
  }
}

// ============================================================
// 指定日の予約一覧を取得して再描画
// ============================================================
async function loadReservations() {
  try {
    const result = await apiGet({ action: 'getReservations', date: state.selectedDate });
    state.reservations = Array.isArray(result) ? result : [];
  } catch (err) {
    state.reservations = [];
  }
  renderContent();
}

// ============================================================
// 本日以降の受付スロット一覧を取得して再描画
// ============================================================
async function loadSlots() {
  try {
    const result = await apiGet({ action: 'getSlotsList' });
    state.slots = Array.isArray(result) ? result : [];
  } catch (err) {
    state.slots = [];
  }
  renderContent();
}

// ============================================================
// アプリ初期化
// ① LIFF初期化
// ② プロフィール取得
// ③ オーナー認証
// ④ 予約一覧を読み込んでメイン画面表示
// ============================================================
async function initApp() {
  renderLoading();

  try {
    // LIFF 初期化
    await liff.init({ liffId: ADMIN_CONFIG.LIFF_ID });

    // 未ログインの場合はLINEログイン画面へ
    if (!liff.isLoggedIn()) {
      liff.login();
      return;
    }

    // プロフィール取得
    const profile = await liff.getProfile();
    state.lineUserId = profile.userId;

    // オーナー認証チェック
    const authResult = await apiGet({ action: 'checkOwner', lineUserId: state.lineUserId });
    if (!authResult.isOwner) {
      state.phase = 'auth-error';
      renderAuthError();
      return;
    }

    // 認証OK → 予約一覧を取得してメイン画面へ
    const reservations = await apiGet({ action: 'getReservations', date: state.selectedDate });
    state.reservations = Array.isArray(reservations) ? reservations : [];
    state.phase = 'main';
    renderMain();

  } catch (err) {
    console.error('初期化エラー:', err);
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

// ============================================================
// 起動
// ============================================================
initApp();
