document.addEventListener('DOMContentLoaded', () => {
  // Helper para abrir ventanas tipo "App de PC"
  function openAppWindow(url, title = 'NexusPOS', w = 900, h = 800) {
    const left = (screen.width / 2) - (w / 2);
    const top = (screen.height / 2) - (h / 2);
    return window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
  }

  async function showGlobalAlert(message, title) {
    const ctx = window.parent || window;
    if (typeof ctx.openSystemAlert === 'function') {
      await ctx.openSystemAlert(message, title);
    } else {
      console.log('ALERTA:', message);
    }
  }

  async function showGlobalConfirm(message, title) {
    const ctx = window.parent || window;
    if (typeof ctx.openSystemConfirm === 'function') {
      return await ctx.openSystemConfirm(message, title);
    } else {
      console.log('CONFIRM (sin modal disponible):', message);
      return true;
    }
  }

  // Pequeño helper para evitar romper atributos HTML con comillas
  function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ✅ FIX: global popover for row actions (prevents overflow and viewport calculation bugs)
  let activePopoverButton = null;
  const globalPopover = document.createElement('div');
  globalPopover.id = 'global-action-popover';
  globalPopover.className = 'action-popover hidden fixed z-[9999] w-48 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden';
  globalPopover.innerHTML = `
    <button class="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center transition-colors duration-150 btn-print-label border-0 bg-transparent">
      <svg class="w-4 h-4 mr-2.5 text-blue-500 dark:text-blue-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a1.8095 1.8095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 9h.008v.008H6V9z"/>
      </svg>
      <span>Imprimir Etiqueta</span>
    </button>
    <button class="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center transition-colors duration-150 btn-barcode border-0 bg-transparent">
      <svg class="w-4 h-4 mr-2.5 text-amber-500 dark:text-amber-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.5v15m3-15v15m3-15v15m3-15v15m3-15v15m3-15v15m3-15v15"/>
      </svg>
      <span>Cód. de Barras</span>
    </button>
    <button class="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center transition-colors duration-150 btn-presentations border-0 bg-transparent">
      <svg class="w-4 h-4 mr-2.5 text-purple-500 dark:text-purple-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 4.5h7v7h-7v-7zM12.5 4.5h7v7h-7v-7zM4.5 12.5h7v7h-7v-7zM12.5 12.5h7v7h-7v-7z"/>
      </svg>
      <span>Presentaciones</span>
    </button>
    <button class="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center transition-colors duration-150 btn-add-stock border-0 bg-transparent">
      <svg class="w-4 h-4 mr-2.5 text-emerald-500 dark:text-emerald-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
      </svg>
      <span>Agregar Stock</span>
    </button>
    <button class="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center transition-colors duration-150 btn-remove-stock border-0 bg-transparent">
      <svg class="w-4 h-4 mr-2.5 text-red-500 dark:text-red-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15"/>
      </svg>
      <span>Quitar Stock</span>
    </button>
  `;
  document.body.appendChild(globalPopover);

  globalPopover.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;

    globalPopover.classList.add('hidden');
    activePopoverButton = null;

    const id = target.dataset.id;

    if (target.classList.contains('btn-print-label')) {
      const name = encodeURIComponent(target.dataset.name);
      const price = encodeURIComponent(target.dataset.priceUsd);
      openAppWindow(`etiqueta.html?nombre=${name}&precio=${price}`, 'Etiqueta', 500, 400);
      return;
    }
    if (target.classList.contains('btn-barcode')) {
      if (!id) return;
      openBarcodeModal(id, target.dataset.name, target.dataset.barcode);
      return;
    }
    if (target.classList.contains('btn-presentations')) {
      if (!id) return;
      const productName = target.dataset.name || '';
      openPresentationModal(id, productName);
      return;
    }
    if (target.classList.contains('btn-add-stock')) {
      if (!id) return;
      const productName = target.dataset.name || '';
      openStockModal(id, productName, 'add');
      return;
    }
    if (target.classList.contains('btn-remove-stock')) {
      if (!id) return;
      const productName = target.dataset.name || '';
      openStockModal(id, productName, 'remove');
      return;
    }
  });

  function hideAllPopovers(exceptId = null) {
    document.querySelectorAll('.action-popover').forEach(pop => {
      if (!exceptId || pop.id !== exceptId) pop.classList.add('hidden');
    });
    activePopoverButton = null;
  }

  function positionPopover(popover, button) {
    // Debe estar visible para medir tamaño
    popover.classList.remove('hidden');

    // ✅ FIX: usar offsetWidth/offsetHeight en lugar de getBoundingClientRect()
    // para forzar un reflow síncrono y obtener dimensiones reales (evita ancho=0)
    const popWidth  = popover.offsetWidth  || 192; // fallback w-48
    const popHeight = popover.offsetHeight || 160; // fallback 4 items

    const btnRect = button.getBoundingClientRect();

    // Por defecto: debajo del botón, alineado a la derecha
    let top = btnRect.bottom + 8;
    let left = btnRect.right - popWidth;

    // Ajustes para no salirse del viewport
    const padding = 8;

    if (left < padding) left = padding;
    if (left + popWidth > window.innerWidth - padding) {
      left = window.innerWidth - popWidth - padding;
    }

    // Si se sale por abajo, lo ponemos arriba
    if (top + popHeight > window.innerHeight - padding) {
      top = btnRect.top - popHeight - 8;
    }
    if (top < padding) top = padding;

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  let currentPage = 1;
  let currentSearch = '';
  const limit = 40;
  let searchTimeout;
  let barcodeScanTimeout;
  let barcodeBuffer = '';
  let adminPasswordEnabled = false;
  let sensitiveDataVisible = false;
  let rates = null;


  // ----- CREAR PRODUCTO -----
  const formCrearProducto = document.getElementById('formCrearProducto');
  const productStatus = document.getElementById('productStatus');
  const prodNombre = document.getElementById('prod-nombre');
  const prodCosto = document.getElementById('prod-costo');
  const prodMonedaCosto = document.getElementById('prod-moneda-costo');
  const prodGanancia = document.getElementById('prod-ganancia');
  const prodPrecioFinal = document.getElementById('prod-precio-final'); // precio final visible
  const prodPrecioMoneda = document.getElementById('prod-precio-moneda'); // select/hidden para moneda del precio final
  const prodStock = document.getElementById('prod-stock');
  const prodTipoVenta = document.getElementById('prod-tipo-venta');
  const prodCategoriaSelect = document.getElementById('prod-categoria-select');
  const prodCategoriaNueva = document.getElementById('prod-categoria-nueva');
  const prodProveedor = document.getElementById('prod-proveedor');
  const btnMostrarFormulario = document.getElementById('btnMostrarFormulario');
  const contenedorFormCrear = document.getElementById('contenedorFormCrear');
  const btnManageCategories = document.getElementById('btn-manage-categories');
  const prodBarcode = document.getElementById('prod-barcode');
  const btnGenerateBarcode = document.getElementById('btn-generate-barcode');
  const btnClearBarcode = document.getElementById('btn-clear-barcode');
  const btnManageBultos = document.getElementById('btn-manage-bultos');

  const costInputMode = document.getElementById('cost-input-mode');
  const btnCostoUnidad = document.getElementById('btn-costo-unidad');
  const btnCostoBulto = document.getElementById('btn-costo-bulto');
  const costoUnitarioGroup = document.getElementById('costo-unitario-group');
  const costoBultoGroup = document.getElementById('costo-bulto-group');
  const prodCostoBulto = document.getElementById('prod-costo-bulto');
  const prodUnidadesBulto = document.getElementById('prod-unidades-bulto');

  // ----- TABLA / LISTADO -----
  const tablaInventarioBody = document.getElementById('tablaInventarioBody');
  const searchInput = document.getElementById('searchInput');
  const paginationControls = document.getElementById('paginationControls');
  const btnAnterior = document.getElementById('btnAnterior');
  const btnSiguiente = document.getElementById('btnSiguiente');
  const pageInfo = document.getElementById('pageInfo');
  const productCountInfo = document.getElementById('productCountInfo');

  // ----- MODAL EDICIÓN -----
  const editModal = document.getElementById('editModal');
  const formEditarProducto = document.getElementById('formEditarProducto');
  const editProductStatus = document.getElementById('editProductStatus');
  const btnCancelarEdicion = document.getElementById('btnCancelarEdicion');
  const editProdId = document.getElementById('edit-prod-id');
  const editProdNombre = document.getElementById('edit-prod-nombre');
  const editProdCosto = document.getElementById('edit-prod-costo');
  const editProdMonedaCosto = document.getElementById('edit-prod-moneda-costo');
  const editProdGanancia = document.getElementById('edit-prod-ganancia');
  const editProdPrecioFinal = document.getElementById('edit-prod-precio-final'); // precio final visible
  const editProdPrecioMoneda = document.getElementById('edit-prod-precio-moneda'); // select/hidden moneda precio final
  const editProdStock = document.getElementById('edit-prod-stock');
  const editProdTipoVenta = document.getElementById('edit-prod-tipo-venta');
  const editProdCategoriaSelect = document.getElementById('edit-prod-categoria-select');
  const editProdCategoriaNueva = document.getElementById('edit-prod-categoria-nueva');
  const editProdProveedor = document.getElementById('edit-prod-proveedor');
  const editProdBarcode = document.getElementById('edit-prod-barcode');
  const btnManageCategoriesEdit = document.getElementById('btn-manage-categories-edit');

  const editCostInputMode = document.getElementById('edit-cost-input-mode');
  const btnEditCostoUnidad = document.getElementById('btn-edit-costo-unidad');
  const btnEditCostoBulto = document.getElementById('btn-edit-costo-bulto');
  const editCostoUnitarioGroup = document.getElementById('edit-costo-unitario-group');
  const editCostoBultoGroup = document.getElementById('edit-costo-bulto-group');
  const editProdCostoBulto = document.getElementById('edit-prod-costo-bulto');
  const editProdUnidadesBulto = document.getElementById('edit-prod-unidades-bulto');

  // ----- MODAL CATEGORÍAS -----
  const categoryManagerModal = document.getElementById('category-manager-modal');
  const btnCloseCategoryModal = document.getElementById('btn-close-category-modal');
  const categoryListContainer = document.getElementById('category-list-container');
  const categoryManagerStatus = document.getElementById('category-manager-status');

  // ----- MODAL BARCODE -----
  const barcodeModal = document.getElementById('barcode-modal');
  const formBarcode = document.getElementById('form-barcode');
  const barcodeModalTitle = document.getElementById('barcode-modal-title');
  const barcodeProductName = document.getElementById('barcode-product-name');
  const barcodeProductId = document.getElementById('barcode-product-id');
  const barcodeInput = document.getElementById('barcode-input');
  const barcodeStatus = document.getElementById('barcode-status');
  const btnDeleteBarcode = document.getElementById('btn-delete-barcode');
  const btnSaveBarcode = document.getElementById('btn-save-barcode');
  const btnCloseBarcodeModal = barcodeModal ? barcodeModal.querySelector('[data-dismiss="modal"]') : null;
  const btnModalGenerateBarcode = document.getElementById('btn-modal-generate-barcode');
  const btnModalClearBarcode = document.getElementById('btn-modal-clear-barcode');

  // ----- MODAL BULTOS -----
  const bultoManagerModal = document.getElementById('bulto-manager-modal');
  const btnCloseBultoModal = document.getElementById('btn-close-bulto-modal');
  const bultoListContainer = document.getElementById('bulto-list-container');
  const bultoManagerStatus = document.getElementById('bulto-manager-status');
  const bultoSearchInput = document.getElementById('bulto-search-input');

  // ----- MODAL PRESENTACIONES -----
  const presentationModal = document.getElementById('presentation-modal');
  const presentationProductName = document.getElementById('presentation-product-name');
  const presentationListContainer = document.getElementById('presentation-list-container');
  const presentationStatus = document.getElementById('presentation-status');
  const btnClosePresentationModal = document.getElementById('btn-close-presentation-modal');

  const presentationForm = document.getElementById('presentation-form');
  const presentationIdInput = document.getElementById('presentation-id'); // hidden para editar si quisieras
  const presentationNameInput = document.getElementById('presentation-name');
  const presentationUnitsInput = document.getElementById('presentation-units');
  const presentationPriceInput = document.getElementById('presentation-price');
  const presentationPriceCurrencySelect = document.getElementById('presentation-price-currency');
  const presentationBarcodeInput = document.getElementById('presentation-barcode');
  const btnNewPresentation = document.getElementById('btn-new-presentation');

  let currentPresentationProductId = null;

  let bultoProducts = [];
  let bultoSearchTerm = '';
  let massMode = false;

  // ----- MASS ACTIONS STATE -----
  const selectedIds = new Set();
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  const bulkActionsBar = document.getElementById('bulkActionsHeaderGroup'); // Now points to header group
  const selectedCountSpan = document.getElementById('selectedCountHeader');
  const btnBulkDelete = document.getElementById('btnBulkDelete');
  const btnBulkProfit = document.getElementById('btnBulkProfit');
  const btnBulkSelectAll = document.getElementById('btnBulkSelectAll');

  // Preview Image Helper
  function setupImagePreview(fileInputId, urlInputId, previewImgId, iconId) {
    const fileInput = document.getElementById(fileInputId);
    const urlInput = document.getElementById(urlInputId);
    const previewImg = document.getElementById(previewImgId);
    const icon = document.getElementById(iconId);

    if (!fileInput) return;

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
          previewImg.src = e.target.result;
          previewImg.classList.remove('hidden');
          icon.classList.add('hidden');
        }
        reader.readAsDataURL(e.target.files[0]);
      } else if (!urlInput.value) {
        previewImg.src = '';
        previewImg.classList.add('hidden');
        icon.classList.remove('hidden');
      }
    });

    urlInput.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      if (url) {
        previewImg.src = url;
        previewImg.classList.remove('hidden');
        icon.classList.add('hidden');
        fileInput.value = '';
      } else if (!fileInput.files || !fileInput.files.length) {
        previewImg.src = '';
        previewImg.classList.add('hidden');
        icon.classList.remove('hidden');
      }
    });
  }

  setupImagePreview('prod-imagen-file', 'prod-imagen-url', 'prod-imagen-preview', 'prod-imagen-icon');
  setupImagePreview('edit-prod-imagen-file', 'edit-prod-imagen-url', 'edit-prod-imagen-preview', 'edit-prod-imagen-icon');

  // Bulk Profit Modal Elements
  const bulkProfitModal = document.getElementById('bulkProfitModal');
  const bulkProfitInput = document.getElementById('bulkProfitInput');
  const btnConfirmBulkProfit = document.getElementById('btnConfirmBulkProfit');
  const btnCancelBulkProfit = document.getElementById('btnCancelBulkProfit');
  const bulkCategoryOptionContainer = document.getElementById('bulkCategoryOptionContainer');
  const bulkCategoryNameSpan = document.getElementById('bulkCategoryName');
  const bulkWarningText = document.getElementById('bulkWarningText');


  function renderBultoRows() {
    bultoListContainer.innerHTML = '';

    if (!bultoProducts || bultoProducts.length === 0) {
      bultoListContainer.innerHTML = `
        <tr>
          <td colspan="7" class="px-4 py-3 text-center text-gray-500">
            No hay productos registrados por bulto.
          </td>
        </tr>
      `;
      return;
    }

    const term = (bultoSearchTerm || '').trim().toLowerCase();

    const filtered = term
      ? bultoProducts.filter(prod => {
        const nombre = (prod.nombre || '').toLowerCase();
        const categoria = (prod.categoria || '').toLowerCase();
        const proveedor = (prod.proveedor || '').toLowerCase();
        return (
          nombre.includes(term) ||
          categoria.includes(term) ||
          proveedor.includes(term)
        );
      })
      : bultoProducts;

    if (filtered.length === 0) {
      bultoListContainer.innerHTML = `
        <tr>
          <td colspan="7" class="px-4 py-3 text-center text-gray-500">
            No hay productos que coincidan con la búsqueda.
          </td>
        </tr>
      `;
      return;
    }

    filtered.forEach(prod => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-3 text-sm text-gray-900">${prod.nombre}</td>
        <td class="px-4 py-3 text-sm text-gray-600">${prod.categoria || ''}</td>
        <td class="px-4 py-3 text-sm text-gray-600">${prod.proveedor || ''}</td>
        <td class="px-4 py-3 text-sm text-gray-600 text-right">
          <input
            type="number"
            step="any"
            value="${prod.costo_bulto}"
            class="input-text w-24 text-right bulto-costo-input"
            data-id="${prod.id}"
            data-unidades="${prod.unidades_bulto}"
          >
          <span class="text-xs">${prod.moneda_costo}</span>
        </td>
        <td class="px-4 py-3 text-sm text-gray-600 text-right">
          ${prod.unidades_bulto}
        </td>
        <td
          class="px-4 py-3 text-sm text-gray-900 font-medium text-right"
          id="unit-cost-${prod.id}"
        >
          ${prod.costo.toFixed(4)}
        </td>
        <td class="px-4 py-3 text-right">
          <button
            class="text-sm text-blue-600 hover:underline btn-save-bulto hidden"
            data-id="${prod.id}"
          >
            Guardar
          </button>
        </td>
      `;
      bultoListContainer.appendChild(tr);
    });
  }

  // ----- DATOS SENSIBLES -----
  const thCostoOriginal = document.getElementById('th-costo-original');
  const thProveedor = document.getElementById('th-proveedor');
  const btnToggleSensitive = document.getElementById('btn-toggle-sensitive');

  // ==========================
  //   COSTO / MODO COSTO
  // ==========================
  function toggleCostMode(mode, isEdit = false) {
    const btnUnidad = isEdit ? btnEditCostoUnidad : btnCostoUnidad;
    const btnBulto = isEdit ? btnEditCostoBulto : btnCostoBulto;
    const inputMode = isEdit ? editCostInputMode : costInputMode;
    const unitGroup = isEdit ? editCostoUnitarioGroup : costoUnitarioGroup;
    const bulkGroup = isEdit ? editCostoBultoGroup : costoBultoGroup;
    const costoInput = isEdit ? editProdCosto : prodCosto;
    const costoBultoInput = isEdit ? editProdCostoBulto : prodCostoBulto;

    if (mode === 'bulto') {
      inputMode.value = 'bulto';
      btnBulto.classList.add('bg-blue-600', 'text-white', 'z-10');
      btnBulto.classList.remove('bg-white', 'text-gray-700', 'hover:bg-gray-50');
      btnUnidad.classList.add('bg-white', 'text-gray-700', 'hover:bg-gray-50');
      btnUnidad.classList.remove('bg-blue-600', 'text-white', 'z-10');
      unitGroup.classList.add('hidden');
      bulkGroup.classList.remove('hidden');
      costoInput.required = false;
      costoBultoInput.required = true;
    } else {
      inputMode.value = 'unidad';
      btnUnidad.classList.add('bg-blue-600', 'text-white', 'z-10');
      btnUnidad.classList.remove('bg-white', 'text-gray-700', 'hover:bg-gray-50');
      btnBulto.classList.add('bg-white', 'text-gray-700', 'hover:bg-gray-50');
      btnBulto.classList.remove('bg-blue-600', 'text-white', 'z-10');
      unitGroup.classList.remove('hidden');
      bulkGroup.classList.add('hidden');
      costoInput.required = true;
      costoBultoInput.required = false;
    }
  }

  function calcularCostoUnitarioEdit() {
    const costoBulto = parseFloat(editProdCostoBulto.value) || 0;
    const unidades = parseInt(editProdUnidadesBulto.value, 10) || 1;
    if (unidades > 0) {
      const costoUnitario = costoBulto / unidades;
      editProdCosto.value = costoUnitario.toFixed(4);
    } else {
      editProdCosto.value = '';
    }
  }

  // ==========================
  //   TASA / RATES (API)
  // ==========================
  async function ensureRatesLoaded() {
    if (rates) return;
    try {
      const resp = await fetch('/api/settings/rates');
      if (resp.ok) {
        rates = await resp.json();
      }
    } catch (e) {
      rates = null;
    }
  }

  // ----- COSTO EN VES: CREAR -----
  function getCostInVesForCreateProduct() {
    if (!rates) return 0;

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    const cop = parseFloat(rates.COP || 0);

    let costoUnit = 0;
    const mode = costInputMode.value;

    if (mode === 'bulto') {
      const cb = parseFloat(prodCostoBulto.value) || 0;
      const unidades = parseInt(prodUnidadesBulto.value, 10) || 0;
      if (cb > 0 && unidades > 0) {
        costoUnit = cb / unidades;
      } else {
        return 0;
      }
    } else {
      costoUnit = parseFloat(prodCosto.value) || 0;
    }

    if (costoUnit <= 0) return 0;

    const moneda = prodMonedaCosto.value;
    if (moneda === 'VES') return costoUnit;
    if (moneda === 'BCV') return costoUnit * bcv;
    if (moneda === 'PARALELO') return costoUnit * paralelo;
    if (moneda === 'COP') return costoUnit * cop;

    return 0;
  }

  // ----- COSTO EN VES: EDITAR -----
  function getCostInVesForEditProduct() {
    if (!rates) return 0;
    const costo = parseFloat(editProdCosto.value) || 0;
    const moneda = editProdMonedaCosto.value;
    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    const cop = parseFloat(rates.COP || 0);

    if (moneda === 'VES') return costo;
    if (moneda === 'BCV') return costo * bcv;
    if (moneda === 'PARALELO') return costo * paralelo;
    if (moneda === 'COP') return costo * cop;
    return 0;
  }

  // ==========================
  //   MONEDA DEL PRECIO FINAL
  // ==========================
  function normalizePriceCurrency(value) {
    if (!value) return 'VES';
    const v = String(value).toUpperCase();
    if (v === 'VES') return 'VES';
    if (v === 'PARALELO') return 'PARALELO';
    // tratamos cualquier variante de USD-BCV como USD_BCV
    if (v === 'USD' || v === 'BCV' || v === 'USD_BCV' || v === 'USD-BCV') return 'USD_BCV';
    return v;
  }

  // Convierte el campo de precio final en CREAR al cambiar la moneda (sin tocar % ni costo)
  function handlePrecioMonedaChangeCrear() {
    if (!rates || !prodPrecioFinal || !prodPrecioMoneda) return;

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    // Nota: Aunque alguna tasa sea 0, permitimos el cambio para no bloquear la UI, 
    // pero la conversión dará Infinity o 0 si no se maneja cuidado.
    // Asumiremos que si tasa es 0 no se puede convertir correctamente a esa moneda.

    const lastRaw = prodPrecioMoneda.dataset.last || 'VES';
    const last = normalizePriceCurrency(lastRaw);
    const current = normalizePriceCurrency(prodPrecioMoneda.value || 'VES');

    if (last === current) return;

    const currentVal = parseFloat(prodPrecioFinal.value);
    if (isNaN(currentVal) || currentVal <= 0) {
      prodPrecioMoneda.dataset.last = prodPrecioMoneda.value || 'VES';
      return;
    }

    // 1. Convertir TODO a VES primero
    let valorVes = 0;
    if (last === 'VES') {
      valorVes = currentVal;
    } else if (last === 'USD_BCV') {
      valorVes = currentVal * bcv;
    } else if (last === 'PARALELO') {
      valorVes = currentVal * paralelo;
    }

    // 2. Convertir de VES a la nueva moneda
    let newDisplay = 0;
    if (current === 'VES') {
      newDisplay = valorVes;
    } else if (current === 'USD_BCV') {
      if (bcv > 0) newDisplay = valorVes / bcv;
    } else if (current === 'PARALELO') {
      if (paralelo > 0) newDisplay = valorVes / paralelo;
    }

    prodPrecioFinal.value = newDisplay.toFixed(2);
    prodPrecioMoneda.dataset.last = prodPrecioMoneda.value || 'VES';
  }

  // Convierte el campo de precio final en EDITAR al cambiar la moneda (sin tocar % ni costo)
  function handlePrecioMonedaChangeEditar() {
    if (!rates || !editProdPrecioFinal || !editProdPrecioMoneda) return;

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);

    const lastRaw = editProdPrecioMoneda.dataset.last || 'VES';
    const last = normalizePriceCurrency(lastRaw);
    const current = normalizePriceCurrency(editProdPrecioMoneda.value || 'VES');

    if (last === current) return;

    const currentVal = parseFloat(editProdPrecioFinal.value);
    if (isNaN(currentVal) || currentVal <= 0) {
      editProdPrecioMoneda.dataset.last = editProdPrecioMoneda.value || 'VES';
      return;
    }

    // 1. Convertir TODO a VES primero
    let valorVes = 0;
    if (last === 'VES') {
      valorVes = currentVal;
    } else if (last === 'USD_BCV') {
      valorVes = currentVal * bcv;
    } else if (last === 'PARALELO') {
      valorVes = currentVal * paralelo;
    }

    // 2. Convertir de VES a la nueva moneda
    let newDisplay = 0;
    if (current === 'VES') {
      newDisplay = valorVes;
    } else if (current === 'USD_BCV') {
      if (bcv > 0) newDisplay = valorVes / bcv;
    } else if (current === 'PARALELO') {
      if (paralelo > 0) newDisplay = valorVes / paralelo;
    }

    editProdPrecioFinal.value = newDisplay.toFixed(2);
    editProdPrecioMoneda.dataset.last = editProdPrecioMoneda.value || 'VES';
  }

  // ==========================
  //  SINCRONIZACIÓN CREAR:
  //  % ↔ PRECIO FINAL (moneda seleccionada)
  // ==========================
  function calcularPrecioFinalDesdePorcentajeCrear() {
    if (!rates || !prodPrecioFinal) return;

    const costoEnVes = getCostInVesForCreateProduct();
    if (costoEnVes <= 0) {
      prodPrecioFinal.value = '';
      return;
    }

    const porcentaje = parseFloat(prodGanancia.value) || 0;
    const p = porcentaje / 100;
    const calcMethod = parseInt(rates.CALC_METHOD || 1, 10) || 1;

    let finalPriceVes = 0;
    if (calcMethod === 2) {
      if (p >= 1) {
        finalPriceVes = costoEnVes;
      } else {
        finalPriceVes = costoEnVes / (1 - p);
      }
    } else {
      finalPriceVes = costoEnVes * (1 + p);
    }

    if (finalPriceVes <= 0) {
      prodPrecioFinal.value = '';
      return;
    }

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    let displayValue = finalPriceVes;

    if (prodPrecioMoneda) {
      const moneda = normalizePriceCurrency(prodPrecioMoneda.value);
      if (moneda === 'USD_BCV' && bcv > 0) {
        displayValue = finalPriceVes / bcv;
      } else if (moneda === 'PARALELO' && paralelo > 0) {
        displayValue = finalPriceVes / paralelo;
      }
    }

    prodPrecioFinal.value = displayValue.toFixed(2);
  }

  function calcularPorcentajeDesdePrecioFinalCrear() {
    if (!rates || !prodPrecioFinal) return;

    const costoEnVes = getCostInVesForCreateProduct();
    if (costoEnVes <= 0) return;

    const precioIngresado = parseFloat(prodPrecioFinal.value) || 0;
    if (precioIngresado <= 0) return;

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    let precioVes = precioIngresado;

    if (prodPrecioMoneda) {
      const moneda = normalizePriceCurrency(prodPrecioMoneda.value);
      if (moneda === 'USD_BCV') {
        if (bcv > 0) precioVes = precioIngresado * bcv;
      } else if (moneda === 'PARALELO') {
        if (paralelo > 0) precioVes = precioIngresado * paralelo;
      }
    }

    const calcMethod = parseInt(rates.CALC_METHOD || 1, 10) || 1;

    let porcentaje = 0;
    if (calcMethod === 2) {
      porcentaje = 1 - (costoEnVes / precioVes);
    } else {
      porcentaje = (precioVes / costoEnVes) - 1;
    }

    porcentaje = porcentaje * 100;
    if (!isFinite(porcentaje)) return;
    prodGanancia.value = porcentaje.toFixed(2);
  }

  // ==========================
  //  SINCRONIZACIÓN EDITAR:
  //  % ↔ PRECIO FINAL (moneda seleccionada)
  // ==========================
  function calcularPrecioFinalDesdePorcentaje() {
    if (!rates || !editProdPrecioFinal) return;

    const costoEnVes = getCostInVesForEditProduct();
    if (costoEnVes <= 0) {
      editProdPrecioFinal.value = '';
      return;
    }

    const porcentaje = parseFloat(editProdGanancia.value) || 0;
    const p = porcentaje / 100;
    const calcMethod = parseInt(rates.CALC_METHOD || 1, 10) || 1;

    let finalPriceVes = 0;
    if (calcMethod === 2) {
      if (p >= 1) {
        finalPriceVes = costoEnVes;
      } else {
        finalPriceVes = costoEnVes / (1 - p);
      }
    } else {
      finalPriceVes = costoEnVes * (1 + p);
    }

    if (finalPriceVes <= 0) {
      editProdPrecioFinal.value = '';
      return;
    }

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    let displayValue = finalPriceVes;

    if (editProdPrecioMoneda) {
      const moneda = normalizePriceCurrency(editProdPrecioMoneda.value);
      if (moneda === 'USD_BCV' && bcv > 0) {
        displayValue = finalPriceVes / bcv;
      } else if (moneda === 'PARALELO' && paralelo > 0) {
        displayValue = finalPriceVes / paralelo;
      }
    }

    editProdPrecioFinal.value = displayValue.toFixed(2);
  }

  function calcularPorcentajeDesdePrecioFinal() {
    if (!rates || !editProdPrecioFinal) return;

    const costoEnVes = getCostInVesForEditProduct();
    if (costoEnVes <= 0) return;

    const precioIngresado = parseFloat(editProdPrecioFinal.value) || 0;
    if (precioIngresado <= 0) return;

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    let finalPriceVes = precioIngresado;

    if (editProdPrecioMoneda) {
      const moneda = normalizePriceCurrency(editProdPrecioMoneda.value);
      if (moneda === 'USD_BCV') {
        if (bcv > 0) finalPriceVes = precioIngresado * bcv;
      } else if (moneda === 'PARALELO') {
        if (paralelo > 0) finalPriceVes = precioIngresado * paralelo;
      }
    }

    const calcMethod = parseInt(rates.CALC_METHOD || 1, 10) || 1;
    let porcentaje = 0;

    if (finalPriceVes <= 0) return;

    if (calcMethod === 2) {
      porcentaje = 1 - (costoEnVes / finalPriceVes);
    } else {
      porcentaje = (finalPriceVes / costoEnVes) - 1;
    }

    porcentaje = porcentaje * 100;
    if (!isFinite(porcentaje)) return;
    editProdGanancia.value = porcentaje.toFixed(2);
  }

  // ==========================
  //   CATEGORÍAS
  // ==========================
  async function cargarCategorias(selectElement) {
    try {
      const response = await fetch('/api/categories');
      if (!response.ok) throw new Error('No se pudieron cargar categorías');
      const categorias = await response.json();

      const opcionesAGuardar = new Set(['', '_NUEVA_']);

      for (let i = selectElement.options.length - 1; i >= 0; i--) {
        const option = selectElement.options[i];
        if (!opcionesAGuardar.has(option.value)) {
          selectElement.remove(i);
        }
      }

      const opcionNueva = selectElement.querySelector('option[value="_NUEVA_"]');
      categorias.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.nombre;
        option.textContent = cat.nombre;
        option.dataset.id = cat.id;
        selectElement.insertBefore(option, opcionNueva);
      });
    } catch (error) {
      console.error(error);
      mostrarMensaje(productStatus, 'Error al cargar categorías', 'error');
    }
  }

  async function inicializarDropdownsCategorias() {
    await Promise.all([
      cargarCategorias(prodCategoriaSelect)
    ]);
  }

  function handleCategoryChange(selectElement, inputElement) {
    if (selectElement.value === '_NUEVA_') {
      inputElement.classList.remove('hidden');
      inputElement.required = true;
    } else {
      inputElement.classList.add('hidden');
      inputElement.required = false;
      inputElement.value = '';
    }
  }

  function toggleFormularioCrear() {
    const estaOculto = contenedorFormCrear.classList.contains('hidden');
    if (estaOculto) {
      contenedorFormCrear.classList.remove('hidden');
      btnMostrarFormulario.innerHTML = `
        <svg class="w-5 h-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15"/>
        </svg>
        Cancelar
      `;
      btnMostrarFormulario.classList.replace('bg-blue-600', 'bg-gray-500');
    } else {
      contenedorFormCrear.classList.add('hidden');
      btnMostrarFormulario.innerHTML = `
        <svg class="w-5 h-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
        </svg>
        Añadir Producto
      `;
      btnMostrarFormulario.classList.replace('bg-gray-500', 'bg-blue-600');
      formCrearProducto.reset();
      handleCategoryChange(prodCategoriaSelect, prodCategoriaNueva);
      toggleCostMode('unidad', false);
      stopCamera();
      
      // Reset image preview
      document.getElementById('prod-imagen-preview').src = '';
      document.getElementById('prod-imagen-preview').classList.add('hidden');
      document.getElementById('prod-imagen-icon').classList.remove('hidden');
    }
  }

  // ==========================
  //   DATOS SENSIBLES
  // ==========================
  function setSensitiveColumnsVisible(visible) {
    if (thCostoOriginal) thCostoOriginal.style.display = visible ? '' : 'none';
    if (thProveedor) thProveedor.style.display = visible ? '' : 'none';
    const tds = document.querySelectorAll('td[data-sensitive="costo"],td[data-sensitive="proveedor"]');
    tds.forEach(td => {
      td.style.display = visible ? '' : 'none';
    });
  }

  async function checkAdminPasswordEnabled() {
    try {
      const response = await fetch('/api/settings/admin-password');
      if (response.ok) {
        const data = await response.json();
        adminPasswordEnabled = !!data.enabled;
      } else {
        adminPasswordEnabled = false;
      }
    } catch (e) {
      adminPasswordEnabled = false;
    }
    if (btnToggleSensitive) {
      if (adminPasswordEnabled) {
        btnToggleSensitive.classList.remove('hidden');
      } else {
        btnToggleSensitive.classList.add('hidden');
      }
    }
    if (adminPasswordEnabled && !sensitiveDataVisible) {
      setSensitiveColumnsVisible(false);
    } else {
      setSensitiveColumnsVisible(true);
    }
  }

  // ==========================
  //   CARGAR PRODUCTOS
  // ==========================
  async function cargarProductos() {
    try {
      const params = new URLSearchParams();
      params.append('search', currentSearch);
      params.append('page', currentPage);
      params.append('limit', limit);

      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) throw new Error('No se pudieron cargar los productos');

      const data = await response.json();
      const productos = data.products;

      tablaInventarioBody.innerHTML = '';

      if (productos.length === 0) {
        const mensaje = currentSearch
          ? `No se encontraron productos para "${currentSearch}"`
          : 'Aún no hay productos en el inventario.';
        tablaInventarioBody.innerHTML = `<tr><td colspan="9" class="px-6 py-4 text-center text-gray-500">${mensaje}</td></tr>`;
        paginationControls.classList.add('hidden');
        return;
      }

      paginationControls.classList.remove('hidden');

      productos.forEach(prod => {
        const tr = document.createElement('tr');
        const isSelected = selectedIds.has(String(prod.id));

        const costoOriginal = `${parseFloat(prod.costo).toFixed(2)} (${prod.moneda_costo})`;
        const pvpVes = `${parseFloat(prod.precio_final_ves).toFixed(2)} Bs.`;
        const pvpUsd = `${parseFloat(prod.precio_final_usd_bcv).toFixed(2)} $`;

        let stockUnit = 'Unid';
        let stockVal = Number(prod.stock) || 0;
        if (prod.tipo_venta === 'PESO') { stockUnit = 'Kg'; stockVal = stockVal.toFixed(3); }
        else if (prod.tipo_venta === 'LITRO') { stockUnit = 'Lt'; stockVal = stockVal.toFixed(3); }
        else { stockVal = Math.round(stockVal); }

        const unitSuffix = prod.tipo_venta === 'PESO' ? '/Kg' : (prod.tipo_venta === 'LITRO' ? '/Lt' : '');

        const stockDisplay = `${stockVal} ${stockUnit}`;
        const proveedorDisplay = prod.proveedor || '';

        const precioMovil = `<span class="font-bold">${pvpVes} ${unitSuffix}</span> <span class="text-gray-500 text-xs">(${pvpUsd})</span> <br> <span class="text-xs text-green-600">${stockDisplay}</span>`;
        const popoverId = `popover-${prod.id}`;




        const checkboxHTML = `
          <input type="checkbox" class="product-checkbox absolute left-1 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 bg-white z-10 ${massMode ? '' : 'hidden'}" 
          value="${prod.id}" ${isSelected ? 'checked' : ''}>
        `;

        tr.innerHTML = `
          <td class="px-6 py-4 whitespace-normal break-words text-sm font-medium text-gray-900 relative">
             ${checkboxHTML}
             ${prod.nombre}
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell" data-sensitive="costo">${costoOriginal}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold hidden md:table-cell">${pvpVes} ${unitSuffix}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold hidden md:table-cell">${pvpUsd} ${unitSuffix}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">${stockDisplay}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell">${prod.categoria}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 hidden md:table-cell" data-sensitive="proveedor">${proveedorDisplay}</td>
          <td class="px-6 py-4 text-sm text-gray-900 md:hidden">${precioMovil}</td>
          <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
            <div class="flex justify-end space-x-1 relative">
              <button class="p-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 btn-editar" title="Editar Producto" data-id="${prod.id}">
                <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"/>
                </svg>
              </button>
              <button class="p-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200 btn-eliminar" title="Eliminar Producto" data-id="${prod.id}">
                <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/>
                </svg>
              </button>
              <button class="p-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 btn-more-options" title="Más Opciones" 
                      data-id="${prod.id}" data-name="${escapeHtml(prod.nombre)}" data-price-usd="${prod.precio_final_usd_bcv.toFixed(2)}" data-barcode="${prod.barcode || ''}">
                <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z"/>
                </svg>
              </button>
            </div>
          </td>
        `;
        tablaInventarioBody.appendChild(tr);
      });

      actualizarControlesPaginacion(data);
      if (adminPasswordEnabled && !sensitiveDataVisible) {
        setSensitiveColumnsVisible(false);
      } else {
        setSensitiveColumnsVisible(true);
      }
    } catch (error) {
      console.error('Error cargando productos:', error);
      tablaInventarioBody.innerHTML = `<tr><td colspan="9" class="px-6 py-4 text-center text-red-500">Error: ${error.message}</td></tr>`;
      paginationControls.classList.add('hidden');
    }
  }

  function actualizarControlesPaginacion(data) {
    const { totalPages, currentPage: cp, totalProducts, products } = data;
    pageInfo.textContent = `Página ${cp} / ${totalPages}`;
    const from = (cp - 1) * limit + 1;
    const to = from + products.length - 1;
    productCountInfo.textContent = `Mostrando ${from}-${to} de ${totalProducts} productos`;
    btnAnterior.disabled = (cp === 1);
    btnSiguiente.disabled = (cp === totalPages);
  }

  // ==========================
  //   CREAR PRODUCTO
  // ==========================
  async function handleCrearProducto(event) {
    event.preventDefault();

    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    mostrarMensaje(productStatus, '', 'info');

    let categoriaFinal = '';
    if (prodCategoriaSelect.value === '_NUEVA_') {
      categoriaFinal = prodCategoriaNueva.value.trim();
      if (categoriaFinal === '') {
        mostrarMensaje(productStatus, 'Error: El nombre de la nueva categoría no puede estar vacío.', 'error');
        return;
      }
    } else {
      categoriaFinal = prodCategoriaSelect.value;
    }

    if (categoriaFinal === '') {
      mostrarMensaje(productStatus, 'Error: Debes seleccionar o crear una categoría.', 'error');
      return;
    }

    const costMode = costInputMode.value;
    let costoUnitario = parseFloat(prodCosto.value) || 0;
    let costoBulto = parseFloat(prodCostoBulto.value) || 0;
    let unidadesBulto = parseInt(prodUnidadesBulto.value, 10) || 1;

    if (costMode === 'unidad') {
      if (costoUnitario <= 0) {
        mostrarMensaje(productStatus, 'Error: El costo unitario debe ser mayor a cero.', 'error');
        return;
      }
    } else {
      if (costoBulto <= 0 || unidadesBulto <= 0) {
        mostrarMensaje(productStatus, 'Error: El costo y unidades del bulto deben ser mayores a cero.', 'error');
        return;
      }
    }

    let imagenFinal = null;
    const imagenFile = document.getElementById('prod-imagen-file').files[0];
    const imagenUrl = document.getElementById('prod-imagen-url').value.trim();

    if (imagenFile) {
      const formData = new FormData();
      formData.append('imagen', imagenFile);
      try {
        const uploadResp = await fetch('/api/products/upload-image', { method: 'POST', body: formData });
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) throw new Error(uploadData.error || 'Error al subir imagen');
        imagenFinal = uploadData.filePath;
      } catch (err) {
        mostrarMensaje(productStatus, `Error subiendo imagen: ${err.message}`, 'error');
        return;
      }
    } else if (imagenUrl) {
      imagenFinal = imagenUrl;
    }

    const nuevoProducto = {
      costMode: costInputMode.value,
      nombre: prodNombre.value,
      costo: costoUnitario,
      costo_bulto: costoBulto,
      unidades_bulto: unidadesBulto,
      moneda_costo: prodMonedaCosto.value,
      porcentaje_ganancia: prodGanancia.value,
      stock: prodStock.value || 0,
      categoria: categoriaFinal,
      tipo_venta: prodTipoVenta.value,
      proveedor: prodProveedor.value || '',
      barcode: prodBarcode.value || null,
      imagen: imagenFinal,
      exento_iva: document.getElementById('prod-exento-iva')?.checked ? 1 : 0,
      stock_minimo: document.getElementById('prod-stock-minimo')?.value || 0,
      fecha_vencimiento: document.getElementById('prod-fecha-vencimiento')?.value || null
    };

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nuevoProducto),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(productStatus, '¡Producto creado con éxito! Recargando...', 'success');

      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Error creando producto:', error);
      mostrarMensaje(productStatus, `Error: ${error.message}`, 'error');
    }
  }

  // ==========================
  //   ACCIONES TABLA
  // ==========================
  async function handleTablaClick(event) {
    const target = event.target.closest('button');
    if (!target) return;

    // ✅ FIX: global popover toggle behavior with event propagation stopped
    if (target.classList.contains('btn-more-options')) {
      event.stopPropagation();

      const isAlreadyOpen = !globalPopover.classList.contains('hidden') && activePopoverButton === target;

      if (isAlreadyOpen) {
        globalPopover.classList.add('hidden');
        activePopoverButton = null;
      } else {
        activePopoverButton = target;

        const id = target.dataset.id;
        const name = target.dataset.name;
        const price = target.dataset.priceUsd;
        const barcode = target.dataset.barcode;

        globalPopover.querySelectorAll('button').forEach(btn => {
          btn.dataset.id = id;
          btn.dataset.name = name;
          btn.dataset.priceUsd = price;
          btn.dataset.barcode = barcode;
        });

        positionPopover(globalPopover, target);
      }
      return;
    }

    const id = target.dataset.id;

    if (target.classList.contains('btn-editar')) {
      if (!id) return;
      abrirModalEdicion(id);
      return;
    }
    if (target.classList.contains('btn-eliminar')) {
      if (!id) return;
      handleEliminarClick(id);
      return;
    }
    if (target.classList.contains('btn-barcode')) {
      if (!id) return;
      openBarcodeModal(id, target.dataset.name, target.dataset.barcode);
      return;
    }
    if (target.classList.contains('btn-print-label')) {
      const name = encodeURIComponent(target.dataset.name);
      const price = encodeURIComponent(target.dataset.priceUsd);
      openAppWindow(`etiqueta.html?nombre=${name}&precio=${price}`, 'Etiqueta', 500, 400);
      return;
    }
    if (target.classList.contains('btn-presentations')) {
      if (!id) return;
      const productName = target.dataset.name || '';
      openPresentationModal(id, productName);
      return;
    }
    if (target.classList.contains('btn-add-stock')) {
      if (!id) return;
      const productName = target.dataset.name || '';
      openStockModal(id, productName, 'add');
      return;
    }
    if (target.classList.contains('btn-remove-stock')) {
      if (!id) return;
      const productName = target.dataset.name || '';
      openStockModal(id, productName, 'remove');
      return;
    }
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('.btn-more-options') && !event.target.closest('.action-popover')) {
      globalPopover.classList.add('hidden');
      activePopoverButton = null;
    }
  });

  // ==========================
  //   ELIMINAR PRODUCTO
  // ==========================
  async function handleEliminarClick(id) {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    const confirmed = await showGlobalConfirm(
      '¿Estás seguro de que deseas eliminar este producto? Esta acción no se puede deshacer.',
      'Eliminar producto'
    );
    if (!confirmed) return;

    try {
      try {
        await fetch(`/api/products/${id}/barcode`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode: null })
        });
      } catch (innerErr) {
        console.error('Error limpiando barcode antes de eliminar:', innerErr);
      }

      if (tablaInventarioBody.rows.length === 1 && currentPage > 1) {
        currentPage--;
      }

      const response = await fetch(`/api/products/${id}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(productStatus, 'Producto eliminado con éxito', 'success');
      await cargarProductos();
    } catch (error) {
      console.error('Error eliminando producto:', error);
      mostrarMensaje(productStatus, `Error: ${error.message}`, 'error');
    }
  }

  // ==========================
  //   MODAL EDICIÓN
  // ==========================
  async function abrirModalEdicion(id) {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    mostrarMensaje(editProductStatus, '', 'info');
    try {
      const response = await fetch(`/api/products/${id}`);
      if (!response.ok) throw new Error('No se pudo cargar el producto');
      const prod = await response.json();

      await cargarCategorias(editProdCategoriaSelect);

      editProdId.value = prod.id;
      editProdNombre.value = prod.nombre;
      editProdCosto.value = prod.costo;
      editProdMonedaCosto.value = prod.moneda_costo;
      editProdGanancia.value = prod.porcentaje_ganancia;
      editProdStock.value = prod.stock;
      editProdTipoVenta.value = prod.tipo_venta || 'UNIDAD';


      editProdCategoriaSelect.value = prod.categoria || '';
      editProdProveedor.value = prod.proveedor || '';
      editProdBarcode.value = prod.barcode || '';

      const editStockMinimo = document.getElementById('edit-prod-stock-minimo');
      if (editStockMinimo) editStockMinimo.value = prod.stock_minimo || 0;
      const editFechaVenc = document.getElementById('edit-prod-fecha-vencimiento');
      if (editFechaVenc) editFechaVenc.value = prod.fecha_vencimiento || '';

      const previewImg = document.getElementById('edit-prod-imagen-preview');
      const previewIcon = document.getElementById('edit-prod-imagen-icon');
      const imagenUrlInput = document.getElementById('edit-prod-imagen-url');
      if (prod.imagen) {
         previewImg.src = prod.imagen;
         previewImg.classList.remove('hidden');
         previewIcon.classList.add('hidden');
         imagenUrlInput.value = prod.imagen;
      } else {
         previewImg.src = '';
         previewImg.classList.add('hidden');
         previewIcon.classList.remove('hidden');
         imagenUrlInput.value = '';
      }

      const editProdExentoIva = document.getElementById('edit-prod-exento-iva');
      if (editProdExentoIva) {
        editProdExentoIva.checked = (prod.exento_iva === 1 || prod.exento_iva === true);
      }

      handleCategoryChange(editProdCategoriaSelect, editProdCategoriaNueva);

      if (prod.unidades_bulto > 1) {
        toggleCostMode('bulto', true);
        editProdCostoBulto.value = prod.costo_bulto;
        editProdUnidadesBulto.value = prod.unidades_bulto;
      } else {
        toggleCostMode('unidad', true);
        editProdCostoBulto.value = '';
        editProdUnidadesBulto.value = 1;
      }

      if (editProdPrecioMoneda) {
        editProdPrecioMoneda.value = editProdPrecioMoneda.value || 'VES';
        editProdPrecioMoneda.dataset.last = editProdPrecioMoneda.value || 'VES';
      }

      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentaje(); // inicializar campo precio final con la moneda actual

      editModal.classList.remove('hidden');
    } catch (error) {
      console.error('Error abriendo modal:', error);
      mostrarMensaje(productStatus, `Error: ${error.message}`, 'error');
    }
  }

  function cerrarModalEdicion() {
    editModal.classList.add('hidden');
    formEditarProducto.reset();
    editProdId.value = '';
    editProdTipoVenta.value = 'UNIDAD';
    handleCategoryChange(editProdCategoriaSelect, editProdCategoriaNueva);
    mostrarMensaje(editProductStatus, '', 'info');
    toggleCostMode('unidad', true);
  }

  async function handleGuardarCambios(event) {
    event.preventDefault();

    const id = editProdId.value;

    let categoriaFinal = '';
    if (editProdCategoriaSelect.value === '_NUEVA_') {
      categoriaFinal = editProdCategoriaNueva.value.trim();
      if (categoriaFinal === '') {
        mostrarMensaje(editProductStatus, 'Error: El nombre de la nueva categoría no puede estar vacío.', 'error');
        return;
      }
    } else {
      categoriaFinal = editProdCategoriaSelect.value;
    }

    if (categoriaFinal === '') {
      mostrarMensaje(editProductStatus, 'Error: Debes seleccionar o crear una categoría.', 'error');
      return;
    }

    const costMode = editCostInputMode.value;
    let costoUnitario = parseFloat(editProdCosto.value) || 0;
    let costoBulto = parseFloat(editProdCostoBulto.value) || 0;
    let unidadesBulto = parseInt(editProdUnidadesBulto.value, 10) || 1;

    if (costMode === 'unidad') {
      if (costoUnitario <= 0) {
        mostrarMensaje(editProductStatus, 'Error: El costo unitario debe ser mayor a cero.', 'error');
        return;
      }
    } else {
      if (costoBulto <= 0 || unidadesBulto <= 0) {
        mostrarMensaje(editProductStatus, 'Error: El costo y unidades del bulto deben ser mayores a cero.', 'error');
        return;
      }
    }

    const barcodeActual = editProdBarcode.value || null;

    let imagenFinal = undefined;
    const imagenFile = document.getElementById('edit-prod-imagen-file').files[0];
    const imagenUrl = document.getElementById('edit-prod-imagen-url').value.trim();

    if (imagenFile) {
      const formData = new FormData();
      formData.append('imagen', imagenFile);
      try {
        const uploadResp = await fetch('/api/products/upload-image', { method: 'POST', body: formData });
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) throw new Error(uploadData.error || 'Error al subir imagen');
        imagenFinal = uploadData.filePath;
      } catch (err) {
        mostrarMensaje(editProductStatus, `Error subiendo imagen: ${err.message}`, 'error');
        return;
      }
    } else if (imagenUrl) {
      imagenFinal = imagenUrl;
    } else {
      imagenFinal = null;
    }

    const productoActualizado = {
      costMode: editCostInputMode.value,
      nombre: editProdNombre.value,
      costo: costoUnitario,
      costo_bulto: costoBulto,
      unidades_bulto: unidadesBulto,
      moneda_costo: editProdMonedaCosto.value,
      porcentaje_ganancia: editProdGanancia.value,
      stock: editProdStock.value,
      categoria: categoriaFinal,
      tipo_venta: editProdTipoVenta.value,
      proveedor: editProdProveedor.value || '',
      barcode: barcodeActual,
      imagen: imagenFinal,
      exento_iva: document.getElementById('edit-prod-exento-iva')?.checked ? 1 : 0,
      stock_minimo: document.getElementById('edit-prod-stock-minimo')?.value || 0,
      fecha_vencimiento: document.getElementById('edit-prod-fecha-vencimiento')?.value || null
    };

    try {
      const response = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productoActualizado),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      cerrarModalEdicion();
      mostrarMensaje(productStatus, '¡Producto actualizado con éxito!', 'success');

      if (editProdCategoriaSelect.value === '_NUEVA_') {
        await inicializarDropdownsCategorias();
      }
      await cargarProductos();
    } catch (error) {
      console.error('Error guardando cambios:', error);
      mostrarMensaje(editProductStatus, `Error: ${error.message}`, 'error');
    }
  }

  // ==========================
  //   MODAL BARCODE
  // ==========================
  async function openBarcodeModal(id, name, currentBarcode) {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    barcodeProductId.value = id;
    barcodeProductName.textContent = `Producto: ${name}`;
    barcodeInput.value = currentBarcode || '';
    btnDeleteBarcode.disabled = !currentBarcode;
    mostrarMensaje(barcodeStatus, '', 'info');
    barcodeModal.classList.remove('hidden');
    barcodeInput.focus();
  }

  function closeBarcodeModal() {
    stopCameraModal();
    barcodeModal.classList.add('hidden');
    barcodeInput.value = '';
    barcodeProductId.value = '';
    barcodeProductName.textContent = '';
  }

  async function handleSaveBarcode(event) {
    event.preventDefault();

    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    const id = barcodeProductId.value;
    const newBarcode = barcodeInput.value.trim();

    if (newBarcode === '') {
      mostrarMensaje(barcodeStatus, 'El código de barras no puede estar vacío.', 'error');
      return;
    }

    mostrarMensaje(barcodeStatus, 'Guardando...', 'info');

    try {
      const response = await fetch(`/api/products/${id}/barcode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: newBarcode })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(barcodeStatus, '¡Código guardado con éxito!', 'success');
      await cargarProductos();
      setTimeout(closeBarcodeModal, 1000);
    } catch (error) {
      console.error('Error guardando código de barras:', error);
      mostrarMensaje(barcodeStatus, error.message, 'error');
    }
  }

  async function handleDeleteBarcode() {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    const id = barcodeProductId.value;

    const confirmed = await showGlobalConfirm(
      '¿Estás seguro de que deseas eliminar el código de barras de este producto?',
      'Eliminar código de barras'
    );
    if (!confirmed) return;

    mostrarMensaje(barcodeStatus, 'Eliminando...', 'info');

    try {
      const response = await fetch(`/api/products/${id}/barcode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: null })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(barcodeStatus, 'Código eliminado con éxito.', 'success');
      await cargarProductos();
      setTimeout(closeBarcodeModal, 1000);
    } catch (error) {
      console.error('Error eliminando código de barras:', error);
      mostrarMensaje(barcodeStatus, error.message, 'error');
    }
  }

  // ==========================
  //   BUSCADOR / BARCODE SCAN
  // ==========================
  function handleSearchInput(event) {
    clearTimeout(searchTimeout);
    const input = event.target.value;

    clearTimeout(barcodeScanTimeout);
    barcodeBuffer += input.slice(barcodeBuffer.length);

    barcodeScanTimeout = setTimeout(() => {
      if (barcodeBuffer.length > 8 && barcodeBuffer.endsWith('\n')) {
        const scannedBarcode = barcodeBuffer.trim();
        console.log('Barcode scan detected:', scannedBarcode);
        searchInput.value = scannedBarcode;
        currentSearch = scannedBarcode;
        currentPage = 1;
        cargarProductos();
        barcodeBuffer = '';
      }
    }, 100);

    searchTimeout = setTimeout(() => {
      if (barcodeBuffer.endsWith('\n')) return;
      console.log('Manual search:', input);
      currentSearch = input;
      currentPage = 1;
      cargarProductos();
      barcodeBuffer = '';
    }, 300);
  }

  function handleSearchKeydown(event) {
    if (event.key === 'Enter') {
      clearTimeout(searchTimeout);
      clearTimeout(barcodeScanTimeout);

      let searchTerm = searchInput.value.trim();

      if (barcodeBuffer.trim() === searchTerm) {
        searchTerm = barcodeBuffer.trim();
      }

      console.log('Search triggered by Enter/Scan:', searchTerm);
      currentSearch = searchTerm;
      currentPage = 1;
      cargarProductos();
      barcodeBuffer = '';
      event.preventDefault();
    }
  }

  // ==========================
  //   GENERAR / DESCARGAR BARCODE
  // ==========================
  function generateRandomEAN13() {
    let code = '200';
    for (let i = 0; i < 9; i++) {
      code += Math.floor(Math.random() * 10);
    }
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
    }
    const checksum = (10 - (sum % 10)) % 10;
    return code + checksum;
  }

  function downloadBarcode(barcodeValue, productName) {
    const canvas = document.getElementById('barcode-canvas');
    const cleanProductName = productName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

    JsBarcode(canvas, barcodeValue, {
      format: 'EAN13',
      displayValue: true,
      fontSize: 18,
      margin: 10,
      width: 2,
      height: 100
    });

    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `${cleanProductName}-${barcodeValue}.png`;
    link.href = dataUrl;
    link.click();
  }

  async function handleGenerateBarcode(event) {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    const newBarcode = generateRandomEAN13();
    let productName = '';
    let targetInput;

    if (event.target.closest('#formCrearProducto')) {
      targetInput = prodBarcode;
      productName = prodNombre.value.trim() || 'producto-nuevo';
    } else if (event.target.closest('#form-barcode')) {
      targetInput = barcodeInput;
      productName = barcodeProductName.textContent.replace('Producto: ', '').trim() || 'producto-editado';
    } else {
      return;
    }

    targetInput.value = newBarcode;

    const confirmedDownload = await showGlobalConfirm(
      `Código generado: ${newBarcode}\n\n¿Deseas descargar la imagen del código de barras ahora?`,
      'Código de barras generado'
    );
    if (confirmedDownload) {
      downloadBarcode(newBarcode, productName);
    }
  }

  if (btnClearBarcode) {
    btnClearBarcode.addEventListener('click', () => {
      prodBarcode.value = '';
    });
  }

  const btnScanCamera = document.getElementById('btn-scan-camera');
  const readerCreate = document.getElementById('reader-create');
  let html5QrCode = null;
  let isScanning = false;

  async function stopCamera() {
    if (html5QrCode) {
      try {
        await html5QrCode.stop();
        await html5QrCode.clear();
      } catch (e) {
        console.warn("Error deteniendo cámara:", e);
      }
      html5QrCode = null;
    }
    isScanning = false;
    readerCreate.classList.add('hidden');
    btnScanCamera.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
      </svg>
    `;
    btnScanCamera.classList.replace('bg-red-100', 'bg-purple-100');
    btnScanCamera.classList.replace('text-red-700', 'text-purple-700');
  }

  async function startCamera() {
    try {
      isScanning = true;
      readerCreate.classList.remove('hidden');
      btnScanCamera.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
      `;
      btnScanCamera.classList.replace('bg-purple-100', 'bg-red-100');
      btnScanCamera.classList.replace('text-purple-700', 'text-red-700');

      html5QrCode = new Html5Qrcode("reader-create");
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          prodBarcode.value = decodedText;
          if (window.Toast) window.Toast.show("Código detectado: " + decodedText, "success");
          stopCamera();
        },
        (errorMessage) => { }
      );
    } catch (err) {
      console.error("Error al iniciar cámara:", err);
      let errorMsg = "No se pudo acceder a la cámara";

      if (!window.isSecureContext) {
        errorMsg = "ACCESO BLOQUEADO: Los navegadores bloquean la cámara en conexiones HTTP.\n\n" +
          "SOLUCIÓN:\n" +
          "1. En su móvil, abra Chrome y vaya a: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n" +
          "2. Agregue " + window.location.origin + " y reinicie Chrome.";
        await showGlobalAlert(errorMsg, "Error de Cámara");
      } else {
        if (window.Toast) window.Toast.show(errorMsg, "error");
      }
      stopCamera();
    }
  }

  if (btnScanCamera) {
    btnScanCamera.addEventListener('click', () => {
      if (!isScanning) startCamera();
      else stopCamera();
    });
  }

  if (btnModalGenerateBarcode) {
    btnModalGenerateBarcode.addEventListener('click', handleGenerateBarcode);
  }

  if (btnModalClearBarcode) {
    btnModalClearBarcode.addEventListener('click', () => {
      barcodeInput.value = '';
    });
  }

  // ==========================
  //   UTILIDAD: MENSAJES
  // ==========================
  // Theme Toggle Logic
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');

      // Sync with parent window (index.html)
      if (window.parent && window.parent.document && window.parent.document.body) {
        if (isDark) {
          window.parent.document.body.classList.add('dark-mode');
        } else {
          window.parent.document.body.classList.remove('dark-mode');
        }
      }
    });
  }

  // --- Override Global Alert/Confirm for Modern UI if desired, or just use Toast ---
  // Here we will use Toast for notifications instead of 'mostrarMensaje'

  // Reemplazar mostrarMensaje anterior por Toast si es compatible
  window.mostrarMensaje = function (elemento, mensaje, tipo = 'info', duration = 3000) {
    // 1. Always show modern Toast for success/error (User Request)
    if (tipo === 'success' || tipo === 'error' || !elemento) {
      let toastType = (tipo === 'error') ? 'error' : (tipo === 'success' ? 'success' : 'info');
      if (window.Toast) {
        window.Toast.show(mensaje, toastType, duration);
      }
    }

    // 2. Also update the DOM element if provided (Legacy/Form feedback)
    if (elemento && elemento.classList) {
      elemento.textContent = mensaje;
      if (tipo === 'success') {
        elemento.className = 'text-green-600 text-sm mt-3 text-center';
      } else if (tipo === 'error') {
        elemento.className = 'text-red-600 text-sm mt-3 text-center';
      } else {
        elemento.className = 'text-sm mt-3 text-center';
      }
    }
  };

  const btnScanCameraModal = document.getElementById('btn-scan-camera-modal');
  const readerModal = document.getElementById('reader-modal');
  let html5QrCodeModal = null;
  let isScanningModal = false;

  async function stopCameraModal() {
    if (html5QrCodeModal) {
      try {
        await html5QrCodeModal.stop();
        await html5QrCodeModal.clear();
      } catch (e) {
        console.warn("Error deteniendo cámara modal:", e);
      }
      html5QrCodeModal = null;
    }
    isScanningModal = false;
    if (readerModal) readerModal.classList.add('hidden');
    if (btnScanCameraModal) {
      btnScanCameraModal.innerHTML = `
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
        </svg>
      `;
      btnScanCameraModal.classList.replace('bg-red-100', 'bg-purple-100');
      btnScanCameraModal.classList.replace('text-red-700', 'text-purple-700');
    }
  }

  async function startCameraModal() {
    try {
      isScanningModal = true;
      if (readerModal) readerModal.classList.remove('hidden');
      if (btnScanCameraModal) {
        btnScanCameraModal.innerHTML = `
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        `;
        btnScanCameraModal.classList.replace('bg-purple-100', 'bg-red-100');
        btnScanCameraModal.classList.replace('text-purple-700', 'text-red-700');
      }

      html5QrCodeModal = new Html5Qrcode("reader-modal");
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      await html5QrCodeModal.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          if (barcodeInput) barcodeInput.value = decodedText;
          if (window.Toast) window.Toast.show("Código detectado: " + decodedText, "success");
          stopCameraModal();
        },
        (errorMessage) => { }
      );
    } catch (err) {
      console.error("Error al iniciar cámara modal:", err);
      let errorMsg = "No se pudo acceder a la cámara";

      if (!window.isSecureContext) {
        errorMsg = "ACCESO BLOQUEADO: Los navegadores bloquean la cámara en conexiones HTTP.\n\n" +
          "SOLUCIÓN:\n" +
          "1. En su móvil, abra Chrome y vaya a: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n" +
          "2. Agregue " + window.location.origin + " y reinicie Chrome.";
        await showGlobalAlert(errorMsg, "Error de Cámara");
      } else {
        if (window.Toast) window.Toast.show(errorMsg, "error");
      }
      stopCameraModal();
    }
  }

  if (btnScanCameraModal) {
    btnScanCameraModal.addEventListener('click', () => {
      if (!isScanningModal) startCameraModal();
      else stopCameraModal();
    });
  }

  // ==========================
  //   GESTOR DE CATEGORÍAS
  // ==========================
  async function openCategoryManager() {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    mostrarMensaje(categoryManagerStatus, 'Cargando categorías...', 'info');
    categoryManagerModal.classList.remove('hidden');

    try {
      const response = await fetch('/api/categories');
      if (!response.ok) throw new Error('No se pudieron cargar las categorías');
      const categories = await response.json();

      categoryListContainer.innerHTML = '';
      if (categories.length === 0) {
        categoryListContainer.innerHTML = '<p class="text-gray-500 text-center">No hay categorías para gestionar.</p>';
        return;
      }

      categories.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2 border rounded-md';
        div.innerHTML = `
          <input type="text" value="${cat.nombre}" data-id="${cat.id}" data-original-name="${cat.nombre}" class="input-text flex-1 category-name-input">
          <button data-id="${cat.id}" class="ml-2 p-2 text-green-600 hover:text-green-800 btn-save-category hidden">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
          </button>
          <button data-id="${cat.id}" class="ml-2 p-2 text-red-600 hover:text-red-800 btn-delete-category">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        `;
        categoryListContainer.appendChild(div);
      });

      mostrarMensaje(categoryManagerStatus, '', 'info');
    } catch (error) {
      console.error('Error abriendo gestor de categorías:', error);
      mostrarMensaje(categoryManagerStatus, error.message, 'error');
    }
  }

  function closeCategoryManager() {
    categoryManagerModal.classList.add('hidden');
    categoryListContainer.innerHTML = '';
    mostrarMensaje(categoryManagerStatus, '', 'info');
    inicializarDropdownsCategorias();
  }

  async function handleCategoryManagerClick(event) {
    const target = event.target.closest('button');
    if (!target) return;

    const id = target.dataset.id;
    if (target.classList.contains('btn-delete-category')) {
      const confirmed = await showGlobalConfirm(
        '¿Estás seguro de que quieres eliminar esta categoría? Esta acción no se puede deshacer.',
        'Eliminar categoría'
      );
      if (!confirmed) return;

      mostrarMensaje(categoryManagerStatus, 'Eliminando...', 'info');
      try {
        const response = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error desconocido');
        mostrarMensaje(categoryManagerStatus, 'Categoría eliminada.', 'success');
        openCategoryManager();
      } catch (error) {
        console.error('Error eliminando categoría:', error);
        mostrarMensaje(categoryManagerStatus, error.message, 'error');
      }
    }

    if (target.classList.contains('btn-save-category')) {
      const input = categoryListContainer.querySelector(`input[data-id="${id}"]`);
      const newName = input.value.trim();
      const originalName = input.dataset.originalName;

      if (newName === originalName) {
        input.classList.remove('border-blue-500');
        target.classList.add('hidden');
        return;
      }
      if (newName === '') {
        mostrarMensaje(categoryManagerStatus, 'El nombre no puede estar vacío.', 'error');
        return;
      }

      mostrarMensaje(categoryManagerStatus, 'Guardando...', 'info');
      try {
        const response = await fetch(`/api/categories/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error desconocido');

        mostrarMensaje(categoryManagerStatus, 'Categoría actualizada.', 'success');
        input.dataset.originalName = newName;
        input.classList.remove('border-blue-500');
        target.classList.add('hidden');

        await inicializarDropdownsCategorias();
        await cargarCategorias(editProdCategoriaSelect);
      } catch (error) {
        console.error('Error actualizando categoría:', error);
        mostrarMensaje(categoryManagerStatus, error.message, 'error');
      }
    }
  }

  function handleCategoryInputChange(event) {
    if (event.target.classList.contains('category-name-input')) {
      const input = event.target;
      const saveButton = input.parentElement.querySelector('.btn-save-category');
      if (input.value.trim() !== input.dataset.originalName && input.value.trim() !== '') {
        input.classList.add('border-blue-500');
        saveButton.classList.remove('hidden');
      } else {
        input.classList.remove('border-blue-500');
        saveButton.classList.add('hidden');
      }
    }
  }

  // ==========================
  //   GESTOR BULTOS
  // ==========================
  async function openBultoManager() {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    mostrarMensaje(bultoManagerStatus, 'Cargando productos...', 'info');
    bultoManagerModal.classList.remove('hidden');
    bultoListContainer.innerHTML = '';

    // Reset búsqueda
    bultoSearchTerm = '';
    if (bultoSearchInput) {
      bultoSearchInput.value = '';
    }

    try {
      const response = await fetch('/api/products/bultos');
      if (!response.ok) throw new Error('No se pudieron cargar los productos');
      const products = await response.json();

      console.log('Productos /api/products/bultos =>', products);

      bultoProducts = products || [];

      mostrarMensaje(bultoManagerStatus, '', 'info');
      renderBultoRows();
    } catch (error) {
      console.error('Error cargando productos por bulto:', error);
      mostrarMensaje(bultoManagerStatus, error.message, 'error');
      bultoListContainer.innerHTML = `
        <tr>
          <td colspan="7" class="px-4 py-3 text-center text-red-500">
            Error: ${error.message}
          </td>
        </tr>
      `;
    }
  }

  function handleBultoInput(event) {
    const target = event.target;
    if (!target.classList.contains('bulto-costo-input')) return;

    const id = target.dataset.id;
    const unidades = parseInt(target.dataset.unidades, 10);
    const nuevoCostoBulto = parseFloat(target.value) || 0;

    const unitCostCell = document.getElementById(`unit-cost-${id}`);
    const saveButton = target.closest('tr').querySelector('.btn-save-bulto');

    if (unidades > 0 && nuevoCostoBulto > 0) {
      const nuevoCostoUnitario = nuevoCostoBulto / unidades;
      unitCostCell.textContent = nuevoCostoUnitario.toFixed(4);
      saveButton.classList.remove('hidden');
    } else {
      unitCostCell.textContent = '0.0000';
      saveButton.classList.add('hidden');
    }
  }

  function handleBultoSearch(event) {
    bultoSearchTerm = event.target.value || '';
    renderBultoRows();
  }

  async function handleBultoSave(event) {
    const target = event.target;
    if (!target.classList.contains('btn-save-bulto')) return;

    const id = target.dataset.id;
    const tr = target.closest('tr');
    const input = tr.querySelector('.bulto-costo-input');
    const newCostoBulto = parseFloat(input.value);
    const unidades = parseInt(input.dataset.unidades, 10);

    if (isNaN(newCostoBulto) || newCostoBulto <= 0) {
      mostrarMensaje(bultoManagerStatus, 'El costo del bulto debe ser un número positivo.', 'error');
      return;
    }

    mostrarMensaje(bultoManagerStatus, `Guardando producto ID ${id}...`, 'info');

    try {
      const response = await fetch(`/api/products/${id}`);
      if (!response.ok) throw new Error('No se pudo cargar el producto para actualizar');
      const product = await response.json();

      product.costo_bulto = newCostoBulto;
      product.unidades_bulto = unidades;
      product.costo = newCostoBulto / unidades;

      const updateResponse = await fetch(`/api/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product)
      });

      const result = await updateResponse.json();
      if (!updateResponse.ok) throw new Error(result.error || 'Error al guardar');

      mostrarMensaje(bultoManagerStatus, `¡Producto ${product.nombre} actualizado!`, 'success');
      target.classList.add('hidden');
    } catch (error) {
      console.error('Error al guardar costo de bulto:', error);
      mostrarMensaje(bultoManagerStatus, error.message, 'error');
    }
  }

  function closeBultoManager() {
    bultoManagerModal.classList.add('hidden');
    bultoListContainer.innerHTML = '';
    mostrarMensaje(bultoManagerStatus, '', 'info');
    bultoProducts = [];
    bultoSearchTerm = '';
    if (bultoSearchInput) {
      bultoSearchInput.value = '';
    }
    cargarProductos(); // recarga la tabla principal
  }

  // ==========================
  //   PRESENTACIONES DE PRODUCTO
  // ==========================
  function renderPresentationRows(presentations) {
    if (!presentationListContainer) return;

    presentationListContainer.innerHTML = '';

    if (!presentations || presentations.length === 0) {
      presentationListContainer.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-3 text-center text-gray-500">
            No hay presentaciones registradas para este producto.
          </td>
        </tr>
      `;
      return;
    }

    presentations.forEach(p => {
      const tr = document.createElement('tr');
      // Backend nos envía ya moneda y precio. Si es legacy, moneda será VES o BCV y precio el valor.
      // precio_ves y precio_usd_bcv vienen calculados de referencia.
      const precioBase = parseFloat(p.precio || 0);
      const moneda = p.moneda || 'VES';
      const refVes = parseFloat(p.precio_ves || 0);
      const refUsd = parseFloat(p.precio_usd_bcv || 0);

      const monedaSelectHtml = `
        <select class="input-text w-24 text-xs px-1 py-1 pres-moneda-select" data-id="${p.id}">
          <option value="VES" ${moneda === 'VES' ? 'selected' : ''}>Bs</option>
          <option value="BCV" ${moneda === 'BCV' ? 'selected' : ''}>$BCV</option>
          <option value="PARALELO" ${moneda === 'PARALELO' ? 'selected' : ''}>$Personalizada</option>
          <option value="COP" ${moneda === 'COP' ? 'selected' : ''}>COP</option>
        </select>
      `;

      tr.innerHTML = `
        <td class="px-4 py-2 text-sm text-gray-900">
          <input
            type="text"
            class="input-text w-full pres-nombre-input"
            value="${escapeHtml(p.nombre)}"
            data-id="${p.id}"
          >
        </td>
        <td class="px-4 py-2 text-sm text-right text-gray-900">
          <input
            type="number"
            step="any"
            class="input-text w-24 text-right pres-unidades-input"
            value="${p.unidades_base}"
            data-id="${p.id}"
          >
        </td>
        <td class="px-4 py-2 text-sm text-right text-gray-900 flex items-center justify-end gap-1">
          <input
            type="number"
            step="any"
            class="input-text w-24 text-right pres-precio-input"
            value="${precioBase.toFixed(2)}"
            data-id="${p.id}"
          >
          ${monedaSelectHtml}
        </td>
        <td class="px-4 py-2 text-sm text-right text-gray-600 bg-gray-50">
          <div class="text-xs">
            <div>${refVes.toFixed(2)} Bs</div>
            <div>${refUsd.toFixed(2)} $</div>
          </div>
        </td>
        <td class="px-4 py-2 text-sm text-gray-900">
          <input
            type="text"
            class="input-text w-full pres-barcode-input"
            value="${p.barcode || ''}"
            data-id="${p.id}"
          >
        </td>
        <td class="px-4 py-2 text-sm text-right">
          <button
            class="text-xs text-blue-600 hover:underline btn-save-presentation"
            data-id="${p.id}"
          >
            Guardar
          </button>
          <button
            class="ml-2 text-xs text-red-600 hover:underline btn-delete-presentation"
            data-id="${p.id}"
          >
            Eliminar
          </button>
        </td>
      `;
      presentationListContainer.appendChild(tr);
    });
  }

  async function loadPresentationsForCurrentProduct() {
    if (!currentPresentationProductId || !presentationListContainer) return;

    mostrarMensaje(presentationStatus, 'Cargando presentaciones...', 'info');

    try {
      const response = await fetch(`/api/presentations?productId=${encodeURIComponent(currentPresentationProductId)}`);
      if (!response.ok) throw new Error('No se pudieron cargar las presentaciones');

      const data = await response.json();
      renderPresentationRows(data);
      mostrarMensaje(presentationStatus, '', 'info');
    } catch (error) {
      console.error('Error cargando presentaciones:', error);
      mostrarMensaje(presentationStatus, `Error: ${error.message}`, 'error');
      presentationListContainer.innerHTML = `
        <tr>
          <td colspan="6" class="px-4 py-3 text-center text-red-500">
            Error al cargar presentaciones.
          </td>
        </tr>
      `;
    }
  }

  function resetPresentationForm() {
    if (presentationForm) {
      presentationForm.reset();
    }
    if (presentationIdInput) presentationIdInput.value = '';
    if (presentationPriceCurrencySelect) {
      presentationPriceCurrencySelect.value = 'VES';
      presentationPriceCurrencySelect.dataset.last = 'VES';
    }
  }

  async function openPresentationModal(productId, productName) {
    hideAllPopovers();

    if (!presentationModal) {
      console.warn('Modal de presentaciones no está definido en el HTML.');
      return;
    }

    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    currentPresentationProductId = productId;
    if (presentationProductName) {
      presentationProductName.textContent = productName || '';
    }

    resetPresentationForm();
    mostrarMensaje(presentationStatus, '', 'info');

    presentationModal.classList.remove('hidden');
    await loadPresentationsForCurrentProduct();
  }

  function closePresentationModal() {
    if (!presentationModal) return;
    presentationModal.classList.add('hidden');
    currentPresentationProductId = null;
    if (presentationListContainer) {
      presentationListContainer.innerHTML = '';
    }
    resetPresentationForm();
    mostrarMensaje(presentationStatus, '', 'info');
  }

  function handlePresentationPriceCurrencyChange() {
    if (!rates || !presentationPriceInput || !presentationPriceCurrencySelect) return;

    const bcv = parseFloat(rates.BCV || 0);
    const paralelo = parseFloat(rates.PARALELO || 0);
    const cop = parseFloat(rates.COP || 0);

    const last = presentationPriceCurrencySelect.dataset.last || 'VES';
    const current = presentationPriceCurrencySelect.value || 'VES';

    if (last === current) return;

    const currentVal = parseFloat(presentationPriceInput.value);
    if (isNaN(currentVal) || currentVal <= 0) {
      presentationPriceCurrencySelect.dataset.last = current;
      return;
    }

    // Convertir LAST -> VES
    let valEnVes = currentVal;
    if (last === 'BCV') valEnVes = currentVal * bcv;
    else if (last === 'PARALELO') valEnVes = currentVal * paralelo;
    else if (last === 'COP') valEnVes = currentVal * cop;

    // Convertir VES -> CURRENT
    let newVal = valEnVes;
    if (current === 'BCV' && bcv > 0) newVal = valEnVes / bcv;
    else if (current === 'PARALELO' && paralelo > 0) newVal = valEnVes / paralelo;
    else if (current === 'COP' && cop > 0) newVal = valEnVes / cop;

    presentationPriceInput.value = newVal.toFixed(2);
    presentationPriceCurrencySelect.dataset.last = current;
  }

  async function handlePresentationSubmit(event) {
    event.preventDefault();

    if (!currentPresentationProductId) {
      mostrarMensaje(presentationStatus, 'Error: no hay producto seleccionado.', 'error');
      return;
    }

    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    const nombre = presentationNameInput ? presentationNameInput.value.trim() : '';
    const unidades = presentationUnitsInput ? parseFloat(presentationUnitsInput.value) : 0;
    const precio = presentationPriceInput ? parseFloat(presentationPriceInput.value) : 0;
    const barcode = presentationBarcodeInput ? presentationBarcodeInput.value.trim() : '';
    const moneda = presentationPriceCurrencySelect ? presentationPriceCurrencySelect.value : 'VES';

    if (!nombre) {
      mostrarMensaje(presentationStatus, 'El nombre de la presentación es obligatorio.', 'error');
      return;
    }
    if (isNaN(unidades) || unidades <= 0) {
      mostrarMensaje(presentationStatus, 'Las unidades base deben ser un número mayor a 0.', 'error');
      return;
    }
    if (isNaN(precio) || precio < 0) {
      mostrarMensaje(presentationStatus, 'El precio debe ser un número válido.', 'error');
      return;
    }

    mostrarMensaje(presentationStatus, 'Guardando presentación...', 'info');

    try {
      const payload = {
        producto_id: parseInt(currentPresentationProductId, 10),
        nombre,
        unidades_base: unidades,
        precio: precio,
        moneda: moneda,
        barcode: barcode || null
      };

      const response = await fetch('/api/presentations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(presentationStatus, 'Presentación creada con éxito.', 'success');
      resetPresentationForm();
      await loadPresentationsForCurrentProduct();
    } catch (error) {
      console.error('Error creando presentación:', error);
      mostrarMensaje(presentationStatus, `Error: ${error.message}`, 'error');
    }
  }

  async function handlePresentationListClick(event) {
    const btn = event.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    if (!id) return;

    // ------- GUARDAR PRESENTACIÓN -------
    if (btn.classList.contains('btn-save-presentation')) {
      const hasPermission = await window.parent.askForAdminPassword();
      if (!hasPermission) return;

      const row = btn.closest('tr');
      if (!row) return;

      const nombreInput = row.querySelector('.pres-nombre-input');
      const unidadesInput = row.querySelector('.pres-unidades-input');
      const precioInput = row.querySelector('.pres-precio-input');
      const monedaSelect = row.querySelector('.pres-moneda-select');
      const barcodeInput = row.querySelector('.pres-barcode-input');

      const nombre = nombreInput ? nombreInput.value.trim() : '';
      const unidades = unidadesInput ? parseFloat(unidadesInput.value) : 0;
      const precio = precioInput ? parseFloat(precioInput.value) : 0;
      const moneda = monedaSelect ? monedaSelect.value : 'VES';
      const barcode = barcodeInput ? barcodeInput.value.trim() : '';

      if (!nombre) {
        mostrarMensaje(presentationStatus, 'El nombre de la presentación es obligatorio.', 'error');
        return;
      }
      if (isNaN(unidades) || unidades <= 0) {
        mostrarMensaje(presentationStatus, 'Las unidades base deben ser un número mayor a 0.', 'error');
        return;
      }
      if (isNaN(precio) || precio < 0) {
        mostrarMensaje(presentationStatus, 'El precio debe ser válido.', 'error');
        return;
      }

      mostrarMensaje(presentationStatus, 'Guardando cambios...', 'info');

      try {
        const payload = {
          nombre,
          unidades_base: unidades,
          precio: precio,
          moneda: moneda,
          barcode: barcode || null
        };

        const response = await fetch(`/api/presentations/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error desconocido');

        mostrarMensaje(presentationStatus, 'Presentación actualizada con éxito.', 'success');
        await loadPresentationsForCurrentProduct();
      } catch (error) {
        console.error('Error actualizando presentación:', error);
        mostrarMensaje(presentationStatus, `Error: ${error.message}`, 'error');
      }
    }

    // ------- ELIMINAR PRESENTACIÓN -------
    if (btn.classList.contains('btn-delete-presentation')) {
      const hasPermission = await window.parent.askForAdminPassword();
      if (!hasPermission) return;

      const confirmed = await showGlobalConfirm(
        '¿Estás seguro de que deseas eliminar esta presentación? Solo se ocultará (soft delete).',
        'Eliminar presentación'
      );
      if (!confirmed) return;

      mostrarMensaje(presentationStatus, 'Eliminando presentación...', 'info');

      try {
        const response = await fetch(`/api/presentations/${id}`, {
          method: 'DELETE'
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Error desconocido');

        mostrarMensaje(presentationStatus, 'Presentación eliminada con éxito.', 'success');
        await loadPresentationsForCurrentProduct();
      } catch (error) {
        console.error('Error eliminando presentación:', error);
        mostrarMensaje(presentationStatus, `Error: ${error.message}`, 'error');
      }
    }
  }

  // ==========================
  //   MODAL STOCK RÁPIDO
  // ==========================
  const stockModal = document.getElementById('stock-modal');
  const btnCloseStockModal = document.getElementById('btn-close-stock-modal');
  const btnCancelStock = document.getElementById('btn-cancel-stock');
  const formStock = document.getElementById('form-stock');
  const stockProductId = document.getElementById('stock-product-id');
  const stockProductName = document.getElementById('stock-product-name');
  const stockQuantity = document.getElementById('stock-quantity');
  const stockModalStatus = document.getElementById('stock-modal-status');
  const stockModalTitle = document.getElementById('stock-modal-title');
  const stockLabel = document.getElementById('stock-label');
  const stockHint = document.getElementById('stock-hint');
  const stockModeInput = document.getElementById('stock-mode');

  function openStockModal(id, name, mode = 'add') {
    hideAllPopovers();
    if (!stockModal) return;

    const isRemove = mode === 'remove';

    stockProductId.value = id;
    stockModeInput.value = mode;
    stockProductName.textContent = `Producto: ${name}`;
    stockQuantity.value = '';

    if (stockModalTitle) stockModalTitle.textContent = isRemove ? 'Quitar Stock' : 'Agregar Stock';
    if (stockLabel) stockLabel.textContent = isRemove ? 'Cantidad a quitar' : 'Cantidad a agregar';
    if (stockHint) stockHint.textContent = isRemove
      ? 'Ingresa la cantidad a restar del inventario.'
      : 'Ingresa la cantidad a sumar al inventario.';
    if (stockQuantity) stockQuantity.placeholder = isRemove ? 'Ej: 3' : 'Ej: 5';

    mostrarMensaje(stockModalStatus, '', 'info');
    stockModal.classList.remove('hidden');
    stockQuantity.focus();
  }

  function closeStockModal() {
    if (stockModal) stockModal.classList.add('hidden');
    if (formStock) formStock.reset();
  }

  async function handleStockSubmit(event) {
    event.preventDefault();

    const id = stockProductId.value;
    const rawQty = parseFloat(stockQuantity.value);
    const mode = stockModeInput ? stockModeInput.value : 'add';

    if (isNaN(rawQty) || rawQty === 0) {
      mostrarMensaje(stockModalStatus, 'Ingresa una cantidad válida (diferente de 0).', 'error');
      return;
    }

    if (rawQty < 0) {
      mostrarMensaje(stockModalStatus, 'Ingresa un número positivo.', 'error');
      return;
    }

    const qty = mode === 'remove' ? -Math.abs(rawQty) : Math.abs(rawQty);

    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    mostrarMensaje(stockModalStatus, 'Actualizando...', 'info');

    try {
      const response = await fetch(`/api/products/${id}/stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error desconocido');

      mostrarMensaje(stockModalStatus, 'Stock actualizado.', 'success');
      await cargarProductos();
      setTimeout(closeStockModal, 800);
    } catch (error) {
      console.error('Error actualizando stock:', error);
      mostrarMensaje(stockModalStatus, error.message, 'error');
    }
  }

  if (btnCloseStockModal) btnCloseStockModal.addEventListener('click', closeStockModal);
  if (btnCancelStock) btnCancelStock.addEventListener('click', closeStockModal);
  if (formStock) formStock.addEventListener('submit', handleStockSubmit);

  // ==========================
  //   INIT
  // ==========================
  checkAdminPasswordEnabled();
  inicializarDropdownsCategorias();
  cargarProductos();

  // ----- Eventos principales -----
  formCrearProducto.addEventListener('submit', handleCrearProducto);
  formEditarProducto.addEventListener('submit', handleGuardarCambios);
  btnCancelarEdicion.addEventListener('click', cerrarModalEdicion);
  tablaInventarioBody.addEventListener('click', handleTablaClick);
  btnMostrarFormulario.addEventListener('click', toggleFormularioCrear);
  prodCategoriaSelect.addEventListener('change', () => handleCategoryChange(prodCategoriaSelect, prodCategoriaNueva));
  editProdCategoriaSelect.addEventListener('change', () => handleCategoryChange(editProdCategoriaSelect, editProdCategoriaNueva));

  btnCostoUnidad.addEventListener('click', () => toggleCostMode('unidad', false));
  btnCostoBulto.addEventListener('click', () => toggleCostMode('bulto', false));

  btnEditCostoUnidad.addEventListener('click', () => toggleCostMode('unidad', true));
  btnEditCostoBulto.addEventListener('click', () => toggleCostMode('bulto', true));

  editProdCostoBulto.addEventListener('input', calcularCostoUnitarioEdit);
  editProdUnidadesBulto.addEventListener('input', calcularCostoUnitarioEdit);

  // ----- Sincronización EDITAR: % ↔ precio final (moneda seleccionada) -----
  if (editProdGanancia) {
    editProdGanancia.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentaje();
    });
  }

  if (editProdPrecioFinal) {
    editProdPrecioFinal.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPorcentajeDesdePrecioFinal();
    });
  }

  if (editProdCosto) {
    editProdCosto.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentaje();
    });
  }

  if (editProdMonedaCosto) {
    editProdMonedaCosto.addEventListener('change', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentaje();
    });
  }

  // Cambio de moneda del precio final (EDITAR) -> solo convierte el valor actual
  if (editProdPrecioMoneda) {
    editProdPrecioMoneda.dataset.last = editProdPrecioMoneda.value || 'VES';
    editProdPrecioMoneda.addEventListener('change', async () => {
      await ensureRatesLoaded();
      handlePrecioMonedaChangeEditar();
    });
  }

  // ----- Sincronización CREAR: % ↔ precio final (moneda seleccionada) -----
  if (prodGanancia && prodPrecioFinal) {
    prodGanancia.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentajeCrear();
    });

    prodPrecioFinal.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPorcentajeDesdePrecioFinalCrear();
    });
  }

  if (prodCosto) {
    prodCosto.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentajeCrear();
    });
  }

  if (prodCostoBulto) {
    prodCostoBulto.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentajeCrear();
    });
  }

  if (prodUnidadesBulto) {
    prodUnidadesBulto.addEventListener('input', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentajeCrear();
    });
  }

  if (prodMonedaCosto) {
    prodMonedaCosto.addEventListener('change', async () => {
      await ensureRatesLoaded();
      calcularPrecioFinalDesdePorcentajeCrear();
    });
  }

  // Cambio de moneda del precio final (CREAR) -> solo convierte el valor actual
  if (prodPrecioMoneda) {
    prodPrecioMoneda.dataset.last = prodPrecioMoneda.value || 'VES';
    prodPrecioMoneda.addEventListener('change', async () => {
      await ensureRatesLoaded();
      handlePrecioMonedaChangeCrear();
    });
  }

  // ----- Buscador -----
  searchInput.addEventListener('input', handleSearchInput);
  searchInput.addEventListener('keydown', handleSearchKeydown);

  btnAnterior.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      cargarProductos();
    }
  });
  btnSiguiente.addEventListener('click', () => {
    currentPage++;
    cargarProductos();
  });

  // ----- Gestor categorías -----
  btnManageCategories.addEventListener('click', openCategoryManager);
  btnManageCategoriesEdit.addEventListener('click', openCategoryManager);
  btnCloseCategoryModal.addEventListener('click', closeCategoryManager);
  categoryListContainer.addEventListener('click', handleCategoryManagerClick);
  categoryListContainer.addEventListener('input', handleCategoryInputChange);

  // ----- Gestor bultos -----
  btnManageBultos.addEventListener('click', openBultoManager);
  btnCloseBultoModal.addEventListener('click', closeBultoManager);
  bultoListContainer.addEventListener('input', handleBultoInput);
  bultoListContainer.addEventListener('click', handleBultoSave);

  if (bultoSearchInput) {
    bultoSearchInput.addEventListener('input', handleBultoSearch);
  }

  // ----- Barcode modal -----
  formBarcode.addEventListener('submit', handleSaveBarcode);
  btnDeleteBarcode.addEventListener('click', handleDeleteBarcode);
  if (btnCloseBarcodeModal) {
    btnCloseBarcodeModal.addEventListener('click', closeBarcodeModal);
  }

  // ----- Barcode en creación -----
  if (btnGenerateBarcode) {
    btnGenerateBarcode.addEventListener('click', handleGenerateBarcode);
  }

  // ----- Toggle datos sensibles -----
  if (btnToggleSensitive) {
    btnToggleSensitive.addEventListener('click', async () => {
      if (!adminPasswordEnabled) return;
      if (!sensitiveDataVisible) {
        const hasPermission = await window.parent.askForAdminPassword();
        if (!hasPermission) return;
        sensitiveDataVisible = true;
        setSensitiveColumnsVisible(true);
      } else {
        sensitiveDataVisible = false;
        setSensitiveColumnsVisible(false);
      }
    });
  }

  // ----- Modal de presentaciones -----
  if (presentationForm && presentationModal) {
    presentationForm.addEventListener('submit', handlePresentationSubmit);
  }

  if (btnClosePresentationModal && presentationModal) {
    btnClosePresentationModal.addEventListener('click', closePresentationModal);
  }
  if (presentationListContainer && presentationModal) {
    presentationListContainer.addEventListener('click', handlePresentationListClick);
  }
  if (presentationPriceCurrencySelect && presentationModal) {
    presentationPriceCurrencySelect.dataset.last = presentationPriceCurrencySelect.value || 'VES';
    presentationPriceCurrencySelect.addEventListener('change', async () => {
      await ensureRatesLoaded();
      handlePresentationPriceCurrencyChange();
    });
  }

  // ==========================
  //   MASS ACTIONS LOGIC
  // ==========================
  function updateBulkBar() {
    const count = selectedIds.size;
    if (selectedCountSpan) selectedCountSpan.textContent = `${count} seleccionados`;

    if (bulkActionsBar) {
      if (massMode) {
        bulkActionsBar.classList.remove('hidden');
        bulkActionsBar.style.display = 'flex'; // Force visibility
        // Optional: Disable buttons if count === 0
        if (btnBulkDelete) {
          btnBulkDelete.classList.remove('hidden');
          btnBulkDelete.disabled = count === 0;
          if (count === 0) btnBulkDelete.classList.add('opacity-50', 'cursor-not-allowed');
          else btnBulkDelete.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        if (btnBulkProfit) {
          btnBulkProfit.classList.remove('hidden');
          btnBulkProfit.disabled = count === 0;
          if (count === 0) btnBulkProfit.classList.add('opacity-50', 'cursor-not-allowed');
          else btnBulkProfit.classList.remove('opacity-50', 'cursor-not-allowed');
        }
        if (btnBulkSelectAll) {
          btnBulkSelectAll.classList.remove('hidden');
          // Select All is always enabled in Mass Mode
          btnBulkSelectAll.disabled = false;
          btnBulkSelectAll.classList.remove('opacity-50', 'cursor-not-allowed');
        }
      } else {
        bulkActionsBar.classList.add('hidden');
        bulkActionsBar.style.display = 'none';
      }
    }

    // Update Select All Checkbox state
    const checkboxes = document.querySelectorAll('.product-checkbox');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked) && checkboxes.length > 0;
    const someChecked = Array.from(checkboxes).some(cb => cb.checked);

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = allChecked;
      selectAllCheckbox.indeterminate = someChecked && !allChecked;
    }
  }

  function handleSelectAllChange(e) {
    const isChecked = e.target.checked;
    const checkboxes = document.querySelectorAll('.product-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
      if (isChecked) {
        selectedIds.add(cb.value);
      } else {
        selectedIds.delete(cb.value);
      }
    });
    updateBulkBar();
  }

  function handleBtnSelectAllClick() {
    if (!selectAllCheckbox) return;
    selectAllCheckbox.checked = !selectAllCheckbox.checked;
    // Trigger change event manually
    selectAllCheckbox.dispatchEvent(new Event('change'));
  }

  function handleCheckboxChange(e) {
    if (e.target.classList.contains('product-checkbox')) {
      if (e.target.checked) {
        selectedIds.add(e.target.value);
      } else {
        selectedIds.delete(e.target.value);
      }
      updateBulkBar();
    }
  }

  // --- Mass Delete ---
  async function handleBulkDeleteClick() {
    if (selectedIds.size === 0) return;

    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    const confirmed = await showGlobalConfirm(
      `¿Estás seguro de que deseas eliminar ${selectedIds.size} productos seleccionados? Esta acción no se puede deshacer.`,
      'Eliminación Masiva'
    );
    if (!confirmed) return;

    try {
      const response = await fetch('/api/products/mass-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error en eliminación masiva');

      mostrarMensaje(productStatus, result.message || 'Eliminación completada', 'success');
      selectedIds.clear();
      updateBulkBar();
      cargarProductos();
    } catch (error) {
      console.error('Error mass delete:', error);
      mostrarMensaje(productStatus, error.message, 'error');
    }
  }

  // --- Bulk Profit Update ---
  function handleBulkProfitClick() {
    if (bulkProfitModal) {
      bulkProfitModal.classList.remove('hidden');
      if (bulkProfitInput) {
        bulkProfitInput.value = '';
        bulkProfitInput.focus();
      }
      if (bulkCategoryOptionContainer) bulkCategoryOptionContainer.classList.add('hidden');
    }
  }

  async function handleConfirmBulkProfit() {
    const percentage = parseFloat(bulkProfitInput.value);
    if (isNaN(percentage)) {
      alert('Por favor ingresa un porcentaje válido.');
      return;
    }

    const scopeRadio = document.querySelector('input[name="bulkScope"]:checked');
    const scope = scopeRadio ? scopeRadio.value : 'selected';

    if (scope === 'selected' && selectedIds.size === 0) {
      alert('No hay productos seleccionados.');
      return;
    }

    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) return;

    const confirmed = await showGlobalConfirm(
      `Se actualizará la ganancia al ${percentage}% para: ${scope === 'all' ? 'TODO EL INVENTARIO' : selectedIds.size + ' productos'}.\n¿Confirmar?`,
      'Actualización Masiva'
    );
    if (!confirmed) return;

    try {
      const payload = {
        scope,
        percentage,
        ids: scope === 'selected' ? Array.from(selectedIds) : [],
        category: null
      };

      const response = await fetch('/api/products/mass-update-profit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Error en actualización masiva');

      mostrarMensaje(productStatus, result.message || 'Actualización completada', 'success');
      if (bulkProfitModal) bulkProfitModal.classList.add('hidden');
      selectedIds.clear();
      updateBulkBar();
      cargarProductos();
    } catch (error) {
      console.error('Error bulk update:', error);
      mostrarMensaje(productStatus, error.message, 'error');
    }
  }

  function toggleMassMode() {
    massMode = !massMode;
    const btn = document.getElementById('btnToggleMassMode');
    const header = document.getElementById('mass-action-header');

    console.log('Toggle Mass Mode:', massMode);
    if (massMode) {
      if (btn) {
        btn.innerHTML = `
            <svg class="w-5 h-5 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            <span class="hidden md:inline">Cancelar</span>
            `;
        btn.classList.replace('bg-gray-600', 'bg-red-600');
        btn.classList.replace('hover:bg-gray-700', 'hover:bg-red-700');
      }
      if (selectAllCheckbox) {
        selectAllCheckbox.classList.remove('hidden');
      }
      const headerText = document.getElementById('headerNombreText');
      if (headerText) headerText.classList.add('ml-6');

      // Force render to show checkboxes
      cargarProductos();
      updateBulkBar();
    } else {
      if (btn) {
        btn.innerHTML = `
            <svg class="w-5 h-5 md:mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
            <span class="hidden md:inline">Gestión Masiva</span>
            `;
        btn.classList.replace('bg-red-600', 'bg-gray-600');
        btn.classList.replace('hover:bg-red-700', 'hover:bg-gray-700');
      }

      if (selectAllCheckbox) {
        selectAllCheckbox.classList.add('hidden');
      }
      const headerText = document.getElementById('headerNombreText');
      if (headerText) headerText.classList.remove('ml-6');

      selectedIds.clear();
      updateBulkBar();
      cargarProductos();
    }
  }

  // Events for Mass Actions
  if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', handleSelectAllChange);
  if (tablaInventarioBody) tablaInventarioBody.addEventListener('change', handleCheckboxChange);
  if (btnBulkDelete) btnBulkDelete.addEventListener('click', handleBulkDeleteClick);
  if (btnBulkProfit) btnBulkProfit.addEventListener('click', handleBulkProfitClick);
  if (btnConfirmBulkProfit) btnConfirmBulkProfit.addEventListener('click', handleConfirmBulkProfit);
  if (btnCancelBulkProfit) btnCancelBulkProfit.addEventListener('click', () => bulkProfitModal && bulkProfitModal.classList.add('hidden'));

  const btnToggleMassMode = document.getElementById('btnToggleMassMode');
  if (btnToggleMassMode) btnToggleMassMode.addEventListener('click', toggleMassMode);
  if (btnBulkSelectAll) btnBulkSelectAll.addEventListener('click', handleBtnSelectAllClick);

  // Initialize UI State
  updateBulkBar();

  // --- MODAL DE DISCREPANCIAS (NexusAI) ---
  const discrepanciesModal = document.getElementById('discrepancies-modal');
  const discrepanciesTableBody = document.getElementById('discrepancies-table-body');
  const noDiscrepanciesMsg = document.getElementById('no-discrepancies-msg');
  const btnCloseDiscrepancies = document.getElementById('btn-close-discrepancies');
  const btnCloseDiscrepanciesFooter = document.getElementById('btn-close-discrepancies-footer');
  const btnPrintReport = document.getElementById('btn-print-report');
  const btnClearCounts = document.getElementById('btn-clear-counts');
  const btnApplyInventory = document.getElementById('btn-apply-inventory');

  async function loadDiscrepancies() {
    try {
      const resp = await fetch('/api/products/inventory/discrepancies');
      const data = await resp.json();

      discrepanciesTableBody.innerHTML = '';
      if (!data || data.length === 0) {
        if (noDiscrepanciesMsg) noDiscrepanciesMsg.classList.remove('hidden');
        discrepanciesModal && discrepanciesModal.classList.remove('hidden');
        return;
      }

      if (noDiscrepanciesMsg) noDiscrepanciesMsg.classList.add('hidden');
      data.forEach(p => {
        const row = document.createElement('tr');
        const diff = parseFloat(p.diferencia) || 0;
        const diffClass = diff > 0 ? 'text-green-600 font-bold' : (diff < 0 ? 'text-red-600 font-bold' : 'text-gray-500');
        const diffSymbol = diff > 0 ? '+' : '';

        row.innerHTML = `
          <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
            <div class="font-medium">${p.nombre}</div>
            <div class="text-[10px] text-gray-400 uppercase tracking-tighter">${p.categoria}</div>
          </td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-center text-gray-400 font-mono">${p.stock}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-center font-bold text-blue-600 font-mono">${p.conteo_fisico}</td>
          <td class="px-6 py-4 whitespace-nowrap text-sm text-center ${diffClass} font-mono">${diffSymbol}${diff}</td>
        `;
        discrepanciesTableBody.appendChild(row);
      });

      discrepanciesModal && discrepanciesModal.classList.remove('hidden');
    } catch (error) {
      console.error("Error loading discrepancies:", error);
      showGlobalAlert("Error al cargar el reporte de discrepancias.", "Error");
    }
  }

  if (btnCloseDiscrepancies) btnCloseDiscrepancies.addEventListener('click', () => discrepanciesModal.classList.add('hidden'));
  if (btnCloseDiscrepanciesFooter) btnCloseDiscrepanciesFooter.addEventListener('click', () => discrepanciesModal.classList.add('hidden'));
  if (btnPrintReport) btnPrintReport.addEventListener('click', () => window.print());

  if (btnClearCounts) {
    btnClearCounts.addEventListener('click', async () => {
      const ok = await showGlobalConfirm("¿Reiniciar el conteo? Se borrará todo lo capturado por voz/texto.", "Reiniciar");
      if (!ok) return;
      try {
        await fetch('/api/ai/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: "Nexus vamos a hacer inventario" })
        });
        discrepanciesModal.classList.add('hidden');
        window.location.reload();
      } catch (e) { console.error(e); }
    });
  }

  if (btnApplyInventory) {
    btnApplyInventory.addEventListener('click', async () => {
      const ok = await showGlobalConfirm("¿Aplicar ajustes? El stock del sistema se actualizará con el conteo físico realizado.", "Aplicar Ajustes");
      if (!ok) return;
      try {
        const resp = await fetch('/api/products/inventory/apply', { method: 'POST' });
        const result = await resp.json();
        if (resp.ok) {
          showGlobalAlert(result.message || "Ajustes aplicados correctamente.", "Éxito");
          discrepanciesModal.classList.add('hidden');
          window.location.reload();
        } else {
          showGlobalAlert(result.error || "Error al aplicar ajustes.", "Error");
        }
      } catch (e) { console.error(e); }
    });
  }

  // Verificar si venimos desde el reporte de la IA
  // --- MODAL TOMA DE INVENTARIO (AUDITORÍA MANUAL) ---
  const btnHacerInventario = document.getElementById('btnHacerInventario');
  const inventoryAuditModal = document.getElementById('inventory-audit-modal');
  const btnCloseAudit = document.getElementById('btn-close-audit');
  const auditSearchInput = document.getElementById('audit-search');
  const auditTableBody = document.getElementById('audit-table-body');
  const auditProgressSpan = document.getElementById('audit-progress');
  const btnAuditAll = document.getElementById('btn-audit-all');
  const btnAuditPending = document.getElementById('btn-audit-pending');
  const btnViewDiscrepanciesFromAudit = document.getElementById('btn-view-discrepancies-from-audit');
  const btnFinishAudit = document.getElementById('btn-finish-audit');

  const btnToggleCameraAudit = document.getElementById('btn-toggle-camera-audit');
  const auditScannerContainer = document.getElementById('audit-scanner-container');
  const auditReaderDiv = document.getElementById('audit-reader');

  let auditProducts = [];
  let auditFilter = 'all';
  let html5QrCodeAudit = null;
  let isAuditScanning = false;

  async function openAuditModal() {
    try {
      const resp = await fetch('/api/products?limit=2000');
      const data = await resp.json();
      auditProducts = data.products || [];

      renderAuditTable();
      if (inventoryAuditModal) inventoryAuditModal.classList.remove('hidden');
    } catch (e) {
      console.error(e);
      showGlobalAlert("Error al cargar productos para inventario.", "Error");
    }
  }

  function renderAuditTable() {
    if (!auditTableBody) return;
    const term = auditSearchInput ? auditSearchInput.value.toLowerCase() : '';

    let filtered = auditProducts.filter(p => {
      const matchSearch = p.nombre.toLowerCase().includes(term) || (p.barcode && String(p.barcode).includes(term));
      if (!matchSearch) return false;

      if (auditFilter === 'pending') {
        return p.conteo_fisico === null || p.conteo_fisico === undefined;
      }
      return true;
    });

    auditTableBody.innerHTML = '';
    filtered.forEach(p => {
      const tr = document.createElement('tr');
      const isCounted = p.conteo_fisico !== null && p.conteo_fisico !== undefined;

      tr.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="font-medium text-gray-900">${p.nombre}</div>
          <div class="text-[10px] text-gray-400 uppercase tracking-tighter">${p.categoria || 'Sin Categoría'}</div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-center text-gray-500 font-mono">${p.stock}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center">
          <input type="number" step="any" 
                 class="w-24 px-2 py-1 border border-gray-300 rounded text-center focus:ring-emerald-500 focus:border-emerald-500 audit-input" 
                 value="${isCounted ? p.conteo_fisico : ''}"
                 placeholder="0.00"
                 data-id="${p.id}">
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-right">
          <span class="px-2 py-1 rounded-full text-[10px] uppercase font-bold ${isCounted ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'}">
            ${isCounted ? 'Contado' : 'Pendiente'}
          </span>
        </td>
      `;
      auditTableBody.appendChild(tr);
    });

    if (auditProgressSpan) {
      const countedCount = auditProducts.filter(p => p.conteo_fisico !== null && p.conteo_fisico !== undefined).length;
      auditProgressSpan.textContent = `${countedCount}/${auditProducts.length}`;
    }
  }

  if (btnHacerInventario) btnHacerInventario.addEventListener('click', openAuditModal);
  if (btnCloseAudit) btnCloseAudit.addEventListener('click', () => inventoryAuditModal.classList.add('hidden'));

  if (auditSearchInput) {
    auditSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(renderAuditTable, 300);
    });
  }

  if (btnAuditAll) btnAuditAll.addEventListener('click', () => { auditFilter = 'all'; renderAuditTable(); });
  if (btnAuditPending) btnAuditPending.addEventListener('click', () => { auditFilter = 'pending'; renderAuditTable(); });

  if (auditTableBody) {
    auditTableBody.addEventListener('change', async (e) => {
      if (e.target.classList.contains('audit-input')) {
        const id = e.target.dataset.id;
        const val = e.target.value;
        const numVal = parseFloat(val);

        if (isNaN(numVal)) return;

        try {
          const resp = await fetch(`/api/products/${id}/physical-count`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conteo: numVal })
          });
          if (resp.ok) {
            const prod = auditProducts.find(p => p.id == id);
            if (prod) prod.conteo_fisico = numVal;

            const row = e.target.closest('tr');
            const badge = row.querySelector('span');
            badge.className = 'px-2 py-1 rounded-full text-[10px] uppercase font-bold bg-emerald-100 text-emerald-700';
            badge.textContent = 'Contado';

            if (auditProgressSpan) {
              const countedCount = auditProducts.filter(p => p.conteo_fisico !== null && p.conteo_fisico !== undefined).length;
              auditProgressSpan.textContent = `${countedCount}/${auditProducts.length}`;
            }
          }
        } catch (e) { console.error(e); }
      }
    });
  }

  if (btnViewDiscrepanciesFromAudit) {
    btnViewDiscrepanciesFromAudit.addEventListener('click', () => {
      stopCameraAudit();
      inventoryAuditModal.classList.add('hidden');
      loadDiscrepancies();
    });
  }

  if (btnFinishAudit) {
    btnFinishAudit.addEventListener('click', () => {
      stopCameraAudit();
      inventoryAuditModal.classList.add('hidden');
      loadDiscrepancies();
    });
  }

  if (btnCloseAudit) btnCloseAudit.addEventListener('click', () => {
    stopCameraAudit();
    inventoryAuditModal.classList.add('hidden');
  });

  if (btnToggleCameraAudit) {
    btnToggleCameraAudit.addEventListener('click', () => {
      if (!isAuditScanning) startCameraAudit();
      else stopCameraAudit();
    });
  }

  async function startCameraAudit() {
    try {
      isAuditScanning = true;
      auditScannerContainer.classList.remove('hidden');
      btnToggleCameraAudit.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
        </svg>
        Detener
      `;
      btnToggleCameraAudit.classList.replace('bg-blue-600', 'bg-red-600');

      html5QrCodeAudit = new Html5Qrcode("audit-reader");
      const config = { fps: 10, qrbox: { width: 250, height: 250 } };

      await html5QrCodeAudit.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          handleScannedProduct(decodedText);
        },
        (errorMessage) => {}
      );
    } catch (err) {
      console.error(err);
      isAuditScanning = false;
      auditScannerContainer.classList.add('hidden');
      showGlobalAlert("No se pudo acceder a la cámara.", "Error");
    }
  }

  async function stopCameraAudit() {
    if (html5QrCodeAudit) {
      try {
        await html5QrCodeAudit.stop();
        await html5QrCodeAudit.clear();
      } catch (e) {}
      html5QrCodeAudit = null;
    }
    isAuditScanning = false;
    auditScannerContainer.classList.add('hidden');
    btnToggleCameraAudit.innerHTML = `
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      Cámara
    `;
    btnToggleCameraAudit.classList.replace('bg-red-600', 'bg-blue-600');
  }

  function handleScannedProduct(barcode) {
    // Detener la cámara inmediatamente para liberar la vista en móviles
    stopCameraAudit();

    const product = auditProducts.find(p => String(p.barcode) === String(barcode));
    
    // Restablecer filtros para asegurar que el producto sea visible
    auditFilter = 'all';
    if (auditSearchInput) auditSearchInput.value = '';
    renderAuditTable();

    if (!product) {
       showGlobalAlert("Producto no encontrado en este inventario.", "Aviso");
       return;
    }

    const row = auditTableBody.querySelector(`input[data-id="${product.id}"]`)?.closest('tr');
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const input = row.querySelector('input');
      if (input) {
        setTimeout(() => {
          input.focus();
          input.select();
          // Feedback visual
          row.classList.add('bg-emerald-50');
          setTimeout(() => row.classList.remove('bg-emerald-50'), 2000);
        }, 300);
      }
    }
  }

  const btnExportPdf = document.getElementById('btn-export-pdf');

  if (btnExportPdf) {
    btnExportPdf.addEventListener('click', () => {
      // Usamos window.print() para que el usuario guarde como PDF
      // Podríamos usar jsPDF pero window.print es más nativo y respeta estilos CSS
      const originalTitle = document.title;
      document.title = "Reporte_Discrepancias_NexusPOS_" + new Date().toLocaleDateString();
      window.print();
      document.title = originalTitle;
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('view') === 'discrepancies') {
    loadDiscrepancies().then(() => {
      if (urlParams.get('action') === 'download') {
        // Damos un poco más de tiempo para que el DOM y el motor de impresión se estabilicen
        setTimeout(() => {
          if (btnExportPdf) {
            window.focus();
            btnExportPdf.click();
          }
        }, 2000);
      }
    });
  }
});
// ==========================

// ============================================================
// BUSCADOR DE IMÁGENES - GOOGLE
// ============================================================
(function () {
  function openGoogleImages(query, urlInputId) {
    const urlInput = document.getElementById(urlInputId);
    let finalQuery = query;

    // Si el usuario escribió el nombre en el campo de URL por error (no es un link válido)
    if (urlInput && urlInput.value) {
      const val = urlInput.value.trim();
      if (!val.startsWith('http') && !val.startsWith('data:')) {
        finalQuery = val;
        // Limpiamos el campo de URL para que no lo guarde como si fuera una imagen rota
        urlInput.value = '';
        urlInput.dispatchEvent(new Event('input')); // Forzar actualización de vista previa
      }
    }

    if (!finalQuery) {
      alert('Por favor, ingresa el nombre del producto primero.');
      return;
    }
    const url = 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(finalQuery);
    window.open(url, '_blank', 'width=1024,height=768');
  }

  const btnCreate = document.getElementById('btn-google-search-create');
  if (btnCreate) {
    btnCreate.addEventListener('click', () => {
      const nombre = (document.getElementById('prod-nombre') || {}).value || '';
      openGoogleImages(nombre, 'prod-imagen-url');
    });
  }

  const btnEdit = document.getElementById('btn-google-search-edit');
  if (btnEdit) {
    btnEdit.addEventListener('click', () => {
      const nombre = (document.getElementById('edit-prod-nombre') || {}).value || '';
      openGoogleImages(nombre, 'edit-prod-imagen-url');
    });
  }
})();
// ============================================================
