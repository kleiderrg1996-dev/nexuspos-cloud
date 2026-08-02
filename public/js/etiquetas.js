/**
 * ========================================================/**
 *  DISEÑADOR VISUAL DE ETIQUETAS – NexusPOS
 *  Drag & Drop · Resize · Font Control · Templates · Print
 * ========================================================
 */
document.addEventListener('DOMContentLoaded', () => {
  // ─── Helpers ──────────────────────────────────────
  const $ = id => document.getElementById(id);
  const toNum = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
  const fmt2 = n => toNum(n).toFixed(2);
  const escHtml = t => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const normalize = s => String(s || '').toLowerCase().trim();

  // ─── MM <-> PX conversion ────────────────────────
  // We use 3.7795275591 px per mm (96 DPI)
  const MM_PX = 3.7795275591;
  const mmToPx = mm => mm * MM_PX;
  const pxToMm = px => px / MM_PX;

  // ─── Scale factor for canvas display ─────────────
  // We scale up so the label is visible on screen
  let SCALE = 3; // 3x for comfortable editing

  const scaledMmToPx = mm => mm * MM_PX * SCALE;
  const scaledPxToMm = px => px / MM_PX / SCALE;

  // ─── State ────────────────────────────────────────
  let zoom = 100;
  let labelWidthMm = 66;
  let labelHeightMm = 35;
  let labelBgColor = '#ffffff';
  let businessName = 'NexusPOS';
  let customText = '';
  let selectedElementId = null;

  // Products
  let allProducts = [];
  let filteredProducts = [];
  const productSelection = new Map(); // id -> { checked, qty }

  // ─── Element definitions ──────────────────────────
  // Each element has: id, type, visible, x/y/w/h (in mm), font settings
  const defaultElements = {
    businessName: {
      id: 'businessName',
      type: 'text',
      label: 'Nombre del Negocio',
      visible: true,
      x: 1, y: 1, w: 30, h: 5,
      fontSize: 7, fontWeight: '600', fontColor: '#666666',
      textAlign: 'left',
      getText: () => businessName
    },
    productName: {
      id: 'productName',
      type: 'text',
      label: 'Nombre del Producto',
      visible: true,
      x: 1, y: 6, w: 38, h: 10,
      fontSize: 11, fontWeight: '800', fontColor: '#000000',
      textAlign: 'left',
      getText: () => 'Nombre del Producto'
    },
    priceUSD: {
      id: 'priceUSD',
      type: 'text',
      label: 'Precio USD',
      visible: true,
      x: 42, y: 1, w: 23, h: 14,
      fontSize: 16, fontWeight: '900', fontColor: '#000000',
      textAlign: 'right',
      getText: () => '$ 12.50'
    },
    priceVES: {
      id: 'priceVES',
      type: 'text',
      label: 'Precio VES',
      visible: true,
      x: 42, y: 15, w: 23, h: 8,
      fontSize: 11, fontWeight: '700', fontColor: '#333333',
      textAlign: 'right',
      getText: () => 'Bs 520.00'
    },
    barcode: {
      id: 'barcode',
      type: 'barcode',
      label: 'Código de Barras',
      visible: true,
      x: 1, y: 22, w: 40, h: 10,
      barcodeHeight: 28,
      barcodeWidth: 1.2,
      getText: () => '7591234567890'
    },
    barcodeText: {
      id: 'barcodeText',
      type: 'text',
      label: 'Texto del Código',
      visible: true,
      x: 1, y: 31, w: 40, h: 4,
      fontSize: 6, fontWeight: '400', fontColor: '#666666',
      textAlign: 'left',
      getText: () => '7591234567890'
    },
    labelBorder: {
      id: 'labelBorder',
      type: 'border',
      label: 'Borde',
      visible: true
    },
    customText: {
      id: 'customText',
      type: 'text',
      label: 'Texto Personalizado',
      visible: false,
      x: 1, y: 17, w: 30, h: 5,
      fontSize: 7, fontWeight: '400', fontColor: '#888888',
      textAlign: 'left',
      getText: () => customText || 'Texto aquí'
    },
    priceLabel: {
      id: 'priceLabel',
      type: 'text',
      label: 'Etiqueta Precio',
      visible: false,
      x: 50, y: 0, w: 15, h: 4,
      fontSize: 6, fontWeight: '600', fontColor: '#999999',
      textAlign: 'right',
      getText: () => 'USD'
    }
  };

  // Deep clone
  let elements = JSON.parse(JSON.stringify(defaultElements));
  // Restore getText functions
  function restoreGetTextFns() {
    elements.businessName.getText = () => businessName;
    elements.productName.getText = () => 'Nombre del Producto';
    elements.priceUSD.getText = () => '$ 12.50';
    elements.priceVES.getText = () => 'Bs 520.00';
    elements.barcode.getText = () => '7591234567890';
    elements.barcodeText.getText = () => '7591234567890';
    elements.customText.getText = () => customText || 'Texto aquí';
    elements.priceLabel.getText = () => 'USD';
  }
  restoreGetTextFns();

  // ─── DOM refs ─────────────────────────────────────
  const labelCanvas = $('labelCanvas');
  const canvasContainer = $('canvasContainer');
  const canvasArea = $('canvasArea');
  const printRoot = $('printRoot');

  // Left panel
  const canvasWidthMm = $('canvasWidthMm');
  const canvasHeightMm = $('canvasHeightMm');
  const labelSizePreset = $('labelSizePreset');
  const labelBgColorInput = $('labelBgColor');
  const businessNameValue = $('businessNameValue');
  const customTextValue = $('customTextValue');

  // Print config
  const printMode = $('printMode');
  const sheetPrintOpts = $('sheetPrintOpts');
  const thermalPrintOpts = $('thermalPrintOpts');
  const printSheetFormat = $('printSheetFormat');
  const printCols = $('printCols');
  const printGapX = $('printGapX');
  const printGapY = $('printGapY');
  const printPad = $('printPad');
  const thermalRotate = $('thermalRotate');

  // Right panel
  const propsEmpty = $('propsEmpty');
  const propsPanel = $('propsPanel');
  const propElementTitle = $('propElementTitle');
  const propX = $('propX');
  const propY = $('propY');
  const propW = $('propW');
  const propH = $('propH');
  const propFontSize = $('propFontSize');
  const propFontWeight = $('propFontWeight');
  const propFontColor = $('propFontColor');
  const propFontGroup = $('propFontGroup');
  const propBarcodeGroup = $('propBarcodeGroup');
  const propBarcodeHeight = $('propBarcodeHeight');
  const propBarcodeWidth = $('propBarcodeWidth');

  // Bottom bar info
  const infoSize = $('infoSize');
  const infoZoom = $('infoZoom');
  const infoElements = $('infoElements');
  const infoProductCount = $('infoProductCount');
  const infoTotalLabels = $('infoTotalLabels');

  // Zoom
  const zoomLabel = $('zoomLabel');

  // ─── Render Canvas ────────────────────────────────
  function renderCanvas() {
    const wPx = scaledMmToPx(labelWidthMm);
    const hPx = scaledMmToPx(labelHeightMm);

    labelCanvas.style.width = wPx + 'px';
    labelCanvas.style.height = hPx + 'px';
    labelCanvas.style.background = labelBgColor;

    canvasContainer.style.transform = `scale(${zoom / 100})`;

    // Update border visibility
    const borderEl = $('labelBorderEl');
    if (borderEl) {
      borderEl.style.display = elements.labelBorder.visible ? 'block' : 'none';
      borderEl.style.border = elements.labelBorder.visible ? '1px solid #000' : 'none';
    }

    // Remove old element DOM nodes
    labelCanvas.querySelectorAll('.label-element').forEach(el => el.remove());

    // Render each element
    Object.values(elements).forEach(el => {
      if (!el.visible || el.type === 'border') return;
      renderElement(el);
    });

    // Update info bar
    infoSize.textContent = `${labelWidthMm} × ${labelHeightMm} mm`;
    infoZoom.textContent = `${zoom}%`;
    zoomLabel.textContent = `${zoom}%`;
    infoElements.textContent = Object.values(elements).filter(e => e.visible).length;

    updateProductCounters();
  }

  function renderElement(el) {
    const div = document.createElement('div');
    div.className = 'label-element' + (selectedElementId === el.id ? ' selected' : '');
    div.dataset.elId = el.id;

    const xPx = scaledMmToPx(el.x);
    const yPx = scaledMmToPx(el.y);
    const wPx = scaledMmToPx(el.w);
    const hPx = scaledMmToPx(el.h);

    div.style.left = xPx + 'px';
    div.style.top = yPx + 'px';
    div.style.width = wPx + 'px';
    div.style.height = hPx + 'px';

    if (el.type === 'text') {
      const content = document.createElement('div');
      content.className = 'element-content';
      content.style.fontSize = (el.fontSize * SCALE) + 'pt';
      content.style.fontWeight = el.fontWeight;
      content.style.color = el.fontColor;
      content.style.alignItems = 'flex-start';
      content.style.justifyContent = el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start';
      content.style.lineHeight = '1.2';
      content.style.fontFamily = "'Inter', Arial, sans-serif";
      content.style.wordBreak = 'break-word';
      content.style.whiteSpace = 'normal';
      content.textContent = el.getText();
      div.appendChild(content);
    } else if (el.type === 'barcode') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.dataset.barcode = el.getText();
      div.appendChild(svg);

      // Render barcode after append
      setTimeout(() => {
        if (typeof JsBarcode === 'function') {
          try {
            JsBarcode(svg, el.getText(), {
              format: 'CODE128',
              displayValue: false,
              margin: 0,
              height: el.barcodeHeight * SCALE,
              width: el.barcodeWidth * SCALE
            });
          } catch (e) {
            console.warn('Barcode error:', e);
          }
        }
      }, 10);
    }

    // Resize handles
    ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].forEach(dir => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${dir}`;
      handle.dataset.dir = dir;
      div.appendChild(handle);
    });

    labelCanvas.appendChild(div);
  }

  // ─── Selection ────────────────────────────────────
  function selectElement(elId) {
    selectedElementId = elId;
    renderCanvas();
    updatePropsPanel();

    // Highlight in left panel
    document.querySelectorAll('.element-item').forEach(item => {
      item.classList.toggle('active', item.dataset.el === elId);
    });
  }

  function deselectAll() {
    selectedElementId = null;
    renderCanvas();
    updatePropsPanel();
    document.querySelectorAll('.element-item').forEach(item => item.classList.remove('active'));
  }

  function updatePropsPanel() {
    if (!selectedElementId || !elements[selectedElementId]) {
      propsEmpty.style.display = 'flex';
      propsPanel.style.display = 'none';
      return;
    }

    const el = elements[selectedElementId];
    propsEmpty.style.display = 'none';
    propsPanel.style.display = 'block';

    propElementTitle.textContent = el.label || el.id;

    propX.value = el.x?.toFixed(1) || '0';
    propY.value = el.y?.toFixed(1) || '0';
    propW.value = el.w?.toFixed(1) || '10';
    propH.value = el.h?.toFixed(1) || '5';

    if (el.type === 'text') {
      propFontGroup.style.display = 'block';
      propBarcodeGroup.style.display = 'none';
      propFontSize.value = el.fontSize;
      propFontWeight.value = el.fontWeight;
      propFontColor.value = el.fontColor;

      // Update align buttons
      document.querySelectorAll('.align-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.align === el.textAlign);
      });
    } else if (el.type === 'barcode') {
      propFontGroup.style.display = 'none';
      propBarcodeGroup.style.display = 'block';
      propBarcodeHeight.value = el.barcodeHeight;
      propBarcodeWidth.value = el.barcodeWidth;
    } else {
      propFontGroup.style.display = 'none';
      propBarcodeGroup.style.display = 'none';
    }
  }

  // ─── Drag & Resize ───────────────────────────────
  let dragState = null;

  labelCanvas.addEventListener('mousedown', e => {
    const handle = e.target.closest('.resize-handle');
    const elDiv = e.target.closest('.label-element');

    if (!elDiv) {
      deselectAll();
      return;
    }

    const elId = elDiv.dataset.elId;
    selectElement(elId);

    const el = elements[elId];
    if (!el || el.type === 'border') return;

    e.preventDefault();

    const canvasRect = labelCanvas.getBoundingClientRect();
    const actualScale = canvasRect.width / scaledMmToPx(labelWidthMm);

    if (handle) {
      // Resize
      dragState = {
        type: 'resize',
        elId,
        dir: handle.dataset.dir,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startX: el.x,
        startY: el.y,
        startW: el.w,
        startH: el.h,
        actualScale
      };
    } else {
      // Drag
      dragState = {
        type: 'drag',
        elId,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startX: el.x,
        startY: el.y,
        actualScale
      };
    }
  });

  window.addEventListener('mousemove', e => {
    if (!dragState) return;
    e.preventDefault();

    const el = elements[dragState.elId];
    if (!el) return;

    const dx = (e.clientX - dragState.startMouseX) / dragState.actualScale;
    const dy = (e.clientY - dragState.startMouseY) / dragState.actualScale;

    const dxMm = scaledPxToMm(dx);
    const dyMm = scaledPxToMm(dy);

    if (dragState.type === 'drag') {
      el.x = clamp(dragState.startX + dxMm, 0, labelWidthMm - el.w);
      el.y = clamp(dragState.startY + dyMm, 0, labelHeightMm - el.h);
    } else if (dragState.type === 'resize') {
      const dir = dragState.dir;
      let newX = dragState.startX;
      let newY = dragState.startY;
      let newW = dragState.startW;
      let newH = dragState.startH;

      if (dir.includes('e')) newW = Math.max(3, dragState.startW + dxMm);
      if (dir.includes('w')) {
        newW = Math.max(3, dragState.startW - dxMm);
        newX = dragState.startX + dxMm;
      }
      if (dir.includes('s')) newH = Math.max(2, dragState.startH + dyMm);
      if (dir.includes('n')) {
        newH = Math.max(2, dragState.startH - dyMm);
        newY = dragState.startY + dyMm;
      }

      el.x = clamp(newX, 0, labelWidthMm - 3);
      el.y = clamp(newY, 0, labelHeightMm - 2);
      el.w = clamp(newW, 3, labelWidthMm - el.x);
      el.h = clamp(newH, 2, labelHeightMm - el.y);
    }

    renderCanvas();
    updatePropsPanel();
  });

  window.addEventListener('mouseup', () => {
    dragState = null;
  });

  // ─── Click on canvas background deselects ────────
  canvasArea.addEventListener('mousedown', e => {
    if (e.target === canvasArea || e.target === canvasContainer) {
      deselectAll();
    }
  });

  // ─── Element list events ──────────────────────────
  document.querySelectorAll('.element-item').forEach(item => {
    const elId = item.dataset.el;

    item.addEventListener('click', e => {
      if (e.target.closest('.element-toggle')) return;
      if (elements[elId]) selectElement(elId);
    });
  });

  document.querySelectorAll('.element-toggle').forEach(toggle => {
    const elId = toggle.dataset.elToggle;

    toggle.addEventListener('click', e => {
      e.stopPropagation();
      if (!elements[elId]) return;
      elements[elId].visible = !elements[elId].visible;
      toggle.classList.toggle('on', elements[elId].visible);

      if (!elements[elId].visible && selectedElementId === elId) {
        deselectAll();
      }
      renderCanvas();
    });
  });

  // ─── Property panel events ───────────────────────
  function onPropChange() {
    if (!selectedElementId || !elements[selectedElementId]) return;
    const el = elements[selectedElementId];

    el.x = toNum(propX.value, el.x);
    el.y = toNum(propY.value, el.y);
    el.w = toNum(propW.value, el.w);
    el.h = toNum(propH.value, el.h);

    if (el.type === 'text') {
      el.fontSize = toNum(propFontSize.value, el.fontSize);
      el.fontWeight = propFontWeight.value;
      el.fontColor = propFontColor.value;
    }

    if (el.type === 'barcode') {
      el.barcodeHeight = toNum(propBarcodeHeight.value, el.barcodeHeight);
      el.barcodeWidth = toNum(propBarcodeWidth.value, el.barcodeWidth);
    }

    renderCanvas();
  }

  [propX, propY, propW, propH, propFontSize, propFontWeight, propFontColor, propBarcodeHeight, propBarcodeWidth].forEach(input => {
    if (input) input.addEventListener('input', onPropChange);
  });

  // Align buttons
  document.querySelectorAll('.align-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!selectedElementId || !elements[selectedElementId]) return;
      const el = elements[selectedElementId];
      if (el.type !== 'text') return;

      el.textAlign = btn.dataset.align;
      document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCanvas();
    });
  });

  // ─── Label size controls ─────────────────────────
  const sizePresets = {
    '66x35': { w: 66, h: 35 },
    '66x27': { w: 66, h: 27 },
    '99x38': { w: 99, h: 38 },
    '50x25': { w: 50, h: 25 },
    '80x50': { w: 80, h: 50 },
    '58x40': { w: 58, h: 40 },
    '100x50': { w: 100, h: 50 },
    '100x70': { w: 100, h: 70 },
  };

  canvasWidthMm.addEventListener('input', () => {
    labelWidthMm = toNum(canvasWidthMm.value, 66);
    labelSizePreset.value = '';
    renderCanvas();
  });

  canvasHeightMm.addEventListener('input', () => {
    labelHeightMm = toNum(canvasHeightMm.value, 35);
    labelSizePreset.value = '';
    renderCanvas();
  });

  labelSizePreset.addEventListener('change', () => {
    const preset = sizePresets[labelSizePreset.value];
    if (preset) {
      labelWidthMm = preset.w;
      labelHeightMm = preset.h;
      canvasWidthMm.value = preset.w;
      canvasHeightMm.value = preset.h;
      renderCanvas();
    }
  });

  labelBgColorInput.addEventListener('input', () => {
    labelBgColor = labelBgColorInput.value;
    renderCanvas();
  });

  businessNameValue.addEventListener('input', () => {
    businessName = businessNameValue.value || 'NexusPOS';
    localStorage.setItem('nexuspos_business_name', businessName);
    renderCanvas();
  });

  customTextValue.addEventListener('input', () => {
    customText = customTextValue.value;
    renderCanvas();
  });

  // ─── Tabs ─────────────────────────────────────────
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      $('tab' + capitalize(tab.dataset.tab)).classList.add('active');
    });
  });

  function capitalize(s) {
    const map = { elements: 'Elements', labelsize: 'LabelSize', printcfg: 'PrintCfg' };
    return map[s] || s;
  }

  // ─── Zoom ─────────────────────────────────────────
  $('zoomIn').addEventListener('click', () => { zoom = clamp(zoom + 10, 30, 300); renderCanvas(); });
  $('zoomOut').addEventListener('click', () => { zoom = clamp(zoom - 10, 30, 300); renderCanvas(); });
  $('zoomFit').addEventListener('click', () => {
    const areaW = canvasArea.clientWidth - 60;
    const areaH = canvasArea.clientHeight - 60;
    const canvasW = scaledMmToPx(labelWidthMm);
    const canvasH = scaledMmToPx(labelHeightMm);
    zoom = Math.round(Math.min(areaW / canvasW, areaH / canvasH) * 100);
    zoom = clamp(zoom, 30, 300);
    renderCanvas();
  });

  // Mouse wheel zoom
  canvasArea.addEventListener('wheel', e => {
    if (e.ctrlKey) {
      e.preventDefault();
      zoom = clamp(zoom + (e.deltaY > 0 ? -5 : 5), 30, 300);
      renderCanvas();
    }
  }, { passive: false });

  // ─── Print mode switching ─────────────────────────
  printMode.addEventListener('change', () => {
    if (printMode.value === 'SHEET') {
      sheetPrintOpts.style.display = 'block';
      thermalPrintOpts.style.display = 'none';
    } else {
      sheetPrintOpts.style.display = 'none';
      thermalPrintOpts.style.display = 'block';
    }
  });

  // ─── Keyboard shortcuts ──────────────────────────
  window.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't delete, just hide the element
      if (selectedElementId && elements[selectedElementId]) {
        elements[selectedElementId].visible = false;
        const toggle = document.querySelector(`[data-el-toggle="${selectedElementId}"]`);
        if (toggle) toggle.classList.remove('on');
        deselectAll();
      }
    }

    if (e.key === 'Escape') {
      deselectAll();
    }

    // Arrow keys for nudge
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedElementId) {
      e.preventDefault();
      const el = elements[selectedElementId];
      if (!el || el.type === 'border') return;
      const step = e.shiftKey ? 1 : 0.25;

      if (e.key === 'ArrowLeft') el.x = clamp(el.x - step, 0, labelWidthMm - el.w);
      if (e.key === 'ArrowRight') el.x = clamp(el.x + step, 0, labelWidthMm - el.w);
      if (e.key === 'ArrowUp') el.y = clamp(el.y - step, 0, labelHeightMm - el.h);
      if (e.key === 'ArrowDown') el.y = clamp(el.y + step, 0, labelHeightMm - el.h);

      renderCanvas();
      updatePropsPanel();
    }
  });

  // ─── PRODUCTS ─────────────────────────────────────
  async function fetchAllProducts() {
    allProducts = [];
    const limit = 200;
    let page = 1;
    let totalPages = 1;

    try {
      while (page <= totalPages) {
        const params = new URLSearchParams();
        params.set('search', '');
        params.set('page', String(page));
        params.set('limit', String(limit));

        const resp = await fetch(`/api/products?${params.toString()}`);
        if (!resp.ok) throw new Error('Error cargando productos');

        const data = await resp.json();
        const list = Array.isArray(data.products) ? data.products : [];
        totalPages = toNum(data.totalPages, 1);
        allProducts.push(...list);
        page++;
      }

      // Init selection
      allProducts.forEach(p => {
        const id = String(p.id);
        if (!productSelection.has(id)) {
          productSelection.set(id, { checked: false, qty: 1 });
        }
      });

      filteredProducts = [...allProducts];
      renderProductList();
      updateProductCounters();
    } catch (err) {
      console.error(err);
      $('productList').innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger)">${err.message}</div>`;
    }
  }

  function renderProductList() {
    const container = $('productList');
    if (!filteredProducts.length) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">No hay productos</div>';
      return;
    }

    container.innerHTML = filteredProducts.map(p => {
      const id = String(p.id);
      const st = productSelection.get(id) || { checked: false, qty: 1 };
      const usd = fmt2(p.precio_final_usd_bcv);
      const ves = fmt2(p.precio_final_ves);

      return `
        <div class="product-row" data-pid="${id}">
          <input type="checkbox" ${st.checked ? 'checked' : ''} data-product-check="${id}">
          <div class="product-row-info">
            <div class="product-row-name">${escHtml(p.nombre)}</div>
            <div class="product-row-meta">${escHtml(p.categoria || '')} · $${usd} · Bs ${ves}</div>
          </div>
          <div class="product-row-qty">
            <input type="number" min="1" value="${st.qty}" data-product-qty="${id}">
          </div>
        </div>
      `;
    }).join('');
  }

  function updateProductCounters() {
    let selCount = 0;
    let labelCount = 0;
    for (const [, st] of productSelection) {
      if (st.checked) {
        selCount++;
        labelCount += Math.max(1, toNum(st.qty, 1));
      }
    }
    infoProductCount.textContent = selCount;
    infoTotalLabels.textContent = labelCount;
    const modalSelCount = $('modalSelectedCount');
    const modalTotalLabels = $('modalTotalLabels');
    if (modalSelCount) modalSelCount.textContent = selCount;
    if (modalTotalLabels) modalTotalLabels.textContent = labelCount;

    // Update mobile badge
    const badge = $('mobileProductBadge');
    if (badge) {
      if (selCount > 0) {
        badge.style.display = 'flex';
        badge.textContent = selCount;
      } else {
        badge.style.display = 'none';
      }
    }
  }

  // Product list events (delegated)
  $('productList').addEventListener('change', e => {
    const checkId = e.target.dataset.productCheck;
    if (checkId) {
      const st = productSelection.get(checkId) || { checked: false, qty: 1 };
      st.checked = e.target.checked;
      productSelection.set(checkId, st);
      updateProductCounters();
    }
  });

  $('productList').addEventListener('input', e => {
    const qtyId = e.target.dataset.productQty;
    if (qtyId) {
      const st = productSelection.get(qtyId) || { checked: false, qty: 1 };
      st.qty = Math.max(1, toNum(e.target.value, 1));
      productSelection.set(qtyId, st);
      updateProductCounters();
    }
  });

  $('productSearchInput').addEventListener('input', e => {
    const term = normalize(e.target.value);
    if (!term) {
      filteredProducts = [...allProducts];
    } else {
      filteredProducts = allProducts.filter(p => {
        const hay = [p.nombre, p.categoria, p.proveedor, p.barcode].map(normalize).join(' ');
        return hay.includes(term);
      });
    }
    renderProductList();
  });

  $('btnSelectAllProducts').addEventListener('click', () => {
    filteredProducts.forEach(p => {
      const id = String(p.id);
      const st = productSelection.get(id) || { checked: false, qty: 1 };
      st.checked = true;
      productSelection.set(id, st);
    });
    renderProductList();
    updateProductCounters();
  });

  $('btnDeselectAllProducts').addEventListener('click', () => {
    for (const [id, st] of productSelection) {
      st.checked = false;
    }
    renderProductList();
    updateProductCounters();
  });

  $('btnReloadProducts').addEventListener('click', fetchAllProducts);

  // ─── Modals ───────────────────────────────────────
  $('btnProducts').addEventListener('click', () => {
    $('productsModal').classList.add('open');
  });
  $('closeProductsModal').addEventListener('click', () => {
    $('productsModal').classList.remove('open');
  });
  $('closeProductsModalBtn').addEventListener('click', () => {
    $('productsModal').classList.remove('open');
  });

  $('btnTemplates').addEventListener('click', () => {
    $('templatesModal').classList.add('open');
    renderTemplatesList();
  });
  $('closeTemplatesModal').addEventListener('click', () => {
    $('templatesModal').classList.remove('open');
  });

  // Close modals on overlay click
  ['productsModal', 'templatesModal'].forEach(id => {
    $(id).addEventListener('click', e => {
      if (e.target === $(id)) $(id).classList.remove('open');
    });
  });

  // ─── Templates ────────────────────────────────────
  function getTemplateData() {
    // Serialize current state (without getText functions)
    const elData = {};
    Object.entries(elements).forEach(([key, el]) => {
      const copy = { ...el };
      delete copy.getText;
      elData[key] = copy;
    });
    return {
      labelWidthMm,
      labelHeightMm,
      labelBgColor,
      elements: elData,
      printMode: printMode.value,
      printCols: printCols.value,
      printGapX: printGapX.value,
      printGapY: printGapY.value,
      printPad: printPad.value,
      printSheetFormat: printSheetFormat.value
    };
  }

  function loadTemplateData(data) {
    labelWidthMm = toNum(data.labelWidthMm, 66);
    labelHeightMm = toNum(data.labelHeightMm, 35);
    labelBgColor = data.labelBgColor || '#ffffff';

    // Merge elements
    if (data.elements) {
      Object.entries(data.elements).forEach(([key, saved]) => {
        if (elements[key]) {
          const getText = elements[key].getText;
          Object.assign(elements[key], saved);
          elements[key].getText = getText;
        }
      });
    }

    // Print config
    if (data.printMode) printMode.value = data.printMode;
    if (data.printCols) printCols.value = data.printCols;
    if (data.printGapX) printGapX.value = data.printGapX;
    if (data.printGapY) printGapY.value = data.printGapY;
    if (data.printPad) printPad.value = data.printPad;
    if (data.printSheetFormat) printSheetFormat.value = data.printSheetFormat;

    // UI sync
    canvasWidthMm.value = labelWidthMm;
    canvasHeightMm.value = labelHeightMm;
    labelBgColorInput.value = labelBgColor;

    // Sync toggles
    Object.entries(elements).forEach(([key, el]) => {
      const toggle = document.querySelector(`[data-el-toggle="${key}"]`);
      if (toggle) toggle.classList.toggle('on', el.visible);
    });

    printMode.dispatchEvent(new Event('change'));
    deselectAll();
    renderCanvas();
  }

  function getSavedTemplates() {
    try {
      return JSON.parse(localStorage.getItem('nexuspos_label_templates') || '[]');
    } catch { return []; }
  }

  function saveTemplates(list) {
    localStorage.setItem('nexuspos_label_templates', JSON.stringify(list));
  }

  function renderTemplatesList() {
    const list = getSavedTemplates();
    const container = $('templatesList');

    // Add default templates
    const defaults = [
      { name: '📋 Estándar (66×35)', isDefault: true, data: getDefaultTemplate('66x35') },
      { name: '📋 Compacta (66×27)', isDefault: true, data: getDefaultTemplate('66x27') },
      { name: '📋 Grande (99×38)', isDefault: true, data: getDefaultTemplate('99x38') },
      { name: '📋 Térmica 80×50', isDefault: true, data: getDefaultTemplate('80x50') },
      { name: '📋 Solo Precio Grande', isDefault: true, data: getDefaultTemplate('priceFocus') },
    ];

    const allTemplates = [...defaults, ...list.map(t => ({ ...t, isDefault: false }))];

    if (!allTemplates.length) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted)">No hay plantillas guardadas</div>';
      return;
    }

    container.innerHTML = allTemplates.map((t, i) => `
      <div class="template-card" data-tpl-idx="${t.isDefault ? 'default-' + i : (i - defaults.length)}">
        <div class="template-card-preview">
          <div style="padding:3px;font-size:5px;color:#333;line-height:1.2;">
            <div style="font-size:4px;color:#999;">${escHtml(t.data?.labelWidthMm || 66)}×${escHtml(t.data?.labelHeightMm || 35)}</div>
            <div style="font-weight:800;font-size:7px;">$12.50</div>
          </div>
        </div>
        <div class="template-card-info">
          <div class="template-card-name">${escHtml(t.name)}</div>
          <div class="template-card-size">${t.data?.labelWidthMm || 66} × ${t.data?.labelHeightMm || 35} mm${t.isDefault ? ' · Predeterminada' : ''}</div>
        </div>
        <div class="template-card-actions">
          <button title="Cargar" onclick="event.stopPropagation();" data-tpl-load="${t.isDefault ? 'default-' + i : (i - defaults.length)}" data-is-default="${t.isDefault}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          ${!t.isDefault ? `<button class="delete-btn" title="Eliminar" data-tpl-delete="${i - defaults.length}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>` : ''}
        </div>
      </div>
    `).join('');

    // Event listeners
    container.querySelectorAll('[data-tpl-load]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = btn.dataset.tplLoad;
        const isDefault = btn.dataset.isDefault === 'true';

        if (isDefault) {
          const defaultIdx = parseInt(idx.split('-')[1]);
          loadTemplateData(allTemplates[defaultIdx].data);
          $('currentTemplateName').textContent = allTemplates[defaultIdx].name;
        } else {
          const savedList = getSavedTemplates();
          const template = savedList[parseInt(idx)];
          if (template) {
            loadTemplateData(template.data);
            $('currentTemplateName').textContent = template.name;
          }
        }
        $('templatesModal').classList.remove('open');
      });
    });

    container.querySelectorAll('[data-tpl-delete]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.tplDelete);
        const savedList = getSavedTemplates();
        savedList.splice(idx, 1);
        saveTemplates(savedList);
        renderTemplatesList();
      });
    });
  }

  function getDefaultTemplate(type) {
    const base = JSON.parse(JSON.stringify(defaultElements));
    // Remove getText
    Object.values(base).forEach(el => delete el.getText);

    switch (type) {
      case '66x35':
        return { labelWidthMm: 66, labelHeightMm: 35, labelBgColor: '#ffffff', elements: base };
      case '66x27':
        return {
          labelWidthMm: 66, labelHeightMm: 27, labelBgColor: '#ffffff',
          elements: {
            ...base,
            businessName: { ...base.businessName, y: 0.5, h: 3.5, fontSize: 6 },
            productName: { ...base.productName, y: 4, h: 7, fontSize: 9 },
            priceUSD: { ...base.priceUSD, y: 0.5, h: 10, fontSize: 14 },
            priceVES: { ...base.priceVES, y: 11, h: 6, fontSize: 9 },
            barcode: { ...base.barcode, y: 17, h: 7 },
            barcodeText: { ...base.barcodeText, y: 23, h: 3 }
          }
        };
      case '99x38':
        return {
          labelWidthMm: 99, labelHeightMm: 38, labelBgColor: '#ffffff',
          elements: {
            ...base,
            productName: { ...base.productName, w: 55, h: 12, fontSize: 13 },
            priceUSD: { ...base.priceUSD, x: 60, w: 38, fontSize: 20 },
            priceVES: { ...base.priceVES, x: 60, w: 38 },
            barcode: { ...base.barcode, w: 55, y: 24 },
            barcodeText: { ...base.barcodeText, w: 55, y: 33 }
          }
        };
      case '80x50':
        return {
          labelWidthMm: 80, labelHeightMm: 50, labelBgColor: '#ffffff',
          elements: {
            ...base,
            productName: { ...base.productName, w: 48, h: 14, fontSize: 13 },
            priceUSD: { ...base.priceUSD, x: 50, w: 29, h: 16, fontSize: 18 },
            priceVES: { ...base.priceVES, x: 50, w: 29, y: 18, h: 10 },
            barcode: { ...base.barcode, w: 50, y: 30, h: 14 },
            barcodeText: { ...base.barcodeText, w: 50, y: 43 }
          }
        };
      case 'priceFocus':
        return {
          labelWidthMm: 66, labelHeightMm: 35, labelBgColor: '#ffffff',
          elements: {
            ...base,
            businessName: { ...base.businessName, fontSize: 5, h: 3 },
            productName: { ...base.productName, y: 4, h: 7, w: 64, fontSize: 9 },
            priceUSD: { ...base.priceUSD, x: 1, y: 12, w: 64, h: 14, fontSize: 24, textAlign: 'center' },
            priceVES: { ...base.priceVES, x: 1, y: 26, w: 64, h: 5, fontSize: 8, textAlign: 'center' },
            barcode: { ...base.barcode, visible: false },
            barcodeText: { ...base.barcodeText, visible: false }
          }
        };
      default:
        return { labelWidthMm: 66, labelHeightMm: 35, labelBgColor: '#ffffff', elements: base };
    }
  }

  $('btnSaveTemplate').addEventListener('click', () => {
    const name = $('newTemplateName').value.trim();
    if (!name) {
      alert('Escribe un nombre para la plantilla');
      return;
    }

    const list = getSavedTemplates();
    list.push({ name, data: getTemplateData() });
    saveTemplates(list);
    $('newTemplateName').value = '';
    $('currentTemplateName').textContent = name;
    renderTemplatesList();
  });

  // ─── PRINT ────────────────────────────────────────
  const sheetSizes = { A4: { w: 210, h: 297 }, LETTER: { w: 216, h: 279 } };

  function buildPrintLabel(product) {
    // Build a single label HTML that matches the visual layout
    const wPx = mmToPx(labelWidthMm);
    const hPx = mmToPx(labelHeightMm);

    let html = `<div class="print-label" style="width:${labelWidthMm}mm;height:${labelHeightMm}mm;position:relative;overflow:hidden;background:${labelBgColor};${elements.labelBorder.visible ? 'border:1px solid #000;' : ''}box-sizing:border-box;">`;

    Object.values(elements).forEach(el => {
      if (!el.visible || el.type === 'border') return;

      const left = el.x;
      const top = el.y;
      const width = el.w;
      const height = el.h;

      if (el.type === 'text') {
        let text = '';
        switch (el.id) {
          case 'businessName': text = businessName; break;
          case 'productName': text = escHtml(product.nombre || 'Producto'); break;
          case 'priceUSD': text = '$ ' + fmt2(product.precio_final_usd_bcv); break;
          case 'priceVES': text = 'Bs ' + fmt2(product.precio_final_ves); break;
          case 'barcodeText': text = product.barcode || ''; break;
          case 'customText': text = customText; break;
          case 'priceLabel': text = el.getText(); break;
          default: text = el.getText();
        }

        html += `<div style="position:absolute;left:${left}mm;top:${top}mm;width:${width}mm;height:${height}mm;font-size:${el.fontSize}pt;font-weight:${el.fontWeight};color:${el.fontColor};text-align:${el.textAlign};font-family:'Inter',Arial,sans-serif;line-height:1.2;overflow:hidden;word-break:break-word;display:flex;align-items:flex-start;justify-content:${el.textAlign === 'center' ? 'center' : el.textAlign === 'right' ? 'flex-end' : 'flex-start'};">${escHtml(text)}</div>`;
      } else if (el.type === 'barcode') {
        const barcodeValue = String(product.barcode || '').trim();
        if (barcodeValue) {
          html += `<div style="position:absolute;left:${left}mm;top:${top}mm;width:${width}mm;height:${height}mm;overflow:hidden;"><svg class="print-barcode" data-barcode="${escHtml(barcodeValue)}" data-bc-h="${el.barcodeHeight}" data-bc-w="${el.barcodeWidth}" style="width:100%;height:100%;"></svg></div>`;
        }
      }
    });

    html += '</div>';
    return html;
  }

  function getSelectedProductsExpanded() {
    const items = [];
    for (const p of allProducts) {
      const id = String(p.id);
      const st = productSelection.get(id);
      if (!st?.checked) continue;
      const qty = Math.max(1, toNum(st.qty, 1));
      for (let i = 0; i < qty; i++) items.push(p);
    }
    return items;
  }

  function printSheet(items) {
    const formatKey = printSheetFormat.value || 'A4';
    const size = sheetSizes[formatKey] || sheetSizes.A4;
    const cols = Math.max(1, toNum(printCols.value, 3));
    const gx = toNum(printGapX.value, 2);
    const gy = toNum(printGapY.value, 2);
    const pad = toNum(printPad.value, 6);

    const usableW = size.w - 2 * pad;
    const usableH = size.h - 2 * pad;
    const colsFit = Math.min(cols, Math.max(1, Math.floor((usableW + gx) / (labelWidthMm + gx))));
    const rowsFit = Math.max(1, Math.floor((usableH + gy) / (labelHeightMm + gy)));
    const perPage = colsFit * rowsFit;

    const pages = [];
    for (let i = 0; i < items.length; i += perPage) {
      pages.push(items.slice(i, i + perPage));
    }

    const pagesHtml = pages.map(pageItems => {
      const labelsHtml = pageItems.map(p => buildPrintLabel(p)).join('');
      return `
        <div class="print-sheet" style="width:${size.w}mm;height:${size.h}mm;padding:${pad}mm;">
          <div class="print-sheet-grid" style="display:grid;grid-template-columns:repeat(${colsFit},${labelWidthMm}mm);grid-auto-rows:${labelHeightMm}mm;column-gap:${gx}mm;row-gap:${gy}mm;align-content:start;">
            ${labelsHtml}
          </div>
        </div>
      `;
    }).join('');

    printRoot.innerHTML = `
      <style>@page { size: ${formatKey === 'LETTER' ? 'Letter' : 'A4'}; margin: 0; }</style>
      ${pagesHtml}
    `;

    applyPrintBarcodes();
  }

  function printThermal(items) {
    const rotate = !!thermalRotate.checked;

    const labelsHtml = items.map(p => {
      const inner = buildPrintLabel(p);
      return `
        <div class="thermal-label" style="width:${labelWidthMm}mm;height:${labelHeightMm}mm;box-sizing:border-box;">
          <div ${rotate ? `class="rot90" style="width:${labelHeightMm}mm;height:${labelWidthMm}mm;"` : ''}>
            ${inner}
          </div>
        </div>
      `;
    }).join('');

    printRoot.innerHTML = `
      <style>@page { size: ${labelWidthMm}mm ${labelHeightMm}mm; margin: 0; }
      .rot90 { transform: rotate(90deg); transform-origin: top left; }</style>
      <div class="thermal-wrap" style="--thermalW:${labelWidthMm}mm;">
        ${labelsHtml}
      </div>
    `;

    applyPrintBarcodes();
  }

  function applyPrintBarcodes() {
    if (typeof JsBarcode !== 'function') return;
    printRoot.querySelectorAll('svg.print-barcode').forEach(svg => {
      const value = (svg.dataset.barcode || '').trim();
      if (!value) return;
      try {
        JsBarcode(svg, value, {
          format: 'CODE128',
          displayValue: false,
          margin: 0,
          height: toNum(svg.dataset.bcH, 28),
          width: toNum(svg.dataset.bcW, 1.2)
        });
      } catch (e) {
        console.warn('Barcode error:', e);
      }
    });
  }

  $('btnPrintAll').addEventListener('click', () => {
    const items = getSelectedProductsExpanded();
    if (!items.length) {
      alert('Selecciona al menos un producto para imprimir.\nAbre "Productos" y marca los que desees.');
      return;
    }

    if (printMode.value === 'SHEET') {
      printSheet(items);
    } else {
      printThermal(items);
    }

    setTimeout(() => window.print(), 200);
  });

  // ─── Load business name ───────────────────────────
  async function loadBusinessName() {
    // Try to get from API first (most reliable)
    const apiUrls = ['/api/settings/business', '/api/settings/general'];

    for (const url of apiUrls) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const data = await resp.json();
          const name = data.businessName || data.nombre_negocio || data.nombre || data.name;
          if (name) {
            businessName = String(name).trim();
            businessNameValue.value = businessName;
            localStorage.setItem('nexuspos_business_name', businessName);
            renderCanvas();
            return;
          }
        }
      } catch (e) { console.warn(`Error fetching business name from ${url}:`, e); }
    }

    // Fallback to localStorage
    const savedBN = localStorage.getItem('nexuspos_business_name');
    if (savedBN) {
      businessName = savedBN;
      businessNameValue.value = businessName;
      renderCanvas();
      return;
    }

    // Final fallback
    businessName = 'NexusPOS';
    businessNameValue.value = businessName;
    renderCanvas();
  }

  // ─── Theme sync ───────────────────────────────────
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  window.addEventListener('storage', e => {
    if (e.key === 'theme') applyTheme(e.newValue);
  });

  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.body.classList.add(savedTheme);

  // ─── Auto-save current design ─────────────────────
  function autoSave() {
    try {
      localStorage.setItem('nexuspos_label_autosave', JSON.stringify(getTemplateData()));
    } catch (e) { }
  }

  function autoLoad() {
    try {
      const saved = localStorage.getItem('nexuspos_label_autosave');
      if (saved) {
        const data = JSON.parse(saved);
        loadTemplateData(data);
        $('currentTemplateName').textContent = 'Diseño anterior (auto-guardado)';
        return true;
      }
    } catch (e) { }
    return false;
  }

  // Auto-save every 5 seconds
  setInterval(autoSave, 5000);

  // ─── MOBILE NAVIGATION ─────────────────────────────
  const mobileBottomNav = $('mobileBottomNav');
  const mobileProductBadge = $('mobileProductBadge');

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function setMobileView(view) {
    const leftPanel = document.querySelector('.left-panel');
    const rightPanel = document.querySelector('.right-panel');

    // Remove mobile-visible from both panels
    leftPanel.classList.remove('mobile-visible');
    rightPanel.classList.remove('mobile-visible');

    // Update nav buttons
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mobileView === view);
    });

    switch (view) {
      case 'canvas':
        // Just show canvas (panels are hidden)
        break;
      case 'elements':
        leftPanel.classList.add('mobile-visible');
        break;
      case 'properties':
        rightPanel.classList.add('mobile-visible');
        break;
      case 'products-modal':
        $('productsModal').classList.add('open');
        // Keep canvas nav active visually
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mobileView === 'canvas');
        });
        break;
    }
  }

  if (mobileBottomNav) {
    mobileBottomNav.addEventListener('click', e => {
      const btn = e.target.closest('.mobile-nav-btn');
      if (!btn) return;
      setMobileView(btn.dataset.mobileView);
    });
  }

  // Update mobile product badge
  function updateMobileProductBadge() {
    if (!mobileProductBadge) return;
    let count = 0;
    for (const [, st] of productSelection) {
      if (st.checked) count++;
    }
    if (count > 0) {
      mobileProductBadge.style.display = 'flex';
      mobileProductBadge.textContent = count;
    } else {
      mobileProductBadge.style.display = 'none';
    }
  }

  // Patch updateProductCounters to also update mobile badge
  const origUpdateProductCounters = updateProductCounters;
  // We can't easily override, so let's hook into it by wrapping in the existing function

  // ─── TOUCH EVENT SUPPORT ─────────────────────────
  function getTouchPos(e) {
    const touch = e.touches[0] || e.changedTouches[0];
    return { clientX: touch.clientX, clientY: touch.clientY };
  }

  labelCanvas.addEventListener('touchstart', e => {
    const touch = getTouchPos(e);
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!target) return;

    const handle = target.closest('.resize-handle');
    const elDiv = target.closest('.label-element');

    if (!elDiv) {
      deselectAll();
      return;
    }

    const elId = elDiv.dataset.elId;
    selectElement(elId);

    const el = elements[elId];
    if (!el || el.type === 'border') return;

    e.preventDefault();

    const canvasRect = labelCanvas.getBoundingClientRect();
    const actualScale = canvasRect.width / scaledMmToPx(labelWidthMm);

    if (handle) {
      dragState = {
        type: 'resize',
        elId,
        dir: handle.dataset.dir,
        startMouseX: touch.clientX,
        startMouseY: touch.clientY,
        startX: el.x,
        startY: el.y,
        startW: el.w,
        startH: el.h,
        actualScale
      };
    } else {
      dragState = {
        type: 'drag',
        elId,
        startMouseX: touch.clientX,
        startMouseY: touch.clientY,
        startX: el.x,
        startY: el.y,
        actualScale
      };
    }
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (!dragState) return;
    e.preventDefault();

    const touch = getTouchPos(e);
    const el = elements[dragState.elId];
    if (!el) return;

    const dx = (touch.clientX - dragState.startMouseX) / dragState.actualScale;
    const dy = (touch.clientY - dragState.startMouseY) / dragState.actualScale;
    const dxMm = scaledPxToMm(dx);
    const dyMm = scaledPxToMm(dy);

    if (dragState.type === 'drag') {
      el.x = clamp(dragState.startX + dxMm, 0, labelWidthMm - el.w);
      el.y = clamp(dragState.startY + dyMm, 0, labelHeightMm - el.h);
    } else if (dragState.type === 'resize') {
      const dir = dragState.dir;
      let newX = dragState.startX;
      let newY = dragState.startY;
      let newW = dragState.startW;
      let newH = dragState.startH;

      if (dir.includes('e')) newW = Math.max(3, dragState.startW + dxMm);
      if (dir.includes('w')) {
        newW = Math.max(3, dragState.startW - dxMm);
        newX = dragState.startX + dxMm;
      }
      if (dir.includes('s')) newH = Math.max(2, dragState.startH + dyMm);
      if (dir.includes('n')) {
        newH = Math.max(2, dragState.startH - dyMm);
        newY = dragState.startY + dyMm;
      }

      el.x = clamp(newX, 0, labelWidthMm - 3);
      el.y = clamp(newY, 0, labelHeightMm - 2);
      el.w = clamp(newW, 3, labelWidthMm - el.x);
      el.h = clamp(newH, 2, labelHeightMm - el.y);
    }

    renderCanvas();
    updatePropsPanel();
  }, { passive: false });

  window.addEventListener('touchend', () => {
    dragState = null;
  });

  // Touch on canvas background deselects
  canvasArea.addEventListener('touchstart', e => {
    const touch = getTouchPos(e);
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    if (target === canvasArea || target === canvasContainer) {
      deselectAll();
    }
  }, { passive: true });

  // On mobile, when selecting an element from left panel, auto-switch to properties
  const origSelectElement = selectElement;

  // When element is clicked from left panel on mobile, show properties
  document.querySelectorAll('.element-item').forEach(item => {
    item.addEventListener('click', () => {
      if (isMobile() && item.dataset.el && elements[item.dataset.el]?.visible) {
        // Small delay to let selectElement finish
        setTimeout(() => setMobileView('properties'), 100);
      }
    });
  });

  // ─── Handle window resize for responsive ──────────
  let prevIsMobile = isMobile();
  window.addEventListener('resize', () => {
    const nowMobile = isMobile();
    if (nowMobile !== prevIsMobile) {
      prevIsMobile = nowMobile;

      // Clean up mobile classes when switching to desktop
      if (!nowMobile) {
        document.querySelector('.left-panel')?.classList.remove('mobile-visible');
        document.querySelector('.right-panel')?.classList.remove('mobile-visible');
      }

      // Re-fit zoom
      setTimeout(() => $('zoomFit').click(), 50);
    }
  });

  // ─── INIT ─────────────────────────────────────────
  // Try to load auto-saved design
  if (!autoLoad()) {
    renderCanvas();
  }

  loadBusinessName();
  fetchAllProducts();

  // Fit zoom initially
  setTimeout(() => {
    $('zoomFit').click();
  }, 100);

  // Patch updateProductCounters to also update mobile badge
  const _origUpdateProductCounters = updateProductCounters;
  // Since updateProductCounters is defined with function declaration, we hook post-render
  const _patchInterval = setInterval(() => {
    updateMobileProductBadge();
  }, 2000);
});
