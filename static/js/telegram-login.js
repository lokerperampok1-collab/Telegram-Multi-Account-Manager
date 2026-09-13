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
            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${r.name || 'Akun'}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${r.message}</div>
                </div>
                <div>
                  <span class="badge-status ${isOk ? 'success' : 'error'}">${isOk ? 'Berhasil' : 'Gagal'}</span>
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
      }
    });
  }

  // ------------------- IMPORT SESSION FLOW -------------------

  const startImportBtn = document.getElementById('start-import-btn');
  const importTextarea = document.getElementById('import-sessions-text');
  const importResults = document.getElementById('import-results');

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
                  <span class="bulk-item-phone">${r.name || r.phone || 'Sesi'}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${r.message}</div>
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
          importResults.innerHTML = `<div style="color: var(--accent-rose); padding: 8px;">${data.detail || 'Gagal import sesi'}</div>`;
        }
      } catch (e) {
        showToast('Koneksi server gagal', 'error');
      } finally {
        startImportBtn.disabled = false;
        startImportBtn.innerHTML = '<span>📥 Mulai Import Sesi</span>';
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
            const stats = r.stats || {};
            return `
              <div class="bulk-item">
                <div>
                  <span class="bulk-item-phone">${r.name || 'Akun'}</span>
                  <div style="font-size: 0.75rem; color: var(--text-muted);">${r.message}</div>
                </div>
                <div>
                  <span class="badge-status ${isOk ? 'success' : 'error'}">${isOk ? 'Selesai' : 'Gagal'}</span>
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
      }
    });
  }
});
