// Global API helper
function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  };
}

// Toast notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconSvg = '';
  if (type === 'success') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
  } else if (type === 'error') {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else {
    iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }

  toast.innerHTML = `
    ${iconSvg}
    <div style="flex: 1;">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Auth check on dashboard load
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  if (path === '/' || path === '/index.html') {
    const token = localStorage.getItem('token');
    if (!token) {
      window.location.href = '/login';
      return;
    }

    // Display user profile
    const rawUser = localStorage.getItem('user');
    if (rawUser) {
      try {
        const user = JSON.parse(rawUser);
        const nameDisplay = document.getElementById('username-display');
        const avatarDisplay = document.getElementById('user-avatar');
        if (nameDisplay) nameDisplay.textContent = user.username;
        if (avatarDisplay) avatarDisplay.textContent = (user.username[0] || 'U').toUpperCase();
      } catch (e) {}
    }

    // Logout button handler
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      });
    }

    // Mobile Drawer Toggle
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    function openSidebar() {
      if (sidebar) sidebar.classList.add('sidebar-open');
      if (overlay) overlay.classList.add('active');
    }

    function closeSidebar() {
      if (sidebar) sidebar.classList.remove('sidebar-open');
      if (overlay) overlay.classList.remove('active');
    }

    if (hamburgerBtn) hamburgerBtn.addEventListener('click', openSidebar);
    if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);

    // Luxury View Switcher
    const navItems = document.querySelectorAll('.nav-item[data-view]');
    const topbarTitle = document.getElementById('topbar-view-title');

    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetViewId = item.getAttribute('data-view');
        const targetPanel = document.getElementById(targetViewId);
        if (!targetPanel) return;

        // Update active nav button
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');

        // Update active view panel
        document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
        targetPanel.classList.add('active');

        // Update topbar breadcrumb title
        const labelText = item.querySelector('.nav-text')?.textContent || 'Dashboard';
        if (topbarTitle) topbarTitle.textContent = labelText;

        // Auto close drawer on mobile after selection
        closeSidebar();

        // Specific view triggers
        if (targetViewId === 'view-qr') {
          if (window.startQRFlow) window.startQRFlow();
        } else if (targetViewId === 'view-accounts') {
          if (window.loadAccounts) window.loadAccounts();
        }

        // Scroll smoothly to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Sidebar Action Buttons
    const sideCheckHealthBtn = document.getElementById('sidebar-check-health-btn');
    if (sideCheckHealthBtn) {
      sideCheckHealthBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeSidebar();
        if (window.checkAllAccountsHealth) window.checkAllAccountsHealth();
      });
    }

    const sideExportJsonBtn = document.getElementById('sidebar-export-json-btn');
    if (sideExportJsonBtn) {
      sideExportJsonBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeSidebar();
        if (window.triggerExport) window.triggerExport('json');
      });
    }

    const sideExportTxtBtn = document.getElementById('sidebar-export-txt-btn');
    if (sideExportTxtBtn) {
      sideExportTxtBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closeSidebar();
        if (window.triggerExport) window.triggerExport('txt');
      });
    }
  }
});
