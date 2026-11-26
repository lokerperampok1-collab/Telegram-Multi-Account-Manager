// ==================== SESSION TRANSFER (TelePRO AuthKey Baru) ====================
(function () {
  let cachedTransferAccounts = [];
  const selectedTransferAccountIds = new Set();
  let activeTransferJobId = null;
  let transferPollTimer = null;

  // Batch state (multi-account parallel transfer)
  let activeBatchId = null;
  let batchPollTimer = null;
  let batchActive = false;

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

  function getFilteredTransferAccounts() {
    const searchVal = (document.getElementById('transfer-search-accounts')?.value || '').toLowerCase().trim();
    const idVal = (document.getElementById('transfer-id-filter')?.value || '').trim();
    const prefixes = idVal ? idVal.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) : [];

    return cachedTransferAccounts.filter(acc => {
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
  }

  function updateTransferSelectedCount() {
    const countEl = document.getElementById('transfer-selected-count');
    if (countEl) {
      countEl.textContent = `${selectedTransferAccountIds.size} akun dipilih`;
    }
  }

  function renderTransferAccountList() {
    const container = document.getElementById('transfer-account-list');
    if (!container) return;

    const filtered = getFilteredTransferAccounts();
    updateTransferSelectedCount();

    if (filtered.length === 0) {
      container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.82rem; padding: 12px; text-align: center;">Tidak ada akun yang cocok dengan pencarian.</div>';
      return;
    }

    container.innerHTML = filtered.map(acc => {
      const isSelected = selectedTransferAccountIds.has(acc.id);
      const name = escapeHtml(acc.display_name || (acc.username ? '@' + acc.username : '') || acc.phone_number || ('Akun #' + acc.id));
      const phone = escapeHtml(acc.phone_number || '-');
      const tgBadge = acc.telegram_id ? `<span style="color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;">[TG: ${acc.telegram_id}]</span>` : '';
      const twofaBadge = acc.twofa_password ? `<span style="color: var(--accent-green); font-size: 0.72rem;">[2FA Tersimpan]</span>` : '';
      const onlineDot = acc.is_active
        ? '<span style="color: var(--accent-green); font-size: 0.74rem;">● Online</span>'
        : '<span style="color: var(--text-muted); font-size: 0.74rem;">○ Offline</span>';

      return `
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; background: ${isSelected ? 'rgba(0, 212, 255, 0.12)' : 'rgba(255,255,255,0.02)'}; border: 1px solid ${isSelected ? 'rgba(0, 212, 255, 0.4)' : 'rgba(255,255,255,0.05)'};">
          <input type="checkbox" name="transfer-selected-acc" value="${acc.id}" ${isSelected ? 'checked' : ''} style="accent-color: var(--accent-cyan); cursor: pointer; width: 15px; height: 15px;">
          <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.82rem;">
            <strong>${name}</strong> <span style="color: var(--text-secondary); font-family: 'JetBrains Mono', monospace;">(${phone})</span> ${tgBadge} ${twofaBadge}
          </div>
          ${onlineDot}
        </label>
      `;
    }).join('');

    container.querySelectorAll('input[name="transfer-selected-acc"]').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = parseInt(e.target.value, 10);
        if (e.target.checked) {
          selectedTransferAccountIds.add(id);
        } else {
          selectedTransferAccountIds.delete(id);
        }
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

    if (isTerminal) {
      stopPolling();
      if (job.dashboard_updated && window.loadAccounts) {
        window.loadAccounts();
      }
      if (status === 'completed' || status === 'partial_logout_uncertain') {
        loadTransferAccounts();
      }
    }

    if (startBtn) startBtn.disabled = !isTerminal;
    if (cancelBtn) {
      cancelBtn.innerHTML = '<span>✕ Batalkan</span>';
      cancelBtn.style.display = isTerminal ? 'none' : 'inline-flex';
    }
  }

  function applyStatusBadgeStyle(badge, status) {
    if (!badge) return;
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
    } else if (status === 'queued') {
      badge.style.background = 'rgba(148,163,184,0.15)';
      badge.style.color = 'var(--text-secondary)';
      badge.style.borderColor = 'rgba(148,163,184,0.3)';
    } else {
      badge.style.background = 'rgba(0,212,255,0.15)';
      badge.style.color = 'var(--accent-cyan)';
      badge.style.borderColor = 'rgba(0,212,255,0.3)';
    }
  }

  async function downloadJobSession(jobId) {
    const res = await fetch(`/api/transfer/download/${jobId}`, { headers: getAuthOnlyHeaders() });
    if (!res.ok) {
      showToast('File sesi belum tersedia atau sudah dihapus', 'error');
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `new_auth_session_${jobId}.session`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('File .session baru berhasil diunduh!', 'success');
  }

  async function copyJobStringSession(jobId) {
    const res = await fetch(`/api/transfer/string/${jobId}`, { headers: getAuthOnlyHeaders() });
    const data = await res.json();
    if (res.ok && data.string_session) {
      await navigator.clipboard.writeText(data.string_session);
      showToast('StringSession baru berhasil disalin ke clipboard!', 'success');
    } else {
      showToast(data.detail || 'Gagal mengambil StringSession', 'error');
    }
  }

  function createParallelJobCard(job) {
    const card = document.createElement('div');
    card.dataset.jobId = job.job_id;
    card.style.cssText = 'padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 6px;';

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div class="tp-title" style="font-weight: 600; font-size: 0.82rem; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          <span class="tp-badge" style="padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 700; border: 1px solid transparent;"></span>
          <button type="button" class="btn btn-danger btn-sm tp-cancel-btn" style="padding: 2px 8px; font-size: 0.7rem; display: none;">✕</button>
        </div>
      </div>
      <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden;">
        <div class="tp-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, var(--accent-cyan), var(--accent-green)); transition: width 0.25s ease;"></div>
      </div>
      <div class="tp-msg" style="font-size: 0.76rem; color: var(--text-secondary);"></div>
      <div class="tp-hint" style="display: none; font-size: 0.72rem; color: var(--accent-amber);"></div>
      <div class="tp-otp-wrap" style="display: none; margin-top: 4px;">
        <div style="display: flex; gap: 6px;">
          <input type="text" class="form-input tp-otp-input" placeholder="Masukkan kode OTP (5-6 digit)..." style="flex: 1; padding: 5px 8px; font-size: 0.78rem; font-family: 'JetBrains Mono', monospace;">
          <button type="button" class="btn btn-primary btn-sm tp-otp-submit" style="padding: 5px 10px; font-size: 0.75rem;">Kirim OTP</button>
        </div>
      </div>
      <div class="tp-2fa-wrap" style="display: none; margin-top: 4px;">
        <div style="display: flex; gap: 6px;">
          <input type="password" class="form-input tp-2fa-input" placeholder="Masukkan password 2FA..." style="flex: 1; padding: 5px 8px; font-size: 0.78rem;">
          <button type="button" class="btn btn-primary btn-sm tp-2fa-submit" style="padding: 5px 10px; font-size: 0.75rem;">Verifikasi 2FA</button>
        </div>
      </div>
      <div class="tp-output-wrap" style="display: none; gap: 6px; flex-wrap: wrap; margin-top: 2px;">
        <button type="button" class="btn btn-primary btn-sm tp-dl-btn" style="padding: 4px 10px; font-size: 0.73rem;">⬇️ .session</button>
        <button type="button" class="btn btn-secondary btn-sm tp-copy-btn" style="padding: 4px 10px; font-size: 0.73rem;">📋 Salin String</button>
      </div>
    `;

    card.querySelector('.tp-cancel-btn').addEventListener('click', async () => {
      const res = await fetch(`/api/transfer/cancel/${job.job_id}`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        updateParallelJobCard(card, data.job);
      }
    });

    card.querySelector('.tp-otp-submit').addEventListener('click', async () => {
      const input = card.querySelector('.tp-otp-input');
      const code = (input?.value || '').trim();
      if (!code) return;
      const res = await fetch(`/api/transfer/submit-code/${job.job_id}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (res.ok) {
        input.value = '';
        showToast('Kode OTP dikirim!', 'success');
      } else {
        showToast(data.detail || 'Gagal mengirim OTP', 'error');
      }
    });

    card.querySelector('.tp-2fa-submit').addEventListener('click', async () => {
      const input = card.querySelector('.tp-2fa-input');
      const password = input?.value || '';
      if (!password) return;
      const res = await fetch(`/api/transfer/submit-2fa/${job.job_id}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok) {
        input.value = '';
        showToast('Password 2FA dikirim!', 'success');
      } else {
        showToast(data.detail || 'Gagal mengirim password 2FA', 'error');
      }
    });

    card.querySelector('.tp-dl-btn').addEventListener('click', () => downloadJobSession(job.job_id));
    card.querySelector('.tp-copy-btn').addEventListener('click', () => copyJobStringSession(job.job_id));

    return card;
  }

  function updateParallelJobCard(card, job) {
    const status = job.status;
    const isTerminal = ['completed', 'partial_logout_uncertain', 'failed', 'cancelled'].includes(status);

    const titleEl = card.querySelector('.tp-title');
    const badgeEl = card.querySelector('.tp-badge');
    const barEl = card.querySelector('.tp-bar');
    const msgEl = card.querySelector('.tp-msg');
    const hintEl = card.querySelector('.tp-hint');
    const cancelBtn = card.querySelector('.tp-cancel-btn');
    const otpWrap = card.querySelector('.tp-otp-wrap');
    const twofaWrap = card.querySelector('.tp-2fa-wrap');
    const outWrap = card.querySelector('.tp-output-wrap');

    const titleParts = [];
    titleParts.push(job.display_name || `Akun #${job.dashboard_account_id || job.account_id || job.job_id}`);
    if (job.phone_masked) titleParts.push(`(${job.phone_masked})`);
    if (job.account_id) titleParts.push(`[TG: ${job.account_id}]`);
    if (titleEl) titleEl.textContent = titleParts.join(' ');

    applyStatusBadgeStyle(badgeEl, status);
    if (barEl) barEl.style.width = `${job.progress_pct || 0}%`;
    if (msgEl) msgEl.textContent = job.message || '-';

    if (hintEl) {
      if (job.code_delivery_hint && status === 'waiting_code') {
        hintEl.style.display = 'block';
        hintEl.textContent = `📩 ${job.code_delivery_hint}`;
      } else {
        hintEl.style.display = 'none';
      }
    }

    if (cancelBtn) cancelBtn.style.display = isTerminal ? 'none' : 'inline-flex';
    if (otpWrap) otpWrap.style.display = status === 'waiting_code' ? 'block' : 'none';
    if (twofaWrap) twofaWrap.style.display = status === 'waiting_2fa' ? 'block' : 'none';
    if (outWrap) outWrap.style.display = job.output_ready ? 'flex' : 'none';
  }

  function renderParallelBatchState(batch) {
    const panel = document.getElementById('transfer-progress-panel');
    const badge = document.getElementById('transfer-status-badge');
    const meta = document.getElementById('transfer-account-meta');
    const bar = document.getElementById('transfer-progress-bar');
    const msgEl = document.getElementById('transfer-status-message');
    const hintEl = document.getElementById('transfer-delivery-hint');
    const otpBox = document.getElementById('transfer-otp-box');
    const twofaBox = document.getElementById('transfer-2fa-box');
    const outputBox = document.getElementById('transfer-output-box');
    const batchBox = document.getElementById('transfer-batch-summary');
    const hdr = document.getElementById('transfer-batch-header');
    const list = document.getElementById('transfer-batch-results');
    const startBtn = document.getElementById('transfer-start-btn');
    const cancelBtn = document.getElementById('transfer-cancel-btn');

    if (!panel || !batchBox || !list) return;
    panel.style.display = 'block';
    batchBox.style.display = 'block';
    if (hintEl) hintEl.style.display = 'none';
    if (otpBox) otpBox.style.display = 'none';
    if (twofaBox) twofaBox.style.display = 'none';
    if (outputBox) outputBox.style.display = 'none';

    const jobs = batch.jobs || [];
    const okCount = (batch.completed || 0) + (batch.partial || 0);
    const total = Math.max(batch.total || jobs.length, 1);
    const avgPct = Math.round(jobs.reduce((sum, j) => sum + (j.progress_pct || 0), 0) / total);

    if (bar) bar.style.width = `${avgPct}%`;
    if (badge) {
      if (!batch.all_terminal) {
        badge.textContent = 'PARALEL BERJALAN';
        badge.style.background = 'rgba(0,212,255,0.15)';
        badge.style.color = 'var(--accent-cyan)';
        badge.style.borderColor = 'rgba(0,212,255,0.3)';
      } else if ((batch.failed || 0) === 0 && (batch.cancelled || 0) === 0) {
        badge.textContent = 'SELESAI';
        badge.style.background = 'rgba(16,185,129,0.2)';
        badge.style.color = 'var(--accent-green)';
        badge.style.borderColor = 'rgba(16,185,129,0.4)';
      } else {
        badge.textContent = 'SELESAI';
        badge.style.background = 'rgba(245,158,11,0.2)';
        badge.style.color = 'var(--accent-amber)';
        badge.style.borderColor = 'rgba(245,158,11,0.4)';
      }
    }

    if (meta) {
      meta.textContent = `Aktif: ${batch.running} • Antri Slot: ${batch.queued} • Selesai: ${batch.done}/${batch.total}`;
    }

    const modeLabel = batch.max_concurrent === 0 ? 'Semua Sekaligus' : `Maks ${batch.max_concurrent} bersamaan`;
    if (msgEl) {
      let msg = `Mode Paralel (${modeLabel}) — Berhasil: ${okCount} | Gagal: ${batch.failed}`;
      if (batch.cancelled) msg += ` | Batal: ${batch.cancelled}`;
      if (batch.waiting_input) msg += ` | Butuh OTP/2FA: ${batch.waiting_input}`;
      msgEl.textContent = msg;
    }

    if (hdr) {
      const skipTxt = batch.skipped && batch.skipped.length ? ` | Dilewati: ${batch.skipped.length}` : '';
      hdr.textContent = `Transfer Paralel: ${batch.done} / ${batch.total} selesai | Aktif: ${batch.running} | Berhasil: ${okCount} | Gagal: ${batch.failed}${skipTxt}`;
    }

    if (batch.skipped && batch.skipped.length) {
      batch.skipped.forEach(sk => {
        const skipKey = `skip_${sk.dashboard_account_id}`;
        if (!list.querySelector(`[data-skipped-id="${skipKey}"]`)) {
          const skipEl = document.createElement('div');
          skipEl.dataset.skippedId = skipKey;
          skipEl.style.cssText = 'padding: 6px 10px; border-radius: 6px; background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); color: var(--accent-amber); font-size: 0.76rem;';
          skipEl.textContent = `⚠️ Akun #${sk.dashboard_account_id} dilewati: ${sk.error}`;
          list.appendChild(skipEl);
        }
      });
    }

    jobs.forEach(job => {
      let card = list.querySelector(`[data-job-id="${job.job_id}"]`);
      if (!card) {
        card = createParallelJobCard(job);
        list.appendChild(card);
      }
      updateParallelJobCard(card, job);
    });

    if (startBtn) startBtn.disabled = !batch.all_terminal;
    if (cancelBtn) {
      cancelBtn.innerHTML = '<span>✕ Batalkan Semua</span>';
      cancelBtn.style.display = batch.all_terminal ? 'none' : 'inline-flex';
    }

    if (batch.all_terminal) {
      const wasActive = batchActive;
      batchActive = false;
      stopBatchPolling();
      if (wasActive) {
        loadTransferAccounts();
        if (window.loadAccounts) window.loadAccounts();
        showToast(`Transfer paralel selesai: ${okCount} berhasil, ${batch.failed || 0} gagal`, (batch.failed || 0) > 0 ? 'warning' : 'success');
      }
    }
  }

  function stopBatchPolling() {
    if (batchPollTimer) {
      clearInterval(batchPollTimer);
      batchPollTimer = null;
    }
  }

  function startBatchPolling(batchId) {
    stopBatchPolling();
    batchPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/transfer/batch/${batchId}`, { headers: getAuthOnlyHeaders() });
        if (!res.ok) return;
        const batch = await res.json();
        renderParallelBatchState(batch);
      } catch (e) {
        // ignore transient errors
      }
    }, 1200);
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
    const customTwofa = (document.getElementById('transfer-custom-2fa-input')?.value || '').trim();
    const batchBox = document.getElementById('transfer-batch-summary');
    const batchResultsEl = document.getElementById('transfer-batch-results');
    const startBtn = document.getElementById('transfer-start-btn');

    stopPolling();
    stopBatchPolling();

    if (mode === 'dashboard') {
      if (selectedTransferAccountIds.size === 0) {
        showToast('Pilih minimal satu akun dari daftar terlebih dahulu', 'warning');
        return;
      }
      if (selectedTransferAccountIds.size > 1) {
        const concurrencyRaw = parseInt(document.getElementById('transfer-concurrency-select')?.value ?? '0', 10);
        const maxConcurrent = Number.isNaN(concurrencyRaw) ? 0 : concurrencyRaw;
        if (startBtn) startBtn.disabled = true;

        try {
          const res = await fetch('/api/transfer/start-batch', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              account_ids: Array.from(selectedTransferAccountIds),
              auto_logout_old: autoLogout,
              save_to_dashboard: saveDash,
              max_concurrent: maxConcurrent,
              twofa_password: customTwofa || null
            })
          });
          const data = await res.json();
          if (!res.ok) {
            showToast(data.detail || 'Gagal memulai transfer paralel', 'error');
            if (startBtn) startBtn.disabled = false;
            return;
          }

          activeTransferJobId = null;
          activeBatchId = data.batch.batch_id;
          batchActive = true;
          if (batchResultsEl) batchResultsEl.innerHTML = '';
          renderParallelBatchState(data.batch);
          if (!data.batch.all_terminal) {
            startBatchPolling(activeBatchId);
          }
          if (data.batch.skipped && data.batch.skipped.length > 0) {
            showToast(`${data.batch.skipped.length} akun dilewati (sedang diproses atau tidak ditemukan)`, 'warning');
          }
        } catch (e) {
          showToast('Koneksi ke server gagal', 'error');
          if (startBtn) startBtn.disabled = false;
        }
        return;
      }
    }

    activeBatchId = null;
    batchActive = false;
    if (batchBox) batchBox.style.display = 'none';
    if (batchResultsEl) batchResultsEl.innerHTML = '';

    const formData = new FormData();
    formData.append('source_type', mode);
    formData.append('auto_logout_old', autoLogout ? 'true' : 'false');
    formData.append('save_to_dashboard', saveDash ? 'true' : 'false');
    if (customTwofa) {
      formData.append('twofa_password', customTwofa);
    }

    if (mode === 'dashboard') {
      const singleId = Array.from(selectedTransferAccountIds)[0];
      formData.append('dashboard_account_id', String(singleId));
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

    const selectAllBtn = document.getElementById('transfer-select-all-btn');
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        getFilteredTransferAccounts().forEach(acc => selectedTransferAccountIds.add(acc.id));
        renderTransferAccountList();
      });
    }

    const deselectAllBtn = document.getElementById('transfer-deselect-all-btn');
    if (deselectAllBtn) {
      deselectAllBtn.addEventListener('click', () => {
        selectedTransferAccountIds.clear();
        renderTransferAccountList();
      });
    }

    const startBtn = document.getElementById('transfer-start-btn');
    if (startBtn) startBtn.addEventListener('click', startTransfer);

    const cancelBtn = document.getElementById('transfer-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (batchActive && activeBatchId) {
          const res = await fetch(`/api/transfer/cancel-batch/${activeBatchId}`, {
            method: 'POST',
            headers: getAuthHeaders()
          });
          if (res.ok) {
            const data = await res.json();
            renderParallelBatchState(data.batch);
            showToast('Semua proses transfer paralel yang masih berjalan dibatalkan', 'info');
          }
          return;
        }
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

