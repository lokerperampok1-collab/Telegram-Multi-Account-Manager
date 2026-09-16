// Account pagination and filtering state
let accountPagination = {
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 1,
  search: '',
  status: 'all',
  idFilter: '',
  twofa: 'all',
  sort: 'id_desc'
};

// Account management logic
async function loadAccounts(targetPage = null) {
  const container = document.getElementById('accounts-container');
  const countBadge = document.getElementById('account-count');
  if (!container) return;

  if (targetPage !== null) {
    accountPagination.page = targetPage;
  }

  try {
    let url = `/api/accounts?page=${accountPagination.page}&limit=${accountPagination.limit}`;
    if (accountPagination.search) {
      url += `&search=${encodeURIComponent(accountPagination.search)}`;
    }
    if (accountPagination.status && accountPagination.status !== 'all') {
      url += `&status=${accountPagination.status}`;
    }
    if (accountPagination.twofa && accountPagination.twofa !== 'all') {
      url += `&twofa=${encodeURIComponent(accountPagination.twofa)}`;
    }
    if (accountPagination.idFilter) {
      url += `&id_filter=${encodeURIComponent(accountPagination.idFilter)}`;
    }
    if (accountPagination.sort) {
      url += `&sort=${encodeURIComponent(accountPagination.sort)}`;
    }

    const res = await fetch(url, {
      headers: getAuthHeaders()
    });

    if (res.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
      return;
    }

    const data = await res.json();
    if (res.ok) {
      renderAccounts(data.accounts || []);
      if (data.pagination) {
        accountPagination.page = data.pagination.page;
        accountPagination.limit = data.pagination.limit;
        accountPagination.total = data.pagination.total;
        accountPagination.totalPages = data.pagination.total_pages;
        updatePaginationUI();
      }
      if (countBadge) {
        countBadge.textContent = `${accountPagination.total} Akun`;
      }
      const navBadge = document.getElementById('nav-account-count');
      if (navBadge) {
        navBadge.textContent = accountPagination.total;
      }
    } else {
      showToast(data.detail || 'Gagal mengambil daftar akun', 'error');
    }
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state glass-panel" style="grid-column: 1 / -1;">
        <p style="color: var(--accent-rose);">Koneksi ke server terputus.</p>
      </div>
    `;
  }
}

function updatePaginationUI() {
  const paginationBar = document.getElementById('pagination-bar');
  const curPageSpan = document.getElementById('current-page-display');
  const totalPagesSpan = document.getElementById('total-pages-display');
  const totalCountSpan = document.getElementById('pagination-total-text');
  const prevBtn = document.getElementById('prev-page-btn');
  const nextBtn = document.getElementById('next-page-btn');

  if (!paginationBar) return;

  if (accountPagination.total === 0) {
    paginationBar.style.display = 'none';
    return;
  }

  paginationBar.style.display = 'flex';
  if (curPageSpan) curPageSpan.textContent = accountPagination.page;
  if (totalPagesSpan) totalPagesSpan.textContent = accountPagination.totalPages;
  if (totalCountSpan) totalCountSpan.textContent = `(Total ${accountPagination.total} Akun)`;

  if (prevBtn) prevBtn.disabled = accountPagination.page <= 1;
  if (nextBtn) nextBtn.disabled = accountPagination.page >= accountPagination.totalPages;
}

function renderAccounts(accounts) {
  const container = document.getElementById('accounts-container');
  if (!container) return;

  if (accounts.length === 0) {
    if (accountPagination.search || accountPagination.idFilter || accountPagination.status !== 'all') {
      container.innerHTML = `
        <div class="empty-state glass-panel" style="grid-column: 1 / -1;">
          <h3>Tidak Ada Akun yang Cocok</h3>
          <p>Coba kata kunci pencarian lain, ubah filter status, atau periksa filter ID.</p>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div class="empty-state glass-panel" style="grid-column: 1 / -1;">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="4" width="20" height="16" rx="2"></rect>
          <path d="M7 15h10M7 9h2M11 9h6"></path>
        </svg>
        <h3>Belum Ada Akun Telegram</h3>
        <p>Gunakan panel di sebelah kanan untuk menambahkan akun via Nomor HP, QR Code, atau Import Sesi.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = accounts.map(acc => {
    const initial = (acc.display_name || acc.username || acc.phone_number || 'T')[0].toUpperCase();
    const isOnline = acc.is_active;

    return `
      <div class="account-card" id="account-card-${acc.id}">
        <div class="account-card-header">
          <div class="account-avatar">
            ${initial}
            <div class="status-dot ${isOnline ? 'online' : 'offline'}" title="${isOnline ? 'Terhubung' : 'Terputus'}"></div>
          </div>
          <div class="account-info">
            <h3 title="${acc.display_name || 'User Telegram'}">${acc.display_name || 'User Telegram'}</h3>
            <div class="account-username">${acc.username ? '@' + acc.username : 'Tanpa Username'}</div>
          </div>
          <span class="account-id-badge" onclick="filterByTelegramId('${acc.telegram_id}')" title="Telegram ID: ${acc.telegram_id || '-'} (Klik untuk cari awalan ini)">TG: ${acc.telegram_id || '-'}</span>
        </div>

        <div class="account-details">
          <div class="detail-row">
            <span>Nomor HP</span>
            <span>${acc.phone_number || '-'}</span>
          </div>
          <div class="detail-row">
            <span>Telegram ID</span>
            <span class="tg-id-clickable" onclick="filterByTelegramId('${acc.telegram_id}')" title="Klik untuk filter awalan ID ini" style="color: var(--accent-cyan); font-weight: 600; cursor: pointer; font-family: 'JetBrains Mono', monospace;">
              ${acc.telegram_id || '-'} 🔍
            </span>
          </div>
          <div class="detail-row">
            <span>Status Sesi</span>
            <span style="color: ${isOnline ? 'var(--accent-green)' : 'var(--text-muted)'};">
              ${isOnline ? '● Terhubung' : '○ Offline'}
            </span>
          </div>
          <div class="detail-row">
            <span>SpamBot</span>
            <span id="health-badge-${acc.id}" style="color: var(--accent-cyan); cursor: pointer; font-weight: 500;" onclick="checkAccountHealth(${acc.id})" title="Klik untuk cek @SpamBot">
              🔍 Cek Status
            </span>
          </div>
          <div class="detail-row">
            <span>Status 2FA</span>
            <span id="twofa-badge-${acc.id}" style="cursor: pointer;" onclick="checkAccount2FA(${acc.id})" title="Klik untuk cek status 2FA">
              ${get2FaBadgeHtml(acc)}
            </span>
          </div>
        </div>

        <div class="account-actions">
          <button class="btn btn-secondary btn-sm otp-action-btn" onclick="openOtpModal(${acc.id}, '${escapeHtml(acc.display_name || 'Akun #' + acc.id)}', '${escapeHtml(acc.phone_number || '-')}')" title="Ambil kode masuk / OTP Telegram">
            🔑 Ambil OTP
          </button>
          <button class="btn btn-secondary btn-sm" onclick="checkAccountHealth(${acc.id})" title="Cek status @SpamBot">
            🛡️
          </button>
          <button class="btn btn-secondary btn-sm" onclick="checkAccount2FA(${acc.id})" title="Cek status 2FA (Cloud Password)">
            🔒
          </button>
          ${isOnline ? `
            <button class="btn btn-secondary btn-sm" onclick="disconnectAccount(${acc.id})">
              Putuskan
            </button>
          ` : `
            <button class="btn btn-primary btn-sm" onclick="connectAccount(${acc.id})">
              Hubungkan
            </button>
          `}
          <button class="btn btn-danger btn-sm" onclick="deleteAccount(${acc.id}, '${escapeHtml(acc.display_name || acc.phone_number || '')}')" title="Hapus Akun">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function connectAccount(accountId) {
  showToast('Menghubungkan akun Telegram...', 'info');
  try {
    const res = await fetch(`/api/accounts/${accountId}/connect`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Akun berhasil dihubungkan!', 'success');
      loadAccounts();
    } else {
      showToast(data.detail || 'Gagal menghubungkan', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  }
}

async function disconnectAccount(accountId) {
  try {
    const res = await fetch(`/api/accounts/${accountId}/disconnect`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Akun telah diputuskan', 'info');
      loadAccounts();
    } else {
      showToast(data.detail || 'Gagal memutuskan', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  }
}

async function deleteAccount(accountId, accountName) {
  if (!confirm(`Apakah Anda yakin ingin menghapus akun ${accountName}? Sesi Telegram akan dihapus secara permanen.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/accounts/${accountId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Akun berhasil dihapus', 'success');
      loadAccounts();
    } else {
      showToast(data.detail || 'Gagal menghapus akun', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  }
}

// ----------------- Health Checker Logic -----------------

async function checkAccountHealth(accountId) {
  const badge = document.getElementById(`health-badge-${accountId}`);
  if (badge) {
    badge.innerHTML = '<div class="spinner" style="width: 12px; height: 12px;"></div> Memeriksa...';
  }

  try {
    const res = await fetch(`/api/accounts/${accountId}/check-health`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (badge) {
      if (data.status === 'clean') {
        badge.innerHTML = '<span style="color: var(--accent-green);">🟢 Clean / Normal</span>';
      } else if (data.status === 'limited') {
        badge.innerHTML = '<span style="color: var(--accent-amber);">🟡 Limited</span>';
      } else if (data.status === 'banned') {
        badge.innerHTML = '<span style="color: var(--accent-rose);">🔴 Banned/Mati</span>';
      } else {
        badge.innerHTML = `<span style="color: var(--text-muted);">⚪ ${data.badge || 'Unknown'}</span>`;
      }
    }
    showToast(data.message || 'Pemeriksaan status selesai', data.status === 'clean' ? 'success' : 'info');
  } catch (e) {
    if (badge) badge.innerHTML = '<span style="color: var(--accent-rose);">Gagal Cek</span>';
    showToast('Koneksi server gagal', 'error');
  }
}

async function checkAllAccountsHealth() {
  const btn = document.getElementById('check-all-health-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Cek @SpamBot...';
  }
  showToast('Memulai pengecekan @SpamBot untuk semua akun...', 'info');

  try {
    const res = await fetch('/api/accounts/check-health-all', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (res.ok && data.results) {
      data.results.forEach(r => {
        const badge = document.getElementById(`health-badge-${r.account_id}`);
        if (badge) {
          if (r.status === 'clean') {
            badge.innerHTML = '<span style="color: var(--accent-green);">🟢 Clean / Normal</span>';
          } else if (r.status === 'limited') {
            badge.innerHTML = '<span style="color: var(--accent-amber);">🟡 Limited</span>';
          } else if (r.status === 'banned') {
            badge.innerHTML = '<span style="color: var(--accent-rose);">🔴 Banned/Mati</span>';
          } else {
            badge.innerHTML = `<span style="color: var(--text-muted);">⚪ ${r.badge || 'Unknown'}</span>`;
          }
        }
      });
      showToast(`Pengecekan selesai untuk ${data.results.length} akun`, 'success');
    } else {
      showToast(data.detail || 'Gagal memeriksa akun', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🛡️ Cek Status Akun';
    }
  }
}

// ----------------- 2FA Checker Logic -----------------

function get2FaBadgeHtml(acc) {
  if (acc.twofa_status === 'matched' || acc.twofa_password) {
    const hintStr = acc.twofa_hint ? ` | Hint: ${escapeHtml(acc.twofa_hint)}` : '';
    return `<span style="color: var(--accent-green); font-weight: 600;" title="Password: ${escapeHtml(acc.twofa_password || '')}${hintStr}">🔒 Pass: "${escapeHtml(acc.twofa_password || '')}"</span>`;
  }
  if (acc.twofa_status === 'reset_pending' || acc.twofa_reset_until) {
    const until = acc.twofa_reset_until || '7 hari';
    return `<span style="color: var(--accent-amber); font-weight: 600;" title="Password salah (bukan 0707/7). Menunggu reset sampai: ${escapeHtml(until)}">⏳ Reset (7 Hari)</span>`;
  }
  if (acc.has_2fa === 1 || acc.has_2fa === true) {
    const hintStr = acc.twofa_hint ? ` (Hint: ${escapeHtml(acc.twofa_hint)})` : '';
    return `<span style="color: var(--accent-green); font-weight: 600;" title="2FA Aktif${hintStr}">🔒 2FA Aktif</span>`;
  }
  if (acc.has_2fa === 0 || acc.has_2fa === false) {
    return `<span style="color: var(--text-muted);" title="Tidak menggunakan 2FA">🔓 Tanpa 2FA</span>`;
  }
  return `<span style="color: var(--accent-cyan); font-weight: 500;" title="Klik untuk cek status 2FA">🔍 Cek 2FA</span>`;
}

async function checkAccount2FA(accountId) {
  const badge = document.getElementById(`twofa-badge-${accountId}`);
  if (badge) {
    badge.innerHTML = '<div class="spinner" style="width: 12px; height: 12px; display: inline-block;"></div> Memeriksa...';
  }

  try {
    const res = await fetch(`/api/accounts/${accountId}/check-2fa`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (badge) {
      if (data.status === 'success') {
        badge.innerHTML = get2FaBadgeHtml(data);
      } else {
        badge.innerHTML = '<span style="color: var(--accent-rose);" title="' + escapeHtml(data.message || 'Gagal cek') + '">⚠️ Gagal</span>';
      }
    }

    if (data.status === 'success') {
      const hintMsg = data.hint ? ` | Hint: "${data.hint}"` : '';
      showToast(`${data.message}${hintMsg}`, data.twofa_password ? 'success' : (data.twofa_status === 'reset_pending' ? 'warning' : 'info'));
    } else {
      showToast(data.message || data.detail || 'Gagal mengecek 2FA', 'error');
    }
  } catch (e) {
    if (badge) badge.innerHTML = '<span style="color: var(--accent-rose);">Gagal</span>';
    showToast('Koneksi server gagal', 'error');
  }
}

async function checkAllAccounts2FA() {
  const btn = document.getElementById('check-all-2fa-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Cek 2FA...';
  }
  showToast('Memeriksa 2FA (mencocokkan 0707 / 7 dan reset jika salah)...', 'info');

  try {
    const res = await fetch('/api/accounts/check-2fa-all', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (res.ok && data.results) {
      let countMatched = 0;
      let countReset = 0;
      let countNo2fa = 0;

      data.results.forEach(r => {
        const badge = document.getElementById(`twofa-badge-${r.account_id}`);
        if (badge) {
          if (r.status === 'success') {
            badge.innerHTML = get2FaBadgeHtml(r);
            if (r.twofa_password) countMatched++;
            else if (r.twofa_status === 'reset_pending') countReset++;
            else if (!r.has_2fa) countNo2fa++;
          } else {
            badge.innerHTML = '<span style="color: var(--accent-rose);" title="' + escapeHtml(r.message || 'Gagal cek') + '">⚠️ Gagal</span>';
          }
        }
      });
      showToast(`Pengecekan selesai (${data.results.length} akun): ${countMatched} sandi cocok, ${countReset} reset 7 hari, ${countNo2fa} tanpa 2FA`, 'success');
    } else {
      showToast(data.detail || 'Gagal memeriksa status 2FA', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔒 Cek 2FA Semua';
    }
  }
}

// ----------------- Export Sessions Logic -----------------

async function triggerExport(format) {
  showToast(`Menyiapkan export format ${format.toUpperCase()}...`, 'info');
  try {
    const res = await fetch(`/api/accounts/export/${format}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      showToast('Gagal mengunduh file backup', 'error');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `telegram_sessions_backup.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast(`File backup .${format} berhasil diunduh!`, 'success');
  } catch (e) {
    showToast('Gagal export session', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refresh-accounts-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadAccounts();
      showToast('Daftar akun diperbarui', 'info');
    });
  }

  const checkAllBtn = document.getElementById('check-all-health-btn');
  if (checkAllBtn) {
    checkAllBtn.addEventListener('click', checkAllAccountsHealth);
  }

  const checkAll2faBtn = document.getElementById('check-all-2fa-btn');
  if (checkAll2faBtn) {
    checkAll2faBtn.addEventListener('click', checkAllAccounts2FA);
  }

  // Export dropdown handlers
  const exportMenuBtn = document.getElementById('export-menu-btn');
  const exportDropdown = document.getElementById('export-dropdown-menu');
  const exportJsonBtn = document.getElementById('export-json-btn');
  const exportTxtBtn = document.getElementById('export-txt-btn');

  if (exportMenuBtn && exportDropdown) {
    exportMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.style.display = exportDropdown.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', () => {
      exportDropdown.style.display = 'none';
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerExport('json');
    });
  }

  if (exportTxtBtn) {
    exportTxtBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerExport('txt');
    });
  }

  // Search & Filter controls
  const searchInput = document.getElementById('account-search-input');
  const clearSearchBtn = document.getElementById('search-clear-btn');
  let searchDebounceTimer = null;

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (clearSearchBtn) clearSearchBtn.style.display = val ? 'block' : 'none';
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        accountPagination.search = val;
        accountPagination.page = 1;
        loadAccounts();
      }, 300);
    });
  }

  if (clearSearchBtn && searchInput) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      accountPagination.search = '';
      accountPagination.page = 1;
      loadAccounts();
    });
  }

  // ID Filter control
  const idFilterInput = document.getElementById('account-id-filter');
  const clearIdFilterBtn = document.getElementById('id-filter-clear-btn');
  let idDebounceTimer = null;

  if (idFilterInput) {
    idFilterInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (clearIdFilterBtn) clearIdFilterBtn.style.display = val ? 'block' : 'none';
      clearTimeout(idDebounceTimer);
      idDebounceTimer = setTimeout(() => {
        accountPagination.idFilter = val;
        accountPagination.page = 1;
        loadAccounts();
      }, 300);
    });
  }

  if (clearIdFilterBtn && idFilterInput) {
    clearIdFilterBtn.addEventListener('click', () => {
      idFilterInput.value = '';
      clearIdFilterBtn.style.display = 'none';
      accountPagination.idFilter = '';
      accountPagination.page = 1;
      loadAccounts();
    });
  }

  // Quick filter function by clicking Telegram ID badge or value
  window.filterByTelegramId = function(tgId) {
    if (!tgId || tgId === 'null' || tgId === '-' || tgId === 'undefined') return;
    if (idFilterInput) {
      idFilterInput.value = tgId;
      if (clearIdFilterBtn) clearIdFilterBtn.style.display = 'block';
      accountPagination.idFilter = String(tgId);
      accountPagination.page = 1;
      loadAccounts();
    }
  };
  window.filterById = window.filterByTelegramId;

  const statusFilter = document.getElementById('account-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      accountPagination.status = e.target.value;
      accountPagination.page = 1;
      loadAccounts();
    });
  }

  const twofaFilter = document.getElementById('account-2fa-filter');
  if (twofaFilter) {
    twofaFilter.addEventListener('change', (e) => {
      accountPagination.twofa = e.target.value;
      accountPagination.page = 1;
      loadAccounts();
    });
  }

  const sortSelect = document.getElementById('account-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      accountPagination.sort = e.target.value;
      accountPagination.page = 1;
      loadAccounts();
    });
  }

  const limitSelect = document.getElementById('account-limit-select');
  if (limitSelect) {
    limitSelect.addEventListener('change', (e) => {
      accountPagination.limit = parseInt(e.target.value) || 50;
      accountPagination.page = 1;
      loadAccounts();
    });
  }

  // Pagination navigation buttons
  const prevBtn = document.getElementById('prev-page-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (accountPagination.page > 1) {
        accountPagination.page--;
        loadAccounts();
      }
    });
  }

  const nextBtn = document.getElementById('next-page-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (accountPagination.page < accountPagination.totalPages) {
        accountPagination.page++;
        loadAccounts();
      }
    });
  }

  // OTP Modal Close and Controls
  const otpModalClose = document.getElementById('otp-modal-close');
  if (otpModalClose) {
    otpModalClose.addEventListener('click', closeOtpModal);
  }

  const otpModal = document.getElementById('otp-modal');
  if (otpModal) {
    otpModal.addEventListener('click', (e) => {
      if (e.target === otpModal) closeOtpModal();
    });
  }

  const refreshOtpBtn = document.getElementById('refresh-otp-btn');
  if (refreshOtpBtn) {
    refreshOtpBtn.addEventListener('click', () => {
      if (currentOtpAccountId) fetchAccountOtp(currentOtpAccountId, false);
    });
  }

  const autoRefreshChk = document.getElementById('otp-auto-refresh-chk');
  if (autoRefreshChk) {
    autoRefreshChk.addEventListener('change', (e) => {
      if (e.target.checked) {
        startOtpAutoRefresh();
      } else {
        stopOtpAutoRefresh();
      }
    });
  }

  const copyOtpBtn = document.getElementById('copy-otp-btn');
  if (copyOtpBtn) {
    copyOtpBtn.addEventListener('click', () => {
      if (currentExtractedOtp) {
        copySpecificOtp(currentExtractedOtp);
      } else {
        showToast('Belum ada kode OTP yang terdeteksi', 'warning');
      }
    });
  }

  loadAccounts();
});

// Helper to escape HTML attributes
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==================== TELEGRAM OTP MODAL CONTROLLER ====================
let currentOtpAccountId = null;
let otpPollingTimer = null;
let currentExtractedOtp = null;

window.openOtpModal = function(accountId, displayName, phoneNumber) {
  currentOtpAccountId = accountId;
  currentExtractedOtp = null;

  const modal = document.getElementById('otp-modal');
  const titleEl = document.getElementById('otp-modal-account-title');
  const phoneEl = document.getElementById('otp-modal-account-phone');
  const codeValEl = document.getElementById('otp-code-value');
  const timeBadgeEl = document.getElementById('otp-time-badge');
  const historyList = document.getElementById('otp-history-list');
  const historyCount = document.getElementById('otp-history-count');
  const copyBtnText = document.getElementById('copy-btn-text');

  if (titleEl) titleEl.textContent = displayName || `Akun #${accountId}`;
  if (phoneEl) phoneEl.textContent = `Nomor HP: ${phoneNumber || '-'}`;
  if (codeValEl) codeValEl.textContent = '------';
  if (timeBadgeEl) timeBadgeEl.innerHTML = '<span class="pulse-dot" style="display:inline-block; margin-right:6px;"></span> Memeriksa pesan Telegram (777000)...';
  if (historyList) historyList.innerHTML = '<div class="otp-empty-history">Memuat riwayat pesan Telegram...</div>';
  if (historyCount) historyCount.textContent = '0 pesan';
  if (copyBtnText) copyBtnText.textContent = 'Salin';

  if (modal) modal.style.display = 'flex';

  // Initial fetch
  fetchAccountOtp(accountId, false);

  // Start auto-refresh interval
  startOtpAutoRefresh();
};

window.closeOtpModal = function() {
  const modal = document.getElementById('otp-modal');
  if (modal) modal.style.display = 'none';
  currentOtpAccountId = null;
  currentExtractedOtp = null;
  stopOtpAutoRefresh();
};

function startOtpAutoRefresh() {
  stopOtpAutoRefresh();
  const chk = document.getElementById('otp-auto-refresh-chk');
  if (!chk || !chk.checked) return;

  otpPollingTimer = setInterval(() => {
    if (currentOtpAccountId) {
      fetchAccountOtp(currentOtpAccountId, true);
    }
  }, 4000);
}

function stopOtpAutoRefresh() {
  if (otpPollingTimer) {
    clearInterval(otpPollingTimer);
    otpPollingTimer = null;
  }
}

async function fetchAccountOtp(accountId, isAuto = false) {
  if (!accountId) return;

  const codeValEl = document.getElementById('otp-code-value');
  const timeBadgeEl = document.getElementById('otp-time-badge');
  const historyList = document.getElementById('otp-history-list');
  const historyCount = document.getElementById('otp-history-count');
  const refreshIcon = document.getElementById('refresh-otp-icon');

  if (!isAuto && refreshIcon) {
    refreshIcon.style.animation = 'spin 0.8s linear infinite';
  }

  try {
    const res = await fetch(`/api/accounts/${accountId}/otp`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (!isAuto && refreshIcon) {
      refreshIcon.style.animation = '';
    }

    if (res.ok && data.status === 'success') {
      currentExtractedOtp = data.latest_otp;

      if (data.latest_otp) {
        if (codeValEl) codeValEl.textContent = data.latest_otp;
        if (timeBadgeEl) {
          const dateStr = data.latest_otp_time ? new Date(data.latest_otp_time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Baru saja';
          timeBadgeEl.innerHTML = `<span style="color: var(--accent-green); font-weight: 600;">● Kode Masuk Ditemukan</span> &bull; Jam: ${dateStr}`;
        }
      } else {
        if (codeValEl) codeValEl.textContent = '------';
        if (timeBadgeEl) {
          timeBadgeEl.innerHTML = '<span style="color: var(--accent-amber); font-weight: 600;">○ Menunggu kode masuk...</span> (Kirim kode dari aplikasi Telegram)';
        }
      }

      // Render recent messages
      const msgs = data.messages || [];
      if (historyCount) historyCount.textContent = `${msgs.length} pesan`;

      if (historyList) {
        if (msgs.length === 0) {
          historyList.innerHTML = '<div class="otp-empty-history">Belum ada pesan masuk dari Telegram (777000).</div>';
        } else {
          historyList.innerHTML = msgs.map(m => {
            const timeFormatted = m.date ? new Date(m.date).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
            const cleanText = escapeHtml(m.text || '').replace(/\n/g, '<br>');
            return `
              <div class="otp-msg-card">
                <div class="otp-msg-header">
                  <span class="otp-msg-time">📅 ${timeFormatted}</span>
                  ${m.otp_code ? `<span class="otp-msg-code-badge" onclick="copySpecificOtp('${m.otp_code}')" title="Klik untuk salin kode">${m.otp_code} 📋</span>` : ''}
                </div>
                <div class="otp-msg-text">${cleanText}</div>
              </div>
            `;
          }).join('');
        }
      }
    } else {
      if (!isAuto) {
        showToast(data.detail || data.message || 'Gagal mengambil OTP', 'error');
        if (timeBadgeEl) timeBadgeEl.innerHTML = `<span style="color: var(--accent-rose);">Error: ${escapeHtml(data.detail || data.message || '')}</span>`;
      }
    }
  } catch (err) {
    if (!isAuto && refreshIcon) refreshIcon.style.animation = '';
    if (!isAuto) {
      showToast('Koneksi ke server terputus', 'error');
    }
  }
}

window.copySpecificOtp = function(code) {
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    showToast(`Kode OTP ${code} berhasil disalin!`, 'success');
    const copyBtnText = document.getElementById('copy-btn-text');
    if (copyBtnText) {
      copyBtnText.textContent = '✓ Disalin!';
      setTimeout(() => { copyBtnText.textContent = 'Salin'; }, 2000);
    }
  }).catch(() => {
    prompt('Salin kode OTP ini:', code);
  });
};

// Global exports for sidebar and inline event handlers
window.checkAccount2FA = checkAccount2FA;
window.checkAllAccounts2FA = checkAllAccounts2FA;
window.checkAccountHealth = checkAccountHealth;
window.checkAllAccountsHealth = checkAllAccountsHealth;
window.triggerExport = triggerExport;
window.loadAccounts = loadAccounts;

