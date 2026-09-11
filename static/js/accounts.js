// Account pagination and filtering state
let accountPagination = {
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 1,
  search: '',
  status: 'all'
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
    if (accountPagination.search || accountPagination.status !== 'all') {
      container.innerHTML = `
        <div class="empty-state glass-panel" style="grid-column: 1 / -1;">
          <h3>Tidak Ada Akun yang Cocok</h3>
          <p>Coba kata kunci pencarian lain atau ubah filter status.</p>
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
        </div>

        <div class="account-details">
          <div class="detail-row">
            <span>Nomor HP</span>
            <span>${acc.phone_number || '-'}</span>
          </div>
          <div class="detail-row">
            <span>Telegram ID</span>
            <span>${acc.telegram_id || '-'}</span>
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
        </div>

        <div class="account-actions">
          <button class="btn btn-secondary btn-sm" onclick="checkAccountHealth(${acc.id})" title="Cek status @SpamBot">
            🛡️
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
          <button class="btn btn-danger btn-sm" onclick="deleteAccount(${acc.id}, '${acc.display_name || acc.phone_number}')" title="Hapus Akun">
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

  const statusFilter = document.getElementById('account-status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      accountPagination.status = e.target.value;
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

  loadAccounts();
});
