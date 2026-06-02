const API_URL = 'https://script.google.com/macros/s/AKfycbykEYJqDRdl3_QqlfDLN_HI2IDlhDcA-96ZrjwxaKnoHC8QiKyXWill9zwYtPDffm3a/exec';

let TOKEN = '';
let CURRENT_USER = null;
let ACCOUNT_CACHE = [];
let AUTO_REFRESH_TIMER = null;
let SELECTED_MEMBERS = [];
let EDITING_MA_PHIEU = '';

let APP = {
  may: [],
  hienTuong: [],
  vatTu: [],
  ktv: [],
  vatTuCoDinh: [],
  selected: []
};

async function api(action, data = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify({ action, data })
  });

  const text = await res.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('API không trả JSON. Kiểm tra link Apps Script hoặc quyền triển khai.');
  }

  if (!json.success) {
    throw new Error(json.message || 'API lỗi.');
  }

  return json.data;
}

window.onload = function () {
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('appPage').classList.add('hidden');

  document.addEventListener('click', function (e) {
    const multi = document.getElementById('thanhVienMulti');
    const dropdown = document.getElementById('thanhVienDropdown');

    if (multi && dropdown && !multi.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
};

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const msg = document.getElementById('loginMsg');

  if (!username || !password) {
    msg.innerText = 'Vui lòng nhập đủ tên đăng nhập và mật khẩu.';
    return;
  }

  msg.innerText = 'Đang đăng nhập...';

  try {
    const res = await api('login', { username, password });

    TOKEN = res.token;
    CURRENT_USER = res.user;

    initApp(res.appData);
    startAutoRefresh();

    msg.innerText = '';
  } catch (err) {
    msg.innerText = 'Lỗi đăng nhập: ' + err.message;
  }
}

async function doLogout() {
  if (AUTO_REFRESH_TIMER) {
    clearInterval(AUTO_REFRESH_TIMER);
    AUTO_REFRESH_TIMER = null;
  }

  if (TOKEN) {
    try {
      await api('logout', { token: TOKEN });
    } catch (e) {}
  }

  TOKEN = '';
  CURRENT_USER = null;
  ACCOUNT_CACHE = [];
  SELECTED_MEMBERS = [];
  EDITING_MA_PHIEU = '';

  document.getElementById('appPage').classList.add('hidden');
  document.getElementById('loginPage').classList.remove('hidden');

  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginMsg').innerText = '';
}

function startAutoRefresh() {
  if (AUTO_REFRESH_TIMER) clearInterval(AUTO_REFRESH_TIMER);

  AUTO_REFRESH_TIMER = setInterval(() => {
    if (!TOKEN) return;

    loadApp(true);
    loadPhieuList(true);

    if (CURRENT_USER && CURRENT_USER.role === 'admin') {
      loadAccounts(true);
    }
  }, 30000);
}

async function loadApp(isAutoRefresh) {
  try {
    const data = await api('getAppData', { token: TOKEN });
    if (isAutoRefresh) refreshAppDataOnly(data);
    else initApp(data);
  } catch (err) {
    if (!isAutoRefresh) alert(err.message);
  }
}

function refreshAppDataOnly(data) {
  const oldDoiTruong = getValue('doiTruong');
  const oldMembers = [...SELECTED_MEMBERS];
  const oldMaMay = getValue('maMay');
  const oldHienTuong = getValue('hienTuong');
  const oldNguoiXuatKho = getValue('nguoiXuatKho');
  const oldNguoiNhapKho = getValue('nguoiNhapKho');

  APP = { ...APP, ...data };
  CURRENT_USER = data.currentUser;

  const names = getKtvNames();

  fillSelect('doiTruong', names, '-- Chọn đội trưởng --');
  setSelectValue('doiTruong', oldDoiTruong);

  SELECTED_MEMBERS = oldMembers.filter(name => name !== getValue('doiTruong'));
  renderMemberMultiSelect();

  fillSelect('nguoiXuatKho', names, '-- Chọn người xuất kho --');
  setSelectValue('nguoiXuatKho', oldNguoiXuatKho);

  fillSelect('nguoiNhapKho', names, '-- Chọn người nhập kho --');
  setSelectValue('nguoiNhapKho', oldNguoiNhapKho);

  fillSelect('maMay', getMayCodes(), '-- Chọn mã máy --');
  setSelectValue('maMay', oldMaMay);

  const hienTuongList = [...new Set(APP.hienTuong.map(x => getValClient(x, ['Hiện Tượng/Sự cố'])).filter(Boolean))];
  fillSelect('hienTuong', hienTuongList, '-- Chọn hiện tượng --');
  setSelectValue('hienTuong', oldHienTuong);

  onMayChange();
  renderVatTuSearch();
}

function initApp(data) {
  APP = { ...APP, ...data };
  CURRENT_USER = data.currentUser;

  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('appPage').classList.remove('hidden');

  document.getElementById('userBox').innerHTML = `
    <b>${escapeHtml(CURRENT_USER.fullName || CURRENT_USER.username)}</b><br>
    Vai trò: ${escapeHtml(CURRENT_USER.role)}
  `;

  if (CURRENT_USER.role === 'admin') {
    document.getElementById('adminNav').classList.remove('hidden');
    loadAccounts(false);
  } else {
    document.getElementById('adminNav').classList.add('hidden');
  }

  const names = getKtvNames();

  fillSelect('doiTruong', names, '-- Chọn đội trưởng --');
  SELECTED_MEMBERS = [];
  renderMemberMultiSelect();

  fillSelect('nguoiXuatKho', names, '-- Chọn người xuất kho --');
  fillSelect('nguoiNhapKho', names, '-- Chọn người nhập kho --');

  fillSelect('maMay', getMayCodes(), '-- Chọn mã máy --');

  const hienTuongList = [...new Set(APP.hienTuong.map(x => getValClient(x, ['Hiện Tượng/Sự cố'])).filter(Boolean))];
  fillSelect('hienTuong', hienTuongList, '-- Chọn hiện tượng --');

  setDefaultDateTime();
  onMayChange();
  renderVatTuCoDinh();
  loadPhieuList(false);
}

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
  const normKeys = keys.map(normKeyClient);

  for (const k in row) {
    if (normKeys.includes(normKeyClient(k))) {
      return row[k];
    }
  }

  return '';
}

function getKtvNames() {
  let list = APP.ktv.map(row => {
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
  }).filter(Boolean)
    .map(x => String(x).trim())
    .filter(x => x && isNaN(Number(x)));

  return [...new Set(list)];
}

function getMayCodes() {
  return APP.may.map(x => getValClient(x, ['Mã Máy', 'Mã máy'])).filter(Boolean);
}

function setDefaultDateTime() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('ngayGioXuatKho').value = now.toISOString().slice(0, 16);
}

function showTab(id, btn) {
  document.querySelectorAll('.tab').forEach(x => x.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');

  document.querySelectorAll('.nav').forEach(x => x.classList.remove('active'));
  if (btn) btn.classList.add('active');

  if (id === 'adminTab') loadAccounts(false);
  if (id === 'historyTab') loadPhieuList(false);
}

function showTabById(id) {
  const btn = Array.from(document.querySelectorAll('.nav')).find(b => {
    return b.getAttribute('onclick') && b.getAttribute('onclick').includes(id);
  });

  showTab(id, btn);
}

function fillSelect(id, arr, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;

  let html = '';

  if (placeholder) {
    html += `<option value="">${escapeHtml(placeholder)}</option>`;
  }

  html += arr.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

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

function toggleMemberDropdown() {
  document.getElementById('thanhVienDropdown').classList.toggle('hidden');
}

function getAvailableMembers() {
  const doiTruong = getValue('doiTruong');
  return getKtvNames().filter(name => name !== doiTruong);
}

function renderMemberMultiSelect() {
  const dropdown = document.getElementById('thanhVienDropdown');
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
    if (!SELECTED_MEMBERS.includes(name)) SELECTED_MEMBERS.push(name);
  } else {
    SELECTED_MEMBERS = SELECTED_MEMBERS.filter(x => x !== name);
  }

  updateMemberText();
}

function updateMemberText() {
  const text = document.getElementById('thanhVienText');

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

function onMayChange() {
  const maMay = getValue('maMay');
  const m = APP.may.find(x => String(getValClient(x, ['Mã Máy', 'Mã máy'])) === String(maMay)) || {};

  document.getElementById('tenTrai').innerText = getValClient(m, ['Tên Trang Trại / Đơn Vị', 'Tên trại', 'Tên Trang Trại']) || '';
  document.getElementById('donVi').innerText = getValClient(m, ['Đơn vị hợp tác', 'Đơn vị']) || '';
  document.getElementById('khuVuc').innerText = getValClient(m, ['Khu Vực', 'Khu vực']) || '';
  document.getElementById('tinhTP').innerText = getValClient(m, ['Tỉnh Thành', 'Tỉnh / TP', 'Tỉnh/TP']) || '';
}

function onMucDichChange() {
  const mucDich = getMucDich();

  if (mucDich === 'Bảo dưỡng sửa chữa') {
    document.getElementById('boxHienTuong').classList.remove('hidden');
    document.getElementById('boxCuThe').classList.add('hidden');
  } else {
    document.getElementById('boxHienTuong').classList.add('hidden');
    document.getElementById('boxCuThe').classList.remove('hidden');
  }

  renderVatTuSearch();
}

function getMucDich() {
  return document.querySelector('input[name="mucDich"]:checked').value;
}

function renderVatTuCoDinh() {
  APP.selected = [];

  APP.vatTuCoDinh.forEach((v, i) => {
    const ten = getValClient(v, ['Tên Chi Tiết / Linh Kiện Thay Thế', 'Hạng mục vật tư', 'Tên vật tư']);
    const cum = getValClient(v, ['Cụm Linh Kiện', 'Cụm linh kiện']);
    const maVT = getValClient(v, ['Mã Vật Tư', 'Mã vật tư']);
    const dvt = getValClient(v, ['Đơn vị tính']);

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

function renderVatTuSearch() {
  const box = document.getElementById('vatTuSearchList');
  const searchEl = document.getElementById('searchVatTu');

  if (!box || !searchEl) return;

  const keyword = removeTone(searchEl.value || '').toLowerCase().trim();

  if (!keyword) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const mucDich = getMucDich();
  let cumLienQuan = [];

  if (mucDich === 'Bảo dưỡng sửa chữa') {
    const ht = getValue('hienTuong');

    cumLienQuan = APP.hienTuong
      .filter(x => getValClient(x, ['Hiện Tượng/Sự cố']) === ht)
      .map(x => getValClient(x, ['Cụm Linh Kiện Liên Quan']))
      .filter(Boolean);
  }

  const selectedNames = new Set(APP.selected.map(x => normalizeName(x.tenVatTu)));

  const list = APP.vatTu.filter(v => {
    const ten = getValClient(v, ['Tên Chi Tiết / Linh Kiện Thay Thế', 'Hạng mục vật tư', 'Tên vật tư']);
    const cum = getValClient(v, ['Cụm Linh Kiện', 'Cụm linh kiện']);

    if (!ten) return false;
    if (selectedNames.has(normalizeName(ten))) return false;

    if (mucDich === 'Bảo dưỡng sửa chữa' && cumLienQuan.length) {
      if (!cumLienQuan.includes(cum)) return false;
    }

    const text = removeTone(ten + ' ' + cum).toLowerCase();

    return text.includes(keyword);
  });

  if (!list.length) {
    box.classList.remove('hidden');
    box.innerHTML = '<div class="suggest-row"><div></div><div>Không tìm thấy vật tư phù hợp.</div></div>';
    return;
  }

  box.classList.remove('hidden');

  box.innerHTML = list.map((v, i) => {
    const ten = getValClient(v, ['Tên Chi Tiết / Linh Kiện Thay Thế', 'Hạng mục vật tư', 'Tên vật tư']);
    const cum = getValClient(v, ['Cụm Linh Kiện', 'Cụm linh kiện']);
    const maVT = getValClient(v, ['Mã Vật Tư', 'Mã vật tư']);
    const dvt = getValClient(v, ['Đơn vị tính']);
    const id = 'search_' + i + '_' + safeId(ten);

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
        <input type="number" min="0" value="1" id="${id}_sl">
        <select id="${id}_tt">
          <option value="Mới">Mới</option>
          <option value="Cũ">Cũ</option>
          <option value="Tốt">Tốt</option>
          <option value="K.xđ">K.xđ</option>
        </select>
      </div>
    `;
  }).join('');
}

function addVatTuFromSearch(cb) {
  if (!cb.checked) return;

  const row = cb.closest('.suggest-row');
  const sl = row.querySelector('input[type="number"]').value || 1;
  const tt = row.querySelector('select').value || 'Mới';

  APP.selected.push({
    id: 'add_' + Date.now() + '_' + safeId(cb.dataset.ten),
    nguonVatTu: 'Chọn thêm',
    cumLinhKien: cb.dataset.cum || '',
    tenVatTu: cb.dataset.ten || '',
    maVatTu: cb.dataset.mavt || '',
    donViTinh: cb.dataset.dvt || '',
    soLuongCan: sl,
    tinhTrangXuatKho: tt,
    ghiChu: ''
  });

  document.getElementById('searchVatTu').value = '';
  document.getElementById('vatTuSearchList').classList.add('hidden');
  document.getElementById('vatTuSearchList').innerHTML = '';

  renderSelected();
}

function renderSelected() {
  const box = document.getElementById('selectedItems');

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
  if (APP.selected[index]) APP.selected[index].soLuongCan = value;
}

function updateSelectedStatus(index, value) {
  if (APP.selected[index]) APP.selected[index].tinhTrangXuatKho = value;
}

function buildCurrentPayload() {
  const mucDich = getMucDich();
  const maMay = getValue('maMay');
  const m = APP.may.find(x => String(getValClient(x, ['Mã Máy', 'Mã máy'])) === String(maMay)) || {};

  const cuThe = mucDich === 'Bảo dưỡng sửa chữa'
    ? getValue('hienTuong')
    : document.getElementById('cuTheNhapTay').value.trim();

  return {
    maPhieu: EDITING_MA_PHIEU || '',
    doiTruong: getValue('doiTruong'),
    thanhVien: [...SELECTED_MEMBERS],
    maMay,
    tenTrai: getValClient(m, ['Tên Trang Trại / Đơn Vị', 'Tên trại', 'Tên Trang Trại']),
    donVi: getValClient(m, ['Đơn vị hợp tác', 'Đơn vị']),
    khuVuc: getValClient(m, ['Khu Vực', 'Khu vực']),
    tinhTP: getValClient(m, ['Tỉnh Thành', 'Tỉnh / TP', 'Tỉnh/TP']),
    ngayGioXuatKho: getValue('ngayGioXuatKho'),
    nguoiXuatKho: getValue('nguoiXuatKho'),
    ngayGioNhapKho: getValue('ngayGioNhapKho'),
    nguoiNhapKho: getValue('nguoiNhapKho'),
    mucDich,
    cuThe,
    ghiChu: '',
    items: APP.selected
  };
}

async function save() {
  const payload = buildCurrentPayload();

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
}

function resetFormAfterSave() {
  EDITING_MA_PHIEU = '';
  document.getElementById('formTitle').innerText = 'Phiếu chuẩn bị vật tư';
  document.getElementById('saveBtn').innerText = 'Lưu phiếu';
  document.getElementById('cancelEditBtn').classList.add('hidden');

  setSelectValue('doiTruong', '');
  SELECTED_MEMBERS = [];
  renderMemberMultiSelect();

  setSelectValue('maMay', '');
  onMayChange();

  setSelectValue('nguoiXuatKho', '');
  setSelectValue('nguoiNhapKho', '');
  document.getElementById('ngayGioNhapKho').value = '';

  setDefaultDateTime();

  document.querySelector('input[name="mucDich"][value="Bảo dưỡng sửa chữa"]').checked = true;
  onMucDichChange();
  setSelectValue('hienTuong', '');

  document.getElementById('cuTheNhapTay').value = '';
  document.getElementById('searchVatTu').value = '';

  renderVatTuCoDinh();
}

function cancelEdit() {
  resetFormAfterSave();
}

async function loadPhieuList(isAutoRefresh) {
  if (!TOKEN) return;

  const box = document.getElementById('phieuList');
  if (!box) return;

  if (!isAutoRefresh) box.innerHTML = '<i>Đang tải danh sách phiếu...</i>';

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
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function previewCurrentForm() {
  try {
    const html = await api('previewDraft', {
      token: TOKEN,
      payload: buildCurrentPayload()
    });
    openPreview(html);
  } catch (err) {
    alert(err.message);
  }
}

async function previewSavedPhieu(maPhieu) {
  try {
    const html = await api('previewPhieu', {
      token: TOKEN,
      maPhieu
    });
    openPreview(html);
  } catch (err) {
    alert(err.message);
  }
}

function openPreview(html) {
  const modal = document.getElementById('previewModal');
  const frame = document.getElementById('previewFrame');

  modal.classList.remove('hidden');
  frame.srcdoc = html;
}

function closePreview() {
  document.getElementById('previewModal').classList.add('hidden');
  document.getElementById('previewFrame').srcdoc = '';
}

async function exportPdf(maPhieu) {
  try {
    const url = await api('exportPhieuPdf', {
      token: TOKEN,
      maPhieu
    });
    window.open(url, '_blank');
  } catch (err) {
    alert(err.message);
  }
}

async function exportWord(maPhieu) {
  try {
    const url = await api('exportPhieuWord', {
      token: TOKEN,
      maPhieu
    });
    window.open(url, '_blank');
  } catch (err) {
    alert(err.message);
  }
}

async function editPhieu(maPhieu) {
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
}

function loadPhieuToForm(data) {
  const p = data.phieu;
  const items = data.items || [];

  EDITING_MA_PHIEU = p.maPhieu || '';

  document.getElementById('formTitle').innerText = 'Chỉnh sửa phiếu: ' + EDITING_MA_PHIEU;
  document.getElementById('saveBtn').innerText = 'Cập nhật phiếu';
  document.getElementById('cancelEditBtn').classList.remove('hidden');

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

  document.getElementById('ngayGioXuatKho').value = toDatetimeLocalValue(p.ngayGioXuatKho);
  document.getElementById('ngayGioNhapKho').value = toDatetimeLocalValue(p.ngayGioNhapKho);

  const mucDich = p.mucDich || 'Bảo dưỡng sửa chữa';
  const radio = document.querySelector(`input[name="mucDich"][value="${mucDich}"]`);
  if (radio) radio.checked = true;
  onMucDichChange();

  if (mucDich === 'Bảo dưỡng sửa chữa') {
    setSelectValue('hienTuong', p.cuThe || '');
  } else {
    document.getElementById('cuTheNhapTay').value = p.cuThe || '';
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
}

function toDatetimeLocalValue(v) {
  if (!v) return '';

  const s = String(v).trim();

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return s.replace(' ', 'T').slice(0, 16);

  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;

  return '';
}

async function loadAccounts(isAutoRefresh) {
  if (!CURRENT_USER || CURRENT_USER.role !== 'admin') return;

  const box = document.getElementById('accountList');

  if (!isAutoRefresh && box) box.innerHTML = '<i>Đang tải danh sách tài khoản...</i>';

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
      actionBtn = `<button class="small-btn secondary" onclick="toggleAccount(${acc.rowNumber}, 'locked')">Khóa</button>`;
    } else {
      actionBtn = `<button class="small-btn" onclick="toggleAccount(${acc.rowNumber}, 'active')">Mở</button>`;
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

  document.getElementById('accRow').value = acc.rowNumber || '';
  document.getElementById('accUsername').value = acc.username || '';
  document.getElementById('accPassword').value = '';
  document.getElementById('accFullName').value = acc.fullName || '';
  document.getElementById('accRole').value = acc.role || 'ktv';
  document.getElementById('accStatus').value = acc.status || 'active';
  document.getElementById('accNote').value = acc.note || '';
}

function clearAccountForm() {
  document.getElementById('accRow').value = '';
  document.getElementById('accUsername').value = '';
  document.getElementById('accPassword').value = '';
  document.getElementById('accFullName').value = '';
  document.getElementById('accRole').value = 'ktv';
  document.getElementById('accStatus').value = 'active';
  document.getElementById('accNote').value = '';
}

async function saveAccountUI() {
  const account = {
    rowNumber: document.getElementById('accRow').value,
    username: document.getElementById('accUsername').value.trim(),
    password: document.getElementById('accPassword').value.trim(),
    fullName: document.getElementById('accFullName').value.trim(),
    role: document.getElementById('accRole').value,
    status: document.getElementById('accStatus').value,
    note: document.getElementById('accNote').value.trim()
  };

  try {
    const res = await api('saveAccount', {
      token: TOKEN,
      account
    });
    alert(res.message || 'Đã lưu tài khoản.');
    clearAccountForm();
    loadAccounts(false);
  } catch (err) {
    alert(err.message);
  }
}

async function toggleAccount(rowNumber, status) {
  try {
    await api('setAccountStatus', {
      token: TOKEN,
      rowNumber,
      status
    });
    loadAccounts(false);
  } catch (err) {
    alert(err.message);
  }
}

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
