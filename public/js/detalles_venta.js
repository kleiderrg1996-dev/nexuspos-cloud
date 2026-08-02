// public/js/detalles_venta.js

// Proxy para acceder al helper de ventanas desde cualquier contexto (Iframe o Popup)
const _openWindowsDetalle = {};
window.openAppWindow = window.openAppWindow || (window.parent && window.parent.openAppWindow) || (window.opener && window.opener.openAppWindow) || function (url, title = 'NexusPOS', w = 1000, h = 800) {
    const left = (screen.width / 2) - (w / 2);
    const top = (screen.height / 2) - (h / 2);
    const key = title || url;
    if (_openWindowsDetalle[key] && !_openWindowsDetalle[key].closed) {
        _openWindowsDetalle[key].location.href = url;
        _openWindowsDetalle[key].focus();
        return _openWindowsDetalle[key];
    }
    const win = window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
    _openWindowsDetalle[key] = win;
    return win;
};

// Proxies para helpers de WhatsApp definidos en layout.js (ventana padre)
window.sendWhatsAppMessage = window.sendWhatsAppMessage || (window.parent && window.parent.sendWhatsAppMessage) || (window.opener && window.opener.sendWhatsAppMessage) || null;
window.formatInvoiceMessage = window.formatInvoiceMessage || (window.parent && window.parent.formatInvoiceMessage) || (window.opener && window.opener.formatInvoiceMessage) || null;
window.sendWhatsAppWithPdf = window.sendWhatsAppWithPdf || (window.parent && window.parent.sendWhatsAppWithPdf) || (window.opener && window.opener.sendWhatsAppWithPdf) || null;

document.addEventListener('DOMContentLoaded', () => {

    const saleIdTitle = document.getElementById('sale-id-title');
    const loadingMessage = document.getElementById('loading-message');
    const errorMessage = document.getElementById('error-message');
    const saleDetailsContainer = document.getElementById('sale-details-container');

    const productsTableBody = document.getElementById('products-table-body');
    const paymentsTableBody = document.getElementById('payments-table-body');

    const summaryTotalVes = document.getElementById('summary-total-ves');
    const summarySubtotal = document.getElementById('summary-subtotal');
    const summaryIva = document.getElementById('summary-iva');
    const summaryTotalUsd = document.getElementById('summary-total-usd');
    const summaryTotalPagado = document.getElementById('summary-total-pagado');
    const summaryTotalPendienteVes = document.getElementById('summary-total-pendiente-ves');
    const summaryTotalPendienteUsd = document.getElementById('summary-total-pendiente-usd');
    const summaryEstado = document.getElementById('summary-estado');
    const summaryFecha = document.getElementById('summary-fecha');

    const clientInfoCard = document.getElementById('client-info-card');
    const clientNombre = document.getElementById('client-nombre');
    const clientCedula = document.getElementById('client-cedula');
    const clientTelefono = document.getElementById('client-telefono');

    const btnPrintReceipt = document.getElementById('btn-print-receipt');

    let currentBcvRate = 1;
    let allRates = {};
    let currentSaleId = null;
    let currentSale = null;
    let currentSaleData = null;

    // ---------- Helpers numéricos ----------

    function safeNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    // ---------- Helpers de modales globales (index.html / layout.js) ----------

    async function showGlobalAlert(message, title = 'Alerta del sistema') {
        const ctx = window.parent || window;
        if (typeof ctx.openSystemAlert === 'function') {
            await ctx.openSystemAlert(message, title);
        } else {
            console.log('ALERTA:', title, message);
        }
    }

    async function showGlobalConfirm(message, title = 'Confirmar acción') {
        const ctx = window.parent || window;
        if (typeof ctx.openSystemConfirm === 'function') {
            return await ctx.openSystemConfirm(message, title);
        } else {
            console.log('CONFIRM (sin modal disponible):', title, message);
            // En fallback NO usamos window.confirm para no bloquear Electron
            return true;
        }
    }

    // ---------- Impresión ----------


    function printReceipt() {
        if (!currentSaleId) return;
        const url = `/api/sales/${encodeURIComponent(currentSaleId)}/receipt`;
        openAppWindow(url, 'Ticket', 350, 750);
    }

    // ---------- Anular abono ----------

    async function handleVoidAbono(abonoId) {
        if (!abonoId) return;
        if (!currentSaleId) return;

        const confirmed = await showGlobalConfirm(
            '¿Seguro que deseas anular este abono? Esta acción no se puede deshacer.',
            'Anular abono'
        );
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/clients/payment/${encodeURIComponent(abonoId)}/void`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    motivo: `Anulado desde la venta #${currentSaleId}`,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'No se pudo anular el abono.');
            }

            await loadSaleDetails();
            await showGlobalAlert('El abono fue anulado correctamente.', 'Abono anulado');
        } catch (error) {
            console.error('Error al anular abono:', error);
            await showGlobalAlert(
                error.message || 'Error inesperado al anular el abono.',
                'Error al anular abono'
            );
        }
    }

    // ---------- Cargar detalles de la venta ----------

    async function loadSaleDetails() {
        try {
            const params = new URLSearchParams(window.location.search);
            const saleId = params.get('id');
            const autoPrint = params.get('print') === '1';

            if (!saleId) {
                throw new Error('No se ha especificado un ID de venta.');
            }

            currentSaleId = saleId;

            if (saleIdTitle) {
                saleIdTitle.textContent = `#${saleId}`;
            }

            // 1) Tasas
            const ratesResponse = await fetch('/api/settings/rates');
            if (!ratesResponse.ok) throw new Error('No se pudieron cargar las tasas de cambio.');
            allRates = await ratesResponse.json();
            currentBcvRate = parseFloat(allRates.BCV) || 1;

            // 2) Detalles de la venta
            const response = await fetch(`/api/sales/${saleId}/details`);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Error al cargar los detalles de la venta.');
            }

            const data = await response.json();
            renderDetails(data);

            if (loadingMessage) loadingMessage.classList.add('hidden');
            if (saleDetailsContainer) saleDetailsContainer.classList.remove('hidden');

            if (autoPrint) {
                printReceipt();
            }

        } catch (error) {
            console.error('Error:', error);
            if (loadingMessage) loadingMessage.classList.add('hidden');
            if (errorMessage) {
                errorMessage.textContent = error.message;
                errorMessage.classList.remove('hidden');
            }
            // Opcional: también mostrar modal global
            await showGlobalAlert(error.message || 'Error al cargar la venta.', 'Error');
        }
    }

    function renderDetails(data) {
        if (!data) return;

        const {
            sale = {},
            cliente = null,
            products = [],
            payments = [],
            abonos = []
        } = data;

        currentSale = sale;
        currentSaleData = data;

        renderSummary(sale, payments, abonos);
        renderClient(cliente);
        renderProducts(products);
        renderPayments(sale, payments, abonos);
    }

    // ---------- Resumen cabecera ----------

    function renderSummary(sale, payments = [], abonos = []) {
        if (!sale) return;

        // Fecha
        const creadoEn = sale.creado_en || sale.created_at || null;
        if (summaryFecha && creadoEn) {
            const formattedDate = new Date(creadoEn).toLocaleString('es-VE', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            summaryFecha.textContent = formattedDate;
        }

        // 1) Total original en USD (fijo, desde BD)
        const totalUsdOriginal = safeNumber(
            sale.total_usd_bcv ??
            sale.deuda_original_usd ??
            sale.total_usd,
            0
        );

        // 2) Total en Bs histórico de la venta
        const totalVesOriginal = safeNumber(sale.total_ves, 0);
        const impuestoTotal = safeNumber(sale.impuesto_total, 0);
        const subtotalVes = totalVesOriginal - impuestoTotal;

        if (summaryTotalVes) {
            let originalRateHtml = '';
            if (totalUsdOriginal > 0) {
                const origRate = totalVesOriginal / totalUsdOriginal;
                originalRateHtml = `<span class="text-xs text-gray-400 font-normal mt-0.5">(Tasa orig: ${origRate.toFixed(2)} Bs/$)</span>`;
            }
            summaryTotalVes.innerHTML = `<span>${totalVesOriginal.toFixed(2)} Bs</span>${originalRateHtml}`;
        }
        if (summarySubtotal) {
            summarySubtotal.textContent = `${subtotalVes.toFixed(2)} Bs`;
        }
        if (summaryIva) {
            summaryIva.textContent = `${impuestoTotal.toFixed(2)} Bs`;
        }
        if (summaryTotalUsd) {
            summaryTotalUsd.textContent = `${totalUsdOriginal.toFixed(2)} $`;
        }

        // 3) Pendiente en USD
        let pendienteUsd = 0;

        const pendienteFromSaleField =
            sale.monto_pendiente_usd !== undefined && sale.monto_pendiente_usd !== null
                ? safeNumber(sale.monto_pendiente_usd, 0)
                : null;

        const pendienteLegacyField =
            sale.pendiente_usd !== undefined && sale.pendiente_usd !== null
                ? safeNumber(sale.pendiente_usd, 0)
                : null;

        // Calculado a partir de abonos en USD (si hiciera falta)
        let pendienteFromAbonos = null;
        if (Array.isArray(abonos) && abonos.length > 0 && totalUsdOriginal > 0) {
            let sumaAbonosUsd = 0;

            abonos.forEach(a => {
                let abonoUsd = 0;

                if (a.monto_pagado_usd !== undefined && a.monto_pagado_usd !== null) {
                    abonoUsd = safeNumber(a.monto_pagado_usd, 0);
                } else {
                    const montoVes = safeNumber(a.monto_pagado_ves, 0);
                    const tasaAbono = safeNumber(
                        a.tasa_usd ?? a.tasa ?? currentBcvRate,
                        currentBcvRate || 1
                    );
                    abonoUsd = tasaAbono ? (montoVes / tasaAbono) : 0;
                }

                sumaAbonosUsd += abonoUsd;
            });

            pendienteFromAbonos = totalUsdOriginal - sumaAbonosUsd;
        }

        if (pendienteFromSaleField !== null) {
            pendienteUsd = pendienteFromSaleField;
        } else if (pendienteLegacyField !== null) {
            pendienteUsd = pendienteLegacyField;
        } else if (pendienteFromAbonos !== null) {
            pendienteUsd = pendienteFromAbonos;
        } else if (totalUsdOriginal > 0) {
            // Último recurso: sumar pagos + abonos en USD
            let sumaPagosUsd = 0;

            payments.forEach(p => {
                const montoVes = safeNumber(p.monto_en_ves, 0);
                const montoRecibido = safeNumber(p.monto_recibido, 0);
                const tasaPago = safeNumber(
                    p.tasa_bcv_momento ?? p.tasa_usd ?? currentBcvRate,
                    currentBcvRate || 1
                );

                let pagoUsd = 0;

                if (p.metodo === 'USD_EFECTIVO' || p.metodo === 'ZELLE') {
                    pagoUsd = montoRecibido !== 0
                        ? montoRecibido
                        : (tasaPago ? (montoVes / tasaPago) : 0);
                } else {
                    pagoUsd = tasaPago ? (montoVes / tasaPago) : 0;
                }

                sumaPagosUsd += pagoUsd;
            });

            abonos.forEach(a => {
                const montoVes = safeNumber(a.monto_pagado_ves, 0);
                let abonoUsd = 0;

                if (a.monto_pagado_usd !== undefined && a.monto_pagado_usd !== null) {
                    abonoUsd = safeNumber(a.monto_pagado_usd, 0);
                } else {
                    const tasaAbono = safeNumber(
                        a.tasa_usd ?? a.tasa ?? currentBcvRate,
                        currentBcvRate || 1
                    );
                    abonoUsd = tasaAbono ? (montoVes / tasaAbono) : 0;
                }

                sumaPagosUsd += abonoUsd;
            });

            pendienteUsd = totalUsdOriginal - sumaPagosUsd;
        } else {
            pendienteUsd = 0;
        }

        // Normalizar valores pequeños (tolerancia visual mínima para errores de float muy pequeños)
        if (Math.abs(pendienteUsd) < 0.005) {
            pendienteUsd = 0;
        }

        // Venta pagada o anulada → pendiente 0
        if (sale.estado_pago === 'PAGADO' || sale.estado_pago === 'ANULADO') {
            pendienteUsd = 0;
        }

        // Determinar tasa de conversión (Forzar PARALELO para deudas si está disponible)
        let tasaTipo = sale.tasa_referencia || 'BCV';
        if (allRates.PARALELO) tasaTipo = 'PARALELO';
        const tasaConversion = safeNumber(allRates[tasaTipo], currentBcvRate);

        const pendienteVes = pendienteUsd * tasaConversion;

        if (summaryTotalPendienteVes) {
            summaryTotalPendienteVes.textContent = `${pendienteVes.toFixed(2)} Bs`;
        }
        if (summaryTotalPendienteUsd) {
            summaryTotalPendienteUsd.textContent = `(${pendienteUsd.toFixed(2)} $)`;
        }

        // Explicación de tasa y fórmula dinámica
        const rateExplanationBox = document.getElementById('rate-explanation-box');
        const expPendienteUsd = document.getElementById('exp-pendiente-usd');
        const expTasaNombre = document.getElementById('exp-tasa-nombre');
        const expTasaValor = document.getElementById('exp-tasa-valor');
        const expFormula = document.getElementById('exp-formula');

        if (pendienteUsd > 0.005) {
            if (rateExplanationBox) rateExplanationBox.classList.remove('hidden');
            if (expPendienteUsd) expPendienteUsd.textContent = `${pendienteUsd.toFixed(2)} $`;
            if (expTasaNombre) expTasaNombre.textContent = tasaTipo;
            if (expTasaValor) expTasaValor.textContent = `${tasaConversion.toFixed(2)} Bs/$`;
            if (expFormula) {
                expFormula.textContent = `${pendienteUsd.toFixed(2)} $ × ${tasaConversion.toFixed(2)} Bs/$ = ${pendienteVes.toFixed(2)} Bs`;
            }
        } else {
            if (rateExplanationBox) rateExplanationBox.classList.add('hidden');
        }

        // 4) Total pagado (Suma real de los pagos y abonos en Bs)
        let sumPagosVes = 0;
        payments.forEach(p => sumPagosVes += safeNumber(p.monto_en_ves, 0));
        abonos.forEach(a => sumPagosVes += safeNumber(a.monto_pagado_ves, 0));

        let totalPagadoVes = sumPagosVes;

        // Si la venta está marcada como PAGADA, nos aseguramos que el resumen muestre al menos el total
        // histórico para evitar discrepancias por céntimos o redondeos de tasa.
        if ((sale.estado_pago === 'PAGADO' || pendienteUsd <= 0.005) && totalPagadoVes > 0) {
            totalPagadoVes = Math.max(totalPagadoVes, totalVesOriginal);
        }

        if (summaryTotalPagado) {
            summaryTotalPagado.textContent = `${totalPagadoVes.toFixed(2)} Bs`;
        }

        // 5) Estado de la venta
        if (summaryEstado) {
            let estadoClass = '';
            switch (sale.estado_pago) {
                case 'PAGADO':
                    estadoClass = 'text-green-600';
                    break;
                case 'ABONADO':
                    estadoClass = 'text-yellow-600';
                    break;
                case 'FIADO':
                    estadoClass = 'text-red-600';
                    break;
                case 'ANULADO':
                    estadoClass = 'text-gray-500';
                    break;
                default:
                    estadoClass = 'text-gray-700';
            }
            summaryEstado.textContent = sale.estado_pago || 'DESCONOCIDO';
            summaryEstado.className = `font-semibold ${estadoClass}`;
        }
    }

    // ---------- Cliente ----------

    function renderClient(cliente) {
        if (!cliente || !clientInfoCard) return;

        if (clientNombre) clientNombre.textContent = cliente.nombre || 'Cliente';
        if (clientCedula) clientCedula.textContent = cliente.cedula || 'N/A';
        if (clientTelefono) clientTelefono.textContent = cliente.telefono || 'N/A';

        clientInfoCard.classList.remove('hidden');
    }

    // ---------- Productos ----------

    function renderProducts(products = []) {
        if (!productsTableBody) return;

        productsTableBody.innerHTML = '';

        if (!products.length) {
            productsTableBody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-4 py-3 text-center text-gray-500">
                        No se encontraron productos para esta venta.
                    </td>
                </tr>`;
            return;
        }

        products.forEach(p => {
            const tr = document.createElement('tr');

            const nombreProducto =
                p.producto_nombre ||
                p.nombre_producto ||
                p.nombre ||
                '[Producto Eliminado]';

            const cantidad = safeNumber(p.cantidad, 0);
            const precioUnitario = safeNumber(p.precio_unitario_ves, 0);
            const totalItem = cantidad * precioUnitario;

            tr.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-900">${nombreProducto}</td>
                <td class="px-4 py-3 text-sm text-gray-600 text-right">${cantidad}</td>
                <td class="px-4 py-3 text-sm text-gray-600 text-right">${precioUnitario.toFixed(2)}</td>
                <td class="px-4 py-3 text-sm text-gray-900 font-medium text-right">${totalItem.toFixed(2)}</td>
            `;
            productsTableBody.appendChild(tr);
        });
    }

    // ---------- Pagos y abonos ----------

    function renderPayments(sale, payments = [], abonos = []) {
        if (!paymentsTableBody) return;

        paymentsTableBody.innerHTML = '';

        if (!payments.length && !abonos.length) {
            paymentsTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-4 py-3 text-center text-gray-500">
                        No se registraron pagos para esta venta.
                    </td>
                </tr>`;
            return;
        }

        const saleIsClosed =
            sale &&
            (sale.estado_pago === 'ANULADO' || sale.estado_pago === 'PAGADO');

        // Pagos iniciales + movimientos (incluye vuelto como negativo)
        payments.forEach(p => {
            const tr = document.createElement('tr');

            const fechaBase = p.creado_en || p.fecha || sale?.creado_en || sale?.created_at;
            const fecha = fechaBase
                ? new Date(fechaBase).toLocaleDateString('es-VE')
                : '';

            const montoVes = safeNumber(p.monto_en_ves, 0);
            const tasa = safeNumber(
                p.tasa_bcv_momento ?? p.tasa_usd ?? currentBcvRate,
                currentBcvRate || 1
            );

            let montoUsd;
            if (p.metodo === 'USD_EFECTIVO' || p.metodo === 'ZELLE') {
                if (typeof p.monto_recibido === 'number') {
                    montoUsd = safeNumber(p.monto_recibido, 0);
                } else {
                    montoUsd = tasa ? montoVes / tasa : 0;
                }
            } else {
                montoUsd = tasa ? montoVes / tasa : 0;
            }

            const isChange = montoVes < 0;
            const tipoMovimiento = isChange ? 'Vuelto' : 'Pago Inicial';

            tr.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-600">${fecha}</td>
                <td class="px-4 py-3 text-sm ${isChange ? 'text-red-700' : 'text-gray-900'} font-medium">
                    ${tipoMovimiento}
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">${p.metodo || 'N/A'}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${p.referencia || '-'}</td>
                <td class="px-4 py-3 text-sm ${isChange ? 'text-red-700' : 'text-gray-900'} text-right">
                    ${montoVes.toFixed(2)}
                </td>
                <td class="px-4 py-3 text-sm ${isChange ? 'text-red-600' : 'text-gray-600'} text-right">
                    ${montoUsd.toFixed(2)}
                </td>
            `;
            paymentsTableBody.appendChild(tr);
        });

        // Abonos posteriores
        abonos.forEach(a => {
            const tr = document.createElement('tr');

            const fechaBase = a.fecha || a.creado_en || sale?.creado_en || sale?.created_at;
            const fecha = fechaBase
                ? new Date(fechaBase).toLocaleDateString('es-VE')
                : '';

            const montoVes = safeNumber(a.monto_pagado_ves, 0);

            let montoUsd;
            if (typeof a.monto_pagado_usd === 'number') {
                montoUsd = safeNumber(a.monto_pagado_usd, 0);
            } else {
                const tasa = safeNumber(a.tasa_usd ?? a.tasa ?? currentBcvRate, currentBcvRate || 1);
                montoUsd = tasa ? montoVes / tasa : 0;
            }

            let actionsHtml = '';
            if (!saleIsClosed && !a.anulado && a.id) {
                actionsHtml = `
                    <button
                        type="button"
                        class="text-red-600 hover:text-red-800 text-xs underline"
                        data-action="void-abono"
                        data-abono-id="${a.id}"
                    >
                        Anular
                    </button>
                `;
            }

            tr.innerHTML = `
                <td class="px-4 py-3 text-sm text-gray-600">${fecha}</td>
                <td class="px-4 py-3 text-sm">
                    <span class="text-green-700 font-medium mr-2">Abono</span>
                    ${actionsHtml}
                </td>
                <td class="px-4 py-3 text-sm text-gray-600">${a.metodo || 'N/A'}</td>
                <td class="px-4 py-3 text-sm text-gray-600">${a.referencia || '-'}</td>
                <td class="px-4 py-3 text-sm text-green-700 text-right">${montoVes.toFixed(2)}</td>
                <td class="px-4 py-3 text-sm text-green-600 text-right">${montoUsd.toFixed(2)}</td>
            `;
            paymentsTableBody.appendChild(tr);
        });
    }

    // ---------- Eventos ----------

    if (btnPrintReceipt) {
        btnPrintReceipt.addEventListener('click', printReceipt);
    }

    const btnWhatsappSale = document.getElementById('btn-whatsapp-sale');
    if (btnWhatsappSale) {
        btnWhatsappSale.addEventListener('click', async () => {
            if (!currentSaleId) return;

            const rawPhone = document.getElementById('client-info-card').classList.contains('hidden')
                ? ''
                : (document.getElementById('client-telefono').textContent || '').trim();

            let cleanPhone = rawPhone.replace(/\D/g, '');
            if (cleanPhone.startsWith('0') && cleanPhone.length >= 10) {
                cleanPhone = '58' + cleanPhone.substring(1);
            } else if (cleanPhone.length === 10 && !cleanPhone.startsWith('58')) {
                cleanPhone = '58' + cleanPhone;
            }

            let saleData = currentSaleData;
            try {
                const response = await fetch(`/api/sales/${currentSaleId}/details`);
                if (!response.ok) throw new Error('Error al obtener venta');
                saleData = await response.json();
                console.log('[WhatsApp] Sale data:', saleData);
                console.log('[WhatsApp] Abonos:', saleData.abonos);
            } catch (err) {
                console.error('Error cargando venta:', err);
            }

            const msg = buildDetailedMessage(saleData);

            const waUrl = cleanPhone
                ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg)}`
                : `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;

            fetch(`/api/utils/open-external?url=${encodeURIComponent(waUrl)}`).catch(console.error);
        });
    }

    function buildDetailedMessage(data) {
        if (!data) return 'Sin datos de la venta.';
        const { sale = {}, cliente = null, products = [], payments = [], abonos = [] } = data;
        const saleDate = sale.creado_en
            ? new Date(sale.creado_en).toLocaleString('es-VE')
            : new Date().toLocaleString('es-VE');

        let msg = `*FACTURA DE VENTA - NexusPOS*\n`;
        msg += `--------------------------------\n`;
        msg += `*Venta #:* ${sale.id || currentSaleId}\n`;
        msg += `*Fecha:* ${saleDate}\n`;

        if (cliente && cliente.nombre) {
            msg += `*Cliente:* ${cliente.nombre}\n`;
            if (cliente.cedula) msg += `*Cédula/RIF:* ${cliente.cedula}\n`;
        }

        if (products.length > 0) {
            msg += `\n*Detalle de Productos:*\n`;
            products.forEach(p => {
                const qty = p.cantidad || 1;
                const nombre = p.producto_nombre || p.nombre || 'Producto';
                const price = Number(p.precio_unitario_ves || 0).toFixed(2);
                const subtotal = (qty * Number(p.precio_unitario_ves || 0)).toFixed(2);
                let unitSuffix = '';
                if (p.tipo_venta === 'PESO') unitSuffix = ' Kg';
                else if (p.tipo_venta === 'LITRO') unitSuffix = ' Lt';
                let qtyDisplay = qty;
                if (p.tipo_venta === 'PESO' || p.tipo_venta === 'LITRO') qtyDisplay = Number(qty).toFixed(3);
                msg += `• ${qtyDisplay}${unitSuffix} x ${nombre} = ${subtotal} Bs\n`;
            });
        }

        msg += `\n--------------------------------\n`;
        msg += `*TOTAL: ${Number(sale.total_ves || 0).toFixed(2)} Bs*\n`;
        if (sale.total_usd_bcv) msg += `*Total USD: ${Number(sale.total_usd_bcv).toFixed(2)} $*\n`;

        if (payments.length > 0) {
            msg += `\n*Pagos realizados:*\n`;
            payments.forEach(p => {
                const fecha = p.creado_en ? new Date(p.creado_en).toLocaleString('es-VE') : '';
                let label = p.metodo || 'N/A';
                if (p.metodo === 'VES_EFECTIVO') label = 'Efectivo Bs';
                if (p.metodo === 'USD_EFECTIVO') label = 'Efectivo $';
                if (p.metodo === 'TARJETA') label = 'Tarjeta';
                if (p.metodo === 'BIOPAGO') label = 'Biopago';
                if (p.metodo === 'PAGOMOVIL') label = 'Pago Móvil';
                if (p.metodo === 'ZELLE') label = 'Zelle $';
                const monto = Number(p.monto_en_ves || 0).toFixed(2);
                const ref = p.referencia ? ` (Ref: ${p.referencia})` : '';
                msg += `• ${fecha} - ${label}: ${monto} Bs${ref}\n`;
            });
        }

        if (abonos.length > 0) {
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
            msg += `\n*ESTADO: PENDIENTE*\n`;
            msg += `*Saldo Pendiente:* ${pendiente} $\n`;
        } else {
            msg += `\n*ESTADO: PAGADO*\n`;
        }

        msg += `\nGracias por su compra.`;
        return msg;
    }

    if (paymentsTableBody) {
        paymentsTableBody.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-action="void-abono"]');
            if (!btn) return;
            const abonoId = btn.dataset.abonoId;
            handleVoidAbono(abonoId);
        });
    }

    // ---------- Inicialización ----------
    loadSaleDetails();
});
