/****************************************************
 * eGreen - Phiếu vật tư
 * Frontend app.js for GitHub Pages
 * Optimized version
 ****************************************************/

const API_URL = 'https://script.google.com/macros/s/AKfycby6LHf6K2Ci0XD2p-EBMaFS1K_bB9Wg6Qhc7OVtspNW_OkgIOPlO3OyeIWxH_Pc_yIm/exec';

const STORAGE_KEY = 'EGREEN_PHIEU_VAT_TU_SESSION_V2';
const AUTO_REFRESH_MS = 30000;
const JSONP_DIRECT_LIMIT = 1450;
const JSONP_CHUNK_SIZE = 1200;

let TOKEN = '';
let CURRENT_USER = null;
let ACCOUNT_CACHE = [];
let SELECTED_MEMBERS = [];
let KTV_NAME_CACHE = [];
let MACHINE_CACHE = [];
let SELECTED_HIEN_TUONG = [];
let HIENTUONG_CACHE = [];
let AUTO_REFRESH_TIMER = null;
let EDITING_MA_PHIEU = '';
let IS_BUSY = false;
let IS_BOOTING = false;

let APP = {
  may: [],
  hienTuong: [],
  vatTu: [],
  ktv: [],
  vatTuCoDinh: [],
  selected: []
};

/****************************************************
 * BOOT
 ****************************************************/

window.onload = function () {
  bindGlobalEvents();
  initLoginRememberCheckbox();
  bootApp();
};

function bindGlobalEvents() {
  document.addEventListener('click', function (e) {
    const multi = document.getElementById('thanhVienMulti');
    const dropdown = document.getElementById('thanhVienDropdown');

    if (multi && dropdown && !multi.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
    const hienTuongMulti = document.getElementById('hienTuongMulti');
const hienTuongDropdown = document.getElementById('hienTuongDropdown');

if (hienTuongMulti && hienTuongDropdown && !hienTuongMulti.contains(e.target)) {
  hienTuongDropdown.classList.add('hidden');
}

    closeSearchPopupsOnOutsideClick(e);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closePreview();
      closeAllSearchPopups();
      return;
    }

    const loginPage = document.getElementById('loginPage');
    const isLoginVisible = loginPage && !loginPage.classList.contains('hidden');

    if (isLoginVisible && e.key === 'Enter') {
      const target = e.target;
      if (target && (target.id === 'loginUsername' || target.id === 'loginPassword' || target.closest('.login-card'))) {
        e.preventDefault();
        doLogin();
      }
    }
  });

  ['loginUsername', 'loginPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', loginKeydown);
  });
}

function loginKeydown(e) {
  if (e && e.key === 'Enter') {
    e.preventDefault();
    doLogin();
  }
}

function initLoginRememberCheckbox() {
  const remember = document.getElementById('rememberLogin');
  if (!remember) return;

  const saved = loadSavedSession();
  remember.checked = !!(saved && saved.token);
}

async function bootApp() {
  IS_BOOTING = true;

  const loginPage = document.getElementById('loginPage');
  const appPage = document.getElementById('appPage');
  const msg = document.getElementById('loginMsg');
  const saved = loadSavedSession();

  if (!saved || !saved.token) {
    if (loginPage) loginPage.classList.remove('hidden');
    if (appPage) appPage.classList.add('hidden');
    IS_BOOTING = false;
    return;
  }

  TOKEN = saved.token;
  CURRENT_USER = saved.user || null;

  if (loginPage) loginPage.classList.add('hidden');
  if (appPage) appPage.classList.remove('hidden');

  if (CURRENT_USER) {
    renderUserBox();
    setupRoleUI();
  }

  try {
    const data = await api('getAppData', { token: TOKEN });
    initApp(data);
    startAutoRefresh();
    if (msg) msg.innerText = '';
  } catch (err) {
    clearSavedSession();
    TOKEN = '';
    CURRENT_USER = null;

    if (appPage) appPage.classList.add('hidden');
    if (loginPage) loginPage.classList.remove('hidden');
    if (msg) msg.innerText = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  } finally {
    IS_BOOTING = false;
  }
}

/****************************************************
 * API JSONP
 ****************************************************/

function api(action, data = {}) {
  const payload = { action, data };
  const text = JSON.stringify(payload);

  if (text.length <= JSONP_DIRECT_LIMIT) {
    return apiJsonpDirect_(payload);
  }

  return apiJsonpChunk_(payload);
}

function assertApiUrl_() {
  if (!API_URL || !/^https:\/\/script\.google\.com\/macros\/s\//.test(API_URL)) {
    throw new Error('Chưa cấu hình API_URL trong app.js. Hãy dán URL Web App Apps Script vào biến API_URL.');
  }
}

function apiJsonpDirect_(payload) {
  return new Promise((resolve, reject) => {
    try {
      assertApiUrl_();
    } catch (err) {
      reject(err);
      return;
    }

    const callbackName = '__egreen_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let finished = false;

    window[callbackName] = function (res) {
      if (finished) return;
      finished = true;
      cleanupJsonp_(script, callbackName);

      if (!res || res.success === false) {
        reject(new Error((res && res.message) || 'Không gọi được Apps Script API.'));
        return;
      }

      resolve(res.data);
    };

    script.onerror = function () {
      if (finished) return;
      finished = true;
      cleanupJsonp_(script, callbackName);
      reject(new Error('Không gọi được Apps Script API. Kiểm tra API_URL hoặc quyền Web App.'));
    };

    script.src = API_URL
      + '?callback=' + encodeURIComponent(callbackName)
      + '&payload=' + encodeURIComponent(JSON.stringify(payload))
      + '&_=' + Date.now();

    document.body.appendChild(script);

    setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanupJsonp_(script, callbackName);
      reject(new Error('API phản hồi quá lâu. Vui lòng thử lại.'));
    }, 45000);
  });
}

async function apiJsonpChunk_(payload) {
  const key = 'chunk_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const text = JSON.stringify(payload);

  await apiJsonpDirect_({ action: '__chunkStart', data: { key } });

  for (let i = 0; i < text.length; i += JSONP_CHUNK_SIZE) {
    await apiJsonpDirect_({
      action: '__chunkAppend',
      data: { key, chunk: text.slice(i, i + JSONP_CHUNK_SIZE) }
    });
  }

  return apiJsonpDirect_({ action: '__chunkFinish', data: { key } });
}

function cleanupJsonp_(script, callbackName) {
  try {
    if (script && script.parentNode) script.parentNode.removeChild(script);
  } catch (e) {}

  try {
    delete window[callbackName];
  } catch (e) {
    window[callbackName] = undefined;
  }
}

/****************************************************
 * SESSION / LOGIN
 ****************************************************/

function loadSavedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveSession() {
  if (!TOKEN || !CURRENT_USER) return;

  const remember = document.getElementById('rememberLogin');
  const shouldRemember = remember ? remember.checked : true;

  if (!shouldRemember) {
    clearSavedSession();
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      token: TOKEN,
      user: CURRENT_USER,
      savedAt: new Date().toISOString()
    }));
  } catch (e) {}
}

function clearSavedSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

async function doLogin() {
  const username = getValue('loginUsername').trim();
  const password = getValue('loginPassword').trim();
  const msg = document.getElementById('loginMsg');
  const loginBtn = document.getElementById('loginBtn');

  if (!username || !password) {
    if (msg) msg.innerText = 'Vui lòng nhập đủ tên đăng nhập và mật khẩu.';
    return;
  }

  if (IS_BUSY) return;
  if (msg) msg.innerText = 'Đang đăng nhập...';
  if (loginBtn) loginBtn.disabled = true;

  try {
    const res = await api('login', { username, password });
    TOKEN = res.token;
    CURRENT_USER = res.user;
    saveSession();
    initApp(res.appData);
    startAutoRefresh();
    if (msg) msg.innerText = '';
  } catch (err) {
    clearSavedSession();
    if (msg) msg.innerText = 'Lỗi đăng nhập: ' + err.message;
  } finally {
    if (loginBtn) loginBtn.disabled = false;
  }
}

async function doLogout() {
  try {
    if (TOKEN) await api('logout', { token: TOKEN });
  } catch (e) {}

  stopAutoRefresh();
  TOKEN = '';
  CURRENT_USER = null;
  ACCOUNT_CACHE = [];
  SELECTED_MEMBERS = [];
  KTV_NAME_CACHE = [];
  MACHINE_CACHE = [];
  EDITING_MA_PHIEU = '';
  clearSavedSession();

  const loginPage = document.getElementById('loginPage');
  const appPage = document.getElementById('appPage');
  const msg = document.getElementById('loginMsg');

  if (appPage) appPage.classList.add('hidden');
  if (loginPage) loginPage.classList.remove('hidden');
  if (msg) msg.innerText = '';
  setValue('loginPassword', '');
}

/****************************************************
 * INIT APP
 ****************************************************/

function initApp(data) {
  APP.may = Array.isArray(data.may) ? data.may : [];
  APP.hienTuong = Array.isArray(data.hienTuong) ? data.hienTuong : [];
  APP.vatTu = Array.isArray(data.vatTu) ? data.vatTu : [];
  APP.ktv = Array.isArray(data.ktv) ? data.ktv : [];
  APP.vatTuCoDinh = Array.isArray(data.vatTuCoDinh) ? data.vatTuCoDinh : [];
  APP.selected = [];

  CURRENT_USER = data.currentUser || CURRENT_USER;

  const loginPage = document.getElementById('loginPage');
  const appPage = document.getElementById('appPage');
  if (loginPage) loginPage.classList.add('hidden');
  if (appPage) appPage.classList.remove('hidden');

  renderUserBox();
  setupRoleUI();
  fillKtvSelects();
  fillMachineSelect();
  fillHienTuongSelect();
  setDefaultDateTime();
  resetSelectedMaterials();
  renderSelectedItems();
  showFirstAvailableTab();
  loadPhieuList(true);

  if (CURRENT_USER && CURRENT_USER.role === 'admin') {
    loadAccounts(true);
  }
}

function renderUserBox() {
  const userBox = document.getElementById('userBox');
  if (!userBox || !CURRENT_USER) return;

  userBox.innerHTML = `<b>${escapeHtml(CURRENT_USER.fullName || CURRENT_USER.username)}</b><br>Vai trò: ${escapeHtml(CURRENT_USER.role || '')}`;
}

function setupRoleUI() {
  const adminNav = document.getElementById('adminNav');
  if (!adminNav || !CURRENT_USER) return;

  if (CURRENT_USER.role === 'admin') adminNav.classList.remove('hidden');
  else adminNav.classList.add('hidden');
}

function showFirstAvailableTab() {
  const active = document.querySelector('.nav.active');
  if (active && (active.textContent || '').includes('Phiếu đã tạo')) {
    showTab('historyTab', active);
    return;
  }

  showTab('formTab', document.querySelector('.nav'));
}

function startAutoRefresh() {
  stopAutoRefresh();
  AUTO_REFRESH_TIMER = setInterval(async () => {
    if (!TOKEN || IS_BUSY || IS_BOOTING) return;
    try {
      await silentRefreshData();
    } catch (e) {
      console.warn('Auto refresh failed:', e.message);
    }
  }, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (AUTO_REFRESH_TIMER) {
    clearInterval(AUTO_REFRESH_TIMER);
    AUTO_REFRESH_TIMER = null;
  }
}

async function silentRefreshData() {
  const data = await api('getAppData', { token: TOKEN });

  APP.may = Array.isArray(data.may) ? data.may : [];
  APP.hienTuong = Array.isArray(data.hienTuong) ? data.hienTuong : [];
  APP.vatTu = Array.isArray(data.vatTu) ? data.vatTu : [];
  APP.ktv = Array.isArray(data.ktv) ? data.ktv : [];
  APP.vatTuCoDinh = Array.isArray(data.vatTuCoDinh) ? data.vatTuCoDinh : [];

  CURRENT_USER = data.currentUser || CURRENT_USER;
  renderUserBox();
  setupRoleUI();
  saveSession();

  fillKtvSelects(true);
  fillMachineSelect(true);
  fillHienTuongSelect(true);
  renderVatTuSearch();
  renderSelectedItems();

  const historyTab = document.getElementById('historyTab');
  if (historyTab && !historyTab.classList.contains('hidden')) await loadPhieuList(true);

  const adminTab = document.getElementById('adminTab');
  if (CURRENT_USER && CURRENT_USER.role === 'admin' && adminTab && !adminTab.classList.contains('hidden')) {
    await loadAccounts(true);
  }
}

/****************************************************
 * TABS
 ****************************************************/

function showTab(tabId, btn) {
  document.querySelectorAll('.tab').forEach(x => x.classList.add('hidden'));
  document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));

  const tab = document.getElementById(tabId);
  if (tab) tab.classList.remove('hidden');
  if (btn) btn.classList.add('active');

  if (tabId === 'historyTab') loadPhieuList(true);
  if (tabId === 'adminTab') loadAccounts(true);
}

/****************************************************
 * SELECT DATA - KTV POPUP
 ****************************************************/

function fillKtvSelects(keepValue) {
  KTV_NAME_CACHE = getKtvNames();

  fillNamePopupInput('doiTruong', KTV_NAME_CACHE, keepValue);
  fillNamePopupInput('nguoiXuatKho', KTV_NAME_CACHE, keepValue);
  fillNamePopupInput('nguoiNhapKho', KTV_NAME_CACHE, keepValue);

  renderMemberDropdown();
}

function fillNamePopupInput(id, names, keepValue) {
  const input = document.getElementById(id);
  if (!input) return;

  const oldValue = keepValue ? input.value : '';

  if (!keepValue) {
    input.value = '';
  }

  renderNamePopup(id, names);

  if (keepValue && oldValue) {
    input.value = oldValue;
  }
}

function openNamePopup(id) {
  const popup = document.getElementById(id + 'Popup');
  if (!popup) return;

  filterNamePopup(id);
  popup.classList.remove('hidden');
}

function toggleNamePopup(id) {
  const popup = document.getElementById(id + 'Popup');
  if (!popup) return;

  if (popup.classList.contains('hidden')) {
    openNamePopup(id);
  } else {
    popup.classList.add('hidden');
  }
}

function filterNamePopup(id) {
  const input = document.getElementById(id);
  if (!input) return;

  const keyword = normText(input.value);

  const names = KTV_NAME_CACHE.filter(name => {
    if (!keyword) return true;
    return normText(name).includes(keyword);
  });

  renderNamePopup(id, names);

  const popup = document.getElementById(id + 'Popup');
  if (popup) popup.classList.remove('hidden');
}

function renderNamePopup(id, names) {
  const popup = document.getElementById(id + 'Popup');
  if (!popup) return;

  if (!names.length) {
    popup.innerHTML = '<div class="search-popup-empty">Không tìm thấy tên phù hợp.</div>';
    return;
  }

  popup.innerHTML = names.map(name => {
    return `
      <div class="search-option" onclick="selectNamePopup('${escapeJs(id)}', '${escapeJs(name)}')">
        <div class="search-option-title">${escapeHtml(name)}</div>
      </div>
    `;
  }).join('');
}

function selectNamePopup(id, name) {
  setValue(id, name);

  const popup = document.getElementById(id + 'Popup');
  if (popup) popup.classList.add('hidden');

  if (id === 'doiTruong') {
    onDoiTruongChange();
  }
}

function closeSearchPopupsOnOutsideClick(e) {
  const popupBoxes = [
    'doiTruongBox',
    'nguoiXuatKhoBox',
    'nguoiNhapKhoBox',
    'maMayBox'
  ];

  popupBoxes.forEach(boxId => {
    const box = document.getElementById(boxId);
    if (!box) return;

    if (!box.contains(e.target)) {
      const popup = box.querySelector('.search-popup');
      if (popup) popup.classList.add('hidden');
    }
  });
}

function closeAllSearchPopups() {
  document.querySelectorAll('.search-popup').forEach(popup => {
    popup.classList.add('hidden');
  });
}

function getKtvNames() {
  return uniqueArray(APP.ktv
    .map(x => getObjValue(x, ['Họ Và Tên', 'Họ và tên', 'Tên kỹ thuật', 'Tên', 'Ho Va Ten']))
    .map(x => String(x || '').trim())
    .filter(Boolean));
}

/****************************************************
 * MACHINE POPUP
 ****************************************************/

function fillMachineSelect(keepValue) {
  const input = document.getElementById('maMay');
  if (!input) return;

  const oldValue = keepValue ? input.value : '';

  MACHINE_CACHE = APP.may
    .filter(m => getMayCode(m))
    .sort((a, b) => getMayCode(a).localeCompare(getMayCode(b), 'vi'));

  if (!keepValue) {
    input.value = '';
  }

  renderMachinePopup(MACHINE_CACHE);

  if (keepValue && oldValue) {
    input.value = oldValue;
  }

  onMayChange();
}

function openMachinePopup() {
  filterMachinePopup();

  const popup = document.getElementById('maMayPopup');
  if (popup) popup.classList.remove('hidden');
}

function toggleMachinePopup() {
  const popup = document.getElementById('maMayPopup');
  if (!popup) return;

  if (popup.classList.contains('hidden')) {
    openMachinePopup();
  } else {
    popup.classList.add('hidden');
  }
}

function filterMachinePopup() {
  const input = document.getElementById('maMay');
  if (!input) return;

  const keyword = normText(input.value);

  const list = MACHINE_CACHE.filter(may => {
    if (!keyword) return true;

    const haystack = normText([
      getMayCode(may),
      getTenTrai(may),
      getDonVi(may),
      getKhuVuc(may),
      getTinhTP(may),
      getAllObjectValuesText(may)
    ].join(' '));

    return haystack.includes(keyword);
  });

  renderMachinePopup(list);

  const popup = document.getElementById('maMayPopup');
  if (popup) popup.classList.remove('hidden');
}

function renderMachinePopup(list) {
  const popup = document.getElementById('maMayPopup');
  if (!popup) return;

  if (!list.length) {
    popup.innerHTML = '<div class="search-popup-empty">Không tìm thấy máy phù hợp.</div>';
    return;
  }

  popup.innerHTML = list.map(may => {
    const maMay = getMayCode(may);
    const tenTrai = getTenTrai(may);
    const donVi = getDonVi(may);
    const tinhTP = getTinhTP(may);
    const khuVuc = getKhuVuc(may);

    const subInfo = [
      tenTrai,
      donVi,
      tinhTP,
      khuVuc
    ].filter(Boolean).join(' · ');

    return `
      <div class="search-option machine-option" onclick="selectMachinePopup('${escapeJs(maMay)}')">
        <div class="search-option-title">${escapeHtml(maMay)}</div>
        <div class="search-option-sub">${escapeHtml(subInfo)}</div>
      </div>
    `;
  }).join('');
}

function selectMachinePopup(maMay) {
  setValue('maMay', maMay);

  const popup = document.getElementById('maMayPopup');
  if (popup) popup.classList.add('hidden');

  onMayChange();
}

function getAllObjectValuesText(obj) {
  if (!obj) return '';

  return Object.keys(obj).map(k => {
    const v = obj[k];
    if (v === null || v === undefined) return '';
    return String(v);
  }).join(' ');
}

/****************************************************
 * HỆ THỐNG / HIỆN TƯỢNG / THÀNH VIÊN
 ****************************************************/

function fillHienTuongSelect(keepValue) {
  HIENTUONG_CACHE = getHienTuongNames();

  if (!keepValue) {
    SELECTED_HIEN_TUONG = [];
  }

  renderHienTuongDropdown();
  renderHienTuongText();
}

function getHienTuongNames() {
  const list = APP.hienTuong
    .map(x => getObjValue(x, [
      'Hiện Tượng/Sự cố',
      'Hiện tượng/Sự cố',
      'Hiện tượng/sự cố',
      'Hiện tượng',
      'Hien tuong',
      'Sự cố',
      'Lỗi'
    ]))
    .map(x => String(x || '').trim())
    .filter(Boolean);

  return uniqueArray(list);
}

function toggleHienTuongDropdown() {
  const dropdown = document.getElementById('hienTuongDropdown');
  if (!dropdown) return;

  dropdown.classList.toggle('hidden');
  renderHienTuongDropdown();
}

function renderHienTuongDropdown() {
  const dropdown = document.getElementById('hienTuongDropdown');
  if (!dropdown) return;

  const rawKeyword = getValue('hienTuongSearch');
  const keyword = normText(rawKeyword);

  const list = HIENTUONG_CACHE.filter(name => {
    if (!keyword) return true;
    return normText(name).includes(keyword);
  });

  const searchBox = `
    <div class="multi-search-row">
      <input
        id="hienTuongSearch"
        type="text"
        value="${escapeHtml(rawKeyword)}"
        placeholder="Gõ để tìm hiện tượng..."
        autocomplete="off"
        oninput="renderHienTuongDropdown()"
        onclick="event.stopPropagation()"
      >
    </div>
  `;

  if (!list.length) {
    dropdown.innerHTML = searchBox + '<div class="multi-option">Không tìm thấy hiện tượng phù hợp.</div>';
    return;
  }

  dropdown.innerHTML = searchBox + list.map(name => {
    const checked = SELECTED_HIEN_TUONG.includes(name) ? 'checked' : '';

    return `
      <label class="multi-option">
        <input
          type="checkbox"
          ${checked}
          onchange="toggleHienTuong('${escapeJs(name)}', this.checked)"
        >
        <span>${escapeHtml(name)}</span>
      </label>
    `;
  }).join('');
}

function toggleHienTuong(name, checked) {
  if (checked) {
    if (!SELECTED_HIEN_TUONG.includes(name)) {
      SELECTED_HIEN_TUONG.push(name);
    }
  } else {
    SELECTED_HIEN_TUONG = SELECTED_HIEN_TUONG.filter(x => x !== name);
  }

  renderHienTuongText();
  renderVatTuSearch();
}

function renderHienTuongText() {
  const text = document.getElementById('hienTuongText');
  if (!text) return;

  text.textContent = SELECTED_HIEN_TUONG.length
    ? SELECTED_HIEN_TUONG.join('; ')
    : 'Không chọn hiện tượng';
}

function fillSelect(id, values, placeholder, keepValue) {
  const select = document.getElementById(id);
  if (!select) return;

  const oldValue = keepValue ? select.value : '';
  select.innerHTML = '';

  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = placeholder || '-- Chọn --';
  select.appendChild(emptyOpt);

  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  });

  if (keepValue && oldValue) select.value = oldValue;
}

function onDoiTruongChange() {
  const doiTruong = getValue('doiTruong');
  SELECTED_MEMBERS = SELECTED_MEMBERS.filter(x => x !== doiTruong);
  renderMemberDropdown();
  renderMemberText();
}

function toggleMemberDropdown() {
  const dropdown = document.getElementById('thanhVienDropdown');
  if (!dropdown) return;
  dropdown.classList.toggle('hidden');
  renderMemberDropdown();
}

function renderMemberDropdown() {
  const dropdown = document.getElementById('thanhVienDropdown');
  if (!dropdown) return;

  const doiTruong = getValue('doiTruong');
  const rawKeyword = getValue('memberSearch');
  const keyword = normText(rawKeyword);

  let names = getKtvNames().filter(x => x !== doiTruong);

  if (keyword) {
    names = names.filter(name => normText(name).includes(keyword));
  }

  const searchBox = `
    <div class="multi-search-row">
      <input
        id="memberSearch"
        type="text"
        value="${escapeHtml(rawKeyword)}"
        placeholder="Gõ để tìm thành viên..."
        autocomplete="off"
        oninput="renderMemberDropdown()"
        onclick="event.stopPropagation()"
      >
    </div>
  `;

  if (!names.length) {
    dropdown.innerHTML = searchBox + '<div class="search-popup-empty">Không tìm thấy thành viên phù hợp.</div>';
    renderMemberText();
    return;
  }

  dropdown.innerHTML = searchBox + names.map(name => {
    const selected = SELECTED_MEMBERS.includes(name) ? 'selected' : '';

    return `
      <div
        class="search-option member-option ${selected}"
        onclick="toggleMemberByName('${escapeJs(name)}')"
      >
        <div class="search-option-title">${escapeHtml(name)}</div>
      </div>
    `;
  }).join('');

  renderMemberText();
}

function toggleMemberByName(name) {
  if (SELECTED_MEMBERS.includes(name)) {
    SELECTED_MEMBERS = SELECTED_MEMBERS.filter(x => x !== name);
  } else {
    SELECTED_MEMBERS.push(name);
  }

  renderMemberDropdown();
  renderMemberText();
}

function renderMemberText() {
  const text = document.getElementById('thanhVienText');
  if (!text) return;

  if (!SELECTED_MEMBERS.length) {
    text.innerHTML = 'Chọn thành viên';
    return;
  }

  text.innerHTML = SELECTED_MEMBERS.map(name => {
    return `
      <span class="selected-chip">
        ${escapeHtml(name)}
        <span class="selected-chip-x" onclick="event.stopPropagation(); removeMemberChip('${escapeJs(name)}')">×</span>
      </span>
    `;
  }).join('');
}

function removeMemberChip(name) {
  SELECTED_MEMBERS = SELECTED_MEMBERS.filter(x => x !== name);
  renderMemberDropdown();
  renderMemberText();
}

/****************************************************
 * MACHINE INFO
 ****************************************************/

function onMayChange() {
  const maMayInput = getValue('maMay');
  const may = findMayByCode(maMayInput);

  if (!may) {
    setText('tenTrai', '');
    setText('donVi', '');
    setText('khuVuc', '');
    setText('tinhTP', '');
    return;
  }

  const maMayChuan = getMayCode(may);

  if (maMayInput !== maMayChuan) {
    setValue('maMay', maMayChuan);
  }

  setText('tenTrai', getTenTrai(may));
  setText('donVi', getDonVi(may));
  setText('khuVuc', getKhuVuc(may));
  setText('tinhTP', getTinhTP(may));
}

function getMayCode(obj) {
  return String(getObjValue(obj, ['Mã Máy', 'Mã máy', 'Ma May', 'Ma may', 'Mã hệ thống', 'Mã máy phát', 'Code', 'Mã']) || '').trim();
}

function findMayByCode(maMay) {
  const codeNorm = normText(maMay);
  if (!codeNorm) return null;
  return APP.may.find(row => normText(getMayCode(row)) === codeNorm) || null;
}

function getCurrentMachine() {
  return findMayByCode(getValue('maMay'));
}

function getTenTrai(may) {
  return String(getObjValue(may, ['Tên Trang Trại / Đơn Vị', 'Tên trang trại / đơn vị', 'Ten Trang Trai / Don Vi', 'Tên Trang Trại', 'Tên trang trại', 'Tên trại', 'Ten trai', 'Trang trại', 'Trang trai', 'Địa chỉ trại']) || '').trim();
}

function getDonVi(may) {
  return String(getObjValue(may, ['Đơn vị hợp tác', 'Đơn Vị Hợp Tác', 'Don vi hop tac', 'Đơn vị', 'Đơn Vị', 'Don vi']) || '').trim();
}

function getKhuVuc(may) {
  return String(getObjValue(may, ['Khu Vực', 'Khu vực', 'Khu Vuc', 'Khu vuc']) || '').trim();
}

function getTinhTP(may) {
  return String(getObjValue(may, ['Tỉnh Thành', 'Tỉnh thành', 'Tinh Thanh', 'Tỉnh/TP', 'Tinh/TP', 'Tỉnh / TP', 'Tỉnh', 'Tinh', 'Thành phố', 'Thanh pho']) || '').trim();
}

/****************************************************
 * PURPOSE / DATE
 ****************************************************/

function onMucDichChange() {
  const mucDich = getRadioValue('mucDich');
  const boxHienTuong = document.getElementById('boxHienTuong');
  const boxCuThe = document.getElementById('boxCuThe');

  if (mucDich === 'Bảo dưỡng sửa chữa') {
    if (boxHienTuong) boxHienTuong.classList.remove('hidden');
    if (boxCuThe) boxCuThe.classList.add('hidden');
  } else {
    if (boxHienTuong) boxHienTuong.classList.add('hidden');
    if (boxCuThe) boxCuThe.classList.remove('hidden');
  }

  renderVatTuSearch();
}

function setDefaultDateTime() {
  setValue('ngayGioXuatKho', toDatetimeLocalValue(new Date()));
}

/****************************************************
 * MATERIALS
 ****************************************************/

function resetSelectedMaterials() {
  APP.selected = [];

  getFixedMaterials().forEach(item => {
    addOrUpdateSelected({
      id: makeMaterialId(item),
      nguonVatTu: 'Cố định',
      cumLinhKien: getCumLinhKien(item),
      tenVatTu: getTenVatTu(item),
      maVatTu: getObjValue(item, ['Mã vật tư', 'Ma vat tu', 'Mã Vật Tư']) || '',
      donViTinh: getObjValue(item, ['ĐVT', 'Đơn vị tính', 'DVT']) || '',
      soLuongCan: normalizeQty(getObjValue(item, ['Số lượng', 'SL', 'Số lượng cần']) || 1),
      tinhTrangXuatKho: getObjValue(item, ['Tình trạng', 'Tinh trang']) || 'Mới',
      ghiChu: getObjValue(item, ['Ghi chú', 'Ghi chu']) || '',
      fixed: true
    });
  });

  renderVatTuSearch();
  renderSelectedItems();
}

function getFixedMaterials() {
  return APP.vatTuCoDinh.filter(x => getTenVatTu(x));
}

function getSelectableMaterials() {
  const mucDich = getRadioValue('mucDich');

  // Lắp đặt / Sản xuất: hiện toàn bộ vật tư
  if (mucDich !== 'Bảo dưỡng sửa chữa') {
    return APP.vatTu.filter(x => getTenVatTu(x));
  }

  // Bảo dưỡng sửa chữa nhưng chưa chọn hiện tượng: hiện toàn bộ vật tư
  if (!SELECTED_HIEN_TUONG.length) {
    return APP.vatTu.filter(x => getTenVatTu(x));
  }

  // Có chọn hiện tượng: chỉ hiện vật tư thuộc các cụm liên quan
  const relatedCums = [];

  SELECTED_HIEN_TUONG.forEach(ht => {
    getRelatedCumsByHienTuong(ht).forEach(cum => relatedCums.push(cum));
  });

  const relatedNorms = uniqueArray(relatedCums).map(normText);

  if (!relatedNorms.length) {
    return [];
  }

  return APP.vatTu.filter(item => {
    const tenVatTu = getTenVatTu(item);
    const cumVatTu = getCumLinhKien(item);
    return tenVatTu && cumVatTu && relatedNorms.includes(normText(cumVatTu));
  });
}

function getRelatedCumsByHienTuong(hienTuong) {
  const htNorm = normText(hienTuong);
  const cums = [];

  APP.hienTuong.forEach(row => {
    const tenHienTuong = getObjValue(row, ['Hiện Tượng/Sự cố', 'Hiện tượng/Sự cố', 'Hiện tượng/sự cố', 'Hien Tuong/Su co', 'Hien tuong/Su co', 'Hiện tượng', 'Sự cố']);
    if (normText(tenHienTuong) !== htNorm) return;

    const cumLienQuan = getObjValue(row, ['Cụm Linh Kiện Liên Quan', 'Cụm linh kiện liên quan', 'Cum Linh Kien Lien Quan', 'Cum linh kien lien quan', 'Cụm Linh Kiện', 'Cụm linh kiện']);
    if (!cumLienQuan) return;

    String(cumLienQuan)
      .split(/[;,|\/]/)
      .map(x => x.trim())
      .filter(Boolean)
      .forEach(x => cums.push(x));
  });

  return uniqueArray(cums);
}

function renderVatTuSearch() {
  const box = document.getElementById('vatTuSearchList');
  if (!box) return;

  const keyword = normText(getValue('searchVatTu'));
  const selectedIds = new Set(APP.selected.map(x => x.id));
  let list = getSelectableMaterials().filter(item => {
    const id = makeMaterialId(item);
    if (selectedIds.has(id)) return false;
    if (!keyword) return true;

    const haystack = normText([
      getTenVatTu(item),
      getCumLinhKien(item),
      getObjValue(item, ['Mã vật tư', 'Ma vat tu', 'Mã Vật Tư']),
      getObjValue(item, ['Ghi chú', 'Ghi chu'])
    ].join(' '));

    return haystack.includes(keyword);
  });

  if (!list.length) {
  box.classList.remove('hidden');
  const mucDich = getRadioValue('mucDich');

  if (mucDich === 'Bảo dưỡng sửa chữa' && SELECTED_HIEN_TUONG.length) {
    box.innerHTML = '<div class="suggest-row suggest-empty">Các hiện tượng đã chọn chưa được gán cụm linh kiện/vật tư liên quan trong dữ liệu.</div>';
  } else {
    box.innerHTML = '<div class="suggest-row suggest-empty">Không có vật tư phù hợp để chọn thêm.</div>';
  }

  return;
}

  const groups = groupBy(list, item => getCumLinhKien(item) || 'Khác');
  box.classList.remove('hidden');
  box.innerHTML = Object.keys(groups).sort().map(groupName => {
    const rows = groups[groupName].map(item => {
      const id = makeMaterialId(item);
      const ten = getTenVatTu(item);
      const maVatTu = getObjValue(item, ['Mã vật tư', 'Ma vat tu', 'Mã Vật Tư']) || '';
      const dvt = getObjValue(item, ['ĐVT', 'Đơn vị tính', 'DVT']) || '';

      return `
        <div class="suggest-row">
          <input type="checkbox" onchange="selectMaterialFromSearch('${escapeJs(id)}', this.checked)">
          <div>
            <b>${escapeHtml(ten)}</b><br>
            <small>${escapeHtml(groupName)}${maVatTu ? ' - ' + escapeHtml(maVatTu) : ''}${dvt ? ' - ĐVT: ' + escapeHtml(dvt) : ''}</small>
          </div>
          <input id="qty_search_${cssId(id)}" type="number" min="0" step="1" value="1">
          <select id="status_search_${cssId(id)}">
            <option value="Mới">Mới</option>
            <option value="Cũ">Cũ</option>
            <option value="Tốt">Tốt</option>
            <option value="K.xđ">K.xđ</option>
          </select>
        </div>`;
    }).join('');

    return `<div class="suggest-group"><div class="suggest-group-title">${escapeHtml(groupName)}</div>${rows}</div>`;
  }).join('');
}

function selectMaterialFromSearch(id, checked) {
  if (!checked) return;

  const sourceItem = APP.vatTu.find(x => makeMaterialId(x) === id) || APP.vatTuCoDinh.find(x => makeMaterialId(x) === id);
  if (!sourceItem) return;

  const qtyEl = document.getElementById('qty_search_' + cssId(id));
  const statusEl = document.getElementById('status_search_' + cssId(id));

  addOrUpdateSelected({
    id,
    nguonVatTu: 'Chọn thêm',
    cumLinhKien: getCumLinhKien(sourceItem),
    tenVatTu: getTenVatTu(sourceItem),
    maVatTu: getObjValue(sourceItem, ['Mã vật tư', 'Ma vat tu', 'Mã Vật Tư']) || '',
    donViTinh: getObjValue(sourceItem, ['ĐVT', 'Đơn vị tính', 'DVT']) || '',
    soLuongCan: normalizeQty(qtyEl ? qtyEl.value : 1),
    tinhTrangXuatKho: statusEl ? statusEl.value : 'Mới',
    ghiChu: getObjValue(sourceItem, ['Ghi chú', 'Ghi chu']) || '',
    fixed: false
  });

  renderVatTuSearch();
  renderSelectedItems();
}

function addOrUpdateSelected(item) {
  const idx = APP.selected.findIndex(x => x.id === item.id);
  if (idx >= 0) APP.selected[idx] = { ...APP.selected[idx], ...item };
  else APP.selected.push(item);
}

function removeSelectedMaterial(id) {
  const item = APP.selected.find(x => x.id === id);
  if (item && item.fixed) {
    alert('Vật tư cố định không nên bỏ chọn. Nếu vẫn không cần mang đi, có thể sửa số lượng về 0.');
    return;
  }

  APP.selected = APP.selected.filter(x => x.id !== id);
  renderVatTuSearch();
  renderSelectedItems();
}

function updateSelectedQty(id, value) {
  const item = APP.selected.find(x => x.id === id);
  if (item) item.soLuongCan = normalizeQty(value);
}

function updateSelectedStatus(id, value) {
  const item = APP.selected.find(x => x.id === id);
  if (item) item.tinhTrangXuatKho = value;
}

function renderSelectedItems() {
  const box = document.getElementById('selectedItems');
  if (!box) return;

  if (!APP.selected.length) {
    box.innerHTML = '<i>Chưa chọn vật tư.</i>';
    return;
  }

  box.innerHTML = APP.selected.map(item => {
    const id = item.id;
    const removeBtn = item.fixed
      ? '<small>Vật tư cố định</small>'
      : `<button type="button" class="small-btn danger" onclick="removeSelectedMaterial('${escapeJs(id)}')">Bỏ</button>`;

    return `
      <div class="item-row">
        <input type="checkbox" checked onchange="removeSelectedMaterial('${escapeJs(id)}')">
        <div><b>${escapeHtml(item.tenVatTu)}</b><br><small>${escapeHtml(item.cumLinhKien || '')}${item.nguonVatTu ? ' - ' + escapeHtml(item.nguonVatTu) : ''}</small></div>
        <input type="number" min="0" step="1" value="${escapeHtml(item.soLuongCan)}" onchange="updateSelectedQty('${escapeJs(id)}', this.value)">
        <select onchange="updateSelectedStatus('${escapeJs(id)}', this.value)">${statusOptions(item.tinhTrangXuatKho)}</select>
        <div>${removeBtn}</div>
      </div>`;
  }).join('');
}

function statusOptions(current) {
  const list = ['Mới', 'Cũ', 'Tốt', 'K.xđ'];
  return list.map(x => `<option value="${x}" ${x === current ? 'selected' : ''}>${x}</option>`).join('');
}

function getTenVatTu(item) {
  return String(getObjValue(item, ['Tên Chi Tiết / Linh Kiện Thay Thế', 'Tên chi tiết / linh kiện thay thế', 'Ten Chi Tiet / Linh Kien Thay The', 'Ten chi tiet / linh kien thay the', 'Tên vật tư', 'Ten vat tu']) || '').trim();
}

function getCumLinhKien(item) {
  return String(getObjValue(item, ['Cụm Linh Kiện', 'Cụm linh kiện', 'Cum Linh Kien', 'Cum linh kien']) || '').trim();
}

function makeMaterialId(item) {
  const ten = getTenVatTu(item);
  const cum = getCumLinhKien(item);
  const ma = getObjValue(item, ['Mã vật tư', 'Ma vat tu', 'Mã Vật Tư']) || '';
  return normText(cum + '|' + ten + '|' + ma);
}

/****************************************************
 * FORM PAYLOAD
 ****************************************************/

function collectFormPayload() {
  const mucDich = getRadioValue('mucDich');
const cuThe = mucDich === 'Bảo dưỡng sửa chữa'
  ? SELECTED_HIEN_TUONG.join('; ')
  : getValue('cuTheNhapTay').trim();
  const maMay = getValue('maMay');
  const may = findMayByCode(maMay);

  return {
    doiTruong: getValue('doiTruong'),
    thanhVien: SELECTED_MEMBERS.slice(),
    maMay,
    tenTrai: may ? getTenTrai(may) : getText('tenTrai'),
    donVi: may ? getDonVi(may) : getText('donVi'),
    khuVuc: may ? getKhuVuc(may) : getText('khuVuc'),
    tinhTP: may ? getTinhTP(may) : getText('tinhTP'),
    ngayGioXuatKho: formatDateTimeForPayload(getValue('ngayGioXuatKho')),
    nguoiXuatKho: getValue('nguoiXuatKho'),
    ngayGioNhapKho: formatDateTimeForPayload(getValue('ngayGioNhapKho')),
    nguoiNhapKho: getValue('nguoiNhapKho'),
    mucDich,
    cuThe,
    ghiChu: '',
    items: APP.selected.map((x, idx) => ({
      stt: idx + 1,
      nguonVatTu: x.nguonVatTu || '',
      cumLinhKien: x.cumLinhKien || '',
      tenVatTu: x.tenVatTu || '',
      maVatTu: x.maVatTu || '',
      donViTinh: x.donViTinh || '',
      soLuongCan: x.soLuongCan || '',
      soLuongXuatKho: '',
      tinhTrangXuatKho: x.tinhTrangXuatKho || 'Mới',
      soLuongSuDung: '',
      soLuongNhapKho: '',
      tinhTrangNhapKho: '',
      ghiChu: x.ghiChu || ''
    }))
  };
}

function validatePayloadClient(payload) {
  if (!payload.doiTruong) return 'Vui lòng chọn đội trưởng.';
  if (!payload.maMay) return 'Vui lòng chọn mã máy.';
  if (!payload.ngayGioXuatKho) return 'Vui lòng nhập ngày giờ xuất kho.';
  if (!payload.nguoiXuatKho) return 'Vui lòng chọn người xuất kho.';
  if (!payload.mucDich) return 'Vui lòng chọn mục đích.';
  if (payload.mucDich !== 'Bảo dưỡng sửa chữa' && !payload.cuThe) {
  return 'Vui lòng nhập nội dung cụ thể.';
}
  if (!payload.items || !payload.items.length) return 'Vui lòng chọn vật tư.';

  if (Array.isArray(payload.thanhVien) && payload.thanhVien.includes(payload.doiTruong)) {
    return 'Thành viên không được trùng với đội trưởng.';
  }

  return '';
}

/****************************************************
 * SAVE / PREVIEW / EDIT
 ****************************************************/

async function previewCurrentForm() {
  const payload = collectFormPayload();
  const err = validatePayloadClient(payload);
  if (err) return alert(err);

  setBusy(true, 'Đang tạo xem trước...');
  try {
    const html = await api('previewDraft', { token: TOKEN, payload });
    openPreviewHtml(html);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

async function save() {
  const payload = collectFormPayload();
  const err = validatePayloadClient(payload);
  if (err) return alert(err);

  setBusy(true, EDITING_MA_PHIEU ? 'Đang cập nhật phiếu...' : 'Đang lưu phiếu...');
  try {
    const res = EDITING_MA_PHIEU
      ? await api('updatePhieu', { token: TOKEN, maPhieu: EDITING_MA_PHIEU, payload })
      : await api('savePhieu', { token: TOKEN, payload });

    alert((EDITING_MA_PHIEU ? 'Đã cập nhật phiếu: ' : 'Đã lưu phiếu: ') + res.maPhieu);
    resetForm();
    await loadPhieuList(false);
    const historyBtn = [...document.querySelectorAll('.nav')].find(btn => (btn.textContent || '').includes('Phiếu đã tạo'));
    showTab('historyTab', historyBtn);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

function resetForm() {
  EDITING_MA_PHIEU = '';

  const title = document.getElementById('formTitle');
  if (title) title.textContent = 'Phiếu chuẩn bị vật tư';

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.textContent = 'Lưu phiếu';

  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.classList.add('hidden');

  setValue('doiTruong', '');
  SELECTED_MEMBERS = [];
  renderMemberDropdown();
  renderMemberText();

  setValue('maMay', '');
  onMayChange();
  setDefaultDateTime();
  setValue('nguoiXuatKho', '');
  setValue('ngayGioNhapKho', '');
  setValue('nguoiNhapKho', '');
  setRadioValue('mucDich', 'Bảo dưỡng sửa chữa');
  SELECTED_HIEN_TUONG = [];
  renderHienTuongDropdown();
  renderHienTuongText();
  setValue('cuTheNhapTay', '');
  setValue('searchVatTu', '');
  onMucDichChange();
  resetSelectedMaterials();
  closeAllSearchPopups();
}

function cancelEdit() {
  resetForm();
}

async function editPhieu(maPhieu) {
  setBusy(true, 'Đang tải phiếu để sửa...');
  try {
    const data = await api('getPhieuDetail', { token: TOKEN, maPhieu });
    fillFormFromPhieu(data.phieu, data.items);
    const formBtn = [...document.querySelectorAll('.nav')].find(btn => (btn.textContent || '').includes('Tạo phiếu'));
    showTab('formTab', formBtn);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

function fillFormFromPhieu(phieu, items) {
  EDITING_MA_PHIEU = phieu.maPhieu;

  const title = document.getElementById('formTitle');
  if (title) title.textContent = 'Chỉnh sửa phiếu: ' + phieu.maPhieu;

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.textContent = 'Cập nhật phiếu';

  const cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  setValue('doiTruong', phieu.doiTruong || '');
  SELECTED_MEMBERS = String(phieu.thanhVien || '').split(';').map(x => x.trim()).filter(Boolean);
  renderMemberDropdown();
  renderMemberText();

  setValue('maMay', phieu.maMay || '');
  onMayChange();
  setValue('ngayGioXuatKho', parseDateTimeToInput(phieu.ngayGioXuatKho));
  setValue('nguoiXuatKho', phieu.nguoiXuatKho || '');
  setValue('ngayGioNhapKho', parseDateTimeToInput(phieu.ngayGioNhapKho));
  setValue('nguoiNhapKho', phieu.nguoiNhapKho || '');

  setRadioValue('mucDich', phieu.mucDich || 'Bảo dưỡng sửa chữa');
  onMucDichChange();

  if ((phieu.mucDich || '') === 'Bảo dưỡng sửa chữa') {
  SELECTED_HIEN_TUONG = String(phieu.cuThe || '')
    .split(';')
    .map(x => x.trim())
    .filter(Boolean);

  renderHienTuongDropdown();
  renderHienTuongText();
} else {
  SELECTED_HIEN_TUONG = [];
  renderHienTuongDropdown();
  renderHienTuongText();
  setValue('cuTheNhapTay', phieu.cuThe || '');
}

  APP.selected = (items || []).map(x => ({
    id: makeMaterialId({ 'Cụm Linh Kiện': x.cumLinhKien, 'Tên Chi Tiết / Linh Kiện Thay Thế': x.tenVatTu, 'Mã vật tư': x.maVatTu }),
    nguonVatTu: x.nguonVatTu || '',
    cumLinhKien: x.cumLinhKien || '',
    tenVatTu: x.tenVatTu || '',
    maVatTu: x.maVatTu || '',
    donViTinh: x.donViTinh || '',
    soLuongCan: x.soLuongCan || 1,
    tinhTrangXuatKho: x.tinhTrangXuatKho || 'Mới',
    ghiChu: x.ghiChu || '',
    fixed: x.nguonVatTu === 'Cố định'
  }));

  setValue('searchVatTu', '');
  renderVatTuSearch();
  renderSelectedItems();
}

/****************************************************
 * HISTORY / EXPORT / DELETE
 ****************************************************/

async function loadPhieuList(silent) {
  if (!TOKEN) return;

  const box = document.getElementById('phieuList');
  if (!box) return;
  if (!silent) box.innerHTML = '<i>Đang tải danh sách phiếu...</i>';

  try {
    const list = await api('listPhieu', { token: TOKEN });
    renderPhieuList(list || []);
  } catch (err) {
    box.innerHTML = '<span class="msg">Lỗi tải phiếu: ' + escapeHtml(err.message) + '</span>';
  }
}

function renderPhieuList(list) {
  const box = document.getElementById('phieuList');
  if (!box) return;

  if (!list.length) {
    box.innerHTML = '<i>Chưa có phiếu nào.</i>';
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Mã phiếu</th><th>Ngày tạo</th><th>Mã máy</th><th>Tên trại</th><th>Đội trưởng</th><th>Thành viên</th><th>Mục đích</th><th>Cụ thể</th><th>Trạng thái</th><th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(p => `
            <tr>
              <td><b>${escapeHtml(p.maPhieu)}</b></td>
              <td>${escapeHtml(p.ngayTao)}</td>
              <td>${escapeHtml(p.maMay)}</td>
              <td>${escapeHtml(p.tenTrai)}</td>
              <td>${escapeHtml(p.doiTruong)}</td>
              <td>${escapeHtml(p.thanhVien)}</td>
              <td>${escapeHtml(p.mucDich)}</td>
              <td>${escapeHtml(p.cuThe)}</td>
              <td>${escapeHtml(p.trangThai)}</td>
              <td>
                <button type="button" class="small-btn" onclick="previewSavedPhieu('${escapeJs(p.maPhieu)}')">Xem trước</button>
                <button type="button" class="small-btn" onclick="exportPdf('${escapeJs(p.maPhieu)}')">PDF</button>
                <button type="button" class="small-btn" onclick="exportWord('${escapeJs(p.maPhieu)}')">Word</button>
                <button type="button" class="small-btn secondary" onclick="editPhieu('${escapeJs(p.maPhieu)}')">Sửa</button>
                <button type="button" class="small-btn danger" onclick="deletePhieuUI('${escapeJs(p.maPhieu)}')">Xóa</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function previewSavedPhieu(maPhieu) {
  setBusy(true, 'Đang mở xem trước...');
  try {
    const html = await api('previewPhieu', { token: TOKEN, maPhieu });
    openPreviewHtml(html);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

async function exportPdf(maPhieu) {
  setBusy(true, 'Đang xuất PDF...');
  try {
    const url = await api('exportPhieuPdf', { token: TOKEN, maPhieu });
    window.open(url, '_blank');
    await loadPhieuList(true);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

async function exportWord(maPhieu) {
  setBusy(true, 'Đang xuất Word...');
  try {
    const url = await api('exportPhieuWord', { token: TOKEN, maPhieu });
    window.open(url, '_blank');
    await loadPhieuList(true);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

async function deletePhieuUI(maPhieu) {
  if (!maPhieu) return;

  const ok = confirm('Bạn chắc chắn muốn xóa phiếu ' + maPhieu + '?\n\nThao tác này sẽ xóa dữ liệu ở sheet 10, sheet 11 và chuyển file PDF/Word vào thùng rác nếu có.');
  if (!ok) return;

  setBusy(true, 'Đang xóa phiếu...');
  try {
    await api('deletePhieu', { token: TOKEN, maPhieu });
    alert('Đã xóa phiếu: ' + maPhieu);
    if (EDITING_MA_PHIEU === maPhieu) resetForm();
    await loadPhieuList(false);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

/****************************************************
 * PREVIEW MODAL
 ****************************************************/

function openPreviewHtml(html) {
  const modal = document.getElementById('previewModal');
  const frame = document.getElementById('previewFrame');
  if (!modal || !frame) return;

  modal.classList.remove('hidden');
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  const frame = document.getElementById('previewFrame');
  if (modal) modal.classList.add('hidden');

  if (frame) {
    try {
      const doc = frame.contentWindow.document;
      doc.open();
      doc.write('');
      doc.close();
    } catch (e) {}
  }
}

/****************************************************
 * ACCOUNT ADMIN
 ****************************************************/

async function loadAccounts(silent) {
  if (!CURRENT_USER || CURRENT_USER.role !== 'admin') return;

  const box = document.getElementById('accountList');
  if (!box) return;
  if (!silent) box.innerHTML = '<i>Đang tải danh sách tài khoản...</i>';

  try {
    const list = await api('listAccounts', { token: TOKEN });
    ACCOUNT_CACHE = list || [];
    renderAccounts(ACCOUNT_CACHE);
  } catch (err) {
    box.innerHTML = '<span class="msg">Lỗi tải tài khoản: ' + escapeHtml(err.message) + '</span>';
  }
}

function renderAccounts(list) {
  const box = document.getElementById('accountList');
  if (!box) return;

  if (!list.length) {
    box.innerHTML = '<i>Chưa có tài khoản.</i>';
    return;
  }

  box.innerHTML = list.map(acc => {
    const status = String(acc.status || '').toLowerCase();
    return `
      <div class="account-row ${escapeHtml(status)}">
        <div><b>${escapeHtml(acc.username)}</b><br><small>${escapeHtml(acc.createdAt || '')}</small></div>
        <div>${escapeHtml(acc.fullName)}</div>
        <div>${escapeHtml(acc.role)}</div>
        <div>${renderStatusBadge(status)}</div>
        <div>
          <button type="button" class="small-btn" onclick="editAccountUI(${Number(acc.rowNumber)})">Sửa</button>
          ${status === 'pending' ? `<button type="button" class="small-btn" onclick="setAccountStatusUI(${Number(acc.rowNumber)}, 'active')">Duyệt</button>` : ''}
          ${status === 'active'
            ? `<button type="button" class="small-btn danger" onclick="setAccountStatusUI(${Number(acc.rowNumber)}, 'locked')">Khóa</button>`
            : `<button type="button" class="small-btn" onclick="setAccountStatusUI(${Number(acc.rowNumber)}, 'active')">Mở</button>`}
        </div>
      </div>`;
  }).join('');
}

function renderStatusBadge(status) {
  if (status === 'active') return '<span class="badge badge-active">active</span>';
  if (status === 'pending') return '<span class="badge badge-pending">pending</span>';
  if (status === 'locked') return '<span class="badge badge-locked">locked</span>';
  return '<span class="badge">' + escapeHtml(status) + '</span>';
}

function editAccountUI(rowNumber) {
  const acc = ACCOUNT_CACHE.find(x => Number(x.rowNumber) === Number(rowNumber));
  if (!acc) return;

  setValue('accRow', acc.rowNumber);
  setValue('accUsername', acc.username);
  setValue('accPassword', '');
  setValue('accFullName', acc.fullName);
  setValue('accRole', acc.role || 'ktv');
  setValue('accStatus', acc.status || 'active');
  setValue('accNote', acc.note || '');
}

function clearAccountForm() {
  setValue('accRow', '');
  setValue('accUsername', '');
  setValue('accPassword', '');
  setValue('accFullName', '');
  setValue('accRole', 'ktv');
  setValue('accStatus', 'active');
  setValue('accNote', '');
}

async function saveAccountUI() {
  if (!CURRENT_USER || CURRENT_USER.role !== 'admin') return alert('Bạn không có quyền admin.');

  const account = {
    rowNumber: getValue('accRow'),
    username: getValue('accUsername').trim(),
    password: getValue('accPassword').trim(),
    fullName: getValue('accFullName').trim(),
    role: getValue('accRole'),
    status: getValue('accStatus'),
    note: getValue('accNote').trim()
  };

  if (!account.username) return alert('Thiếu tên đăng nhập.');
  if (!account.fullName) return alert('Thiếu họ và tên.');

  setBusy(true, 'Đang lưu tài khoản...');
  try {
    await api('saveAccount', { token: TOKEN, account });
    clearAccountForm();
    await loadAccounts(false);
    alert('Đã lưu tài khoản.');
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

async function setAccountStatusUI(rowNumber, status) {
  setBusy(true, 'Đang cập nhật trạng thái tài khoản...');
  try {
    await api('setAccountStatus', { token: TOKEN, rowNumber, status });
    await loadAccounts(false);
  } catch (err) {
    alert(err.message);
  } finally {
    setBusy(false);
  }
}

/****************************************************
 * BUSY
 ****************************************************/

function setBusy(isBusy, message) {
  IS_BUSY = isBusy;

  document.querySelectorAll('button').forEach(btn => {
    if (btn.classList.contains('nav')) return;
    btn.disabled = isBusy;
  });

  const saveBtn = document.getElementById('saveBtn');
  if (!saveBtn) return;

  if (isBusy) {
    saveBtn.dataset.oldText = saveBtn.textContent;
    saveBtn.textContent = message || 'Đang xử lý...';
  } else if (saveBtn.dataset.oldText) {
    saveBtn.textContent = saveBtn.dataset.oldText;
    delete saveBtn.dataset.oldText;
  }
}

/****************************************************
 * UTILS DOM
 ****************************************************/

function getValue(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '') : '';
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function getText(id) {
  const el = document.getElementById(id);
  return el ? String(el.textContent || '') : '';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '';
}

function getRadioValue(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : '';
}

function setRadioValue(name, value) {
  document.querySelectorAll('input[name="' + name + '"]').forEach(x => {
    x.checked = x.value === value;
  });
}

function getObjValue(obj, keys) {
  if (!obj) return '';

  const normKeys = keys.map(normText);
  for (const k in obj) {
    if (normKeys.includes(normText(k))) return obj[k];
  }

  return '';
}

function normText(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}

function escapeJs(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function cssId(s) {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function uniqueArray(arr) {
  return [...new Set(arr.map(x => String(x || '').trim()).filter(Boolean))];
}

function groupBy(arr, fn) {
  return arr.reduce((acc, item) => {
    const key = fn(item) || 'Khác';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function normalizeQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 1;
  return n;
}

function toDatetimeLocalValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function parseDateTimeToInput(value) {
  if (!value) return '';

  const s = String(value).trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;

  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;

  const d = new Date(s);
  if (!isNaN(d.getTime())) return toDatetimeLocalValue(d);

  return '';
}

function formatDateTimeForPayload(value) {
  if (!value) return '';

  const s = String(value).trim();

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;

  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`;

  return s.replace('T', ' ');
}
