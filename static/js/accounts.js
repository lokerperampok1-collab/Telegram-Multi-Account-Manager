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
            <span>Status Sesi</span>
            <span style="color: ${isOnline ? 'var(--accent-green)' : 'var(--text-muted)'};">
              ${isOnline ? '● Terhubung' : '○ Offline'}
            </span>
          </div>
          <div class="detail-row">
            <span>Status 2FA</span>
            <span id="twofa-badge-${acc.id}" style="cursor: pointer;" onclick="checkAccount2FA(${acc.id})" title="Klik untuk cek status 2FA">
              ${get2FaBadgeHtml(acc)}
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
          <button class="btn btn-secondary btn-sm otp-action-btn" onclick="openOtpModal(${acc.id}, '${escapeHtml(acc.display_name || 'Akun #' + acc.id)}', '${escapeHtml(acc.phone_number || '-')}')" title="Ambil kode masuk / OTP Telegram">
            🔑 Ambil OTP
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openSingleProfileModal(${acc.id}, '${escapeHtml(acc.display_name || '')}')" title="Ubah Nama & Foto Profil Akun Ini" style="padding: 6px 10px; font-size: 0.8rem;">
            👤 Profil
          </button>
          ${isOnline ? `
            <button class="btn btn-secondary btn-sm" onclick="disconnectAccount(${acc.id})" title="Putuskan koneksi akun sementara" style="padding: 6px 10px; font-size: 0.8rem;">
              Putuskan
            </button>
          ` : `
            <button class="btn btn-primary btn-sm" onclick="connectAccount(${acc.id})" title="Hubungkan kembali akun ini" style="padding: 6px 10px; font-size: 0.8rem;">
              Hubungkan
            </button>
          `}
          <button class="btn btn-danger btn-sm" onclick="deleteAccount(${acc.id}, '${escapeHtml(acc.display_name || acc.phone_number || '')}')" title="Hapus Akun dari Dashboard" style="padding: 6px 9px;">
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
    if (data.account_deleted || data.session_revoked) {
      showToast(`⚠️ ${data.message || 'Sesi akun mati/ter-revoke dan telah otomatis dihapus dari dashboard.'}`, 'warning');
      const card = document.getElementById(`account-card-${accountId}`);
      if (card) card.remove();
      loadAccounts();
      return;
    }
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

    if (data.account_deleted || data.session_revoked) {
      showToast(`⚠️ ${data.message || 'Sesi akun mati/ter-revoke dan telah otomatis dihapus dari dashboard.'}`, 'warning');
      const card = document.getElementById(`account-card-${accountId}`);
      if (card) card.remove();
      loadAccounts();
      return;
    }

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

async function connectAllOfflineAccounts() {
  const btn = document.getElementById('connect-all-offline-btn');
  const sideBtn = document.getElementById('sidebar-connect-offline-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Menghubungkan...';
  }
  if (sideBtn) sideBtn.disabled = true;

  if (window.OperationManager) {
    window.OperationManager.setRunning('Menghubungkan Semua Akun Offline', 'accounts-cancel-btn');
  }
  showToast('Menghubungkan semua akun yang offline...', 'info');

  try {
    const res = await fetch('/api/accounts/connect-offline', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (res.ok && data.status === 'success') {
      if (data.total_offline === 0) {
        showToast('Semua akun sudah online / tidak ada akun offline.', 'info');
      } else {
        const msg = `Selesai: ${data.connected_count} dari ${data.total_offline} akun berhasil dihubungkan!` +
          (data.failed_count > 0 ? ` (${data.failed_count} akun sesi mati / revoked)` : '');
        showToast(msg, data.connected_count > 0 ? 'success' : 'warning');
      }
      await loadAccounts();
    } else {
      showToast(data.message || data.detail || 'Gagal menghubungkan akun offline', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '⚡ Hubungkan Offline';
    }
    if (sideBtn) sideBtn.disabled = false;
    if (window.OperationManager) {
      window.OperationManager.setFinished('accounts-cancel-btn');
    }
  }
}

async function cleanDeadSessions() {
  const proceed = confirm(
    "🧹 KONFIRMASI BERSIHKAN SESI MATI:\n\n" +
    "Sistem akan memindai status seluruh akun Telegram Anda.\n" +
    "Setiap akun yang sesinya terdeteksi MATI / TER-REVOKE oleh Telegram akan OTOMATIS DIHAPUS dari database dan dashboard.\n\n" +
    "Lanjutkan pembersihan sesi mati?"
  );
  if (!proceed) return;

  const btn = document.getElementById('clean-dead-sessions-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:12px;height:12px;display:inline-block;margin-right:6px;"></div> Memindai sesi...';
  }
  showToast('Memeriksa status semua sesi akun untuk mencari sesi mati...', 'info');

  try {
    const res = await fetch('/api/accounts/clean-dead-sessions', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      if (data.deleted_count > 0) {
        showToast(`✓ Sukses! ${data.deleted_count} akun mati/ter-revoke berhasil dihapus dari dashboard.`, 'success');
      } else {
        showToast('✓ Tidak ada akun mati yang ditemukan. Seluruh akun masih sehat/aktif!', 'success');
      }
      loadAccounts();
      if (window.loadSessionManagerAccounts) loadSessionManagerAccounts();
    } else {
      showToast(data.detail || data.message || 'Gagal membersihkan sesi mati', 'error');
    }
  } catch (err) {
    showToast('Koneksi server gagal', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🧹 Bersihkan Sesi Mati';
    }
  }
}
window.cleanDeadSessions = cleanDeadSessions;

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
    return `<span style="color: var(--accent-amber); font-weight: 600;" title="Menunggu reset 2FA sampai: ${escapeHtml(until)}">⏳ Reset (7 Hari)</span>`;
  }
  if (acc.twofa_status === 'mismatch') {
    const hintStr = acc.twofa_hint ? ` | Hint: ${escapeHtml(acc.twofa_hint)}` : '';
    return `<span style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
      <span style="color: var(--accent-amber); font-weight: 600;" title="2FA aktif namun sandi belum tersimpan${hintStr}">🔒 Sandi Belum Tersimpan</span>
      <button class="btn-xs-reset" style="background: rgba(0, 212, 255, 0.15); color: var(--accent-cyan); border-color: rgba(0, 212, 255, 0.35);" onclick="event.stopPropagation(); promptVerifyCustom2FA(${acc.id})" title="Klik untuk memasukkan & menyimpan sandi 2FA akun ini">🔑 Isi Sandi</button>
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

window.promptVerifyCustom2FA = async function(accountId) {
  const pwd = prompt('Masukkan kata sandi 2FA akun ini untuk diverifikasi dan disimpan:');
  if (!pwd || !pwd.trim()) return;

  const badge = document.getElementById(`twofa-badge-${accountId}`);
  if (badge) {
    badge.innerHTML = '<div class="spinner" style="width: 12px; height: 12px; display: inline-block;"></div> Memverifikasi...';
  }

  try {
    const res = await fetch(`/api/accounts/${accountId}/check-2fa`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ password: pwd.trim() })
    });
    const data = await res.json();

    if (badge) {
      badge.innerHTML = get2FaBadgeHtml(data);
    }
    if (currentOtpAccountId === accountId) {
      renderOtpModal2fa(data);
    }

    if (data.status === 'success' && data.twofa_password) {
      showToast(`Sandi 2FA cocok & tersimpan: "${data.twofa_password}"`, 'success');
    } else {
      showToast(data.message || 'Sandi 2FA tidak cocok dengan akun ini', 'warning');
    }
  } catch (err) {
    showToast('Koneksi server gagal', 'error');
  }
};

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

    if (data.account_deleted || data.session_revoked) {
      showToast(`⚠️ ${data.message || 'Sesi akun mati/ter-revoke dan telah otomatis dihapus dari dashboard.'}`, 'warning');
      const card = document.getElementById(`account-card-${accountId}`);
      if (card) card.remove();
      loadAccounts();
      return;
    }

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

let cachedExportAccounts = [];
let selectedExportAccountIds = new Set();

function updateExportFormatUI() {
  const nicegramRadio = document.getElementById('export-format-nicegram');
  const zipRadio = document.getElementById('export-format-zip');
  const txtRadio = document.getElementById('export-format-txt');
  const jsonRadio = document.getElementById('export-format-json');
  const nicegramLabel = document.getElementById('export-fmt-nicegram-label');
  const zipLabel = document.getElementById('export-fmt-zip-label');
  const txtLabel = document.getElementById('export-fmt-txt-label');
  const jsonLabel = document.getElementById('export-fmt-json-label');
  const copyBtn = document.getElementById('export-copy-clipboard-btn');

  const isNicegram = nicegramRadio && nicegramRadio.checked;
  const isZip = zipRadio && zipRadio.checked;
  const isTxt = txtRadio && txtRadio.checked;
  const isJson = jsonRadio && jsonRadio.checked;

  if (nicegramLabel) {
    nicegramLabel.style.border = isNicegram ? '2px solid var(--accent-cyan)' : '1px solid var(--border-color)';
    nicegramLabel.style.background = isNicegram ? 'rgba(0, 212, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)';
  }
  if (zipLabel) {
    zipLabel.style.border = isZip ? '2px solid var(--accent-cyan)' : '1px solid var(--border-color)';
    zipLabel.style.background = isZip ? 'rgba(0, 212, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)';
  }
  if (txtLabel) {
    txtLabel.style.border = isTxt ? '2px solid var(--accent-cyan)' : '1px solid var(--border-color)';
    txtLabel.style.background = isTxt ? 'rgba(0, 212, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)';
  }
  if (jsonLabel) {
    jsonLabel.style.border = isJson ? '2px solid var(--accent-cyan)' : '1px solid var(--border-color)';
    jsonLabel.style.background = isJson ? 'rgba(0, 212, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)';
  }

  if (copyBtn) {
    if (isZip || isNicegram) {
      copyBtn.style.display = 'none';
    } else {
      copyBtn.style.display = 'inline-flex';
      copyBtn.innerHTML = isTxt ? '<span>📋 Salin String ke Clipboard</span>' : '<span>📋 Salin JSON ke Clipboard</span>';
    }
  }
}

function updateExportCountBadge() {
  const countEl = document.getElementById('export-selected-count');
  if (countEl) {
    countEl.textContent = `${selectedExportAccountIds.size} dari ${cachedExportAccounts.length} akun dipilih`;
  }
}

let exportChecklistCtrl = null;

function initExportChecklist() {
  if (exportChecklistCtrl || !window.setupUniversalChecklist) return;
  exportChecklistCtrl = window.setupUniversalChecklist({
    prefix: 'export',
    itemsContainerId: 'export-account-items',
    checkboxClass: 'export-acc-checkbox',
    cachedAccountsGetter: () => cachedExportAccounts,
    selectedIdsSet: selectedExportAccountIds,
    extraBadgesRenderer: (acc) => {
      return acc.twofa_password 
        ? `<span style="color: var(--accent-green); font-size: 0.72rem;">[2FA: ${escapeHtml(acc.twofa_password)}]</span>` 
        : '';
    },
    onSelectionChanged: updateExportCountBadge
  });
}

function renderExportChecklist(accounts) {
  initExportChecklist();
  if (exportChecklistCtrl) {
    exportChecklistCtrl.render();
    return;
  }
  const container = document.getElementById('export-account-items');
  if (!container) return;

  if (!accounts || accounts.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 6px;">Tidak ada akun yang cocok</div>';
    updateExportCountBadge();
    return;
  }

  container.innerHTML = accounts.map(acc => {
    const name = acc.display_name || acc.username || acc.phone_number || `Akun #${acc.id}`;
    const isOnline = acc.is_active;
    const isChecked = selectedExportAccountIds.has(acc.id);
    const tgIdBadge = acc.telegram_id ? `<span style="color: var(--accent-cyan); font-size: 0.72rem;">[ID: ${acc.telegram_id}]</span>` : '';
    const twofaBadge = acc.twofa_password
      ? `<span style="color: var(--accent-green); font-size: 0.72rem;">[2FA: ${escapeHtml(acc.twofa_password)}]</span>`
      : '';

    return `
      <label style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; padding: 5px 6px; margin-bottom: 3px; border-radius: 6px; cursor: pointer; background: rgba(255,255,255,0.02);">
        <input type="checkbox" class="export-acc-checkbox" value="${acc.id}" ${isChecked ? 'checked' : ''} onchange="toggleExportAccountSelection(${acc.id}, this.checked)">
        <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>${escapeHtml(name)}</strong> (${escapeHtml(acc.phone_number || '-')}) ${tgIdBadge} ${twofaBadge}
        </span>
        ${isOnline ? '<span style="color: var(--accent-green); font-size: 0.75rem;">● Online</span>' : '<span style="color: var(--text-muted); font-size: 0.75rem;">○ Offline</span>'}
      </label>
    `;
  }).join('');

  updateExportCountBadge();
}

window.toggleExportAccountSelection = function(accId, checked) {
  if (checked) {
    selectedExportAccountIds.add(accId);
  } else {
    selectedExportAccountIds.delete(accId);
  }
  updateExportCountBadge();
};

window.openExportModal = async function(defaultFormat = 'zip') {
  const modal = document.getElementById('export-modal');
  const nicegramRadio = document.getElementById('export-format-nicegram');
  const zipRadio = document.getElementById('export-format-zip');
  const txtRadio = document.getElementById('export-format-txt');
  const jsonRadio = document.getElementById('export-format-json');
  const searchInput = document.getElementById('export-search-accounts');
  const container = document.getElementById('export-account-items');

  if (defaultFormat === 'nicegram' && nicegramRadio) {
    nicegramRadio.checked = true;
  } else if (defaultFormat === 'json' && jsonRadio) {
    jsonRadio.checked = true;
  } else if (defaultFormat === 'txt' && txtRadio) {
    txtRadio.checked = true;
  } else if (defaultFormat === 'zip' && zipRadio) {
    zipRadio.checked = true;
  } else if (nicegramRadio) {
    nicegramRadio.checked = true;
  }
  updateExportFormatUI();

  if (searchInput) searchInput.value = '';
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  if (container) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 8px;"><div class="spinner" style="width:14px;height:14px;display:inline-block;"></div> Memuat daftar akun...</div>';
  }

  try {
    const res = await fetch('/api/accounts?limit=0', { headers: getAuthHeaders() });
    const data = await res.json();
    cachedExportAccounts = data.accounts || [];
    // Default: pilih semua akun terlebih dahulu agar praktis, user tinggal uncheck atau klik Batal Semua lalu centang akun tertentu
    selectedExportAccountIds = new Set(cachedExportAccounts.map(a => a.id));
    renderExportChecklist(cachedExportAccounts);
  } catch (e) {
    if (container) {
      container.innerHTML = '<div style="color: var(--accent-rose); font-size: 0.82rem; padding: 8px;">Gagal memuat daftar akun</div>';
    }
  }
};

window.closeExportModal = function() {
  const modal = document.getElementById('export-modal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
};

async function triggerExport(format) {
  window.openExportModal(format || 'txt');
}
window.triggerExport = triggerExport;

async function executeExportAction(actionType = 'download') {
  if (selectedExportAccountIds.size === 0) {
    showToast('Pilih minimal 1 akun yang ingin di-export', 'warning');
    return;
  }

  const nicegramRadio = document.getElementById('export-format-nicegram');
  const zipRadio = document.getElementById('export-format-zip');
  const txtRadio = document.getElementById('export-format-txt');
  const jsonRadio = document.getElementById('export-format-json');
  let format = 'nicegram';
  if (nicegramRadio && nicegramRadio.checked) format = 'nicegram';
  else if (zipRadio && zipRadio.checked) format = 'zip';
  else if (txtRadio && txtRadio.checked) format = 'txt';
  else if (jsonRadio && jsonRadio.checked) format = 'json';

  const accountIds = Array.from(selectedExportAccountIds);

  const downloadBtn = document.getElementById('export-download-submit-btn');
  const copyBtn = document.getElementById('export-copy-clipboard-btn');
  if (downloadBtn) downloadBtn.disabled = true;
  if (copyBtn) copyBtn.disabled = true;

  try {
    if (actionType === 'copy' && (format === 'zip' || format === 'nicegram')) {
      showToast('Format arsip ZIP adalah file biner, gunakan tombol Download File Export', 'warning');
      return;
    }
    const res = await fetch(`/api/accounts/export/${format}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ account_ids: accountIds })
    });

    if (!res.ok) {
      showToast('Gagal mengekspor sesi akun', 'error');
      return;
    }

    if (actionType === 'copy') {
      const textContent = await res.text();
      if (!textContent || !textContent.trim()) {
        showToast('Tidak ada data sesi untuk disalin', 'warning');
        return;
      }
      await navigator.clipboard.writeText(textContent);
      showToast(`Berhasil menyalin ${accountIds.length} sesi (${format.toUpperCase()}) ke clipboard!`, 'success');
    } else {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      if (format === 'nicegram') {
        a.download = `Nicegram Exported Accounts (${accountIds.length} akun).zip`;
      } else {
        a.download = `telegram_sessions_${accountIds.length}_akun.${format}`;
      }
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      const formatLabel = format === 'nicegram' ? 'Nicegram ZIP' : `.${format}`;
      showToast(`File export ${accountIds.length} akun (${formatLabel}) berhasil diunduh!`, 'success');
      window.closeExportModal();
    }
  } catch (e) {
    showToast('Gagal mengekspor session', 'error');
  } finally {
    if (downloadBtn) downloadBtn.disabled = false;
    if (copyBtn) copyBtn.disabled = false;
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
          const offlineMsg = (data.offline_count !== undefined && data.offline_count > 0) ? `, ${data.offline_count} offline/nonaktif` : '';
          showToast(`Refresh selesai: ${data.online_count || 0} akun online${offlineMsg}. (Tidak ada akun yang dihapus)`, 'success');
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

  const connectAllOfflineBtn = document.getElementById('connect-all-offline-btn');
  if (connectAllOfflineBtn) {
    connectAllOfflineBtn.addEventListener('click', connectAllOfflineAccounts);
  }

  const cleanDeadSessionsBtn = document.getElementById('clean-dead-sessions-btn');
  if (cleanDeadSessionsBtn) {
    cleanDeadSessionsBtn.addEventListener('click', cleanDeadSessions);
  }

  const checkAllBtn = document.getElementById('check-all-health-btn');
  if (checkAllBtn) {
    checkAllBtn.addEventListener('click', checkAllAccountsHealth);
  }

  const checkAll2faBtn = document.getElementById('check-all-2fa-btn');
  if (checkAll2faBtn) {
    checkAll2faBtn.addEventListener('click', checkAllAccounts2FA);
  }

  const gotoProfileBtn = document.getElementById('goto-profile-btn');
  if (gotoProfileBtn) {
    gotoProfileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const navProfile = document.getElementById('nav-btn-profile');
      if (navProfile) navProfile.click();
    });
  }

  // Export dropdown handlers
  const exportMenuBtn = document.getElementById('export-menu-btn');
  const exportDropdown = document.getElementById('export-dropdown-menu');
  const exportNicegramBtn = document.getElementById('export-nicegram-btn');
  const exportZipBtn = document.getElementById('export-zip-btn');
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

  if (exportNicegramBtn) {
    exportNicegramBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerExport('nicegram');
    });
  }

  if (exportZipBtn) {
    exportZipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      triggerExport('zip');
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

  // Export Modal controls
  const exportModal = document.getElementById('export-modal');
  const exportModalClose = document.getElementById('export-modal-close');
  const exportFormatNicegram = document.getElementById('export-format-nicegram');
  const exportFormatZip = document.getElementById('export-format-zip');
  const exportFormatTxt = document.getElementById('export-format-txt');
  const exportFormatJson = document.getElementById('export-format-json');
  const exportSelectAll = document.getElementById('export-select-all');
  const exportSelectNone = document.getElementById('export-select-none');
  const exportSelectOnline = document.getElementById('export-select-online');
  const exportSearchInput = document.getElementById('export-search-accounts');
  const exportDownloadBtn = document.getElementById('export-download-submit-btn');
  const exportCopyBtn = document.getElementById('export-copy-clipboard-btn');

  if (exportModalClose) {
    exportModalClose.addEventListener('click', window.closeExportModal);
  }
  if (exportModal) {
    exportModal.addEventListener('click', (e) => {
      if (e.target === exportModal) window.closeExportModal();
    });
  }
  if (exportFormatNicegram) {
    exportFormatNicegram.addEventListener('change', updateExportFormatUI);
  }
  if (exportFormatZip) {
    exportFormatZip.addEventListener('change', updateExportFormatUI);
  }
  if (exportFormatTxt) {
    exportFormatTxt.addEventListener('change', updateExportFormatUI);
  }
  if (exportFormatJson) {
    exportFormatJson.addEventListener('change', updateExportFormatUI);
  }

  initExportChecklist();
  if (exportDownloadBtn) {
    exportDownloadBtn.addEventListener('click', () => executeExportAction('download'));
  }
  if (exportCopyBtn) {
    exportCopyBtn.addEventListener('click', () => executeExportAction('copy'));
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

  async function setSingleAccount2FAFromOtpModal(newPass) {
    if (!currentOtpAccountId) return;
    if (!confirm(`Ganti / pasang sandi 2FA akun ini menjadi "${newPass}"?`)) return;

    const displayEl = document.getElementById('otp-2fa-badge-display');
    const resetBtn = document.getElementById('otp-reset-2fa-inline-btn');
    if (resetBtn) resetBtn.style.display = 'none';
    if (displayEl) displayEl.innerHTML = `<div class="spinner" style="width:12px;height:12px;display:inline-block;"></div> Mengatur 2FA ke "${escapeHtml(newPass)}"...`;

    try {
      const res = await fetch(`/api/accounts/${currentOtpAccountId}/change-2fa`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ new_password: newPass })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        renderOtpModal2fa(data);
        showToast(data.message || `2FA berhasil diatur ke "${newPass}"`, 'success');
        const cardBadge = document.getElementById(`twofa-badge-${currentOtpAccountId}`);
        if (cardBadge) cardBadge.innerHTML = get2FaBadgeHtml(data);
      } else {
        const errMsg = data.detail || data.message || 'Gagal mengganti 2FA';
        if (displayEl) displayEl.innerHTML = `<span style="color: var(--accent-rose);">⚠️ ${escapeHtml(errMsg)}</span>`;
        showToast(errMsg, 'error');
      }
    } catch (err) {
      if (displayEl) displayEl.innerHTML = '<span style="color: var(--accent-rose);">⚠️ Gagal Koneksi</span>';
      showToast('Koneksi server gagal', 'error');
    }
  }

  const otpSet0707Btn = document.getElementById('otp-set-2fa-0707-btn');
  if (otpSet0707Btn) {
    otpSet0707Btn.addEventListener('click', () => setSingleAccount2FAFromOtpModal('0707'));
  }

  const otpSet26Btn = document.getElementById('otp-set-2fa-26-btn');
  if (otpSet26Btn) {
    otpSet26Btn.addEventListener('click', () => setSingleAccount2FAFromOtpModal('26'));
  }

  const otpVerifyCustomBtn = document.getElementById('otp-verify-custom-2fa-btn');
  if (otpVerifyCustomBtn) {
    otpVerifyCustomBtn.addEventListener('click', () => {
      if (currentOtpAccountId) window.promptVerifyCustom2FA(currentOtpAccountId);
    });
  }

  const checkDevicesFromOtpBtn = document.getElementById('otp-check-devices-btn');
  if (checkDevicesFromOtpBtn) {
    checkDevicesFromOtpBtn.addEventListener('click', () => {
      if (!currentOtpAccountId) return;
      const accName = document.getElementById('otp-modal-account-title')?.textContent || 'Akun';
      openDevicesModal(currentOtpAccountId, accName, currentOtpPhone || '-');
    });
  }

  // Devices modal close buttons
  const devicesModal = document.getElementById('devices-modal');
  const devicesModalClose = document.getElementById('devices-modal-close');
  if (devicesModalClose) {
    devicesModalClose.addEventListener('click', closeDevicesModal);
  }
  if (devicesModal) {
    devicesModal.addEventListener('click', (e) => {
      if (e.target === devicesModal) closeDevicesModal();
    });
  }

  const devicesRefreshBtn = document.getElementById('devices-refresh-btn');
  if (devicesRefreshBtn) {
    devicesRefreshBtn.addEventListener('click', () => {
      if (currentDevicesAccountId) loadAccountDevices(currentDevicesAccountId);
    });
  }

  const devicesTermAllBtn = document.getElementById('devices-terminate-all-btn');
  if (devicesTermAllBtn) {
    devicesTermAllBtn.addEventListener('click', () => {
      if (currentDevicesAccountId) {
        const accName = document.getElementById('devices-modal-account-title')?.textContent || ('Akun #' + currentDevicesAccountId);
        terminateOtherSessionsForAccount(currentDevicesAccountId, accName);
      }
    });
  }

  initSessionManagerView();

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
  const verifyCustomBtn = document.getElementById('otp-verify-custom-2fa-btn');
  const resetBtn = document.getElementById('otp-reset-2fa-inline-btn');
  if (!displayEl) return;

  if (resetBtn) resetBtn.style.display = 'none';
  if (verifyCustomBtn) verifyCustomBtn.style.display = 'none';

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
      subtextEl.innerHTML = '<span style="color: var(--accent-green);">✓ Kata sandi 2FA telah tersimpan & terkonfirmasi cocok. Langsung masukkan sandi ini jika Telegram meminta password setelah kode OTP.</span>';
    }
  } else if (twofa.twofa_status === 'reset_pending' || twofa.twofa_reset_until) {
    currentExtracted2faPass = null;
    if (copyBtn) copyBtn.style.display = 'none';
    const until = twofa.twofa_reset_until || '7 hari';
    displayEl.innerHTML = `<span style="color: var(--accent-amber); font-weight: 600;">⏳ Sedang Proses Reset (7 Hari)</span>`;
    if (subtextEl) {
      subtextEl.innerHTML = `<span style="color: var(--accent-amber);">⚠️ Reset 2FA telah diajukan ke Telegram, proses reset selesai pada: <strong>${escapeHtml(until)}</strong>.</span>`;
    }
  } else if (twofa.twofa_status === 'mismatch') {
    currentExtracted2faPass = null;
    if (copyBtn) copyBtn.style.display = 'none';
    if (verifyCustomBtn) verifyCustomBtn.style.display = 'inline-flex';
    if (resetBtn) resetBtn.style.display = 'inline-flex';
    const hintText = twofa.twofa_hint ? ` (Hint: ${escapeHtml(twofa.twofa_hint)})` : '';
    displayEl.innerHTML = `<span style="color: var(--accent-amber); font-weight: 700; font-size: 1.05rem;">🔒 2FA Aktif (Sandi Belum Tersimpan)</span>${hintText ? `<span style="font-size:0.8rem; color:var(--text-muted); margin-left:8px;">${hintText}</span>` : ''}`;
    if (subtextEl) {
      subtextEl.innerHTML = '<span style="color: var(--text-secondary);">Akun ini memiliki 2FA dengan sandi khusus yang belum tersimpan. Klik <strong>🔑 Isi / Simpan Sandi</strong> untuk memasukkan sandinya agar tersimpan permanen, atau klik <strong>⚠️ Reset 2FA (7 Hari)</strong>.</span>';
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
    if (verifyCustomBtn) verifyCustomBtn.style.display = 'inline-flex';
    displayEl.innerHTML = `<span style="color: var(--accent-amber); font-weight: 600;">🔒 2FA Aktif (Sandi Belum Dicek)</span>`;
    if (subtextEl) {
      subtextEl.innerHTML = '<span>Klik tombol <strong>🔄 Cek 2FA</strong> di samping untuk memverifikasi sandi 2FA akun ini.</span>';
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

    if (data.account_deleted || data.session_revoked) {
      showToast(`⚠️ ${data.message || 'Sesi akun mati/ter-revoke dan telah otomatis dihapus dari dashboard.'}`, 'warning');
      closeOtpModal();
      const card = document.getElementById(`account-card-${accountId}`);
      if (card) card.remove();
      loadAccounts();
      return;
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
window.connectAllOfflineAccounts = connectAllOfflineAccounts;
window.checkAccount2FA = checkAccount2FA;
window.checkAllAccounts2FA = checkAllAccounts2FA;
window.checkAccountHealth = checkAccountHealth;
window.checkAllAccountsHealth = checkAllAccountsHealth;
window.triggerExport = triggerExport;
window.loadAccounts = loadAccounts;
window.openDevicesModal = openDevicesModal;
window.closeDevicesModal = closeDevicesModal;
window.loadAccountDevices = loadAccountDevices;
window.terminateDeviceSession = terminateDeviceSession;
window.openSingleProfileModal = openSingleProfileModal;
window.closeSingleProfileModal = closeSingleProfileModal;

// ==================== CONNECTED DEVICES MODAL CONTROLLER ====================
let currentDevicesAccountId = null;

function openDevicesModal(accountId, displayName, phoneNumber) {
  currentDevicesAccountId = accountId;
  const modal = document.getElementById('devices-modal');
  if (!modal) return;

  const nameEl = document.getElementById('devices-modal-title') || document.getElementById('devices-account-name');
  const phoneEl = document.getElementById('devices-modal-phone') || document.getElementById('devices-account-phone');
  if (nameEl) nameEl.textContent = `Perangkat: ${displayName || 'Akun #' + accountId}`;
  if (phoneEl) phoneEl.textContent = `Nomor: ${phoneNumber || '-'}`;

  modal.style.display = 'flex';
  modal.classList.add('active');
  loadAccountDevices(accountId);
}

function closeDevicesModal() {
  const modal = document.getElementById('devices-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
  currentDevicesAccountId = null;
}

async function loadAccountDevices(accountId) {
  const listEl = document.getElementById('devices-list');
  const countPill = document.getElementById('devices-count-badge') || document.getElementById('devices-count-pill');
  if (!listEl) return;

  listEl.innerHTML = `
    <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
      <div class="spinner" style="width: 28px; height: 28px; margin: 0 auto 16px; border-width: 3px;"></div>
      <p style="font-size: 0.95rem; font-weight: 500; color: var(--text-primary);">Mengambil daftar perangkat dari Telegram...</p>
      <p style="font-size: 0.8rem; margin-top: 4px;">Menghubungkan ke session akun...</p>
    </div>
  `;
  if (countPill) countPill.textContent = 'Memuat...';

  try {
    const res = await fetch(`/api/accounts/${accountId}/devices`, {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (!res.ok || data.status === 'error') {
      const errMsg = data.detail || data.message || 'Terjadi kesalahan saat mengambil perangkat';
      listEl.innerHTML = `
        <div style="text-align: center; padding: 35px 20px; color: var(--accent-rose);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">⚠️</div>
          <p style="font-weight: 600;">Gagal mengambil perangkat</p>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">${escapeHtml(errMsg)}</p>
          <button class="btn btn-secondary btn-sm" onclick="loadAccountDevices(${accountId})" style="margin-top: 14px;">Coba Lagi</button>
        </div>
      `;
      if (countPill) countPill.textContent = 'Error';
      return;
    }

    const authorizations = data.authorizations || [];
    if (countPill) countPill.textContent = `${authorizations.length} Perangkat Aktif`;

    if (authorizations.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 35px 20px; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 8px;">📱</div>
          <p>Tidak ada perangkat yang terdeteksi.</p>
        </div>
      `;
      return;
    }

    const cleanVal = (v) => (v && v !== '-' && v !== 'Tidak diketahui') ? v : '';

    listEl.innerHTML = authorizations.map(dev => {
      const isCurrent = !!dev.current;
      const titleParts = [cleanVal(dev.device_model), cleanVal(dev.platform), cleanVal(dev.system_version)].filter(Boolean);
      const deviceTitle = titleParts.join(' • ') || 'Perangkat Tidak Dikenal';
      const appParts = [cleanVal(dev.app_name), cleanVal(dev.app_version)].filter(Boolean);
      const appInfo = appParts.join(' v') || 'Telegram App';
      const locParts = [cleanVal(dev.country), cleanVal(dev.region)].filter(Boolean);
      const location = locParts.join(', ') || 'Lokasi tidak diketahui';
      const ip = (dev.ip && dev.ip !== '-') ? dev.ip : 'Disembunyikan Telegram';
      const lastActive = dev.date_active || '-';
      const created = dev.date_created || '-';

      return `
        <div class="device-card ${isCurrent ? 'current-device' : ''}">
          <div class="device-card-header">
            <div>
              <div class="device-name">${escapeHtml(deviceTitle)}</div>
              <div class="device-app">📱 ${escapeHtml(appInfo)}${dev.official_app ? ' (Resmi)' : ''}</div>
            </div>
            <div>
              ${isCurrent
                ? `<span class="device-badge-current">● Sesi Ini (Web/Bot)</span>`
                : `<span class="device-badge-other">Perangkat Lain</span>`}
            </div>
          </div>
          <div class="device-card-details">
            <div class="device-detail-col">
              <span class="detail-label">Lokasi</span>
              <span class="detail-val">${escapeHtml(location)}</span>
            </div>
            <div class="device-detail-col">
              <span class="detail-label">IP Address</span>
              <span class="detail-val">${escapeHtml(ip)}</span>
            </div>
            <div class="device-detail-col">
              <span class="detail-label">Aktif Terakhir</span>
              <span class="detail-val">${escapeHtml(lastActive)}</span>
            </div>
            <div class="device-detail-col">
              <span class="detail-label">Sesi Dibuat</span>
              <span class="detail-val">${escapeHtml(created)}</span>
            </div>
          </div>
          ${!isCurrent && dev.hash && dev.hash !== '0' ? `
            <div style="margin-top: 10px; display: flex; justify-content: flex-end;">
              <button class="btn btn-danger btn-sm" onclick="terminateDeviceSession(${accountId}, '${escapeHtml(dev.hash)}', '${escapeHtml(deviceTitle)}')">
                🚫 Putuskan Sesi Ini
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

  } catch (err) {
    listEl.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--accent-rose);">
        <p>Gagal menghubungi server</p>
      </div>
    `;
    if (countPill) countPill.textContent = 'Gagal';
  }
}

async function terminateDeviceSession(accountId, authHash, deviceName) {
  if (!confirm(`Apakah Anda yakin ingin mengeluarkan sesi untuk perangkat:\n"${deviceName}"?`)) {
    return;
  }

  showToast('Memutuskan sesi perangkat...', 'info');
  try {
    const res = await fetch(`/api/accounts/${accountId}/devices/${encodeURIComponent(authHash)}/terminate`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status !== 'error') {
      showToast(data.message || 'Sesi perangkat berhasil diputuskan!', 'success');
      loadAccountDevices(accountId);
    } else {
      showToast(data.detail || data.message || 'Gagal memutuskan sesi perangkat', 'error');
    }
  } catch (e) {
    showToast('Koneksi gagal saat memutuskan sesi', 'error');
  }
}

async function terminateOtherSessionsForAccount(accountId, accountName) {
  if (!confirm(`⚠️ Konfirmasi Putuskan Sesi Lain:\n\nApakah Anda yakin ingin MEMUTUSKAN SEMUA sesi perangkat lain pada akun "${accountName || accountId}"?\n\nHanya sesi bot di dashboard ini yang akan tersisa.`)) {
    return;
  }

  showToast('Memutuskan seluruh sesi perangkat lain...', 'info');
  try {
    const res = await fetch(`/api/accounts/${accountId}/devices/terminate-other`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(data.message || 'Sesi perangkat lain berhasil diputuskan!', 'success');
      if (currentDevicesAccountId === accountId) {
        loadAccountDevices(accountId);
      }
      if (window.loadSessionManagerAccounts) loadSessionManagerAccounts();
    } else {
      showToast(data.detail || data.message || 'Gagal memutuskan sesi lain', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  }
}
window.terminateOtherSessionsForAccount = terminateOtherSessionsForAccount;

async function logoutAccountSingle(accountId, accountName) {
  const proceed = confirm(
    `🚪 KONFIRMASI LOGOUT PERMANEN:\n\n` +
    `Apakah Anda yakin ingin me-LOGOUT akun "${accountName || accountId}" dari server Telegram?\n\n` +
    `⚠️ PERHATIAN:\n` +
    `• Kunci otorisasi (AuthKey) sesi bot ini akan MATI TOTAL secara permanen di Telegram.\n` +
    `• Pastikan Anda SUDAH login di aplikasi HP/Nicegram!\n\n` +
    `Klik [OK] untuk lanjut, atau [Cancel] untuk membatalkan.`
  );
  if (!proceed) return;

  const removeDb = confirm(`Hapus akun ini dari tampilan dashboard juga setelah logout berhasil?\n\n[OK] = Logout & Hapus dari dashboard\n[Cancel] = Logout saja (status jadi offline)`);

  showToast('Me-logout sesi dari server Telegram...', 'info');
  try {
    const res = await fetch(`/api/accounts/${accountId}/logout?delete_from_db=${removeDb}`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast(data.message || 'Akun berhasil di-logout secara permanen!', 'success');
      loadAccounts();
      if (window.loadSessionManagerAccounts) loadSessionManagerAccounts();
    } else {
      showToast(data.detail || data.message || 'Gagal logout akun', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  }
}
window.logoutAccountSingle = logoutAccountSingle;

// ==================== SINGLE PROFILE MODAL CONTROLLER ====================
function openSingleProfileModal(accountId, currentName) {
  const modal = document.getElementById('single-profile-modal');
  if (!modal) return;
  const idInput = document.getElementById('single-profile-acc-id');
  const titleEl = document.getElementById('single-profile-title');
  const fnInput = document.getElementById('single-profile-firstname');
  const lnInput = document.getElementById('single-profile-lastname');
  const aboutInput = document.getElementById('single-profile-about');
  const photoInput = document.getElementById('single-profile-photo');
  const preview = document.getElementById('single-profile-photo-preview');

  if (idInput) idInput.value = accountId;
  if (titleEl) titleEl.textContent = `Ubah Profil: ${currentName || 'Akun #' + accountId}`;

  const parts = (currentName || '').trim().split(/\s+/);
  const fn = parts[0] || '';
  const ln = parts.slice(1).join(' ') || '';
  if (fnInput) fnInput.value = fn;
  if (lnInput) lnInput.value = ln;
  if (aboutInput) aboutInput.value = '';

  if (photoInput) photoInput.value = '';
  if (preview) preview.style.display = 'none';

  modal.style.display = 'flex';
  modal.classList.add('active');
}

function closeSingleProfileModal() {
  const modal = document.getElementById('single-profile-modal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.remove('active');
  }
}

// Single profile event listeners
document.addEventListener('DOMContentLoaded', () => {
  const singlePhotoInput = document.getElementById('single-profile-photo');
  const singlePreview = document.getElementById('single-profile-photo-preview');
  const singleThumb = document.getElementById('single-profile-img-thumb');
  const singleName = document.getElementById('single-profile-img-name');
  const singleRemovePhoto = document.getElementById('single-profile-remove-photo');
  const singleSubmitBtn = document.getElementById('single-profile-submit-btn');
  const singleCancelBtn = document.getElementById('single-profile-cancel-btn');
  const singleModalClose = document.getElementById('single-profile-modal-close');
  const singleModal = document.getElementById('single-profile-modal');

  if (singlePhotoInput) {
    singlePhotoInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
          if (singleThumb) singleThumb.src = re.target.result;
          if (singleName) singleName.textContent = file.name;
          if (singlePreview) singlePreview.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      } else {
        if (singlePreview) singlePreview.style.display = 'none';
      }
    });
  }

  if (singleRemovePhoto) {
    singleRemovePhoto.addEventListener('click', () => {
      if (singlePhotoInput) singlePhotoInput.value = '';
      if (singlePreview) singlePreview.style.display = 'none';
    });
  }

  if (singleModalClose) singleModalClose.addEventListener('click', closeSingleProfileModal);
  if (singleCancelBtn) singleCancelBtn.addEventListener('click', closeSingleProfileModal);
  if (singleModal) {
    singleModal.addEventListener('click', (e) => {
      if (e.target === singleModal) closeSingleProfileModal();
    });
  }

  if (singleSubmitBtn) {
    singleSubmitBtn.addEventListener('click', async () => {
      const accId = document.getElementById('single-profile-acc-id').value;
      const fn = (document.getElementById('single-profile-firstname').value || '').trim();
      const ln = (document.getElementById('single-profile-lastname').value || '').trim();
      const about = (document.getElementById('single-profile-about').value || '').trim();
      const hasPhoto = singlePhotoInput && singlePhotoInput.files && singlePhotoInput.files.length > 0;

      if (!fn && !ln && !about && !hasPhoto) {
        showToast('Isi minimal nama atau pilih foto profil', 'warning');
        return;
      }

      const formData = new FormData();
      if (fn) formData.append('first_name', fn);
      if (ln) formData.append('last_name', ln);
      if (about) formData.append('about', about);
      if (hasPhoto) formData.append('photo', singlePhotoInput.files[0]);

      singleSubmitBtn.disabled = true;
      singleSubmitBtn.innerHTML = '<div class="spinner"></div> Menyimpan...';

      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/accounts/${accId}/update-profile`, {
          method: 'POST',
          headers: {
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: formData
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
          showToast(data.message || 'Profil berhasil diperbarui!', 'success');
          closeSingleProfileModal();
          loadAccounts();
        } else {
          showToast(data.detail || data.message || 'Gagal mengubah profil', 'error');
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        singleSubmitBtn.disabled = false;
        singleSubmitBtn.innerHTML = '<span>💾 Simpan Perubahan Profil</span>';
      }
    });
  }
});

// ==================== SESSION MANAGER VIEW CONTROLLER ====================
let cachedSessionAccounts = [];
let selectedSessionAccountIds = new Set();

function updateSessionSelectionCounter() {
  const cntEl = document.getElementById('session-selected-count');
  if (cntEl) {
    cntEl.textContent = `${selectedSessionAccountIds.size} akun dipilih`;
  }
}

async function loadSessionManagerAccounts() {
  const container = document.getElementById('session-manager-items');
  if (!container) return;

  container.innerHTML = '<div style="text-align: center; padding: 24px; color: var(--text-muted);"><div class="spinner" style="width:16px;height:16px;display:inline-block;margin-right:8px;"></div>Memuat daftar akun...</div>';

  try {
    const res = await fetch('/api/accounts?limit=1000', { credentials: 'omit', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    cachedSessionAccounts = Array.isArray(data) ? data : (data.accounts || []);
    const validIds = new Set(cachedSessionAccounts.map(a => a.id));
    selectedSessionAccountIds = new Set([...selectedSessionAccountIds].filter(id => validIds.has(id)));
    updateSessionSelectionCounter();
    renderSessionManagerList();
  } catch (err) {
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--accent-rose);">⚠️ Gagal memuat daftar akun: ${escapeHtml(err.message)}</div>`;
  }
}
window.loadSessionManagerAccounts = loadSessionManagerAccounts;

function renderSessionManagerList() {
  const container = document.getElementById('session-manager-items');
  if (!container) return;

  const searchInputEl = document.getElementById('session-search-input');
  const searchVal = (searchInputEl?.value || '').toLowerCase().trim();
  const searchClearBtn = document.getElementById('session-search-clear-btn');
  if (searchClearBtn) {
    searchClearBtn.style.display = searchVal ? 'block' : 'none';
  }

  const idFilterEl = document.getElementById('session-id-filter');
  const idFilterVal = (idFilterEl?.value || '').trim();
  const idClearBtn = document.getElementById('session-id-clear-btn');
  if (idClearBtn) {
    idClearBtn.style.display = idFilterVal ? 'block' : 'none';
  }

  const statusVal = document.getElementById('session-status-filter')?.value || 'all';

  const list = cachedSessionAccounts.filter(acc => {
    const isOnline = !!acc.is_active;
    if (statusVal === 'online' && !isOnline) return false;
    if (statusVal === 'offline' && isOnline) return false;

    // Filter by Telegram ID (prefix awalan ID, atau multiple awalan dipisah koma)
    if (idFilterVal) {
      const tgIdStr = String(acc.telegram_id || '');
      const prefixes = idFilterVal.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean);
      if (prefixes.length > 0) {
        const matchesPrefix = prefixes.some(p => tgIdStr.startsWith(p));
        if (!matchesPrefix) return false;
      }
    }

    // Filter by Nama / Username / Phone
    if (searchVal) {
      const matchName = (acc.display_name || '').toLowerCase().includes(searchVal);
      const matchUsername = (acc.username || '').toLowerCase().includes(searchVal);
      const matchPhone = (acc.phone_number || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchUsername && !matchPhone) return false;
    }
    return true;
  });

  if (list.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);">Tidak ada akun yang cocok dengan filter.</div>';
    return;
  }

  container.innerHTML = list.map(acc => {
    const isSelected = selectedSessionAccountIds.has(acc.id);
    const isOnline = !!acc.is_active;
    const name = escapeHtml(acc.display_name || (acc.username ? '@' + acc.username : '') || acc.phone_number || ('Akun #' + acc.id));
    const phone = escapeHtml(acc.phone_number || '-');
    const username = acc.username ? `<span style="color: var(--accent-cyan); font-size: 0.76rem;">@${escapeHtml(acc.username)}</span>` : '';
    const tgId = acc.telegram_id ? `<span class="account-id-badge" onclick="filterSessionByTelegramId('${acc.telegram_id}')" style="cursor: pointer; padding: 2px 7px; border-radius: 6px; font-size: 0.74rem; background: rgba(0, 212, 255, 0.08); border: 1px solid rgba(0, 212, 255, 0.25); color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace;" title="Klik untuk filter awalan ID ${acc.telegram_id}">TG: ${acc.telegram_id} 🔍</span>` : '';
    const statusBadge = isOnline 
      ? '<span style="display:inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 600; background: rgba(16,185,129,0.15); color: var(--accent-green); border: 1px solid rgba(16,185,129,0.3);">● Online</span>'
      : '<span style="display:inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 600; background: rgba(239,68,68,0.12); color: var(--accent-rose); border: 1px solid rgba(239,68,68,0.25);">○ Offline</span>';

    return `
      <div class="session-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); border-radius: var(--radius-sm); transition: background 0.15s;">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <input type="checkbox" class="session-acc-chk" data-id="${acc.id}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; accent-color: var(--accent-cyan);">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, rgba(6,182,212,0.2), rgba(168,85,247,0.2)); display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--accent-cyan); font-size: 0.88rem; flex-shrink: 0;">
            ${(name.charAt(0) || 'A').toUpperCase()}
          </div>
          <div style="min-width: 0;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-weight: 600; font-size: 0.88rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${name}
              </span>
              ${username}
            </div>
            <div style="font-size: 0.76rem; color: var(--text-muted); display: flex; gap: 10px; align-items: center; margin-top: 2px; flex-wrap: wrap;">
              <span style="color: var(--text-secondary); font-family: 'JetBrains Mono', monospace; font-weight: 500;">📞 ${phone}</span>
              ${tgId}
              ${statusBadge}
            </div>
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="openDevicesModal(${acc.id}, '${name.replace(/'/g, "\\'")}', '${phone}')" style="padding: 4px 9px; font-size: 0.75rem;" title="Lihat semua perangkat aktif akun ini">
            📱 Cek Sesi
          </button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="terminateOtherSessionsForAccount(${acc.id}, '${name.replace(/'/g, "\\'")}')" style="padding: 4px 9px; font-size: 0.75rem; color: var(--accent-amber);" title="Putuskan semua sesi perangkat lain selain bot ini" ${!isOnline ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''}>
            ⚡ Putuskan Sesi Lain
          </button>
          <button type="button" class="btn btn-danger btn-sm" onclick="logoutAccountSingle(${acc.id}, '${name.replace(/'/g, "\\'")}')" style="padding: 4px 9px; font-size: 0.75rem;" title="Logout sesi bot ini secara permanen dari server Telegram">
            🚪 Logout Bot
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.session-acc-chk').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const id = parseInt(e.target.dataset.id, 10);
      if (e.target.checked) {
        selectedSessionAccountIds.add(id);
      } else {
        selectedSessionAccountIds.delete(id);
      }
      updateSessionSelectionCounter();
    });
  });
}

window.filterSessionByTelegramId = function(tgId) {
  const idInput = document.getElementById('session-id-filter');
  if (idInput) {
    idInput.value = tgId;
    renderSessionManagerList();
    idInput.focus();
  }
};

function initSessionManagerView() {
  const searchInput = document.getElementById('session-search-input');
  const searchClearBtn = document.getElementById('session-search-clear-btn');
  const idFilter = document.getElementById('session-id-filter');
  const idClearBtn = document.getElementById('session-id-clear-btn');
  const statusFilter = document.getElementById('session-status-filter');
  const reloadBtn = document.getElementById('session-reload-btn');
  const selectAllBtn = document.getElementById('session-select-all');
  const selectNoneBtn = document.getElementById('session-select-none');
  const selectOnlineBtn = document.getElementById('session-select-online');
  const bulkTermBtn = document.getElementById('session-bulk-terminate-other-btn');
  const bulkLogoutBtn = document.getElementById('session-bulk-logout-btn');

  if (searchInput) searchInput.addEventListener('input', renderSessionManagerList);
  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      renderSessionManagerList();
    });
  }

  if (idFilter) idFilter.addEventListener('input', renderSessionManagerList);
  if (idClearBtn) {
    idClearBtn.addEventListener('click', () => {
      if (idFilter) idFilter.value = '';
      renderSessionManagerList();
    });
  }

  if (statusFilter) statusFilter.addEventListener('change', renderSessionManagerList);
  if (reloadBtn) reloadBtn.addEventListener('click', loadSessionManagerAccounts);

  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      const searchVal = (document.getElementById('session-search-input')?.value || '').toLowerCase().trim();
      const idFilterVal = (document.getElementById('session-id-filter')?.value || '').trim();
      const statusVal = document.getElementById('session-status-filter')?.value || 'all';
      const prefixes = idFilterVal ? idFilterVal.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) : [];

      cachedSessionAccounts.forEach(acc => {
        const isOnline = !!acc.is_active;
        if (statusVal === 'online' && !isOnline) return;
        if (statusVal === 'offline' && isOnline) return;
        if (prefixes.length > 0) {
          const tgIdStr = String(acc.telegram_id || '');
          if (!prefixes.some(p => tgIdStr.startsWith(p))) return;
        }
        if (searchVal) {
          const matchName = (acc.display_name || '').toLowerCase().includes(searchVal);
          const matchUsername = (acc.username || '').toLowerCase().includes(searchVal);
          const matchPhone = (acc.phone_number || '').toLowerCase().includes(searchVal);
          if (!matchName && !matchUsername && !matchPhone) return;
        }
        selectedSessionAccountIds.add(acc.id);
      });
      updateSessionSelectionCounter();
      renderSessionManagerList();
    });
  }

  if (selectNoneBtn) {
    selectNoneBtn.addEventListener('click', () => {
      selectedSessionAccountIds.clear();
      updateSessionSelectionCounter();
      renderSessionManagerList();
    });
  }

  if (selectOnlineBtn) {
    selectOnlineBtn.addEventListener('click', () => {
      const searchVal = (document.getElementById('session-search-input')?.value || '').toLowerCase().trim();
      const idFilterVal = (document.getElementById('session-id-filter')?.value || '').trim();
      const prefixes = idFilterVal ? idFilterVal.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) : [];

      cachedSessionAccounts.forEach(acc => {
        if (!acc.is_active) return;
        if (prefixes.length > 0) {
          const tgIdStr = String(acc.telegram_id || '');
          if (!prefixes.some(p => tgIdStr.startsWith(p))) return;
        }
        if (searchVal) {
          const matchName = (acc.display_name || '').toLowerCase().includes(searchVal);
          const matchUsername = (acc.username || '').toLowerCase().includes(searchVal);
          const matchPhone = (acc.phone_number || '').toLowerCase().includes(searchVal);
          if (!matchName && !matchUsername && !matchPhone) return;
        }
        selectedSessionAccountIds.add(acc.id);
      });
      updateSessionSelectionCounter();
      renderSessionManagerList();
    });
  }

  if (bulkTermBtn) {
    bulkTermBtn.addEventListener('click', async () => {
      if (selectedSessionAccountIds.size === 0) {
        showToast('Pilih minimal 1 akun terlebih dahulu', 'warning');
        return;
      }
      const ids = Array.from(selectedSessionAccountIds);
      if (!confirm(`⚠️ Konfirmasi Putuskan Sesi Lain Massal:\n\nApakah Anda yakin ingin memutuskan seluruh sesi perangkat lain pada ${ids.length} akun yang dipilih?\n\nHanya sesi bot di dashboard ini yang akan tersisa.`)) {
        return;
      }

      const resultsBox = document.getElementById('session-manager-results');
      if (resultsBox) {
        resultsBox.style.display = 'block';
        resultsBox.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><div class="spinner"></div><span>Sedang memutuskan sesi lain untuk ${ids.length} akun...</span></div>`;
      }
      bulkTermBtn.disabled = true;

      try {
        const res = await fetch('/api/accounts/devices/terminate-other-bulk', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ account_ids: ids })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
          showToast(`Selesai! Sukses: ${data.success_count}, Gagal: ${data.failed_count}`, 'success');
          if (resultsBox) {
            resultsBox.innerHTML = `
              <div style="font-weight:700; color:var(--accent-green); margin-bottom:6px;">✓ Pemutusan Sesi Lain Massal Selesai</div>
              <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:8px;">Total: ${data.total} | Berhasil: ${data.success_count} | Gagal: ${data.failed_count}</div>
              <div style="max-height:160px; overflow-y:auto; font-size:0.75rem; font-family:monospace; line-height:1.6;">
                ${(data.results || []).map(r => `<div>${r.status === 'success' ? '✅' : '❌'} Akun #${r.account_id}: ${escapeHtml(r.message || r.status)}</div>`).join('')}
              </div>
            `;
          }
        } else {
          showToast(data.detail || data.message || 'Gagal proses massal', 'error');
          if (resultsBox) resultsBox.style.display = 'none';
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
        if (resultsBox) resultsBox.style.display = 'none';
      } finally {
        bulkTermBtn.disabled = false;
        loadSessionManagerAccounts();
      }
    });
  }

  if (bulkLogoutBtn) {
    bulkLogoutBtn.addEventListener('click', async () => {
      if (selectedSessionAccountIds.size === 0) {
        showToast('Pilih minimal 1 akun terlebih dahulu', 'warning');
        return;
      }
      const ids = Array.from(selectedSessionAccountIds);
      const delFromDb = !!document.getElementById('session-delete-from-db-chk')?.checked;

      const proceed = confirm(
        `🚪 PERINGATAN LOGOUT BOT MASSAL:\n\n` +
        `Anda akan me-LOGOUT ${ids.length} akun bot ini dari Telegram secara permanen!\n` +
        `• Kunci otorisasi bot akan MATI TOTAL.\n` +
        `• Pastikan Anda SUDAH login di HP/Nicegram untuk semua akun ini!\n` +
        (delFromDb ? `• Akun akan dihapus dari dashboard.\n\n` : `• Akun akan diubah statusnya menjadi offline.\n\n`) +
        `Lanjutkan logout ${ids.length} akun?`
      );
      if (!proceed) return;

      const resultsBox = document.getElementById('session-manager-results');
      if (resultsBox) {
        resultsBox.style.display = 'block';
        resultsBox.innerHTML = `<div style="display:flex;align-items:center;gap:8px;"><div class="spinner"></div><span>Sedang me-logout ${ids.length} akun dari Telegram...</span></div>`;
      }
      bulkLogoutBtn.disabled = true;

      try {
        const res = await fetch('/api/accounts/logout-bulk', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ account_ids: ids, delete_from_db: delFromDb })
        });
        const data = await res.json();
        if (res.ok && data.status === 'success') {
          showToast(`Logout massal selesai! Sukses: ${data.success_count}, Gagal: ${data.failed_count}`, 'success');
          if (resultsBox) {
            resultsBox.innerHTML = `
              <div style="font-weight:700; color:var(--accent-green); margin-bottom:6px;">✓ Logout Massal Selesai</div>
              <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:8px;">Total: ${data.total} | Berhasil: ${data.success_count} | Gagal: ${data.failed_count}</div>
              <div style="max-height:160px; overflow-y:auto; font-size:0.75rem; font-family:monospace; line-height:1.6;">
                ${(data.results || []).map(r => `<div>${r.status === 'success' ? '✅' : '❌'} Akun #${r.account_id}: ${escapeHtml(r.message || r.status)}</div>`).join('')}
              </div>
            `;
          }
          selectedSessionAccountIds.clear();
          updateSessionSelectionCounter();
          loadAccounts();
          loadSessionManagerAccounts();
        } else {
          showToast(data.detail || data.message || 'Gagal logout massal', 'error');
          if (resultsBox) resultsBox.style.display = 'none';
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
        if (resultsBox) resultsBox.style.display = 'none';
      } finally {
        bulkLogoutBtn.disabled = false;
      }
    });
  }
}




