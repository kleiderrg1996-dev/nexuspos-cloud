// Proxy para acceder al helper de ventanas desde cualquier contexto (Iframe o Popup)
const _openWindows = {};
window.openAppWindow = window.openAppWindow || (window.parent && window.parent.openAppWindow) || (window.opener && window.opener.openAppWindow) || function (url, title = 'NexusPOS', w = 1000, h = 800) {
  const left = (screen.width / 2) - (w / 2);
  const top = (screen.height / 2) - (h / 2);
  const key = title || url;
  if (_openWindows[key] && !_openWindows[key].closed) {
    _openWindows[key].location.href = url;
    _openWindows[key].focus();
    return _openWindows[key];
  }
  const win = window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
  _openWindows[key] = win;
  return win;
};

// Proxies para helpers de WhatsApp definidos en layout.js (ventana padre)
window.sendWhatsAppMessage = window.sendWhatsAppMessage || (window.parent && window.parent.sendWhatsAppMessage) || (window.opener && window.opener.sendWhatsAppMessage) || null;
window.formatInvoiceMessage = window.formatInvoiceMessage || (window.parent && window.parent.formatInvoiceMessage) || (window.opener && window.opener.formatInvoiceMessage) || null;
window.sendWhatsAppWithPdf = window.sendWhatsAppWithPdf || (window.parent && window.parent.sendWhatsAppWithPdf) || (window.opener && window.opener.sendWhatsAppWithPdf) || null;

document.addEventListener('DOMContentLoaded', () => {

  // =========================
  // HELPERS: GLOBAL MODAL (INDEX.HTML)
  // =========================
  function getParentDocument() {
    try {
      if (window.parent && window.parent !== window && window.parent.document) {
        return window.parent.document;
      }
    } catch (e) {
    }
    return document;
  }


  // Helper para obtener fecha local YYYY-MM-DD
  function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function showGlobalAlert(message, title = 'Alerta del Sistema') {
    return new Promise((resolve) => {
      const parentDoc = getParentDocument();
      const modal = parentDoc.getElementById('global-alert-modal');
      const titleEl = parentDoc.getElementById('global-alert-title');
      const msgEl = parentDoc.getElementById('global-alert-message');
      const btnOk = parentDoc.getElementById('btn-global-ok');
      const btnCancel = parentDoc.getElementById('btn-global-cancel');
      const btnClose = parentDoc.getElementById('btn-close-global-alert');

      if (!modal || !titleEl || !msgEl || !btnOk) {
        window.alert(message);
        resolve();
        return;
      }

      titleEl.textContent = title;
      msgEl.textContent = message;

      if (btnCancel) btnCancel.classList.add('hidden');

      const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', onOk);
        if (btnClose) btnClose.removeEventListener('click', onClose);
      };

      const onOk = () => {
        cleanup();
        resolve();
      };

      const onClose = () => {
        cleanup();
        resolve();
      };

      btnOk.addEventListener('click', onOk);
      if (btnClose) btnClose.addEventListener('click', onClose);

      modal.classList.remove('hidden');
    });
  }

  function showGlobalConfirm(message, title = 'Confirmación') {
    return new Promise((resolve) => {
      const parentDoc = getParentDocument();
      const modal = parentDoc.getElementById('global-alert-modal');
      const titleEl = parentDoc.getElementById('global-alert-title');
      const msgEl = parentDoc.getElementById('global-alert-message');
      const btnOk = parentDoc.getElementById('btn-global-ok');
      const btnCancel = parentDoc.getElementById('btn-global-cancel');
      const btnClose = parentDoc.getElementById('btn-close-global-alert');

      if (!modal || !titleEl || !msgEl || !btnOk || !btnCancel) {
        const result = window.confirm(message);
        resolve(result);
        return;
      }

      titleEl.textContent = title;
      msgEl.textContent = message;

      btnCancel.classList.remove('hidden');

      const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', onOk);
        btnCancel.removeEventListener('click', onCancel);
        if (btnClose) btnClose.removeEventListener('click', onClose);
      };

      const onOk = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      const onClose = () => {
        cleanup();
        resolve(false);
      };

      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
      if (btnClose) btnClose.addEventListener('click', onClose);

      modal.classList.remove('hidden');
    });
  }

  // =========================
  // ESTADO Y VARIABLES GLOBALES POS
  // =========================

  // Variables de estado
  let cart = [];
  let posReady = false;
  let currentClient = null;
  let currentRoundingMode = 'NONE'; // NONE, UP, DOWN
  const ROUNDING_STEP = 10;
  let currentSearchResults = [];
  let currentRates = {};
  let searchTimeoutPOS;
  let totalChangeDueVes = 0;
  let productForQuantityModal = null;
  let currentClientSearchTimeout;
  let currentClients = [];
  let selectedClientId = null;
  let barcodeScanTimeout;
  let barcodeBuffer = '';
  let manageClientSearchTimeout;
  let currentManageClients = [];
  let lastCompletedSaleId = null;
  let currentPriceEditItem = null;
  let priceModalCurrentCurrency = 'VES';
  let selectedClientObject = null;

  const CART_STORAGE_KEY = 'pos_current_cart';
  const HELD_SALES_STORAGE_KEY = 'pos_held_sales'; // ventas en espera

  // NUEVO: venta en espera pendiente mientras se escribe el nombre
  let pendingHoldSale = null;

  // =========================
  // LOGICA MÓVIL (TABS/VISTAS)
  // =========================
  const posProductsCol = document.getElementById('pos-products-col');
  const posCartCol = document.getElementById('pos-cart-col');
  const mobileBottomBar = document.getElementById('mobile-bottom-bar');
  const btnMobileToggleView = document.getElementById('btn-mobile-toggle-view');
  const mobileTotalDisplay = document.getElementById('mobile-total-display');

  let isMobileCartVisible = false;

  function updateMobileToggleUI() {
    if (!posProductsCol || !posCartCol || !btnMobileToggleView) return;

    if (isMobileCartVisible) {
      // Mostrar Carrito, Ocultar Productos (Móvil)
      posProductsCol.classList.add('hidden');
      posProductsCol.classList.remove('flex');

      posCartCol.classList.remove('hidden');
      posCartCol.classList.add('flex');

      btnMobileToggleView.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
        <span>Ver Productos</span>
      `;
    } else {
      // Mostrar Productos, Ocultar Carrito (Móvil)
      posProductsCol.classList.remove('hidden');
      posProductsCol.classList.add('flex');

      posCartCol.classList.add('hidden');
      posCartCol.classList.remove('flex');

      btnMobileToggleView.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <span>Ver Carrito (${cart.length})</span>
      `;
    }
  }

  if (btnMobileToggleView) {
    btnMobileToggleView.addEventListener('click', () => {
      isMobileCartVisible = !isMobileCartVisible;
      updateMobileToggleUI();
    });
  }

  // NUEVO: configuración de impresión actual cargada desde el backend
  let currentPrintSettings = null;

  // NUEVO: Stock Alerta Sonora (Beep sin archivos)
  function playAlertSound(type = 'stock') {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const playBeep = (freq, duration, vol) => {
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
      };

      if (type === 'expiration') {
        // Doble beep agudo para vencimiento
        playBeep(880, 0.1, 0.1);
        setTimeout(() => playBeep(880, 0.1, 0.1), 150);
      } else {
        // Beep normal para stock
        playBeep(440, 0.3, 0.1);
      }
    } catch (e) {
      console.warn('Web Audio no disponible:', e);
    }
  }

  // --- NUEVO: Helpers de Vencimiento ---
  function isProductExpired(product) {
    console.log('[VENCIMIENTO DEBUG] Producto:', product?.nombre, '| fecha_vencimiento:', product?.fecha_vencimiento, '| tipo:', typeof product?.fecha_vencimiento);
    if (!product || !product.fecha_vencimiento) {
      console.log('[VENCIMIENTO DEBUG] SIN FECHA → no bloqueado');
      return false;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expDate = new Date(product.fecha_vencimiento + 'T00:00:00');
    const expired = expDate < today;
    console.log('[VENCIMIENTO DEBUG] today:', today.toISOString(), '| expDate:', expDate.toISOString(), '| expired:', expired);
    return expired;
  }

  async function blockIfExpired(product) {
    console.log('[VENCIMIENTO DEBUG] blockIfExpired llamado para:', product?.nombre);
    if (isProductExpired(product)) {
      playAlertSound('expiration');
      await showGlobalAlert(`BLOQUEO: El producto "${product.nombre}" está VENCIDO (venció el ${product.fecha_vencimiento}) y no puede ser vendido.`, 'Producto Vencido');
      return true;
    }
    return false;
  }

  // ===== Helpers para líneas de carrito y stock =====

  function generateCartItemId() {
    return 'ci-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
  }

  /**
   * Devuelve cuántas unidades base de un producto están ya "reservadas"
   * en el carrito (unidades sueltas + todas las presentaciones).
   * Puede excluir una línea concreta (para recalcular su propia cantidad).
   */
  function getProductBaseUsage(productId, excludeLineId = null) {
    return cart.reduce((sum, item) => {
      if (item.id !== productId) return sum;
      if (item.tipo_venta === 'PESO') return sum; // peso no se mezcla con presentaciones/unidades
      if (excludeLineId && item.lineId === excludeLineId) return sum;

      const unidadesBase = parseFloat(item.unidadesBase || 1) || 1;
      const qty = parseFloat(item.quantity || 0) || 0;
      return sum + (qty * unidadesBase);
    }, 0);
  }

  function checkCriticalStockAlert(product, addedBaseUnits = 0) {
    if (!product) return;
    const baseStock = parseFloat(product.stock) || 0;
    const minStock = parseFloat(product.stock_minimo) || 5; // Default 5
    
    const usedBase = getProductBaseUsage(product.id);
    const remaining = baseStock - usedBase - addedBaseUnits;

    if (remaining <= minStock) {
        // Alerta Visual
        console.warn(`¡STOCK CRÍTICO! ${product.nombre} - Restante: ${remaining}`);
        
        // Buscar el elemento en el carrito para resaltar
        const cartItemEl = document.querySelector(`[data-line-product-id="${product.id}"]`);
        if (cartItemEl) {
            cartItemEl.classList.add('bg-red-100', 'animate-pulse');
            setTimeout(() => cartItemEl.classList.remove('animate-pulse'), 5000);
        }

        // Sonido
        playAlertSound();
    }
  }

  function saveCartToLocalStorage() {
    const session = JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}');
    const userId = session.id || 'guest';
    const key = `${CART_STORAGE_KEY}_${userId}`;
    if (cart.length > 0) {
      localStorage.setItem(key, JSON.stringify(cart));
    } else {
      localStorage.removeItem(key);
    }
  }

  function loadCartFromLocalStorage() {
    const session = JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}');
    const userId = session.id || 'guest';
    const key = `${CART_STORAGE_KEY}_${userId}`;
    const storedCart = localStorage.getItem(key);
    if (!storedCart) {
      cart = [];
      return;
    }
    try {
      const parsed = JSON.parse(storedCart);
      if (!Array.isArray(parsed)) {
        cart = [];
        return;
      }
      cart = parsed.map(item => {
        const unidadesBase =
          typeof item.unidadesBase === 'number' && item.unidadesBase > 0
            ? item.unidadesBase
            : 1;

        let baseStock;
        if (item.tipo_venta === 'PESO') {
          baseStock =
            typeof item.baseStock === 'number' && item.baseStock > 0
              ? item.baseStock
              : (typeof item.stock === 'number' ? item.stock : 0);
        } else {
          baseStock =
            typeof item.baseStock === 'number' && item.baseStock > 0
              ? item.baseStock
              : Infinity; // si no sabemos, no limitamos
        }

        return {
          ...item,
          lineId: item.lineId || generateCartItemId(),
          presentationId: item.presentationId || null,
          unidadesBase,
          baseStock
        };
      });
    } catch (e) {
      cart = [];
    }
  }

  // NUEVO: helpers para ventas en espera
  function loadHeldSales() {
    try {
      const session = JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}');
      const userId = session.id || 'guest';
      const key = `${HELD_SALES_STORAGE_KEY}_${userId}`;
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Error leyendo ventas en espera de localStorage:', e);
      return [];
    }
  }

  function saveHeldSales(list) {
    try {
      const session = JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}');
      const userId = session.id || 'guest';
      const key = `${HELD_SALES_STORAGE_KEY}_${userId}`;
      localStorage.setItem(key, JSON.stringify(list || []));
    } catch (e) {
      console.error('Error guardando ventas en espera en localStorage:', e);
    }
  }

  // =========================
  // ELEMENTOS DEL DOM (POS.HTML)
  // =========================

  const searchInputPOS = document.getElementById('pos-search-input');
  const searchResultsDiv = document.getElementById('pos-search-results');
  const searchPlaceholder = document.getElementById('search-placeholder');
  const cartItemsDiv = document.getElementById('pos-cart-items');
  const cartEmptyMessage = document.getElementById('cart-empty-message');
  const totalVesSpan = document.getElementById('pos-total-ves');
  const totalUsdSpan = document.getElementById('pos-total-usd');
  const btnCancelarVenta = document.getElementById('btn-cancelar-venta');
  const btnPagar = document.getElementById('btn-pagar');
  const btnPresupuesto = document.getElementById('btn-presupuesto');
  const btnDailyClose = document.getElementById('btn-daily-close');
  const btnPrintSettings = document.getElementById('btn-print-settings');
  const btnReprintLastSale = document.getElementById('btn-reprint-last-sale');

  // Discount elements
  const discountModal = document.getElementById('discount-modal');
  const discountInput = document.getElementById('discount-input');
  const discountCheck = document.getElementById('pos-discount-check');
  const discountPctLabel = document.getElementById('pos-discount-pct-label');
  const discountVesSpan = document.getElementById('pos-discount-ves');
  const discountContainer = document.getElementById('pos-discount-container');
  const btnEditDiscount = document.getElementById('btn-edit-discount');
  const btnCloseDiscountModal = document.getElementById('btn-close-discount-modal');
  const btnCancelDiscount = document.getElementById('btn-cancel-discount');
  const btnSaveDiscount = document.getElementById('btn-save-discount');
  let discountPercent = 0;

  const priceModal = document.getElementById('price-modal');
  const priceModalTitle = document.getElementById('price-modal-title');
  const priceModalInput = document.getElementById('price-modal-input');
  const priceModalStatus = document.getElementById('price-modal-status');
  const formPrice = document.getElementById('form-price');
  const btnCancelarPrecio = document.getElementById('btn-cancelar-precio');
  const priceModalCurrencySelect = document.getElementById('price-modal-moneda');

  const paymentModal = document.getElementById('payment-modal');
  const btnCancelarPago = document.getElementById('btn-cancelar-pago');
  const formPago = document.getElementById('form-pago');
  const modalTotalVesSpan = document.getElementById('modal-total-ves');
  const modalTotalUsdSpan = document.getElementById('modal-total-usd');
  const pagoVesEfectivoInput = document.getElementById('pago-ves-efectivo');
  const pagoUsdEfectivoInput = document.getElementById('pago-usd-efectivo');
  const pagoTarjetaInput = document.getElementById('pago-tarjeta');
  const pagoBiopagoInput = document.getElementById('pago-biopago');
  const pagoPagomovilInput = document.getElementById('pago-pagomovil');
  const pagoZelleInput = document.getElementById('pago-zelle');
  const faltanteContainer = document.getElementById('faltante-container');
  const modalFaltanteVesSpan = document.getElementById('modal-faltante-ves');
  const modalFaltanteUsdSpan = document.getElementById('modal-faltante-usd');
  const vueltoContainer = document.getElementById('vuelto-container');
  const modalVueltoVesSpan = document.getElementById('modal-vuelto-ves');
  const modalVueltoUsdSpan = document.getElementById('modal-vuelto-usd');
  const btnCompletarVenta = document.getElementById('btn-completar-venta');
  const btnGuardarFiado = document.getElementById('btn-guardar-fiado');
  const paymentInputs = document.querySelectorAll('.pago-input');

  const btnPagoTodoVes = document.getElementById('btn-pago-todo-ves');
  const btnPagoTodoUsd = document.getElementById('btn-pago-todo-usd');
  const btnPagoTodoTarjeta = document.getElementById('btn-pago-todo-tarjeta');
  const btnPagoTodoBiopago = document.getElementById('btn-pago-todo-biopago');
  const btnPagoTodoPagomovil = document.getElementById('btn-pago-todo-pagomovil');
  const btnPagoTodoZelle = document.getElementById('btn-pago-todo-zelle');

  const clientSearchInput = document.getElementById('client-search-payment');
  const clientSearchResultsDiv = document.getElementById('client-search-results-payment');
  const selectedClientDiv = document.getElementById('selected-client-payment');
  const selectedClientNameSpan = document.getElementById('selected-client-name');
  const selectedClientBalanceSpan = document.getElementById('selected-client-balance');
  const selectedClientBalanceContainer = document.getElementById('selected-client-balance-container');
  const selectedClientIdInput = document.getElementById('selected-client-id');
  const btnRemoveSelectedClient = document.getElementById('btn-remove-selected-client');
  const btnAddNewClientPOS = document.getElementById('btn-add-new-client-pos');

  const btnManageClientsPOS = document.getElementById('btn-manage-clients-pos');

  const changeModal = document.getElementById('change-modal');
  const changeModalTotalVesSpan = document.getElementById('change-modal-total-ves');
  const changeModalTotalUsdSpan = document.getElementById('change-modal-total-usd');
  const formChange = document.getElementById('form-change');
  const changeUsdEfectivoInput = document.getElementById('change-usd-efectivo');
  const changeVesEfectivoInput = document.getElementById('change-ves-efectivo');
  const changePagomovilInput = document.getElementById('change-pagomovil');
  const changeRemainingContainer = document.getElementById('change-remaining-container');
  const changeModalRemainingVesSpan = document.getElementById('change-modal-remaining-ves');
  const changeStatusP = document.getElementById('change-status');
  const btnConfirmarVuelto = document.getElementById('btn-confirmar-vuelto');
  const changeInputs = document.querySelectorAll('.change-input');

  const btnChangeTodoUsd = document.getElementById('btn-change-todo-usd');
  const btnChangeTodoVes = document.getElementById('btn-change-todo-ves');
  const btnChangeTodoPm = document.getElementById('btn-change-todo-pm');

  const quantityModal = document.getElementById('quantity-modal');
  const formQuantity = document.getElementById('form-quantity');
  const quantityModalTitle = document.getElementById('quantity-modal-title');
  const quantityModalInput = document.getElementById('quantity-modal-input');
  const quantityModalStatus = document.getElementById('quantity-modal-status');
  const btnCancelarCantidad = document.getElementById('btn-cancelar-cantidad');

  const clientModal = document.getElementById('client-modal');
  const clientModalTitle = document.getElementById('client-modal-title');
  const clientForm = document.getElementById('form-client');
  const clientIdInput = document.getElementById('client-id');
  const clientNombreInput = document.getElementById('client-nombre');
  const clientCedulaInput = document.getElementById('client-cedula');
  const clientTelefonoInput = document.getElementById('client-telefono');
  const clientDireccionInput = document.getElementById('client-direccion');
  const btnCancelClient = document.getElementById('btn-cancelar-client');
  const clientModalStatus = document.getElementById('client-modal-status');

  const clientManageModal = document.getElementById('client-manage-modal');
  const btnCloseClientManage = document.getElementById('btn-close-client-manage');
  const btnCancelClientManage = document.getElementById('btn-cancel-client-manage');
  const manageClientSearchInput = document.getElementById('manage-client-search');
  const manageClientResultsList = document.getElementById('manage-client-results');
  const manageClientIdInput = document.getElementById('manage-client-id');
  const manageClientNombreInput = document.getElementById('manage-client-nombre');
  const manageClientCedulaInput = document.getElementById('manage-client-cedula');
  const manageClientTelefonoInput = document.getElementById('manage-client-telefono');
  const manageClientDireccionInput = document.getElementById('manage-client-direccion');
  const clientManageStatus = document.getElementById('client-manage-status');
  const btnDeleteClient = document.getElementById('btn-delete-client');
  const btnUpdateClient = document.getElementById('btn-update-client');
  const clientManageForm = document.getElementById('form-client-manage');

  const cierreZModal = document.getElementById('cierre-z-modal');
  const btnCloseCierreZ = document.getElementById('btn-close-cierre-z');
  const btnCloseCierreZ2 = document.getElementById('btn-close-cierre-z-2');
  const cierreZSummaryBody = document.getElementById('cierre-z-summary-body');
  const cierreZNotas = document.getElementById('cierre-z-notas');
  const cierreZStatus = document.getElementById('cierre-z-status');
  const btnImprimirCierreZ = document.getElementById('btn-imprimir-cierre-z');

  // NUEVO: info visual de apertura de caja dentro del Cierre Z
  const cierreZOpeningResumen = document.getElementById('cierre-z-opening-resumen');

  // NUEVO: elementos del modal de Retiro de efectivo (Cierre Z)
  const btnOpenWithdrawalModal = document.getElementById('btn-open-withdrawal-modal');
  const withdrawalModal = document.getElementById('withdrawal-modal');
  const btnCloseWithdrawalModal = document.getElementById('btn-close-withdrawal-modal');
  const btnCancelWithdrawal = document.getElementById('btn-cancel-withdrawal');
  const withdrawalForm = document.getElementById('form-withdrawal');
  const withdrawalMethod = document.getElementById('withdrawal-method');
  const withdrawalAmount = document.getElementById('withdrawal-amount');
  const withdrawalDescription = document.getElementById('withdrawal-description');
  const withdrawalStatus = document.getElementById('withdrawal-status');

  // 🔹 NUEVO: elementos para APERTURA DE CAJA
  const btnOpenCashOpeningModal = document.getElementById('btn-open-cash-opening-modal');
  const cashOpeningModal = document.getElementById('cash-opening-modal');
  const btnCloseCashOpeningModal = document.getElementById('btn-close-cash-opening-modal');
  const btnCancelCashOpening = document.getElementById('btn-cancel-cash-opening');
  const formCashOpening = document.getElementById('form-cash-opening');
  const cashOpeningVesInput = document.getElementById('cash-opening-ves');
  const cashOpeningUsdInput = document.getElementById('cash-opening-usd');
  const cashOpeningNotesInput = document.getElementById('cash-opening-notes');
  const cashOpeningStatus = document.getElementById('cash-opening-status');

  const printSettingsModal = document.getElementById('print-settings-modal');
  const btnClosePrintSettings = document.getElementById('btn-close-print-settings');
  const btnCancelPrintSettings = document.getElementById('btn-cancel-print-settings');
  const formPrintSettings = document.getElementById('form-print-settings');
  const printSettingsStatus = document.getElementById('print-settings-status');

  const parentDoc = getParentDocument();
  const saleCompleteModal = parentDoc.getElementById('sale-complete-modal');
  const saleCompleteMessage = parentDoc.getElementById('sale-complete-message');
  const btnCloseSaleComplete = parentDoc.getElementById('btn-close-sale-complete');

  // NUEVO: elementos para ventas en espera
  const btnHoldSale = document.getElementById('btn-hold-sale');
  const btnOpenHeldSales = document.getElementById('btn-held-sales');
  const holdSalesModal = document.getElementById('hold-sales-modal');
  const holdSalesList = document.getElementById('hold-sales-list');
  const holdSalesStatus = document.getElementById('hold-sales-status');
  const btnCloseHoldSales = document.getElementById('btn-close-hold-sales');

  // NUEVO: modal para nombre de venta en espera
  const holdSaleClientModal = document.getElementById('hold-sale-client-modal');
  const holdSaleClientNameInput = document.getElementById('hold-sale-client-name');
  const holdSaleClientStatus = document.getElementById('hold-sale-client-status');
  const btnCancelHoldSaleClient = document.getElementById('btn-cancel-hold-sale-client');
  const btnConfirmHoldSaleClient = document.getElementById('btn-confirm-hold-sale-client');

  // REIMPRESIÓN: modal de facturas del día
  const reprintModal = document.getElementById('reprint-modal');
  const btnCloseReprintModal = document.getElementById('btn-close-reprint-modal');
  const reprintSalesList = document.getElementById('reprint-sales-list');
  const reprintSalesStatus = document.getElementById('reprint-sales-status');
  const reprintSearchInput = document.getElementById('reprint-search-input');

  // =========================
  // CARGA DE TASAS
  // =========================

  async function loadRates() {
    try {
      const response = await fetch('/api/settings/rates');
      if (!response.ok) throw new Error('No se pudieron cargar las tasas');
      currentRates = await response.json();
      console.log('Tasas cargadas:', currentRates);

      // Update POS Header Display
      const posBcvValue = document.getElementById('pos-bcv-value');
      if (posBcvValue && currentRates && currentRates.BCV) {
        posBcvValue.textContent = currentRates.BCV.toFixed(2) + ' Bs';
        // Remove hidden class from parent if needed (it usually is visible on md screens)
        const posBcvDisplay = document.getElementById('pos-bcv-display');
        if (posBcvDisplay) posBcvDisplay.classList.remove('hidden');
      }

      if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
        console.error("BCV rate is missing or invalid:", currentRates.BCV);
        await showGlobalAlert(
          "Error crítico: La tasa BCV no está configurada correctamente. No se pueden calcular los precios en USD ni el vuelto."
        );
      }
    } catch (error) {
      console.error('Error cargando tasas:', error);
      await showGlobalAlert('Error al cargar las tasas de cambio. Por favor, recarga la página.');
    }
  }

  // Helper para convertir precios entre VES y USD_BCV
  function convertPrice(value, fromCurrency, toCurrency) {
    const num = parseFloat(value);
    if (isNaN(num)) return 0;

    if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
      // Si no hay tasa válida, no intentamos convertir
      return num;
    }

    if (fromCurrency === toCurrency) return num;

    if (fromCurrency === 'VES' && toCurrency === 'USD_BCV') {
      return num / currentRates.BCV;
    }

    if (fromCurrency === 'USD_BCV' && toCurrency === 'VES') {
      return num * currentRates.BCV;
    }

    return num;
  }

  // =========================
  // BÚSQUEDA Y LISTADO DE PRODUCTOS
  // =========================

  async function loadProducts(searchTerm = '') {
    // Preserve placeholder
    const placeholder = document.getElementById('search-placeholder');
    searchResultsDiv.innerHTML = '';
    if (placeholder) searchResultsDiv.appendChild(placeholder);

    if (searchTerm.trim()) {
      searchPlaceholder.textContent = 'Buscando...';
      searchPlaceholder.classList.remove('hidden');
    } else {
      currentSearchResults = [];
      renderSearchResults();
      return;
    }
    try {
      const limitSearch = 50;
      const params = new URLSearchParams();
      params.append('search', searchTerm);
      params.append('limit', limitSearch);
      params.append('page', 1);
      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) throw new Error('No se pudieron cargar los productos');
      const data = await response.json();
      currentSearchResults = data.products;
      renderSearchResults();
    } catch (error) {
      console.error('Error cargando productos:', error);
      searchPlaceholder.textContent = 'Error al cargar productos.';
      searchPlaceholder.classList.remove('hidden');
      currentSearchResults = [];
    }
  }

  // NUEVO: productos + presentaciones
  function renderSearchResults() {
    // Control de visibilidad para móvil (overlay)
    const hasQuery = searchInputPOS.value.trim().length > 0;
    const hasResults = currentSearchResults.length > 0;

    if (hasQuery || hasResults) {
      searchResultsDiv.classList.remove('hidden');
    } else {
      searchResultsDiv.classList.add('hidden');
    }

    const placeholder = document.getElementById('search-placeholder');
    searchResultsDiv.innerHTML = '';
    if (placeholder) searchResultsDiv.appendChild(placeholder);

    searchPlaceholder.classList.add('hidden');

    if (currentSearchResults.length === 0) {
      if (searchInputPOS.value.trim()) {
        searchPlaceholder.textContent = 'No se encontraron productos.';
      } else {
        searchPlaceholder.textContent = 'Escribe para buscar productos...';
      }
      searchPlaceholder.classList.remove('hidden');
      return;
    }

    currentSearchResults.forEach(product => {
      // MODIFICACIÓN: Ya no filtramos por stock <= 0 para que sean visibles
      if (!product) return;

      const isOutOfStock = product.stock <= 0;
      const unitSuffix = product.tipo_venta === 'PESO' ? '/Kg' : (product.tipo_venta === 'LITRO' ? '/Lt' : '');
      const stockUnit = product.tipo_venta === 'PESO' ? 'Kg' : (product.tipo_venta === 'LITRO' ? 'Lt' : 'Unid');

      // === PRODUCTO BASE ===
      const button = document.createElement('button');
      button.className =
        `w-full text-left p-3 rounded hover:bg-blue-100 focus:outline-none focus:bg-blue-100 dark:hover:bg-slate-700 dark:focus:bg-slate-700 flex justify-between items-center border-b dark:border-slate-700 last:border-b-0 ${isOutOfStock ? 'opacity-60 bg-gray-50 dark:bg-slate-800/50' : ''}`;
      button.dataset.productId = product.id;

      const pvpVes = parseFloat(product.precio_final_ves || 0).toFixed(2);
      const pvpUsd = parseFloat(product.precio_final_usd_bcv || 0).toFixed(2);

      // Check expiration for highlighting
      let isExpired = false;
      if (product.fecha_vencimiento) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const expDate = new Date(product.fecha_vencimiento + 'T00:00:00');
        if (expDate < today) isExpired = true;
      }

      const imgHtml = product.imagen 
        ? `<img src="${product.imagen}" alt="${product.nombre}" class="w-20 h-20 object-cover rounded-md mr-3 flex-shrink-0 border border-gray-200">`
        : `<div class="w-20 h-20 flex items-center justify-center bg-gray-100 rounded-md mr-3 flex-shrink-0 border border-gray-200 text-gray-400"><svg class="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg></div>`;

      button.innerHTML = `
        <div class="flex items-center">
          ${imgHtml}
          <div>
            <span class="font-medium ${isOutOfStock || isExpired ? 'text-gray-500' : 'text-gray-800'} block">${product.nombre}</span>
            <span class="text-xs ${isOutOfStock || isExpired ? 'text-red-500' : 'text-green-600'} block mt-0.5">
              ${isExpired ? 'VENCIDO' : (isOutOfStock ? 'Sin Stock' : 'Stock: ' + product.stock + ' ' + stockUnit)}
            </span>
          </div>
        </div>
        <div class="text-right flex-shrink-0">
            <span class="text-lg ${isOutOfStock || isExpired ? 'text-gray-500' : 'text-gray-800'} font-bold">
              ${pvpVes} Bs ${unitSuffix}
            </span>
            <br>
            <span class="text-base text-gray-500 font-bold">
              (${pvpUsd} $ ${unitSuffix})
            </span>
        </div>
      `;
      button.addEventListener('click', () => handleProductClick(product.id));
      searchResultsDiv.appendChild(button);

      // === PRESENTACIONES OPCIONALES ===
      const presList = Array.isArray(product.presentations)
        ? product.presentations
        : (Array.isArray(product.presentaciones) ? product.presentaciones : []);

      if (!presList || presList.length === 0) return;

      presList.forEach(pres => {
        if (!pres) return;

        const unitsPerPres = parseFloat(pres.unidades_base || pres.unidadesBase || 0);
        const baseStock = parseFloat(product.stock || 0);
        if (isNaN(unitsPerPres) || unitsPerPres <= 0) return;

        const maxByStock = baseStock > 0 ? Math.floor(baseStock / unitsPerPres) : 0;
        const presOutOfStock = maxByStock <= 0;

        const pButton = document.createElement('button');
        pButton.className =
          `w-full text-left pl-5 pr-3 py-2 rounded hover:bg-indigo-50 focus:outline-none focus:bg-indigo-50 dark:hover:bg-slate-700 dark:focus:bg-slate-700 flex justify-between items-center border-b dark:border-slate-700 last:border-b-0 text-sm ${presOutOfStock || isExpired ? 'opacity-60 bg-gray-50 dark:bg-slate-800/50' : ''}`;
        pButton.dataset.productId = product.id;
        pButton.dataset.presentationId = pres.id;

        const presPriceVes = parseFloat(pres.precio_ves || pres.precio_final_ves || 0).toFixed(2);
        const presPriceUsd = parseFloat(pres.precio_usd_bcv || pres.precio_final_usd_bcv || 0).toFixed(2);

        const imgHtml = product.imagen 
          ? `<img src="${product.imagen}" alt="${product.nombre}" class="w-16 h-16 object-cover rounded-md mr-3 flex-shrink-0 border border-gray-200">`
          : `<div class="w-16 h-16 flex items-center justify-center bg-gray-100 rounded-md mr-3 flex-shrink-0 border border-gray-200 text-gray-400"><svg class="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg></div>`;

        pButton.innerHTML = `
          <div class="flex items-center">
            ${imgHtml}
            <div>
              <span class="font-medium ${presOutOfStock || isExpired ? 'text-gray-500' : 'text-gray-700'}">${product.nombre}</span>
              <span class="text-xs text-gray-500 ml-1">- ${pres.nombre || 'Presentación'}</span>
              <span class="text-[11px] ${presOutOfStock || isExpired ? 'text-red-500' : 'text-green-600'} block mt-0.5">
                ${isExpired ? 'VENCIDO' : (presOutOfStock ? 'Sin Stock' : 'Stock aprox: ' + maxByStock + ' ' + (pres.nombre || ''))}
              </span>
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <span class="text-base ${presOutOfStock || isExpired ? 'text-gray-500' : 'text-gray-800'} font-bold">
              ${presPriceVes} Bs
            </span>
            <br>
            <span class="text-sm text-gray-500 font-bold">
              (${presPriceUsd} $)
            </span>
          </div>
        `;
        pButton.addEventListener('click', () =>
          handleProductClick(product.id, pres.id)
        );
        searchResultsDiv.appendChild(pButton);
      });
    });
  }

  function handlePosSearchInput(event) {
    clearTimeout(searchTimeoutPOS);
    const searchTerm = event.target.value;

    clearTimeout(barcodeScanTimeout);
    barcodeBuffer = searchTerm;

    barcodeScanTimeout = setTimeout(() => {
      if (barcodeBuffer.length > 2 && barcodeBuffer.endsWith('\n')) {
        const scannedBarcode = barcodeBuffer.trim();
        console.log('Barcode scan detected:', scannedBarcode);
        searchInputPOS.value = scannedBarcode;
        handleBarcodeScan(scannedBarcode);
        barcodeBuffer = '';
      }
    }, 100);

    searchTimeoutPOS = setTimeout(() => {
      if (barcodeBuffer.endsWith('\n')) return;
      console.log('Manual search:', searchTerm);
      loadProducts(searchTerm);
    }, 300);
  }

  function handlePosSearchKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(searchTimeoutPOS);
      clearTimeout(barcodeScanTimeout);

      const searchTerm = searchInputPOS.value.trim();
      console.log('Search triggered by Enter/Scan:', searchTerm);

      const isNumeric = /^\d+$/.test(searchTerm);

      if (searchTerm.length > 2 && isNumeric) {
        handleBarcodeScan(searchTerm);
      } else {
        loadProducts(searchTerm);
      }

      barcodeBuffer = '';
    }
  }

  // NUEVO: primero intenta código de barras de presentación, luego producto
  async function handleBarcodeScan(barcode) {
    try {
      let handled = false;

      // 1) Intentar como presentación
      try {
        const presResponse = await fetch(`/api/presentations/barcode/${encodeURIComponent(barcode)}`);
        if (presResponse.ok) {
          const data = await presResponse.json();
          const product = data.product || data.producto;
          const presentation = data.presentation || data.presentacion || data.presentationData;
          if (product && presentation) {
            if (await blockIfExpired(product)) return;
            await addPresentationToCart(product, presentation);
            handled = true;
          }
        }
      } catch (innerError) {
        console.warn('No se pudo resolver el código como presentación:', innerError);
      }

      if (handled) return;

      // 2) Producto normal
      const response = await fetch(`/api/products/barcode/${encodeURIComponent(barcode)}`);
      const product = await response.json();

      if (!response.ok) {
        throw new Error(product.error || 'Producto no encontrado');
      }

      currentSearchResults = [product];
      handleProductClick(product.id);

    } catch (error) {
      console.error('Error en escaneo de barcode:', error);
      searchPlaceholder.textContent = `Error: ${error.message}`;
      searchPlaceholder.classList.remove('hidden');
      searchResultsDiv.innerHTML = '';
    }
  }

  // =========================
  // CARRITO
  // =========================

  // NUEVO: ahora soporta producto base o presentación
  async function handleProductClick(productId, presentationId = null) {
    const product = currentSearchResults.find(p => p.id === productId);
    if (!product) return;

    // --- BLOQUEO POR VENCIMIENTO ---
    if (await blockIfExpired(product)) return;

    // Si viene una presentación, la manejamos como tal
    if (presentationId) {
      const list = Array.isArray(product.presentations)
        ? product.presentations
        : (Array.isArray(product.presentaciones) ? product.presentaciones : []);
      const pres = list.find(pr => pr.id === presentationId);
      if (!pres) return;
      await addPresentationToCart(product, pres);
      return;
    }

    // Producto normal
    if (product.tipo_venta === 'PESO' || product.tipo_venta === 'LITRO') {
      openQuantityModal(product);
    } else {
      await addUnitProductToCart(product);
    }
  }

  // UNIDAD (sin presentación) PERMITIENDO mezclar con presentaciones
  async function addUnitProductToCart(product) {
    if (await blockIfExpired(product)) return;
    const baseStock = Number(product.stock) || 0;
    if (baseStock <= 0) {
      await showGlobalAlert(`No hay stock disponible para ${product.nombre}.`);
      return;
    }

    const usedBase = getProductBaseUsage(product.id);
    const remainingBase = baseStock - usedBase;

    if (remainingBase < 1) {
      await showGlobalAlert(`No hay más stock disponible para ${product.nombre}.`);
      return;
    }

    const cartItem = cart.find(
      item => item.id === product.id && !item.presentationId && item.tipo_venta === 'UNIDAD'
    );

    if (cartItem) {
      cartItem.quantity += 1;
    } else {
      cart.push({
        lineId: generateCartItemId(),
        id: product.id,
        name: product.nombre,
        imagen: product.imagen,
        quantity: 1, // unidades sueltas
        priceVes: product.precio_final_ves,
        priceUsd: product.precio_final_usd_bcv,
        stock: baseStock,        // referencia
        baseStock: baseStock,    // stock en unidades base
        tipo_venta: 'UNIDAD',
        presentationId: null,
        unidadesBase: 1,          // 1 unidad por venta
        exento_iva: product.exento_iva,
        stock_minimo: product.stock_minimo || 0
      });
    }

    // Verificar alerta de stock
    checkCriticalStockAlert(product);

    renderCart();
    resetSearch();
  }

  // NUEVO: añadir presentación (bulto, pack, etc.) PERMITIENDO mezclar
  async function addPresentationToCart(product, presentation) {
    if (await blockIfExpired(product)) return;
    const unitsPerPres = parseFloat(
      presentation.unidades_base || presentation.unidadesBase || 0
    );
    if (isNaN(unitsPerPres) || unitsPerPres <= 0) {
      await showGlobalAlert('La presentación seleccionada no tiene unidades base válidas.');
      return;
    }

    const baseStock = Number(product.stock) || 0;
    if (isNaN(baseStock) || baseStock <= 0) {
      await showGlobalAlert(`No hay stock disponible para ${product.nombre}.`);
      return;
    }

    const cartItem = cart.find(
      item => item.id === product.id && item.presentationId === presentation.id
    );

    const usedBaseExcludingThis = getProductBaseUsage(
      product.id,
      cartItem ? cartItem.lineId : null
    );
    const remainingBaseForThisLine = baseStock - usedBaseExcludingThis;
    const maxQuantityByStock = Math.floor(remainingBaseForThisLine / unitsPerPres);

    if (maxQuantityByStock <= 0) {
      await showGlobalAlert(
        `No hay stock suficiente para vender la presentación seleccionada de ${product.nombre}.`
      );
      return;
    }

    if (cartItem) {
      if (cartItem.quantity + 1 > maxQuantityByStock) {
        await showGlobalAlert(
          `No hay más stock disponible para ${product.nombre} - ${presentation.nombre || 'Presentación'}.`
        );
        return;
      }
      cartItem.quantity += 1;
      cartItem.stock = maxQuantityByStock;
    } else {
      const priceVes = parseFloat(
        presentation.precio_ves || presentation.precio_final_ves || 0
      );
      const priceUsd = parseFloat(
        presentation.precio_usd_bcv || presentation.precio_final_usd_bcv || 0
      );

      cart.push({
        lineId: generateCartItemId(),
        id: product.id,
        name: `${product.nombre} - ${presentation.nombre || 'Presentación'}`,
        imagen: product.imagen,
        quantity: 1,                     // cantidad de presentaciones
        priceVes: priceVes,              // precio POR PRESENTACIÓN en Bs
        priceUsd: priceUsd,              // precio POR PRESENTACIÓN en $
        stock: maxQuantityByStock,       // stock en número de presentaciones
        baseStock: baseStock,            // stock en unidades base
        tipo_venta: 'UNIDAD',
        presentationId: presentation.id, // distingue esta presentación
        presentationId: presentation.id, // distingue esta presentación
        unidadesBase: unitsPerPres,       // cuántas unidades base descuenta 1 presentación
        exento_iva: product.exento_iva,
        stock_minimo: product.stock_minimo || 0
      });
    }

    renderCart();
    resetSearch();
  }

  async function addWeightedProductToCart(product, quantity) {
    if (await blockIfExpired(product)) return;
    const cartItem = cart.find(item => item.id === product.id && item.tipo_venta === 'PESO');
    let newQuantity = quantity;

    if (cartItem) {
      newQuantity = cartItem.quantity + quantity;
    }

    if (newQuantity > product.stock) {
      await showGlobalAlert(`Stock insuficiente. Solo quedan ${product.stock} Kg de ${product.nombre}. Añadiendo stock máximo al carrito.`);
      newQuantity = product.stock;
    }

    if (cartItem) {
      cartItem.quantity = newQuantity;
    } else {
      cart.push({
        lineId: generateCartItemId(),
        id: product.id,
        name: product.nombre,
        imagen: product.imagen,
        quantity: newQuantity,
        priceVes: product.precio_final_ves,
        priceUsd: product.precio_final_usd_bcv,
        stock: product.stock,
        baseStock: Number(product.stock) || 0,
        tipo_venta: 'PESO',
        presentationId: null,
        presentationId: null,
        unidadesBase: 1,
        exento_iva: product.exento_iva,
        stock_minimo: product.stock_minimo || 0
      });
    }

    renderCart();
    resetSearch();
  }

  function resetSearch() {
    searchInputPOS.value = '';
    currentSearchResults = [];
    renderSearchResults();
    searchInputPOS.focus();
  }

  async function updateCartItemQuantity(lineId, newQuantityStr) {
    const cartItem = cart.find(item => item.lineId === lineId);
    if (!cartItem) return;

    const quantity = parseFloat(newQuantityStr);
    const isPeso = cartItem.tipo_venta === 'PESO';

    if (isNaN(quantity) || quantity <= 0) {
      removeProductFromCart(lineId);
      return;
    }

    if (!isPeso && quantity % 1 !== 0) {
      await showGlobalAlert("No se permiten decimales para productos vendidos por unidad.");
      cartItem.quantity = Math.floor(quantity);
      renderCart();
      return;
    }

    if (isPeso) {
      if (quantity > cartItem.stock) {
        cartItem.quantity = cartItem.stock;
        await showGlobalAlert(
          `Stock máximo para ${cartItem.name} es ${cartItem.stock} Kg.`
        );
      } else {
        cartItem.quantity = quantity;
      }
      renderCart();
      return;
    }

    const baseStock =
      typeof cartItem.baseStock === 'number'
        ? cartItem.baseStock
        : (Number(cartItem.stock) || Infinity);

    const unidadesBase = parseFloat(cartItem.unidadesBase || 1) || 1;
    const usedBaseOtherLines = getProductBaseUsage(cartItem.id, cartItem.lineId);
    const availableBase = baseStock === Infinity ? Infinity : (baseStock - usedBaseOtherLines);
    const maxQuantity =
      baseStock === Infinity
        ? quantity
        : Math.floor(availableBase / unidadesBase);

    let finalQuantity = quantity;

    if (baseStock !== Infinity && quantity * unidadesBase > availableBase) {
      if (maxQuantity <= 0) {
        await showGlobalAlert(`No hay stock suficiente para ${cartItem.name}.`);
        removeProductFromCart(lineId);
        return;
      }
      finalQuantity = maxQuantity;
      await showGlobalAlert(
        `Stock máximo para ${cartItem.name} es ${finalQuantity}.`
      );
    }

    cartItem.quantity = finalQuantity;
    
    // Verificar alerta de stock
    const productForAlert = { id: cartItem.id, nombre: cartItem.name, stock: cartItem.baseStock, stock_minimo: cartItem.stock_minimo };
    checkCriticalStockAlert(productForAlert);

    renderCart();
  }

  function removeProductFromCart(lineId) {
    cart = cart.filter(item => item.lineId !== lineId);
    renderCart();
  }

  async function handleEditPrice(lineId) {
    const ctx = window.parent || window;
    let hasPermission = true;

    if (typeof ctx.askForAdminPassword === 'function') {
      hasPermission = await ctx.askForAdminPassword();
    }

    if (!hasPermission) return;

    const cartItem = cart.find(item => item.lineId === lineId);
    if (!cartItem) return;

    openPriceModal(cartItem);
  }

  // =========================
  // MODAL PVP (Editar Precio)
  // =========================

  function openPriceModal(cartItem) {
    currentPriceEditItem = cartItem;

    priceModalTitle.textContent = `Editar PVP - ${cartItem.name}`;

    const isPeso = cartItem.tipo_venta === 'PESO';
    const quantity = parseFloat(cartItem.quantity || 1);
    const unitPriceVes = parseFloat(cartItem.priceVes || 0);
    let initialValueVes = 0;

    if (isPeso) {
      // Para productos por peso, mostramos el total de la línea (cantidad × precio unitario)
      const safeQuantity = quantity > 0 ? quantity : 1;
      initialValueVes = unitPriceVes * safeQuantity;
    } else {
      // Para productos por unidad o presentación, el precio es por unidad de venta (unidad o pack)
      initialValueVes = unitPriceVes;
    }

    priceModalCurrentCurrency = 'VES';
    if (priceModalCurrencySelect) {
      priceModalCurrencySelect.value = 'VES';
    }

    priceModalInput.value = initialValueVes > 0 ? initialValueVes.toFixed(2) : '';
    priceModalStatus.textContent = '';
    priceModalStatus.className = 'text-sm mt-2 text-center text-gray-600';

    priceModal.classList.remove('hidden');
    priceModalInput.focus();
    priceModalInput.select();
  }

  function closePriceModal() {
    priceModal.classList.add('hidden');
    currentPriceEditItem = null;
    priceModalInput.value = '';
    priceModalStatus.textContent = '';
  }

  function setPriceModalMessage(msg, type = 'info') {
    if (!priceModalStatus) return;
    priceModalStatus.textContent = msg;
    if (type === 'success') {
      priceModalStatus.className = 'text-sm mt-2 text-center text-green-600';
    } else if (type === 'error') {
      priceModalStatus.className = 'text-sm mt-2 text-center text-red-600';
    } else {
      priceModalStatus.className = 'text-sm mt-2 text-center text-gray-600';
    }
  }

  function handlePriceModalSubmit(e) {
    e.preventDefault();
    if (!currentPriceEditItem) {
      closePriceModal();
      return;
    }

    const rawValue = parseFloat(priceModalInput.value);
    if (isNaN(rawValue) || rawValue <= 0) {
      setPriceModalMessage('Por favor ingresa un precio válido mayor a 0.', 'error');
      return;
    }

    const selectedCurrency = priceModalCurrencySelect
      ? priceModalCurrencySelect.value
      : 'VES';

    const isPeso = currentPriceEditItem.tipo_venta === 'PESO';
    let valueInVes;

    if (selectedCurrency === 'USD_BCV') {
      if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
        setPriceModalMessage('No hay tasa BCV válida para convertir desde USD.', 'error');
        return;
      }
      valueInVes = rawValue * currentRates.BCV;
    } else {
      valueInVes = rawValue;
    }

    const bcv = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 0;

    if (isPeso) {
      // El usuario está editando el TOTAL de la línea (para X Kg)
      const quantity = parseFloat(currentPriceEditItem.quantity || 1);
      const safeQuantity = quantity > 0 ? quantity : 1;
      const newUnitPriceVes = valueInVes / safeQuantity;

      currentPriceEditItem.priceVes = newUnitPriceVes;
      currentPriceEditItem.priceUsd = bcv > 0 ? (newUnitPriceVes / bcv) : 0;
    } else {
      // UNIDAD o PRESENTACIÓN: el usuario edita el precio por unidad de venta
      currentPriceEditItem.priceVes = valueInVes;
      currentPriceEditItem.priceUsd = bcv > 0 ? (valueInVes / bcv) : 0;
    }

    setPriceModalMessage('Precio actualizado.', 'success');

    renderCart();

    setTimeout(() => {
      closePriceModal();
    }, 300);
  }

  // =========================
  // CÁLCULO TOTALES CARRITO
  // =========================

  function calculateCartTotals(items = cart) {
    let rawSum = 0;
    let totalTaxVes = 0;

    const ivaMode = (currentRates && currentRates.IVA_MODE === 'EXCLUDED') ? 'EXCLUDED' : 'INCLUDED';
    const ivaPercentage = (currentRates && currentRates.IVA_PERCENTAGE !== undefined) ? parseFloat(currentRates.IVA_PERCENTAGE) : 16.0;
    const ivaRate = ivaPercentage / 100;

    items.forEach(item => {
      const qty = parseFloat(item.quantity || 0);
      const price = parseFloat(item.priceVes || 0);
      const lineTotal = qty * price;
      rawSum += lineTotal;

      // Check exemption
      const isExempt = (item.exento_iva === 1 || item.exento_iva === true || item.exento_iva === '1');

      if (!isExempt) {
        if (ivaMode === 'EXCLUDED') {
          totalTaxVes += lineTotal * ivaRate;
        } else {
          const base = lineTotal / (1 + ivaRate);
          totalTaxVes += (lineTotal - base);
        }
      }
    });

    let totalVes = 0;
    let netSubtotalVes = 0;

    if (ivaMode === 'EXCLUDED') {
      totalVes = rawSum + totalTaxVes;
      netSubtotalVes = rawSum;
    } else {
      totalVes = rawSum;
      netSubtotalVes = rawSum - totalTaxVes;
    }

    return {
      netSubtotalVes,
      totalTaxVes,
      totalVes
    };
  }

  function calculateCartTotalVes() {
    let total = calculateCartTotals(cart).totalVes;
    if (discountPercent > 0) {
      total -= total * (discountPercent / 100);
    }
    return total;
  }

  function calculateCartTotalFromItems(items) {
    if (!Array.isArray(items)) return 0;
    return calculateCartTotals(items).totalVes;
  }

  function calculateCartTotalUsd(rateType) {
    const selectedType = rateType ||
      document.querySelector('input[name="tasa-index-tipo"]:checked')?.value || 'BCV';
    const rate = (currentRates && currentRates[selectedType] > 0)
      ? currentRates[selectedType]
      : ((currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1);
    const totalVes = calculateCartTotalVes();
    return totalVes / rate;
  }

  function renderCart() {
    cartItemsDiv.innerHTML = '';
    let totalVes = 0;
    let totalUsd = 0;

    if (cart.length === 0) {
      cartEmptyMessage.classList.remove('hidden');
      btnCancelarVenta.disabled = true;
      btnPagar.disabled = true;
      if (btnPresupuesto) btnPresupuesto.disabled = true;
      if (btnHoldSale) btnHoldSale.disabled = true;
    } else {
      cartEmptyMessage.classList.add('hidden');
      btnCancelarVenta.disabled = false;
      btnPagar.disabled = false;
      if (btnPresupuesto) btnPresupuesto.disabled = false;
      if (btnHoldSale) btnHoldSale.disabled = false;

      cart.forEach(item => {
        const itemTotalVes = item.quantity * parseFloat(item.priceVes || 0);
        const itemTotalUsd = item.quantity * parseFloat(item.priceUsd || 0);
        totalVes += itemTotalVes;
        totalUsd += itemTotalUsd;

        const isPeso = item.tipo_venta === 'PESO';
        const isLitro = item.tipo_venta === 'LITRO';
        const isDecimal = isPeso || isLitro;

        const step = isDecimal ? '0.01' : '1';
        const min = isDecimal ? '0.01' : '1';
        const qtyDisplay = isDecimal ? Number(item.quantity).toFixed(3) : item.quantity;
        const maxAttr = isDecimal ? `max="${item.stock}"` : '';

        let unitLabel = '';
        if (isDecimal) {
          const suffix = isPeso ? 'Kg' : (isLitro ? 'Lt' : '');
          unitLabel = ` (${qtyDisplay} ${suffix})`;
        }

        const imgHtml = item.imagen 
          ? `<img src="${item.imagen}" alt="${item.name}" class="w-16 h-16 object-cover rounded flex-shrink-0 border border-gray-200">`
          : `<div class="w-16 h-16 flex items-center justify-center bg-gray-100 rounded flex-shrink-0 border border-gray-200 text-gray-400"><svg class="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg></div>`;

        const div = document.createElement('div');
        div.className = "flex items-center space-x-2 border-b pb-2";
        div.dataset.lineProductId = item.id;
        div.innerHTML = `
        ${imgHtml}
        <span class="flex-1 font-medium text-gray-700 text-sm leading-tight">
          ${item.name} <span class="text-gray-500 block text-xs font-normal">${unitLabel}</span>
        </span>
        <input type="number"
               value="${item.quantity}"
               min="${min}"
               ${maxAttr}
               step="${step}"
               class="w-16 text-center border rounded quantity-input"
               data-line-id="${item.lineId}">
        <span class="w-24 text-right leading-tight">
            <span class="block font-bold text-sm text-gray-800">${itemTotalVes.toFixed(2)} Bs</span>
            <span class="block text-gray-500 text-xs font-bold">(${itemTotalUsd.toFixed(2)} $)</span>
          </span>
          <button class="text-xs text-blue-600 hover:underline edit-price-btn"
                  data-line-id="${item.lineId}">
            PVP
          </button>
          <button class="text-red-500 hover:text-red-700 remove-item-btn p-1 ml-1"
                  data-line-id="${item.lineId}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        `;
        cartItemsDiv.appendChild(div);
      });
    }

    // Start of replacement
    // Overwrite totals with robust calculation
    const totals = calculateCartTotals(cart);
    totalVes = totals.totalVes;

    // Apply discount
    let discountVes = 0;
    if (discountPercent > 0) {
      discountVes = totalVes * (discountPercent / 100);
      totalVes -= discountVes;
    }

    // Recalculate USD based on final VES total
    const bcvRate = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
    totalUsd = totalVes / bcvRate;

    totalVesSpan.textContent = `${totalVes.toFixed(2)} Bs`;
    totalUsdSpan.textContent = `${totalUsd.toFixed(2)} $`;

    // Discount display
    if (cart.length > 0) {
      discountContainer.classList.remove('hidden');
      discountPctLabel.textContent = discountPercent;
      discountVesSpan.textContent = `-${discountVes.toFixed(2)} Bs`;
      discountCheck.checked = discountPercent > 0;
    } else {
      discountContainer.classList.add('hidden');
    }

    if (mobileTotalDisplay) {
      mobileTotalDisplay.textContent = `${totalUsd.toFixed(2)} $`;
    }

    // Update Subtotal/Tax visibility
    const subtotalContainer = document.getElementById('pos-subtotal-container');
    const subtotalVesSpan = document.getElementById('pos-subtotal-ves');
    const taxContainer = document.getElementById('pos-tax-container');
    const taxVesSpan = document.getElementById('pos-tax-ves');

    if (subtotalContainer && taxContainer && subtotalVesSpan && taxVesSpan) {
      if (totals.totalTaxVes > 0 && Math.abs(totals.totalTaxVes) > 0.001) {
        subtotalContainer.classList.remove('hidden');
        taxContainer.classList.remove('hidden');
        subtotalVesSpan.textContent = `${totals.netSubtotalVes.toFixed(2)} Bs`;
        taxVesSpan.textContent = `${totals.totalTaxVes.toFixed(2)} Bs`;
      } else {
        subtotalContainer.classList.add('hidden');
        taxContainer.classList.add('hidden');
      }
    }

    if (typeof updateMobileToggleUI === 'function') {
      updateMobileToggleUI();
    }

    addCartEventListeners();
  }

  function addCartEventListeners() {
    cartItemsDiv.querySelectorAll('.quantity-input').forEach(input => {
      let qtyTimeout;
      input.addEventListener('input', (e) => {
        clearTimeout(qtyTimeout);
        qtyTimeout = setTimeout(() => {
          const lineId = e.target.dataset.lineId;
          updateCartItemQuantity(lineId, e.target.value);
        }, 350);
      });
      input.addEventListener('keypress', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    });

    cartItemsDiv.querySelectorAll('.remove-item-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const lineId = e.currentTarget.dataset.lineId;
        removeProductFromCart(lineId);
      });
    });

    cartItemsDiv.querySelectorAll('.edit-price-btn').forEach(button => {
      button.addEventListener('click', (e) => {
        const lineId = e.currentTarget.dataset.lineId;
        handleEditPrice(lineId);
      });
    });
  }

  async function cancelSale() {
    if (cart.length === 0) return;
    const confirmed = await showGlobalConfirm(
      '¿Estás seguro de que deseas cancelar esta venta y vaciar el carrito?',
      'Cancelar Venta'
    );
    if (!confirmed) return;

    cart = [];
    discountPercent = 0;
    renderCart();
    searchInputPOS.value = '';
    currentSearchResults = [];
    renderSearchResults();
  }

  // =========================
  // VENTAS EN ESPERA
  // =========================

  // Nuevo flujo: primero se arma la venta pendiente y se abre el modal
  async function putSaleOnHold() {
    if (cart.length === 0) {
      await showGlobalAlert('No hay productos en el carrito para poner en espera.');
      return;
    }

    const totalVes = calculateCartTotalVes();
    const clienteId = selectedClientIdInput.value || null;
    const clienteNombreActual = selectedClientNameSpan.textContent || '';

    // Guardamos la venta pendiente
    pendingHoldSale = {
      id: Date.now(),
      createdAt: new Date().toLocaleString('es-VE'),
      cart: cart.map(item => ({ ...item })),
      client: clienteId ? { id: parseInt(clienteId, 10), nombre: clienteNombreActual } : null,
      totalVes,
      discountPercent: discountPercent || 0
    };

    // Si existe el modal de nombre, lo mostramos
    if (holdSaleClientModal && holdSaleClientNameInput) {
      const prefill = clienteNombreActual || '';
      holdSaleClientNameInput.value = prefill;
      if (holdSaleClientStatus) {
        holdSaleClientStatus.textContent = '';
        holdSaleClientStatus.className = 'text-sm mt-2 text-center text-gray-500';
      }
      holdSaleClientModal.classList.remove('hidden');
      holdSaleClientNameInput.focus();
    } else {
      // Fallback: si por alguna razón no existe el modal, se guarda directo como antes
      const heldSales = loadHeldSales();
      heldSales.push(pendingHoldSale);
      saveHeldSales(heldSales);

      await showGlobalAlert(
        'Venta puesta en espera. Puedes reanudarla desde "En Espera".',
        'Venta en espera'
      );

      pendingHoldSale = null;
      resetPOSState(false);
      resetClientSearch();
    }
  }

  function closeHoldSaleClientModal() {
    if (holdSaleClientModal) {
      holdSaleClientModal.classList.add('hidden');
    }
    if (holdSaleClientStatus) {
      holdSaleClientStatus.textContent = '';
      holdSaleClientStatus.className = 'text-sm mt-2 text-center text-gray-500';
    }
  }

  async function handleConfirmHoldSaleClient() {
    if (!pendingHoldSale) {
      closeHoldSaleClientModal();
      return;
    }

    let refName = '';
    if (holdSaleClientNameInput) {
      refName = holdSaleClientNameInput.value.trim();
    }

    if (!refName) {
      if (pendingHoldSale.client && pendingHoldSale.client.nombre) {
        refName = pendingHoldSale.client.nombre;
      } else {
        refName = 'Sin nombre';
      }
    }

    // Garantizamos que el objeto client exista y tenga nombre
    if (!pendingHoldSale.client) {
      pendingHoldSale.client = { id: null, nombre: refName };
    } else {
      pendingHoldSale.client.nombre = refName;
    }

    const heldSales = loadHeldSales();
    heldSales.push(pendingHoldSale);
    saveHeldSales(heldSales);

    pendingHoldSale = null;

    closeHoldSaleClientModal();

    await showGlobalAlert(
      'Venta puesta en espera. Puedes reanudarla desde "En Espera".',
      'Venta en espera'
    );

    resetPOSState(false);
    resetClientSearch();
  }

  function handleCancelHoldSaleClient() {
    pendingHoldSale = null;
    closeHoldSaleClientModal();
  }

  function openHeldSalesModal() {
    if (!holdSalesModal) return;
    const heldSales = loadHeldSales();
    renderHeldSalesList(heldSales);
    holdSalesStatus.textContent = heldSales.length === 0 ? 'No hay ventas en espera.' : '';
    holdSalesModal.classList.remove('hidden');
  }

  function closeHeldSalesModal() {
    if (!holdSalesModal) return;
    holdSalesModal.classList.add('hidden');
  }

  function renderHeldSalesList(heldSales) {
    if (!holdSalesList) return;
    holdSalesList.innerHTML = '';

    if (!heldSales || heldSales.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="4" class="px-4 py-3 text-center text-gray-500 text-sm">
          No hay ventas en espera.
        </td>
      `;
      holdSalesList.appendChild(tr);
      return;
    }

    heldSales
      .slice()
      .sort((a, b) => b.id - a.id)
      .forEach(sale => {
        const tr = document.createElement('tr');
        const d = sale.createdAt ? new Date(sale.createdAt) : new Date(sale.id);
        const fecha = isNaN(d.getTime())
          ? ''
          : d.toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' });
        const cliente = sale.client && sale.client.nombre ? sale.client.nombre : 'Sin cliente';
        const total = typeof sale.totalVes === 'number'
          ? sale.totalVes
          : calculateCartTotalFromItems(sale.cart || []);

        tr.innerHTML = `
          <td class="px-4 py-2 text-sm text-gray-700 whitespace-nowrap">${fecha}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${cliente}</td>
          <td class="px-4 py-2 text-sm text-gray-900 text-right whitespace-nowrap">${(total || 0).toFixed(2)} Bs</td>
          <td class="px-4 py-2 text-sm text-right whitespace-nowrap space-x-2">
            <button
              class="btn-resume-hold px-2 py-1 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700"
              data-hold-id="${sale.id}">
              Reanudar
            </button>
            <button
              class="btn-delete-hold px-2 py-1 text-xs bg-red-600 text-white rounded-md hover:bg-red-700"
              data-hold-id="${sale.id}">
              Eliminar
            </button>
          </td>
        `;
        holdSalesList.appendChild(tr);
      });
  }

  async function handleHoldSalesListClick(event) {
    const resumeBtn = event.target.closest('.btn-resume-hold');
    const deleteBtn = event.target.closest('.btn-delete-hold');

    if (resumeBtn) {
      const holdId = resumeBtn.dataset.holdId;
      await handleResumeHoldSale(holdId);
    } else if (deleteBtn) {
      const holdId = deleteBtn.dataset.holdId;
      await handleDeleteHoldSale(holdId);
    }
  }

  async function handleResumeHoldSale(holdId) {
    const heldSales = loadHeldSales();
    const idx = heldSales.findIndex(s => String(s.id) === String(holdId));
    if (idx === -1) return;

    if (cart.length > 0) {
      const confirmed = await showGlobalConfirm(
        'Actualmente tienes productos en el carrito. Si reanudas una venta en espera, se reemplazará el carrito actual. ¿Deseas continuar?',
        'Reanudar venta en espera'
      );
      if (!confirmed) return;
    }

    const hold = heldSales[idx];

    cart = (hold.cart || []).map(item => ({
      ...item,
      lineId: generateCartItemId(),
      presentationId: item.presentationId || null,
      unidadesBase: typeof item.unidadesBase === 'number' && item.unidadesBase > 0 ? item.unidadesBase : 1
    }));
    discountPercent = hold.discountPercent || 0;
    renderCart();

    if (hold.client && hold.client.id) {
      selectedClientIdInput.value = hold.client.id;
      selectedClientNameSpan.textContent = hold.client.nombre || 'Cliente';
      selectedClientDiv.classList.remove('hidden');
      clientSearchInput.classList.add('hidden');
    } else if (hold.client && hold.client.nombre) {
      // Si solo se guardó nombre manual, lo mostramos igual
      selectedClientIdInput.value = '';
      selectedClientNameSpan.textContent = hold.client.nombre;
      selectedClientDiv.classList.remove('hidden');
      clientSearchInput.classList.add('hidden');
    } else {
      resetClientSearch();
    }

    heldSales.splice(idx, 1);
    saveHeldSales(heldSales);
    renderHeldSalesList(heldSales);
    holdSalesStatus.textContent = heldSales.length === 0 ? 'No hay ventas en espera.' : '';

    closeHeldSalesModal();
    searchInputPOS.focus();
  }

  async function handleDeleteHoldSale(holdId) {
    const confirmed = await showGlobalConfirm(
      '¿Seguro que deseas eliminar esta venta en espera?',
      'Eliminar venta en espera'
    );
    if (!confirmed) return;

    const heldSales = loadHeldSales();
    const idx = heldSales.findIndex(s => String(s.id) === String(holdId));
    if (idx === -1) return;

    heldSales.splice(idx, 1);
    saveHeldSales(heldSales);
    renderHeldSalesList(heldSales);
    holdSalesStatus.textContent = heldSales.length === 0 ? 'No hay ventas en espera.' : '';
  }

  async function generateBudget() {
    console.log('[Budget] generateBudget called');
    if (cart.length === 0) {
      await showGlobalAlert('El carrito está vacío.');
      return;
    }

    const { netSubtotalVes, totalTaxVes } = calculateCartTotals();
    const totalVes = calculateCartTotalVes();
    const bcvRate = (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
    const totalUsd = totalVes / bcvRate;

    console.log('[Budget] Payload preparation');
    const payload = {
      cart: cart.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        priceVes: item.priceVes,
        priceUsd: item.priceUsd,
        unidadesBase: item.unidadesBase,
        tipo_venta: item.tipo_venta,
        exento_iva: item.exento_iva
      })),
      totalVes,
      totalUsd,
      netSubtotalVes,
      totalTaxVes,
      cliente_id: selectedClientIdInput ? selectedClientIdInput.value : null
    };

    try {
      console.log('[Budget] Sending request to /api/sales/budget');
      const response = await fetch('/api/sales/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      console.log('[Budget] Response status:', response.status);
      if (!response.ok) {
        let errorMsg = 'Error al generar el presupuesto';
        try {
          const err = await response.json();
          errorMsg = err.error || errorMsg;
        } catch (e) { }
        throw new Error(errorMsg);
      }

      const htmlContent = await response.text();
      console.log('[Budget] Opening print window');

      const printWindow = openAppWindow('', 'Presupuesto', 350, 850);
      if (printWindow) {
        printWindow.document.write(htmlContent);
        printWindow.document.close();
      } else {
        console.warn('[Budget] Popup blocked');
        await showGlobalAlert('No se pudo abrir la ventana de impresión. Por favor, permite las ventanas emergentes.');
      }
    } catch (error) {
      console.error('[Budget] Error:', error);
      await showGlobalAlert(error.message);
    }
  }

  // =========================
  // PAGOS
  // =========================

  async function openPaymentModal() {
    if (cart.length === 0) return;
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert("Error: No se han cargado las tasas de cambio. Intenta recargar la página.");
      return;
    }
    const totalVes = calculateCartTotalVes();
    const totalUsd = calculateCartTotalUsd();
    modalTotalVesSpan.textContent = `${totalVes.toFixed(2)} Bs`;
    modalTotalUsdSpan.textContent = `(${totalUsd.toFixed(2)} $)`;

    // Helper para actualizar el encabezado USD según la tasa seleccionada
    function refreshModalUsdHeader() {
      const usd = calculateCartTotalUsd();
      modalTotalUsdSpan.textContent = `(${usd.toFixed(2)} $)`;
      updatePaymentSummary();
    }

    // 🔹 RESPALDO: Preservar el cliente seleccionado y la tasa de indexación
    const backupClientId = selectedClientIdInput.value;
    const backupIndexTipo = formPago.querySelector('input[name="tasa-index-tipo"]:checked')?.value || 'BCV';

    formPago.reset();

    // 🔹 RESTAURACIÓN: Recuperar los valores después del reset
    selectedClientIdInput.value = backupClientId;
    const radioToRestore = formPago.querySelector(`input[name="tasa-index-tipo"][value="${backupIndexTipo}"]`);
    if (radioToRestore) radioToRestore.checked = true;

    pagoUsdEfectivoInput.value = '';
    const pagoReferenciaInput = document.getElementById('pago-referencia');
    if (pagoReferenciaInput) pagoReferenciaInput.value = '';

    // Reset rounding mode
    currentRoundingMode = 'NONE';
    setRoundingMode('NONE', true); // true = force update UI only

    updatePaymentSummary(); // Recalcula con el modo normal

    // Listeners para redondeo (si no se han agregado antes)
    const btnDown = document.getElementById('btn-round-down');
    const btnNone = document.getElementById('btn-round-none');
    const btnUp = document.getElementById('btn-round-up');

    // Remove old listeners to avoid duplicates (sencillo hack)
    const newBtnDown = btnDown.cloneNode(true);
    const newBtnNone = btnNone.cloneNode(true);
    const newBtnUp = btnUp.cloneNode(true);

    btnDown.parentNode.replaceChild(newBtnDown, btnDown);
    btnNone.parentNode.replaceChild(newBtnNone, btnNone);
    btnUp.parentNode.replaceChild(newBtnUp, btnUp);

    newBtnDown.addEventListener('click', () => setRoundingMode('DOWN'));
    newBtnNone.addEventListener('click', () => setRoundingMode('NONE'));
    newBtnUp.addEventListener('click', () => setRoundingMode('UP'));

    // 🔹 Actualizar total USD en vivo cuando cambia la tasa de indexación
    formPago.querySelectorAll('input[name="tasa-index-tipo"]').forEach(radio => {
      // Clonar para limpiar listeners previos
      const newRadio = radio.cloneNode(true);
      radio.parentNode.replaceChild(newRadio, radio);
      newRadio.addEventListener('change', refreshModalUsdHeader);
    });
    // Restaurar la selección después de clonar
    const restoredRadio = formPago.querySelector(`input[name="tasa-index-tipo"][value="${backupIndexTipo}"]`);
    if (restoredRadio) restoredRadio.checked = true;
    // Actualizar header con tasa ya restaurada
    refreshModalUsdHeader();

    paymentModal.classList.remove('hidden');
    // Auto-focus en el primer campo de pago
    setTimeout(() => {
      pagoVesEfectivoInput.focus();
    }, 100);
  }

  function setRoundingMode(mode, skipUpdate = false) {
    currentRoundingMode = mode;

    const btnDown = document.getElementById('btn-round-down');
    const btnNone = document.getElementById('btn-round-none');
    const btnUp = document.getElementById('btn-round-up');

    // Reset styles
    if (btnDown) btnDown.className = "px-2 py-0.5 rounded text-xs font-bold text-gray-600 hover:bg-white hover:text-red-600 transition-colors";
    if (btnNone) btnNone.className = "px-2 py-0.5 rounded text-xs font-bold text-gray-600 hover:bg-white hover:text-blue-600 transition-colors";
    if (btnUp) btnUp.className = "px-2 py-0.5 rounded text-xs font-bold text-gray-600 hover:bg-white hover:text-green-600 transition-colors";

    // Set active style
    if (mode === 'DOWN' && btnDown) {
      btnDown.className = "px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-300 shadow-inner";
    } else if (mode === 'NONE' && btnNone) {
      btnNone.className = "px-2 py-0.5 rounded text-xs font-bold bg-blue-100 text-blue-700 border border-blue-300 shadow-inner";
    } else if (mode === 'UP' && btnUp) {
      btnUp.className = "px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 border border-green-300 shadow-inner";
    }

    if (!skipUpdate) {
      updatePaymentSummary();
    }
  }

  function getRoundedTotal(amount) {
    if (currentRoundingMode === 'UP') {
      return Math.ceil(amount / ROUNDING_STEP) * ROUNDING_STEP;
    } else if (currentRoundingMode === 'DOWN') {
      return Math.floor(amount / ROUNDING_STEP) * ROUNDING_STEP;
    }
    return amount;
  }
  function closePaymentModal() {
    paymentModal.classList.add('hidden');
  }

  function getPosActiveRate() {
    const selectedRateType = document.querySelector('input[name="tasa-index-tipo"]:checked')?.value || 'BCV';
    if (currentRates && currentRates[selectedRateType] > 0) {
      return currentRates[selectedRateType];
    }
    return (currentRates && currentRates.BCV > 0) ? currentRates.BCV : 1;
  }

  function updatePaymentSummary() {
    if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
      console.error("updatePaymentSummary: BCV rate is invalid.");
      btnCompletarVenta.disabled = true;
      btnGuardarFiado.disabled = true;
      return;
    }

    // 1. Calcular total real
    const rawTotalVes = calculateCartTotalVes();
    // 2. Aplicar redondeo según configuración
    const totalAPagarVes = getRoundedTotal(rawTotalVes);

    // Actualizar UI con el total exigible (redondeado)
    modalTotalVesSpan.textContent = `${totalAPagarVes.toFixed(2)} Bs`;

    // Si hay diferencia por redondeo, mostrarla visualmente (sutil)
    // Opcional: Podría agregarse un tooltip o pequeño texto indicando "Redondeo aplicado"

    let totalPagadoVes = 0;
    const vesEfectivo = parseFloat(pagoVesEfectivoInput.value) || 0;
    totalPagadoVes += vesEfectivo;
    const usdEfectivo = parseFloat(pagoUsdEfectivoInput.value) || 0;
    totalPagadoVes += usdEfectivo * getPosActiveRate();
    const tarjeta = parseFloat(pagoTarjetaInput.value) || 0;
    totalPagadoVes += tarjeta;
    const biopago = parseFloat(pagoBiopagoInput.value) || 0;
    totalPagadoVes += biopago;
    const pagomovil = parseFloat(pagoPagomovilInput.value) || 0;
    totalPagadoVes += pagomovil;
    const zelle = parseFloat(pagoZelleInput.value) || 0;
    totalPagadoVes += zelle * getPosActiveRate();


    // Usamos el total REDONDEADO para calcular la diferencia
    const diferencia = totalPagadoVes - totalAPagarVes;
    const margenError = 0.5; // Tolerancia un poco mayor si hay redondeo


    faltanteContainer.classList.add('hidden');
    vueltoContainer.classList.add('hidden');
    faltanteContainer.classList.remove('text-red-600', 'text-orange-600');
    vueltoContainer.classList.remove('text-green-600');

    const clienteSeleccionado = !!selectedClientIdInput.value;

    if (diferencia < -margenError) {
      const faltanteVes = Math.abs(diferencia);
      // Usar la tasa seleccionada para mostrar el faltante en USD
      const selectedRateType = document.querySelector('input[name="tasa-index-tipo"]:checked')?.value || 'BCV';
      const selectedRate = (currentRates[selectedRateType] > 0) ? currentRates[selectedRateType] : currentRates.BCV;
      const faltanteUsd = faltanteVes / selectedRate;
      modalFaltanteVesSpan.textContent = `${faltanteVes.toFixed(2)} Bs`;
      modalFaltanteUsdSpan.textContent = `(${faltanteUsd.toFixed(2)} $)`;
      faltanteContainer.classList.remove('hidden');
      faltanteContainer.classList.add(totalPagadoVes > 0 ? 'text-orange-600' : 'text-red-600');

      btnCompletarVenta.disabled = true;
      btnGuardarFiado.disabled = !clienteSeleccionado;
      totalChangeDueVes = 0;
    } else {
      const vueltoVes = diferencia;
      totalChangeDueVes = vueltoVes; // 🔹 FIX: Update global variable
      const vueltoUsd = vueltoVes / currentRates.BCV;
      modalVueltoVesSpan.textContent = `${vueltoVes.toFixed(2)} Bs`;
      modalVueltoUsdSpan.textContent = `(${vueltoUsd.toFixed(2)} $)`;
      vueltoContainer.classList.remove('hidden');
      vueltoContainer.classList.add('text-green-600');

      btnCompletarVenta.disabled = false;
      btnGuardarFiado.disabled = true; // No tiene sentido fiar si ya pagó
    }
  }

  function setPagoTodoVes() {
    const totalVes = calculateCartTotalVes();
    const roundedTotalVes = getRoundedTotal(totalVes); // Usar redondeado

    const pagoUsd = parseFloat(pagoUsdEfectivoInput.value) || 0;
    const pagoTarjeta = parseFloat(pagoTarjetaInput.value) || 0;
    const pagoBiopago = parseFloat(pagoBiopagoInput.value) || 0;
    const pagoPM = parseFloat(pagoPagomovilInput.value) || 0;
    const pagoZelle = parseFloat(pagoZelleInput.value) || 0;

    const yaPagadoVes = (pagoUsd * getPosActiveRate()) + pagoTarjeta + pagoBiopago + pagoPM + (pagoZelle * getPosActiveRate());
    const restante = Math.max(0, roundedTotalVes - yaPagadoVes);

    pagoVesEfectivoInput.value = restante.toFixed(2);
    updatePaymentSummary();
  }

  async function handlePagoTodoVes() {
    setPagoTodoVes();
  }

  // (Y así para los otros métodos si fuera necesario, aunque el redondeo suele ser para efectivo VES)

  async function handlePagoTodoUsd() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const rawTotal = calculateCartTotalVes();
    const totalVes = getRoundedTotal(rawTotal);

    const vesEfectivo = parseFloat(pagoVesEfectivoInput.value) || 0;
    const tarjeta = parseFloat(pagoTarjetaInput.value) || 0;
    const biopago = parseFloat(pagoBiopagoInput.value) || 0;
    const pagomovil = parseFloat(pagoPagomovilInput.value) || 0;
    const zelle = parseFloat(pagoZelleInput.value) || 0;
    const pagadoBs = vesEfectivo + tarjeta + biopago + pagomovil + (zelle * getPosActiveRate());
    const restanteVes = totalVes - pagadoBs;
    const montoUsd = Math.max(0, restanteVes / getPosActiveRate());
    pagoUsdEfectivoInput.value = montoUsd.toFixed(2);
    updatePaymentSummary();
  }

  async function handlePagoTodoTarjeta() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const rawTotal = calculateCartTotalVes();
    const totalVes = getRoundedTotal(rawTotal);

    const vesEfectivo = parseFloat(pagoVesEfectivoInput.value) || 0;
    const usdEfectivo = parseFloat(pagoUsdEfectivoInput.value) || 0;
    const biopago = parseFloat(pagoBiopagoInput.value) || 0;
    const pagomovil = parseFloat(pagoPagomovilInput.value) || 0;
    const zelle = parseFloat(pagoZelleInput.value) || 0;
    const pagadoSinTarjeta = vesEfectivo + (usdEfectivo * getPosActiveRate()) + biopago + pagomovil + (zelle * getPosActiveRate());
    const restanteVes = totalVes - pagadoSinTarjeta;
    const monto = Math.max(0, restanteVes);
    pagoTarjetaInput.value = monto.toFixed(2);
    updatePaymentSummary();
  }

  async function handlePagoTodoBiopago() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const rawTotal = calculateCartTotalVes();
    const totalVes = getRoundedTotal(rawTotal);

    const vesEfectivo = parseFloat(pagoVesEfectivoInput.value) || 0;
    const usdEfectivo = parseFloat(pagoUsdEfectivoInput.value) || 0;
    const tarjeta = parseFloat(pagoTarjetaInput.value) || 0;
    const pagomovil = parseFloat(pagoPagomovilInput.value) || 0;
    const zelle = parseFloat(pagoZelleInput.value) || 0;
    const pagadoSinBiopago = vesEfectivo + (usdEfectivo * getPosActiveRate()) + tarjeta + pagomovil + (zelle * getPosActiveRate());
    const restanteVes = totalVes - pagadoSinBiopago;
    const monto = Math.max(0, restanteVes);
    pagoBiopagoInput.value = monto.toFixed(2);
    updatePaymentSummary();
  }

  async function handlePagoTodoPagomovil() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const rawTotal = calculateCartTotalVes();
    const totalVes = getRoundedTotal(rawTotal);

    const vesEfectivo = parseFloat(pagoVesEfectivoInput.value) || 0;
    const usdEfectivo = parseFloat(pagoUsdEfectivoInput.value) || 0;
    const tarjeta = parseFloat(pagoTarjetaInput.value) || 0;
    const biopago = parseFloat(pagoBiopagoInput.value) || 0;
    const zelle = parseFloat(pagoZelleInput.value) || 0;

    const pagadoSinPm = vesEfectivo + (usdEfectivo * getPosActiveRate()) + tarjeta + biopago + (zelle * getPosActiveRate());
    const restanteVes = totalVes - pagadoSinPm;
    const monto = Math.max(0, restanteVes);
    pagoPagomovilInput.value = monto.toFixed(2);
    updatePaymentSummary();
  }

  async function handlePagoTodoZelle() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const rawTotal = calculateCartTotalVes();
    const totalVes = getRoundedTotal(rawTotal);

    const vesEfectivo = parseFloat(pagoVesEfectivoInput.value) || 0;
    const usdEfectivo = parseFloat(pagoUsdEfectivoInput.value) || 0;
    const tarjeta = parseFloat(pagoTarjetaInput.value) || 0;
    const biopago = parseFloat(pagoBiopagoInput.value) || 0;
    const pagomovil = parseFloat(pagoPagomovilInput.value) || 0;

    const pagadoSinZelle = vesEfectivo + (usdEfectivo * getPosActiveRate()) + tarjeta + biopago + pagomovil;
    const restanteVes = totalVes - pagadoSinZelle;
    const monto = Math.max(0, restanteVes / getPosActiveRate());
    pagoZelleInput.value = monto.toFixed(2);
    updatePaymentSummary();
  }

  // Helper para cortar o rellenar texto a un ancho fijo
  function trunc(text, width) {
    text = (text || '').toString();
    if (text.length > width) return text.slice(0, width);
    return text;
  }

  function formatLine(left, right, width) {
    left = (left || '').toString();
    right = (right || '').toString();
    const totalLen = left.length + right.length;
    if (totalLen >= width) {
      // Si se pasa, recortamos el lado izquierdo
      left = left.slice(0, Math.max(0, width - right.length - 1));
      return (left + ' ' + right).slice(0, width);
    }
    const spaces = width - totalLen;
    return left + ' '.repeat(spaces) + right;
  }

  // Ticket ESC/POS "bonito" pero genérico
  function buildSimpleTextTicket({
    saleId,
    cart,
    totalVes,
    totalUsd,
    payments,
    header,
    footer,
    ticketSize,
    impuesto_total = 0,
    clientName = null,
    clientCedula = null
  }) {
    // Ancho típico: 58mm ≈ 32 columnas, 80mm ≈ 42 columnas
    const width = ticketSize === 58 ? 32 : 42;
    const line = '-'.repeat(width);

    // ESC/POS comandos básicos
    const ESC = '\x1B';
    const GS = '\x1D';

    const INIT = ESC + '@';        // Reset impresora
    const ALIGN_LEFT = ESC + 'a' + '\x00';
    const ALIGN_CENTER = ESC + 'a' + '\x01';
    const ALIGN_RIGHT = ESC + 'a' + '\x02';
    const BOLD_ON = ESC + 'E' + '\x01';
    const BOLD_OFF = ESC + 'E' + '\x00';
    const DOUBLE_ON = ESC + '!' + '\x30'; // doble ancho + doble alto
    const DOUBLE_OFF = ESC + '!' + '\x00';
    const CUT_FULL = GS + 'V' + '\x00';  // Corte total (si la impresora lo soporta)

    let text = '';

    // Inicializar impresora
    text += INIT;

    // ========== ENCABEZADO ==========
    const headerLines = (header || '').split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (headerLines.length > 0) {
      text += ALIGN_CENTER;
      headerLines.forEach((l, idx) => {
        if (idx === 0) {
          // Primera línea grande y en negrita
          text += BOLD_ON + DOUBLE_ON;
          text += trunc(l, width) + '\n';
          text += DOUBLE_OFF + BOLD_OFF;
        } else {
          text += trunc(l, width) + '\n';
        }
      });
    } else {
      // Encabezado por defecto
      text += ALIGN_CENTER;
      text += BOLD_ON + DOUBLE_ON + trunc('RECIBO DE VENTA', width) + '\n';
      text += DOUBLE_OFF + BOLD_OFF;
    }

    text += ALIGN_CENTER + trunc('Documento no fiscal', width) + '\n';
    text += line + '\n';

    // ========== DATOS DE LA VENTA ==========
    const now = new Date();
    const fechaStr = now.toLocaleString('es-VE');
    text += ALIGN_LEFT;
    text += trunc(`Venta #${saleId}`, width) + '\n';
    text += trunc(fechaStr, width) + '\n';
    if (clientName) {
      text += trunc(`Cliente: ${clientName}`, width) + '\n';
      if (clientCedula) {
        text += trunc(`C.I./RIF: ${clientCedula}`, width) + '\n';
      }
    }
    text += line + '\n';

    // ========== PRODUCTOS ==========
    cart.forEach(item => {
      const name = item.nombre || item.name || `Prod ${item.id}`;
      const qty = Number(item.quantity || 0);
      const priceVes = Number(item.priceVes || 0);
      const totalItem = qty * priceVes;
      const isPeso = item.tipo_venta === 'PESO';

      const isExempt = (item.exento_iva === 1 || item.exento_iva === true || item.exento_iva === '1');
      const indicator = isExempt ? ' (E)' : '';

      const qtyStr = isPeso
        ? `${qty.toFixed(3)} Kg`
        : `${qty}`;

      const totalStr = `${totalItem.toFixed(2)} Bs`;

      // Primera línea: "2 x Producto (E)"
      const leftText = `${qtyStr} x ${name}${indicator}`;
      text += trunc(leftText, width) + '\n';

      // Segunda línea: precio unidad + total alineado
      const unidadStr = isPeso
        ? `${priceVes.toFixed(2)} Bs/Kg`
        : `${priceVes.toFixed(2)} Bs c/u`;

      text += formatLine(unidadStr, totalStr, width) + '\n';
    });

    text += line + '\n';

    // ========== TOTALES ==========
    if (impuesto_total > 0) {
      const subtotal = totalVes - impuesto_total;
      text += formatLine('Subtotal:', subtotal.toFixed(2), width) + '\n';
      text += formatLine('IVA:', impuesto_total.toFixed(2), width) + '\n';
    }

    if (discountPercent > 0) {
      text += formatLine(`Descuento (${discountPercent}%):`, `-${(calculateCartTotals(cart).totalVes * discountPercent / 100).toFixed(2)}`, width) + '\n';
    }
    text += line + '\n';

    text += BOLD_ON;
    text += formatLine('TOTAL Bs:', totalVes.toFixed(2), width) + '\n';
    text += BOLD_OFF;

    text += formatLine('TOTAL USD:', totalUsd.toFixed(2), width) + '\n';
    text += line + '\n';

    // ========== PAGOS ==========
    text += 'PAGOS:\n';
    payments.forEach(p => {
      let label = p.method;
      if (p.method === 'VES_EFECTIVO') label = 'Efectivo Bs';
      if (p.method === 'USD_EFECTIVO') label = 'Efectivo USD';
      if (p.method === 'TARJETA') label = 'Tarjeta Bs';
      if (p.method === 'BIOPAGO') label = 'Biopago Bs';
      if (p.method === 'PAGOMOVIL') label = 'PagoMóvil Bs';
      if (p.method === 'ZELLE') label = 'Zelle USD';

      const rec = Number(p.amountReceived || 0);
      const inVes = Number(p.amountInVes || 0);

      if (p.method === 'USD_EFECTIVO') {
        text += formatLine(
          `${label}:`,
          `${rec.toFixed(2)} $ (${inVes.toFixed(2)} Bs)`,
          width
        ) + '\n';
      } else {
        text += formatLine(
          `${label}:`,
          `${inVes.toFixed(2)} Bs`,
          width
        ) + '\n';
      }
    });

    // ========== PIE DE PÁGINA ==========
    const footerLines = (footer || '').split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);

    text += line + '\n';
    text += ALIGN_CENTER;

    if (footerLines.length > 0) {
      footerLines.forEach(l => {
        text += trunc(l, width) + '\n';
      });
    } else {
      text += '¡Gracias por su compra!\n';
    }

    // Unos feeds para que salga completo
    text += '\n\n\n';

    // Corte de papel
    text += CUT_FULL;

    return text;
  }


  async function completeSale(isCreditSale = false) {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert("Error: Las tasas de cambio no están cargadas. No se puede completar la venta.");
      return;
    }

    updatePaymentSummary();

    // 1. Calcular totales reales y redondeados
    const rawTotalVes = calculateCartTotalVes();
    const totalAPagarVes = getRoundedTotal(rawTotalVes); // Total exigible

    // Diferencia por redondeo: 
    // Si < 0: Redondeo abajo (Descuento implícito)
    // Si > 0: Redondeo arriba (Cargo extra implícito)
    const roundingAdjustment = totalAPagarVes - rawTotalVes;

    let totalPagadoVes = 0;
    const payments = [];
    const tasaBcvMomento = getPosActiveRate();

    const vesEfectivo = parseFloat(pagoVesEfectivoInput.value) || 0;
    if (vesEfectivo > 0) {
      payments.push({
        method: 'VES_EFECTIVO',
        amountReceived: vesEfectivo,
        amountInVes: vesEfectivo
      });
    }
    totalPagadoVes += vesEfectivo;

    const usdEfectivo = parseFloat(pagoUsdEfectivoInput.value) || 0;
    if (usdEfectivo > 0) {
      payments.push({
        method: 'USD_EFECTIVO',
        amountReceived: usdEfectivo,
        amountInVes: usdEfectivo * tasaBcvMomento
      });
    }
    totalPagadoVes += usdEfectivo * tasaBcvMomento;

    const tarjeta = parseFloat(pagoTarjetaInput.value) || 0;
    if (tarjeta > 0) {
      payments.push({
        method: 'TARJETA',
        amountReceived: tarjeta,
        amountInVes: tarjeta
      });
    }
    totalPagadoVes += tarjeta;

    const biopago = parseFloat(pagoBiopagoInput.value) || 0;
    if (biopago > 0) {
      payments.push({
        method: 'BIOPAGO',
        amountReceived: biopago,
        amountInVes: biopago
      });
    }
    totalPagadoVes += biopago;

    const pagomovil = parseFloat(pagoPagomovilInput.value) || 0;
    const pagoReferencia = document.getElementById('pago-referencia')?.value || null;

    if (pagomovil > 0) {
      payments.push({
        method: 'PAGOMOVIL',
        amountReceived: pagomovil,
        amountInVes: pagomovil,
        referencia: pagoReferencia
      });
    }
    totalPagadoVes += pagomovil;

    const zelle = parseFloat(pagoZelleInput.value) || 0;
    if (zelle > 0) {
      payments.push({
        method: 'ZELLE',
        amountReceived: zelle,
        amountInVes: zelle * tasaBcvMomento
      });
    }
    totalPagadoVes += zelle * tasaBcvMomento;

    // Tambien adjuntar a Tarjeta y Biopago si existen
    payments.forEach(p => {
      if (['TARJETA', 'BIOPAGO'].includes(p.method)) {
        p.referencia = pagoReferencia;
      }
    });

    console.log(`[DEBUG] completSale START. isCreditSale=${isCreditSale}`);
    // Calcular pendiente usando el total exigible (redondeado)
    const montoPendienteVes = Math.max(0, totalAPagarVes - totalPagadoVes);
    const clienteId = selectedClientIdInput.value || null;

    if (isCreditSale && !clienteId) {
      await showGlobalAlert("Error: Debe seleccionar un cliente para guardar una venta a crédito.");
      return;
    }

    // Permitimos tolerancia de 0.20 Bs por el redondeo
    if (!isCreditSale && montoPendienteVes > 0.20) {
      await showGlobalAlert(`Error: El monto pagado no cubre el total de la venta. Faltan ${montoPendienteVes.toFixed(2)} Bs.`);
      updatePaymentSummary();
      return;
    }

    btnCompletarVenta.disabled = true;
    btnGuardarFiado.disabled = true;
    // mostrarMensajeModal('Procesando venta...', 'info'); // Removed to prevent error if undefined

    // Calcular totalUsd con la tasa de indexación seleccionada (BCV o Paralelo)
    const selectedRateForSale = document.querySelector('input[name="tasa-index-tipo"]:checked')?.value || 'BCV';
    const totalUsd = calculateCartTotalUsd(selectedRateForSale);

    const saleData = {
      cart: cart.map(item => {
        const unidadesBase = parseFloat(item.unidadesBase || 1) || 1;

        if (item.tipo_venta === 'PESO') {
          return {
            id: item.id,
            quantity: item.quantity,
            priceVes: item.priceVes
          };
        }

        if (item.tipo_venta === 'LITRO') {
          return {
            id: item.id,
            quantity: item.quantity,
            priceVes: item.priceVes
          };
        }

        if (!item.presentationId || unidadesBase <= 1) {
          return {
            id: item.id,
            quantity: item.quantity,
            priceVes: item.priceVes
          };
        }

        const baseQuantity = item.quantity * unidadesBase;
        const unitPriceVes = item.priceVes / unidadesBase;

        return {
          id: item.id,
          quantity: baseQuantity,
          priceVes: unitPriceVes
        };
      }),
      payments,
      totalVes: totalAPagarVes, // Enviamos el total redondeado como el "total esperado"
      rawTotalVes: rawTotalVes, // Enviamos el total original por si acaso
      roundingAdjustment: roundingAdjustment, // Enviamos el ajuste explícitamente
      totalUsd: totalUsd,
      cliente_id: clienteId ? parseInt(clienteId, 10) : null,
      tasa_referencia: document.querySelector('input[name="tasa-index-tipo"]:checked')?.value || 'BCV',
      usuario_id: JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}').id || null,
      descuento_pct: discountPercent || 0,
      descuento_ves: discountPercent > 0 ? (calculateCartTotals(cart).totalVes * discountPercent / 100) : 0
    };

    try {
      const response = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saleData),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido al completar la venta');

      lastCompletedSaleId = result.saleId;

      const {
        printTicket = false,
        printMode = 'preview',
        printerName = '',
        printCopies = 1,
        ticketSize = 80,
        printHeader = '',
        printFooter = ''
      } = result;

      // mostrarMensajeModal(`¡Venta #${result.saleId} completada!`, 'success'); // Handled by modals

      closePaymentModal();

      // Usamos el contexto padre si existe (iframe) o el actual si no
      const ctx = (window.parent && window.parent !== window) ? window.parent : window;

      let directOk = null; // null => no aplica, true => ok, false => fallo

      if (printTicket && printMode === 'direct') {
        const ep = ctx.electronPrinter;

        if (ep && typeof ep.printTextTicket === 'function') {
          try {
            const textTicket = buildSimpleTextTicket({
              saleId: result.saleId,
              cart,
              totalVes: totalAPagarVes,
              totalUsd,
              payments,
              header: printHeader,
              footer: printFooter,
              ticketSize,
              impuesto_total: result.impuesto_total || 0,
              clientName: selectedClientObject ? selectedClientObject.nombre : null,
              clientCedula: selectedClientObject ? selectedClientObject.cedula : null
            });

            const printResp = await ep.printTextTicket({
              printerName: printerName || undefined,
              text: textTicket,
              type: 'RAW'
            });

            directOk = !!(printResp && printResp.ok);

            if (!directOk) {
              console.error('Error impresión directa:', printResp && printResp.error);
              await showGlobalAlert(
                'No se pudo imprimir el ticket automáticamente.\n\n' +
                (printResp && printResp.error ? `Detalle: ${printResp.error}` : '')
              );
            }
          } catch (e) {
            console.error('Excepción impresión directa:', e);
            directOk = false;
            await showGlobalAlert(
              'Ocurrió un error al enviar el ticket a la impresora.\n' +
              'Revisa la consola o la configuración de impresión.'
            );
          }
        } else {
          directOk = false;
          console.error('Impresión directa no disponible: electronPrinter no existe en este contexto.');
          await showGlobalAlert(
            'La impresión directa no está disponible en este entorno.\n' +
            'Si estás en Electron, asegúrate de:\n' +
            '- Que el preload exponga electronPrinter.\n' +
            '- Que estés ejecutando la vista POS dentro de la ventana de Electron (no en un navegador externo).'
          );
        }
      }

      if (printTicket && printMode === 'preview') {
        const ts = Date.now();
        openAppWindow(`/api/sales/${result.saleId}/receipt?ts=${ts}`, 'Ticket', 350, 750);
      }

      console.log(`[DEBUG] Sale ID ${result.saleId} created. Checking change modal condition.`);
      console.log(`[DEBUG] totalChangeDueVes=${totalChangeDueVes}, isCreditSale=${isCreditSale}`);

      if (totalChangeDueVes > 0.005 || isCreditSale) {
        console.log(`[DEBUG] Condition met. Opening Change Modal...`);
        openChangeModal(totalChangeDueVes);
      } else {
        console.log(`[DEBUG] Condition failed. Showing standard completion.`);
        showSaleCompleteModal(result.saleId, {
          printTicket,
          printMode,
          directOk,
          totalChangeDueVes: 0 // No hubo vuelto en este caso
        });
        resetPOSState(true);

        // INSTANT STOCK ALERT: Notificar a NexusAI que verifique el stock ahora
        const ctx = (window.parent && window.parent !== window) ? window.parent : window;
        if (ctx.nexusAIInstance) {
          console.log('[POS] Triggering instant stock check via NexusAI');
          ctx.nexusAIInstance.checkStockAlerts();
        }
      }

    } catch (error) {
      console.error('Error completando venta:', error);
      await showGlobalAlert(`Error: ${error.message}`);
      btnCompletarVenta.disabled = false;
      btnGuardarFiado.disabled = false;
      updatePaymentSummary();
    }
  }


  // =========================
  // MODAL CANTIDAD (PESO)
  // =========================

  function openQuantityModal(product) {
    productForQuantityModal = product;
    const unitLabel = product.tipo_venta === 'LITRO' ? 'Lt' : 'Kg';
    quantityModalTitle.textContent = `Ingresar Cantidad (${unitLabel}) - ${product.nombre || product.name || ''}`;
    quantityModalInput.value = '';
    quantityModalStatus.textContent = `Stock disponible: ${product.stock} ${unitLabel}`;
    quantityModalStatus.className = 'text-sm text-gray-500 mt-2 text-center';
    quantityModal.classList.remove('hidden');
    quantityModalInput.focus();
  }

  function closeQuantityModal() {
    quantityModal.classList.add('hidden');
    productForQuantityModal = null;
    quantityModalInput.value = '';
    quantityModalStatus.textContent = '';
  }

  async function handleQuantitySubmit(event) {
    event.preventDefault();
    const product = productForQuantityModal;
    if (!product) return;

    const quantity = parseFloat(quantityModalInput.value);

    if (isNaN(quantity) || quantity <= 0) {
      quantityModalStatus.textContent = 'Por favor, ingresa una cantidad válida.';
      quantityModalStatus.className = 'text-sm text-red-600 mt-2 text-center';
      return;
    }

    if (quantity > product.stock) {
      quantityModalStatus.textContent = `Cantidad excede el stock. Disponible: ${product.stock} Kg`;
      quantityModalStatus.className = 'text-sm text-red-600 mt-2 text-center';
      return;
    }

    await addWeightedProductToCart(product, quantity);
    closeQuantityModal();
  }

  // =========================
  // MODAL VUELTO
  // =========================

  function openChangeModal(vueltoTotalVes) {
    console.log(`[DEBUG] openChangeModal called with ${vueltoTotalVes}`);
    totalChangeDueVes = vueltoTotalVes;
    const vueltoTotalUsd = (getPosActiveRate() > 0) ? vueltoTotalVes / getPosActiveRate() : 0;
    changeModalTotalVesSpan.textContent = `${vueltoTotalVes.toFixed(2)} Bs`;
    changeModalTotalUsdSpan.textContent = `(${vueltoTotalUsd.toFixed(2)} $)`;

    // Force remove hidden just in case
    changeModal.classList.remove('hidden');
    console.log(`[DEBUG] changeModal classes:`, changeModal.classList.toString());

    formChange.reset();
    updateChangeSummary();
    changeUsdEfectivoInput.focus();
  }

  function updateChangeSummary() {
    if (!currentRates || typeof currentRates.BCV !== 'number' || currentRates.BCV <= 0) {
      console.error("updateChangeSummary: BCV rate is invalid.");
      return;
    }
    let vueltoEntregadoVes = 0;
    const changeUsd = parseFloat(changeUsdEfectivoInput.value) || 0;
    vueltoEntregadoVes += changeUsd * getPosActiveRate();
    const changeVes = parseFloat(changeVesEfectivoInput.value) || 0;
    vueltoEntregadoVes += changeVes;
    const changePM = parseFloat(changePagomovilInput.value) || 0;
    vueltoEntregadoVes += changePM;
    const restanteVes = totalChangeDueVes - vueltoEntregadoVes;
    const margenError = 0.005;
    if (restanteVes > margenError) {
      changeModalRemainingVesSpan.textContent = `${restanteVes.toFixed(2)} Bs`;
      changeRemainingContainer.classList.remove('hidden');
      btnConfirmarVuelto.disabled = true;
      mostrarMensajeChange('', 'info');
    } else {
      changeRemainingContainer.classList.add('hidden');
      btnConfirmarVuelto.disabled = false;
      if (restanteVes < -margenError) {
        mostrarMensajeChange(`Se entregó ${Math.abs(restanteVes).toFixed(2)} Bs de más.`, 'warning');
      } else {
        mostrarMensajeChange('Vuelto completo.', 'success');
      }
    }
  }

  async function handleChangeTodoUsd() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const changeVes = parseFloat(changeVesEfectivoInput.value) || 0;
    const changePM = parseFloat(changePagomovilInput.value) || 0;
    const entregadoOtrosBs = changeVes + changePM;
    const restanteBs = totalChangeDueVes - entregadoOtrosBs;
    const montoUsd = Math.max(0, restanteBs / getPosActiveRate());
    changeUsdEfectivoInput.value = montoUsd.toFixed(2);
    updateChangeSummary();
  }

  async function handleChangeTodoVes() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const changeUsd = parseFloat(changeUsdEfectivoInput.value) || 0;
    const changePM = parseFloat(changePagomovilInput.value) || 0;
    const entregadoOtrosBs = (changeUsd * getPosActiveRate()) + changePM;
    const restanteBs = totalChangeDueVes - entregadoOtrosBs;
    const montoBs = Math.max(0, restanteBs);
    changeVesEfectivoInput.value = montoBs.toFixed(2);
    updateChangeSummary();
  }

  async function handleChangeTodoPm() {
    if (!currentRates || !currentRates.BCV) {
      await showGlobalAlert('No hay tasa BCV cargada.');
      return;
    }
    const changeUsd = parseFloat(changeUsdEfectivoInput.value) || 0;
    const changeVes = parseFloat(changeVesEfectivoInput.value) || 0;
    const entregadoOtrosBs = (changeUsd * getPosActiveRate()) + changeVes;
    const restanteBs = totalChangeDueVes - entregadoOtrosBs;
    const montoBs = Math.max(0, restanteBs);
    changePagomovilInput.value = montoBs.toFixed(2);
    updateChangeSummary();
  }

  async function confirmChangeAndClose() {
    const changeUsd = parseFloat(document.getElementById('change-usd-efectivo').value) || 0;
    const changeVes = parseFloat(document.getElementById('change-ves-efectivo').value) || 0;
    const changePm = parseFloat(document.getElementById('change-pagomovil').value) || 0;

    const changePayments = [];

    if (changeUsd > 0) {
      changePayments.push({ method: 'USD_EFECTIVO', amount: changeUsd });
    }
    if (changeVes > 0) {
      changePayments.push({ method: 'VES_EFECTIVO', amount: changeVes });
    }
    if (changePm > 0) {
      changePayments.push({ method: 'PAGOMOVIL', amount: changePm });
    }

    if (changePayments.length > 0 && lastCompletedSaleId) {
      const btn = document.getElementById('btn-confirmar-vuelto');
      const originalText = btn.textContent;
      btn.textContent = 'Registrando...';
      btn.disabled = true;

      try {
        await fetch(`/api/sales/${lastCompletedSaleId}/change`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ changePayments })
        });
      } catch (error) {
        console.error("Error enviando vuelto al servidor:", error);
        alert("Error: El vuelto no se pudo registrar en el reporte Z. (Ver consola)");
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    lastCompletedSaleId = null;

    document.getElementById('change-modal').classList.add('hidden');
    resetPOSState(true);
  }

  function resetPOSState(reloadProductsAfter = false) {
    cart = [];
    discountPercent = 0;
    renderCart();
    localStorage.removeItem(CART_STORAGE_KEY);
    searchInputPOS.value = '';
    currentSearchResults = [];
    renderSearchResults();
    totalChangeDueVes = 0;
    if (reloadProductsAfter) {
      loadProducts();
    }
  }

  // =========================
  // HELPER TOAST GLOBAL
  // =========================
  function showToast(message, type = 'info') {
    // Se suprimen las notificaciones flotantes (Toast) en el POS por solicitud del usuario,
    // ya que el módulo tiene su propia retroalimentación visual.
    // if (window.parent && window.parent.Toast) {
    //   window.parent.Toast.show(message, type);
    // }
    console.log('[POS Notification]', type, message);
  }

  function mostrarMensaje(elemento, mensaje, tipo = 'info') {
    // 1. Show Toast for important feedback -> DESACTIVADO
    /*
    if (tipo === 'success' || tipo === 'error' || !elemento) {
      const toastType = tipo === 'error' ? 'error' : (tipo === 'success' ? 'success' : 'info');
      showToast(mensaje, toastType);
    }
    */

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

  function mostrarMensajeModal(mensaje, tipo = 'info') {
    // Para errores críticos en modales sin campo de estado, usamos alerta global
    if (tipo === 'error') {
      showGlobalAlert(mensaje, 'Error');
    } else {
      // Mensajes de éxito (como "Venta completada") se ignoran porque ya hay modal de éxito
      showToast(mensaje, tipo === 'error' ? 'error' : 'success');
    }
  }

  function mostrarMensajeChange(mensaje, tipo = 'info') {
    // Show toast for change errors too
    if (tipo === 'error' || tipo === 'success') {
      showToast(mensaje, tipo === 'error' ? 'error' : 'success');
    }

    if (!changeStatusP) return;
    changeStatusP.textContent = mensaje;
    if (tipo === 'success') {
      changeStatusP.className = 'text-green-600 text-sm mt-2 text-center';
    } else if (tipo === 'error') {
      changeStatusP.className = 'text-red-600 text-sm mt-2 text-center';
    } else if (tipo === 'warning') {
      changeStatusP.className = 'text-orange-600 text-sm mt-2 text-center';
    } else {
      changeStatusP.className = 'text-gray-600 text-sm mt-2 text-center';
    }
  }

  // =========================
  // CIERRE Z + RESUMEN
  // =========================

  async function reloadCierreZSummary() {
    if (!cierreZSummaryBody) return;

    cierreZSummaryBody.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-center text-gray-500">Cargando resumen de pagos...</td></tr>`;

    try {
      const sessionId = JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}').id;
      const response = await fetch(`/api/reports/summary?usuario_id=${sessionId}`);
      if (!response.ok) throw new Error('No se pudo cargar el resumen de pagos');
      const summary = await response.json();
      renderCierreZSummary(summary);
    } catch (error) {
      console.error("Error al cargar resumen Cierre Z:", error);
      cierreZSummaryBody.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-center text-red-500">${error.message}</td></tr>`;
    }
  }

  // Opcional: exposición global (por si quieres llamarlo desde fuera)
  window.reloadCierreZSummary = reloadCierreZSummary;

  // 🔹 NUEVO: cargar APERTURA DE CAJA de hoy (totales) y mostrarla en el modal
  async function loadTodayCashOpening() {
    if (!cierreZOpeningResumen) return;

    cierreZOpeningResumen.textContent = 'Cargando aperturas de caja...';

    try {
      const sessionId = JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}').id;
      const response = await fetch(`/api/reports/cash-opening/today?usuario_id=${sessionId}`);

      if (!response.ok) {
        if (response.status === 404) {
          cierreZOpeningResumen.textContent = 'No se ha registrado apertura de caja para hoy.';
          return;
        }
        throw new Error('No se pudieron cargar las aperturas de caja.');
      }

      const data = await response.json();
      const totals = data.totals || {};
      const openings = Array.isArray(data.openings) ? data.openings : [];

      const openingVes = Number(totals.total_opening_ves || 0);
      const openingUsd = Number(totals.total_opening_usd || 0);

      if (openingVes <= 0 && openingUsd <= 0) {
        cierreZOpeningResumen.textContent = 'No se ha registrado apertura de caja para hoy.';
        return;
      }

      const partes = [];
      if (openingVes > 0) partes.push(`${openingVes.toFixed(2)} Bs`);
      if (openingUsd > 0) partes.push(`${openingUsd.toFixed(2)} $`);

      const label =
        openings.length > 1 ? 'Aperturas de caja hoy' : 'Apertura de caja hoy';

      cierreZOpeningResumen.textContent = `${label}: ${partes.join(' | ')}`;
    } catch (error) {
      console.error('Error al cargar aperturas de caja:', error);
      cierreZOpeningResumen.textContent = 'Error al cargar las aperturas de caja.';
    }
  }

  async function openCierreZModal() {
    const ctx = window.parent || window;
    let hasPermission = true;

    if (typeof ctx.askForAdminPassword === 'function') {
      hasPermission = await ctx.askForAdminPassword();
    }

    if (!hasPermission) return;

    cierreZModal.classList.remove('hidden');
    await reloadCierreZSummary();
    await loadTodayCashOpening();
  }

  function renderCierreZSummary(summary) {
    cierreZSummaryBody.innerHTML = '';
    const metodos = {
      'VES_EFECTIVO': { name: 'Bolívares (Efectivo)', isUsd: false },
      'TARJETA': { name: 'Tarjeta (Bs.)', isUsd: false },
      'BIOPAGO': { name: 'Biopago (Bs.)', isUsd: false },
      'PAGOMOVIL': { name: 'Pago Móvil (Bs.)', isUsd: false },
      'USD_EFECTIVO': { name: 'Dólares (Efectivo)', isUsd: true },
      'ZELLE': { name: 'Zelle (USD)', isUsd: true }
    };

    let totalSistemaVes = 0;
    let totalSistemaUsd = 0;

    for (const [key, info] of Object.entries(metodos)) {
      const item = summary.find(s => s.metodo === key);
      const totalVes = item ? item.total_ves : 0;
      const totalUsd = item ? item.total_usd : 0;

      let sistemaDisplay, manualInput, difId;

      if (info.isUsd) {
        totalSistemaUsd += totalUsd;
        sistemaDisplay = `${totalUsd.toFixed(2)} $`;
        manualInput = `<input type="number" step="any" class="input-text w-32 text-right cierre-z-manual-usd" data-sistema="${totalUsd}">`;
        difId = `diferencia-${key}`;
      } else {
        totalSistemaVes += totalVes;
        sistemaDisplay = `${totalVes.toFixed(2)} Bs`;
        manualInput = `<input type="number" step="any" class="input-text w-32 text-right cierre-z-manual-ves" data-sistema="${totalVes}">`;
        difId = `diferencia-${key}`;
      }

      const tr = document.createElement('tr');
      tr.dataset.metodo = key;
      tr.dataset.isUsd = info.isUsd;
      tr.innerHTML = `
              <td class="px-4 py-3 text-sm font-medium text-gray-900">${info.name}</td>
              <td class="px-4 py-3 text-sm text-gray-800 text-right">${sistemaDisplay}</td>
              <td class="px-4 py-3 text-right">${manualInput}</td>
              <td class="px-4 py-3 text-sm text-right font-medium" id="${difId}">-</td>
          `;
      cierreZSummaryBody.appendChild(tr);
    }

    const trTotalVes = document.createElement('tr');
    trTotalVes.className = "bg-gray-50 font-bold";
    trTotalVes.innerHTML = `
          <td class="px-4 py-3 text-sm font-bold text-gray-900">Total (VES)</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right">${totalSistemaVes.toFixed(2)}</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-manual-ves">0.00</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-diferencia-ves">0.00</td>
      `;
    cierreZSummaryBody.appendChild(trTotalVes);

    const trTotalUsd = document.createElement('tr');
    trTotalUsd.className = "bg-gray-50 font-bold";
    trTotalUsd.innerHTML = `
          <td class="px-4 py-3 text-sm font-bold text-gray-900">Total (USD)</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right">${totalSistemaUsd.toFixed(2)}</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-manual-usd">0.00</td>
          <td class="px-4 py-3 text-sm text-gray-900 text-right" id="cierre-z-total-diferencia-usd">0.00</td>
      `;
    cierreZSummaryBody.appendChild(trTotalUsd);
  }

  function calculateCierreZDiferencia() {
    let totalManualVes = 0;
    let totalDiferenciaVes = 0;
    let totalManualUsd = 0;
    let totalDiferenciaUsd = 0;

    cierreZSummaryBody.querySelectorAll('tr[data-metodo]').forEach(tr => {
      const metodo = tr.dataset.metodo;
      const isUsd = tr.dataset.isUsd === 'true';
      const input = tr.querySelector('input');
      const sistema = parseFloat(input.dataset.sistema);
      const manual = parseFloat(input.value) || 0;
      const diferencia = manual - sistema;

      const difElement = document.getElementById(`diferencia-${metodo}`);
      difElement.textContent = diferencia.toFixed(2);

      if (diferencia < 0) {
        difElement.className = 'px-4 py-3 text-sm text-right font-medium text-red-600';
      } else if (diferencia > 0) {
        difElement.className = 'px-4 py-3 text-sm text-right font-medium text-green-600';
      } else {
        difElement.className = 'px-4 py-3 text-sm text-right font-medium text-gray-700';
      }

      if (isUsd) {
        totalManualUsd += manual;
        totalDiferenciaUsd += diferencia;
      } else {
        totalManualVes += manual;
        totalDiferenciaVes += diferencia;
      }
    });

    document.getElementById('cierre-z-total-manual-ves').textContent = totalManualVes.toFixed(2);
    document.getElementById('cierre-z-total-manual-usd').textContent = totalManualUsd.toFixed(2);

    const totalDifVesEl = document.getElementById('cierre-z-total-diferencia-ves');
    totalDifVesEl.textContent = totalDiferenciaVes.toFixed(2);
    totalDifVesEl.className = `px-4 py-3 text-sm text-right font-bold ${totalDiferenciaVes < 0 ? 'text-red-600' : (totalDiferenciaVes > 0 ? 'text-green-600' : 'text-gray-900')}`;

    const totalDifUsdEl = document.getElementById('cierre-z-total-diferencia-usd');
    totalDifUsdEl.textContent = totalDiferenciaUsd.toFixed(2);
    totalDifUsdEl.className = `px-4 py-3 text-sm text-right font-bold ${totalDiferenciaUsd < 0 ? 'text-red-600' : (totalDiferenciaUsd > 0 ? 'text-green-600' : 'text-gray-900')}`;
  }

  function closeCierreZModal() {
    cierreZModal.classList.add('hidden');
    cierreZNotas.value = '';
    cierreZStatus.textContent = '';
    if (cierreZOpeningResumen) cierreZOpeningResumen.textContent = '';
  }

  // =========================
  // RETIRO DE EFECTIVO (Cierre Z)
  // =========================

  function openWithdrawalModal() {
    if (!withdrawalModal) return;

    if (withdrawalStatus) {
      withdrawalStatus.textContent = '';
      withdrawalStatus.className = 'text-sm mt-3 text-center text-gray-600';
    }

    if (withdrawalMethod) withdrawalMethod.value = 'VES_EFECTIVO';
    if (withdrawalAmount) withdrawalAmount.value = '';
    if (withdrawalDescription) withdrawalDescription.value = '';

    withdrawalModal.classList.remove('hidden');
    if (withdrawalAmount) withdrawalAmount.focus();
  }

  function closeWithdrawalModal() {
    if (!withdrawalModal) return;
    withdrawalModal.classList.add('hidden');
  }

  async function handleWithdrawalSubmit(e) {
    e.preventDefault();

    if (!withdrawalMethod || !withdrawalAmount) return;

    const metodo = withdrawalMethod.value;
    const monto = parseFloat(withdrawalAmount.value);
    const descripcion = withdrawalDescription ? withdrawalDescription.value.trim() : '';

    if (!metodo) {
      mostrarMensaje(withdrawalStatus, 'Selecciona el método de retiro.', 'error');
      return;
    }

    if (!monto || monto <= 0) {
      mostrarMensaje(withdrawalStatus, 'El monto debe ser mayor a 0.', 'error');
      return;
    }

    try {
      mostrarMensaje(withdrawalStatus, 'Guardando retiro...', 'info');

      const response = await fetch('/api/reports/cash-withdrawal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          metodo,
          monto,
          descripcion,
          usuario_id: JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}').id || null
        })
      });

      const result = await response.json();

      if (!response.ok || result.success === false) {
        throw new Error(result.error || result.message || 'No se pudo registrar el retiro.');
      }

      mostrarMensaje(withdrawalStatus, 'Retiro registrado correctamente.', 'success');

      // Recargar el resumen del Cierre Z para que el retiro se refleje en los totales
      await reloadCierreZSummary();

      setTimeout(() => {
        closeWithdrawalModal();
        if (withdrawalStatus) withdrawalStatus.textContent = '';
      }, 700);
    } catch (error) {
      console.error('Error registrando retiro:', error);
      mostrarMensaje(withdrawalStatus, error.message || 'Error al registrar el retiro.', 'error');
    }
  }

  // =========================
  // 🔹 APERTURA DE CAJA
  // =========================

  function openCashOpeningModal() {
    if (!cashOpeningModal) return;

    if (cashOpeningStatus) {
      cashOpeningStatus.textContent = '';
      cashOpeningStatus.className = 'text-sm mt-3 text-center text-gray-600';
    }

    if (cashOpeningVesInput) cashOpeningVesInput.value = '';
    if (cashOpeningUsdInput) cashOpeningUsdInput.value = '';
    if (cashOpeningNotesInput) cashOpeningNotesInput.value = '';

    cashOpeningModal.classList.remove('hidden');
    if (cashOpeningVesInput) cashOpeningVesInput.focus();
  }

  function closeCashOpeningModal() {
    if (!cashOpeningModal) return;
    cashOpeningModal.classList.add('hidden');
  }

  async function handleCashOpeningSubmit(e) {
    e.preventDefault();

    if (!cashOpeningVesInput || !cashOpeningUsdInput) return;

    const openingVes = parseFloat(cashOpeningVesInput.value) || 0;
    const openingUsd = parseFloat(cashOpeningUsdInput.value) || 0;
    const notes = cashOpeningNotesInput ? cashOpeningNotesInput.value.trim() : '';

    if (openingVes <= 0 && openingUsd <= 0) {
      mostrarMensaje(
        cashOpeningStatus,
        'Ingresa al menos un monto distinto de 0.',
        'error'
      );
      return;
    }

    try {
      mostrarMensaje(cashOpeningStatus, 'Guardando apertura de caja...', 'info');

      const response = await fetch('/api/reports/cash-opening', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          opening_ves: openingVes,
          opening_usd: openingUsd,
          notes,
          usuario_id: JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}').id || null
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        let msg = result.error || result.message || 'No se pudo registrar la apertura.';
        if (result.details) msg += ` Detalle: ${result.details}`;
        throw new Error(msg);
      }

      mostrarMensaje(
        cashOpeningStatus,
        'Apertura de caja registrada correctamente.',
        'success'
      );

      // Actualizar texto en Cierre Z
      await loadTodayCashOpening();
      closeCashOpeningModal();
    } catch (error) {
      console.error('Error registrando apertura de caja:', error);
      mostrarMensaje(
        cashOpeningStatus,
        error.message || 'Error al registrar la apertura de caja.',
        'error'
      );
    }
  }

  async function handleImprimirCierreZ() {
    mostrarMensaje(cierreZStatus, 'Verificando...', 'info');

    const ctx = window.parent || window;
    let hasPermission = true;

    if (typeof ctx.askForAdminPassword === 'function') {
      hasPermission = await ctx.askForAdminPassword();
    }

    if (!hasPermission) {
      mostrarMensaje(cierreZStatus, 'Verificación fallida.', 'error');
      return;
    }

    mostrarMensaje(cierreZStatus, 'Generando PDF...', 'info');

    const summaryData = [];
    const totals = {};

    cierreZSummaryBody.querySelectorAll('tr[data-metodo]').forEach(tr => {
      const input = tr.querySelector('input');
      const metodo = tr.dataset.metodo;
      const difElement = document.getElementById(`diferencia-${metodo}`);

      const sistemaRaw = tr.querySelector('td:nth-child(2)').textContent || '';
      const sistemaNum = parseFloat(sistemaRaw) || 0;
      const manualNum = input ? (parseFloat(input.value) || 0) : 0;
      const diffNum = manualNum - sistemaNum;

      summaryData.push({
        metodo: tr.querySelector('td:first-child').textContent,
        sistema: sistemaNum.toFixed(2),
        manual: manualNum.toFixed(2),
        diferencia: diffNum.toFixed(2)
      });

      if (difElement) {
        difElement.textContent = diffNum.toFixed(2);
      }
    });

    // Recalcular totales numéricos
    calculateCierreZDiferencia();

    totals.sistemaVes = parseFloat(
      document.getElementById('cierre-z-total-manual-ves').previousElementSibling.textContent
    ) || 0;
    totals.manualVes = parseFloat(
      document.getElementById('cierre-z-total-manual-ves').textContent
    ) || 0;
    totals.diferenciaVes = parseFloat(
      document.getElementById('cierre-z-total-diferencia-ves').textContent
    ) || 0;

    totals.sistemaUsd = parseFloat(
      document.getElementById('cierre-z-total-manual-usd').previousElementSibling.textContent
    ) || 0;
    totals.manualUsd = parseFloat(
      document.getElementById('cierre-z-total-manual-usd').textContent
    ) || 0;
    totals.diferenciaUsd = parseFloat(
      document.getElementById('cierre-z-total-diferencia-usd').textContent
    ) || 0;

    // Texto de apertura de caja (si existe en el DOM)
    let aperturaTexto = '';
    if (cierreZOpeningResumen && cierreZOpeningResumen.textContent) {
      aperturaTexto = cierreZOpeningResumen.textContent;
    }

    try {
      const body = {
        summaryData: summaryData,
        totals: totals,
        notes: cierreZNotas.value || '',
        cashOpeningText: aperturaTexto,
        usuario_id: JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}').id || null
      };

      const response = await fetch('/api/reports/print-cierre-z', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Error al generar el PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `cierre-z-${formatLocalDate(new Date())}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      mostrarMensaje(cierreZStatus, 'Reporte generado.', 'success');
      setTimeout(closeCierreZModal, 1000);

    } catch (error) {
      console.error('Error al imprimir Cierre Z:', error);
      mostrarMensaje(cierreZStatus, error.message, 'error');
    }
  }

  function showSaleCompleteModal(saleId, options = {}) {
    const { totalChangeDueVes = 0 } = options;

    if (saleCompleteMessage) {
      saleCompleteMessage.innerHTML = `Venta #${saleId} completada con éxito.<br>Vuelto: <span class="font-bold text-green-600">${totalChangeDueVes.toFixed(2)} Bs</span>`;
    }

    if (saleCompleteModal) {
      saleCompleteModal.classList.remove('hidden');
    }

    // NUEVO: Manejar envío por WhatsApp desde el modal de éxito
    const btnWhatsappComplete = parentDoc.getElementById('btn-whatsapp-sale-complete');
    if (btnWhatsappComplete) {
      // Limpiar listeners previos
      const newBtn = btnWhatsappComplete.cloneNode(true);
      btnWhatsappComplete.parentNode.replaceChild(newBtn, btnWhatsappComplete);

      // Llamar al helper global de WhatsApp definido en layout.js
      newBtn.addEventListener('click', () => {
        const phone = selectedClientObject ? selectedClientObject.telefono : null;
        if (window.sendWhatsAppWithPdf) {
          window.sendWhatsAppWithPdf(saleId, phone);
        } else {
          console.warn('sendWhatsAppWithPdf no está disponible');
        }
      });
    }

    if (btnCloseSaleComplete) {
      btnCloseSaleComplete.onclick = () => {
        saleCompleteModal.classList.add('hidden');
      };
    }
  }

  // =========================
  // CLIENTES (POS)
  // =========================

  async function searchClients(searchTerm) {
    if (searchTerm.length < 2) {
      clientSearchResultsDiv.innerHTML = '';
      return;
    }
    try {
      const response = await fetch(`/api/clients?search=${encodeURIComponent(searchTerm)}`);
      if (!response.ok) throw new Error('Error buscando clientes');
      currentClients = await response.json();
      renderClientSearchResults();
    } catch (error) {
      console.error(error);
      clientSearchResultsDiv.innerHTML = '<div class="absolute w-full bg-white border border-gray-300 rounded-md shadow-lg z-10 p-2 text-red-500">Error al buscar</div>';
    }
  }

  function renderClientSearchResults() {
    clientSearchResultsDiv.innerHTML = '';
    if (currentClients.length === 0) {
      clientSearchResultsDiv.innerHTML = '<div class="absolute w-full bg-white border border-gray-300 rounded-md shadow-lg z-10 p-2 text-gray-500">No se encontraron clientes.</div>';
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'absolute w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto z-10';
    currentClients.forEach(client => {
      const li = document.createElement('li');
      li.className = 'p-2 hover:bg-blue-100 cursor-pointer';
      li.textContent = `${client.nombre} (${client.cedula || 'N/A'})`;
      li.dataset.clientId = client.id;
      li.dataset.clientName = client.nombre;
      li.addEventListener('click', () => selectClient(client));
      ul.appendChild(li);
    });
    clientSearchResultsDiv.appendChild(ul);
  }

  function selectClient(client) {
    selectedClientObject = client;
    selectedClientIdInput.value = client.id;
    selectedClientNameSpan.textContent = client.nombre;

    // Mostrar deuda si tiene
    // En las versiones más recientes de la API, la deuda viene en deusa_total_usd y deuda_total_ves
    const deudaUsd = parseFloat(client.deuda_total_usd || client.deuda || 0);

    if (deudaUsd > 0.005) {
      // Ajuste dinámico: Calculamos el monto en Bs a la tasa actual cargada en el POS
      const bcv = parseFloat(currentRates.BCV) || 1;
      const deudaVes = deudaUsd * bcv;

      selectedClientBalanceSpan.textContent = `${deudaUsd.toFixed(2)} $ (${deudaVes.toFixed(2)} Bs)`;
      selectedClientBalanceContainer.classList.remove('hidden');
    } else {
      selectedClientBalanceContainer.classList.add('hidden');
    }
    selectedClientDiv.classList.remove('hidden');
    clientSearchInput.classList.add('hidden');
    clientSearchResultsDiv.innerHTML = '';
    currentClients = [];
    updatePaymentSummary();
  }

  function resetClientSearch() {
    selectedClientObject = null;
    selectedClientIdInput.value = '';
    selectedClientNameSpan.textContent = 'Seleccionar cliente';
    selectedClientBalanceContainer.classList.add('hidden');
    selectedClientDiv.classList.add('hidden');
    clientSearchInput.classList.remove('hidden');
    clientSearchInput.value = '';
    clientSearchResultsDiv.innerHTML = '';
    currentClients = [];
    updatePaymentSummary();
  }

  function openClientModalPOS() {
    clientForm.reset();
    clientIdInput.value = '';
    clientModalTitle.textContent = 'Añadir Nuevo Cliente (POS)';
    clientModalStatus.textContent = '';
    clientModal.classList.remove('hidden');
  }

  function closeClientModalPOS() {
    clientModal.classList.add('hidden');
    clientForm.reset();
    clientModalStatus.textContent = '';
  }

  async function handleClientSubmitPOS(e) {
    e.preventDefault();
    const data = {
      nombre: clientNombreInput.value,
      cedula: clientCedulaInput.value,
      telefono: clientTelefonoInput.value,
      direccion: clientDireccionInput.value,
    };

    if (!data.nombre) {
      mostrarMensaje(clientModalStatus, 'El nombre es obligatorio.', 'error');
      return;
    }

    mostrarMensaje(clientModalStatus, 'Guardando cliente...', 'info');

    try {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(clientModalStatus, '¡Cliente creado!', 'success');
      setTimeout(() => {
        closeClientModalPOS();
        selectClient({ id: result.id, nombre: data.nombre, cedula: data.cedula });
      }, 1000);
    } catch (error) {
      console.error('Error guardando cliente:', error);
      mostrarMensaje(clientModalStatus, error.message, 'error');
    }
  }

  // =========================
  // MODAL GESTIÓN DE CLIENTES (EDITAR / ELIMINAR)
  // =========================

  function openClientManageModal() {
    if (!clientManageModal) return;
    clientManageModal.classList.remove('hidden');
    clientManageStatus.textContent = '';
    manageClientSearchInput.value = '';
    manageClientResultsList.innerHTML = '';
    manageClientIdInput.value = '';
    manageClientNombreInput.value = '';
    manageClientCedulaInput.value = '';
    manageClientTelefonoInput.value = '';
    manageClientDireccionInput.value = '';
    if (manageClientSearchInput) {
      manageClientSearchInput.focus();
    }
  }

  function closeClientManageModal() {
    if (!clientManageModal) return;
    clientManageModal.classList.add('hidden');
  }

  async function searchClientsForManage(term) {
    if (term.length < 2) {
      manageClientResultsList.innerHTML = '';
      return;
    }
    try {
      const response = await fetch(`/api/clients?search=${encodeURIComponent(term)}`);
      if (!response.ok) throw new Error('Error buscando clientes');
      currentManageClients = await response.json();
      renderManageClientResults();
    } catch (error) {
      console.error('Error buscando clientes (gestión):', error);
      manageClientResultsList.innerHTML = `
        <li class="p-2 text-red-600 text-sm">Error al buscar clientes.</li>
      `;
    }
  }

  function renderManageClientResults() {
    manageClientResultsList.innerHTML = '';
    if (!currentManageClients || currentManageClients.length === 0) {
      manageClientResultsList.innerHTML = `
        <li class="p-2 text-gray-500 text-sm">No se encontraron clientes.</li>
      `;
      return;
    }

    currentManageClients.forEach(client => {
      const li = document.createElement('li');
      li.className = 'p-2 hover:bg-blue-50 cursor-pointer text-sm';
      li.textContent = `${client.nombre} (${client.cedula || 'N/A'})`;
      li.addEventListener('click', () => selectManageClient(client));
      manageClientResultsList.appendChild(li);
    });
  }

  function selectManageClient(client) {
    manageClientIdInput.value = client.id;
    manageClientNombreInput.value = client.nombre || '';
    manageClientCedulaInput.value = client.cedula || '';
    manageClientTelefonoInput.value = client.telefono || '';
    manageClientDireccionInput.value = client.direccion || '';
    mostrarMensaje(clientManageStatus, 'Cliente cargado. Modifica y guarda o elimina.', 'info');
  }

  async function handleManageClientSubmit(e) {
    e.preventDefault();
    const id = manageClientIdInput.value;
    if (!id) {
      mostrarMensaje(clientManageStatus, 'Primero selecciona un cliente de la lista.', 'error');
      return;
    }

    const data = {
      nombre: manageClientNombreInput.value,
      cedula: manageClientCedulaInput.value,
      telefono: manageClientTelefonoInput.value,
      direccion: manageClientDireccionInput.value,
    };

    if (!data.nombre) {
      mostrarMensaje(clientManageStatus, 'El nombre es obligatorio.', 'error');
      return;
    }

    mostrarMensaje(clientManageStatus, 'Guardando cambios...', 'info');

    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error al actualizar cliente');

      mostrarMensaje(clientManageStatus, 'Cambios guardados.', 'success');

      if (manageClientSearchInput.value.trim().length >= 2) {
        searchClientsForManage(manageClientSearchInput.value.trim());
      }
    } catch (error) {
      console.error('Error actualizando cliente:', error);
      mostrarMensaje(clientManageStatus, error.message, 'error');
    }
  }

  async function handleDeleteClient() {
    const id = manageClientIdInput.value;
    if (!id) {
      mostrarMensaje(clientManageStatus, 'Selecciona un cliente primero.', 'error');
      return;
    }

    const confirmed = await showGlobalConfirm(
      '¿Seguro que deseas eliminar este cliente? Esta acción no se puede deshacer.',
      'Eliminar Cliente'
    );
    if (!confirmed) return;

    mostrarMensaje(clientManageStatus, 'Eliminando cliente...', 'info');

    try {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'DELETE'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Error al eliminar cliente');

      mostrarMensaje(clientManageStatus, 'Cliente eliminado.', 'success');

      manageClientIdInput.value = '';
      manageClientNombreInput.value = '';
      manageClientCedulaInput.value = '';
      manageClientTelefonoInput.value = '';
      manageClientDireccionInput.value = '';

      if (manageClientSearchInput.value.trim().length >= 2) {
        searchClientsForManage(manageClientSearchInput.value.trim());
      } else {
        manageClientResultsList.innerHTML = '';
      }
    } catch (error) {
      console.error('Error eliminando cliente:', error);
      mostrarMensaje(clientManageStatus, error.message, 'error');
    }
  }

  // =========================
  // RECIBIR VENTA DESDE REPORTES (REABRIR EN POS)
  // =========================

  async function applySalePayloadToCart(payload) {
    console.log('[POS] Aplicando venta recibida desde reports:', payload);

    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      console.warn('[POS] Payload sin items válidos:', payload);
      return;
    }

    // 0) Asegurar que tenemos BCV válida
    if (
      !currentRates ||
      isNaN(parseFloat(currentRates.BCV)) ||
      parseFloat(currentRates.BCV) <= 0
    ) {
      console.warn('[POS] BCV vacía/incorrecta al reabrir venta. Recargando tasas...');
      try {
        await loadRates();
      } catch (e) {
        console.error('[POS] Error recargando tasas en applySalePayloadToCart:', e);
      }
    }

    const bcv = parseFloat(currentRates.BCV);
    if (!bcv || bcv <= 0) {
      console.error('[POS] BCV sigue siendo inválida. Usando 1 para evitar NaN.');
    }
    const safeBcv = bcv && bcv > 0 ? bcv : 1;

    // 1) Limpiar carrito y cliente actuales
    resetPOSState(false);   // vacía carrito pero NO recarga listado de productos
    resetClientSearch();    // limpia cliente seleccionado

    // 2) Cargar cliente si viene en el payload
    if (payload.clienteId) {
      try {
        selectClient({
          id: payload.clienteId,
          nombre: payload.clienteNombre || 'Cliente'
        });
      } catch (e) {
        // Fallback por si el código de selectClient cambia
        selectedClientIdInput.value = payload.clienteId;
        selectedClientNameSpan.textContent = payload.clienteNombre || 'Cliente';
        selectedClientDiv.classList.remove('hidden');
        clientSearchInput.classList.add('hidden');
      }
    } else if (payload.clienteNombre) {
      // Solo nombre manual
      selectedClientIdInput.value = '';
      selectedClientNameSpan.textContent = payload.clienteNombre;
      selectedClientDiv.classList.remove('hidden');
      clientSearchInput.classList.add('hidden');
    }

    // 3) Cargar items en el carrito
    payload.items.forEach((it) => {
      if (!it) return;

      const qty = Number(it.quantity || it.cantidad || 0);
      if (!qty || qty <= 0) return;

      // Precio unitario en Bs de la venta original
      const priceVes = Number(
        it.priceVes ??
        it.precio_unitario_ves ??
        it.precio_ves ??
        0
      ) || 0;

      // Convertir a USD con la BCV actual
      const priceUsd = Number((priceVes / safeBcv).toFixed(2));

      cart.push({
        lineId: generateCartItemId(),
        id: it.productId || it.id,
        name: it.name || it.producto_nombre || `Prod ${it.productId || it.id || ''}`,
        quantity: qty,
        priceVes,
        priceUsd,
        stock: Infinity,          // aquí no validamos stock, solo rearmamos la factura
        baseStock: Infinity,
        tipo_venta: it.tipo_venta || 'UNIDAD',
        presentationId: it.presentationId || null,
        unidadesBase: it.unidadesBase || 1
      });
    });

    renderCart();
    saveCartToLocalStorage();

    if (searchInputPOS) {
      searchInputPOS.focus();
    }

    showGlobalAlert(
      'Los productos de la venta anulada se han cargado en el POS.\nRevisa cantidades y precios antes de completar la nueva venta.',
      'Venta reabierta en POS'
    );
  }

  // Exponer global para que el iframe padre pueda llamarla
  window.applySalePayloadToCart = applySalePayloadToCart;

  // =========================
  // INICIALIZACIÓN
  // =========================

  async function initializePOS() {
    await loadRates();

    posReady = true;
    loadCartFromLocalStorage();
    window.addEventListener('beforeunload', saveCartToLocalStorage);

    renderCart();
    renderSearchResults();

    if (formPrice) {
      formPrice.addEventListener('submit', handlePriceModalSubmit);
    }
    if (btnCancelarPrecio) {
      btnCancelarPrecio.addEventListener('click', closePriceModal);
    }
    if (priceModal) {
      priceModal.addEventListener('click', (e) => {
        if (e.target === priceModal) {
          closePriceModal();
        }
      });
    }

    // Conversión dinámica dentro del modal de precio
    if (priceModalCurrencySelect && priceModalInput) {
      priceModalCurrencySelect.addEventListener('change', () => {
        const newCurrency = priceModalCurrencySelect.value;
        const currentValue = parseFloat(priceModalInput.value);

        if (!isNaN(currentValue)) {
          const converted = convertPrice(currentValue, priceModalCurrentCurrency, newCurrency);
          priceModalInput.value = converted.toFixed(2);
        }

        priceModalCurrentCurrency = newCurrency;
      });

      priceModalInput.addEventListener('input', () => {
        priceModalCurrentCurrency = priceModalCurrencySelect.value;
      });
    }

    if (searchInputPOS) {
      searchInputPOS.addEventListener('input', handlePosSearchInput);
      searchInputPOS.addEventListener('keydown', handlePosSearchKeydown);
    }

    if (btnCancelarVenta) {
      btnCancelarVenta.addEventListener('click', () => { cancelSale(); });
    }
    if (btnPagar) {
      btnPagar.addEventListener('click', () => { openPaymentModal(); });
    }
    if (btnPresupuesto) {
      btnPresupuesto.addEventListener('click', () => { generateBudget(); });
    }
    if (btnCancelarPago) {
      btnCancelarPago.addEventListener('click', closePaymentModal);
    }
    if (btnDailyClose) {
      btnDailyClose.addEventListener('click', openCierreZModal);
    }

    // Discount modal events
    if (btnEditDiscount) {
      btnEditDiscount.addEventListener('click', () => {
        discountInput.value = discountPercent;
        discountModal.classList.remove('hidden');
        discountInput.focus();
        discountInput.select();
      });
    }
    if (btnCloseDiscountModal) {
      btnCloseDiscountModal.addEventListener('click', () => { discountModal.classList.add('hidden'); });
    }
    if (btnCancelDiscount) {
      btnCancelDiscount.addEventListener('click', () => { discountModal.classList.add('hidden'); });
    }
    if (discountModal) {
      discountModal.addEventListener('click', (e) => {
        if (e.target === discountModal) discountModal.classList.add('hidden');
      });
    }
    if (btnSaveDiscount) {
      btnSaveDiscount.addEventListener('click', () => {
        let val = parseFloat(discountInput.value) || 0;
        if (val < 0) val = 0;
        if (val > 100) val = 100;
        discountPercent = val;
        discountModal.classList.add('hidden');
        renderCart();
      });
    }
    if (discountCheck) {
      discountCheck.addEventListener('change', () => {
        if (!discountCheck.checked) {
          discountPercent = 0;
          renderCart();
        } else if (discountPercent === 0) {
          discountModal.classList.remove('hidden');
          discountInput.focus();
          discountInput.select();
        }
      });
    }



    if (pagoVesEfectivoInput) pagoVesEfectivoInput.addEventListener('input', updatePaymentSummary);
    if (pagoUsdEfectivoInput) pagoUsdEfectivoInput.addEventListener('input', updatePaymentSummary);
    if (pagoTarjetaInput) pagoTarjetaInput.addEventListener('input', updatePaymentSummary);
    if (pagoBiopagoInput) pagoBiopagoInput.addEventListener('input', updatePaymentSummary);
    if (pagoPagomovilInput) pagoPagomovilInput.addEventListener('input', updatePaymentSummary);
    if (pagoZelleInput) pagoZelleInput.addEventListener('input', updatePaymentSummary);

    if (btnCompletarVenta) {
      btnCompletarVenta.addEventListener('click', () => completeSale(false));
    }
    if (btnGuardarFiado) {
      btnGuardarFiado.addEventListener('click', () => completeSale(true));
    }
    if (formPago) {
      formPago.addEventListener('submit', (e) => e.preventDefault());
    }

    changeInputs.forEach(input => {
      input.addEventListener('input', updateChangeSummary);
    });
    if (btnConfirmarVuelto) {
      btnConfirmarVuelto.addEventListener('click', confirmChangeAndClose);
    }
    if (formChange) {
      formChange.addEventListener('submit', (e) => e.preventDefault());
    }

    if (formQuantity) {
      formQuantity.addEventListener('submit', handleQuantitySubmit);
    }
    if (btnCancelarCantidad) {
      btnCancelarCantidad.addEventListener('click', closeQuantityModal);
    }

    if (clientSearchInput) {
      clientSearchInput.addEventListener('input', () => {
        clearTimeout(currentClientSearchTimeout);
        currentClientSearchTimeout = setTimeout(() => {
          searchClients(clientSearchInput.value);
        }, 300);
      });
    }
    if (btnRemoveSelectedClient) {
      btnRemoveSelectedClient.addEventListener('click', resetClientSearch);
    }

    if (btnAddNewClientPOS) {
      btnAddNewClientPOS.addEventListener('click', openClientModalPOS);
    }
    
    // =========================
    // BOTÓN REIMPRIMIR FACTURAS DEL DÍA
    // =========================
    if (btnReprintLastSale) {
      btnReprintLastSale.addEventListener('click', openReprintModal);
    }

    if (clientForm) {
      clientForm.addEventListener('submit', handleClientSubmitPOS);
    }
    if (btnCancelClient) {
      btnCancelClient.addEventListener('click', closeClientModalPOS);
    }

    if (btnPagoTodoVes) btnPagoTodoVes.addEventListener('click', handlePagoTodoVes);
    if (btnPagoTodoUsd) btnPagoTodoUsd.addEventListener('click', handlePagoTodoUsd);
    if (btnPagoTodoTarjeta) btnPagoTodoTarjeta.addEventListener('click', handlePagoTodoTarjeta);
    if (btnPagoTodoBiopago) btnPagoTodoBiopago.addEventListener('click', handlePagoTodoBiopago);
    if (btnPagoTodoPagomovil) btnPagoTodoPagomovil.addEventListener('click', handlePagoTodoPagomovil);
    if (btnPagoTodoZelle) btnPagoTodoZelle.addEventListener('click', handlePagoTodoZelle);

    if (btnChangeTodoUsd) btnChangeTodoUsd.addEventListener('click', handleChangeTodoUsd);
    if (btnChangeTodoVes) btnChangeTodoVes.addEventListener('click', handleChangeTodoVes);
    if (btnChangeTodoPm) btnChangeTodoPm.addEventListener('click', handleChangeTodoPm);

    // Gestionar clientes desde POS con contraseña de admin
    if (btnManageClientsPOS) {
      btnManageClientsPOS.addEventListener('click', async () => {
        const ctx = window.parent || window;
        let hasPermission = true;

        if (typeof ctx.askForAdminPassword === 'function') {
          hasPermission = await ctx.askForAdminPassword();
        }

        if (!hasPermission) return;

        openClientManageModal();
      });
    }
    if (btnCloseClientManage) {
      btnCloseClientManage.addEventListener('click', closeClientManageModal);
    }
    if (btnCancelClientManage) {
      btnCancelClientManage.addEventListener('click', closeClientManageModal);
    }
    if (manageClientSearchInput) {
      manageClientSearchInput.addEventListener('input', () => {
        clearTimeout(manageClientSearchTimeout);
        manageClientSearchTimeout = setTimeout(() => {
          searchClientsForManage(manageClientSearchInput.value.trim());
        }, 300);
      });
    }
    if (clientManageForm) {
      clientManageForm.addEventListener('submit', handleManageClientSubmit);
    }
    if (btnUpdateClient) {
      btnUpdateClient.addEventListener('click', (e) => handleManageClientSubmit(e));
    }
    if (btnDeleteClient) {
      btnDeleteClient.addEventListener('click', handleDeleteClient);
    }

    if (btnCloseCierreZ) {
      btnCloseCierreZ.addEventListener('click', closeCierreZModal);
    }
    if (btnCloseCierreZ2) {
      btnCloseCierreZ2.addEventListener('click', closeCierreZModal);
    }
    if (btnImprimirCierreZ) {
      btnImprimirCierreZ.addEventListener('click', handleImprimirCierreZ);
    }
    if (cierreZSummaryBody) {
      cierreZSummaryBody.addEventListener('input', calculateCierreZDiferencia);
    }

    // Eventos para Retiro de efectivo
    if (btnOpenWithdrawalModal) {
      btnOpenWithdrawalModal.addEventListener('click', async () => {
        const ctx = window.parent || window;
        let hasPermission = true;

        if (typeof ctx.askForAdminPassword === 'function') {
          hasPermission = await ctx.askForAdminPassword();
        }

        if (!hasPermission) return;

        openWithdrawalModal();
      });
    }
    if (btnCloseWithdrawalModal) {
      btnCloseWithdrawalModal.addEventListener('click', closeWithdrawalModal);
    }
    if (btnCancelWithdrawal) {
      btnCancelWithdrawal.addEventListener('click', closeWithdrawalModal);
    }
    if (withdrawalModal) {
      withdrawalModal.addEventListener('click', (e) => {
        if (e.target === withdrawalModal) {
          closeWithdrawalModal();
        }
      });
    }
    if (withdrawalForm) {
      withdrawalForm.addEventListener('submit', handleWithdrawalSubmit);
    }

    // 🔹 Eventos para APERTURA DE CAJA
    if (btnOpenCashOpeningModal) {
      btnOpenCashOpeningModal.addEventListener('click', async () => {
        const ctx = window.parent || window;
        let hasPermission = true;

        if (typeof ctx.askForAdminPassword === 'function') {
          hasPermission = await ctx.askForAdminPassword();
        }

        if (!hasPermission) return;

        openCashOpeningModal();
      });
    }
    if (btnCloseCashOpeningModal) {
      btnCloseCashOpeningModal.addEventListener('click', closeCashOpeningModal);
    }
    if (btnCancelCashOpening) {
      btnCancelCashOpening.addEventListener('click', closeCashOpeningModal);
    }
    if (cashOpeningModal) {
      cashOpeningModal.addEventListener('click', (e) => {
        if (e.target === cashOpeningModal) {
          closeCashOpeningModal();
        }
      });
    }
    if (formCashOpening) {
      formCashOpening.addEventListener('submit', handleCashOpeningSubmit);
    }

    // Eventos venta completada ya se manejan en showSaleCompleteModal

    // Eventos para ventas en espera
    if (btnHoldSale) {
      btnHoldSale.addEventListener('click', () => { putSaleOnHold(); });
    }
    if (btnOpenHeldSales) {
      btnOpenHeldSales.addEventListener('click', openHeldSalesModal);
    }
    if (btnCloseHoldSales) {
      btnCloseHoldSales.addEventListener('click', closeHeldSalesModal);
    }
    if (holdSalesList) {
      holdSalesList.addEventListener('click', handleHoldSalesListClick);
    }

    // Eventos para modal de nombre de venta en espera
    if (btnConfirmHoldSaleClient) {
      btnConfirmHoldSaleClient.addEventListener('click', handleConfirmHoldSaleClient);
    }
    if (btnCancelHoldSaleClient) {
      btnCancelHoldSaleClient.addEventListener('click', handleCancelHoldSaleClient);
    }
    if (holdSaleClientModal) {
      holdSaleClientModal.addEventListener('click', (e) => {
        if (e.target === holdSaleClientModal) {
          handleCancelHoldSaleClient();
        }
      });
    }
  }

  // === Al abrir POS, revisar si hay una venta pendiente enviada desde Reportes ===
  try {
    const parentCtx = window.parent || window;
    const pending = parentCtx.__POS_PENDING_SALE__;
    if (pending && Array.isArray(pending.items) && pending.items.length > 0) {
      // Limpiamos la variable en el padre y aplicamos aquí
      parentCtx.__POS_PENDING_SALE__ = null;
      applySalePayloadToCart(pending);
    }
  } catch (e) {
    console.warn('[POS] No se pudo leer venta pendiente desde el padre:', e);
  }




  initializePOS();

  // Auto-refresh rates every 60 seconds to keep sync with server auto-updater
  setInterval(() => {
    loadRates();
  }, 60000);

  // Manual refresh via Rate Card
  const bcvDisplayBtn = document.getElementById('pos-bcv-display');
  if (bcvDisplayBtn) {
    bcvDisplayBtn.style.cursor = 'pointer';
    bcvDisplayBtn.title = 'Click para actualizar tasa';
    bcvDisplayBtn.addEventListener('click', () => {
      loadRates().then(() => {
        // Visual feedback
        const originalBg = bcvDisplayBtn.className;
        bcvDisplayBtn.classList.remove('bg-blue-50', 'text-blue-700');
        bcvDisplayBtn.classList.add('bg-green-100', 'text-green-800');
        setTimeout(() => {
          bcvDisplayBtn.classList.remove('bg-green-100', 'text-green-800');
          bcvDisplayBtn.classList.add('bg-blue-50', 'text-blue-700');
        }, 500);
      });
    });
  } // Cierre del if (bcvDisplayBtn)

  // =========================
  // MODAL AVANCE / CANJE DE EFECTIVO
  // =========================
  const advanceModal = document.getElementById('advance-modal');
  const btnOpenAdvanceModal = document.getElementById('btn-open-advance-modal');
  const btnCloseAdvanceModal = document.getElementById('btn-close-advance-modal');
  const btnCancelAdvance = document.getElementById('btn-cancel-advance');
  const formAdvance = document.getElementById('form-advance');

  const advanceAmountOut = document.getElementById('advance-amount-out');
  const advanceFeePercent = document.getElementById('advance-fee-percent');
  const advanceFeeAmount = document.getElementById('advance-fee-amount');
  const advanceTotalInDisplay = document.getElementById('advance-total-in-display');
  const advanceTotalInInput = document.getElementById('advance-total-in');
  const advanceMethodIn = document.getElementById('advance-method-in');
  const advanceDescription = document.getElementById('advance-description');
  const advanceStatus = document.getElementById('advance-status');

  function updateAdvanceCalculations() {
    if (!advanceAmountOut || !advanceFeePercent) return;

    const amount = parseFloat(advanceAmountOut.value) || 0;
    const percent = parseFloat(advanceFeePercent.value) || 0;

    // Fee = Amount * (percent / 100)
    const fee = amount * (percent / 100);
    const total = amount + fee;

    if (advanceFeeAmount) advanceFeeAmount.value = fee.toFixed(2);
    if (advanceTotalInDisplay) advanceTotalInDisplay.textContent = total.toFixed(2) + ' Bs';
    if (advanceTotalInInput) advanceTotalInInput.value = total.toFixed(2);
  }

  if (advanceAmountOut) advanceAmountOut.addEventListener('input', updateAdvanceCalculations);
  if (advanceFeePercent) advanceFeePercent.addEventListener('input', updateAdvanceCalculations);

  function openAdvanceModal() {
    if (cierreZModal) cierreZModal.classList.add('hidden'); // Close parent modal if open

    if (advanceModal) {
      advanceModal.classList.remove('hidden');
      if (formAdvance) formAdvance.reset();

      if (advanceTotalInDisplay) advanceTotalInDisplay.textContent = '0.00 Bs';
      if (advanceStatus) advanceStatus.textContent = '';

      // Default fee suggestion (e.g. 10%)
      if (advanceFeePercent) advanceFeePercent.value = 10;
      if (advanceAmountOut) advanceAmountOut.focus();
    }
  }

  if (btnOpenAdvanceModal) btnOpenAdvanceModal.addEventListener('click', openAdvanceModal);

  function closeAdvanceModal() {
    if (advanceModal) advanceModal.classList.add('hidden');
    // Re-open Cierre Z modal if appropriate? Usually better to stay in context or go back to main
    // But if we opened from Cierre Z, maybe we want to go back there?
    // Let's just close for now.
    if (cierreZModal) cierreZModal.classList.remove('hidden');
  }

  if (btnCloseAdvanceModal) btnCloseAdvanceModal.addEventListener('click', closeAdvanceModal);
  if (btnCancelAdvance) btnCancelAdvance.addEventListener('click', closeAdvanceModal);

  if (formAdvance) {
    formAdvance.addEventListener('submit', async (e) => {
      e.preventDefault();

      const amountOut = parseFloat(advanceAmountOut.value);
      const feeAmount = parseFloat(advanceFeeAmount.value);
      const method = advanceMethodIn.value;
      const reference = document.getElementById('advance-reference')?.value || null;
      const desc = advanceDescription.value;

      if (!amountOut || amountOut <= 0) {
        if (advanceStatus) {
          advanceStatus.textContent = 'El monto a entregar debe ser mayor a 0.';
          advanceStatus.className = 'text-xs text-red-600';
        }
        return;
      }

      if (advanceStatus) {
        advanceStatus.textContent = 'Procesando...';
        advanceStatus.className = 'text-xs text-blue-600';
      }

      try {
        const res = await fetch('/api/reports/cash-advance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount_out: amountOut,
            fee_amount: feeAmount,
            method_in: method,
            description: desc,
            reference: reference
          })
        });

        const data = await res.json();

        if (data.error) {
          if (advanceStatus) {
            advanceStatus.textContent = data.error;
            advanceStatus.className = 'text-xs text-red-600';
          }
        } else {
          await showGlobalAlert(`Avance de efectivo registrado con éxito. Venta #${data.saleId}`);
          closeAdvanceModal();
        }
      } catch (err) {
        console.error(err);
        if (advanceStatus) {
          advanceStatus.textContent = 'Error de conexión con el servidor.';
          advanceStatus.className = 'text-xs text-red-600';
        }
      }
    });
  } // ends if formAdvance
  // =========================
  // CÁMARA ESCÁNER (POS)
  // =========================
  const btnScanCameraPos = document.getElementById('btn-scan-camera-pos');
  const readerPos = document.getElementById('reader-pos');
  let html5QrCodePos = null;
  let isScanningPos = false;

  async function stopCameraPos() {
    if (html5QrCodePos) {
      try {
        await html5QrCodePos.stop();
        await html5QrCodePos.clear();
      } catch (e) {
        console.warn("Error deteniendo cámara POS:", e);
      }
      html5QrCodePos = null;
    }
    isScanningPos = false;
    if (readerPos) readerPos.classList.add('hidden');
    if (btnScanCameraPos) {
      btnScanCameraPos.classList.replace('bg-red-100', 'bg-purple-100');
      btnScanCameraPos.classList.replace('text-red-700', 'text-purple-700');
    }
  }

  async function startCameraPos() {
    try {
      isScanningPos = true;
      if (readerPos) readerPos.classList.remove('hidden');
      if (btnScanCameraPos) {
        btnScanCameraPos.classList.replace('bg-purple-100', 'bg-red-100');
        btnScanCameraPos.classList.replace('text-purple-700', 'text-red-700');
      }

      html5QrCodePos = new Html5Qrcode("reader-pos");
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      await html5QrCodePos.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          console.log("POS Camera Scanned:", decodedText);
          searchInputPOS.value = decodedText;
          await handleBarcodeScan(decodedText);
          await stopCameraPos();
        },
        (errorMessage) => { }
      );
    } catch (err) {
      console.error("Error al iniciar cámara POS:", err);

      let errorMsg = "No se pudo acceder a la cámara o el dispositivo no tiene soporte.";

      // Detectar específicamente contexto no seguro (HTTP en móvil)
      if (!window.isSecureContext) {
        errorMsg = "ACCESO BLOQUEADO POR NAVEGADOR: Los navegadores bloquean la cámara en conexiones HTTP (no seguras).\n\n" +
          "SOLUCIÓN:\n" +
          "1. En su móvil, abra Chrome y escriba: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n" +
          "2. Escriba la dirección de este servidor (" + window.location.origin + ") en el cuadro de texto.\n" +
          "3. Cámbielo a 'Enabled' y reinicie Chrome.";
      }

      await showGlobalAlert(errorMsg, "Error de Cámara");
      await stopCameraPos();
    }
  }

  if (btnScanCameraPos) {
    btnScanCameraPos.addEventListener('click', async () => {
      if (!isScanningPos) await startCameraPos();
      else await stopCameraPos();
    });
  }

  // =========================
  // MODAL REIMPRESIÓN DE FACTURAS DEL DÍA
  // =========================

  let reprintAllSales = []; // caché de facturas cargadas

  function getEstadoBadge(estado) {
    switch (estado) {
      case 'PAGADO':  return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">Pagado</span>';
      case 'FIADO':   return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Fiado</span>';
      case 'ABONADO': return '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-100 text-yellow-700">Abonado</span>';
      default:        return `<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700">${estado}</span>`;
    }
  }

  function renderReprintList(sales) {
    if (!reprintSalesList) return;
    reprintSalesList.innerHTML = '';

    if (!sales || sales.length === 0) {
      reprintSalesStatus.textContent = 'No se encontraron facturas.';
      return;
    }

    reprintSalesStatus.textContent = `${sales.length} factura(s) encontrada(s).`;

    sales.forEach(sale => {
      const hora = new Date(sale.creado_en).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
      const totalVes = parseFloat(sale.total_ves || 0).toFixed(2);
      const cliente = sale.cliente_nombre || 'Consumidor Final';
      const badge = getEstadoBadge(sale.estado_pago);

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="py-2 pr-2 text-gray-700 font-mono font-bold">#${sale.id}</td>
        <td class="py-2 pr-2 text-gray-800 max-w-[180px] truncate" title="${cliente}">${cliente}</td>
        <td class="py-2 pr-2 text-gray-500">${hora}</td>
        <td class="py-2 pr-2 text-gray-800 font-semibold text-right">${totalVes}</td>
        <td class="py-2 pr-2 text-center">${badge}</td>
        <td class="py-2 text-center">
          <button
            class="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 active:scale-95 transition-all"
            onclick="window.openAppWindow('/api/sales/${sale.id}/receipt', 'Ticket #${sale.id}', 350, 750)"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path></svg>
            Imprimir
          </button>
        </td>
      `;
      reprintSalesList.appendChild(tr);
    });
  }

  function filterReprintList(q) {
    if (!q || q.trim() === '') {
      renderReprintList(reprintAllSales);
      return;
    }
    const term = q.trim().toLowerCase();
    const filtered = reprintAllSales.filter(s =>
      String(s.id).includes(term) ||
      (s.cliente_nombre || '').toLowerCase().includes(term)
    );
    renderReprintList(filtered);
  }

  async function openReprintModal() {
    if (!reprintModal) return;
    reprintModal.classList.remove('hidden');
    if (reprintSalesStatus) reprintSalesStatus.textContent = 'Cargando...';
    if (reprintSalesList) reprintSalesList.innerHTML = '';
    if (reprintSearchInput) reprintSearchInput.value = '';

    try {
      const session = JSON.parse(sessionStorage.getItem('nexuspos_session') || '{}');
      const uid = session.id || '';
      const response = await fetch(`/api/reports/today-sales?usuario_id=${uid}`);
      const data = await response.json();
      reprintAllSales = Array.isArray(data.sales) ? data.sales : [];
      renderReprintList(reprintAllSales);
    } catch (e) {
      console.error('Error cargando facturas del día:', e);
      if (reprintSalesStatus) reprintSalesStatus.textContent = 'Error al cargar las facturas.';
    }
  }



  // Botón cerrar modal
  if (btnCloseReprintModal) {
    btnCloseReprintModal.addEventListener('click', () => {
      reprintModal.classList.add('hidden');
    });
  }

  // Cerrar modal al hacer clic en el fondo
  if (reprintModal) {
    reprintModal.addEventListener('click', (e) => {
      if (e.target === reprintModal) reprintModal.classList.add('hidden');
    });
  }

  // Buscador en tiempo real
  if (reprintSearchInput) {
    reprintSearchInput.addEventListener('input', () => {
      filterReprintList(reprintSearchInput.value);
    });
  }

}); // ends DOMContentLoaded

