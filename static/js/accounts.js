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
            ${acc.phone_number ? `
              <span class="phone-copy-badge" onclick="copyPhoneNumber('${escapeHtml(acc.phone_number)}', this)" title="Klik untuk salin ${escapeHtml(acc.phone_number)}">
                <span>${escapeHtml(acc.phone_number)}</span>
                <svg class="phone-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </span>
            ` : `<span>-</span>`}
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
  if (window.OperationManager) {
    window.OperationManager.setRunning('Cek Status @SpamBot Semua Akun', 'accounts-cancel-btn');
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
          } else if (r.status === 'cancelled') {
            badge.innerHTML = '<span style="color: var(--accent-amber);">⛔ Dibatalkan</span>';
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
    if (window.OperationManager) {
      window.OperationManager.setFinished('accounts-cancel-btn');
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
  if (acc.twofa_status === 'mismatch') {
    const hintStr = acc.twofa_hint ? ` | Hint: ${escapeHtml(acc.twofa_hint)}` : '';
    return `<span style="display: inline-flex; align-items: center; gap: 5px;">
      <span style="color: var(--accent-rose); font-weight: 600;" title="Password bukan 0707 atau 7${hintStr}">❌ Bukan 0707/7</span>
      <button class="btn-xs-reset" onclick="event.stopPropagation(); promptReset2FA(${acc.id}, '${escapeHtml(acc.phone_number || '')}')" title="Klik untuk mengajukan Reset 2FA">Reset</button>
    </span>`;
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

window.promptReset2FA = async function(accountId, phoneNumber) {
  const phoneLabel = phoneNumber ? ` (+${phoneNumber.replace(/^\+/, '')})` : '';
  if (!confirm(`⚠️ Konfirmasi Reset 2FA:\n\nApakah Anda yakin ingin mengajukan RESET kata sandi 2FA untuk akun ini${phoneLabel}?\n\nTelegram akan menerapkan masa tunggu (biasanya 7 hari) sebelum kata sandi 2FA dicopot.`)) {
    return;
  }

  showToast('Mengajukan reset 2FA ke Telegram...', 'info');
  try {
    const res = await fetch(`/api/accounts/${accountId}/reset-2fa`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(data.message || 'Reset 2FA berhasil diajukan', 'warning');
      const cardBadge = document.getElementById(`twofa-badge-${accountId}`);
      if (cardBadge) cardBadge.innerHTML = get2FaBadgeHtml(data);
      if (currentOtpAccountId === accountId) {
        renderOtpModal2fa(data);
      }
    } else {
      showToast(data.message || data.detail || 'Gagal mengajukan reset 2FA', 'error');
    }
  } catch (err) {
    showToast('Koneksi server gagal', 'error');
  }
};

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
  if (window.OperationManager) {
    window.OperationManager.setRunning('Cek Status 2FA Semua Akun', 'accounts-cancel-btn');
  }
  showToast('Memeriksa 2FA akun (mencocokkan 0707 / 7)...', 'info');

  try {
    const res = await fetch('/api/accounts/check-2fa-all', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (res.ok && data.results) {
      let countMatched = 0;
      let countReset = 0;
      let countMismatch = 0;
      let countNo2fa = 0;

      data.results.forEach(r => {
        const badge = document.getElementById(`twofa-badge-${r.account_id}`);
        if (badge) {
          if (r.status === 'success') {
            badge.innerHTML = get2FaBadgeHtml(r);
            if (r.twofa_password) countMatched++;
            else if (r.twofa_status === 'reset_pending') countReset++;
            else if (r.twofa_status === 'mismatch') countMismatch++;
            else if (!r.has_2fa) countNo2fa++;
          } else if (r.status === 'cancelled') {
            badge.innerHTML = '<span style="color: var(--accent-amber);">⛔ Dibatalkan</span>';
          } else {
            badge.innerHTML = '<span style="color: var(--accent-rose);" title="' + escapeHtml(r.message || 'Gagal cek') + '">⚠️ Gagal</span>';
          }
        }
      });
      showToast(`Pengecekan selesai (${data.results.length} akun): ${countMatched} cocok, ${countMismatch} bukan 0707/7, ${countReset} reset 7 hari, ${countNo2fa} tanpa 2FA`, 'success');
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
    if (window.OperationManager) {
      window.OperationManager.setFinished('accounts-cancel-btn');
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
    refreshBtn.addEventListener('click', async () => {
      const originalHtml = refreshBtn.innerHTML;
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = `
        <div class="spinner" style="width: 13px; height: 13px; border-width: 2px; display: inline-block;"></div>
        <span class="btn-text-desktop">Memeriksa...</span>
      `;
      showToast('Memeriksa status sesi & kesehatan seluruh akun...', 'info');

      try {
        const res = await fetch('/api/accounts/refresh-and-clean', {
          method: 'POST',
          headers: getAuthHeaders()
        });
        const data = await res.json();

        if (res.ok) {
          if (data.deleted_count > 0) {
            showToast(`Refresh selesai: ${data.online_count} akun online, ${data.deleted_count} akun keluar sesi/offline telah dihapus!`, 'warning');
          } else {
            showToast(`Refresh selesai: Seluruh ${data.online_count} akun online aktif!`, 'success');
          }
        } else {
          showToast(data.detail || 'Gagal merefresh akun', 'error');
        }
      } catch (e) {
        showToast('Koneksi server gagal saat refresh', 'error');
      } finally {
        await loadAccounts();
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = originalHtml;
      }
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

  const copy2faBtn = document.getElementById('copy-2fa-btn');
  if (copy2faBtn) {
    copy2faBtn.addEventListener('click', () => {
      if (currentExtracted2faPass) {
        navigator.clipboard.writeText(currentExtracted2faPass).then(() => {
          showToast(`Sandi 2FA "${currentExtracted2faPass}" berhasil disalin!`, 'success');
          const btnTxt = document.getElementById('copy-2fa-btn-text');
          if (btnTxt) {
            btnTxt.textContent = '✓ Disalin!';
            setTimeout(() => { btnTxt.textContent = 'Salin 2FA'; }, 2000);
          }
        }).catch(() => {
          prompt('Salin sandi 2FA ini:', currentExtracted2faPass);
        });
      }
    });
  }

  const reset2faInlineBtn = document.getElementById('otp-reset-2fa-inline-btn');
  if (reset2faInlineBtn) {
    reset2faInlineBtn.addEventListener('click', () => {
      if (!currentOtpAccountId) return;
      promptReset2FA(currentOtpAccountId, currentOtpPhone);
    });
  }

  const check2faInlineBtn = document.getElementById('otp-check-2fa-inline-btn');
  if (check2faInlineBtn) {
    check2faInlineBtn.addEventListener('click', async () => {
      if (!currentOtpAccountId) return;
      const displayEl = document.getElementById('otp-2fa-badge-display');
      const subtextEl = document.getElementById('otp-2fa-subtext');
      const copyBtn = document.getElementById('copy-2fa-btn');
      const resetBtn = document.getElementById('otp-reset-2fa-inline-btn');
      if (resetBtn) resetBtn.style.display = 'none';
      if (displayEl) displayEl.innerHTML = '<div class="spinner" style="width:12px;height:12px;display:inline-block;"></div> Memeriksa 2FA...';
      try {
        const res = await fetch(`/api/accounts/${currentOtpAccountId}/check-2fa`, {
          method: 'POST',
          headers: getAuthHeaders()
        });
        const data = await res.json();
        renderOtpModal2fa(data);
        showToast(data.message || 'Pemeriksaan 2FA selesai', data.twofa_password ? 'success' : (data.twofa_status === 'reset_pending' ? 'warning' : 'info'));
        // Also refresh the card badge in the background
        const cardBadge = document.getElementById(`twofa-badge-${currentOtpAccountId}`);
        if (cardBadge) cardBadge.innerHTML = get2FaBadgeHtml(data);
      } catch (err) {
        if (displayEl) displayEl.innerHTML = '<span style="color: var(--accent-rose);">⚠️ Gagal Cek</span>';
        showToast('Koneksi server gagal', 'error');
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
let currentOtpPhone = null;
let otpPollingTimer = null;
let currentExtractedOtp = null;
let currentExtracted2faPass = null;

function renderOtpModal2fa(twofa) {
  const displayEl = document.getElementById('otp-2fa-badge-display');
  const subtextEl = document.getElementById('otp-2fa-subtext');
  const copyBtn = document.getElementById('copy-2fa-btn');
  const resetBtn = document.getElementById('otp-reset-2fa-inline-btn');
  if (!displayEl) return;

  if (resetBtn) resetBtn.style.display = 'none';

  if (!twofa) {
    displayEl.innerHTML = '<span style="color: var(--text-muted);">Memeriksa 2FA...</span>';
    if (subtextEl) subtextEl.textContent = '';
    if (copyBtn) copyBtn.style.display = 'none';
    currentExtracted2faPass = null;
    return;
  }

  if (twofa.twofa_password) {
    currentExtracted2faPass = twofa.twofa_password;
    const hintText = twofa.twofa_hint ? ` (Hint: ${escapeHtml(twofa.twofa_hint)})` : '';
    displayEl.innerHTML = `<span style="color: var(--accent-green); font-weight: 700; font-size: 1.1rem; letter-spacing: 2px;">🔒 Sandi: "${escapeHtml(twofa.twofa_password)}"</span>${hintText ? `<span style="font-size:0.8rem; color:var(--text-muted); margin-left:8px;">${hintText}</span>` : ''}`;
    if (copyBtn) {
      copyBtn.style.display = 'inline-flex';
      const btnTxt = document.getElementById('copy-2fa-btn-text');
      if (btnTxt) btnTxt.textContent = `Salin (${twofa.twofa_password})`;
    }
    if (subtextEl) {
      subtextEl.innerHTML = '<span style="color: var(--accent-green);">✓ Kata sandi 2FA telah terkonfirmasi cocok. Langsung masukkan sandi ini jika Telegram meminta password setelah kode OTP.</span>';
    }
  } else if (twofa.twofa_status === 'reset_pending' || twofa.twofa_reset_until) {
    currentExtracted2faPass = null;
    if (copyBtn) copyBtn.style.display = 'none';
    const until = twofa.twofa_reset_until || '7 hari';
    displayEl.innerHTML = `<span style="color: var(--accent-amber); font-weight: 600;">⏳ Sedang Proses Reset (7 Hari)</span>`;
    if (subtextEl) {
      subtextEl.innerHTML = `<span style="color: var(--accent-amber);">⚠️ Password bukan 0707 atau 7. Reset telah diajukan ke Telegram, proses reset selesai pada: <strong>${escapeHtml(until)}</strong>.</span>`;
    }
  } else if (twofa.twofa_status === 'mismatch') {
    currentExtracted2faPass = null;
    if (copyBtn) copyBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'inline-flex';
    const hintText = twofa.twofa_hint ? ` (Hint: ${escapeHtml(twofa.twofa_hint)})` : '';
    displayEl.innerHTML = `<span style="color: var(--accent-rose); font-weight: 700; font-size: 1.05rem;">❌ Sandi Bukan 0707 atau 7</span>${hintText ? `<span style="font-size:0.8rem; color:var(--text-muted); margin-left:8px;">${hintText}</span>` : ''}`;
    if (subtextEl) {
      subtextEl.innerHTML = '<span style="color: var(--accent-rose);">⚠️ Sandi akun ini bukan 0707 atau 7. <strong>Kata sandi belum di-reset</strong>. Klik tombol <strong>⚠️ Reset 2FA (7 Hari)</strong> di atas jika ingin mengajukan permohonan reset ke Telegram.</span>';
    }
  } else if (twofa.has_2fa === false || twofa.twofa_status === 'no_2fa') {
    currentExtracted2faPass = null;
    if (copyBtn) copyBtn.style.display = 'none';
    displayEl.innerHTML = `<span style="color: var(--text-muted); font-weight: 600;">🔓 Akun Tidak Menggunakan 2FA</span>`;
    if (subtextEl) {
      subtextEl.innerHTML = '<span>Akun ini bebas kata sandi cloud (hanya memerlukan kode OTP untuk login).</span>';
    }
  } else if (twofa.has_2fa === true) {
    currentExtracted2faPass = null;
    if (copyBtn) copyBtn.style.display = 'none';
    displayEl.innerHTML = `<span style="color: var(--accent-amber); font-weight: 600;">🔒 2FA Aktif (Sandi Belum Dicek)</span>`;
    if (subtextEl) {
      subtextEl.innerHTML = '<span>Klik tombol <strong>🔄 Cek 2FA</strong> di samping untuk mencocokkan sandi 0707/7 secara otomatis.</span>';
    }
  } else {
    currentExtracted2faPass = null;
    if (copyBtn) copyBtn.style.display = 'none';
    displayEl.innerHTML = `<span style="color: var(--text-muted);">Status 2FA belum dicek</span>`;
    if (subtextEl) {
      subtextEl.innerHTML = '<span>Klik <strong>🔄 Cek 2FA</strong> untuk memverifikasi proteksi akun.</span>';
    }
  }
}

window.openOtpModal = function(accountId, displayName, phoneNumber) {
  currentOtpAccountId = accountId;
  currentOtpPhone = phoneNumber;
  currentExtractedOtp = null;
  currentExtracted2faPass = null;

  const modal = document.getElementById('otp-modal');
  const titleEl = document.getElementById('otp-modal-account-title');
  const phoneEl = document.getElementById('otp-modal-account-phone');
  const codeValEl = document.getElementById('otp-code-value');
  const timeBadgeEl = document.getElementById('otp-time-badge');
  const historyList = document.getElementById('otp-history-list');
  const historyCount = document.getElementById('otp-history-count');
  const copyBtnText = document.getElementById('copy-btn-text');

  if (titleEl) titleEl.textContent = displayName || `Akun #${accountId}`;
  if (phoneEl) {
    if (phoneNumber && phoneNumber !== '-') {
      phoneEl.innerHTML = `Nomor HP: <span class="phone-copy-badge" onclick="copyPhoneNumber('${escapeHtml(phoneNumber)}', this)" title="Klik untuk salin ${escapeHtml(phoneNumber)}" style="display:inline-flex; vertical-align:middle; cursor:pointer;"><span>${escapeHtml(phoneNumber)}</span> <svg class="phone-copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></span>`;
    } else {
      phoneEl.textContent = 'Nomor HP: -';
    }
  }
  if (codeValEl) codeValEl.textContent = '------';
  if (timeBadgeEl) timeBadgeEl.innerHTML = '<span class="pulse-dot" style="display:inline-block; margin-right:6px;"></span> Memeriksa pesan Telegram (777000)...';
  if (historyList) historyList.innerHTML = '<div class="otp-empty-history">Memuat riwayat pesan Telegram...</div>';
  if (historyCount) historyCount.textContent = '0 pesan';
  if (copyBtnText) copyBtnText.textContent = 'Salin';

  renderOtpModal2fa(null);

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
  currentExtracted2faPass = null;
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

      // Render 2FA status inside modal
      if (data.twofa) {
        renderOtpModal2fa(data.twofa);
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

window.copyPhoneNumber = function(phone, element) {
  if (!phone || phone === '-' || phone === 'Tanpa no.') return;
  const cleanPhone = phone.trim();

  const handleSuccess = () => {
    showToast(`Nomor ${cleanPhone} disalin ke clipboard!`, 'success');
    if (element) {
      element.classList.add('phone-copied-toast');
      const originalHtml = element.innerHTML;
      element.innerHTML = `
        <span>${escapeHtml(cleanPhone)}</span>
        <svg class="phone-copy-icon" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
      setTimeout(() => {
        element.classList.remove('phone-copied-toast');
        element.innerHTML = originalHtml;
      }, 1200);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cleanPhone).then(handleSuccess).catch(() => {
      fallbackCopyPhone(cleanPhone, handleSuccess);
    });
  } else {
    fallbackCopyPhone(cleanPhone, handleSuccess);
  }
};

function fallbackCopyPhone(text, onSuccess) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    if (onSuccess) onSuccess();
  } catch (e) {
    prompt('Salin nomor HP:', text);
  }
  document.body.removeChild(ta);
}

// Global exports for sidebar and inline event handlers
window.checkAccount2FA = checkAccount2FA;
window.checkAllAccounts2FA = checkAllAccounts2FA;
window.checkAccountHealth = checkAccountHealth;
window.checkAllAccountsHealth = checkAllAccountsHealth;
window.triggerExport = triggerExport;
window.loadAccounts = loadAccounts;

