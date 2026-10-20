/**
 * LIFF SDK モック（ローカルテスト専用）
 * 本番環境では使用しない
 *
 * userId の指定方法（優先順）:
 *   1. URL パラメータ: ?userId=Uxxxxxxxx
 *   2. このファイルの DEFAULT_USER_ID を直接書き換え
 */
const DEFAULT_USER_ID = 'U_TEST_USER_001';

const _mockParams = new URLSearchParams(location.search);
const _mockUserId = _mockParams.get('userId') || DEFAULT_USER_ID;

window.liff = {
  init: () => Promise.resolve(),
  isInClient: () => true,
  isLoggedIn: () => true,
  getProfile: () => Promise.resolve({
    userId:      _mockUserId,
    displayName: 'テストユーザー',
    pictureUrl:  '',
  }),
  login: () => {
    alert('[LIFF Mock] liff.login() が呼ばれました');
  },
  logout: () => {
    alert('[LIFF Mock] liff.logout() が呼ばれました');
  },
  closeWindow: () => {
    alert('[LIFF Mock] 画面を閉じます（closeWindow）');
  },
  getOS: () => 'web',
  getLanguage: () => 'ja',
  getVersion: () => '2.22.3',
  getAppLanguage: () => 'ja',
  isApiAvailable: () => true,
  sendMessages: (messages) => {
    console.log('[LIFF Mock] sendMessages:', messages);
    return Promise.resolve();
  },
};

console.log('%c[LIFF Mock] userId: ' + _mockUserId, 'color: orange; font-weight: bold;');
