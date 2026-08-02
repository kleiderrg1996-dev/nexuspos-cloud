// Sesión solo en sessionStorage (se borra al cerrar el navegador/ventana)
const getSession = () => {
  try {
    const session = sessionStorage.getItem('nexuspos_session');
    return session ? JSON.parse(session) : null;
  } catch (e) { return null; }
};

/**
 * Mantiene la sesión activa en el servidor para evitar ingresos concurrentes.
 * Envía un pulso cada 15 segundos.
 */
function startHeartbeat() {
  const session = getSession();
  if (!session || !session.sessionToken) return;

  const sendPulse = async () => {
    try {
      const response = await fetch('/api/manage-users/pulse', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': session.sessionToken
        }
      });
      if (response.status === 401) {
        console.warn('[AUTH] Sesión expirada o invalidada por otro inicio de sesión.');
        window.logoutSystem();
      }
    } catch (e) {
      console.error('[AUTH] Error enviando pulso de vida:', e);
    }
  };

  // Enviar pulso inmediatamente y luego cada 15 seg
  sendPulse();
  setInterval(sendPulse, 15000);
}


window.logoutSystem = async function () {
  const session = getSession();
  if (session) {
    try {
      await fetch('/api/manage-users/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: session.id })
      });
    } catch (e) {
      console.error('Error al notificar logout al servidor:', e);
    }
  }
  // Limpiar toda la sesión (sessionStorage y cualquier residuo en localStorage)
  sessionStorage.removeItem('nexuspos_session');
  localStorage.removeItem('nexuspos_session');
  localStorage.removeItem('nexuspos_session_persist');
  window.location.href = '/login.html';
};

// ---------- MODALES GLOBALES (ALERTA / CONFIRMAR) ----------

function getGlobalAlertModalElements() {
  const modal = document.getElementById('global-alert-modal');
  const titleEl = document.getElementById('global-alert-title');
  const messageEl = document.getElementById('global-alert-message');
  const btnCloseX = document.getElementById('btn-close-global-alert');
  const btnOk = document.getElementById('btn-global-ok');
  const btnCancel = document.getElementById('btn-global-cancel');

  if (!modal || !titleEl || !messageEl || !btnCloseX || !btnOk || !btnCancel) {
    console.warn('Modal de alerta global no encontrado o incompleto en index.html.');
    return null;
  }

  return { modal, titleEl, messageEl, btnCloseX, btnOk, btnCancel };
}

window.openSystemAlert = function (message, title) {
  const els = getGlobalAlertModalElements();
  if (!els) {
    console.log('ALERTA:', message);
    return Promise.resolve(true);
  }

  const { modal, titleEl, messageEl, btnOk, btnCloseX, btnCancel } = els;

  titleEl.textContent = title || 'Alerta del Sistema';
  messageEl.textContent = String(message || '');
  btnCancel.classList.add('hidden');

  return new Promise((resolve) => {
    const close = () => {
      modal.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCloseX.removeEventListener('click', onClose);
      modal.removeEventListener('click', onBackdrop);
      resolve(true);
    };

    const onOk = () => close();
    const onClose = () => close();
    const onBackdrop = (e) => {
      if (e.target === modal) close();
    };

    btnOk.addEventListener('click', onOk);
    btnCloseX.addEventListener('click', onClose);
    modal.addEventListener('click', onBackdrop);

    modal.classList.remove('hidden');
  });
};

window.openSystemConfirm = function (message, title) {
  const els = getGlobalAlertModalElements();
  if (!els) {
    console.log('CONFIRM (sin modal disponible):', message);
    return Promise.resolve(true);
  }

  const { modal, titleEl, messageEl, btnOk, btnCloseX, btnCancel } = els;

  titleEl.textContent = title || 'Confirmar acción';
  messageEl.textContent = String(message || '');
  btnCancel.classList.remove('hidden');

  return new Promise((resolve) => {
    const close = (result) => {
      modal.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCloseX.removeEventListener('click', onClose);
      btnCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      resolve(result);
    };

    const onOk = () => close(true);
    const onClose = () => close(false);
    const onCancel = () => close(false);
    const onBackdrop = (e) => {
      if (e.target === modal) close(false);
    };

    btnOk.addEventListener('click', onOk);
    btnCloseX.addEventListener('click', onClose);
    btnCancel.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);

    modal.classList.remove('hidden');
  });
};

/**
 * Abre una ventana secundaria con flags de "App" (minimalista, sin barras de navegación).
 */
window.openAppWindow = function (url, title = 'NexusPOS', w = 1000, h = 800) {
  const left = (screen.width / 2) - (w / 2);
  const top = (screen.height / 2) - (h / 2);
  // Eliminamos popup=1 ya que puede restringir capacidades como la impresión en algunos navegadores
  return window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
};

// ---------- CONFIGURAR ADMIN COMO MASTER ----------
async function setupAdminAsMaster() {
  try {
    // Cambiar la contraseña del admin (id=1) a nexus2026
    const response = await fetch('/api/manage-users/users/1/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'nexus2026' })
    });
    if (response.ok) {
      console.log('[MASTER] Admin configurado como master (admin/nexus2026).');
    }
  } catch (e) {
    console.log('[MASTER] Error al configurar admin:', e.message);
  }
}

// ---------- LÓGICA ORIGINAL DEL LAYOUT ----------

let globalLicenseStatus = 'UNKNOWN';

document.addEventListener('DOMContentLoaded', () => {

  // ============================================================
  // GUARDIÁN DE SESIÓN — VERIFICACIÓN INMEDIATA
  // Si no hay sesión en sessionStorage, redirigir al login.
  // sessionStorage se borra automáticamente al cerrar el navegador.
  // ============================================================
  const sessionRaw = sessionStorage.getItem('nexuspos_session');
  if (!sessionRaw) {
    // Limpiar cualquier dato residual en localStorage
    localStorage.removeItem('nexuspos_session');
    localStorage.removeItem('nexuspos_session_persist');
    window.location.replace('/login.html');
    return; // Detener toda ejecución del layout
  }
  // Verificar que el JSON es válido
  try { JSON.parse(sessionRaw); } catch (e) {
    sessionStorage.removeItem('nexuspos_session');
    window.location.replace('/login.html');
    return;
  }

  // Configurar admin como master (cambia password a nexus2026)
  setupAdminAsMaster();

  (async () => {
    const iframe = document.getElementById('content-frame');

    try {
      const response = await fetch('/api/license/info');
      // Si la respuesta no es OK, podría ser error 500, pero no necesariamente "EXPIRED"
      if (!response.ok) {
        console.warn('Advertencia: El servidor de licencias local respondió con error ' + response.status);
        // No lanzamos error aquí para permitir que la UI cargue con estado UNKNOWN en vez de bloquear
      }

      const data = await response.json();

      if (data.status === 'EXPIRED') {
        console.warn('Licencia o prueba expirada, redirigiendo iframe a configuracion.html');
        globalLicenseStatus = 'EXPIRED';
        if (iframe) {
          // Solo redirigir si NO estamos ya ahí
          if (!iframe.src.includes('configuracion.html')) {
            iframe.src = 'configuracion.html';
          }
        }
      } else {
        globalLicenseStatus = data.status; // 'LICENSED' o 'TRIAL'
        console.log('Estado de Licencia:', globalLicenseStatus);
      }
    } catch (error) {
      console.error('Error en la verificación global de licencia (red/server):', error);
      // NO forzamos "EXPIRED" aquí. Si falla la red local, asumimos que puede seguir funcionando lo básico
      // o que es un error temporal. Bloquear por error de red es mala UX.
      globalLicenseStatus = 'UNKNOWN';
    }
  })();

  loadSidebar();
  loadTopbar();
  loadAndApplyBusinessSettings();

  // Iniciar el pulso de sesión para bloqueo de acceso concurrente
  startHeartbeat();

  const mobileModal = document.getElementById('mobile-modal');
  const closeMobileModal = document.getElementById('close-mobile-modal');
  const closeMobileModalBtn = document.getElementById('close-mobile-modal-btn');

  const closeAction = () => {
    if (mobileModal) {
      mobileModal.classList.add('hidden');
    }
  };

  if (mobileModal) {
    mobileModal.addEventListener('click', (event) => {
      if (event.target === mobileModal) {
        closeAction();
      }
    });
  }

  if (closeMobileModal) closeMobileModal.addEventListener('click', closeAction);
  if (closeMobileModalBtn) closeMobileModalBtn.addEventListener('click', closeAction);

  // --- New Feature Notification: Flexible Import ---
  if (!localStorage.getItem('flexible_import_ack_v1_5_2')) {
    setTimeout(() => {
      window.openSystemAlert(
        '¡NUEVO! Hemos mejorado el sistema de importación.\n\n' +
        '- Compatible con Excel (.xlsx) y CSV.\n' +
        '- Columnas flexibles (no requiere nombres exactos).\n' +
        '- Valores opcionales (Activo, Ganancia, Categoría automáticos).\n' +
        '- Carga de bultos inteligente.\n' +
        '¡Plantilla de importación ahora es solo una guía!',
        'Mejora de Importación (v1.5.2)'
      ).then(() => {
        localStorage.setItem('flexible_import_ack_v1_5_2', 'true');
      });
    }, 2500);
  }

  // --- Inicializar NexusAI ---
  if (!document.querySelector('script[src*="nexusAI.js"]')) {
    const script = document.createElement('script');
    script.src = '/js/nexusAI.js';
    document.body.appendChild(script);
  }
});

window.reloadLayout = () => {
  loadAndApplyBusinessSettings();
};

async function loadAndApplyBusinessSettings() {
  try {
    const response = await fetch('/api/settings/business');
    if (!response.ok) throw new Error('No se pudo cargar la config. del negocio');
    const settings = await response.json();
    const nameElements = document.querySelectorAll('.brand-name');
    nameElements.forEach((el) => {
      el.textContent = settings.businessName || 'NexusPOS';
    });
    const logoElements = document.querySelectorAll('.brand-logo');
    logoElements.forEach((el) => {
      if (settings.logoPath) {
        el.src = `${settings.logoPath}?t=${Date.now()}`;
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  } catch (error) {
    console.error('Error al aplicar la config. del negocio:', error);
    document.querySelectorAll('.brand-name').forEach((el) => {
      el.textContent = 'NexusPOS';
    });
    document.querySelectorAll('.brand-logo').forEach((el) => {
      el.classList.add('hidden');
    });
  }
}

async function loadTopbar() {
  const container = document.getElementById('topbar-container');
  if (!container) return;
  try {
    const response = await fetch('topbar.html');
    if (!response.ok) throw new Error('No se pudo cargar la barra superior');
    container.innerHTML = await response.text();

    const hamburgerButton = document.getElementById('hamburger-button');
    if (hamburgerButton) {
      hamburgerButton.addEventListener('click', openSidebar);
    }

    await loadAndApplyBusinessSettings();
  } catch (error) {
    console.error('Error cargando topbar:', error);
  }
}

function toggleDesktopSidebar() {
  const sidebar = document.getElementById('sidebar');
  const sidebarWrapper = document.getElementById('sidebar-wrapper');
  const iconCollapse = document.getElementById('icon-collapse');
  const iconExpand = document.getElementById('icon-expand');

  if (!sidebar || !sidebarWrapper || !iconCollapse || !iconExpand) return;

  sidebar.classList.toggle('w-64');
  sidebar.classList.toggle('w-20');
  sidebarWrapper.classList.toggle('sidebar-collapsed');

  if (sidebar.classList.contains('w-20')) {
    iconCollapse.classList.add('hidden');
    iconExpand.classList.remove('hidden');
    localStorage.setItem('sidebarCollapsed', 'true');
  } else {
    iconCollapse.classList.remove('hidden');
    iconExpand.classList.add('hidden');
    localStorage.setItem('sidebarCollapsed', 'false');
  }
}

function initDesktopSidebarState() {
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    toggleDesktopSidebar();
  }
}

async function loadSidebar() {
  const container = document.getElementById('sidebar-container');
  if (!container) return;
  try {
    const response = await fetch('sidebar.html');
    if (!response.ok) throw new Error('No se pudo cargar la barra lateral');
    container.innerHTML = await response.text();

    document.getElementById('close-sidebar-button')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
    document.getElementById('sidebar-toggle-button')?.addEventListener('click', toggleDesktopSidebar);
    document.getElementById('mobile-instructions-button')?.addEventListener('click', openMobileModal);

    highlightActiveLink();
    applyRoleRestrictions();
    await loadAndApplyBusinessSettings();
    initDesktopSidebarState();
  } catch (error) {
    console.error('Error cargando sidebar:', error);
  }
}

function openSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) {
    sidebar.classList.remove('-translate-x-full');
  }
  if (overlay) {
    overlay.classList.remove('hidden');
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) {
    sidebar.classList.add('-translate-x-full');
  }
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

/**
 * Toggles a sidebar submenu (accordion)
 */
window.toggleSidebarSubmenu = function(menuId, event) {
  if (event) event.preventDefault();
  const submenu = document.getElementById(menuId);
  const chevron = document.getElementById(menuId + '-chevron');
  
  if (!submenu) return;
  
  const isHidden = submenu.classList.contains('hidden');
  
  // Close other submenus if needed (optional, for accordion effect)
  // document.querySelectorAll('.sidebar-submenu').forEach(el => { ... });

  if (isHidden) {
    submenu.classList.remove('hidden');
    if (chevron) chevron.classList.add('rotate-180');
  } else {
    submenu.classList.add('hidden');
    if (chevron) chevron.classList.remove('rotate-180');
  }
};

// =========================================================
// SISTEMA DE RESALTADO DEL SIDEBAR
// =========================================================

// Guarda la página activa actual para sobrevivir recargas del sidebar
let _activeSidebarPage = null;

/**
 * Resalta visualmente el enlace activo en el sidebar
 */
function highlightLinks(targetHref) {
  if (!targetHref) return;

  // Extraer solo el nombre del archivo (ej: 'clientes.html')
  const targetPage = targetHref.split('/').pop().split('?')[0];
  if (!targetPage) return;

  // Guardar la página activa como estado global
  _activeSidebarPage = targetPage;

  const links = document.querySelectorAll('#sidebar a.sidebar-link');
  links.forEach((link) => {
    const linkHref = link.getAttribute('href');
    if (!linkHref) return;

    const linkPage = linkHref.split('/').pop().split('?')[0];

    if (linkPage === targetPage) {
      // Activo: quitar todas las variantes de gris y agregar azul
      link.className = link.className
        .replace(/\btext-gray-\d+\b/g, '')
        .replace(/\btext-slate-\d+\b/g, '')
        .replace(/\bhover:bg-gray-\d+\b/g, '')
        .replace(/\bhover:bg-slate-\d+\b/g, '')
        .replace(/\bhover:text-white\b/g, '')
        .trim();
      link.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
      link.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');

      // Si el enlace está dentro de un submenú, expandir el padre
      const parentSubmenu = link.closest('ul[id$="-menu"]');
      if (parentSubmenu && parentSubmenu.classList.contains('hidden')) {
        const menuId = parentSubmenu.id;
        window.toggleSidebarSubmenu(menuId);
      }
    } else {
      // Inactivo: quitar azul y restaurar gris
      link.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
      if (!link.classList.contains('text-gray-200') && !link.classList.contains('text-red-400')) {
        link.classList.add('text-gray-200');
      }
    }
  });
}

/**
 * Gestiona la navegación inicial basada en el rol
 */
function initDefaultNavigation() {
  const contentFrame = document.getElementById('content-frame');
  const session = getSession() || {};
  const rol = session.rol;
  // El admin (id=1) y usuario 'master' se tratan como MASTER
  const effectiveRol = (session.username === 'master' || session.id === 1) ? 'MASTER' : rol;

  let defaultPage = 'indicadores.html';
  if (effectiveRol === 'VENDEDOR') defaultPage = 'pos.html';
  if (effectiveRol === 'CAJERO') defaultPage = 'consultor.html';
  if (effectiveRol === 'MASTER') defaultPage = 'configuracion.html';
  if (effectiveRol === 'CONSULTOR') defaultPage = 'consultor.html';

  if (contentFrame) {
    const currentSrc = contentFrame.src || '';
    // Considerar como "raíz" si está vacío, es about:blank, termina en / o es el propio index.html
    const isAtRoot = !currentSrc ||
      currentSrc.endsWith('/') ||
      currentSrc.includes('about:blank') ||
      currentSrc.endsWith('index.html');

    const isProhibitedForCajero = (effectiveRol === 'CAJERO' || effectiveRol === 'VENDEDOR') &&
      (currentSrc.includes('inventario.html') || isAtRoot);

    if (isAtRoot || isProhibitedForCajero) {
      console.log(`[NAV] Cargando página por defecto para rol ${effectiveRol}: ${defaultPage}`);
      contentFrame.src = defaultPage;
      highlightLinks(defaultPage);
    } else {
      // Hay una página activa: usar el estado guardado o leer del iframe
      const pageToHighlight = _activeSidebarPage || currentSrc.split('/').pop().split('?')[0];
      if (pageToHighlight) highlightLinks(pageToHighlight);
    }
  }
}

/**
 * Configura los eventos de clic del sidebar
 */
function setupSidebarListeners() {
  const links = document.querySelectorAll('#sidebar a.sidebar-link');
  const contentFrame = document.getElementById('content-frame');

  links.forEach((link) => {
    // Evitar duplicar listeners
    if (link.dataset.navInitialized) return;
    link.dataset.navInitialized = "true";

    link.addEventListener('click', (e) => {
      const targetHref = e.currentTarget.getAttribute('href');
      if (!targetHref) return;

      // Si la licencia expiró, forzamos configuración
      if (globalLicenseStatus === 'EXPIRED' && targetHref !== 'configuracion.html') {
        e.preventDefault();
        if (contentFrame) contentFrame.src = 'configuracion.html';
        highlightLinks('configuracion.html');
        closeSidebar();
        return;
      }

      // Resaltar inmediatamente al hacer clic (no esperar el evento load del iframe)
      highlightLinks(targetHref);
      closeSidebar();
    });
  });
}

/**
 * Punto de entrada: activa el resaltado y la lógica del sidebar.
 */
function highlightActiveLink() {
  setupSidebarListeners();
  initDefaultNavigation();

  // Escuchar cambios en el iframe para actualizar el resaltado del sidebar automáticamente cuando se navega internamente
  const contentFrame = document.getElementById('content-frame');
  if (contentFrame && !contentFrame.dataset.listenerInitialized) {
    contentFrame.dataset.listenerInitialized = "true";
    contentFrame.addEventListener('load', () => {
      try {
        // Obtener la página REAL del iframe (location.pathname es más fiable que .src)
        const currentPath = contentFrame.contentWindow.location.pathname;
        let currentPage = '';

        if (currentPath && currentPath !== 'blank' && currentPath !== '/') {
          currentPage = currentPath.split('/').pop().split('?')[0];
        }

        // Si no pudimos obtenerla del pathname o es index.html (el wrapper), usamos .src como fallback
        if (!currentPage || currentPage === 'index.html') {
          const currentSrc = contentFrame.src;
          if (currentSrc) {
            currentPage = currentSrc.split('/').pop().split('?')[0];
          }
        }

        if (currentPage && currentPage !== 'index.html') {
          console.log(`[NAV] Detectada navegación a: ${currentPage}`);
          highlightLinks(currentPage);
        }
      } catch (e) {
        console.warn('Error al actualizar resaltado de sidebar:', e);
        // Fallback final al .src ante errores de seguridad
        const currentSrc = contentFrame.src;
        if (currentSrc) {
          const currentPage = currentSrc.split('/').pop().split('?')[0];
          if (currentPage) highlightLinks(currentPage);
        }
      }
    });
  }
}

function applyRoleRestrictions() {
  const session = getSession();
  if (!session) return;

  try {
    const rol = session.rol;
    // El usuario 'master' se trata como MASTER aunque su rol en BD sea ADMIN
    const effectiveRol = (session.username === 'master' || session.id === 1) ? 'MASTER' : rol;

    // 0. Restricción MASTER: solo ver Configuración
    if (effectiveRol === 'MASTER') {
      const sidebarLinks = document.querySelectorAll('#sidebar a.sidebar-link');
      sidebarLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href !== 'configuracion.html') {
          const li = link.closest('li');
          if (li) {
            li.classList.add('hidden');
            li.style.display = 'none';
          }
        }
      });
      // También ocultar todos los encabezados de sección
      const sectionHeaders = document.querySelectorAll('#sidebar li[data-role-restricted]');
      sectionHeaders.forEach(el => {
        if (!el.querySelector('a[href="configuracion.html"]')) {
          el.classList.add('hidden');
          el.style.display = 'none';
        }
      });
      // Ocultar botones de submenu (Reportes, etc.)
      const submenuButtons = document.querySelectorAll('#sidebar button[onclick*="toggleSidebarSubmenu"]');
      submenuButtons.forEach(btn => {
        const li = btn.closest('li');
        if (li) {
          li.classList.add('hidden');
          li.style.display = 'none';
        }
      });
      // Ocultar botones especiales excepto logout
      const specialButtons = document.querySelectorAll('#sidebar button:not([onclick*="toggleSidebarSubmenu"]):not([onclick*="logoutSystem"]), #sidebar a[href="#"]');
      specialButtons.forEach(btn => {
        const li = btn.closest('li');
        if (li && !li.querySelector('a[href="configuracion.html"]')) {
          li.classList.add('hidden');
          li.style.display = 'none';
        }
      });
      return;
    }

    // 0.1 Restricción CONSULTOR: solo ver Consultor de Precios
    if (effectiveRol === 'CONSULTOR') {
      const sidebarLinks = document.querySelectorAll('#sidebar a.sidebar-link');
      sidebarLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && href !== 'consultor.html') {
          const li = link.closest('li');
          if (li) {
            li.classList.add('hidden');
            li.style.display = 'none';
          }
        }
      });
      // Ocultar encabezados de sección
      const sectionHeaders = document.querySelectorAll('#sidebar li[data-role-restricted]');
      sectionHeaders.forEach(el => {
        if (!el.querySelector('a[href="consultor.html"]')) {
          el.classList.add('hidden');
          el.style.display = 'none';
        }
      });
      // Ocultar botones de submenu
      const submenuButtons = document.querySelectorAll('#sidebar button[onclick*="toggleSidebarSubmenu"]');
      submenuButtons.forEach(btn => {
        const li = btn.closest('li');
        if (li) {
          li.classList.add('hidden');
          li.style.display = 'none';
        }
      });
      // Ocultar botones especiales excepto logout
      const specialButtons = document.querySelectorAll('#sidebar button:not([onclick*="toggleSidebarSubmenu"]):not([onclick*="logoutSystem"]), #sidebar a[href="#"]');
      specialButtons.forEach(btn => {
        const li = btn.closest('li');
        if (li && !li.querySelector('a[href="consultor.html"]')) {
          li.classList.add('hidden');
          li.style.display = 'none';
        }
      });
      return;
    }

    // 1. Ocultar elementos restringidos a roles específicos
    const restrictedElements = document.querySelectorAll('[data-role-restricted]');
    restrictedElements.forEach(el => {
      const requiredRole = el.getAttribute('data-role-restricted');
      
      // Si el elemento requiere MASTER, solo mostrar para MASTER
      if (requiredRole === 'MASTER' && effectiveRol !== 'MASTER') {
        el.classList.add('hidden');
        el.style.display = 'none';
      }
      // Si el elemento requiere ADMIN, mostrar para ADMIN y MASTER
      else if (requiredRole === 'ADMIN' && effectiveRol !== 'ADMIN' && effectiveRol !== 'MASTER') {
        el.classList.add('hidden');
        el.style.display = 'none';
      } else if (requiredRole !== 'MASTER' && requiredRole !== 'ADMIN') {
        // Para otros roles, ocultar si no coincide
        if (requiredRole !== effectiveRol) {
          el.classList.add('hidden');
          el.style.display = 'none';
        } else {
          el.classList.remove('hidden');
          el.style.display = '';
        }
      } else {
        // En caso de que se haya ocultado previamente y ahora deba ser visible
        el.classList.remove('hidden');
        el.style.display = ''; 
      }
    });

    // 2. Restricción adicional específica para CAJERO
    if (effectiveRol === 'CAJERO') {
      const allowedCajeroPages = ['clientes.html', 'consultor.html', 'cobranza.html', 'pos.html'];
      const sidebarLinks = document.querySelectorAll('#sidebar a.sidebar-link');
      sidebarLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && !allowedCajeroPages.includes(href)) {
          const li = link.closest('li');
          if (li) {
            li.classList.add('hidden');
            li.style.display = 'none';
          }
        }
      });
    }
    
    // 3. Restricción para VENDEDOR (similar a CAJERO pero con permisos de inventario)
    if (effectiveRol === 'VENDEDOR') {
      const allowedVendedorPages = ['clientes.html', 'consultor.html', 'cobranza.html', 'pos.html', 'inventario.html'];
      const sidebarLinks = document.querySelectorAll('#sidebar a.sidebar-link');
      sidebarLinks.forEach(link => {
        const href = link.getAttribute('href');
        if (href && !allowedVendedorPages.includes(href)) {
          const li = link.closest('li');
          if (li) {
            li.classList.add('hidden');
            li.style.display = 'none';
          }
        }
      });
    }
  } catch (e) {
    console.error('Error al aplicar restricciones de rol:', e);
  }
}

async function openMobileModal() {
  const mobileModal = document.getElementById('mobile-modal');
  if (!mobileModal) return;

  const ipDisplayElement = mobileModal.querySelector('#local-ip-urls');
  const qrCodeImage = mobileModal.querySelector('#qr-code-image');
  const qrCodeLoading = mobileModal.querySelector('#qr-code-loading');

  if (!ipDisplayElement || !qrCodeImage || !qrCodeLoading) {
    mobileModal.classList.remove('hidden');
    return;
  }

  ipDisplayElement.innerHTML = '<span class="text-gray-500 text-sm">Obteniendo dirección...</span>';
  qrCodeImage.classList.add('hidden');
  qrCodeLoading.textContent = 'Generando QR...';
  qrCodeLoading.classList.remove('hidden');

  // Puerto REAL con el que se abrió la app (portfinder en main.js)
  const currentPort = window.location.port || '';

  try {
    // 👇 ahora enviamos el puerto al backend
    const response = await fetch('/api/utils/local-ip?port=' + encodeURIComponent(currentPort));
    const data = await response.json();

    if (data.success && Array.isArray(data.urls) && data.urls.length > 0) {
      ipDisplayElement.innerHTML = '';

      data.urls.forEach((url) => {
        const strong = document.createElement('strong');
        strong.className = 'block text-blue-600 break-all font-mono py-1';
        strong.textContent = url;
        ipDisplayElement.appendChild(strong);
      });

      // El backend ya genera el QR con el puerto correcto
      if (data.qrCodeDataURL) {
        qrCodeImage.src = data.qrCodeDataURL;
        qrCodeImage.classList.remove('hidden');
        qrCodeLoading.classList.add('hidden');
      } else {
        qrCodeLoading.textContent = 'Error al generar QR.';
        qrCodeLoading.classList.remove('hidden');
        qrCodeImage.classList.add('hidden');
      }
    } else {
      ipDisplayElement.innerHTML =
        '<span class="text-red-500 text-sm">No se pudo obtener la IP local. Revisa tu conexión de red.</span>';
      qrCodeLoading.textContent = 'QR no disponible.';
      qrCodeLoading.classList.remove('hidden');
      qrCodeImage.classList.add('hidden');
    }

    // Tunnel URL
    const tunnelSection = mobileModal.querySelector('#tunnel-access-section');
    const tunnelDisplay = mobileModal.querySelector('#tunnel-url-display');
    const copyBtn = mobileModal.querySelector('#copy-tunnel-btn');
    if (data.tunnelUrl && tunnelSection && tunnelDisplay) {
      tunnelSection.classList.remove('hidden');
      tunnelDisplay.innerHTML = '<a href="' + data.tunnelUrl + '" target="_blank" class="block text-green-700 break-all font-mono text-sm font-bold">' + data.tunnelUrl + '</a>';
      if (copyBtn) copyBtn.classList.remove('hidden');
      window._tunnelUrl = data.tunnelUrl;
    }
  } catch (e) {
    console.error('Error fetching local IP:', e);
    ipDisplayElement.innerHTML =
      '<span class="text-red-500 text-sm">Error al contactar el servidor para obtener la IP.</span>';
    qrCodeLoading.textContent = 'Error.';
    qrCodeLoading.classList.remove('hidden');
    qrCodeImage.classList.add('hidden');
  }

  mobileModal.classList.remove('hidden');
}


window.askForAdminPassword = () => {
  return new Promise(async (resolve, reject) => {
    const response = await fetch('/api/auth/status');
    const data = await response.json();

    if (!data.isPasswordEnabled) {
      resolve(true);
      return;
    }

    const modal = document.getElementById('admin-password-modal');
    const form = document.getElementById('form-verify-password');
    const cancelButton = document.getElementById('btn-cancel-verification');
    const passwordInput = document.getElementById('verify-password-input');
    const statusElement = document.getElementById('verify-password-status');

    if (!modal || !form || !cancelButton || !passwordInput || !statusElement) {
      console.error('Elementos del modal de contraseña no encontrados en index.html.');
      reject(new Error('Modal de contraseña no implementado.'));
      return;
    }

    const closePasswordModal = () => {
      modal.classList.add('hidden');
      form.onsubmit = null;
      cancelButton.onclick = null;
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const password = passwordInput.value;
      statusElement.textContent = 'Verificando...';
      statusElement.className = 'text-sm mt-3 text-center text-gray-600';

      try {
        const verifyResponse = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password }),
        });
        const result = await verifyResponse.json();

        if (!verifyResponse.ok) {
          throw new Error(result.error || 'Error desconocido');
        }

        statusElement.textContent = '¡Éxito!';
        statusElement.className = 'text-sm mt-3 text-center text-green-600';
        setTimeout(() => {
          closePasswordModal();
          resolve(true);
        }, 500);
      } catch (error) {
        statusElement.textContent = `Error: ${error.message} `;
        statusElement.className = 'text-sm mt-3 text-center text-red-600';
      }
    };

    cancelButton.onclick = () => {
      closePasswordModal();
      resolve(false);
    };

    passwordInput.value = '';
    statusElement.textContent = '';
    modal.classList.remove('hidden');
    passwordInput.focus();
  });
};

// ---------- WhatsApp Window Logic (Bypassing Iframe restrictions) ----------
window.toggleWhatsAppDrawer = function () {
  const url = encodeURIComponent('https://web.whatsapp.com/');
  fetch(`/api/utils/open-external?url=${url}`).catch(console.error);
};

// Inicializar eventos de WhatsApp después de cargar el sidebar
const originalLoadSidebar = window.loadSidebar;
window.loadSidebar = async function () {
  await originalLoadSidebar();

  const whatsappBtn = document.getElementById('toggle-whatsapp-btn');
  if (whatsappBtn) {
    whatsappBtn.addEventListener('click', (e) => {
      e.preventDefault();
      window.toggleWhatsAppDrawer();
    });
  }
};

// ---------- WhatsApp Sharing Helpers ----------

window.sendWhatsAppMessage = function (phone, text) {
  // Limpiar el teléfono (solo números)
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const encodedText = encodeURIComponent(text);

  // Si no hay teléfono, abrir WhatsApp sin contacto prefijado
  const waUrl = cleanPhone
    ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`
    : `https://api.whatsapp.com/send?text=${encodedText}`;

  fetch(`/api/utils/open-external?url=${encodeURIComponent(waUrl)}`).catch(console.error);
};

// ---------- WhatsApp + PDF Sharing ----------

window.sendWhatsAppWithPdf = function (saleId, phone) {
  let cleanPhone = String(phone || '').replace(/\D/g, '');
  if (cleanPhone.startsWith('0') && cleanPhone.length >= 10) {
    cleanPhone = '58' + cleanPhone.substring(1);
  } else if (cleanPhone.length === 10 && !cleanPhone.startsWith('58')) {
    cleanPhone = '58' + cleanPhone;
  }

  // 1) Abrir el recibo para imprimir/guardar como PDF
  //    El recibo abre en ventana pequeña con botón Imprimir
  const receiptUrl = `/api/sales/${saleId}/receipt?pdfMode=1`;
  const rw = 400;
  const rh = 900;
  const rleft = Math.round((screen.width - rw) / 2);
  const rtop = Math.round((screen.height - rh) / 2);
  const receiptWin = window.open(
    receiptUrl,
    `Recibo_${saleId}`,
    `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, width=${rw}, height=${rh}, top=${rtop}, left=${rleft}`
  );

  // 2) Obtener la factura para mandarla como texto
  setTimeout(async () => {
    try {
      const response = await fetch(`/api/sales/${saleId}/details`);
      if (!response.ok) throw new Error('Error al obtener venta');
      
      const saleData = await response.json();
      const text = window.formatInvoiceMessage(saleData);
      const encodedText = encodeURIComponent(text);
      
      const waUrl = cleanPhone
        ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`
        : `https://api.whatsapp.com/send?text=${encodedText}`;

      fetch(`/api/utils/open-external?url=${encodeURIComponent(waUrl)}`).catch(console.error);
    } catch (error) {
      console.error('No se pudo cargar detalles para WhatsApp:', error);
      // Fallback a mensaje genérico si falla
      const text = `¡Hola! Te comparto tu factura *#${saleId}* de NexusPOS.\n\nAdjunto el PDF que ya se abrió en pantalla (imprímelo o guárdalo como PDF desde el botón "Imprimir").`;
      const encodedText = encodeURIComponent(text);
      const waUrl = cleanPhone
        ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`
        : `https://api.whatsapp.com/send?text=${encodedText}`;
      
      fetch(`/api/utils/open-external?url=${encodeURIComponent(waUrl)}`).catch(console.error);
    }
  }, 800);
};

window.formatInvoiceMessage = function (saleData) {
  const { sale, cliente, products, payments, abonos } = saleData;
  const businessName = "NexusPOS"; // Podría venir de ajustes en el futuro

  let msg = `*FACTURA DE VENTA - ${businessName}*\n`;
  msg += `--------------------------------\n`;
  msg += `*Venta #:* ${sale.id}\n`;
  msg += `*Fecha:* ${new Date(sale.creado_en || Date.now()).toLocaleString('es-VE')}\n`;

  if (cliente && cliente.nombre) {
    msg += `*Cliente:* ${cliente.nombre}\n`;
    if (cliente.cedula) msg += `*Cédula/RIF:* ${cliente.cedula}\n`;
  }

  msg += `\n*Detalle de Productos:*\n`;
  products.forEach(p => {
    const qty = p.cantidad || 1;
    const price = Number(p.precio_unitario_ves || 0).toFixed(2);
    const subtotal = (qty * price).toFixed(2);
    let unitSuffix = '';
    if (p.tipo_venta === 'PESO') unitSuffix = ' Kg';
    else if (p.tipo_venta === 'LITRO') unitSuffix = ' Lt';
    let qtyDisplay = qty;
    if (p.tipo_venta === 'PESO' || p.tipo_venta === 'LITRO') qtyDisplay = Number(qty).toFixed(3);
    msg += `• ${qtyDisplay}${unitSuffix} x ${p.producto_nombre || 'Producto'} = ${subtotal} Bs\n`;
  });

  msg += `\n--------------------------------\n`;
  msg += `*TOTAL A PAGAR: ${Number(sale.total_ves).toFixed(2)} Bs*\n`;
  if (sale.total_usd_bcv) msg += `*Total en Divisas: ${Number(sale.total_usd_bcv).toFixed(2)} $* \n`;

  // METODOS DE PAGO Y TASA
  if (payments && payments.length > 0) {
    msg += `\n*Método de Pago:*\n`;
    let globalRate = null;
    payments.forEach(p => {
      let label = p.metodo;
      if (p.metodo === 'VES_EFECTIVO') label = 'Efectivo Bs';
      if (p.metodo === 'USD_EFECTIVO') label = 'Efectivo $';
      if (p.metodo === 'TARJETA') label = 'Tarjeta';
      if (p.metodo === 'BIOPAGO') label = 'Biopago';
      if (p.metodo === 'PAGOMOVIL') label = 'Pago Móvil';
      if (p.metodo === 'ZELLE') label = 'Zelle';

      let amountStr = `${Number(p.monto_en_ves).toFixed(2)} Bs`;
      if (p.metodo === 'USD_EFECTIVO' || p.metodo === 'ZELLE') {
        const rate = p.tasa_bcv_momento || (sale.total_ves / sale.total_usd_bcv);
        amountStr += ` (${Number(p.monto_recibido).toFixed(2)} $ x ${Number(rate).toFixed(2)})`;
      }
      
      if (p.referencia) {
        amountStr += ` (Ref: ${p.referencia})`;
      }
      
      msg += `• ${label}: ${amountStr}\n`;
      
      // Intentar extraer la tasa referencial de la venta para mostrarla al final de los pagos
      if (!globalRate && p.tasa_bcv_momento) globalRate = p.tasa_bcv_momento;
    });

    if (!globalRate && sale.total_usd_bcv > 0) {
      globalRate = sale.total_ves / sale.total_usd_bcv;
    }
    
    if (globalRate) {
      const rateType = sale.tasa_referencia || 'BCV';
      msg += `\n*Tasa ${rateType}:* ${Number(globalRate).toFixed(2)} Bs\n`;
    }
  }

  // ABONOS
  if (abonos && abonos.length > 0) {
    msg += `\n*Abonos:*\n`;
    abonos.forEach(a => {
      const fecha = a.fecha ? new Date(a.fecha).toLocaleString('es-VE') : '';
      const monto = Number(a.monto_pagado_ves || 0).toFixed(2);
      const metodo = a.metodo || 'N/A';
      msg += `• ${fecha} - ${metodo}: ${monto} Bs\n`;
    });
  }

  if (sale.estado_pago === 'FIADO' || sale.estado_pago === 'ABONADO') {
    const pendiente = Number(sale.monto_pendiente_usd || 0).toFixed(2);
    msg += `\n*ESTADO:* PENDIENTE\n`;
    msg += `*Saldo Pendiente:* ${pendiente} $\n`;
  } else {
    msg += `\n*ESTADO:* PAGADO\n`;
  }

  msg += `\nGracias por su compra.`;
  return msg;
};

window.formatReportMessage = function (reportData) {
  const { startDate, endDate, summary } = reportData;
  let msg = `*RESUMEN DE VENTAS - NexusPOS*\n`;
  msg += `--------------------------------\n`;
  msg += `*Desde:* ${startDate}\n`;
  msg += `*Hasta:* ${endDate}\n`;
  msg += `\n*Totales:*\n`;
  msg += `• *Ingresos:* ${summary.totalIngresos.toFixed(2)} Bs\n`;
  msg += `• *Equivalente:* ${(summary.totalIngresos / (summary.bcv || 1)).toFixed(2)} $\n`;
  msg += `• *Ganancia:* ${summary.totalGanancia.toFixed(2)} Bs\n`;
  msg += `• *Fiado:* ${summary.totalFiado.toFixed(2)} Bs\n`;
  msg += `\n--------------------------------\n`;
  msg += `Generado automáticamente por NexusPOS.`;
  return msg;
};

// =========================================================
// MÓDULO GLOBAL DE REPORTES Y CIERRE Z (Migrado del POS/Config)
// =========================================================

const CIERRE_Z_HISTORY_LIMIT = 50;
let cierreZHistoryCurrentPage = 1;
let cierreZHistoryTotalPages = 1;

document.addEventListener('click', async (e) => {
  // --- INVENTARIO PDF ---
  const btnInv = e.target.closest('#sidebarBtnPrintInventoryPdf');
  if (btnInv) {
    e.preventDefault();
    const hasPermission = await window.askForAdminPassword();
    if (!hasPermission) return;
    window.openSystemAlert('Generando PDF de inventario...', 'Generando');
    try {
      window.openAppWindow('/api/reports/inventory-pdf', 'Inventario PDF', 1000, 900);
      setTimeout(() => {
        const els = getGlobalAlertModalElements();
        if (els && !els.modal.classList.contains('hidden')) els.btnCloseX.click();
      }, 3000);
    } catch (error) {
      window.openSystemAlert('Error al generar el PDF de inventario.', 'Error');
    }
  }

  // --- FIADOS PDF ---
  const btnFiados = e.target.closest('#sidebarBtnPrintFiadosPdf');
  if (btnFiados) {
    e.preventDefault();
    const hasPermission = await window.askForAdminPassword();
    if (!hasPermission) return;
    window.openSystemAlert('Generando PDF de fiados...', 'Generando');
    try {
      window.openAppWindow('/api/reports/fiados-pdf', 'Fiados PDF', 1000, 900);
      setTimeout(() => {
        const els = getGlobalAlertModalElements();
        if (els && !els.modal.classList.contains('hidden')) els.btnCloseX.click();
      }, 3000);
    } catch (error) {
      window.openSystemAlert('Error al generar el PDF de fiados.', 'Error');
    }
  }

  // --- HISTORIAL Z ---
  const btnZ = e.target.closest('#sidebarBtnOpenCierreZHistory');
  if (btnZ) {
    e.preventDefault();
    const hasPermission = await window.askForAdminPassword();
    if (!hasPermission) return;
    openCierreZHistoryModalGlobal();
  }

  // Clicks dentro de la tabla Z
  const pdfBtnZ = e.target.closest('.btn-open-cierre-z-pdf');
  if (pdfBtnZ) {
    e.preventDefault();
    const id = pdfBtnZ.dataset.id;
    if (id) {
      window.open(`/api/reports/cierre-z/${id}/pdf`, '_blank', 'noopener');
    }
  }
});

// --- Modal Historial Z Logic ---

function getCierreZModalEls() {
  return {
    modal: document.getElementById('cierreZHistoryModal'),
    btnClose: document.getElementById('btnCloseCierreZHistory'),
    body: document.getElementById('cierreZHistoryBody'),
    status: document.getElementById('cierreZHistoryStatus'),
    start: document.getElementById('z-history-start-date'),
    end: document.getElementById('z-history-end-date'),
    btnFilter: document.getElementById('btn-search-z-history'),
    btnClear: document.getElementById('btn-clear-z-history'),
    btnExport: document.getElementById('btn-export-z-history-excel'),
    prev: document.getElementById('cierreZHistoryPrev'),
    next: document.getElementById('cierreZHistoryNext'),
    info: document.getElementById('cierreZHistoryPaginationInfo'),
    quickBtns: document.querySelectorAll('.btn-quick-date-z')
  };
}

let __zElsAttached = false;

function openCierreZHistoryModalGlobal() {
  const els = getCierreZModalEls();
  if (!els.modal) return;

  if (!__zElsAttached) {
    els.btnClose.addEventListener('click', closeCierreZHistoryModalGlobal);
    els.btnFilter.addEventListener('click', () => loadCierreZHistoryGlobal(1));
    els.btnClear.addEventListener('click', () => {
      els.start.value = '';
      els.end.value = '';
      loadCierreZHistoryGlobal(1);
    });
    els.prev.addEventListener('click', () => {
      if (cierreZHistoryCurrentPage > 1) loadCierreZHistoryGlobal(cierreZHistoryCurrentPage - 1);
    });
    els.next.addEventListener('click', () => {
      if (cierreZHistoryCurrentPage < cierreZHistoryTotalPages) loadCierreZHistoryGlobal(cierreZHistoryCurrentPage + 1);
    });
    els.btnExport.addEventListener('click', () => {
      let url = '/api/reports/cierre-z/history/export?foo=1';
      if (els.start.value) url += `&startDate=${els.start.value}`;
      if (els.end.value) url += `&endDate=${els.end.value}`;
      window.location.href = url;
    });

    els.quickBtns.forEach(btn => {
      btn.addEventListener('click', (ev) => {
        const range = ev.target.dataset.range;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const today = fmt(now);

        if (range === 'today') {
          els.start.value = today;
          els.end.value = today;
        } else if (range === 'yesterday') {
          const yest = new Date(now);
          yest.setDate(yest.getDate() - 1);
          els.start.value = fmt(yest);
          els.end.value = fmt(yest);
        } else if (range === 'last7') {
          const p = new Date(now);
          p.setDate(p.getDate() - 7);
          els.start.value = fmt(p);
          els.end.value = today;
        }
        loadCierreZHistoryGlobal(1);
      });
    });
    __zElsAttached = true;
  }

  if (els.status) {
    els.status.textContent = 'Cargando historial de cierres...';
    els.status.className = 'text-sm text-gray-500 mb-2';
  }

  cierreZHistoryCurrentPage = 1;
  cierreZHistoryTotalPages = 1;
  updateCierreZHistoryPaginationUIGlobal();

  els.modal.classList.remove('hidden');
  loadCierreZHistoryGlobal(1);
}

function closeCierreZHistoryModalGlobal() {
  const els = getCierreZModalEls();
  if (!els.modal) return;
  els.modal.classList.add('hidden');
}

async function loadCierreZHistoryGlobal(page = 1) {
  const els = getCierreZModalEls();
  if (!els.body) return;

  cierreZHistoryCurrentPage = page;
  els.body.innerHTML = `<tr><td colspan="5" class="px-4 py-3 text-center text-gray-500 text-sm">Cargando...</td></tr>`;

  try {
    const params = new URLSearchParams();
    params.append('limit', CIERRE_Z_HISTORY_LIMIT);
    params.append('page', String(page));
    if (els.start && els.start.value) params.append('startDate', els.start.value);
    if (els.end && els.end.value) params.append('endDate', els.end.value);

    const response = await fetch(`/api/reports/cierre-z/history?${params.toString()}`);
    if (!response.ok) throw new Error('No se pudo cargar el historial.');

    const data = await response.json();
    let cierres;
    let totalPages = 1;

    if (Array.isArray(data)) {
      cierres = data;
    } else {
      cierres = Array.isArray(data.rows) ? data.rows :
        (Array.isArray(data.cierres) ? data.cierres :
          (Array.isArray(data.items) ? data.items : []));
      if (typeof data.totalPages === 'number') totalPages = data.totalPages;
      else if (typeof data.total_pages === 'number') totalPages = data.total_pages;
      else if (typeof data.total === 'number') totalPages = Math.max(1, Math.ceil(data.total / CIERRE_Z_HISTORY_LIMIT));
    }

    cierreZHistoryTotalPages = totalPages || 1;
    renderCierreZHistoryGlobal(cierres, els.body);
    updateCierreZHistoryPaginationUIGlobal();

    if (els.status) {
      els.status.textContent = cierres.length === 0 ? 'No hay cierres Z registrados.' : '';
      els.status.className = 'text-sm text-gray-500 mb-2';
    }
  } catch (error) {
    els.body.innerHTML = `<tr><td colspan="5" class="px-4 py-3 text-center text-red-500 text-sm">Error al cargar historial.</td></tr>`;
    if (els.status) {
      els.status.textContent = error.message;
      els.status.className = 'text-sm text-red-600 mb-2';
    }
  }
}

function renderCierreZHistoryGlobal(cierres, tbody) {
  tbody.innerHTML = '';
  if (!cierres || cierres.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-3 text-center text-gray-500 text-sm">No hay cierres Z registrados.</td></tr>`;
    return;
  }
  cierres.forEach((cierre) => {
    const fechaRaw = cierre.fecha || cierre.date || cierre.created_at || cierre.createdAt;
    let fechaTexto = '-';
    if (fechaRaw) {
      const d = new Date(fechaRaw);
      if (!isNaN(d.getTime())) fechaTexto = d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
    }
    const tVes = Number(cierre.total_sistema_ves || cierre.total_ves || cierre.totalVes || 0);
    const tUsd = Number(cierre.total_sistema_usd || cierre.total_usd || cierre.totalUsd || 0);
    const aVes = Number(cierre.opening_ves || cierre.apertura_ves || 0);
    const aUsd = Number(cierre.opening_usd || cierre.apertura_usd || 0);
    const notasFull = cierre.notes || cierre.notas || '';
    const notasCortas = notasFull ? (notasFull.length > 50 ? notasFull.slice(0, 50) + '…' : notasFull) : '';

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50';
    tr.innerHTML = `
      <td class="px-4 py-2 text-xs text-gray-700 whitespace-nowrap">${fechaTexto}</td>
      <td class="px-4 py-2 text-xs text-gray-800 text-right whitespace-nowrap">${tVes.toFixed(2)} Bs<br><span class="text-gray-500">(${tUsd.toFixed(2)} $)</span></td>
      <td class="px-4 py-2 text-xs text-gray-800 text-right whitespace-nowrap">${(aVes > 0 || aUsd > 0) ? `${aVes.toFixed(2)} Bs / ${aUsd.toFixed(2)} $` : '<span class="text-gray-400">–</span>'}</td>
      <td class="px-4 py-2 text-xs text-gray-600">${notasCortas ? notasCortas : '<span class="text-gray-400">Sin notas</span>'}</td>
      <td class="px-4 py-2 text-xs text-right whitespace-nowrap">
        <button class="btn-open-cierre-z-pdf px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700" data-id="${cierre.id}">Ver / Imprimir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateCierreZHistoryPaginationUIGlobal() {
  const els = getCierreZModalEls();
  if (els.info) els.info.textContent = `Página ${cierreZHistoryCurrentPage} de ${cierreZHistoryTotalPages}`;
  if (els.prev) {
    const d = cierreZHistoryCurrentPage <= 1;
    els.prev.disabled = d;
    els.prev.classList.toggle('opacity-50', d);
    els.prev.classList.toggle('cursor-not-allowed', d);
  }
  if (els.next) {
    const d = cierreZHistoryCurrentPage >= cierreZHistoryTotalPages;
    els.next.disabled = d;
    els.next.classList.toggle('opacity-50', d);
    els.next.classList.toggle('cursor-not-allowed', d);
  }
}

function copyTunnelLink() {
  if (window._tunnelUrl) {
    navigator.clipboard.writeText(window._tunnelUrl).then(() => {
      const btn = document.getElementById('copy-tunnel-btn');
      if (btn) { btn.textContent = 'Copiado!'; setTimeout(() => { btn.textContent = 'Copiar'; }, 1500); }
    });
  }
}
