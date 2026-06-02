/****************************************************
 * eGreen - Phiếu vật tư
 * Frontend GitHub Pages
 * Optimized version
 ****************************************************/

const API_URL = 'https://script.google.com/macros/s/AKfycbxUf_-LHZrqzrqzVZMAcU91tZshPabRrqf6BHZI7zaBcxIiMGmn41tlkbE0ft3d0Mkq/exec';

const STORAGE_KEY = 'EGREEN_PHIEU_VAT_TU_SESSION_V1';
const AUTO_REFRESH_MS = 30000;

let TOKEN = '';
let CURRENT_USER = null;
let ACCOUNT_CACHE = [];
let AUTO_REFRESH_TIMER = null;
let SELECTED_MEMBERS = [];
let EDITING_MA_PHIEU = '';
let IS_BUSY = false;
let LAST_ACTIVE_TAB = 'formTab';
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
 * API JSONP
 ****************************************************/

function api(action, data = {}) {
  const payloadText = JSON.stringify({ action, data });

  if (payloadText.length <= 1500) {
    return jsonpCall_(action, data);
  }

  return apiChunked_(payloadText);
}

function jsonpCall_(action, data = {}) {
  return new Promise((resolve, reject) => {
    const callbackName =
      '__egreen_cb_' +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2);

    const payload = encodeURIComponent(JSON.stringify({
      action,
      data
    }));

    const script = document.createElement('script');

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('API phản hồi quá lâu. Kiểm tra link Apps Script hoặc quyền triển khai.'));
    }, 45000);

    function cleanup() {
      clearTimeout(timeout);

      try {
        delete window[callbackName];
      } catch (e) {
        window[callbackName] = undefined;
      }

      if (script && script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = function (res) {
      cleanup();

      if (!res) {
        reject(new Error('API không trả dữ liệu.'));
        return;
      }

      if (!res.success) {
        reject(new Error(res.message || 'API lỗi.'));
        return;
      }

      resolve(res.data);
    };

    script.onerror = function () {
      cleanup();
      reject(new Error('Không gọi được Apps Script API. Kiểm tra API_URL hoặc quyền Web App.'));
    };

    script.src =
      API_URL +
      '?callback=' +
      encodeURIComponent(callbackName) +
      '&payload=' +
      payload +
      '&_=' +
      Date.now();

    document.body.appendChild(script);
  });
}

async function apiChunked_(payloadText) {
  const key =
    'k_' +
    Date.now() +
    '_' +
    Math.random().toString(36).slice(2);

  const chunkSize = 1200;

  await jsonpCall_('__chunkStart', { key });

  for (let i = 0; i < payloadText.length; i += chunkSize) {
    const chunk = payloadText.slice(i, i + chunkSize);

    await jsonpCall_('__chunkAppend', {
      key,
      chunk
    });
  }

  return await jsonpCall_('__chunkFinish', { key });
}


/****************************************************
 * INIT
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
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closePreview();
    }
  });

  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');

  [loginUsername, loginPassword].forEach(el => {
    if (!el) return;

    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doLogin();
      }
    });
  });
}

function initLoginRememberCheckbox() {
  const remember = document.getElementById('rememberLogin');
  if (!remember) return;

  remember.checked = true;
}

async function bootApp() {
  IS_BOOTING = true;

  const loginPage = document.getElementById('loginPage');
  const appPage = document.getElementById('appPage');
  const msg = document.getElementById('loginMsg');

  if (loginPage) loginPage.classList.remove('hidden');
  if (appPage) appPage.classList.add('hidden');

  const saved = loadSavedSession();

  if (!saved || !saved.token) {
    IS_BOOTING = false;
    return;
  }

  TOKEN = saved.token;
  CURRENT_USER = saved.user || null;

  if (msg) msg.innerText = 'Đang khôi phục đăng nhập...';

  try {
    const data = await api('getAppData', { token: TOKEN });

    initApp(data);
    startAutoRefresh();

    if (msg) msg.innerText = '';
  } catch (err) {
    clearSavedSession();
    TOKEN = '';
    CURRENT_USER = null;

    if (loginPage) loginPage.classList.remove('hidden');
    if (appPage) appPage.classList.add('hidden');

    if (msg) msg.innerText = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  } finally {
    IS_BOOTING = false;
  }
}


/****************************************************
 * SESSION STORAGE
 ****************************************************/

function saveSession() {
  if (!TOKEN || !CURRENT_USER) return;

  const remember = document.getElementById('rememberLogin');
  const shouldRemember = remember ? remember.checked : true;

  if (!shouldRemember) {
    clearSavedSession();
    return;
  }

  const data = {
    token: TOKEN,
    user: CURRENT_USER,
    savedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {}
}

function loadSavedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function clearSavedSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}


/****************************************************
 * BUSY / AUTO REFRESH
 ****************************************************/

function pauseAutoRefresh() {
  if (AUTO_REFRESH_TIMER) {
    clearInterval(AUTO_REFRESH_TIMER);
    AUTO_REFRESH_TIMER = null;
  }
}

function resumeAutoRefresh() {
  if (!TOKEN) return;
  if (AUTO_REFRESH_TIMER) return;

  startAutoRefresh();
}

function setBusy(isBusy, message) {
  IS_BUSY = isBusy;

  const buttons = document.querySelectorAll('button');

  buttons.forEach(btn => {
    if (btn.classList.contains('nav')) return;

    btn.disabled = isBusy;
    btn.style.opacity = isBusy ? '0.65' : '';
    btn.style.cursor = isBusy ? 'not-allowed' : '';
  });

  const saveBtn = document.getElementById('saveBtn');

  if (saveBtn) {
    if (isBusy) {
      if (!saveBtn.dataset.oldText) saveBtn.dataset.oldText = saveBtn.innerText;
      saveBtn.innerText = message || 'Đang xử lý...';
    } else if (saveBtn.dataset.oldText) {
      saveBtn.innerText = saveBtn.dataset.oldText;
      delete saveBtn.dataset.oldText;
    }
  }

  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (!isBusy && cancelEditBtn) {
    cancelEditBtn.disabled = false;
  }
}

async function runBusy(message, taskFn) {
  if (IS_BUSY) return;

  pauseAutoRefresh();
  setBusy(true, message);

  try {
    return await taskFn();
  } finally {
    setBusy(false);
    resumeAutoRefresh();
  }
}

function startAutoRefresh() {
  if (AUTO_REFRESH_TIMER) {
    clearInterval(AUTO_REFRESH_TIMER);
  }

  AUTO_REFRESH_TIMER = setInterval(() => {
    if (!TOKEN) return;
    if (IS_BUSY) return;
    if (IS_BOOTING) return;
    if (document.hidden) return;

    if (LAST_ACTIVE_TAB === 'formTab') {
      loadApp(true);
      return;
    }

    if (LAST_ACTIVE_TAB === 'historyTab') {
      loadPhieuList(true);
      return;
    }

    if (LAST_ACTIVE_TAB === 'adminTab') {
      if (CURRENT_USER && CURRENT_USER.role === 'admin') {
        loadAccounts(true);
      }
    }
  }, AUTO_REFRESH_MS);
}


/****************************************************
 * LOGIN / LOGOUT
 ****************************************************/

async function doLogin() {
  const username = getValue('loginUsername').trim();
  const password = getValue('loginPassword').trim();
  const msg = document.getElementById('loginMsg');
  const loginBtn = document.getElementById('loginBtn');

  if (!username || !password) {
    if (msg) msg.innerText = 'Vui lòng nhập đủ tên đăng nhập và mật khẩu.';
    return;
  }

  if (msg) msg.innerText = 'Đang đăng nhập...';
  if (loginBtn) loginBtn.disabled = true;

  try {
    const res = await api('login', {
      username,
      password
    });

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
  pauseAutoRefresh();

  if (TOKEN) {
    try {
      await api('logout', { token: TOKEN });
    } catch (e) {}
  }

  clearSavedSession();

  TOKEN = '';
  CURRENT_USER = null;
  ACCOUNT_CACHE = [];
  SELECTED_MEMBERS = [];
  EDITING_MA_PHIEU = '';
  LAST_ACTIVE_TAB = 'formTab';

  APP = {
    may: [],
    hienTuong: [],
    vatTu: [],
    ktv: [],
    vatTuCoDinh: [],
    selected: []
  };

  const appPage = document.getElementById('appPage');
  const loginPage = document.getElementById('loginPage');

  if (appPage) appPage.classList.add('hidden');
  if (loginPage) loginPage.classList.remove('hidden');

  setInputValue('loginUsername', '');
  setInputValue('loginPassword', '');

  const msg = document.getElementById('loginMsg');
  if (msg) msg.innerText = '';

  const firstNav = document.querySelector('.nav');
  showTabById('formTab');
}


/****************************************************
 * LOAD APP DATA
 ****************************************************/

async function loadApp(isAutoRefresh) {
  if (!TOKEN) return;

  try {
    const data = await api('getAppData', { token: TOKEN });

    if (isAutoRefresh) {
      refreshAppDataOnly(data);
    } else {
      initApp(data);
    }
  } catch (err) {
    if (!isAutoRefresh) {
      alert(err.message);
    }
  }
}

function initApp(data) {
  APP = { ...APP, ...data };
  CURRENT_USER = data.currentUser || CURRENT_USER;

  saveSession();

  const loginPage = document.getElementById('loginPage');
  const appPage = document.getElementById('appPage');

  if (loginPage) loginPage.classList.add('hidden');
  if (appPage) appPage.classList.remove('hidden');

  const userBox = document.getElementById('userBox');
  if (userBox && CURRENT_USER) {
    userBox.innerHTML = `
      <b>${escapeHtml(CURRENT_USER.fullName || CURRENT_USER.username)}</b><br>
      Vai trò: ${escapeHtml(CURRENT_USER.role)}
    `;
  }

  const adminNav = document.getElementById('adminNav');

  if (CURRENT_USER && CURRENT_USER.role === 'admin') {
    if (adminNav) adminNav.classList.remove('hidden');
    loadAccounts(false);
  } else {
    if (adminNav) adminNav.classList.add('hidden');
  }

  reloadSelectOptionsFromAppData();

  SELECTED_MEMBERS = [];
  renderMemberMultiSelect();

  setDefaultDateTime();
  onMayChange();

  renderVatTuCoDinh();
  loadPhieuList(false);
}

function refreshAppDataOnly(data) {
  const oldDoiTruong = getValue('doiTruong');
  const oldMembers = [...SELECTED_MEMBERS];
  const oldMaMay = getValue('maMay');
  const oldHienTuong = getValue('hienTuong');
  const oldNguoiXuatKho = getValue('nguoiXuatKho');
  const oldNguoiNhapKho = getValue('nguoiNhapKho');
  const oldSearch = getValue('searchVatTu');

  APP = { ...APP, ...data };
  CURRENT_USER = data.currentUser || CURRENT_USER;

  saveSession();

  reloadSelectOptionsFromAppData();

  setSelectValue('doiTruong', oldDoiTruong);
  SELECTED_MEMBERS = oldMembers.filter(name => name !== getValue('doiTruong'));
  renderMemberMultiSelect();

  setSelectValue('maMay', oldMaMay);
  setSelectValue('hienTuong', oldHienTuong);
  setSelectValue('nguoiXuatKho', oldNguoiXuatKho);
  setSelectValue('nguoiNhapKho', oldNguoiNhapKho);
  setInputValue('searchVatTu', oldSearch);

  onMayChange();
  renderVatTuSearch();
}

function reloadSelectOptionsFromAppData() {
  const names = getKtvNames();

  fillSelect('doiTruong', names, '-- Chọn đội trưởng --');
  fillSelect('nguoiXuatKho', names, '-- Chọn người xuất kho --');
  fillSelect('nguoiNhapKho', names, '-- Chọn người nhập kho --');
  fillSelect('maMay', getMayCodes(), '-- Chọn mã máy --');

  const hienTuongList = [
    ...new Set(
      APP.hienTuong
        .map(x => getValClient(x, ['Hiện Tượng/Sự cố', 'Hiện tượng/Sự cố', 'Hiện tượng']))
        .filter(Boolean)
        .map(x => String(x).trim())
    )
  ];

  fillSelect('hienTuong', hienTuongList, '-- Chọn hiện tượng --');
}


/****************************************************
 * TAB
 ****************************************************/

function showTab(id, btn) {
  LAST_ACTIVE_TAB = id;

  document.querySelectorAll('.tab').forEach(x => x.classList.add('hidden'));

  const tab = document.getElementById(id);
  if (tab) tab.classList.remove('hidden');

  document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (id === 'adminTab') {
    loadAccounts(false);
  }

  if (id === 'historyTab') {
    loadPhieuList(false);
  }
}

function showTabById(id) {
  const btn = Array.from(document.querySelectorAll('.nav')).find(b => {
    return b.getAttribute('onclick') && b.getAttribute('onclick').includes(id);
  });

  showTab(id, btn);
}


/****************************************************
 * SELECT / DATA HELPERS
 ****************************************************/

function normKeyClient(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ');
}

function getValClient(row, keys) {
  if (!row) return '';

  const normKeys = keys.map(normKeyClient);

  for (const k in row) {
    if (normKeys.includes(normKeyClient(k))) {
      return row[k];
    }
  }

  return '';
}

function getKtvNames() {
  const list = APP.ktv
    .map(row => {
      return getValClient(row, [
        'Họ Và Tên',
        'Họ và tên',
        'Họ tên',
        'Tên kỹ thuật',
        'Tên kỹ thuật viên',
        'Kỹ thuật viên',
        'Tên KTV',
        'Tên'
      ]);
    })
    .filter(Boolean)
    .map(x => String(x).trim())
    .filter(x => x && isNaN(Number(x)));

  return [...new Set(list)];
}

function getMayCodes() {
  return APP.may
    .map(x => getValClient(x, ['Mã Máy', 'Mã máy']))
    .filter(Boolean)
    .map(x => String(x).trim());
}

function fillSelect(id, arr, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;

  let html = '';

  if (placeholder) {
    html += `<option value="">${escapeHtml(placeholder)}</option>`;
  }

  html += arr
    .map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`)
    .join('');

  el.innerHTML = html;
}

function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  if (value && Array.from(el.options).some(o => o.value === value)) {
    el.value = value;
  } else {
    el.value = '';
  }
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerText = value || '';
}


/****************************************************
 * FORM
 ****************************************************/

function setDefaultDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());

  const el = document.getElementById('ngayGioXuatKho');
  if (el && !el.value) el.value = now.toISOString().slice(0, 16);
}

function onMayChange() {
  const maMay = getValue('maMay');

  const m = APP.may.find(x =>
    String(getValClient(x, ['Mã Máy', 'Mã máy'])).trim() === String(maMay).trim()
  ) || {};

  setText(
    'tenTrai',
    getValClient(m, ['Tên Trang Trại / Đơn Vị', 'Tên trại', 'Tên Trang Trại']) || ''
  );

  setText(
    'donVi',
    getValClient(m, ['Đơn vị hợp tác', 'Đơn vị']) || ''
  );

  setText(
    'khuVuc',
    getValClient(m, ['Khu Vực', 'Khu vực']) || ''
  );

  setText(
    'tinhTP',
    getValClient(m, ['Tỉnh Thành', 'Tỉnh / TP', 'Tỉnh/TP']) || ''
  );
}

function onMucDichChange() {
  const mucDich = getMucDich();

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

function getMucDich() {
  const checked = document.querySelector('input[name="mucDich"]:checked');
  return checked ? checked.value : 'Bảo dưỡng sửa chữa';
}

function buildCurrentPayload() {
  const mucDich = getMucDich();
  const maMay = getValue('maMay');

  const m = APP.may.find(x =>
    String(getValClient(x, ['Mã Máy', 'Mã máy'])).trim() === String(maMay).trim()
  ) || {};

  const cuThe = mucDich === 'Bảo dưỡng sửa chữa'
    ? getValue('hienTuong')
    : getValue('cuTheNhapTay').trim();

  return {
    maPhieu: EDITING_MA_PHIEU || '',
    doiTruong: getValue('doiTruong'),
    thanhVien: [...SELECTED_MEMBERS],
    maMay,
    tenTrai: getValClient(m, ['Tên Trang Trại / Đơn Vị', 'Tên trại', 'Tên Trang Trại']) || '',
    donVi: getValClient(m, ['Đơn vị hợp tác', 'Đơn vị']) || '',
    khuVuc: getValClient(m, ['Khu Vực', 'Khu vực']) || '',
    tinhTP: getValClient(m, ['Tỉnh Thành', 'Tỉnh / TP', 'Tỉnh/TP']) || '',
    ngayGioXuatKho: getValue('ngayGioXuatKho'),
    nguoiXuatKho: getValue('nguoiXuatKho'),
    ngayGioNhapKho: getValue('ngayGioNhapKho'),
    nguoiNhapKho: getValue('nguoiNhapKho'),
    mucDich,
    cuThe,
    ghiChu: '',
    items: APP.selected.map(x => ({
      nguonVatTu: x.nguonVatTu || '',
      cumLinhKien: x.cumLinhKien || '',
      tenVatTu: x.tenVatTu || '',
      maVatTu: x.maVatTu || '',
      donViTinh: x.donViTinh || '',
      soLuongCan: x.soLuongCan || '',
      soLuongXuatKho: x.soLuongXuatKho || '',
      tinhTrangXuatKho: x.tinhTrangXuatKho || '',
      soLuongSuDung: x.soLuongSuDung || '',
      soLuongNhapKho: x.soLuongNhapKho || '',
      tinhTrangNhapKho: x.tinhTrangNhapKho || '',
      ghiChu: x.ghiChu || ''
    }))
  };
}

function validatePayloadBeforeSave(payload) {
  if (!payload.doiTruong) return 'Chưa chọn đội trưởng.';
  if (!payload.thanhVien || !payload.thanhVien.length) return 'Chưa chọn thành viên.';
  if (!payload.maMay) return 'Chưa chọn mã máy.';
  if (!payload.ngayGioXuatKho) return 'Chưa chọn ngày giờ xuất kho.';
  if (!payload.nguoiXuatKho) return 'Chưa chọn thành viên xuất kho.';
  if (!payload.mucDich) return 'Chưa chọn mục đích sử dụng vật tư.';
  if (!payload.cuThe) return 'Chưa nhập/chọn nội dung cụ thể.';
  if (!payload.items || !payload.items.length) return 'Chưa có vật tư trong danh sách.';

  return '';
}

async function save() {
  return runBusy(EDITING_MA_PHIEU ? 'Đang cập nhật phiếu...' : 'Đang lưu phiếu...', async () => {
    const payload = buildCurrentPayload();
    const invalid = validatePayloadBeforeSave(payload);

    if (invalid) {
      alert(invalid);
      return;
    }

    try {
      let res;

      if (EDITING_MA_PHIEU) {
        res = await api('updatePhieu', {
          token: TOKEN,
          maPhieu: EDITING_MA_PHIEU,
          payload
        });

        alert('Đã cập nhật phiếu: ' + res.maPhieu);
      } else {
        res = await api('savePhieu', {
          token: TOKEN,
          payload
        });

        alert('Đã lưu phiếu: ' + res.maPhieu);
      }

      await loadPhieuList(false);
      showTabById('historyTab');
      resetFormAfterSave();

    } catch (err) {
      alert(err.message);
    }
  });
}

function resetFormAfterSave() {
  EDITING_MA_PHIEU = '';

  setText('formTitle', 'Phiếu chuẩn bị vật tư');

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.innerText = 'Lưu phiếu';

  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (cancelEditBtn) cancelEditBtn.classList.add('hidden');

  setSelectValue('doiTruong', '');

  SELECTED_MEMBERS = [];
  renderMemberMultiSelect();

  setSelectValue('maMay', '');
  onMayChange();

  setSelectValue('nguoiXuatKho', '');
  setSelectValue('nguoiNhapKho', '');

  setInputValue('ngayGioNhapKho', '');
  setInputValue('ngayGioXuatKho', '');
  setDefaultDateTime();

  const defaultMucDich = document.querySelector('input[name="mucDich"][value="Bảo dưỡng sửa chữa"]');
  if (defaultMucDich) defaultMucDich.checked = true;

  setSelectValue('hienTuong', '');
  setInputValue('cuTheNhapTay', '');
  setInputValue('searchVatTu', '');

  onMucDichChange();

  renderVatTuCoDinh();
}

function cancelEdit() {
  resetFormAfterSave();
}


/****************************************************
 * MEMBER MULTI SELECT
 ****************************************************/

function toggleMemberDropdown() {
  const dropdown = document.getElementById('thanhVienDropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
}

function getAvailableMembers() {
  const doiTruong = getValue('doiTruong');
  return getKtvNames().filter(name => name !== doiTruong);
}

function renderMemberMultiSelect() {
  const dropdown = document.getElementById('thanhVienDropdown');
  if (!dropdown) return;

  const available = getAvailableMembers();

  SELECTED_MEMBERS = SELECTED_MEMBERS.filter(name => available.includes(name));

  dropdown.innerHTML = available.map(name => {
    const checked = SELECTED_MEMBERS.includes(name) ? 'checked' : '';

    return `
      <label class="multi-option">
        <input type="checkbox" value="${escapeHtml(name)}" ${checked} onchange="onMemberCheckboxChange(this)">
        <span>${escapeHtml(name)}</span>
      </label>
    `;
  }).join('');

  updateMemberText();
}

function onMemberCheckboxChange(cb) {
  const name = cb.value;

  if (cb.checked) {
    if (!SELECTED_MEMBERS.includes(name)) {
      SELECTED_MEMBERS.push(name);
    }
  } else {
    SELECTED_MEMBERS = SELECTED_MEMBERS.filter(x => x !== name);
  }

  updateMemberText();
}

function updateMemberText() {
  const text = document.getElementById('thanhVienText');
  if (!text) return;

  if (!SELECTED_MEMBERS.length) {
    text.innerText = 'Chọn thành viên';
  } else if (SELECTED_MEMBERS.length <= 2) {
    text.innerText = SELECTED_MEMBERS.join(', ');
  } else {
    text.innerText = SELECTED_MEMBERS.length + ' thành viên đã chọn';
  }
}

function onDoiTruongChange() {
  const doiTruong = getValue('doiTruong');

  SELECTED_MEMBERS = SELECTED_MEMBERS.filter(name => name !== doiTruong);

  renderMemberMultiSelect();
}


/****************************************************
 * VAT TU
 ****************************************************/

function renderVatTuCoDinh() {
  APP.selected = [];

  APP.vatTuCoDinh.forEach((v, i) => {
    const ten = getValClient(v, [
      'Tên Chi Tiết / Linh Kiện Thay Thế',
      'Hạng mục vật tư',
      'Tên vật tư'
    ]);

    const cum = getValClient(v, ['Cụm Linh Kiện', 'Cụm linh kiện']);
    const maVT = getValClient(v, ['Mã Vật Tư', 'Mã vật tư']);
    const dvt = getValClient(v, ['Đơn vị tính', 'ĐVT']);

    if (!ten) return;

    APP.selected.push({
      id: 'fixed_' + i + '_' + safeId(ten),
      nguonVatTu: 'Cố định',
      cumLinhKien: cum,
      tenVatTu: ten,
      maVatTu: maVT,
      donViTinh: dvt,
      soLuongCan: 1,
      tinhTrangXuatKho: 'Mới',
      ghiChu: ''
    });
  });

  renderSelected();
  renderVatTuSearch();
}

function getRelatedCumByHienTuong() {
  const mucDich = getMucDich();

  if (mucDich !== 'Bảo dưỡng sửa chữa') return [];

  const ht = getValue('hienTuong');
  if (!ht) return [];

  return APP.hienTuong
    .filter(x => getValClient(x, ['Hiện Tượng/Sự cố', 'Hiện tượng/Sự cố', 'Hiện tượng']) === ht)
    .map(x => getValClient(x, ['Cụm Linh Kiện Liên Quan', 'Cụm Linh Kiện', 'Cụm linh kiện']))
    .filter(Boolean);
}

function renderVatTuSearch() {
  const box = document.getElementById('vatTuSearchList');
  const searchEl = document.getElementById('searchVatTu');

  if (!box) return;

  const keyword = removeTone((searchEl && searchEl.value) || '').toLowerCase().trim();
  const mucDich = getMucDich();
  const cumLienQuan = getRelatedCumByHienTuong();

  const selectedNames = new Set(APP.selected.map(x => normalizeName(x.tenVatTu)));

  const list = APP.vatTu.filter(v => {
    const ten = getValClient(v, [
      'Tên Chi Tiết / Linh Kiện Thay Thế',
      'Hạng mục vật tư',
      'Tên vật tư'
    ]);

    const cum = getValClient(v, ['Cụm Linh Kiện', 'Cụm linh kiện']);

    if (!ten) return false;
    if (selectedNames.has(normalizeName(ten))) return false;

    if (mucDich === 'Bảo dưỡng sửa chữa') {
      const ht = getValue('hienTuong');

      if (ht && cumLienQuan.length && !cumLienQuan.includes(cum)) return false;
    }

    if (keyword) {
      const text = removeTone(ten + ' ' + cum).toLowerCase();
      if (!text.includes(keyword)) return false;
    }

    return true;
  });

  box.classList.remove('hidden');

  if (!list.length) {
    box.innerHTML = `
      <div class="suggest-row suggest-empty">
        <div></div>
        <div>Không có vật tư phù hợp.</div>
      </div>
    `;
    return;
  }

  const groups = {};

  list.forEach(v => {
    const cum = getValClient(v, ['Cụm Linh Kiện', 'Cụm linh kiện']) || 'Khác';

    if (!groups[cum]) groups[cum] = [];
    groups[cum].push(v);
  });

  box.innerHTML = Object.keys(groups).map(cum => {
    const rows = groups[cum].map((v, i) => {
      const ten = getValClient(v, [
        'Tên Chi Tiết / Linh Kiện Thay Thế',
        'Hạng mục vật tư',
        'Tên vật tư'
      ]);

      const maVT = getValClient(v, ['Mã Vật Tư', 'Mã vật tư']);
      const dvt = getValClient(v, ['Đơn vị tính', 'ĐVT']);

      return `
        <div class="suggest-row">
          <input type="checkbox" onchange="addVatTuFromSearch(this)"
            data-ten="${escapeHtml(ten)}"
            data-cum="${escapeHtml(cum)}"
            data-mavt="${escapeHtml(maVT)}"
            data-dvt="${escapeHtml(dvt)}">

          <div>
            <b>${escapeHtml(ten)}</b><br>
            <small>${escapeHtml(cum)}</small>
          </div>

          <input type="number" min="0" value="1">

          <select>
            <option value="Mới">Mới</option>
            <option value="Cũ">Cũ</option>
            <option value="Tốt">Tốt</option>
            <option value="K.xđ">K.xđ</option>
          </select>
        </div>
      `;
    }).join('');

    return `
      <div class="suggest-group">
        <div class="suggest-group-title">${escapeHtml(cum)}</div>
        ${rows}
      </div>
    `;
  }).join('');
}

function addVatTuFromSearch(cb) {
  if (!cb.checked) return;

  const row = cb.closest('.suggest-row');
  const slInput = row ? row.querySelector('input[type="number"]') : null;
  const ttSelect = row ? row.querySelector('select') : null;

  APP.selected.push({
    id: 'add_' + Date.now() + '_' + safeId(cb.dataset.ten),
    nguonVatTu: 'Chọn thêm',
    cumLinhKien: cb.dataset.cum || '',
    tenVatTu: cb.dataset.ten || '',
    maVatTu: cb.dataset.mavt || '',
    donViTinh: cb.dataset.dvt || '',
    soLuongCan: slInput ? slInput.value || 1 : 1,
    tinhTrangXuatKho: ttSelect ? ttSelect.value || 'Mới' : 'Mới',
    ghiChu: ''
  });

  renderSelected();
  renderVatTuSearch();
}

function renderSelected() {
  const box = document.getElementById('selectedItems');
  if (!box) return;

  if (!APP.selected.length) {
    box.innerHTML = '<i>Chưa chọn vật tư.</i>';
    return;
  }

  box.innerHTML = APP.selected.map((x, i) => `
    <div class="item-row">
      <input type="checkbox" checked onchange="removeSelectedVatTu(${i})">
      <div>
        <b>${escapeHtml(x.tenVatTu)}</b><br>
        <small>${escapeHtml(x.cumLinhKien)} - ${escapeHtml(x.nguonVatTu)}</small>
      </div>
      <input type="number" min="0" value="${escapeHtml(x.soLuongCan)}" onchange="updateSelectedQty(${i}, this.value)">
      <select onchange="updateSelectedStatus(${i}, this.value)">
        <option value="Mới" ${x.tinhTrangXuatKho === 'Mới' ? 'selected' : ''}>Mới</option>
        <option value="Cũ" ${x.tinhTrangXuatKho === 'Cũ' ? 'selected' : ''}>Cũ</option>
        <option value="Tốt" ${x.tinhTrangXuatKho === 'Tốt' ? 'selected' : ''}>Tốt</option>
        <option value="K.xđ" ${x.tinhTrangXuatKho === 'K.xđ' ? 'selected' : ''}>K.xđ</option>
      </select>
    </div>
  `).join('');
}

function removeSelectedVatTu(index) {
  APP.selected.splice(index, 1);
  renderSelected();
  renderVatTuSearch();
}

function updateSelectedQty(index, value) {
  if (APP.selected[index]) {
    APP.selected[index].soLuongCan = value;
  }
}

function updateSelectedStatus(index, value) {
  if (APP.selected[index]) {
    APP.selected[index].tinhTrangXuatKho = value;
  }
}


/****************************************************
 * PHIEU LIST / PREVIEW / EXPORT / EDIT / DELETE
 ****************************************************/

async function loadPhieuList(isAutoRefresh) {
  if (!TOKEN) return;

  const box = document.getElementById('phieuList');
  if (!box) return;

  if (!isAutoRefresh) {
    box.innerHTML = '<i>Đang tải danh sách phiếu...</i>';
  }

  try {
    const list = await api('listPhieu', { token: TOKEN });
    renderPhieuList(list);
  } catch (err) {
    if (!isAutoRefresh) {
      box.innerHTML = '<span style="color:red;">Lỗi tải danh sách phiếu: ' + escapeHtml(err.message) + '</span>';
    }
  }
}

function renderPhieuList(list) {
  const box = document.getElementById('phieuList');
  if (!box) return;

  if (!list || !list.length) {
    box.innerHTML = '<i>Chưa có phiếu nào.</i>';
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Mã phiếu</th>
            <th>Ngày tạo</th>
            <th>Mã máy</th>
            <th>Tên trại</th>
            <th>Đội trưởng</th>
            <th>Thành viên</th>
            <th>Mục đích</th>
            <th>Cụ thể</th>
            <th>Trạng thái</th>
            <th>Thao tác</th>
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
                <button class="small-btn" onclick="previewSavedPhieu('${escapeHtml(p.maPhieu)}')">Xem trước</button>
                <button class="small-btn" onclick="exportPdf('${escapeHtml(p.maPhieu)}')">PDF</button>
                <button class="small-btn" onclick="exportWord('${escapeHtml(p.maPhieu)}')">Word</button>
                <button class="small-btn secondary" onclick="editPhieu('${escapeHtml(p.maPhieu)}')">Sửa</button>
                <button class="small-btn danger" onclick="deletePhieuUI('${escapeHtml(p.maPhieu)}')">Xóa</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function previewCurrentForm() {
  return runBusy('Đang xem trước...', async () => {
    try {
      const payload = buildCurrentPayload();
      const html = renderPreviewHtmlClient(payload);

      openPreview(html);
    } catch (err) {
      alert(err.message);
    }
  });
}

async function previewSavedPhieu(maPhieu) {
  return runBusy('Đang xem trước...', async () => {
    try {
      const html = await api('previewPhieu', {
        token: TOKEN,
        maPhieu
      });

      openPreview(html);
    } catch (err) {
      alert(err.message);
    }
  });
}

function openPreview(html) {
  const modal = document.getElementById('previewModal');
  const frame = document.getElementById('previewFrame');

  if (!modal || !frame) return;

  modal.classList.remove('hidden');
  frame.srcdoc = html;
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  const frame = document.getElementById('previewFrame');

  if (modal) modal.classList.add('hidden');
  if (frame) frame.srcdoc = '';
}

async function exportPdf(maPhieu) {
  return runBusy('Đang tạo PDF...', async () => {
    try {
      const url = await api('exportPhieuPdf', {
        token: TOKEN,
        maPhieu
      });

      openDriveUrl(url);
      await loadPhieuList(true);
    } catch (err) {
      alert(err.message);
    }
  });
}

async function exportWord(maPhieu) {
  return runBusy('Đang tạo Word...', async () => {
    try {
      const url = await api('exportPhieuWord', {
        token: TOKEN,
        maPhieu
      });

      openDriveUrl(url);
      await loadPhieuList(true);
    } catch (err) {
      alert(err.message);
    }
  });
}

function openDriveUrl(url) {
  if (!url) {
    alert('Không nhận được link file.');
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

async function editPhieu(maPhieu) {
  return runBusy('Đang tải phiếu...', async () => {
    try {
      const data = await api('getPhieuDetail', {
        token: TOKEN,
        maPhieu
      });

      loadPhieuToForm(data);
      showTabById('formTab');
    } catch (err) {
      alert(err.message);
    }
  });
}

async function deletePhieuUI(maPhieu) {
  const ok = confirm(
    'Bạn chắc chắn muốn xóa phiếu ' + maPhieu + '?\n\n' +
    'Thao tác này sẽ xóa dữ liệu ở sheet 10, sheet 11 và chuyển file PDF/Word đã tạo vào thùng rác nếu có.'
  );

  if (!ok) return;

  return runBusy('Đang xóa phiếu...', async () => {
    try {
      const res = await api('deletePhieu', {
        token: TOKEN,
        maPhieu
      });

      alert('Đã xóa phiếu: ' + (res.maPhieu || maPhieu));
      await loadPhieuList(false);
    } catch (err) {
      alert(err.message);
    }
  });
}

function loadPhieuToForm(data) {
  const p = data.phieu;
  const items = data.items || [];

  EDITING_MA_PHIEU = p.maPhieu || '';

  setText('formTitle', 'Chỉnh sửa phiếu: ' + EDITING_MA_PHIEU);

  const saveBtn = document.getElementById('saveBtn');
  if (saveBtn) saveBtn.innerText = 'Cập nhật phiếu';

  const cancelEditBtn = document.getElementById('cancelEditBtn');
  if (cancelEditBtn) cancelEditBtn.classList.remove('hidden');

  setSelectValue('doiTruong', p.doiTruong || '');

  SELECTED_MEMBERS = String(p.thanhVien || '')
    .split(';')
    .map(x => x.trim())
    .filter(Boolean);

  renderMemberMultiSelect();

  setSelectValue('maMay', p.maMay || '');
  onMayChange();

  setSelectValue('nguoiXuatKho', p.nguoiXuatKho || '');
  setSelectValue('nguoiNhapKho', p.nguoiNhapKho || '');

  setInputValue('ngayGioXuatKho', toDatetimeLocalValue(p.ngayGioXuatKho));
  setInputValue('ngayGioNhapKho', toDatetimeLocalValue(p.ngayGioNhapKho));

  const mucDich = p.mucDich || 'Bảo dưỡng sửa chữa';
  const radio = document.querySelector(`input[name="mucDich"][value="${mucDich}"]`);

  if (radio) radio.checked = true;

  onMucDichChange();

  if (mucDich === 'Bảo dưỡng sửa chữa') {
    setSelectValue('hienTuong', p.cuThe || '');
  } else {
    setInputValue('cuTheNhapTay', p.cuThe || '');
  }

  APP.selected = items.map((x, i) => ({
    id: 'edit_' + i + '_' + safeId(x.tenVatTu),
    nguonVatTu: x.nguonVatTu || '',
    cumLinhKien: x.cumLinhKien || '',
    tenVatTu: x.tenVatTu || '',
    maVatTu: x.maVatTu || '',
    donViTinh: x.donViTinh || '',
    soLuongCan: x.soLuongCan || 1,
    tinhTrangXuatKho: x.tinhTrangXuatKho || 'Mới',
    ghiChu: x.ghiChu || ''
  }));

  renderSelected();
  renderVatTuSearch();
}

function toDatetimeLocalValue(v) {
  if (!v) return '';

  const s = String(v).trim();

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return s.slice(0, 16);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    return s.replace(' ', 'T').slice(0, 16);
  }

  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);

  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
  }

  return '';
}


/****************************************************
 * ACCOUNT ADMIN
 ****************************************************/

async function loadAccounts(isAutoRefresh) {
  if (!CURRENT_USER || CURRENT_USER.role !== 'admin') return;

  const box = document.getElementById('accountList');

  if (!isAutoRefresh && box) {
    box.innerHTML = '<i>Đang tải danh sách tài khoản...</i>';
  }

  try {
    const list = await api('listAccounts', { token: TOKEN });
    renderAccounts(list);
  } catch (err) {
    if (box) {
      box.innerHTML = '<span style="color:red;">Lỗi tải tài khoản: ' + escapeHtml(err.message) + '</span>';
    }
  }
}

function renderAccounts(list) {
  ACCOUNT_CACHE = list || [];

  const box = document.getElementById('accountList');
  if (!box) return;

  if (!ACCOUNT_CACHE.length) {
    box.innerHTML = '<i>Chưa có tài khoản.</i>';
    return;
  }

  box.innerHTML = ACCOUNT_CACHE.map((acc, i) => {
    const status = String(acc.status || '').toLowerCase();
    let actionBtn = '';

    if (status === 'pending') {
      actionBtn = `
        <button class="small-btn" onclick="toggleAccount(${acc.rowNumber}, 'active')">Duyệt</button>
        <button class="small-btn danger" onclick="toggleAccount(${acc.rowNumber}, 'locked')">Từ chối</button>
      `;
    } else if (status === 'active') {
      actionBtn = `
        <button class="small-btn secondary" onclick="toggleAccount(${acc.rowNumber}, 'locked')">Khóa</button>
      `;
    } else {
      actionBtn = `
        <button class="small-btn" onclick="toggleAccount(${acc.rowNumber}, 'active')">Mở</button>
      `;
    }

    return `
      <div class="account-row ${escapeHtml(status)}">
        <div><b>${escapeHtml(acc.username)}</b></div>
        <div>${escapeHtml(acc.fullName)}</div>
        <div>${escapeHtml(acc.role)}</div>
        <div>${renderStatusBadge(status)}</div>
        <div>
          <button class="small-btn" onclick="editAccountByIndex(${i})">Sửa</button>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join('');
}

function renderStatusBadge(status) {
  if (status === 'active') return '<span class="badge badge-active">active</span>';
  if (status === 'pending') return '<span class="badge badge-pending">pending</span>';
  if (status === 'locked') return '<span class="badge badge-locked">locked</span>';

  return '<span class="badge">' + escapeHtml(status) + '</span>';
}

function editAccountByIndex(index) {
  const acc = ACCOUNT_CACHE[index];
  if (!acc) return;

  setInputValue('accRow', acc.rowNumber || '');
  setInputValue('accUsername', acc.username || '');
  setInputValue('accPassword', '');
  setInputValue('accFullName', acc.fullName || '');
  setInputValue('accRole', acc.role || 'ktv');
  setInputValue('accStatus', acc.status || 'active');
  setInputValue('accNote', acc.note || '');
}

function clearAccountForm() {
  setInputValue('accRow', '');
  setInputValue('accUsername', '');
  setInputValue('accPassword', '');
  setInputValue('accFullName', '');
  setInputValue('accRole', 'ktv');
  setInputValue('accStatus', 'active');
  setInputValue('accNote', '');
}

async function saveAccountUI() {
  const account = {
    rowNumber: getValue('accRow'),
    username: getValue('accUsername').trim(),
    password: getValue('accPassword').trim(),
    fullName: getValue('accFullName').trim(),
    role: getValue('accRole'),
    status: getValue('accStatus'),
    note: getValue('accNote').trim()
  };

  return runBusy('Đang lưu tài khoản...', async () => {
    try {
      const res = await api('saveAccount', {
        token: TOKEN,
        account
      });

      alert(res.message || 'Đã lưu tài khoản.');
      clearAccountForm();
      await loadAccounts(false);
    } catch (err) {
      alert(err.message);
    }
  });
}

async function toggleAccount(rowNumber, status) {
  return runBusy('Đang cập nhật tài khoản...', async () => {
    try {
      await api('setAccountStatus', {
        token: TOKEN,
        rowNumber,
        status
      });

      await loadAccounts(false);
    } catch (err) {
      alert(err.message);
    }
  });
}


/****************************************************
 * PREVIEW HTML CLIENT
 ****************************************************/

function renderPreviewHtmlClient(payload) {
  const phieu = {
    maPhieu: payload.maPhieu || 'BẢN XEM TRƯỚC',
    doiTruong: payload.doiTruong || '',
    thanhVien: Array.isArray(payload.thanhVien)
      ? payload.thanhVien.join('; ')
      : payload.thanhVien || '',
    maMay: payload.maMay || '',
    tenTrai: payload.tenTrai || '',
    ngayGioXuatKho: payload.ngayGioXuatKho || '',
    ngayGioNhapKho: payload.ngayGioNhapKho || '',
    nguoiXuatKho: payload.nguoiXuatKho || '',
    nguoiNhapKho: payload.nguoiNhapKho || '',
    mucDich: payload.mucDich || '',
    cuThe: payload.cuThe || ''
  };

  const rows = (payload.items || []).map((x, i) => {
    const tt = String(x.tinhTrangXuatKho || '').trim();

    const checkedMoi = tt === 'Mới' ? '✓' : '';
    const checkedCu = tt === 'Cũ' ? '✓' : '';
    const checkedTot = tt === 'Tốt' ? '✓' : '';
    const checkedKxd =
      tt === 'K.xđ' ||
      tt === 'KXĐ' ||
      tt === 'Không xác định'
        ? '✓'
        : '';

    return `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(x.tenVatTu)}</td>
        <td class="center">${escapeHtml(x.soLuongCan || '')}</td>
        <td class="center"></td>

        <td class="center">${checkedMoi}</td>
        <td class="center">${checkedCu}</td>
        <td class="center">${checkedTot}</td>
        <td class="center">${checkedKxd}</td>

        <td class="center"></td>
        <td class="center"></td>

        <td class="center"></td>
        <td class="center"></td>
        <td class="center"></td>
        <td class="center"></td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @page {
    size: A4 landscape;
    margin: 10mm;
  }

  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 13px;
    color: #000;
    margin: 0;
    background: #fff;
  }

  .page {
    width: 297mm;
    min-height: 210mm;
    margin: 0 auto;
    padding: 8mm 10mm;
    box-sizing: border-box;
    background: #fff;
  }

  .title {
    text-align: center;
    font-size: 21px;
    font-weight: bold;
    text-transform: uppercase;
    margin-bottom: 18px;
  }

  .top-grid {
    display: grid;
    grid-template-columns: 1.05fr 1.05fr 1.05fr 1.05fr;
    gap: 26px;
    margin-bottom: 12px;
    font-size: 14px;
  }

  .top-block-title {
    font-weight: bold;
    margin-bottom: 6px;
  }

  .line {
    display: block;
    border-bottom: 1px dotted #000;
    min-height: 20px;
    margin-bottom: 7px;
    word-break: break-word;
  }

  .purpose-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    margin: 18px 35px 14px;
    font-size: 15px;
    font-weight: bold;
  }

  .purpose-row div {
    text-align: center;
  }

  .dot {
    font-size: 20px;
    vertical-align: middle;
    margin-right: 10px;
  }

  .section-title {
    font-weight: bold;
    font-size: 15px;
    margin: 10px 0 6px;
  }

  .detail-line {
    border-bottom: 1px dotted #000;
    min-height: 22px;
    margin-bottom: 4px;
    padding-left: 4px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    border: 1px solid #000;
    padding: 4px;
    vertical-align: middle;
  }

  th {
    text-align: center;
    font-weight: bold;
  }

  .center {
    text-align: center;
  }

  .vt-table {
    font-size: 12.5px;
    table-layout: fixed;
  }

  .vt-table th,
  .vt-table td {
    height: 23px;
  }

  .col-stt {
    width: 32px;
  }

  .col-name {
    width: 275px;
  }

  .col-small {
    width: 72px;
  }

  .col-status {
    width: 42px;
  }

  .sign {
    margin-top: 24px;
  }

  .sign td {
    border: none;
    text-align: center;
    height: 70px;
    font-weight: bold;
  }
</style>
</head>

<body>
<div class="page">
  <div class="title">DANH SÁCH VẬT TƯ</div>

  <div class="top-grid">
    <div>
      <div class="top-block-title">1. Đội nhóm nhận nhiệm vụ</div>
      <div>Đội trưởng:</div>
      <span class="line">${escapeHtml(phieu.doiTruong)}</span>
      <div>Thành viên:</div>
      <span class="line">${escapeHtml(phieu.thanhVien)}</span>
    </div>

    <div>
      <div class="top-block-title">2. Mã hệ thống đảm nhiệm</div>
      <div>Mã máy:</div>
      <span class="line">${escapeHtml(phieu.maMay)}</span>
      <div>Địa chỉ trại:</div>
      <span class="line">${escapeHtml(phieu.tenTrai)}</span>
    </div>

    <div>
      <div class="top-block-title">3. Thời gian thực hiện</div>
      <div>Ngày/giờ xuất kho:</div>
      <span class="line">${escapeHtml(phieu.ngayGioXuatKho)}</span>
      <div>Ngày/giờ nhập kho:</div>
      <span class="line">${escapeHtml(phieu.ngayGioNhapKho)}</span>
    </div>

    <div>
      <div class="top-block-title">4. Thành viên thực hiện</div>
      <div>Xuất kho:</div>
      <span class="line">${escapeHtml(phieu.nguoiXuatKho)}</span>
      <div>Nhập kho:</div>
      <span class="line">${escapeHtml(phieu.nguoiNhapKho)}</span>
    </div>
  </div>

  <div class="section-title">5. Mục đích sử dụng vật tư</div>

  <div class="purpose-row">
    <div>
      <span class="dot">${phieu.mucDich === 'Bảo dưỡng sửa chữa' ? '●' : '○'}</span>
      Bảo dưỡng sửa chữa
    </div>
    <div>
      <span class="dot">${phieu.mucDich === 'Lắp đặt' ? '●' : '○'}</span>
      Lắp đặt
    </div>
    <div>
      <span class="dot">${phieu.mucDich === 'Sản xuất' ? '●' : '○'}</span>
      Sản xuất
    </div>
  </div>

  <div><b>Cụ thể:</b></div>
  <div class="detail-line">${escapeHtml(phieu.cuThe)}</div>
  <div class="detail-line"></div>

  <div class="section-title">6. Danh sách vật tư cần chuẩn bị</div>

  <table class="vt-table">
    <thead>
      <tr>
        <th rowspan="2" class="col-stt">STT</th>
        <th rowspan="2" class="col-name">Hạng mục vật tư</th>
        <th rowspan="2" class="col-small">Số lượng<br>cần</th>
        <th rowspan="2" class="col-small">Số lượng<br>xuất kho</th>

        <th colspan="4">Tình trạng</th>

        <th rowspan="2" class="col-small">Số lượng<br>sử dụng</th>
        <th rowspan="2" class="col-small">Số lượng<br>nhập kho</th>

        <th colspan="4">Tình trạng</th>
      </tr>

      <tr>
        <th class="col-status">Mới</th>
        <th class="col-status">Cũ</th>
        <th class="col-status">Tốt</th>
        <th class="col-status">K.xđ</th>

        <th class="col-status">Mới</th>
        <th class="col-status">Cũ</th>
        <th class="col-status">Tốt</th>
        <th class="col-status">Hỏng</th>
      </tr>
    </thead>

    <tbody>
      ${rows || '<tr><td colspan="14" class="center">Chưa có vật tư</td></tr>'}
    </tbody>
  </table>

  <table class="sign">
    <tr>
      <td>Người lập phiếu</td>
      <td>Người xuất kho</td>
      <td>Đội trưởng</td>
      <td>Người nhập kho</td>
    </tr>
  </table>
</div>
</body>
</html>`;
}


/****************************************************
 * UTILS
 ****************************************************/

function normalizeName(s) {
  return removeTone(String(s || '').trim().toLowerCase());
}

function removeTone(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function safeId(str) {
  return removeTone(String(str || ''))
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 40);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[m]));
}
