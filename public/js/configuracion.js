document.addEventListener('DOMContentLoaded', () => {
  // ---------------- REFERENCIAS DOM ----------------

  const formBusinessSettings = document.getElementById('formBusinessSettings');
  const businessNameInput = document.getElementById('businessName');
  const businessRifInput = document.getElementById('businessRif');
  const businessAddressInput = document.getElementById('businessAddress');
  const logoFileInput = document.getElementById('logoFile');
  const logoPathInput = document.getElementById('logoPath');
  const logoPreviewContainer = document.getElementById('logoPreviewContainer');
  const logoPreview = document.getElementById('logoPreview');
  const businessSettingsStatus = document.getElementById('businessSettingsStatus');

  const exportCategorySelect = document.getElementById('exportCategorySelect');
  const btnExportar = document.getElementById('btnExportar');
  const formImportar = document.getElementById('formImportar');
  const csvFileInput = document.getElementById('csvFile');
  const dataManagementStatus = document.getElementById('dataManagementStatus');

  // SEGURIDAD / CONTRASEÑA
  const formAdminPassword = document.getElementById('form-admin-password');
  const currentPasswordGroup = document.getElementById('current-password-group');
  const currentPasswordInput = document.getElementById('current-password');
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const passwordStatus = document.getElementById('password-status');
  let isPasswordEnabled = false;

  // GESTIÓN DE USUARIOS
  const formCreateUser = document.getElementById('form-create-user');
  const userUsernameInput = document.getElementById('user-username');

  // CONFIGURACIÓN DE IMPRESIÓN
  const formPrintSettings = document.getElementById('form-print-settings');
  const printTicketCheckbox = document.getElementById('printTicketCheckbox');
  const printerSelect = document.getElementById('printerSelect');
  const printSettingsStatus = document.getElementById('print-settings-status');
  const userFullnameInput = document.getElementById('user-fullname');
  const userPasswordInput = document.getElementById('user-password');
  const userRoleSelect = document.getElementById('user-role');
  const createUserStatus = document.getElementById('create-user-status');
  const usersTableBody = document.getElementById('users-table-body');

  const CIERRE_Z_HISTORY_LIMIT = 50;
  let cierreZHistoryCurrentPage = 1;

  // Helper para abrir ventanas tipo "App de PC"
  function openAppWindow(url, title = 'NexusPOS', w = 900, h = 800) {
    const left = (screen.width / 2) - (w / 2);
    const top = (screen.height / 2) - (h / 2);
    return window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
  }

  async function askForAdminPermission() {
    let hasPermission = true;
    if (window.parent && typeof window.parent.askForAdminPassword === 'function') {
      hasPermission = await window.parent.askForAdminPassword();
    } else if (typeof window.askForAdminPassword === 'function') {
      hasPermission = await window.askForAdminPassword();
    } else {
      console.warn('askForAdminPassword no está definida; se asume permitido.');
    }
    return hasPermission;
  }
  let cierreZHistoryTotalPages = 1;

  const licenseSection = document.getElementById('license-section');
  const settingsContent = document.getElementById('settings-content');
  const activationTokenInput = document.getElementById('activation-token');
  const btnRedeemToken = document.getElementById('btn-redeem-token');
  const btnActivateFile = document.getElementById('btn-activate-file');
  const licenseFileInput = document.getElementById('license-file');
  const hardwareIdEl = document.getElementById('hardware-id');
  const licenseStatus = document.getElementById('license-status');
  const trialActivateSection = document.getElementById('trial-activate-section');
  const btnShowActivateForm = document.getElementById('btn-show-activate-form');
  const btnCopyHwid = document.getElementById('btn-copy-hwid');

  async function loadAndCheckLicense() {
    try {
      const response = await fetch('/api/license/info');
      const data = await response.json();

      if (hardwareIdEl) {
        hardwareIdEl.textContent = data.hardwareId || 'Error al obtener ID';
      }

      if (data.status === 'LICENSED') {
        licenseSection.classList.add('hidden');
        settingsContent.classList.remove('hidden');
        settingsContent.style.display = 'contents';
        trialActivateSection.classList.add('hidden');
        initializePageFunctions();
        mostrarMensaje(
          businessSettingsStatus,
          data.message || 'Sistema activado (Licencia Completa).',
          'success'
        );
      } else if (data.status === 'TRIAL') {
        licenseSection.classList.add('hidden');
        settingsContent.classList.remove('hidden');
        settingsContent.style.display = 'contents';
        trialActivateSection.classList.remove('hidden');
        initializePageFunctions();
        mostrarMensaje(businessSettingsStatus, data.message, 'info');
      } else {
        licenseSection.classList.remove('hidden');
        settingsContent.classList.add('hidden');
        settingsContent.style.display = 'none';
        trialActivateSection.classList.add('hidden');
        mostrarMensaje(
          licenseStatus,
          data.message || 'La licencia o período de prueba ha expirado.',
          'error'
        );
      }
    } catch (error) {
      console.error('Error verificando licencia:', error);
      licenseSection.classList.remove('hidden');
      settingsContent.classList.add('hidden');
      if (hardwareIdEl) hardwareIdEl.textContent = 'Error al contactar el servidor';
      mostrarMensaje(
        licenseStatus,
        'Error al verificar licencia. Recarga la página.',
        'error'
      );
    } finally {
      // SIEMPRE activamos los botones de licencia (por si expiró o hay error)
      setupLicenseEventListeners();
    }
  }

  async function handleTokenRedeem() {
    const token = activationTokenInput.value.trim();
    if (!token) {
      mostrarMensaje(licenseStatus, 'Debes ingresar un token.', 'error');
      return;
    }

    try {
      mostrarMensaje(licenseStatus, 'Activando online...', 'info');
      btnRedeemToken.disabled = true;

      const response = await fetch('/api/license/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const result = await response.json();
      if (response.ok) {
        mostrarMensaje(licenseStatus, '¡Activado con éxito! Recargando...', 'success');
        setTimeout(() => window.parent.location.reload(), 1500);
      } else {
        throw new Error(result.error || 'Token inválido o error de red');
      }
    } catch (error) {
      mostrarMensaje(licenseStatus, error.message, 'error');
      btnRedeemToken.disabled = false;
    }
  }

  async function handleFileActivate() {
    if (!licenseFileInput || !licenseFileInput.files || licenseFileInput.files.length === 0) {
      mostrarMensaje(licenseStatus, 'Selecciona un archivo .lic', 'error');
      return;
    }

    const file = licenseFileInput.files[0];
    try {
      mostrarMensaje(licenseStatus, 'Procesando archivo...', 'info');
      const text = (await file.text()).trim();

      const response = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: text })
      });

      const result = await response.json();
      if (response.ok) {
        mostrarMensaje(licenseStatus, '¡Archivo cargado con éxito! Recargando...', 'success');
        setTimeout(() => window.parent.location.reload(), 1500);
      } else {
        throw new Error(result.error || 'Licencia inválida para este equipo');
      }
    } catch (error) {
      mostrarMensaje(licenseStatus, error.message, 'error');
    }
  }

  async function copyToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
      }
    } catch (err) {
      return false;
    }
  }

  async function handleCopyHwid() {
    const value = hardwareIdEl.textContent || '';
    if (!value || value.includes('Error')) return;

    const success = await copyToClipboard(value);
    if (success) {
      mostrarMensaje(licenseStatus, 'HWID copiado al portapapeles.', 'success');
    } else {
      mostrarMensaje(licenseStatus, 'Copia el texto manualmente: ' + value, 'info');
    }
  }

  // ---------------- SEGURIDAD / CONTRASEÑA ----------------

  async function loadAuthStatus() {
    try {
      const response = await fetch('/api/auth/status');
      const data = await response.json();
      isPasswordEnabled = data.isPasswordEnabled;
      if (isPasswordEnabled) {
        currentPasswordGroup.classList.remove('hidden');
        currentPasswordInput.required = true;
      } else {
        currentPasswordGroup.classList.add('hidden');
        currentPasswordInput.required = false;
      }
    } catch (error) {
      console.error('Error cargando estado de auth:', error);
      mostrarMensaje(
        passwordStatus,
        'Error al cargar estado de seguridad.',
        'error'
      );
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (newPassword !== confirmPassword) {
      mostrarMensaje(passwordStatus, 'Las nuevas contraseñas no coinciden.', 'error');
      return;
    }

    if (isPasswordEnabled && !currentPassword) {
      mostrarMensaje(
        passwordStatus,
        'Debe ingresar su contraseña actual para hacer cambios.',
        'error'
      );
      return;
    }

    if (newPassword && newPassword.length < 4) {
      mostrarMensaje(
        passwordStatus,
        'La nueva contraseña debe tener al menos 4 caracteres.',
        'error'
      );
      return;
    }

    const body = {
      currentPassword: currentPassword || null,
      newPassword: newPassword || null
    };

    mostrarMensaje(passwordStatus, 'Guardando...', 'info');

    try {
      const response = await fetch('/api/auth/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error desconocido');
      }

      mostrarMensaje(passwordStatus, result.message, 'success');
      formAdminPassword.reset();
      loadAuthStatus();
    } catch (error) {
      console.error('Error guardando contraseña:', error);
      mostrarMensaje(passwordStatus, error.message, 'error');
    }
  }

  function setupLicenseEventListeners() {
    // Solo agregar si no se han agregado ya (o usar onclick directos)
    // Para evitar duplicados si se llama varias veces:
    btnRedeemToken.replaceWith(btnRedeemToken.cloneNode(true));
    btnActivateFile.replaceWith(btnActivateFile.cloneNode(true));
    btnCopyHwid.replaceWith(btnCopyHwid.cloneNode(true));

    // Re-referenciar tras el clone
    const newBtnRedeem = document.getElementById('btn-redeem-token');
    const newBtnActivate = document.getElementById('btn-activate-file');
    const newBtnCopy = document.getElementById('btn-copy-hwid');

    newBtnRedeem.addEventListener('click', handleTokenRedeem);
    newBtnActivate.addEventListener('click', handleFileActivate);
    newBtnCopy.addEventListener('click', handleCopyHwid);

    if (btnShowActivateForm) {
      btnShowActivateForm.addEventListener('click', () => {
        settingsContent.classList.add('hidden');
        licenseSection.classList.remove('hidden');
        licenseSection.classList.remove('border-2', 'border-red-500');
        mostrarMensaje(
          licenseStatus,
          'Selecciona tu archivo de licencia para activar la versión completa.',
          'info'
        );
      });
    }
  }

  // ---------------- INICIALIZACIÓN PÁGINA ----------------

  function initializePageFunctions() {
    loadBusinessSettings();
    loadExportCategories();
    loadAuthStatus();

    formBusinessSettings.addEventListener('submit', handleBusinessSettingsSubmit);
    formImportar.addEventListener('submit', handleImportSubmit);
    logoFileInput.addEventListener('change', previewLogoFile);
    btnExportar.addEventListener('click', handleExportClick);
    formAdminPassword.addEventListener('submit', handlePasswordSubmit);

    // GESTIÓN DE USUARIOS
    if (formCreateUser) {
      formCreateUser.addEventListener('submit', handleCreateUser);
      loadUsers();
    }

    if (btnOpenTicketDesigner) {
      btnOpenTicketDesigner.addEventListener('click', () => {
        openAppWindow('/disenador-ticket.html', 'Diseñador de Ticket', 1200, 900);
      });
    }

    // Historial de Cierres Z
    if (btnOpenCierreZHistory) {
      btnOpenCierreZHistory.addEventListener(
        'click',
        handleOpenCierreZHistoryFromSettings
      );
    }

    if (btnCloseCierreZHistory) {
      btnCloseCierreZHistory.addEventListener(
        'click',
        closeCierreZHistoryModal
      );
    }

    if (cierreZHistoryModal) {
      cierreZHistoryModal.addEventListener('click', (e) => {
        if (e.target === cierreZHistoryModal) {
          closeCierreZHistoryModal();
        }
      });
    }

    if (cierreZHistoryBody) {
      cierreZHistoryBody.addEventListener('click', handleCierreZHistoryClick);
    }

    // NUEVO: listeners de paginación (si existen en el HTML)
    if (cierreZHistoryPrev) {
      cierreZHistoryPrev.addEventListener('click', () => {
        if (cierreZHistoryCurrentPage > 1) {
          loadCierreZHistory(cierreZHistoryCurrentPage - 1);
        }
      });
    }

    if (cierreZHistoryNext) {
      cierreZHistoryNext.addEventListener('click', () => {
        if (cierreZHistoryCurrentPage < cierreZHistoryTotalPages) {
          loadCierreZHistory(cierreZHistoryCurrentPage + 1);
        }
      });
    }

    if (btnSearchZHistory) {
      btnSearchZHistory.addEventListener('click', () => {
        loadCierreZHistory(1);
      });
    }

    if (btnClearZHistory) {
      btnClearZHistory.addEventListener('click', () => {
        zHistoryStartDate.value = '';
        zHistoryEndDate.value = '';
        loadCierreZHistory(1);
      });
    }

    if (btnExportZHistoryExcel) {
      btnExportZHistoryExcel.addEventListener('click', () => {
        const params = new URLSearchParams();
        if (zHistoryStartDate.value) params.append('startDate', zHistoryStartDate.value);
        if (zHistoryEndDate.value) params.append('endDate', zHistoryEndDate.value);
        window.open(`/api/reports/cierre-z/history-excel?${params.toString()}`, '_blank');
      });
    }

    // Quick Select Buttons for Z History
    const quickDateZBtns = document.querySelectorAll('.btn-quick-date-z');
    quickDateZBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        const today = new Date();
        let start = new Date();
        let end = new Date();

        switch (range) {
          case 'today': break;
          case 'yesterday':
            start.setDate(today.getDate() - 1);
            end.setDate(today.getDate() - 1);
            break;
          case 'last7':
            start.setDate(today.getDate() - 7);
            break;
        }

        const formatDate = (date) => {
          const y = date.getFullYear();
          const m = String(date.getMonth() + 1).padStart(2, '0');
          const d = String(date.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        };

        zHistoryStartDate.value = formatDate(start);
        zHistoryEndDate.value = formatDate(end);
        loadCierreZHistory(1);
      });
    });
  }

  // ---------------- TASAS / CÁLCULO ----------------

  // ---------------- PERSONALIZACIÓN NEGOCIO ----------------

  async function loadBusinessSettings() {
    try {
      const response = await fetch('/api/settings/business');
      if (!response.ok) throw new Error('No se pudo cargar la config. del negocio');
      const settings = await response.json();
      businessNameInput.value = settings.businessName || '';
      if (businessRifInput) businessRifInput.value = settings.businessRif || '';
      if (businessAddressInput) businessAddressInput.value = settings.businessAddress || '';
      logoPathInput.value = settings.logoPath || '';
      if (settings.logoPath) {
        logoPreview.src = settings.logoPath;
        logoPreviewContainer.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error cargando config. del negocio:', error);
      mostrarMensaje(
        businessSettingsStatus,
        'Error al cargar la configuración.',
        'error'
      );
    }
  }

  function previewLogoFile() {
    const file = logoFileInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        logoPreview.src = e.target.result;
        logoPreviewContainer.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    }
  }

  async function handleBusinessSettingsSubmit(event) {
    event.preventDefault();
    mostrarMensaje(businessSettingsStatus, 'Guardando...', 'info');

    const formData = new FormData();
    formData.append('businessName', businessNameInput.value);
    if (businessRifInput) formData.append('businessRif', businessRifInput.value);
    if (businessAddressInput) formData.append('businessAddress', businessAddressInput.value);
    formData.append('logoPath', logoPathInput.value);
    if (logoFileInput.files.length > 0) {
      formData.append('logoFile', logoFileInput.files[0]);
    }

    try {
      const response = await fetch('/api/settings/business', {
        method: 'POST',
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error desconocido al guardar');
      }

      mostrarMensaje(
        businessSettingsStatus,
        '¡Personalización guardada con éxito!',
        'success'
      );

      logoPathInput.value = result.settings.logoPath;
      if (result.settings.logoPath) {
        logoPreview.src = `${result.settings.logoPath}?t=${new Date().getTime()}`;
        logoPreviewContainer.classList.remove('hidden');
      } else {
        logoPreviewContainer.classList.add('hidden');
      }

      logoFileInput.value = '';
      if (typeof window.parent.reloadLayout === 'function') {
        window.parent.reloadLayout();
      }
    } catch (error) {
      console.error('Error guardando personalización:', error);
      mostrarMensaje(
        businessSettingsStatus,
        `Error: ${error.message}`,
        'error'
      );
    }
  }

  // ---------------- IMPORTAR / EXPORTAR ----------------

  async function loadExportCategories() {
    try {
      const response = await fetch('/api/categories');
      if (!response.ok) throw new Error('No se pudieron cargar categorías');
      const categorias = await response.json();

      while (exportCategorySelect.options.length > 1) {
        exportCategorySelect.remove(1);
      }

      categorias.forEach((cat) => {
        const option = document.createElement('option');
        option.value = cat.nombre;
        option.textContent = cat.nombre;
        exportCategorySelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error cargando categorías para exportar:', error);
      mostrarMensaje(
        dataManagementStatus,
        'Error al cargar lista de categorías.',
        'error'
      );
    }
  }

  function handleExportClick() {
    mostrarMensaje(dataManagementStatus, 'Generando exportación...', 'info');
    const selectedCategory = exportCategorySelect.value;
    let url;
    if (selectedCategory === 'CLIENTES') {
      url = '/api/clients/export';
    } else {
      url = '/api/products/export';
      if (selectedCategory !== '_TODAS_') {
        url += `?categoria=${encodeURIComponent(selectedCategory)}`;
      }
    }
    window.location.href = url;
    setTimeout(() => {
      mostrarMensaje(dataManagementStatus, '', 'info');
    }, 2000);
  }

  async function handleImportSubmit(event) {
    event.preventDefault();

    const hasPermission = await askForAdminPermission();
    if (!hasPermission) return;

    if (!csvFileInput.files || csvFileInput.files.length === 0) {
      mostrarMensaje(
        dataManagementStatus,
        'Error: Debes seleccionar un archivo CSV.',
        'error'
      );
      return;
    }

    mostrarMensaje(
      dataManagementStatus,
      'Importando productos, por favor espera...',
      'info'
    );

    const formData = new FormData();
    // Envíamos primero el flag para asegurar que multer lo procese si es necesario, aunque req.body suele estar disponible.
    const convertCheckbox = document.getElementById('convertFromVes');
    if (convertCheckbox && convertCheckbox.checked) {
      formData.append('convertFromVes', 'true');
    }
    formData.append('csvFile', csvFileInput.files[0]);

    try {
      const response = await fetch('/api/products/import', {
        method: 'POST',
        body: formData
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error desconocido al importar');
      }
      mostrarMensaje(dataManagementStatus, result.message, 'success');
      formImportar.reset();
      await loadExportCategories();
    } catch (error) {
      console.error('Error importando CSV:', error);
      mostrarMensaje(
        dataManagementStatus,
        `Error: ${error.message}`,
        'error'
      );
    }
  }

  // ---------------- GESTIÓN DE USUARIOS ----------------

  async function loadUsers() {
    if (!usersTableBody) return;

    try {
      const response = await fetch('/api/manage-users/users');
      if (!response.ok) throw new Error('Error al cargar usuarios');
      const users = await response.json();

      usersTableBody.innerHTML = '';

      if (users.length === 0) {
        usersTableBody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-gray-400 italic">No hay usuarios registrados.</td></tr>';
        return;
      }

      users.forEach(user => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors';

        tr.innerHTML = `
          <td class="py-3 px-2 font-medium text-gray-800 dark:text-gray-200">${user.username}</td>
          <td class="py-3 px-2 text-gray-600 dark:text-gray-400">${user.nombre || '-'}</td>
          <td class="py-3 px-2">
            <span class="px-2 py-0.5 rounded-full text-xs font-bold ${user.rol === 'ADMIN' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'}">
              ${user.rol}
            </span>
          </td>
          <td class="py-3 px-2 text-right">
            <div class="flex items-center justify-end gap-1">
              <button onclick="openPasswordModal(${user.id}, '${user.username}')" class="text-blue-500 hover:text-blue-700 p-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all" title="Cambiar contraseña">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
              </button>
              ${(user.id !== 1 && user.username !== 'admin') ?
              `<button onclick="deleteUser(${user.id})" class="text-red-500 hover:text-red-700 p-1 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 transition-all" title="Eliminar usuario">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>` : ''}
            </div>
          </td>
        `;
        usersTableBody.appendChild(tr);
      });
    } catch (error) {
      console.error('Error cargando usuarios:', error);
      usersTableBody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-red-500">Error al cargar usuarios.</td></tr>';
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    mostrarMensaje(createUserStatus, 'Creando usuario...', 'info');

    const data = {
      username: userUsernameInput.value,
      nombre: userFullnameInput.value,
      password: userPasswordInput.value,
      rol: userRoleSelect.value
    };

    try {
      const response = await fetch('/api/manage-users/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (!response.ok) throw new Error(result.error || 'Error al crear usuario');

      mostrarMensaje(createUserStatus, '¡Usuario creado!', 'success');
      formCreateUser.reset();
      loadUsers();
    } catch (error) {
      mostrarMensaje(createUserStatus, error.message, 'error');
    }
  }

  // Definir deleteUser globalmente para el onclick
  window.deleteUser = async (id) => {
    if (!confirm('¿Estás seguro de que deseas eliminar este usuario?')) return;

    try {
      const response = await fetch(`/api/manage-users/users/${id}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (!response.ok) throw new Error(result.error || 'Error al eliminar usuario');

      if (window.showToast) window.showToast('Usuario eliminado', 'success');
      loadUsers();
    } catch (error) {
      alert(error.message);
    }
  };

  // Modal para cambiar contraseña
  window.openPasswordModal = (userId, username) => {
    const modal = document.getElementById('passwordModal');
    const usernameSpan = document.getElementById('passwordModalUsername');
    const passwordInput = document.getElementById('passwordModalPassword');
    const confirmInput = document.getElementById('passwordModalConfirm');
    const userIdInput = document.getElementById('passwordModalUserId');
    
    usernameSpan.textContent = username;
    passwordInput.value = '';
    confirmInput.value = '';
    userIdInput.value = userId;
    modal.classList.remove('hidden');
  };

  window.closePasswordModal = () => {
    document.getElementById('passwordModal').classList.add('hidden');
  };

  window.saveNewPassword = async () => {
    const userId = document.getElementById('passwordModalUserId').value;
    const password = document.getElementById('passwordModalPassword').value;
    const confirm = document.getElementById('passwordModalConfirm').value;
    const statusEl = document.getElementById('passwordModalStatus');

    if (!password || password.length < 4) {
      mostrarMensaje(statusEl, 'La contraseña debe tener al menos 4 caracteres.', 'error');
      return;
    }

    if (password !== confirm) {
      mostrarMensaje(statusEl, 'Las contraseñas no coinciden.', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/manage-users/users/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      const result = await response.json();

      if (!response.ok) throw new Error(result.error || 'Error al actualizar contraseña');

      mostrarMensaje(statusEl, 'Contraseña actualizada con éxito.', 'success');
      if (window.showToast) window.showToast('Contraseña actualizada', 'success');
      setTimeout(() => closePasswordModal(), 1500);
    } catch (error) {
      mostrarMensaje(statusEl, error.message, 'error');
    }
  };

  // ---------------- CONFIGURACIÓN DE IMPRESIÓN ----------------
  async function loadPrintSettings() {
    if (!formPrintSettings) return;
    
    try {
      const res = await fetch('/api/print-settings');
      if (!res.ok) throw new Error('No se pudo cargar la configuración');
      
      const settings = await res.json();
      
      // Radios de modo de impresión
      const modePreview = document.querySelector('input[name="print-mode"][value="preview"]');
      const modeDirect = document.querySelector('input[name="print-mode"][value="direct"]');
      
      if (settings.printMode === 'direct') {
        if (modeDirect) modeDirect.checked = true;
      } else {
        if (modePreview) modePreview.checked = true;
      }
      
      if (printTicketCheckbox) printTicketCheckbox.checked = !!settings.printTicket;
      
      if (printerSelect && settings.printerName) {
        printerSelect.value = settings.printerName;
      }
      
      const copiesInput = document.querySelector('input[name="print-copies"]');
      if (copiesInput) copiesInput.value = settings.printCopies || 1;
      
      const paperWidthSelect = document.querySelector('select[name="print-paper-width"]');
      if (paperWidthSelect) paperWidthSelect.value = String(settings.ticketSize || 80);
      
      const headerTextarea = document.querySelector('textarea[name="print-header"]');
      if (headerTextarea) headerTextarea.value = settings.printHeader || '';
      
      const footerTextarea = document.querySelector('textarea[name="print-footer"]');
      if (footerTextarea) footerTextarea.value = settings.printFooter || '';
      
    } catch (error) {
      console.error('Error cargando configuración de impresión:', error);
      mostrarMensaje(printSettingsStatus, 'Cargado con valores por defecto.', 'error');
    }
  }

  if (formPrintSettings) {
    formPrintSettings.addEventListener('submit', async (e) => {
      e.preventDefault();
      mostrarMensaje(printSettingsStatus, 'Guardando...', 'info');

      try {
        const modeInput = document.querySelector('input[name="print-mode"]:checked');
        const copiesInput = document.querySelector('input[name="print-copies"]');
        const paperWidthSelect = document.querySelector('select[name="print-paper-width"]');
        const headerTextarea = document.querySelector('textarea[name="print-header"]');
        const footerTextarea = document.querySelector('textarea[name="print-footer"]');

        const body = {
          printMode: modeInput ? modeInput.value : 'preview',
          printTicket: !!(printTicketCheckbox && printTicketCheckbox.checked),
          printerName: printerSelect ? printerSelect.value : '',
          printCopies: copiesInput ? Number(copiesInput.value) || 1 : 1,
          ticketSize: paperWidthSelect ? Number(paperWidthSelect.value) : 80,
          printHeader: headerTextarea ? headerTextarea.value : '',
          printFooter: footerTextarea ? footerTextarea.value : ''
        };

        const res = await fetch('/api/print-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const result = await res.json().catch(() => ({}));

        if (!res.ok || result.success === false) {
          throw new Error(result.error || 'Error al guardar configuración');
        }

        mostrarMensaje(printSettingsStatus, '¡Configuración de impresión guardada!', 'success');
      } catch (error) {
        console.error('Error:', error);
        mostrarMensaje(printSettingsStatus, error.message || 'Error al guardar', 'error');
      }
    });
  }

  // ---------------- UTILIDAD MENSAJES ----------------

  function mostrarMensaje(elemento, mensaje, tipo = 'info') {
    if (!elemento) return;
    elemento.textContent = mensaje;
    elemento.className = 'text-sm mt-3 text-center';
    if (tipo === 'success') {
      elemento.classList.add('text-green-600');
    } else if (tipo === 'error') {
      elemento.classList.add('text-red-600');
    } else {
      elemento.classList.add('text-gray-600');
    }
  }

  // ---------------- ARRANQUE ----------------

  loadAndCheckLicense();
  loadPrintSettings();

  // ---------------- NEXUSAI VOICE TOGGLE ----------------
  const nexusaiVoiceToggle = document.getElementById('nexusai-voice-toggle');
  if (nexusaiVoiceToggle) {
    nexusaiVoiceToggle.checked = localStorage.getItem('nexusai_voice_enabled') !== 'false';
    nexusaiVoiceToggle.addEventListener('change', () => {
      localStorage.setItem('nexusai_voice_enabled', nexusaiVoiceToggle.checked ? 'true' : 'false');
    });
  }
});
