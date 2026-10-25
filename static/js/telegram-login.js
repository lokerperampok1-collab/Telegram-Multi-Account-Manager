// State for login wizards
let currentPhoneToken = null;
let currentQRToken = null;
let qrPollInterval = null;
let qrCountdownTimer = null;
let qrTimeLeft = 30;

// ------------------- PHONE LOGIN FLOW -------------------

document.addEventListener('DOMContentLoaded', () => {
  const sendPhoneBtn = document.getElementById('send-phone-btn') || document.getElementById('send-code-btn');
  const verifyOtpBtn = document.getElementById('verify-otp-btn');
  const cancelOtpBtn = document.getElementById('cancel-otp-btn');
  const verify2faBtn = document.getElementById('verify-2fa-btn');
  const cancel2faBtn = document.getElementById('cancel-2fa-btn');

  if (sendPhoneBtn) {
    sendPhoneBtn.addEventListener('click', async () => {
      const phoneInput = document.getElementById('phone-input');
      const phone = phoneInput.value.trim();

      if (!phone) {
        showToast('Harap masukkan nomor telepon', 'error');
        return;
      }

      sendPhoneBtn.disabled = true;
      sendPhoneBtn.innerHTML = '<div class="spinner"></div> Mengirim...';

      try {
        const res = await fetch('/api/telegram/login/phone', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ phone })
        });
        const data = await res.json();

        if (res.ok && data.status === 'success') {
          currentPhoneToken = data.token;
          document.getElementById('otp-phone-target').textContent = `Kode dikirim ke ${data.phone}`;
          document.getElementById('phone-step-1').style.display = 'none';
          document.getElementById('phone-step-2').style.display = 'block';
          document.getElementById('otp-input').focus();
          showToast(data.message || 'Kode OTP terkirim!', 'success');
        } else {
          showToast(data.detail || data.message || 'Gagal mengirim kode', 'error');
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        sendPhoneBtn.disabled = false;
        sendPhoneBtn.innerHTML = '<span>Kirim Kode Verifikasi</span>';
      }
    });
  }

  if (verifyOtpBtn) {
    verifyOtpBtn.addEventListener('click', async () => {
      const otpInput = document.getElementById('otp-input');
      const code = otpInput.value.trim();

      if (!code) {
        showToast('Harap masukkan kode OTP', 'error');
        return;
      }

      verifyOtpBtn.disabled = true;
      verifyOtpBtn.innerHTML = '<div class="spinner"></div>';

      try {
        const res = await fetch('/api/telegram/login/code', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ token: currentPhoneToken, code })
        });
        const data = await res.json();

        if (res.ok) {
          if (data.status === '2fa_required') {
            document.getElementById('phone-step-2').style.display = 'none';
            document.getElementById('phone-step-3').style.display = 'block';
            document.getElementById('twofa-input').focus();
            showToast('Akun memerlukan password 2FA', 'info');
          } else if (data.status === 'success') {
            showToast(data.message || 'Akun Telegram berhasil terhubung!', 'success');
            resetPhoneWizard();
            if (window.loadAccounts) window.loadAccounts();
          }
        } else {
          showToast(data.detail || data.message || 'Verifikasi gagal', 'error');
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        verifyOtpBtn.disabled = false;
        verifyOtpBtn.innerHTML = 'Verifikasi Kode';
      }
    });
  }

  if (verify2faBtn) {
    verify2faBtn.addEventListener('click', async () => {
      const twofaInput = document.getElementById('twofa-input');
      const password = twofaInput.value;

      if (!password) {
        showToast('Harap masukkan password 2FA', 'error');
        return;
      }

      verify2faBtn.disabled = true;
      verify2faBtn.innerHTML = '<div class="spinner"></div>';

      try {
        const res = await fetch('/api/telegram/login/2fa', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ token: currentPhoneToken, password })
        });
        const data = await res.json();

        if (res.ok && data.status === 'success') {
          showToast(data.message || 'Berhasil masuk akun!', 'success');
          resetPhoneWizard();
          if (window.loadAccounts) window.loadAccounts();
        } else {
          showToast(data.detail || data.message || 'Password 2FA salah', 'error');
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        verify2faBtn.disabled = false;
        verify2faBtn.innerHTML = 'Konfirmasi Password';
      }
    });
  }

  if (cancelOtpBtn) {
    cancelOtpBtn.addEventListener('click', resetPhoneWizard);
  }
  if (cancel2faBtn) {
    cancel2faBtn.addEventListener('click', resetPhoneWizard);
  }
});

function resetPhoneWizard() {
  currentPhoneToken = null;
  const step1 = document.getElementById('phone-step-1');
  const step2 = document.getElementById('phone-step-2');
  const step3 = document.getElementById('phone-step-3');
  const phoneInput = document.getElementById('phone-input');
  const otpInput = document.getElementById('otp-input');
  const twofaInput = document.getElementById('twofa-input');

  if (step1) step1.style.display = 'block';
  if (step2) step2.style.display = 'none';
  if (step3) step3.style.display = 'none';
  if (phoneInput) phoneInput.value = '';
  if (otpInput) otpInput.value = '';
  if (twofaInput) twofaInput.value = '';
}

// ------------------- QR CODE LOGIN FLOW -------------------

window.startQRFlow = async function() {
  clearInterval(qrPollInterval);
  clearInterval(qrCountdownTimer);

  const loader = document.getElementById('qr-loader');
  const img = document.getElementById('qr-image');
  const timerText = document.getElementById('qr-timer-text');
  const refreshBtn = document.getElementById('refresh-qr-btn');
  const box = document.getElementById('qr-box');

  // Remove existing expired overlay if any
  if (box) {
    const oldOv = box.querySelector('.qr-box-expired-overlay');
    if (oldOv) oldOv.remove();
  }

  if (loader) loader.style.display = 'block';
  if (img) img.style.display = 'none';
  if (timerText) timerText.textContent = 'Menghubungkan ke Telegram...';

  try {
    const res = await fetch('/api/telegram/login/qr/start', {
      method: 'POST',
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (res.ok && data.status === 'success') {
      currentQRToken = data.token;
      if (img) {
        img.src = data.qr_image;
        img.style.display = 'block';
      }
      if (loader) loader.style.display = 'none';

      // Start countdown
      qrTimeLeft = data.expires_in || 30;
      updateQRTimerDisplay();
      qrCountdownTimer = setInterval(() => {
        qrTimeLeft--;
        updateQRTimerDisplay();
        if (qrTimeLeft <= 0) {
          clearInterval(qrCountdownTimer);
          if (timerText) timerText.innerHTML = '<span style="color: var(--accent-rose);">QR Code kedaluwarsa. Klik untuk buat baru.</span>';
          
          if (box && !box.querySelector('.qr-box-expired-overlay')) {
            const ov = document.createElement('div');
            ov.className = 'qr-box-expired-overlay';
            ov.innerHTML = `
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
              <span>QR Kedaluwarsa</span>
              <small style="color: #94a3b8; font-size: 0.8rem;">Klik untuk refresh QR</small>
            `;
            ov.onclick = () => window.startQRFlow();
            box.appendChild(ov);
          }
        }
      }, 1000);

      // Start polling status
      startQRPolling(currentQRToken);
    } else {
      if (timerText) timerText.textContent = data.detail || 'Gagal membuat QR Code';
      if (loader) loader.style.display = 'none';
    }
  } catch (err) {
    if (timerText) timerText.textContent = 'Gagal terhubung ke server';
    if (loader) loader.style.display = 'none';
  }
};

function updateQRTimerDisplay() {
  const timerText = document.getElementById('qr-timer-text');
  if (timerText && qrTimeLeft > 0) {
    timerText.textContent = `Pindai QR ini (Kedaluwarsa dalam ${qrTimeLeft}s)`;
  }
}

function startQRPolling(token) {
  qrPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/telegram/login/qr/status/${token}`, {
        headers: getAuthHeaders()
      });
      const data = await res.json();

      if (data.status === 'success') {
        clearInterval(qrPollInterval);
        clearInterval(qrCountdownTimer);
        showToast('Login QR Code berhasil! Akun tersimpan.', 'success');
        const timerText = document.getElementById('qr-timer-text');
        if (timerText) timerText.innerHTML = '<span style="color: var(--accent-green);">✓ Berhasil terhubung!</span>';
        if (window.loadAccounts) window.loadAccounts();
      } else if (data.status === '2fa_needed') {
        clearInterval(qrPollInterval);
        clearInterval(qrCountdownTimer);
        const pw = prompt('Akun ini dilindungi 2FA. Masukkan password 2FA Anda:');
        if (pw) {
          submitQR2FA(token, pw);
        }
      } else if (data.status === 'expired') {
        clearInterval(qrPollInterval);
      }
    } catch (e) {}
  }, 2500);
}

async function submitQR2FA(token, password) {
  showToast('Memverifikasi password 2FA...', 'info');
  try {
    const res = await fetch('/api/telegram/login/2fa', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token, password })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      showToast('Login 2FA berhasil!', 'success');
      if (window.loadAccounts) window.loadAccounts();
    } else {
      showToast(data.detail || data.message || 'Password salah', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const refreshQrBtn = document.getElementById('refresh-qr-btn');
  if (refreshQrBtn) {
    refreshQrBtn.addEventListener('click', () => {
      if (window.startQRFlow) window.startQRFlow();
    });
  }
});

// ------------------- BULK LOGIN FLOW -------------------

document.addEventListener('DOMContentLoaded', () => {
  const startBulkBtn = document.getElementById('start-bulk-btn');
  const bulkPhones = document.getElementById('bulk-phones');
  const bulkResults = document.getElementById('bulk-results');

  if (startBulkBtn && bulkPhones && bulkResults) {
    startBulkBtn.addEventListener('click', async () => {
      const text = bulkPhones.value.trim();
      if (!text) {
        showToast('Masukkan minimal satu nomor telepon', 'error');
        return;
      }

      const phones = text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
      if (phones.length === 0) {
        showToast('Tidak ada nomor valid ditemukan', 'error');
        return;
      }

      startBulkBtn.disabled = true;
      startBulkBtn.innerHTML = '<div class="spinner"></div> Memproses antrean...';
      bulkResults.style.display = 'flex';
      bulkResults.innerHTML = '<div style="color: var(--text-secondary); padding: 8px;">Mengirim OTP ke daftar nomor...</div>';

      try {
        const res = await fetch('/api/telegram/login/bulk', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ phones })
        });
        const data = await res.json();

        if (res.ok && data.results) {
          bulkResults.innerHTML = data.results.map((r, index) => {
            const isOk = r.status === 'success';
            const isSkipped = r.status === 'skipped';
            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${r.phone}</span>
                  <div style="font-size: 0.75rem; color: ${isSkipped ? 'var(--accent-amber)' : 'var(--text-muted)'};">${r.message || ''}</div>
                </div>
                <div>
                  ${isOk ? `
                    <button class="btn btn-primary btn-sm" onclick="promptBulkOtp('${r.token}', '${r.phone}')">
                      Isi OTP
                    </button>
                  ` : isSkipped ? `
                    <span class="badge-status" style="background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); border: 1px solid rgba(245, 158, 11, 0.3);">Dilewati</span>
                  ` : `
                    <span class="badge-status error">Gagal</span>
                  `}
                </div>
              </div>
            `;
          }).join('');
          showToast(`Selesai memproses ${data.results.length} nomor`, 'info');
        } else {
          bulkResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${data.detail || 'Gagal memproses bulk'}</div>`;
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        startBulkBtn.disabled = false;
        startBulkBtn.innerHTML = '<span>Mulai Request Semua Nomor</span>';
      }
    });
  }
});

async function promptBulkOtp(token, phone) {
  const code = prompt(`Masukkan kode verifikasi Telegram untuk nomor ${phone}:`);
  if (!code) return;

  try {
    const res = await fetch('/api/telegram/login/code', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ token, code: code.trim() })
    });
    const data = await res.json();

    if (res.ok) {
      if (data.status === '2fa_required') {
        const pw = prompt(`Nomor ${phone} memerlukan 2FA. Masukkan password 2FA:`);
        if (pw) {
          const res2fa = await fetch('/api/telegram/login/2fa', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ token, password: pw })
          });
          const data2fa = await res2fa.json();
          if (res2fa.ok && data2fa.status === 'success') {
            showToast(`Akun ${phone} berhasil terhubung!`, 'success');
            if (window.loadAccounts) window.loadAccounts();
          } else {
            showToast(data2fa.detail || '2FA gagal', 'error');
          }
        }
      } else if (data.status === 'success') {
        showToast(`Akun ${phone} berhasil terhubung!`, 'success');
        if (window.loadAccounts) window.loadAccounts();
      }
    } else {
      showToast(data.detail || data.message || 'OTP salah', 'error');
    }
  } catch (e) {
    showToast('Koneksi server gagal', 'error');
  }
}

// ------------------- JOIN GROUP FLOW -------------------

document.addEventListener('DOMContentLoaded', () => {
  const joinRadioAll = document.getElementById('join-target-all');
  const joinRadioSelected = document.getElementById('join-target-selected');
  const checklistContainer = document.getElementById('join-account-checklist');
  const joinItemsContainer = document.getElementById('join-account-items');
  const joinSelectAll = document.getElementById('join-select-all');
  const joinSelectNone = document.getElementById('join-select-none');
  const joinSelectOnline = document.getElementById('join-select-online');
  const joinSearchAccounts = document.getElementById('join-search-accounts');
  const startJoinBtn = document.getElementById('start-join-btn');
  const joinGroupLink = document.getElementById('join-group-link');
  const joinDelayInput = document.getElementById('join-delay');
  const joinResults = document.getElementById('join-results');

  let cachedJoinAccounts = [];

  function renderJoinChecklist(accounts) {
    if (!joinItemsContainer) return;
    if (accounts.length === 0) {
      joinItemsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 4px;">Tidak ada akun yang sesuai</div>';
      return;
    }

    joinItemsContainer.innerHTML = accounts.map(acc => {
      const name = acc.display_name || acc.username || acc.phone_number || `Akun #${acc.id}`;
      const isOnline = acc.is_active;
      return `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; margin-bottom: 4px; cursor: pointer;">
          <input type="checkbox" class="join-acc-checkbox" value="${acc.id}" data-online="${isOnline ? '1' : '0'}">
          <span>${name} (${acc.phone_number || 'Tanpa no.'}) ${isOnline ? '<span style="color: var(--accent-green);">●</span>' : '<span style="color: var(--text-muted);">○</span>'}</span>
        </label>
      `;
    }).join('');
  }

  async function populateJoinChecklist() {
    if (!joinItemsContainer) return;
    try {
      const res = await fetch('/api/accounts?limit=0', { headers: getAuthHeaders() });
      const data = await res.json();
      cachedJoinAccounts = data.accounts || [];
      renderJoinChecklist(cachedJoinAccounts);
    } catch (e) {
      joinItemsContainer.innerHTML = '<div style="color: var(--accent-rose); font-size: 0.8rem;">Gagal memuat daftar akun</div>';
    }
  }

  if (joinSelectAll) {
    joinSelectAll.addEventListener('click', () => {
      document.querySelectorAll('.join-acc-checkbox').forEach(cb => cb.checked = true);
    });
  }
  if (joinSelectNone) {
    joinSelectNone.addEventListener('click', () => {
      document.querySelectorAll('.join-acc-checkbox').forEach(cb => cb.checked = false);
    });
  }
  if (joinSelectOnline) {
    joinSelectOnline.addEventListener('click', () => {
      document.querySelectorAll('.join-acc-checkbox').forEach(cb => {
        cb.checked = cb.getAttribute('data-online') === '1';
      });
    });
  }
  if (joinSearchAccounts) {
    joinSearchAccounts.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = cachedJoinAccounts.filter(acc => {
        const name = (acc.display_name || '').toLowerCase();
        const user = (acc.username || '').toLowerCase();
        const phone = (acc.phone_number || '').toLowerCase();
        return name.includes(q) || user.includes(q) || phone.includes(q);
      });
      renderJoinChecklist(filtered);
    });
  }

  if (joinRadioAll && joinRadioSelected && checklistContainer) {
    joinRadioAll.addEventListener('change', () => {
      checklistContainer.style.display = 'none';
    });

    joinRadioSelected.addEventListener('change', () => {
      checklistContainer.style.display = 'block';
      populateJoinChecklist();
    });
  }

  if (startJoinBtn && joinGroupLink && joinResults) {
    startJoinBtn.addEventListener('click', async () => {
      const link = joinGroupLink.value.trim();
      if (!link) {
        showToast('Masukkan link atau username grup Telegram', 'error');
        return;
      }

      let targetAccountIds = null;
      if (joinRadioSelected && joinRadioSelected.checked) {
        const checkedBoxes = document.querySelectorAll('.join-acc-checkbox:checked');
        targetAccountIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
        if (targetAccountIds.length === 0) {
          showToast('Pilih minimal satu akun untuk bergabung', 'error');
          return;
        }
      }

      const delaySeconds = parseInt(joinDelayInput.value) || 3;

      startJoinBtn.disabled = true;
      startJoinBtn.innerHTML = '<div class="spinner"></div> Menjalankan proses join grup...';
      joinResults.style.display = 'flex';
      joinResults.innerHTML = '<div style="color: var(--text-secondary); padding: 8px;">Memproses akun untuk bergabung ke grup...</div>';

      if (window.OperationManager) {
        window.OperationManager.setRunning(`Join Grup Massal (${link})`, 'cancel-join-btn');
      }

      try {
        const res = await fetch('/api/accounts/join-group', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            group_link: link,
            account_ids: targetAccountIds,
            delay_seconds: delaySeconds
          })
        });
        const data = await res.json();

        if (res.ok && data.results) {
          joinResults.innerHTML = data.results.map(r => {
            let badgeClass = 'error';
            let badgeText = 'Gagal';

            if (r.status === 'success') {
              badgeClass = 'success';
              badgeText = 'Berhasil';
            } else if (r.status === 'already_joined') {
              badgeClass = 'waiting';
              badgeText = 'Sudah Gabung';
            } else if (r.status === 'flood_wait') {
              badgeClass = 'error';
              badgeText = 'Flood Limit';
            } else if (r.status === 'cancelled') {
              badgeClass = 'waiting';
              badgeText = '⛔ Dihentikan';
            }

            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${r.name || 'Akun'}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${r.message}</div>
                </div>
                <div>
                  <span class="badge-status ${badgeClass}">${badgeText}</span>
                </div>
              </div>
            `;
          }).join('');

          showToast('Proses join grup selesai!', 'info');
          if (window.loadAccounts) window.loadAccounts();
        } else {
          joinResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${data.detail || 'Gagal menjalankan aksi join grup'}</div>`;
        }
      } catch (err) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        startJoinBtn.disabled = false;
        startJoinBtn.innerHTML = '<span>🚀 Jalankan Join Grup</span>';
        if (window.OperationManager) {
          window.OperationManager.setFinished('cancel-join-btn');
        }
      }
    });
  }

  // ------------------- MASS PROFILE UPDATE FLOW -------------------

  const profileRadioAll = document.getElementById('profile-target-all');
  const profileRadioSelected = document.getElementById('profile-target-selected');
  const profileChecklist = document.getElementById('profile-account-checklist');
  const profileItemsContainer = document.getElementById('profile-account-items');
  const profileSelectAll = document.getElementById('profile-select-all');
  const profileSelectNone = document.getElementById('profile-select-none');
  const profileSelectOnline = document.getElementById('profile-select-online');
  const profileSearchAccounts = document.getElementById('profile-search-accounts');
  const startProfileBtn = document.getElementById('start-profile-btn');
  const profileFirstName = document.getElementById('profile-firstname');
  const profileLastName = document.getElementById('profile-lastname');
  const profileAbout = document.getElementById('profile-about');
  const profilePhoto = document.getElementById('profile-photo');
  const profileDelay = document.getElementById('profile-delay');
  const profileResults = document.getElementById('profile-results');

  let cachedProfileAccounts = [];

  function renderProfileChecklist(accounts) {
    if (!profileItemsContainer) return;
    if (accounts.length === 0) {
      profileItemsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 4px;">Tidak ada akun yang sesuai</div>';
      return;
    }

    profileItemsContainer.innerHTML = accounts.map(acc => {
      const name = acc.display_name || acc.username || acc.phone_number || `Akun #${acc.id}`;
      const isOnline = acc.is_active;
      return `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; margin-bottom: 4px; cursor: pointer;">
          <input type="checkbox" class="profile-acc-checkbox" value="${acc.id}" data-online="${isOnline ? '1' : '0'}">
          <span>${name} (${acc.phone_number || 'Tanpa no.'}) ${isOnline ? '<span style="color: var(--accent-green);">●</span>' : '<span style="color: var(--text-muted);">○</span>'}</span>
        </label>
      `;
    }).join('');
  }

  async function populateProfileChecklist() {
    if (!profileItemsContainer) return;
    try {
      const res = await fetch('/api/accounts?limit=0', { headers: getAuthHeaders() });
      const data = await res.json();
      cachedProfileAccounts = data.accounts || [];
      renderProfileChecklist(cachedProfileAccounts);
    } catch (e) {
      profileItemsContainer.innerHTML = '<div style="color: var(--accent-rose); font-size: 0.8rem;">Gagal memuat akun</div>';
    }
  }

  if (profileSelectAll) {
    profileSelectAll.addEventListener('click', () => {
      document.querySelectorAll('.profile-acc-checkbox').forEach(cb => cb.checked = true);
    });
  }
  if (profileSelectNone) {
    profileSelectNone.addEventListener('click', () => {
      document.querySelectorAll('.profile-acc-checkbox').forEach(cb => cb.checked = false);
    });
  }
  if (profileSelectOnline) {
    profileSelectOnline.addEventListener('click', () => {
      document.querySelectorAll('.profile-acc-checkbox').forEach(cb => {
        cb.checked = cb.getAttribute('data-online') === '1';
      });
    });
  }
  if (profileSearchAccounts) {
    profileSearchAccounts.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = cachedProfileAccounts.filter(acc => {
        const name = (acc.display_name || '').toLowerCase();
        const user = (acc.username || '').toLowerCase();
        const phone = (acc.phone_number || '').toLowerCase();
        return name.includes(q) || user.includes(q) || phone.includes(q);
      });
      renderProfileChecklist(filtered);
    });
  }

  if (profileRadioAll && profileRadioSelected && profileChecklist) {
    profileRadioAll.addEventListener('change', () => {
      profileChecklist.style.display = 'none';
    });
    profileRadioSelected.addEventListener('change', () => {
      profileChecklist.style.display = 'block';
      populateProfileChecklist();
    });
  }

  if (startProfileBtn && profileResults) {
    startProfileBtn.addEventListener('click', async () => {
      const firstName = profileFirstName.value.trim();
      const lastName = profileLastName.value.trim();
      const about = profileAbout.value.trim();
      const hasPhoto = profilePhoto.files && profilePhoto.files.length > 0;

      if (!firstName && !lastName && !about && !hasPhoto) {
        showToast('Isi minimal satu kolom (Nama, Bio, atau Foto Profil)', 'error');
        return;
      }

      let targetIds = null;
      if (profileRadioSelected && profileRadioSelected.checked) {
        const checkedBoxes = document.querySelectorAll('.profile-acc-checkbox:checked');
        targetIds = Array.from(checkedBoxes).map(cb => cb.value);
        if (targetIds.length === 0) {
          showToast('Pilih minimal satu akun target', 'error');
          return;
        }
      }

      const delay = parseInt(profileDelay.value) || 3;

      const formData = new FormData();
      if (firstName) formData.append('first_name', firstName);
      if (lastName) formData.append('last_name', lastName);
      if (about) formData.append('about', about);
      if (targetIds) formData.append('account_ids', targetIds.join(','));
      formData.append('delay_seconds', delay);
      if (hasPhoto) {
        formData.append('photo', profilePhoto.files[0]);
      }

      startProfileBtn.disabled = true;
      startProfileBtn.innerHTML = '<div class="spinner"></div> Mengubah profil massal...';
      profileResults.style.display = 'flex';
      profileResults.innerHTML = '<div style="color: var(--text-secondary); padding: 8px;">Memperbarui profil akun...</div>';

      if (window.OperationManager) {
        window.OperationManager.setRunning('Update Profil Akun Massal', 'cancel-profile-btn');
      }

      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/accounts/update-profile', {
          method: 'POST',
          headers: {
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: formData
        });
        const data = await res.json();

        if (res.ok && data.results) {
          profileResults.innerHTML = data.results.map(r => {
            const isOk = r.status === 'success';
            const isCancelled = r.status === 'cancelled';
            const badgeClass = isCancelled ? 'waiting' : (isOk ? 'success' : 'error');
            const badgeText = isCancelled ? '⛔ Dihentikan' : (isOk ? 'Berhasil' : 'Gagal');

            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${r.name || 'Akun'}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${r.message}</div>
                </div>
                <div>
                  <span class="badge-status ${badgeClass}">${badgeText}</span>
                </div>
              </div>
            `;
          }).join('');
          showToast('Pembaruan profil massal selesai!', 'success');
          if (window.loadAccounts) window.loadAccounts();
        } else {
          profileResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${data.detail || 'Gagal mengubah profil'}</div>`;
        }
      } catch (e) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        startProfileBtn.disabled = false;
        startProfileBtn.innerHTML = '<span>👤 Terapkan Profil ke Semua Akun</span>';
        if (window.OperationManager) {
          window.OperationManager.setFinished('cancel-profile-btn');
        }
      }
    });
  }

  // ------------------- UPLOAD & IMPORT SESSION FLOW -------------------

  // Tab Switching (Upload Files vs Paste Text)
  const tabUploadBtn = document.getElementById('tab-upload-files-btn');
  const tabPasteBtn = document.getElementById('tab-paste-text-btn');
  const paneUpload = document.getElementById('pane-upload-files');
  const panePaste = document.getElementById('pane-paste-text');

  if (tabUploadBtn && tabPasteBtn && paneUpload && panePaste) {
    tabUploadBtn.addEventListener('click', () => {
      tabUploadBtn.classList.add('active');
      tabPasteBtn.classList.remove('active');
      paneUpload.style.display = 'block';
      panePaste.style.display = 'none';
    });

    tabPasteBtn.addEventListener('click', () => {
      tabPasteBtn.classList.add('active');
      tabUploadBtn.classList.remove('active');
      panePaste.style.display = 'block';
      paneUpload.style.display = 'none';
    });
  }

  // Multiple File Upload Controller
  let selectedSessionFiles = [];
  const sessionDropzone = document.getElementById('session-dropzone');
  const fileInput = document.getElementById('upload-sessions-file-input');
  const browseBtn = document.getElementById('btn-browse-session-files');
  const filesSummary = document.getElementById('selected-files-summary');
  const filesCount = document.getElementById('selected-files-count');
  const filesList = document.getElementById('selected-files-list');
  const clearFilesBtn = document.getElementById('btn-clear-selected-files');
  const startUploadBtn = document.getElementById('start-upload-sessions-btn');
  const importResults = document.getElementById('import-results');

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function updateSelectedFilesUI() {
    if (!filesSummary || !filesCount || !filesList || !startUploadBtn) return;

    if (selectedSessionFiles.length === 0) {
      filesSummary.style.display = 'none';
      startUploadBtn.disabled = true;
      startUploadBtn.innerHTML = '<span>🚀 Unggah & Hubungkan Semua Sesi</span>';
      return;
    }

    filesSummary.style.display = 'block';
    startUploadBtn.disabled = false;
    const totalBytes = selectedSessionFiles.reduce((acc, f) => acc + f.size, 0);
    filesCount.textContent = `${selectedSessionFiles.length} File Dipilih (${formatBytes(totalBytes)})`;
    startUploadBtn.innerHTML = `<span>🚀 Unggah & Hubungkan ${selectedSessionFiles.length} File Sesi</span>`;

    filesList.innerHTML = selectedSessionFiles.map((f, idx) => `
      <div class="selected-file-chip">
        <span class="file-name" title="${escapeHtml(f.name)}">📄 ${escapeHtml(f.name)}</span>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="file-size">${formatBytes(f.size)}</span>
          <button type="button" class="btn-clean-files" onclick="window.removeSelectedSessionFile(${idx})" title="Hapus file ini" style="font-size: 0.9rem;">✕</button>
        </div>
      </div>
    `).join('');
  }

  window.removeSelectedSessionFile = function(index) {
    if (index >= 0 && index < selectedSessionFiles.length) {
      selectedSessionFiles.splice(index, 1);
      updateSelectedFilesUI();
    }
  };

  if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', () => {
      selectedSessionFiles = [];
      if (fileInput) fileInput.value = '';
      updateSelectedFilesUI();
    });
  }

  if (browseBtn && fileInput) {
    browseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (sessionDropzone && fileInput) {
    sessionDropzone.addEventListener('click', () => {
      fileInput.click();
    });

    sessionDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      sessionDropzone.classList.add('dragover');
    });

    sessionDropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      sessionDropzone.classList.add('dragover');
    });

    sessionDropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      sessionDropzone.classList.remove('dragover');
    });

    sessionDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      sessionDropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files) {
        addFilesToList(Array.from(e.dataTransfer.files));
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files) {
        addFilesToList(Array.from(e.target.files));
      }
    });
  }

  function addFilesToList(newFiles) {
    for (const f of newFiles) {
      // Cek duplikat berdasarkan nama dan ukuran
      const exists = selectedSessionFiles.some(existing => existing.name === f.name && existing.size === f.size);
      if (!exists) {
        selectedSessionFiles.push(f);
      }
    }
    updateSelectedFilesUI();
  }

  // Upload and process files
  if (startUploadBtn && importResults) {
    startUploadBtn.addEventListener('click', async () => {
      if (selectedSessionFiles.length === 0) {
        showToast('Pilih minimal satu file sesi Telethon', 'error');
        return;
      }

      startUploadBtn.disabled = true;
      startUploadBtn.innerHTML = `<div class="spinner"></div> Mengunggah & Memproses ${selectedSessionFiles.length} File Sesi...`;
      importResults.style.display = 'flex';
      importResults.innerHTML = '<div style="color: var(--accent-cyan); padding: 12px;"><div class="spinner" style="display:inline-block; width:14px; height:14px;"></div> Membaca sesi, memverifikasi otorisasi akun Telegram, dan menyimpan ke database...</div>';

      const formData = new FormData();
      for (const file of selectedSessionFiles) {
        formData.append('files', file);
      }

      try {
        const token = localStorage.getItem('token');
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/accounts/upload-sessions', {
          method: 'POST',
          headers: headers,
          body: formData
        });
        const data = await res.json();

        if (res.ok && data.results) {
          const successCount = data.success_count || 0;
          const failedCount = data.failed_count || 0;

          let html = `
            <div style="padding: 10px 12px; background: rgba(0, 212, 255, 0.08); border-radius: 8px; margin-bottom: 10px; border: 1px solid rgba(0, 212, 255, 0.2);">
              <strong style="color: var(--accent-cyan);">${data.message || 'Proses Selesai'}</strong>
              <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px;">
                File: <strong>${data.total_files}</strong> | Sesi Ditemukan: <strong>${data.total_extracted}</strong> | Berhasil: <strong style="color: var(--accent-green);">${successCount}</strong> | Gagal: <strong style="color: var(--accent-rose);">${failedCount}</strong>
              </div>
            </div>
          `;

          html += data.results.map(r => {
            const isOk = r.status === 'success';
            const sourceLabel = r.source_file ? `<span style="font-size: 0.72rem; color: var(--accent-cyan); margin-left: 6px;">[${escapeHtml(r.source_file)}]</span>` : '';
            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${escapeHtml(r.name || r.phone || 'Sesi Akun')}</span>${sourceLabel}
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(r.message || '')}</div>
                </div>
                <div>
                  <span class="badge-status ${isOk ? 'success' : 'error'}">${isOk ? 'Berhasil' : 'Gagal'}</span>
                </div>
              </div>
            `;
          }).join('');

          importResults.innerHTML = html;
          showToast(`Selesai: ${successCount} akun berhasil diimpor, ${failedCount} gagal`, successCount > 0 ? 'success' : 'warning');

          // Reset file list on success
          selectedSessionFiles = [];
          if (fileInput) fileInput.value = '';
          updateSelectedFilesUI();

          if (window.loadAccounts) window.loadAccounts();
        } else {
          importResults.innerHTML = `<div style="color: var(--accent-rose); padding: 10px;">⚠️ ${escapeHtml(data.detail || data.message || 'Gagal mengunggah file sesi')}</div>`;
          showToast(data.detail || data.message || 'Gagal mengunggah sesi', 'error');
        }
      } catch (err) {
        importResults.innerHTML = '<div style="color: var(--accent-rose); padding: 10px;">⚠️ Koneksi ke server gagal atau terputus</div>';
        showToast('Koneksi server gagal', 'error');
      } finally {
        startUploadBtn.disabled = false;
        startUploadBtn.innerHTML = '<span>🚀 Unggah & Hubungkan Semua Sesi</span>';
      }
    });
  }

  // Paste Text StringSession Handler
  const startImportBtn = document.getElementById('start-import-btn');
  const importTextarea = document.getElementById('import-sessions-text');

  if (startImportBtn && importTextarea && importResults) {
    startImportBtn.addEventListener('click', async () => {
      const rawText = importTextarea.value.trim();
      if (!rawText) {
        showToast('Masukkan minimal satu StringSession', 'error');
        return;
      }

      const sessions = rawText.split('\n').map(s => s.trim()).filter(s => s.length > 0);
      if (sessions.length === 0) {
        showToast('Tidak ada session string yang valid ditemukan', 'error');
        return;
      }

      startImportBtn.disabled = true;
      startImportBtn.innerHTML = '<div class="spinner"></div> Mengimpor sesi Telegram...';
      importResults.style.display = 'flex';
      importResults.innerHTML = '<div style="color: var(--text-secondary); padding: 8px;">Memverifikasi dan menyimpan sesi akun...</div>';

      try {
        const res = await fetch('/api/accounts/import-sessions', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ sessions })
        });
        const data = await res.json();

        if (res.ok && data.results) {
          importResults.innerHTML = data.results.map(r => {
            const isOk = r.status === 'success';
            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${escapeHtml(r.name || r.phone || 'Sesi')}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(r.message || '')}</div>
                </div>
                <div>
                  <span class="badge-status ${isOk ? 'success' : 'error'}">${isOk ? 'Berhasil' : 'Gagal'}</span>
                </div>
              </div>
            `;
          }).join('');
          showToast(`Selesai memproses ${data.results.length} StringSession`, 'info');
          importTextarea.value = '';
          if (window.loadAccounts) window.loadAccounts();
        } else {
          importResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${escapeHtml(data.detail || 'Gagal import sesi')}</div>`;
        }
      } catch (e) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        startImportBtn.disabled = false;
        startImportBtn.innerHTML = '<span>📥 Mulai Import StringSession</span>';
      }
    });
  }

  // ------------------- ACCOUNT CLEANER FLOW -------------------

  const cleanRadioAll = document.getElementById('clean-target-all');
  const cleanRadioSelected = document.getElementById('clean-target-selected');
  const cleanChecklist = document.getElementById('clean-account-checklist');
  const cleanItemsContainer = document.getElementById('clean-account-items');
  const cleanSelectAll = document.getElementById('clean-select-all');
  const cleanSelectNone = document.getElementById('clean-select-none');
  const cleanSelectOnline = document.getElementById('clean-select-online');
  const cleanSearchAccounts = document.getElementById('clean-search-accounts');
  const startCleanBtn = document.getElementById('start-clean-btn');
  const cleanFilterGroups = document.getElementById('clean-filter-groups');
  const cleanFilterChannels = document.getElementById('clean-filter-channels');
  const cleanFilterBots = document.getElementById('clean-filter-bots');
  const cleanFilterPms = document.getElementById('clean-filter-pms');
  const cleanMaxDialogs = document.getElementById('clean-max-dialogs');
  const cleanDelay = document.getElementById('clean-delay');
  const cleanResults = document.getElementById('clean-results');

  let cachedCleanAccounts = [];

  function renderCleanChecklist(accounts) {
    if (!cleanItemsContainer) return;
    if (accounts.length === 0) {
      cleanItemsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 4px;">Tidak ada akun yang sesuai</div>';
      return;
    }

    cleanItemsContainer.innerHTML = accounts.map(acc => {
      const name = acc.display_name || acc.username || acc.phone_number || `Akun #${acc.id}`;
      const isOnline = acc.is_active;
      return `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; margin-bottom: 4px; cursor: pointer;">
          <input type="checkbox" class="clean-acc-checkbox" value="${acc.id}" data-online="${isOnline ? '1' : '0'}">
          <span>${name} (${acc.phone_number || 'Tanpa no.'}) ${isOnline ? '<span style="color: var(--accent-green);">●</span>' : '<span style="color: var(--text-muted);">○</span>'}</span>
        </label>
      `;
    }).join('');
  }

  async function populateCleanChecklist() {
    if (!cleanItemsContainer) return;
    try {
      const res = await fetch('/api/accounts?limit=0', { headers: getAuthHeaders() });
      const data = await res.json();
      cachedCleanAccounts = data.accounts || [];
      renderCleanChecklist(cachedCleanAccounts);
    } catch (e) {
      cleanItemsContainer.innerHTML = '<div style="color: var(--accent-rose); font-size: 0.8rem;">Gagal memuat akun</div>';
    }
  }

  if (cleanSelectAll) {
    cleanSelectAll.addEventListener('click', () => {
      document.querySelectorAll('.clean-acc-checkbox').forEach(cb => cb.checked = true);
    });
  }
  if (cleanSelectNone) {
    cleanSelectNone.addEventListener('click', () => {
      document.querySelectorAll('.clean-acc-checkbox').forEach(cb => cb.checked = false);
    });
  }
  if (cleanSelectOnline) {
    cleanSelectOnline.addEventListener('click', () => {
      document.querySelectorAll('.clean-acc-checkbox').forEach(cb => {
        cb.checked = cb.getAttribute('data-online') === '1';
      });
    });
  }
  if (cleanSearchAccounts) {
    cleanSearchAccounts.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = cachedCleanAccounts.filter(acc => {
        const name = (acc.display_name || '').toLowerCase();
        const user = (acc.username || '').toLowerCase();
        const phone = (acc.phone_number || '').toLowerCase();
        return name.includes(q) || user.includes(q) || phone.includes(q);
      });
      renderCleanChecklist(filtered);
    });
  }

  if (cleanRadioAll && cleanRadioSelected && cleanChecklist) {
    cleanRadioAll.addEventListener('change', () => {
      cleanChecklist.style.display = 'none';
    });
    cleanRadioSelected.addEventListener('change', () => {
      cleanChecklist.style.display = 'block';
      populateCleanChecklist();
    });
  }

  if (startCleanBtn && cleanResults) {
    startCleanBtn.addEventListener('click', async () => {
      const leaveGroups = cleanFilterGroups ? cleanFilterGroups.checked : true;
      const leaveChannels = cleanFilterChannels ? cleanFilterChannels.checked : true;
      const deleteBots = cleanFilterBots ? cleanFilterBots.checked : true;
      const deletePms = cleanFilterPms ? cleanFilterPms.checked : false;

      if (!leaveGroups && !leaveChannels && !deleteBots && !deletePms) {
        showToast('Pilih minimal satu kategori pembersihan (Grup, Channel, Bot, atau PM)', 'error');
        return;
      }

      let targetIds = null;
      if (cleanRadioSelected && cleanRadioSelected.checked) {
        const checkedBoxes = document.querySelectorAll('.clean-acc-checkbox:checked');
        targetIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
        if (targetIds.length === 0) {
          showToast('Pilih minimal satu akun target', 'error');
          return;
        }
      }

      if (!confirm('⚠️ PERINGATAN: Tindakan ini akan meninggalkan grup/channel dan menghapus dialog chat secara permanen dari akun terpilih. Apakah Anda yakin ingin melanjutkan?')) {
        return;
      }

      const maxDialogs = parseInt(cleanMaxDialogs.value) || 100;
      const delayChat = parseFloat(cleanDelay.value) || 0.8;

      startCleanBtn.disabled = true;
      startCleanBtn.innerHTML = '<div class="spinner"></div> Membersihkan chat...';
      cleanResults.style.display = 'flex';
      cleanResults.innerHTML = '<div style="color: var(--text-secondary); padding: 8px;">Memindai dan membersihkan percakapan Telegram...</div>';

      if (window.OperationManager) {
        window.OperationManager.setRunning('Bersihkan Chat Akun Massal', 'cancel-clean-btn');
      }

      try {
        const res = await fetch('/api/accounts/clean-dialogs', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            account_ids: targetIds,
            leave_groups: leaveGroups,
            leave_channels: leaveChannels,
            delete_bots: deleteBots,
            delete_pms: deletePms,
            max_dialogs: maxDialogs,
            delay_chat: delayChat
          })
        });
        const data = await res.json();

        if (res.ok && data.results) {
          cleanResults.innerHTML = data.results.map(r => {
            const isOk = r.status === 'success';
            const isCancelled = r.status === 'cancelled';
            const badgeClass = isCancelled ? 'waiting' : (isOk ? 'success' : 'error');
            const badgeText = isCancelled ? '⛔ Dihentikan' : (isOk ? 'Selesai' : 'Gagal');

            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${r.name || 'Akun'}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${r.message}</div>
                </div>
                <div>
                  <span class="badge-status ${badgeClass}">${badgeText}</span>
                </div>
              </div>
            `;
          }).join('');

          showToast('Proses pembersihan chat selesai!', 'success');
          if (window.loadAccounts) window.loadAccounts();
        } else {
          cleanResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${data.detail || 'Gagal membersihkan chat'}</div>`;
        }
      } catch (e) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        startCleanBtn.disabled = false;
        startCleanBtn.innerHTML = '<span>🧹 Mulai Pembersihan Chat</span>';
        if (window.OperationManager) {
          window.OperationManager.setFinished('cancel-clean-btn');
        }
      }
    });
  }

  // ------------------ KIRIM CHAT GRUP MASSAL CONTROLLER ------------------
  const sendmsgGroupLink = document.getElementById('sendmsg-group-link');
  const sendmsgTextarea = document.getElementById('sendmsg-text-variations');
  const sendmsgCountSpan = document.getElementById('sendmsg-variation-count');
  const sendmsgDistMode = document.getElementById('sendmsg-distribution-mode');
  const sendmsgAutoJoin = document.getElementById('sendmsg-auto-join');
  const sendmsgDelay = document.getElementById('sendmsg-delay');
  const sendmsgRadioAll = document.getElementById('sendmsg-target-all');
  const sendmsgRadioSelected = document.getElementById('sendmsg-target-selected');
  const sendmsgChecklistContainer = document.getElementById('sendmsg-account-checklist');
  const sendmsgItemsContainer = document.getElementById('sendmsg-account-items');
  const sendmsgSelectAll = document.getElementById('sendmsg-select-all');
  const sendmsgSelectNone = document.getElementById('sendmsg-select-none');
  const sendmsgSelectOnline = document.getElementById('sendmsg-select-online');
  const sendmsgSearchAccounts = document.getElementById('sendmsg-search-accounts');
  const startSendmsgBtn = document.getElementById('start-sendmsg-btn');
  const sendmsgResults = document.getElementById('sendmsg-results');

  const presetGreetingsBtn = document.getElementById('preset-greetings-btn');
  const presetQuestionsBtn = document.getElementById('preset-questions-btn');
  const presetClearBtn = document.getElementById('preset-clear-btn');

  let cachedSendmsgAccounts = [];

  const GREETINGS_PRESET = [
    "Halo semua, izin gabung ya",
    "Siang agan2, salam kenal semuanya",
    "Halo halo, ada yang lagi online kah?",
    "Izin nyimak dulu suhu-suhu disini",
    "Halo min, salam kenal dari member baru",
    "Tes tes, salam kenal agan semua",
    "Halo guys, rame juga ya grupnya",
    "Izin gabung ya gaes, salam kenal semuanya",
    "Pagi/siang semuanya, izin stay di grup ya",
    "Halo gan, baru join nih. Salam kenal",
    "Siap meramaikan, salam kenal semuanya",
    "Salam kenal kawan-kawan semua, mohon bimbingannya",
    "Halo bro, salam kenal ya",
    "Mantap grupnya, izin nyimak obrolannya ya",
    "Halo semuanya, selamat beraktivitas ya"
  ];

  const QUESTIONS_PRESET = [
    "Halo, mau tanya disini bahas topik apa aja ya?",
    "Siang gan, info admin aktif siapa ya?",
    "Izin tanya suhu, ada rules khusus ga di grup ini?",
    "Halo semuanya, ada grup diskusi tambahannya ga ya?",
    "Permisi agan-agan, ada info menarik hari ini?",
    "Izin nyimak dan belajar ya gan",
    "Siang min, salam kenal dari pendatang baru",
    "Halo bro, grup ini aktif dari jam berapa biasanya?",
    "Izin gabung om, semoga bisa nambah wawasan disini",
    "Halo gan, salam sukses buat semua member disini"
  ];

  function updateVariationCount() {
    if (!sendmsgTextarea || !sendmsgCountSpan) return;
    const lines = sendmsgTextarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    sendmsgCountSpan.textContent = `${lines.length} variasi pesan`;
  }

  if (sendmsgTextarea) {
    sendmsgTextarea.addEventListener('input', updateVariationCount);
    updateVariationCount();
  }

  if (presetGreetingsBtn && sendmsgTextarea) {
    presetGreetingsBtn.addEventListener('click', () => {
      sendmsgTextarea.value = GREETINGS_PRESET.join('\n');
      updateVariationCount();
      showToast('Template sapaan alami dimuat (15 variasi)', 'info');
    });
  }

  if (presetQuestionsBtn && sendmsgTextarea) {
    presetQuestionsBtn.addEventListener('click', () => {
      sendmsgTextarea.value = QUESTIONS_PRESET.join('\n');
      updateVariationCount();
      showToast('Template obrolan santai dimuat (10 variasi)', 'info');
    });
  }

  if (presetClearBtn && sendmsgTextarea) {
    presetClearBtn.addEventListener('click', () => {
      sendmsgTextarea.value = '';
      updateVariationCount();
    });
  }

  function renderSendmsgChecklist(accounts) {
    if (!sendmsgItemsContainer) return;
    if (accounts.length === 0) {
      sendmsgItemsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 4px;">Tidak ada akun yang sesuai</div>';
      return;
    }

    sendmsgItemsContainer.innerHTML = accounts.map(acc => {
      const name = acc.display_name || acc.username || acc.phone_number || `Akun #${acc.id}`;
      const isOnline = acc.is_active;
      return `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; margin-bottom: 4px; cursor: pointer;">
          <input type="checkbox" class="sendmsg-acc-checkbox" value="${acc.id}" data-online="${isOnline ? '1' : '0'}">
          <span>${name} (${acc.phone_number || 'Tanpa no.'}) ${isOnline ? '<span style="color: var(--accent-green);">●</span>' : '<span style="color: var(--text-muted);">○</span>'}</span>
        </label>
      `;
    }).join('');
  }

  async function populateSendmsgChecklist() {
    if (!sendmsgItemsContainer) return;
    try {
      const res = await fetch('/api/accounts?limit=0', { headers: getAuthHeaders() });
      const data = await res.json();
      cachedSendmsgAccounts = data.accounts || [];
      renderSendmsgChecklist(cachedSendmsgAccounts);
    } catch (e) {
      sendmsgItemsContainer.innerHTML = '<div style="color: var(--accent-rose); font-size: 0.8rem;">Gagal memuat daftar akun</div>';
    }
  }

  if (sendmsgSelectAll) {
    sendmsgSelectAll.addEventListener('click', () => {
      document.querySelectorAll('.sendmsg-acc-checkbox').forEach(cb => cb.checked = true);
    });
  }
  if (sendmsgSelectNone) {
    sendmsgSelectNone.addEventListener('click', () => {
      document.querySelectorAll('.sendmsg-acc-checkbox').forEach(cb => cb.checked = false);
    });
  }
  if (sendmsgSelectOnline) {
    sendmsgSelectOnline.addEventListener('click', () => {
      document.querySelectorAll('.sendmsg-acc-checkbox').forEach(cb => {
        cb.checked = cb.getAttribute('data-online') === '1';
      });
    });
  }
  if (sendmsgSearchAccounts) {
    sendmsgSearchAccounts.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = cachedSendmsgAccounts.filter(acc => {
        const name = (acc.display_name || '').toLowerCase();
        const user = (acc.username || '').toLowerCase();
        const phone = (acc.phone_number || '').toLowerCase();
        return name.includes(q) || user.includes(q) || phone.includes(q);
      });
      renderSendmsgChecklist(filtered);
    });
  }

  if (sendmsgRadioAll && sendmsgRadioSelected && sendmsgChecklistContainer) {
    sendmsgRadioAll.addEventListener('change', () => {
      sendmsgChecklistContainer.style.display = 'none';
    });

    sendmsgRadioSelected.addEventListener('change', () => {
      sendmsgChecklistContainer.style.display = 'block';
      populateSendmsgChecklist();
    });
  }

  if (startSendmsgBtn && sendmsgGroupLink && sendmsgTextarea && sendmsgResults) {
    startSendmsgBtn.addEventListener('click', async () => {
      const link = sendmsgGroupLink.value.trim();
      if (!link) {
        showToast('Masukkan link atau username grup Telegram', 'error');
        sendmsgGroupLink.focus();
        return;
      }

      const rawText = sendmsgTextarea.value.trim();
      const variations = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      if (variations.length === 0) {
        showToast('Masukkan minimal satu variasi pesan', 'error');
        sendmsgTextarea.focus();
        return;
      }

      let targetIds = null;
      if (sendmsgRadioSelected && sendmsgRadioSelected.checked) {
        const checked = Array.from(document.querySelectorAll('.sendmsg-acc-checkbox:checked')).map(cb => parseInt(cb.value));
        if (checked.length === 0) {
          showToast('Pilih minimal satu akun pada daftar pilihan', 'warning');
          return;
        }
        targetIds = checked;
      }

      const delaySec = parseInt(sendmsgDelay.value) || 5;
      const distMode = sendmsgDistMode ? sendmsgDistMode.value : 'random';
      const autoJoin = sendmsgAutoJoin ? sendmsgAutoJoin.checked : true;

      startSendmsgBtn.disabled = true;
      startSendmsgBtn.innerHTML = '<div class="spinner"></div> Mengirim pesan massal...';
      sendmsgResults.style.display = 'flex';
      sendmsgResults.innerHTML = '<div style="color: var(--text-secondary); padding: 8px;">Menginisialisasi pengiriman pesan ke grup...</div>';

      if (window.OperationManager) {
        window.OperationManager.setRunning(`Kirim Pesan Grup (${link})`, 'cancel-sendmsg-btn');
      }

      try {
        const res = await fetch('/api/accounts/send-group-message', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            group_link: link,
            messages: variations,
            distribution_mode: distMode,
            auto_join: autoJoin,
            account_ids: targetIds,
            delay_seconds: delaySec
          })
        });

        const data = await res.json();
        if (res.ok && data.results) {
          const successCount = data.results.filter(r => r.status === 'success').length;
          const failCount = data.results.filter(r => r.status !== 'success' && r.status !== 'cancelled').length;
          const cancelCount = data.results.filter(r => r.status === 'cancelled').length;

          let summaryHtml = `
            <div style="margin-bottom: 10px; padding: 8px 12px; background: rgba(0,0,0,0.3); border-radius: var(--radius-sm); display: flex; justify-content: space-between; font-size: 0.85rem; flex-wrap: wrap; gap: 8px;">
              <span>Total: <strong>${data.results.length}</strong> Akun</span>
              <span style="color: var(--accent-green);">✓ Sukses: <strong>${successCount}</strong></span>
              ${cancelCount > 0 ? `<span style="color: var(--accent-amber);">⛔ Dihentikan: <strong>${cancelCount}</strong></span>` : ''}
              <span style="color: var(--accent-rose);">❌ Gagal: <strong>${failCount}</strong></span>
            </div>
          `;

          sendmsgResults.innerHTML = summaryHtml + data.results.map(r => {
            const isOk = r.status === 'success';
            const isCancelled = r.status === 'cancelled';
            const badgeClass = isCancelled ? 'waiting' : (isOk ? 'success' : 'error');
            const badgeText = isCancelled ? '⛔ Dihentikan' : (isOk ? 'Terkirim' : 'Gagal');

            return `
              <div class="bulk-item">
                <div style="flex: 1; min-width: 0;">
                  <span class="bulk-item-phone">${r.name || 'Akun'} (${r.phone || '-'})</span>
                  ${r.text ? `<div style="font-size: 0.78rem; color: var(--accent-cyan); margin: 2px 0;">"${escapeHtml(r.text)}"</div>` : ''}
                  <div style="font-size: 0.72rem; color: var(--text-muted);">${r.message}</div>
                </div>
                <div>
                  <span class="badge-status ${badgeClass}">${badgeText}</span>
                </div>
              </div>
            `;
          }).join('');

          showToast(`Kirim chat selesai: ${successCount} berhasil, ${failCount} gagal${cancelCount > 0 ? ', dihentikan' : ''}`, successCount > 0 ? 'success' : 'warning');
        } else {
          sendmsgResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${data.detail || 'Gagal mengirim pesan'}</div>`;
          showToast(data.detail || 'Gagal mengirim pesan', 'error');
        }
      } catch (err) {
        showToast('Koneksi server terputus', 'error');
        sendmsgResults.innerHTML = '<div style="color: var(--accent-rose); padding: 8px;">Koneksi server gagal.</div>';
      } finally {
        startSendmsgBtn.disabled = false;
        startSendmsgBtn.innerHTML = '<span>💬 Mulai Kirim Pesan Massal</span>';
        if (window.OperationManager) {
          window.OperationManager.setFinished('cancel-sendmsg-btn');
        }
      }
    });
  }

  // ------------------- HAPUS KONTAK SINKRON FLOW -------------------
  const contactsRadioAll = document.getElementById('contacts-target-all');
  const contactsRadioSelected = document.getElementById('contacts-target-selected');
  const contactsChecklistContainer = document.getElementById('contacts-account-checklist');
  const contactsItemsContainer = document.getElementById('contacts-account-items');
  const contactsSelectAll = document.getElementById('contacts-select-all');
  const contactsSelectNone = document.getElementById('contacts-select-none');
  const contactsSelectOnline = document.getElementById('contacts-select-online');
  const contactsSearchAccounts = document.getElementById('contacts-search-accounts');
  const contactsDelayMs = document.getElementById('contacts-delay-ms');
  const startContactsBtn = document.getElementById('start-contacts-btn');
  const contactsResults = document.getElementById('contacts-results');

  // Preset buttons
  const delayPreset0 = document.getElementById('delay-preset-0');
  const delayPreset50 = document.getElementById('delay-preset-50');
  const delayPreset200 = document.getElementById('delay-preset-200');
  const delayPreset500 = document.getElementById('delay-preset-500');

  if (contactsDelayMs) {
    if (delayPreset0) delayPreset0.addEventListener('click', () => { contactsDelayMs.value = 0; });
    if (delayPreset50) delayPreset50.addEventListener('click', () => { contactsDelayMs.value = 50; });
    if (delayPreset200) delayPreset200.addEventListener('click', () => { contactsDelayMs.value = 200; });
    if (delayPreset500) delayPreset500.addEventListener('click', () => { contactsDelayMs.value = 500; });
  }

  let cachedContactsAccounts = [];

  function renderContactsChecklist(accounts) {
    if (!contactsItemsContainer) return;
    if (accounts.length === 0) {
      contactsItemsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; padding: 4px;">Tidak ada akun yang sesuai</div>';
      return;
    }

    contactsItemsContainer.innerHTML = accounts.map(acc => {
      const name = acc.display_name || acc.username || acc.phone_number || `Akun #${acc.id}`;
      const isOnline = acc.is_active;
      return `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; margin-bottom: 4px; cursor: pointer;">
          <input type="checkbox" class="contacts-acc-checkbox" value="${acc.id}" data-online="${isOnline ? '1' : '0'}">
          <span>${name} (${acc.phone_number || 'Tanpa no.'}) ${isOnline ? '<span style="color: var(--accent-green);">●</span>' : '<span style="color: var(--text-muted);">○</span>'}</span>
        </label>
      `;
    }).join('');
  }

  async function populateContactsChecklist() {
    if (!contactsItemsContainer) return;
    try {
      const res = await fetch('/api/accounts?limit=0', { headers: getAuthHeaders() });
      const data = await res.json();
      cachedContactsAccounts = data.accounts || [];
      renderContactsChecklist(cachedContactsAccounts);
    } catch (e) {
      contactsItemsContainer.innerHTML = '<div style="color: var(--accent-rose); font-size: 0.8rem;">Gagal memuat daftar akun</div>';
    }
  }

  if (contactsSelectAll) {
    contactsSelectAll.addEventListener('click', () => {
      document.querySelectorAll('.contacts-acc-checkbox').forEach(cb => cb.checked = true);
    });
  }
  if (contactsSelectNone) {
    contactsSelectNone.addEventListener('click', () => {
      document.querySelectorAll('.contacts-acc-checkbox').forEach(cb => cb.checked = false);
    });
  }
  if (contactsSelectOnline) {
    contactsSelectOnline.addEventListener('click', () => {
      document.querySelectorAll('.contacts-acc-checkbox').forEach(cb => {
        cb.checked = cb.getAttribute('data-online') === '1';
      });
    });
  }
  if (contactsSearchAccounts) {
    contactsSearchAccounts.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const filtered = cachedContactsAccounts.filter(acc => {
        const name = (acc.display_name || '').toLowerCase();
        const user = (acc.username || '').toLowerCase();
        const phone = (acc.phone_number || '').toLowerCase();
        return name.includes(q) || user.includes(q) || phone.includes(q);
      });
      renderContactsChecklist(filtered);
    });
  }

  if (contactsRadioAll && contactsRadioSelected && contactsChecklistContainer) {
    contactsRadioAll.addEventListener('change', () => {
      contactsChecklistContainer.style.display = 'none';
    });

    contactsRadioSelected.addEventListener('change', () => {
      contactsChecklistContainer.style.display = 'block';
      populateContactsChecklist();
    });
  }

  if (startContactsBtn && contactsDelayMs && contactsResults) {
    startContactsBtn.addEventListener('click', async () => {
      let targetIds = null;
      if (contactsRadioSelected && contactsRadioSelected.checked) {
        const checkedBoxes = document.querySelectorAll('.contacts-acc-checkbox:checked');
        targetIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
        if (targetIds.length === 0) {
          showToast('Pilih minimal satu akun target', 'warning');
          return;
        }
      }

      const delayVal = parseInt(contactsDelayMs.value) || 0;

      if (!confirm(`Konfirmasi: Seluruh kontak sinkron & kontak akun Telegram pada ${targetIds ? targetIds.length + ' akun terpilih' : 'SEMUA AKUN'} akan dihapus permanen. Lanjutkan?`)) {
        return;
      }

      startContactsBtn.disabled = true;
      startContactsBtn.innerHTML = '<div class="spinner"></div> Menghapus kontak...';
      contactsResults.style.display = 'flex';
      contactsResults.innerHTML = '<div style="color: var(--text-secondary); padding: 8px;">Mengeksekusi penghapusan kontak sinkron kilat...</div>';

      if (window.OperationManager) {
        window.OperationManager.setRunning('Hapus Kontak Sinkron Massal', 'cancel-contacts-btn');
      }

      try {
        const res = await fetch('/api/accounts/delete-contacts', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            account_ids: targetIds,
            delay_ms: delayVal
          })
        });
        const data = await res.json();

        if (res.ok && data.results) {
          const successCount = data.results.filter(r => r.status === 'success').length;
          const cancelCount = data.results.filter(r => r.status === 'cancelled').length;
          const failCount = data.results.filter(r => r.status !== 'success' && r.status !== 'cancelled').length;
          const totalDeletedContacts = data.results.reduce((sum, r) => sum + (r.deleted_count || 0), 0);

          let summaryHtml = `
            <div style="margin-bottom: 10px; padding: 8px 12px; background: rgba(0,0,0,0.3); border-radius: var(--radius-sm); display: flex; justify-content: space-between; font-size: 0.85rem; flex-wrap: wrap; gap: 8px;">
              <span>Total Akun: <strong>${data.results.length}</strong></span>
              <span style="color: var(--accent-green);">✓ Sukses: <strong>${successCount}</strong> akun</span>
              <span style="color: var(--accent-cyan);">📇 Kontak Dihapus: <strong>${totalDeletedContacts}</strong></span>
              ${cancelCount > 0 ? `<span style="color: var(--accent-amber);">⛔ Dihentikan: <strong>${cancelCount}</strong></span>` : ''}
              ${failCount > 0 ? `<span style="color: var(--accent-rose);">❌ Gagal: <strong>${failCount}</strong></span>` : ''}
            </div>
          `;

          contactsResults.innerHTML = summaryHtml + data.results.map(r => {
            const isOk = r.status === 'success';
            const isCancelled = r.status === 'cancelled';
            const badgeClass = isCancelled ? 'waiting' : (isOk ? 'success' : 'error');
            const badgeText = isCancelled ? '⛔ Dihentikan' : (isOk ? 'Bersih' : 'Gagal');

            return `
              <div class="bulk-item">
                <div style="flex: 1; min-width: 0;">
                  <span class="bulk-item-phone">${r.name || 'Akun'} (${r.phone || '-'})</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${r.message}</div>
                </div>
                <div>
                  <span class="badge-status ${badgeClass}">${badgeText}</span>
                </div>
              </div>
            `;
          }).join('');

          showToast(`Selesai! Kontak sinkron berhasil dibersihkan (${totalDeletedContacts} kontak dihapus)`, 'success');
          if (window.loadAccounts) window.loadAccounts();
        } else {
          contactsResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${data.detail || 'Gagal menghapus kontak'}</div>`;
          showToast(data.detail || 'Gagal menghapus kontak', 'error');
        }
      } catch (err) {
        showToast('Koneksi server terputus', 'error');
        contactsResults.innerHTML = '<div style="color: var(--accent-rose); padding: 8px;">Koneksi server gagal.</div>';
      } finally {
        startContactsBtn.disabled = false;
        startContactsBtn.innerHTML = '<span>📇 Mulai Hapus Semua Kontak</span>';
        if (window.OperationManager) {
          window.OperationManager.setFinished('cancel-contacts-btn');
        }
      }
    });
  }
});
