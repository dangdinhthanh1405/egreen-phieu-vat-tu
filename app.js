/****************************************************
 * eGreen - Phiếu vật tư
 * Frontend app.js for GitHub Pages
 * Full optimized version
 ****************************************************/

const API_URL = 'https://script.google.com/macros/s/AKfycbwIUyB1C3KX6hncel-7OjFmfKSmqAPR7X7Tw4ud64zr_1SF_Ej1EIX72OurCw93h9Ln/exec';

const STORAGE_KEY = 'EGREEN_PHIEU_VAT_TU_SESSION_V2';
const AUTO_REFRESH_MS = 30000;
const JSONP_DIRECT_LIMIT = 1450;
const JSONP_CHUNK_SIZE = 1200;

let TOKEN = '';
let CURRENT_USER = null;
let APP = {
  may: [],
  hienTuong: [],
  vatTu: [],
  ktv: [],
  vatTuCoDinh: [],
  selected: []
};

let ACCOUNT_CACHE = [];
let SELECTED_MEMBERS = [];
let AUTO_REFRESH_TIMER = null;
let EDITING_MA_PHIEU = '';
let IS_BUSY = false;
let IS_BOOTING = false;


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
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closePreview();
      return;
    }

    const loginPage = document.getElementById('loginPage');
    const isLoginVisible = loginPage && !loginPage.classList.contains('hidden');

    if (isLoginVisible && e.key === 'Enter') {
      const target = e.target;

      if (
        target &&
        (
          target.id === 'loginUsername' ||
          target.id === 'loginPassword' ||
          target.closest('.login-card')
        )
      ) {
        e.preventDefault();
        doLogin();
      }
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

function loginKeydown(e) {
  if (!e) return;

  if (e.key === 'Enter') {
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

    if (msg) {
      msg.innerText = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    }
  } finally {
    IS_BOOTING = false;
  }
}


/****************************************************
 * API JSONP
 ****************************************************/

function api(action, data = {}) {
  const payload = {
    action,
    data
  };

  const text = JSON.stringify(payload);

  if (text.length <= JSONP_DIRECT_LIMIT) {
    return apiJsonpDirect_(payload);
  }

  return apiJsonpChunk_(payload);
}

function apiJsonpDirect_(payload) {
  return new Promise((resolve, reject) => {
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

    const url =
      API_URL +
      '?callback=' + encodeURIComponent(callbackName) +
      '&payload=' + encodeURIComponent(JSON.stringify(payload)) +
      '&_=' + Date.now();

    script.src = url;
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

  await apiJsonpDirect_({
    action: '__chunkStart',
    data: { key }
  });

  for (let i = 0; i < text.length; i += JSONP_CHUNK_SIZE) {
    await apiJsonpDirect_({
      action: '__chunkAppend',
      data: {
        key,
        chunk: text.slice(i, i + JSONP_CHUNK_SIZE)
      }
    });
  }

  return apiJsonpDirect_({
    action: '__chunkFinish',
    data: { key }
  });
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
    if (!raw) return null;

    return JSON.parse(raw);
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

  const data = {
    token: TOKEN,
    user: CURRENT_USER,
    savedAt: new Date().toISOString()
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
  try {
    if (TOKEN) {
      await api('logout', { token: TOKEN });
    }
  } catch (e) {}

  stopAutoRefresh();

  TOKEN = '';
  CURRENT_USER = null;
  ACCOUNT_CACHE = [];
  SELECTED_MEMBERS = [];
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
    loadAccounts();
  }
}

function renderUserBox() {
  const userBox = document.getElementById('userBox');
  if (!userBox || !CURRENT_USER) return;

  userBox.innerHTML = `
    <b>${escapeHtml(CURRENT_USER.fullName || CURRENT_USER.username)}</b><br>
    Vai trò: ${escapeHtml(CURRENT_USER.role || '')}
  `;
}

function setupRoleUI() {
  const adminNav = document.getElementById('adminNav');

  if (!adminNav || !CURRENT_USER) return;

  if (CURRENT_USER.role === 'admin') {
    adminNav.classList.remove('hidden');
  } else {
    adminNav.classList.add('hidden');
  }
}

function showFirstAvailableTab() {
  const active = document.querySelector('.nav.active');

  if (active) {
    const text = active.textContent || '';
    if (text.includes('Phiếu đã tạo')) {
      showTab('historyTab', active);
      return;
    }
  }

  const firstNav = document.querySelector('.nav');
  showTab('formTab', firstNav);
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

  const oldUser = CURRENT_USER;
  CURRENT_USER = data.currentUser || CURRENT_USER;

  if (!oldUser || JSON.stringify(oldUser) !== JSON.stringify(CURRENT_USER)) {
    renderUserBox();
    setupRoleUI();
    saveSession();
  }

  fillKtvSelects(true);
  fillMachineSelect(true);
  fillHienTuongSelect(true);
  renderVatTuSearch();
  renderSelectedItems();

  const historyTab = document.getElementById('historyTab');
  if (historyTab && !historyTab.classList.contains('hidden')) {
    await loadPhieuList(true);
  }

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

  if (tabId === 'historyTab') {
    loadPhieuList(true);
  }

  if (tabId === 'adminTab') {
    loadAccounts(true);
  }
}


/****************************************************
 * SELECT DATA
 ****************************************************/

function fillKtvSelects(keepValue) {
  const names = getKtvNames();

  fillSelect('doiTruong', names, '-- Chọn đội trưởng --', keepValue);
  fillSelect('nguoiXuatKho', names, '-- Chọn người xuất kho --', keepValue);
  fillSelect('nguoiNhapKho', names, '-- Chọn người nhập kho --', keepValue);

  renderMemberDropdown();
}

function getKtvNames() {
  const names = APP.ktv
    .map(x => getObjValue(x, ['Họ Và Tên', 'Họ và tên', 'Tên kỹ thuật', 'Tên', 'Ho Va Ten']))
    .filter(Boolean)
    .map(x => String(x).trim())
    .filter(Boolean);

  return uniqueArray(names);
}

function fillMachineSelect(keepValue) {
  const select = document.getElementById('maMay');
  if (!select) return;

  const oldValue = keepValue ? select.value : '';

  select.innerHTML = '<option value="">-- Chọn mã máy --</option>';

  APP.may.forEach(m => {
    const maMay = getMayCode(m);
    if (!maMay) return;

    const opt = document.createElement('option');
    opt.value = maMay;
    opt.textContent = maMay;
    select.appendChild(opt);
  });

  if (keepValue && oldValue) select.value = oldValue;
}

function fillHienTuongSelect(keepValue) {
  const select = document.getElementById('hienTuong');
  if (!select) return;

  const oldValue = keepValue ? select.value : '';

  select.innerHTML = '<option value="">-- Chọn hiện tượng --</option>';

  const list = APP.hienTuong
    .map(x => getObjValue(x, ['Hiện tượng/Sự cố', 'Hiện tượng', 'Hien tuong', 'Sự cố', 'Lỗi']))
    .filter(Boolean);

  uniqueArray(list).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  if (keepValue && oldValue) select.value = oldValue;
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

  if (keepValue && oldValue) {
    select.value = oldValue;
  }
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
  const names = getKtvNames().filter(x => x !== doiTruong);

  if (!names.length) {
    dropdown.innerHTML = '<div class="multi-option">Không có thành viên để chọn.</div>';
    renderMemberText();
    return;
  }

  dropdown.innerHTML = names.map(name => {
    const checked = SELECTED_MEMBERS.includes(name) ? 'checked' : '';

    return `
      <label class="multi-option">
        <input type="checkbox" ${checked} onchange="toggleMember('${escapeJs(name)}', this.checked)">
        <span>${escapeHtml(name)}</span>
      </label>
    `;
  }).join('');

  renderMemberText();
}

function toggleMember(name, checked) {
  if (checked) {
    if (!SELECTED_MEMBERS.includes(name)) SELECTED_MEMBERS.push(name);
  } else {
    SELECTED_MEMBERS = SELECTED_MEMBERS.filter(x => x !== name);
  }

  renderMemberText();
}

function renderMemberText() {
  const text = document.getElementById('thanhVienText');
  if (!text) return;

  if (!SELECTED_MEMBERS.length) {
    text.textContent = 'Chọn thành viên';
    return;
  }

  text.textContent = SELECTED_MEMBERS.join('; ');
}

function onMayChange() {
  const maMay = getValue('maMay');
  const may = APP.may.find(x => getMayCode(x) === maMay);

  setText('tenTrai', may ? getObjValue(may, ['Tên trại', 'Ten trai', 'Trại', 'Địa chỉ trại']) : '');
  setText('donVi', may ? getObjValue(may, ['Đơn vị', 'Don vi']) : '');
  setText('khuVuc', may ? getObjValue(may, ['Khu vực', 'Khu Vực', 'Khu vuc']) : '');
  setText('tinhTP', may ? getObjValue(may, ['Tỉnh/TP', 'Tinh/TP', 'Tỉnh TP', 'Tỉnh']) : '');
}

function getMayCode(obj) {
  return String(getObjValue(obj, ['Mã máy', 'Ma may', 'Mã Máy', 'Code', 'Mã']) || '').trim();
}

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
  const now = new Date();
  setValue('ngayGioXuatKho', toDatetimeLocalValue(now));
}


/****************************************************
 * MATERIALS
 ****************************************************/

function resetSelectedMaterials() {
  APP.selected = [];

  const fixed = getFixedMaterials();

  fixed.forEach(item => {
    addOrUpdateSelected({
      id: makeMaterialId(item),
      nguonVatTu: 'Cố định',
      cumLinhKien: getCumLinhKien(item),
      tenVatTu: getTenVatTu(item),
      maVatTu: getObjValue(item, ['Mã vật tư', 'Ma vat tu']) || '',
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

  // Nếu là lắp đặt / sản xuất thì cho hiện toàn bộ vật tư
  if (mucDich !== 'Bảo dưỡng sửa chữa') {
    return APP.vatTu.filter(x => getTenVatTu(x));
  }

  const hienTuong = getValue('hienTuong');

  // Nếu chưa chọn hiện tượng thì chưa hiện vật tư chọn thêm
  if (!hienTuong) {
    return [];
  }

  const relatedCums = getRelatedCumsByHienTuong(hienTuong);

  // Nếu hiện tượng chưa được gán cụm linh kiện ở sheet 3 thì không bung toàn bộ vật tư
  if (!relatedCums.length) {
    return [];
  }

  const relatedNorms = relatedCums.map(normText);

  return APP.vatTu.filter(item => {
    const tenVatTu = getTenVatTu(item);
    if (!tenVatTu) return false;

    const cumVatTu = getCumLinhKien(item);
    if (!cumVatTu) return false;

    return relatedNorms.includes(normText(cumVatTu));
  });
}

function getRelatedCumsByHienTuong(hienTuong) {
  const htNorm = normText(hienTuong);

  const cums = [];

  APP.hienTuong.forEach(row => {
    const tenHienTuong = getObjValue(row, [
      'Hiện Tượng/Sự cố',
      'Hiện tượng/Sự cố',
      'Hiện tượng/sự cố',
      'Hien Tuong/Su co',
      'Hien tuong/Su co'
    ]);

    if (normText(tenHienTuong) !== htNorm) return;

    const cumLienQuan = getObjValue(row, [
      'Cụm Linh Kiện Liên Quan',
      'Cụm linh kiện liên quan',
      'Cum Linh Kien Lien Quan',
      'Cum linh kien lien quan'
    ]);

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
  let list = getSelectableMaterials();

  const selectedIds = new Set(APP.selected.map(x => x.id));

  list = list.filter(item => {
    const id = makeMaterialId(item);
    if (selectedIds.has(id)) return false;

    if (!keyword) return true;

    const haystack = normText([
      getTenVatTu(item),
      getCumLinhKien(item),
      getObjValue(item, ['Mã vật tư', 'Ma vat tu']),
      getObjValue(item, ['Ghi chú', 'Ghi chu'])
    ].join(' '));

    return haystack.includes(keyword);
  });

  if (!list.length) {
  box.classList.remove('hidden');

  const mucDich = getRadioValue('mucDich');
  const hienTuong = getValue('hienTuong');

  if (mucDich === 'Bảo dưỡng sửa chữa' && !hienTuong) {
    box.innerHTML = '<div class="suggest-row suggest-empty">Vui lòng chọn hiện tượng trước để lọc vật tư liên quan.</div>';
  } else if (mucDich === 'Bảo dưỡng sửa chữa') {
    box.innerHTML = '<div class="suggest-row suggest-empty">Hiện tượng này chưa được gán cụm linh kiện/vật tư liên quan trong dữ liệu.</div>';
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
      const maVatTu = getObjValue(item, ['Mã vật tư', 'Ma vat tu']) || '';
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
        </div>
      `;
    }).join('');

    return `
      <div class="suggest-group">
        <div class="suggest-group-title">${escapeHtml(groupName)}</div>
        ${rows}
      </div>
    `;
  }).join('');
}

function selectMaterialFromSearch(id, checked) {
  if (!checked) return;

  const sourceItem = APP.vatTu.find(x => makeMaterialId(x) === id)
    || APP.vatTuCoDinh.find(x => makeMaterialId(x) === id);

  if (!sourceItem) return;

  const qtyEl = document.getElementById('qty_search_' + cssId(id));
  const statusEl = document.getElementById('status_search_' + cssId(id));

  addOrUpdateSelected({
    id,
    nguonVatTu: 'Chọn thêm',
    cumLinhKien: getCumLinhKien(sourceItem),
    tenVatTu: getTenVatTu(sourceItem),
    maVatTu: getObjValue(sourceItem, ['Mã vật tư', 'Ma vat tu']) || '',
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

  if (idx >= 0) {
    APP.selected[idx] = {
      ...APP.selected[idx],
      ...item
    };
  } else {
    APP.selected.push(item);
  }
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
  if (!item) return;

  item.soLuongCan = normalizeQty(value);
}

function updateSelectedStatus(id, value) {
  const item = APP.selected.find(x => x.id === id);
  if (!item) return;

  item.tinhTrangXuatKho = value;
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
        <div>
          <b>${escapeHtml(item.tenVatTu)}</b><br>
          <small>${escapeHtml(item.cumLinhKien || '')}${item.nguonVatTu ? ' - ' + escapeHtml(item.nguonVatTu) : ''}</small>
        </div>
        <input
          type="number"
          min="0"
          step="1"
          value="${escapeHtml(item.soLuongCan)}"
          onchange="updateSelectedQty('${escapeJs(id)}', this.value)"
        >
        <select onchange="updateSelectedStatus('${escapeJs(id)}', this.value)">
          ${statusOptions(item.tinhTrangXuatKho)}
        </select>
        <div>${removeBtn}</div>
      </div>
    `;
  }).join('');
}

function statusOptions(current) {
  const list = ['Mới', 'Cũ', 'Tốt', 'K.xđ'];
  return list.map(x => `<option value="${x}" ${x === current ? 'selected' : ''}>${x}</option>`).join('');
}

function getTenVatTu(item) {
  return String(getObjValue(item, [
    'Tên Chi Tiết / Linh Kiện Thay Thế',
    'Tên chi tiết / linh kiện thay thế',
    'Ten Chi Tiet / Linh Kien Thay The',
    'Ten chi tiet / linh kien thay the',
    'Tên vật tư',
    'Ten vat tu'
  ]) || '').trim();
}

function getCumLinhKien(item) {
  return String(getObjValue(item, [
    'Cụm Linh Kiện',
    'Cụm linh kiện',
    'Cum Linh Kien',
    'Cum linh kien'
  ]) || '').trim();
}

function makeMaterialId(item) {
  const ten = getTenVatTu(item);
  const cum = getCumLinhKien(item);
  const ma = getObjValue(item, ['Mã vật tư', 'Ma vat tu']) || '';

  return normText(cum + '|' + ten + '|' + ma);
}


/****************************************************
 * FORM PAYLOAD
 ****************************************************/

function collectFormPayload() {
  const mucDich = getRadioValue('mucDich');

  let cuThe = '';

  if (mucDich === 'Bảo dưỡng sửa chữa') {
    cuThe = getValue('hienTuong');
  } else {
    cuThe = getValue('cuTheNhapTay').trim();
  }

  const may = getCurrentMachine();

  return {
    doiTruong: getValue('doiTruong'),
    thanhVien: SELECTED_MEMBERS.slice(),
    maMay: getValue('maMay'),
    tenTrai: may ? getObjValue(may, ['Tên trại', 'Ten trai', 'Trại', 'Địa chỉ trại']) : getText('tenTrai'),
    donVi: may ? getObjValue(may, ['Đơn vị', 'Don vi']) : getText('donVi'),
    khuVuc: may ? getObjValue(may, ['Khu vực', 'Khu Vực', 'Khu vuc']) : getText('khuVuc'),
    tinhTP: may ? getObjValue(may, ['Tỉnh/TP', 'Tinh/TP', 'Tỉnh TP', 'Tỉnh']) : getText('tinhTP'),
    ngayGioXuatKho: getValue('ngayGioXuatKho'),
    nguoiXuatKho: getValue('nguoiXuatKho'),
    ngayGioNhapKho: getValue('ngayGioNhapKho'),
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
  if (!payload.thanhVien || !payload.thanhVien.length) return 'Vui lòng chọn thành viên.';
  if (!payload.maMay) return 'Vui lòng chọn mã máy.';
  if (!payload.ngayGioXuatKho) return 'Vui lòng nhập ngày giờ xuất kho.';
  if (!payload.nguoiXuatKho) return 'Vui lòng chọn người xuất kho.';
  if (!payload.mucDich) return 'Vui lòng chọn mục đích.';
  if (!payload.cuThe) return 'Vui lòng nhập/chọn nội dung cụ thể.';
  if (!payload.items || !payload.items.length) return 'Vui lòng chọn vật tư.';

  if (payload.thanhVien.includes(payload.doiTruong)) {
    return 'Thành viên không được trùng với đội trưởng.';
  }

  return '';
}

function getCurrentMachine() {
  const maMay = getValue('maMay');
  if (!maMay) return null;

  return APP.may.find(x => getMayCode(x) === maMay) || null;
}


/****************************************************
 * SAVE / PREVIEW / EDIT
 ****************************************************/

async function previewCurrentForm() {
  const payload = collectFormPayload();
  const err = validatePayloadClient(payload);

  if (err) {
    alert(err);
    return;
  }

  setBusy(true, 'Đang tạo xem trước...');

  try {
    const html = await api('previewDraft', {
      token: TOKEN,
      payload
    });

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

  if (err) {
    alert(err);
    return;
  }

  setBusy(true, EDITING_MA_PHIEU ? 'Đang cập nhật phiếu...' : 'Đang lưu phiếu...');

  try {
    let res;

    if (EDITING_MA_PHIEU) {
      res = await api('updatePhieu', {
        token: TOKEN,
        maPhieu: EDITING_MA_PHIEU,
        payload
      });
    } else {
      res = await api('savePhieu', {
        token: TOKEN,
        payload
      });
    }

    alert((EDITING_MA_PHIEU ? 'Đã cập nhật phiếu: ' : 'Đã lưu phiếu: ') + res.maPhieu);

    resetForm();
    await loadPhieuList(false);

    const historyBtn = [...document.querySelectorAll('.nav')]
      .find(btn => (btn.textContent || '').includes('Phiếu đã tạo'));

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
  setValue('hienTuong', '');
  setValue('cuTheNhapTay', '');
  setValue('searchVatTu', '');

  onMucDichChange();
  resetSelectedMaterials();
}

function cancelEdit() {
  resetForm();
}

async function editPhieu(maPhieu) {
  setBusy(true, 'Đang tải phiếu để sửa...');

  try {
    const data = await api('getPhieuDetail', {
      token: TOKEN,
      maPhieu
    });

    fillFormFromPhieu(data.phieu, data.items);

    const formBtn = [...document.querySelectorAll('.nav')]
      .find(btn => (btn.textContent || '').includes('Tạo phiếu'));

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

  SELECTED_MEMBERS = String(phieu.thanhVien || '')
    .split(';')
    .map(x => x.trim())
    .filter(Boolean);

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
    setValue('hienTuong', phieu.cuThe || '');
  } else {
    setValue('cuTheNhapTay', phieu.cuThe || '');
  }

  APP.selected = (items || []).map(x => ({
    id: makeMaterialId({
      'Cụm Linh Kiện': x.cumLinhKien,
      'Tên Chi Tiết / Linh Kiện Thay Thế': x.tenVatTu,
      'Mã vật tư': x.maVatTu
    }),
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

  if (!silent) {
    box.innerHTML = '<i>Đang tải danh sách phiếu...</i>';
  }

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
                <button type="button" class="small-btn" onclick="previewSavedPhieu('${escapeJs(p.maPhieu)}')">Xem trước</button>
                <button type="button" class="small-btn" onclick="exportPdf('${escapeJs(p.maPhieu)}')">PDF</button>
                <button type="button" class="small-btn" onclick="exportWord('${escapeJs(p.maPhieu)}')">Word</button>
                <button type="button" class="small-btn secondary" onclick="editPhieu('${escapeJs(p.maPhieu)}')">Sửa</button>
                <button type="button" class="small-btn danger" onclick="deletePhieuUI('${escapeJs(p.maPhieu)}')">Xóa</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function previewSavedPhieu(maPhieu) {
  setBusy(true, 'Đang mở xem trước...');

  try {
    const html = await api('previewPhieu', {
      token: TOKEN,
      maPhieu
    });

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
    const url = await api('exportPhieuPdf', {
      token: TOKEN,
      maPhieu
    });

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
    const url = await api('exportPhieuWord', {
      token: TOKEN,
      maPhieu
    });

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

  const ok = confirm(
    'Bạn chắc chắn muốn xóa phiếu ' + maPhieu + '?\n\n' +
    'Thao tác này sẽ xóa dữ liệu ở sheet 10, sheet 11 và chuyển file PDF/Word vào thùng rác nếu có.'
  );

  if (!ok) return;

  setBusy(true, 'Đang xóa phiếu...');

  try {
    await api('deletePhieu', {
      token: TOKEN,
      maPhieu
    });

    alert('Đã xóa phiếu: ' + maPhieu);

    if (EDITING_MA_PHIEU === maPhieu) {
      resetForm();
    }

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

  if (!silent) {
    box.innerHTML = '<i>Đang tải danh sách tài khoản...</i>';
  }

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
        <div>
          <b>${escapeHtml(acc.username)}</b><br>
          <small>${escapeHtml(acc.createdAt || '')}</small>
        </div>

        <div>${escapeHtml(acc.fullName)}</div>

        <div>${escapeHtml(acc.role)}</div>

        <div>${renderStatusBadge(status)}</div>

        <div>
          <button type="button" class="small-btn" onclick="editAccountUI(${Number(acc.rowNumber)})">Sửa</button>
          ${status === 'pending'
            ? `<button type="button" class="small-btn" onclick="setAccountStatusUI(${Number(acc.rowNumber)}, 'active')">Duyệt</button>`
            : ''
          }
          ${status === 'active'
            ? `<button type="button" class="small-btn danger" onclick="setAccountStatusUI(${Number(acc.rowNumber)}, 'locked')">Khóa</button>`
            : `<button type="button" class="small-btn" onclick="setAccountStatusUI(${Number(acc.rowNumber)}, 'active')">Mở</button>`
          }
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
  if (!CURRENT_USER || CURRENT_USER.role !== 'admin') {
    alert('Bạn không có quyền admin.');
    return;
  }

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
    await api('saveAccount', {
      token: TOKEN,
      account
    });

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
    await api('setAccountStatus', {
      token: TOKEN,
      rowNumber,
      status
    });

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

  const buttons = document.querySelectorAll('button');
  buttons.forEach(btn => {
    if (btn.classList.contains('nav')) return;
    btn.disabled = isBusy;
  });

  const saveBtn = document.getElementById('saveBtn');

  if (saveBtn) {
    if (isBusy) {
      saveBtn.dataset.oldText = saveBtn.textContent;
      saveBtn.textContent = message || 'Đang xử lý...';
    } else if (saveBtn.dataset.oldText) {
      saveBtn.textContent = saveBtn.dataset.oldText;
      delete saveBtn.dataset.oldText;
    }
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
  const list = document.querySelectorAll('input[name="' + name + '"]');

  list.forEach(x => {
    x.checked = x.value === value;
  });
}

function getObjValue(obj, keys) {
  if (!obj) return '';

  const normKeys = keys.map(normText);

  for (const k in obj) {
    if (normKeys.includes(normText(k))) {
      return obj[k];
    }
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
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
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

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return s.slice(0, 16);
  }

  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return toDatetimeLocalValue(d);
  }

  return '';
}
