// public/js/reports.js

// Proxy para acceder al helper de ventanas desde cualquier contexto (Iframe o Popup)
window.openAppWindow = window.openAppWindow || (window.parent && window.parent.openAppWindow) || (window.opener && window.opener.openAppWindow) || function (url, title = 'NexusPOS', w = 1000, h = 800) {
  const left = (screen.width / 2) - (w / 2);
  const top = (screen.height / 2) - (h / 2);
  return window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
};

// Proxies para helpers de WhatsApp definidos en layout.js (ventana padre)
window.sendWhatsAppMessage = window.sendWhatsAppMessage || (window.parent && window.parent.sendWhatsAppMessage) || (window.opener && window.opener.sendWhatsAppMessage) || null;
window.formatReportMessage = window.formatReportMessage || (window.parent && window.parent.formatReportMessage) || (window.opener && window.opener.formatReportMessage) || null;

document.addEventListener('DOMContentLoaded', () => {
  const startDateInput = document.getElementById('filter-start-date');
  const endDateInput = document.getElementById('filter-end-date');
  const generateReportBtn = document.getElementById('btn-filter');
  const downloadPdfBtn = document.getElementById('btn-download-pdf');
  const downloadExcelBtn = document.getElementById('btn-download-excel');
  const summaryCards = document.getElementById('report-summary-cards');

  const totalSalesSpan = document.getElementById('summary-total-sales');
  const totalSalesUsdSpan = document.getElementById('summary-total-sales-usd');
  const totalCostSpan = document.getElementById('summary-total-cost');
  const totalCostUsdSpan = document.getElementById('summary-total-cost-usd');
  const totalProfitSpan = document.getElementById('summary-total-profit');
  const totalProfitUsdSpan = document.getElementById('summary-total-profit-usd');
  const totalFiadoSpan = document.getElementById('summary-total-fiado');
  const totalFiadoUsdSpan = document.getElementById('summary-total-fiado-usd');

  const tableBody = document.getElementById('report-table-body');

  // Pestañas siguen existiendo pero solo afectan estilo, no la data combinada
  const tabVentas = document.getElementById('tab-ventas');
  const tabAbonos = document.getElementById('tab-abonos');

  let currentRates = {};
  let currentStartDate = '';
  let currentEndDate = '';
  let hasAdminAccess = false;

  // NUEVO: caché de ventas por id para poder reabrirlas en el POS
  let lastSalesById = {};

  // NUEVO: caché para restaurar reporte al borrar búsqueda
  let originalSales = [];
  let originalPayments = [];

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

  async function loadRates() {
    try {
      const response = await fetch('/api/settings/rates');
      if (!response.ok) throw new Error('No se pudieron cargar las tasas');
      currentRates = await response.json();
    } catch (error) {
      console.error('Error cargando tasas:', error);
      renderPlaceholder('Error al cargar tasas. No se pueden calcular totales en USD.');
    }
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }



  function setDefaultDates() {
    const today = new Date();
    const todayStr = formatDate(today);
    startDateInput.value = todayStr;
    endDateInput.value = todayStr;
  }

  function renderPlaceholder(message, colorClass = 'text-gray-500') {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="px-6 py-4 text-center ${colorClass}">
          ${message}
        </td>
      </tr>
    `;
  }

  // Pestañas solo cambian estilo, el contenido siempre es combinado
  function setActiveTab(tab) {
    const allTabs = [tabVentas, tabAbonos].filter(Boolean);

    allTabs.forEach((t) => {
      t.classList.remove('bg-white', 'border-b-2', 'border-blue-500', 'text-blue-600');
      t.classList.add('border-transparent', 'text-gray-500');
    });

    let activeTabEl = null;
    if (tab === 'ventas') activeTabEl = tabVentas;
    if (tab === 'abonos') activeTabEl = tabAbonos;

    if (activeTabEl) {
      activeTabEl.classList.add('bg-white', 'border-b-2', 'border-blue-500', 'text-blue-600');
      activeTabEl.classList.remove('border-transparent', 'text-gray-500');
    }

    if (currentStartDate && currentEndDate) {
      generateReport(); // Siempre reporte combinado
    }
  }

  // ================== REPORTE COMBINADO (VENTAS + ABONOS) ==================

  async function generateReport() {
    if (!hasAdminAccess) {
      await showGlobalAlert('Acceso denegado. Se requiere contraseña de administrador.', 'Acceso restringido');
      return;
    }

    currentStartDate = startDateInput.value;
    currentEndDate = endDateInput.value;

    if (!currentStartDate || !currentEndDate) {
      await showGlobalAlert('Por favor, seleccione una fecha de inicio y una fecha de fin.', 'Rango de fechas');
      return;
    }

    if (new Date(currentEndDate) < new Date(currentStartDate)) {
      await showGlobalAlert('La fecha de fin no puede ser anterior a la fecha de inicio.', 'Rango de fechas');
      return;
    }

    summaryCards.classList.add('hidden');
    if (downloadPdfBtn) downloadPdfBtn.classList.add('hidden');
    if (downloadExcelBtn) downloadExcelBtn.classList.add('hidden');
    renderPlaceholder('Generando reporte...');

    try {
      const [salesRes, paymentsRes] = await Promise.all([
        fetch(`/api/reports/range?startDate=${currentStartDate}&endDate=${currentEndDate}`),
        fetch(`/api/reports/payments-range?startDate=${currentStartDate}&endDate=${currentEndDate}`)
      ]);

      const salesData = await salesRes.json();
      const paymentsData = await paymentsRes.json();

      if (!salesRes.ok) {
        throw new Error(salesData.error || 'Error al generar el reporte de ventas');
      }
      if (!paymentsRes.ok) {
        throw new Error(paymentsData.error || 'Error al generar el reporte de abonos');
      }

      const sales = salesData.detailedSales || [];
      const payments = paymentsData.payments || [];

      // Guardar copia para restaurar search
      originalSales = [...sales];
      originalPayments = [...payments];

      // NUEVO: caché de ventas por id para usar al anular y reabrir en POS
      lastSalesById = {};
      sales.forEach((sale) => {
        if (sale && sale.id != null) {
          lastSalesById[String(sale.id)] = sale;
        }
      });

      // Resumen SOLO con ventas (ingreso realizado, costo, ganancia, fiado)
      const summary = computeRealizedSummary(sales);
      renderSummary(summary);

      // Tabla combinada (ventas + abonos)
      renderCombinedTable(sales, payments);

      summaryCards.classList.remove('hidden');
      if (downloadPdfBtn) downloadPdfBtn.classList.remove('hidden');
      if (downloadExcelBtn) downloadExcelBtn.classList.remove('hidden');
    } catch (error) {
      console.error('Error al generar reporte:', error);
      renderPlaceholder(`Error al generar reporte: ${error.message}`, 'text-red-500');
    }
  }

  // ================== RESUMEN (TOTAL VENTAS / COSTO / GANANCIA / FIADO) ==================

  function renderSummary(summary) {
    const bcvRate = parseFloat(currentRates.BCV) || 1;
    const preferredRate = (currentRates.PARALELO && parseFloat(currentRates.PARALELO) > 0)
        ? parseFloat(currentRates.PARALELO)
        : bcvRate;

    // Usar tasa PREFERIDA (PARALELO > BCV) para todas las conversiones a USD
    const totalSalesUsd = (summary.totalIngresos / preferredRate).toFixed(2);
    const totalCostUsd = (summary.totalCosto / preferredRate).toFixed(2);
    const totalProfitUsd = (summary.totalGanancia / preferredRate).toFixed(2);
    
    const totalFiadoUsdNum = summary.totalFiadoUsd || 0;
    const totalFiadoVesNum = totalFiadoUsdNum * preferredRate;
    
    const totalFiadoUsd = totalFiadoUsdNum.toFixed(2);
    const totalFiadoVes = totalFiadoVesNum.toFixed(2);

    totalSalesSpan.textContent = `${summary.totalIngresos.toFixed(2)} Bs`;
    totalSalesUsdSpan.textContent = `(${totalSalesUsd} $)`;

    totalCostSpan.textContent = `${summary.totalCosto.toFixed(2)} Bs`;
    totalCostUsdSpan.textContent = `(${totalCostUsd} $)`;

    totalProfitSpan.textContent = `${summary.totalGanancia.toFixed(2)} Bs`;
    totalProfitUsdSpan.textContent = `(${totalProfitUsd} $)`;

    let subtitleDiv = document.getElementById('profit-breakdown');
    if (!subtitleDiv) {
      subtitleDiv = document.createElement('div');
      subtitleDiv.id = 'profit-breakdown';
      subtitleDiv.className = 'text-xs text-green-200 mt-1 font-normal opacity-90';
      totalProfitSpan.parentElement.appendChild(subtitleDiv);
    }
    if (summary.totalGananciaCamb > 0) {
      subtitleDiv.innerHTML = `Op: ${summary.totalGananciaOp.toFixed(2)} | Dif. Tasa: +${summary.totalGananciaCamb.toFixed(2)}`;
    } else {
      subtitleDiv.innerHTML = '';
    }

    if (totalFiadoSpan && typeof totalFiadoVesNum === 'number') {
      totalFiadoSpan.textContent = `${totalFiadoVes} Bs`;
    }
    if (totalFiadoUsdSpan && typeof totalFiadoVesNum === 'number') {
      totalFiadoUsdSpan.textContent = `(${totalFiadoUsd} $)`;
    }
  }

  // *** FUNCIÓN QUE SEPARA PAGADO vs FIADO (SOLO VENTAS) ***
  function computeRealizedSummary(sales) {
    return sales.reduce(
      (acc, sale) => {
        const totalVes = Number(sale.total_ves) || 0;
        const costoVes = Number(sale.total_costo_ves) || 0;

        const pagosIniciales = Number(sale.total_pagos_ves) || 0;   // venta_pagos
        const abonos = Number(sale.total_abonos_ves) || 0;          // abonos
        let pagadoVes = pagosIniciales + abonos;

        // Se removió el tope (if pagadoVes > totalVes) para permitir 
        // registrar la ganancia por diferencia cambiaria (pagos en $ que suben en Bs)
        if (pagadoVes < 0) pagadoVes = 0;

        let pendienteVes = totalVes - pagadoVes;

        if (pendienteVes < 0) pendienteVes = 0;
        if (pendienteVes > totalVes) pendienteVes = totalVes;
        
        let pendienteUsd = Number(sale.monto_pendiente_usd) || 0;

        if (sale.estado_pago === 'ANULADO') {
          pendienteVes = 0;
          pagadoVes = 0;
          pendienteUsd = 0;
        }

        acc.totalFiado += pendienteVes;
        acc.totalFiadoUsd = (acc.totalFiadoUsd || 0) + pendienteUsd;

        const ingresoRealizado = pagadoVes;

        let costoRealizado = ingresoRealizado <= costoVes ? ingresoRealizado : costoVes;
        let gananciaOperativa = 0;
        let gananciaCambiaria = 0;

        if (ingresoRealizado > totalVes) {
          gananciaCambiaria = ingresoRealizado - totalVes;
          gananciaOperativa = totalVes - costoVes;
        } else {
          gananciaOperativa = Math.max(0, ingresoRealizado - costoVes);
        }

        acc.totalIngresos += ingresoRealizado;
        acc.totalCosto += costoRealizado;
        acc.totalGanancia += (gananciaOperativa + gananciaCambiaria);
        acc.totalGananciaOp += gananciaOperativa;
        acc.totalGananciaCamb += gananciaCambiaria;

        return acc;
      },
      {
        totalIngresos: 0,
        totalCosto: 0,
        totalGanancia: 0,
        totalGananciaOp: 0,
        totalGananciaCamb: 0,
        totalFiado: 0,
        totalFiadoUsd: 0
      }
    );
  }

  // ================== TABLA COMBINADA (VENTAS + ABONOS) ==================

  function renderCombinedTable(sales, payments) {
    tableBody.innerHTML = '';

    const rows = [];

    // VENTAS
    sales.forEach((sale) => {
      const date = sale.creado_en ? new Date(sale.creado_en) : null;
      rows.push({
        type: 'SALE',
        date,
        sale
      });
    });

    // ABONOS
    payments.forEach((payment) => {
      const date = payment.fecha ? new Date(payment.fecha) : null;
      rows.push({
        type: 'ABONO',
        date,
        payment
      });
    });

    if (!rows.length) {
      renderPlaceholder('No se encontraron ventas ni abonos en este rango de fechas.');
      return;
    }

    // Ordenar por fecha/hora
    rows.sort((a, b) => {
      const da = a.date ? a.date.getTime() : 0;
      const db = b.date ? b.date.getTime() : 0;
      return da - db;
    });

    rows.forEach((row) => {
      if (row.type === 'SALE') {
        renderSaleRow(row.sale);
      } else {
        renderAbonoRow(row.payment);
      }
    });
  }

  function renderSaleRow(sale) {
    const tr = document.createElement('tr');
    const saleDate = sale.creado_en ? new Date(sale.creado_en) : null;
    const formattedDate = saleDate && !isNaN(saleDate.getTime())
      ? saleDate.toLocaleDateString('es-VE')
      : '';
    const formattedTime = saleDate && !isNaN(saleDate.getTime())
      ? saleDate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
      : '';

    const productNames = sale.products
      ? sale.products.map((p) => `${p.cantidad} x ${p.producto_nombre}`).join('<br>')
      : '';

    const totalVes = Number(sale.total_ves) || 0;
    const costoVes = Number(sale.total_costo_ves) || 0;
    const pagosIniciales = Number(sale.total_pagos_ves) || 0;
    const abonos = Number(sale.total_abonos_ves) || 0;
    const pagadoVes = Math.max(0, pagosIniciales + abonos);

    let gananciaOp = 0;
    let gananciaCamb = 0;
    if (sale.estado_pago !== 'ANULADO') {
      if (pagadoVes > totalVes) {
        gananciaCamb = pagadoVes - totalVes;
        gananciaOp = totalVes - costoVes;
      } else {
        gananciaOp = Math.max(0, pagadoVes - costoVes);
      }
    }
    const totalGanancia = gananciaOp + gananciaCamb;
    
    let gananciaHtml = `${totalGanancia.toFixed(2)}`;
    if (gananciaCamb > 0) {
      gananciaHtml += `<br><span class="text-xs text-gray-500 font-normal">(${gananciaOp.toFixed(2)} Op. + ${gananciaCamb.toFixed(2)} Tasa)</span>`;
    }

    let actionButton = '';
    if (sale.estado_pago === 'PAGADO' || sale.estado_pago === 'FIADO') {
      const fiadoBadge = sale.estado_pago === 'FIADO' ? `<span class="px-2 py-1 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-full mr-2">Fiado</span>` : '';
      actionButton = `
        <div class="flex items-center">
          ${fiadoBadge}
          <button class="p-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200 btn-void-sale" title="Anular Venta" data-sale-id="${sale.id}">
            <svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      `;
    } else if (sale.estado_pago === 'ABONADO') {
      actionButton = `<span class="px-2 py-1 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-full">Abonado</span>`;
    } else if (sale.estado_pago === 'ANULADO') {
      actionButton = `<span class="px-2 py-1 text-xs font-medium text-red-800 bg-red-100 rounded-full">Anulado</span>`;
    }

    const usuarioNombre = sale.usuario_nombre || '<span class="text-gray-400 italic">Desconocido</span>';

    tr.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${formattedDate} ${formattedTime}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">Venta #${sale.id}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-medium">${usuarioNombre}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${productNames}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">${totalVes.toFixed(2)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">${costoVes.toFixed(2)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-bold text-right">${gananciaHtml}</td>
      <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
        <div class="flex items-center justify-end space-x-2">
          ${actionButton}
          
          <button onclick="openAppWindow('detalles_venta.html?id=${sale.id}', 'Detalles Venta', 1000, 800)" 
                  class="p-1 text-blue-600 hover:text-blue-800 transition-colors" 
                  title="Ver Detalle">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>

          <button onclick="openAppWindow('/api/sales/${sale.id}/receipt', 'Ticket', 350, 750)" 
                  class="p-1 text-gray-600 hover:text-gray-800 transition-colors" 
                  title="Reimprimir Ticket">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
          </button>
        </div>
      </td>
    `;
    tableBody.appendChild(tr);
  }

  function renderAbonoRow(payment) {
    const tr = document.createElement('tr');

    const dateObj = payment.fecha ? new Date(payment.fecha) : null;
    let formattedDateTime = '';
    if (dateObj && !isNaN(dateObj.getTime())) {
      const formattedDate = dateObj.toLocaleDateString('es-VE');
      const formattedTime = dateObj.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
      formattedDateTime = `${formattedDate} ${formattedTime}`;
    } else {
      formattedDateTime = payment.fecha || '';
    }

    let metodoLabel = '';
    switch (payment.metodo) {
      case 'VES_EFECTIVO':
        metodoLabel = 'Efectivo Bs';
        break;
      case 'USD_EFECTIVO':
        metodoLabel = 'Efectivo $';
        break;
      case 'TARJETA':
        metodoLabel = 'Tarjeta';
        break;
      case 'PAGOMOVIL':
        metodoLabel = 'Pago Móvil';
        break;
      default:
        metodoLabel = payment.metodo || 'Otro';
    }

    const clienteNombre = payment.cliente_nombre || 'Cliente';
    const ventaId = payment.venta_id ? `Venta #${payment.venta_id}` : '';
    const detalle = `Abono de ${clienteNombre}${ventaId ? ' a ' + ventaId : ''} (${metodoLabel})`;

    const montoVes = (typeof payment.monto_pagado_ves === 'number')
      ? payment.monto_pagado_ves
      : (typeof payment.monto_en_ves === 'number' ? payment.monto_en_ves : 0);

    const usuarioNombre = payment.usuario_nombre || '<span class="text-gray-400 italic">Desconocido</span>';

    // Abonos no suman ganancia ni costo aquí, solo se listan como movimiento
    tr.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700">${formattedDateTime}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-medium">Abono #${payment.id}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-medium">${usuarioNombre}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${detalle}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">${montoVes.toFixed(2)}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">0.00</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-bold text-right">0.00</td>
      <td class="px-6 py-4 whitespace-nowrap text-right">-</td>
    `;
    tableBody.appendChild(tr);
  }

  // ================== ENVIAR VENTA AL POS (NUEVO) ==================

  function sendSaleToPOS(sale) {
    const ctx = window.parent || window;

    if (!sale || !Array.isArray(sale.products) || sale.products.length === 0) {
      console.warn('No hay productos para enviar al POS desde la venta:', sale);
      return;
    }

    const items = sale.products
      .map((p) => {
        const productId = p.producto_id ?? p.product_id ?? p.id;
        const quantity = Number(p.cantidad ?? p.qty ?? p.quantity ?? 0);
        const priceVes = Number(
          p.precio_unitario_ves ??
          p.precio_ves ??
          p.precioFinalVes ??
          p.precio_final_ves ??
          0
        );

        if (!productId || !quantity || quantity <= 0) {
          return null;
        }

        let priceUsd = 0;
        const bcvRate = parseFloat(currentRates.BCV);
        if (!isNaN(priceVes) && priceVes > 0 && !isNaN(bcvRate) && bcvRate > 0) {
          priceUsd = priceVes / bcvRate;
        }

        return {
          productId,
          name: p.producto_nombre ?? p.nombre ?? '',
          quantity,
          priceVes,
          priceUsd
        };
      })
      .filter(Boolean);

    if (!items.length) {
      console.warn('No se pudieron mapear productos válidos para el POS.', sale.products);
      return;
    }

    const payload = {
      source: 'reports',
      originalSaleId: sale.id,
      clienteId: sale.cliente_id ?? null,
      clienteNombre: sale.cliente_nombre ?? (sale.cliente && sale.cliente.nombre) ?? null,
      items
    };

    // Opción principal: función definida en la ventana principal/Electron
    if (typeof ctx.openPosWithItems === 'function') {
      ctx.openPosWithItems(payload);
      return;
    }

    // Alternativa: otro nombre de helper
    if (typeof ctx.sendSaleToPOS === 'function') {
      ctx.sendSaleToPOS(payload);
      return;
    }

    // Alternativa: postMessage si se usan iframes
    if (typeof ctx.postMessage === 'function' && ctx !== window) {
      ctx.postMessage(
        {
          type: 'OPEN_POS_WITH_ITEMS',
          payload
        },
        '*'
      );
      return;
    }

    console.log('[reports] No se encontró handler para abrir el POS con items. Payload:', payload);
  }

  // ================== PDF / ANULAR VENTA ==================

  async function handleDownloadPdf() {
    if (!hasAdminAccess) {
      await showGlobalAlert('Acceso denegado. Se requiere contraseña de administrador.', 'Acceso restringido');
      return;
    }

    if (!currentStartDate || !currentEndDate) {
      await showGlobalAlert('Por favor, genere un reporte primero.', 'Descargar PDF');
      return;
    }

    const url = `/api/reports/range/pdf?startDate=${currentStartDate}&endDate=${currentEndDate}`;
    const viewerUrl = `/pdf_viewer.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent('Reporte de Ventas')}`;
    openAppWindow(viewerUrl, 'Reporte de Ventas', 1000, 900);
  }

  async function handleDownloadExcel() {
    if (!hasAdminAccess) {
      await showGlobalAlert('Acceso denegado. Se requiere contraseña de administrador.', 'Acceso restringido');
      return;
    }

    if (!currentStartDate || !currentEndDate) {
      await showGlobalAlert('Por favor, genere un reporte primero.', 'Descargar Excel');
      return;
    }

    const url = `/api/reports/range/excel?startDate=${currentStartDate}&endDate=${currentEndDate}`;
    window.open(url, '_blank');
  }

  // NUEVO: anular venta + preguntar si se envía al POS
  async function handleVoidSale(saleId) {
    const hasPermission = await window.parent.askForAdminPassword();
    if (!hasPermission) {
      return;
    }

    const confirmed = await showGlobalConfirm(
      `¿Estás seguro de que deseas ANULAR la venta #${saleId}? Esta acción devolverá los productos al stock y la venta ya no contará como un ingreso.`,
      'Anular venta'
    );
    if (!confirmed) {
      return;
    }

    summaryCards.classList.add('hidden');
    downloadPdfBtn.classList.add('hidden');
    renderPlaceholder('Anulando venta...');

    try {
      // 1) Anular venta
      const response = await fetch(`/api/reports/void/${saleId}`, {
        method: 'DELETE'
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Error desconocido');
      }

      // 2) Preguntar si queremos mandarla al POS
      const wantSendToPos = await showGlobalConfirm(
        'La venta se anuló correctamente.\n\n¿Deseas enviar los productos de esta venta al POS para volver a facturarla?',
        'Enviar al POS'
      );

      if (wantSendToPos) {
        // 3) Pedir los detalles de la venta (para reconstruir el carrito)
        // 👉 AJUSTA la URL a tu ruta real de getSaleDetails
        const detailsRes = await fetch(`/api/sales/${saleId}/details`);
        const details = await detailsRes.json();
        if (!detailsRes.ok) {
          throw new Error(details.error || 'No se pudieron obtener los detalles de la venta.');
        }

        const { sale, cliente, products } = details;

        const payload = {
          saleId,
          clienteId: sale.cliente_id || null,
          clienteNombre: cliente?.nombre || null,
          items: (products || []).map(p => ({
            productId: p.producto_id,
            name: p.producto_nombre || 'Producto',
            quantity: p.cantidad,
            priceVes: p.precio_unitario_ves,
            // campos “extra” por compatibilidad con POS
            tipo_venta: 'UNIDAD',
            presentationId: null,
            unidadesBase: 1
          }))
        };

        const ctx = window.parent || window;

        // 4) Guardar la venta pendiente en el padre
        ctx.__POS_PENDING_SALE__ = payload;

        // (Opcional) Cambiar automáticamente a la pestaña POS:
        try {
          const parentDoc = ctx.document;
          const tabPosBtn =
            parentDoc.getElementById('tab-pos') ||
            parentDoc.querySelector('[data-tab="pos"]');

          if (tabPosBtn) {
            tabPosBtn.click();
          }
        } catch (e) {
          console.warn('No se pudo activar la pestaña POS automáticamente:', e);
        }

        await showGlobalAlert(
          'Venta anulada y enviada al POS.\nAbre la pestaña POS para editarla.',
          'Venta enviada al POS'
        );
      } else {
        await showGlobalAlert(
          result.message || 'Venta anulada correctamente.',
          'Anular venta'
        );
      }

      generateReport();
    } catch (error) {
      console.error('Error al anular la venta:', error);
      await showGlobalAlert(`Error al anular la venta: ${error.message}`, 'Anular venta');
      generateReport();
    }
  }


  function handleTableClick(event) {
    const target = event.target.closest('button');
    if (target && target.classList.contains('btn-void-sale')) {
      const saleId = target.dataset.saleId;
      handleVoidSale(saleId);
    }
  }

  // ================== INICIALIZACIÓN ==================

  async function initializeReports() {
    let hasPermission = true;
    if (window.parent && typeof window.parent.askForAdminPassword === 'function') {
      hasPermission = await window.parent.askForAdminPassword();
    } else if (typeof window.askForAdminPassword === 'function') {
      hasPermission = await window.askForAdminPassword();
    } else {
      console.warn('askForAdminPassword no está definida; se omite verificación de admin en inicialización.');
    }

    if (!hasPermission) {
      hasAdminAccess = false;
      renderPlaceholder('Acceso denegado. Se requiere contraseña de administrador.', 'text-red-500');
      if (generateReportBtn) generateReportBtn.disabled = true;
      if (downloadPdfBtn) downloadPdfBtn.disabled = true;
      if (downloadExcelBtn) downloadExcelBtn.disabled = true;
      await showGlobalAlert('Acceso denegado. Se requiere contraseña de administrador.', 'Acceso restringido');
      return;
    }

    hasAdminAccess = true;
    await loadRates();
    setDefaultDates();
  }

  generateReportBtn.addEventListener('click', generateReport);
  downloadPdfBtn.addEventListener('click', handleDownloadPdf);
  if (downloadExcelBtn) downloadExcelBtn.addEventListener('click', handleDownloadExcel);
  tableBody.addEventListener('click', handleTableClick);

  // NUEVO: Enviar resumen de reporte por WhatsApp
  const btnWhatsappReport = document.createElement('button');
  btnWhatsappReport.id = 'btn-whatsapp-report';
  btnWhatsappReport.title = 'Enviar resumen por WhatsApp';
  btnWhatsappReport.className = 'p-2.5 bg-[#25D366] text-white rounded-2xl hover:bg-[#128C7E] transition-all shadow-md active:scale-95 hidden';
  btnWhatsappReport.innerHTML = `
    <svg class="w-5 h-5 text-current" fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
    </svg>
  `;
  const filterRowControls = document.querySelector('.flex.gap-2.ml-auto');
  if (filterRowControls) {
    filterRowControls.appendChild(btnWhatsappReport);
  }

  btnWhatsappReport.addEventListener('click', () => {
    const summary = {
      totalIngresos: parseFloat(totalSalesSpan.textContent),
      totalGanancia: parseFloat(totalProfitSpan.textContent),
      totalFiado: parseFloat(totalFiadoSpan.textContent),
      bcv: parseFloat(currentRates.BCV) || 1
    };
    const reportData = {
      startDate: startDateInput.value,
      endDate: endDateInput.value,
      summary: summary
    };
    const msg = window.formatReportMessage(reportData);
    window.sendWhatsAppMessage('', msg);
  });

  // Mostrar el botón de WhatsApp cuando se genera el reporte
  const originalGenerateReport = generateReport;
  window.generateReport = async function () {
    await originalGenerateReport();
    if (btnWhatsappReport) {
      // Solo mostrar si hay datos
      if (originalSales.length > 0 || originalPayments.length > 0) {
        btnWhatsappReport.classList.remove('hidden');
      } else {
        btnWhatsappReport.classList.add('hidden');
      }
    }
  };

  // Lógica de Quick Date
  const quickDateBtns = document.querySelectorAll('.btn-quick-date');
  quickDateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const range = btn.dataset.range;
      const today = new Date();
      let start = new Date();
      let end = new Date();

      switch (range) {
        case 'today':
          // Ya están por defecto
          break;
        case 'yesterday':
          start.setDate(today.getDate() - 1);
          end.setDate(today.getDate() - 1);
          break;
        case 'last7':
          start.setDate(today.getDate() - 7);
          break;
        case 'thisMonth':
          start = new Date(today.getFullYear(), today.getMonth(), 1);
          break;
      }

      startDateInput.value = formatDate(start);
      endDateInput.value = formatDate(end);
      generateReport();
    });
  });

  // NUEVO: Buscador GLOBAL dinámico con Debounce
  const reportSearchInput = document.getElementById('report-search-input');

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  const handleGlobalSearch = async (e) => {
    const term = e.target.value.trim();

    // 1. Si está vacío, restaurar original
    if (!term) {
      renderCombinedTable(originalSales, originalPayments);

      // Recalcular resumen original
      const summary = computeRealizedSummary(originalSales);
      renderSummary(summary);

      if (summaryCards) summaryCards.classList.remove('hidden');
      if (downloadPdfBtn) downloadPdfBtn.classList.remove('hidden');
      return;
    }

    // 2. Si es muy corto, filtrar localmente (opcional) o no hacer nada
    if (term.length < 2) {
      return;
    }

    try {
      // 3. Buscar en BD (Global)
      // Mostrar indicador de carga...
      renderPlaceholder('Buscando en toda la base de datos...', 'text-blue-500');
      if (summaryCards) summaryCards.classList.add('hidden');
      if (downloadPdfBtn) downloadPdfBtn.classList.add('hidden');

      const res = await fetch(`/api/reports/search?q=${encodeURIComponent(term)}`);
      const data = await res.json();

      if (data.detailedSales) {
        // Renderizar resultados de búsqueda
        // La búsqueda solo trae ventas, no abonos sueltos, así que pasamos array vacío de pagos
        renderCombinedTable(data.detailedSales, []);
      } else {
        renderPlaceholder('No se encontraron ventas con ese criterio.');
      }

    } catch (error) {
      console.error('Error buscando:', error);
      renderPlaceholder('Error al buscar datos.');
    }
  };

  if (reportSearchInput) {
    reportSearchInput.addEventListener('input', debounce(handleGlobalSearch, 600));
  }

  if (tabVentas) {
    tabVentas.addEventListener('click', () => setActiveTab('ventas'));
  }
  if (tabAbonos) {
    tabAbonos.addEventListener('click', () => setActiveTab('abonos'));
  }

  initializeReports();
});
