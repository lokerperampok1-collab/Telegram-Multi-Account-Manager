// ==================== SESSION TRANSFER (TelePRO AuthKey Baru) ====================
(function () {
  let cachedTransferAccounts = [];
  let selectedTransferAccountId = null;
  let activeTransferJobId = null;
  let transferPollTimer = null;

  function getAuthOnlyHeaders() {
    const token = localStorage.getItem('token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  function updateSourceModeUI() {
    const srcDash = document.getElementById('transfer-src-dashboard');
    const srcFile = document.getElementById('transfer-src-file');
    const srcStr = document.getElementById('transfer-src-string');

    const lblDash = document.getElementById('transfer-src-dashboard-lbl');
    const lblFile = document.getElementById('transfer-src-file-lbl');
    const lblStr = document.getElementById('transfer-src-string-lbl');

    const panelDash = document.getElementById('transfer-panel-dashboard');
    const panelFile = document.getElementById('transfer-panel-file');
    const panelStr = document.getElementById('transfer-panel-string');

    const mode = srcFile?.checked ? 'file' : (srcStr?.checked ? 'string' : 'dashboard');

    [
      [lblDash, mode === 'dashboard', panelDash],
      [lblFile, mode === 'file', panelFile],
      [lblStr, mode === 'string', panelStr]
    ].forEach(([lbl, active, panel]) => {
      if (lbl) {
        lbl.style.border = active ? '2px solid var(--accent-cyan)' : '1px solid var(--border-color)';
        lbl.style.background = active ? 'rgba(0, 212, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)';
      }
      if (panel) {
        panel.style.display = active ? 'block' : 'none';
      }
    });
  }

  function renderTransferAccountList() {
    const container = document.getElementById('transfer-account-list');
    if (!container) return;

    const searchVal = (document.getElementById('transfer-search-accounts')?.value || '').toLowerCase().trim();
    const idVal = (document.getElementById('transfer-id-filter')?.value || '').trim();
    const prefixes = idVal ? idVal.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) : [];

    const filtered = cachedTransferAccounts.filter(acc => {
      if (prefixes.length > 0) {
        const tgStr = String(acc.telegram_id || '');
        if (!prefixes.some(p => tgStr.startsWith(p))) return false;
      }
      if (searchVal) {
        const mName = (acc.display_name || '').toLowerCase().includes(searchVal);
        const mUser = (acc.username || '').toLowerCase().includes(searchVal);
        const mPhone = (acc.phone_number || '').toLowerCase().includes(searchVal);
        if (!mName && !mUser && !mPhone) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 12px; text-align: center;">Tidak ada akun yang cocok dengan pencarian.</div>';
      return;
    }

    container.innerHTML = filtered.map(acc => {
      const isSelected = selectedTransferAccountId === acc.id;
      const name = escapeHtml(acc.display_name || (acc.username ? '@' + acc.username : '') || acc.phone_number || ('Akun #' + acc.id));
      const phone = escapeHtml(acc.phone_number || '-');
      const tgBadge = acc.telegram_id ? `<span style="color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;">[TG: ${acc.telegram_id}]</span>` : '';
      const twofaBadge = acc.twofa_password ? `<span style="color: var(--accent-green); font-size: 0.72rem;">[2FA Tersimpan]</span>` : '';
      const onlineDot = acc.is_active
        ? '<span style="color: var(--accent-green); font-size: 0.74rem;">● Online</span>'
        : '<span style="color: var(--text-muted); font-size: 0.74rem;">○ Offline</span>';

      return `
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; background: ${isSelected ? 'rgba(0, 212, 255, 0.12)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isSelected ? 'rgba(0, 212, 255, 0.4)' : 'rgba(255,255,255,0.05)'};">
          <input type="radio" name="transfer-selected-acc" value="${acc.id}" ${isSelected ? 'checked' : ''} style="accent-color: var(--accent-cyan); cursor: pointer;">
          <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem;">
            <strong>${name}</strong> <span style="color: var(--text-secondary); font-family: 'JetBrains Mono', monospace;">(${phone})</span> ${tgBadge} ${twofaBadge}
          </div>
          ${onlineDot}
        </label>
      `;
    }).join('');

    container.querySelectorAll('input[name="transfer-selected-acc"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        selectedTransferAccountId = parseInt(e.target.value, 10);
        renderTransferAccountList();
      });
    });
  }

  async function loadTransferAccounts() {
    const container = document.getElementById('transfer-account-list');
    if (!container) return;
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 10px; text-align: center;"><div class="spinner" style="width:14px;height:14px;display:inline-block;"></div> Memuat daftar akun...</div>';

    try {
      const res = await fetch('/api/accounts?limit=0', { headers: getAuthHeaders() });
      const data = await res.json();
      cachedTransferAccounts = data.accounts || [];
      renderTransferAccountList();
    } catch (e) {
      container.innerHTML = '<div style="color: var(--accent-rose); font-size: 0.82rem; padding: 10px; text-align: center;">Gagal memuat daftar akun</div>';
    }
  }
  window.loadTransferAccounts = loadTransferAccounts;

  function renderTransferJobState(job) {
    const panel = document.getElementById('transfer-progress-panel');
    const badge = document.getElementById('transfer-status-badge');
    const meta = document.getElementById('transfer-account-meta');
    const bar = document.getElementById('transfer-progress-bar');
    const msgEl = document.getElementById('transfer-status-message');
    const hintEl = document.getElementById('transfer-delivery-hint');
    const otpBox = document.getElementById('transfer-otp-box');
    const twofaBox = document.getElementById('transfer-2fa-box');
    const outputBox = document.getElementById('transfer-output-box');
    const startBtn = document.getElementById('transfer-start-btn');
    const cancelBtn = document.getElementById('transfer-cancel-btn');

    if (!panel) return;
    panel.style.display = 'block';

    const status = job.status;
    const isTerminal = ['completed', 'partial_logout_uncertain', 'failed', 'cancelled'].includes(status);

    if (bar) bar.style.width = `${job.progress_pct || 0}%`;
    if (msgEl) msgEl.textContent = job.message || '-';
    if (meta) {
      const parts = [];
      if (job.display_name) parts.push(job.display_name);
      if (job.phone_masked) parts.push(job.phone_masked);
      if (job.account_id) parts.push(`ID: ${job.account_id}`);
      meta.textContent = parts.join(' • ');
    }

    if (hintEl) {
      if (job.code_delivery_hint && status === 'waiting_code') {
        hintEl.style.display = 'block';
        hintEl.textContent = `📩 ${job.code_delivery_hint}`;
      } else {
        hintEl.style.display = 'none';
      }
    }

    if (badge) {
      badge.textContent = status.toUpperCase().replace(/_/g, ' ');
      if (status === 'completed') {
        badge.style.background = 'rgba(16,185,129,0.2)';
        badge.style.color = 'var(--accent-green)';
        badge.style.borderColor = 'rgba(16,185,129,0.4)';
      } else if (status === 'failed' || status === 'cancelled') {
        badge.style.background = 'rgba(239,68,68,0.2)';
        badge.style.color = 'var(--accent-rose)';
        badge.style.borderColor = 'rgba(239,68,68,0.4)';
      } else if (status === 'waiting_code' || status === 'waiting_2fa' || status === 'partial_logout_uncertain') {
        badge.style.background = 'rgba(245,158,11,0.2)';
        badge.style.color = 'var(--accent-amber)';
        badge.style.borderColor = 'rgba(245,158,11,0.4)';
      } else {
        badge.style.background = 'rgba(0,212,255,0.15)';
        badge.style.color = 'var(--accent-cyan)';
        badge.style.borderColor = 'rgba(0,212,255,0.3)';
      }
    }

    if (otpBox) otpBox.style.display = status === 'waiting_code' ? 'block' : 'none';
    if (twofaBox) twofaBox.style.display = status === 'waiting_2fa' ? 'block' : 'none';
    if (outputBox) outputBox.style.display = job.output_ready ? 'block' : 'none';

    if (startBtn) startBtn.disabled = !isTerminal;
    if (cancelBtn) cancelBtn.style.display = isTerminal ? 'none' : 'inline-flex';

    if (isTerminal) {
      stopPolling();
      if (job.dashboard_updated && window.loadAccounts) {
        window.loadAccounts();
      }
    }
  }

  function stopPolling() {
    if (transferPollTimer) {
      clearInterval(transferPollTimer);
      transferPollTimer = null;
    }
  }

  function startPolling(jobId) {
    stopPolling();
    transferPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/transfer/status/${jobId}`, { headers: getAuthOnlyHeaders() });
        if (!res.ok) return;
        const job = await res.json();
        renderTransferJobState(job);
      } catch (e) {
        // ignore transient errors
      }
    }, 1200);
  }

  async function startTransfer() {
    const srcFile = document.getElementById('transfer-src-file');
    const srcStr = document.getElementById('transfer-src-string');
    const mode = srcFile?.checked ? 'file' : (srcStr?.checked ? 'string' : 'dashboard');

    const autoLogout = document.getElementById('transfer-auto-logout-chk')?.checked ?? true;
    const saveDash = document.getElementById('transfer-save-dashboard-chk')?.checked ?? true;

    const formData = new FormData();
    formData.append('source_type', mode);
    formData.append('auto_logout_old', autoLogout ? 'true' : 'false');
    formData.append('save_to_dashboard', saveDash ? 'true' : 'false');

    if (mode === 'dashboard') {
      if (!selectedTransferAccountId) {
        showToast('Pilih salah satu akun dari daftar terlebih dahulu', 'warning');
        return;
      }
      formData.append('dashboard_account_id', String(selectedTransferAccountId));
    } else if (mode === 'file') {
      const fileInput = document.getElementById('transfer-file-input');
      if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        showToast('Pilih file .session terlebih dahulu', 'warning');
        return;
      }
      formData.append('session_file', fileInput.files[0]);
    } else if (mode === 'string') {
      const strVal = (document.getElementById('transfer-string-input')?.value || '').trim();
      if (!strVal) {
        showToast('Masukkan StringSession atau Hex:DC terlebih dahulu', 'warning');
        return;
      }
      formData.append('string_session', strVal);
    }

    const startBtn = document.getElementById('transfer-start-btn');
    if (startBtn) startBtn.disabled = true;

    try {
      const res = await fetch('/api/transfer/start', {
        method: 'POST',
        headers: getAuthOnlyHeaders(),
        body: formData
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.detail || 'Gagal memulai transfer sesi', 'error');
        if (startBtn) startBtn.disabled = false;
        return;
      }

      activeTransferJobId = data.job.job_id;
      renderTransferJobState(data.job);
      startPolling(activeTransferJobId);
    } catch (e) {
      showToast('Koneksi ke server gagal', 'error');
      if (startBtn) startBtn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['transfer-src-dashboard', 'transfer-src-file', 'transfer-src-string'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', updateSourceModeUI);
    });

    const searchInput = document.getElementById('transfer-search-accounts');
    if (searchInput) searchInput.addEventListener('input', renderTransferAccountList);

    const idFilter = document.getElementById('transfer-id-filter');
    if (idFilter) idFilter.addEventListener('input', renderTransferAccountList);

    const startBtn = document.getElementById('transfer-start-btn');
    if (startBtn) startBtn.addEventListener('click', startTransfer);

    const cancelBtn = document.getElementById('transfer-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (!activeTransferJobId) return;
        const res = await fetch(`/api/transfer/cancel/${activeTransferJobId}`, {
          method: 'POST',
          headers: getAuthHeaders()
        });
        if (res.ok) {
          const data = await res.json();
          renderTransferJobState(data.job);
          showToast('Proses transfer dibatalkan', 'info');
        }
      });
    }

    const submitOtpBtn = document.getElementById('transfer-submit-otp-btn');
    if (submitOtpBtn) {
      submitOtpBtn.addEventListener('click', async () => {
        const otpInput = document.getElementById('transfer-otp-input');
        const code = (otpInput?.value || '').trim();
        if (!activeTransferJobId || !code) return;
        const res = await fetch(`/api/transfer/submit-code/${activeTransferJobId}`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (res.ok) {
          if (otpInput) otpInput.value = '';
          showToast('Kode OTP dikirim!', 'success');
        } else {
          showToast(data.detail || 'Gagal mengirim OTP', 'error');
        }
      });
    }

    const submit2faBtn = document.getElementById('transfer-submit-2fa-btn');
    if (submit2faBtn) {
      submit2faBtn.addEventListener('click', async () => {
        const pwdInput = document.getElementById('transfer-2fa-input');
        const password = pwdInput?.value || '';
        if (!activeTransferJobId || !password) return;
        const res = await fetch(`/api/transfer/submit-2fa/${activeTransferJobId}`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok) {
          if (pwdInput) pwdInput.value = '';
          showToast('Password 2FA dikirim!', 'success');
        } else {
          showToast(data.detail || 'Gagal mengirim password 2FA', 'error');
        }
      });
    }

    const downloadBtn = document.getElementById('transfer-download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', async () => {
        if (!activeTransferJobId) return;
        const res = await fetch(`/api/transfer/download/${activeTransferJobId}`, { headers: getAuthOnlyHeaders() });
        if (!res.ok) {
          showToast('File sesi belum tersedia atau sudah dihapus', 'error');
          return;
        }
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `new_auth_session_${activeTransferJobId}.session`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('File .session baru berhasil diunduh!', 'success');
      });
    }

    const copyStringBtn = document.getElementById('transfer-copy-string-btn');
    if (copyStringBtn) {
      copyStringBtn.addEventListener('click', async () => {
        if (!activeTransferJobId) return;
        const res = await fetch(`/api/transfer/string/${activeTransferJobId}`, { headers: getAuthOnlyHeaders() });
        const data = await res.json();
        if (res.ok && data.string_session) {
          await navigator.clipboard.writeText(data.string_session);
          showToast('StringSession baru berhasil disalin ke clipboard!', 'success');
        } else {
          showToast(data.detail || 'Gagal mengambil StringSession', 'error');
        }
      });
    }

    const deleteOutputBtn = document.getElementById('transfer-delete-output-btn');
    if (deleteOutputBtn) {
      deleteOutputBtn.addEventListener('click', async () => {
        if (!activeTransferJobId) return;
        const res = await fetch(`/api/transfer/output/${activeTransferJobId}`, {
          method: 'DELETE',
          headers: getAuthOnlyHeaders()
        });
        if (res.ok) {
          const outBox = document.getElementById('transfer-output-box');
          if (outBox) outBox.style.display = 'none';
          showToast('File sementara .session dihapus dari server (sesi Telegram tetap aktif)', 'info');
        }
      });
    }

    updateSourceModeUI();
  });
})();
