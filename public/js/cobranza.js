// public/js/cobranzas.js
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('client-search-input');
    const clientListContainer = document.getElementById('client-list-container');
    const clientListPlaceholder = document.getElementById('client-list-placeholder');
    const btnAddClient = document.getElementById('btn-add-client');

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

    const paymentModal = document.getElementById('payment-modal');
    const paymentModalTitle = document.getElementById('payment-modal-title');
    const paymentForm = document.getElementById('form-payment');
    const paymentClientIdInput = document.getElementById('payment-client-id');
    const paymentSaleIdInput = document.getElementById('payment-sale-id');
    const paymentClientName = document.getElementById('payment-client-name');
    const paymentDueAmount = document.getElementById('payment-due-amount');
    const paymentAmountInput = document.getElementById('payment-amount');
    const paymentMethodSelect = document.getElementById('payment-method');
    const paymentUsdDetails = document.getElementById('payment-usd-details');
    const paymentUsdRateInput = document.getElementById('payment-usd-rate');
    const btnClosePaymentModal = document.getElementById('btn-close-payment-modal');
    const btnCancelPayment = document.getElementById('btn-cancelar-payment');
    const paymentModalStatus = document.getElementById('payment-modal-status');

    const paymentSubmitButton = paymentForm.querySelector('button[type="submit"]');

    let searchTimeout;
    let currentBcvRate = 0;
    let allRates = {};

    // Helper numérico reutilizado
    function safeNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    // Helper: Obtener tasa PREFERIDA para cálculos de deuda (PARALELO > BCV)
    function getPreferredRate() {
        if (allRates.PARALELO && parseFloat(allRates.PARALELO) > 0) {
            return parseFloat(allRates.PARALELO);
        }
        return currentBcvRate || 1;
    }

    // Formatear Bs con 2 decimales, correctamente redondeado
    // Ej: 115.75842 -> "115.76"
    function formatBs(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '0.00';
        return n.toFixed(2);
    }

    // Modo de pago en el modal de ABONO: solo se usa 'SALE' ahora
    let paymentMode = null;
    let currentTotalDebtVes = 0; // ya no se usa para full, pero lo dejamos por compatibilidad
    let currentSaleDebtVes = 0;  // deuda de la venta específica

    // ===== Helpers para usar el modal global (en vez de alert/confirm nativos) =====
    function showToast(message, type = 'info') {
        if (window.parent && window.parent.Toast) {
            window.parent.Toast.show(message, type);
        }
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
    // ============================================================================

    async function loadBcvRate() {
        try {
            const response = await fetch('/api/settings/rates');
            if (!response.ok) throw new Error('No se cargaron las tasas');
            allRates = await response.json();
            currentBcvRate = parseFloat(allRates.BCV) || 0;

            // Determinar tasa preferida: PARALELO si existe, sino BCV
            const preferredRate = (allRates.PARALELO && parseFloat(allRates.PARALELO) > 0)
                ? parseFloat(allRates.PARALELO)
                : currentBcvRate;
            const preferredType = (allRates.PARALELO && parseFloat(allRates.PARALELO) > 0)
                ? 'PARALELO' : 'BCV';

            // Establecer tasa PREFERIDA (PARALELO) por defecto en el input de abono individual
            paymentUsdRateInput.value = preferredRate;

            // Pre-seleccionar el radio button correcto en el modal de abono
            const radioAbono = paymentModal?.querySelector(`input[name="payment-rate-type"][value="${preferredType}"]`);
            if (radioAbono) radioAbono.checked = true;

            // Actualizar indicadores en la UI
            const headerBcv = document.getElementById('header-bcv-rate');
            const badgeBcv = document.getElementById('bcv-rate-badge');
            
            let badgeText = `Tasa BCV: ${currentBcvRate.toFixed(2)}`;
            
            if (allRates.PARALELO && parseFloat(allRates.PARALELO) > 0) {
                const par = parseFloat(allRates.PARALELO).toFixed(2);
                badgeText += ` | Paralelo: ${par}`;
            }

            if (headerBcv) headerBcv.textContent = ''; // Limpiar el subtítulo por completo
            if (badgeBcv) badgeBcv.textContent = badgeText;

            // Actualizar tasa en el modal de saldar cuenta con tasa PREFERIDA
            const fullUsdRate = document.getElementById('full-payment-usd-rate');
            if (fullUsdRate) fullUsdRate.value = preferredRate;

            // Pre-seleccionar el radio button correcto en el modal de saldar cuenta
            const radioFull = fullPaymentModal?.querySelector(`input[name="full-rate-type"][value="${preferredType}"]`);
            if (radioFull) radioFull.checked = true;

        } catch (error) {
            console.error('Error cargando tasas:', error);
            await showGlobalAlert(
                'No se pudieron cargar las tasas de cambio. Los abonos en USD podrían no calcularse correctamente.',
                'Tasas de Cambio'
            );
        }
    }

    async function loadClients(searchTerm = '') {
        try {
            const response = await fetch(`/api/clients?search=${encodeURIComponent(searchTerm)}`);
            if (!response.ok) throw new Error('Error al cargar clientes');
            const clients = await response.json();
            await renderClients(clients);
        } catch (error) {
            console.error('Error:', error);
            clientListContainer.innerHTML = '';
            clientListPlaceholder.textContent = 'Error al cargar clientes.';
            clientListPlaceholder.classList.remove('hidden');
        }
    }

    // Recalcula la deuda total de un cliente usando /clients/:id/debts y getDebtPendingAmounts
    async function recalcClientTotals(client, cardElement) {
        try {
            const resp = await fetch(`/api/clients/${client.id}/debts`);
            if (!resp.ok) throw new Error('No se pudieron cargar deudas del cliente');
            const data = await resp.json();
            const deudas = Array.isArray(data.deudas) ? data.deudas : [];

            let totalPendienteVes = 0;
            let totalPendienteUsd = 0;

            for (const deuda of deudas) {
                const pendienteUsd = Number(deuda.monto_pendiente_usd) || 0;

                    // Usar pendienteVes de la API si existe, de lo contrario recalcular con tasa de referencia (Forzando PARALELO si existe)
                    let pendienteVes = Number(deuda.monto_pendiente_ves);
                    if (isNaN(pendienteVes)) {
                        let tasaTipo = deuda.tasa_referencia || 'BCV';
                    if (allRates.PARALELO) tasaTipo = 'PARALELO';
                    const tasa = Number(allRates[tasaTipo]) || getPreferredRate();
                    const pendienteVes = pendienteUsd * tasa;
                }

                totalPendienteUsd += pendienteUsd;
                totalPendienteVes += pendienteVes;
            }

            // Redondeamos totales también a 2 decimales
            totalPendienteVes = Number(totalPendienteVes.toFixed(2));
            totalPendienteUsd = Number(totalPendienteUsd.toFixed(2));

            const deudaTotalVesEl = cardElement.querySelector('.client-total-debt-ves');
            const deudaTotalUsdEl = cardElement.querySelector('.client-total-debt-usd');
            const btnPay = cardElement.querySelector('.btn-pay[data-client-id="' + client.id + '"]');

            if (deudaTotalVesEl) {
                deudaTotalVesEl.textContent = `${formatBs(totalPendienteVes)} Bs`;
            }
            if (deudaTotalUsdEl) {
                deudaTotalUsdEl.textContent = `(${totalPendienteUsd.toFixed(2)} $)`;
            }
            if (btnPay) {
                btnPay.dataset.deudaTotalVes = totalPendienteVes;
                btnPay.dataset.deudaTotalUsd = totalPendienteUsd;
            }
        } catch (error) {
            console.warn('No se pudo recalcular la deuda total del cliente', client.id, error);
        }
    }

    async function renderClients(clients) {
        clientListContainer.innerHTML = '';
        const clientsWithDebt = clients.filter(c => c.deuda_total_ves > 0.005);

        if (clientsWithDebt.length === 0) {
            clientListPlaceholder.textContent = 'No hay clientes con deudas pendientes.';
            clientListPlaceholder.classList.remove('hidden');
            return;
        }

        clientListPlaceholder.classList.add('hidden');

        for (const client of clientsWithDebt) {
            const div = document.createElement('div');
            // Added distinct class 'client-card-container' for safe selection
            div.className = 'client-card-container bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col gap-6 hover:shadow-md transition-all duration-200';
            div.innerHTML = `
                <!-- Main Content Row -->
                <div class="flex flex-col md:flex-row gap-6 items-start md:items-center w-full">
                    <!-- Left: Client Info -->
                    <div class="flex-1 flex gap-4 min-w-0">
                        <div class="flex-shrink-0 h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-blue-600 dark:text-blue-300 font-bold text-xl uppercase">
                            ${client.nombre.charAt(0)}
                        </div>
                        <div class="min-w-0">
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white truncate">${client.nombre}</h3>
                            <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400 mt-1">
                                <span class="flex items-center gap-1">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"></path></svg>
                                    ${client.cedula ? 'C.I. ' + client.cedula : 'Sin C.I.'}
                                </span>
                                <span class="flex items-center gap-1">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                                    ${client.telefono || 'Sin Tlf'}
                                </span>
                            </div>
                            ${client.direccion ? `<p class="text-xs text-gray-400 mt-1 truncate max-w-md">${client.direccion}</p>` : ''}
                        </div>
                    </div>

                    <!-- Right: Debt & Actions -->
                    <div class="flex flex-col md:items-end gap-3 w-full md:w-auto border-t md:border-t-0 md:border-l border-gray-100 dark:border-gray-700 pt-4 md:pt-0 md:pl-6">
                         <div class="text-right">
                            <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Deuda Total</p>
                            <div class="flex items-baseline justify-end gap-2">
                                 <p class="text-2xl font-bold text-red-600 dark:text-red-400 client-total-debt-ves">${formatBs(client.deuda_total_ves)} Bs</p>
                            </div>
                            <p class="text-sm font-medium text-gray-500 dark:text-gray-500 client-total-debt-usd">(${client.deuda_total_usd.toFixed(2)} $)</p>
                         </div>

                         <div class="flex gap-2 w-full md:w-auto">
                            <button class="flex-1 md:flex-none bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 px-4 rounded-lg shadow-sm transition-colors btn-pay"
                                data-client-id="${client.id}"
                                data-client-name="${client.nombre}"
                                data-deuda-total-ves="${client.deuda_total_ves}"
                                data-deuda-total-usd="${client.deuda_total_usd}">
                                Abonar
                            </button>
                            <button class="flex-1 md:flex-none bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm font-medium py-2 px-4 rounded-lg transition-colors btn-view-debts"
                                 data-client-id="${client.id}">
                                Detalles
                            </button>
                         </div>
                    </div>
                </div>
                
                <!-- Expanded Details Container (Hidden by default) -->
                <div class="debt-details w-full mt-0 pt-0 border-t border-gray-100 dark:border-gray-700 hidden">
                </div>
            `;
            clientListContainer.appendChild(div);

            // Recalcular en segundo plano la deuda total real (incluyendo pagos iniciales)
            recalcClientTotals(client, div);
        }
    }

    function openClientModal(client = null) {
        clientForm.reset();
        clientIdInput.value = '';
        if (client) {
            clientModalTitle.textContent = 'Editar Cliente';
            clientIdInput.value = client.id;
            clientNombreInput.value = client.nombre;
            clientCedulaInput.value = client.cedula;
            clientTelefonoInput.value = client.telefono;
            clientDireccionInput.value = client.direccion;
        } else {
            clientModalTitle.textContent = 'Añadir Nuevo Cliente';
        }
        clientModalStatus.textContent = '';
        clientModal.classList.remove('hidden');
    }

    function closeClientModal() {
        clientModal.classList.add('hidden');
    }

    async function handleClientSubmit(e) {
        e.preventDefault();
        const id = clientIdInput.value;
        const data = {
            nombre: clientNombreInput.value,
            cedula: clientCedulaInput.value,
            telefono: clientTelefonoInput.value,
            direccion: clientDireccionInput.value,
        };

        const url = id ? `/api/clients/${id}` : '/api/clients';
        const method = id ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Error desconocido');

            mostrarMensaje(clientModalStatus, id ? 'Cliente actualizado' : 'Cliente creado', 'success');
            setTimeout(() => {
                closeClientModal();
                loadClients(searchInput.value);
            }, 1000);
        } catch (error) {
            console.error('Error guardando cliente:', error);
            mostrarMensaje(clientModalStatus, error.message, 'error');
        }
    }

    // ===================== MODAL DE ABONO (VENTA ESPECÍFICA) =====================

    // mode = 'SALE' (ya no usamos 'CLIENT_FULL' aquí)
    function openPaymentModal(clientId, clientName, totalDeudaVes, saleId = null, mode = 'SALE') {
        paymentForm.reset();
        paymentClientIdInput.value = clientId;
        paymentSaleIdInput.value = saleId || '';
        paymentClientName.textContent = clientName;

        paymentMode = mode;

        const deudaNum = parseFloat(totalDeudaVes) || 0;

        if (mode === 'SALE') {
            currentSaleDebtVes = deudaNum;
            currentTotalDebtVes = 0;
            if (saleId) {
                paymentModalTitle.textContent = `Abonar a Venta #${saleId}`;
            } else {
                paymentModalTitle.textContent = `Abono a ${clientName}`;
            }
        } else {
            currentTotalDebtVes = deudaNum;
            currentSaleDebtVes = 0;
            paymentModalTitle.textContent = `Abonar a Cuenta: ${clientName}`;
        }
        if (paymentSubmitButton) paymentSubmitButton.textContent = 'Registrar Abono';
        paymentAmountInput.value = '';

        // 🔴 PRE-SELECCIONAR TASA PARALELO POR DEFECTO PARA TODOS LOS ABONOS
        let tasaRef = 'BCV';
        if (mode === 'SALE') {
            const target = document.querySelector(`button.btn-pay-specific[data-sale-id="${saleId}"]`);
            tasaRef = target?.dataset.tasaReferencia || 'BCV';
        }
        
        if (allRates.PARALELO) tasaRef = 'PARALELO'; // Forzar Paralelo si existe
        
        const radioTasa = paymentModal.querySelector(`input[name="payment-rate-type"][value="${tasaRef}"]`);
        if (radioTasa) radioTasa.checked = true;

        const tasaValor = allRates[tasaRef] || currentBcvRate;
        paymentUsdRateInput.value = tasaValor;

        paymentDueAmount.textContent = `${formatBs(deudaNum)} Bs`;
        paymentModalStatus.textContent = '';
        paymentUsdDetails.classList.remove('hidden');
        paymentUsdRateInput.required = true;
        paymentAmountInput.max = deudaNum.toFixed(2);

        paymentModal.classList.remove('hidden');
        actualizarEstadoBotonPago();
    }

    function closePaymentModal() {
        paymentModal.classList.add('hidden');
        paymentMode = null;
        currentTotalDebtVes = 0;
        currentSaleDebtVes = 0;
    }

    function handlePaymentMethodChange() {
        // Mostrar siempre la selección de tasa para permitir abonos a tasa paralelo o personalizada
        paymentUsdDetails.classList.remove('hidden');
        paymentUsdRateInput.required = true;
        actualizarEstadoBotonPago();
    }

    // Cambiar entre BCV y Paralelo en abono individual
    function handlePaymentRateTypeChange(e) {
        const tipo = e.target.value;
        const valor = allRates[tipo] || currentBcvRate;
        paymentUsdRateInput.value = valor;
        actualizarEstadoBotonPago();
    }

    // En el modal de ABONO solo validamos un mínimo básico
    function actualizarEstadoBotonPago() {
        if (!paymentSubmitButton) return;

        const monto = parseFloat(paymentAmountInput.value);
        if (isNaN(monto) || monto <= 0) {
            paymentSubmitButton.disabled = true;
            return;
        }

        const metodo = paymentMethodSelect.value;
        if (!metodo) {
            paymentSubmitButton.disabled = true;
            return;
        }

        paymentSubmitButton.disabled = false;
    }

    async function handlePaymentSubmit(e) {
        e.preventDefault();

        const clienteId = parseInt(paymentClientIdInput.value, 10) || null;
        const ventaId = paymentSaleIdInput.value ? parseInt(paymentSaleIdInput.value, 10) : null;
        const monto = parseFloat(paymentAmountInput.value);
        const metodo = paymentMethodSelect.value;
        let tasaUsd = parseFloat(paymentUsdRateInput.value);

        if (!clienteId) {
            mostrarMensaje(paymentModalStatus, 'No se encontró el cliente.', 'error');
            return;
        }

        if (isNaN(monto) || monto <= 0) {
            mostrarMensaje(paymentModalStatus, 'El monto debe ser un número positivo.', 'error');
            return;
        }

        if (!metodo) {
            mostrarMensaje(paymentModalStatus, 'Debes seleccionar un método de pago.', 'error');
            return;
        }

        if (isNaN(tasaUsd) || tasaUsd <= 0) {
            // Fallback: usar PARALELO si existe, sino BCV
            tasaUsd = (allRates.PARALELO && parseFloat(allRates.PARALELO) > 0)
                ? parseFloat(allRates.PARALELO)
                : currentBcvRate;
        }
        if (!tasaUsd || tasaUsd <= 0) {
            mostrarMensaje(paymentModalStatus, 'La tasa de cambio es requerida para registrar el abono.', 'error');
            return;
        }

        // MODO: ABONO A UNA SOLA VENTA
        if (!ventaId) {
            mostrarMensaje(
                paymentModalStatus,
                'No se encontró la venta. Intenta de nuevo desde "Ver Detalles" → "Abonar".',
                'error'
            );
            return;
        }

        if (currentSaleDebtVes && metodo !== 'USD_EFECTIVO') {
            if (monto - currentSaleDebtVes > 0.05) {
                mostrarMensaje(paymentModalStatus, 'El monto no puede ser mayor a la deuda pendiente de la venta.', 'error');
                return;
            }
        }

        const data = {
            cliente_id: clienteId,
            venta_id: ventaId,
            monto,
            metodo,
            tasa_usd: tasaUsd
        };

        mostrarMensaje(paymentModalStatus, 'Procesando abono...', 'info');
        console.log('Enviando pago (venta específica):', data);

        try {
            const response = await fetch('/api/clients/payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Error desconocido');

            mostrarMensaje(paymentModalStatus, '¡Abono registrado con éxito!', 'success');
            setTimeout(async () => {
                closePaymentModal();
                await loadClients(searchInput.value);

                const clientCard = clientListContainer
                    .querySelector(`.btn-view-debts[data-client-id="${clienteId}"]`)
                    ?.closest('.client-card-container');
                if (clientCard) {
                    const detailsDiv = clientCard.querySelector('.debt-details');
                    if (detailsDiv && !detailsDiv.classList.contains('hidden')) {
                        await loadClientDebts(clienteId, clientCard, true);
                    }
                }
            }, 1000);
        } catch (error) {
            console.error('Error registrando abono:', error);
            mostrarMensaje(paymentModalStatus, error.message, 'error');
        }
    }

    // ===================== COMPAT: CALCULAR MONTO PENDIENTE POR VENTA =====================

    // 1) Versión "pura" que sólo usa los campos de la deuda (tu función original, renombrada).
    function getDebtPendingAmountsCompat(deuda) {
        const tolerancia = 0.05;

        const totalVes = Number(
            deuda.total_ves ??
            deuda.total_venta_ves ??
            deuda.total_bs ??
            deuda.monto_pendiente_ves ??
            deuda.deuda_total_ves ??
            0
        );

        const totalUsd = Number(
            deuda.total_usd ??
            deuda.total_venta_usd ??
            deuda.total_divisa ??
            0
        );

        const pagadoVes = Number(
            deuda.total_pagado_ves ??
            deuda.total_abonado_ves ??
            deuda.pagado_ves ??
            deuda.monto_abonado_ves ??
            0
        );

        const pagadoUsd = Number(
            deuda.total_pagado_usd ??
            deuda.total_abonado_usd ??
            deuda.pagado_usd ??
            deuda.monto_abonado_usd ??
            0
        );

        let pendienteVesRaw =
            deuda.monto_pendiente_ves ??
            deuda.deuda_pendiente_ves ??
            deuda.pendiente_ves;

        let pendienteUsdRaw =
            deuda.monto_pendiente_usd ??
            deuda.deuda_pendiente_usd ??
            deuda.pendiente_usd;

        let pendienteVes = pendienteVesRaw != null ? Number(pendienteVesRaw) : NaN;
        let pendienteUsd = pendienteUsdRaw != null ? Number(pendienteUsdRaw) : NaN;

        const esperadoVes = totalVes - pagadoVes;
        const esperadoUsd = totalUsd - pagadoUsd;

        // ---- Compat Bs ----
        if (isNaN(pendienteVes)) {
            pendienteVes = esperadoVes;
        } else if (pagadoVes > tolerancia && !isNaN(esperadoVes)) {
            if (Math.abs(pendienteVes - esperadoVes) > tolerancia) {
                pendienteVes = esperadoVes;
            }
        }

        if (pendienteVes < 0 && Math.abs(pendienteVes) <= tolerancia) {
            pendienteVes = 0;
        }

        // ---- Compat USD ----
        if (isNaN(pendienteUsd)) {
            if (!isNaN(esperadoUsd) && (totalUsd || pagadoUsd)) {
                pendienteUsd = esperadoUsd;
            } else {
                // Si no tenemos datos en USD, convertimos usando la tasa de esta venta o la actual
                let tasa = 0;

                if (deuda.tasa_usd) {
                    tasa = Number(deuda.tasa_usd) || 0;
                } else if (totalVes && totalUsd) {
                    tasa = totalVes / totalUsd;
                } else if (currentBcvRate) {
                    tasa = currentBcvRate;
                }

                if (tasa > 0 && !isNaN(pendienteVes)) {
                    pendienteUsd = pendienteVes / tasa;
                } else {
                    pendienteUsd = 0;
                }
            }
        } else if (pagadoUsd > tolerancia && !isNaN(esperadoUsd)) {
            if (Math.abs(pendienteUsd - esperadoUsd) > tolerancia) {
                pendienteUsd = esperadoUsd;
            }
        }

        if (pendienteUsd < 0 && Math.abs(pendienteUsd) <= tolerancia) {
            pendienteUsd = 0;
        }

        // 🔹 Redondeamos ambos a 2 decimales para manejar dinero
        pendienteVes = Number(pendienteVes.toFixed(2));
        pendienteUsd = Number(pendienteUsd.toFixed(2));

        return {
            pendienteVes,
            pendienteUsd
        };
    }

    // 2) Misma lógica de renderSummary de detalles_venta.js, pero devolviendo sólo pendiente.
    function computePendingFromSaleLikeSummary(sale, payments = [], abonos = []) {
        if (!sale) {
            return { pendienteVes: 0, pendienteUsd: 0 };
        }

        // 1) Total en Bs (de la venta)
        const totalVes = safeNumber(sale.total_ves, 0);

        // 2) Total original en USD
        let totalUsdOriginal = 0;

        if (typeof sale.total_usd_bcv === 'number') {
            totalUsdOriginal = safeNumber(sale.total_usd_bcv, 0);
        } else if (typeof sale.deuda_original_usd === 'number') {
            totalUsdOriginal = safeNumber(sale.deuda_original_usd, 0);
        } else if (currentBcvRate) {
            totalUsdOriginal = totalVes / currentBcvRate;
        } else {
            totalUsdOriginal = 0;
        }

        // 3) Pendiente en USD según distintas fuentes
        let pendienteUsd = 0;

        const pendienteFromSalePendiente =
            typeof sale.pendiente_usd === 'number'
                ? safeNumber(sale.pendiente_usd, 0)
                : null;

        const pendienteFromSaleField =
            typeof sale.monto_pendiente_usd === 'number'
                ? safeNumber(sale.monto_pendiente_usd, 0)
                : null;

        // Calcular pendiente a partir de abonos si hay datos
        let pendienteFromAbonos = null;
        if (Array.isArray(abonos) && abonos.length > 0 && totalUsdOriginal > 0) {
            let sumaAbonosUsd = 0;
            abonos.forEach(a => {
                if (typeof a.monto_pagado_usd === 'number') {
                    sumaAbonosUsd += safeNumber(a.monto_pagado_usd, 0);
                } else {
                    const tasaAbono = safeNumber(
                        a.tasa_usd ?? a.tasa ?? currentBcvRate,
                        currentBcvRate || 1
                    );
                    const montoVes = safeNumber(a.monto_pagado_ves, 0);
                    const montoUsd = tasaAbono ? (montoVes / tasaAbono) : 0;
                    sumaAbonosUsd += montoUsd;
                }
            });
            pendienteFromAbonos = totalUsdOriginal - sumaAbonosUsd;
        }

        // Prioridad de fuentes para pendienteUsd:
        if (pendienteFromSalePendiente !== null) {
            pendienteUsd = pendienteFromSalePendiente;
        } else if (pendienteFromAbonos !== null) {
            pendienteUsd = pendienteFromAbonos;
        } else if (pendienteFromSaleField !== null) {
            pendienteUsd = pendienteFromSaleField;
        } else {
            // Último recurso: usar pagos + abonos para estimar
            let totalPagadoVesTmp = 0;

            payments.forEach(p => {
                const montoVes = safeNumber(p.monto_en_ves, 0);
                totalPagadoVesTmp += montoVes;
            });

            abonos.forEach(a => {
                const montoVes = safeNumber(a.monto_pagado_ves, 0);
                totalPagadoVesTmp += montoVes;
            });

            const pendienteVesCalc = Math.max(totalVes - totalPagadoVesTmp, 0);
            pendienteUsd = currentBcvRate ? (pendienteVesCalc / currentBcvRate) : 0;
        }

        // Normalizar por si queda un negativo muy pequeño
        if (Math.abs(pendienteUsd) < 0.0005) {
            pendienteUsd = 0;
        }

        // Si la venta está pagada/anulada, forzamos pendiente a 0
        if (sale.estado_pago === 'PAGADO' || sale.estado_pago === 'ANULADO') {
            pendienteUsd = 0;
        }

        // 🔹 Aquí es donde pasa lo que quieres:
        // Bs = USD_pendiente * tasa_actual, redondeado a 2 decimales
        pendienteUsd = Number(pendienteUsd.toFixed(2));
        const pendienteVes = Number((pendienteUsd * getPreferredRate()).toFixed(2));

        return {
            pendienteVes,
            pendienteUsd
        };
    }

    // 3) Versión asíncrona: intenta usar /api/sales/:id/details (igual que detalles_venta).
    //    Si algo falla, usa la versión compat de arriba.
    async function getDebtPendingAmounts(deuda) {
        try {
            const resp = await fetch(`/api/sales/${deuda.id}/details`);
            if (resp.ok) {
                const details = await resp.json();
                const sale = details.sale || {};

                // Si el backend ya hizo bien la tarea:
                const pendienteUsd =
                    typeof sale.monto_pendiente_usd === 'number'
                        ? sale.monto_pendiente_usd
                        : (typeof sale.pendienteUsd === 'number'
                            ? sale.pendienteUsd
                            : 0);

                // La deuda en Bs la calculamos aquí con la tasa ACTUAL del front
                const pendienteVes = Number((pendienteUsd * getPreferredRate()).toFixed(2));

                return { pendienteVes, pendienteUsd };
            }
        } catch (error) {
            console.warn('No se pudo calcular pendiente desde detalles de venta', deuda.id, error);
        }

        // Fallback compat si algo falla
        return getDebtPendingAmountsCompat(deuda);
    }


    // ===================== MODAL DETALLE DE DEUDAS =====================

    async function loadClientDebts(clientId, clientCard, forceOpen = false) {
        if (!clientCard) return;
        let detailsDiv = clientCard.querySelector('.debt-details');

        if (!forceOpen && !detailsDiv.classList.contains('hidden')) {
            detailsDiv.classList.add('hidden');
            detailsDiv.innerHTML = '';
            return;
        }

        detailsDiv.classList.remove('hidden');
        detailsDiv.innerHTML = '<p class="text-sm text-gray-500">Cargando detalles...</p>';

        try {
            const response = await fetch(`/api/clients/${clientId}/debts`);
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Error ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();

            const deudas = Array.isArray(data.deudas) ? data.deudas : [];

            // Vamos a quedarnos solo con las que realmente tienen saldo pendiente
            const deudasPendientes = [];

            for (const deuda of deudas) {
                const fechaRaw =
                    deuda.creado_en ||
                    deuda.fecha ||
                    deuda.created_at ||
                    deuda.createdAt;

                const fecha = fechaRaw
                    ? new Date(fechaRaw).toLocaleDateString('es-VE')
                    : 'Sin fecha';

                // Usamos directamente los valores normalizados que vienen del endpoint /debts
                // Esto asegura que coincidan con la cabecera (que usa la misma fuente)
                // y evita discrepancias por recálculos en vivo con tasas flotantes.
                const pendienteUsd = Number(deuda.monto_pendiente_usd) || 0;

                // El backend ya nos manda pendiente_ves calculado a tasa actual, pero por seguridad:
                let pendienteVes = Number(deuda.monto_pendiente_ves);
                if (isNaN(pendienteVes)) {
                    let tasaTipo = deuda.tasa_referencia || 'BCV';
                    if (allRates.PARALELO) tasaTipo = 'PARALELO';
                    const tasa = Number(allRates[tasaTipo]) || getPreferredRate();
                    pendienteVes = pendienteUsd * tasa;
                }


                // Si el pendiente real es prácticamente 0, la consideramos saldada
                if (Math.abs(pendienteVes) < 0.01 && Math.abs(pendienteUsd) < 0.01) {
                    continue;
                }

                deudasPendientes.push({ deuda, fecha, pendienteVes, pendienteUsd });
            }

            if (deudasPendientes.length === 0) {
                detailsDiv.innerHTML = '<p class="text-sm text-gray-500">Este cliente no tiene deudas pendientes.</p>';
                return;
            }

            detailsDiv.innerHTML = '';

            deudasPendientes.forEach(({ deuda, fecha, pendienteVes, pendienteUsd }) => {
                const deudaDiv = document.createElement('div');
                deudaDiv.className = 'flex justify-between items-center p-2 hover:bg-gray-50 rounded';
                deudaDiv.innerHTML = `
                    <div>
                        <a href="detalles_venta.html?id=${deuda.id}" target="content-frame" class="text-sm font-medium text-blue-600 hover:underline">Venta #${deuda.id}</a>
                        <span class="text-xs text-gray-500 ml-2">(${fecha})</span>
                    </div>
                    <div>
                        <span class="text-sm font-bold text-red-600">${formatBs(pendienteVes)} Bs</span>
                        <span class="text-xs text-gray-500"> (${pendienteUsd.toFixed(2)} $)</span>
                        <button class="ml-2 text-xs text-white bg-green-600 hover:bg-green-700 py-1 px-2 rounded-md btn-pay-specific" 
                                data-sale-id="${deuda.id}" 
                                data-client-id="${clientId}" 
                                data-client-name="${data.cliente?.nombre || ''}" 
                                data-deuda-ves="${pendienteVes}"
                                data-tasa-referencia="${deuda.tasa_referencia || 'BCV'}">
                            Abonar
                        </button>
                    </div>
                `;
                detailsDiv.appendChild(deudaDiv);
            });

        } catch (error) {
            console.error('Error cargando detalles de deuda:', error);
            detailsDiv.innerHTML = `<p class="text-sm text-red-500">Error al cargar detalles: ${error.message}</p>`;
        }
    }

    function handleClientListClick(e) {
        const target = e.target.closest('button');
        if (!target) return;

        // UPDATED: Select by explicit class instead of generic background utility
        const clientCard = target.closest('.client-card-container');
        if (!clientCard) return;

        const clientId = target.dataset.clientId;

        if (target.classList.contains('btn-view-debts')) {
            loadClientDebts(clientId, clientCard);
        }

        if (target.classList.contains('btn-pay')) {
            // Saldar TODA la deuda del cliente → nuevo modal multi-método
            const clientName = target.dataset.clientName;
            const totalVes = target.dataset.deudaTotalVes;
            const totalUsd = target.dataset.deudaTotalUsd;
            openFullPaymentModal(clientId, clientName, totalVes, totalUsd);
        }

        if (target.classList.contains('btn-pay-specific')) {
            // Abono a una venta específica
            const clientName = target.dataset.clientName;
            const saleId = target.dataset.saleId;
            const deudaVes = target.dataset.deudaVes;
            openPaymentModal(clientId, clientName, deudaVes, saleId, 'SALE');
        }
    }

    function mostrarMensaje(elemento, mensaje, tipo = 'info') {
        // Trigger global Toast for critical feedback
        if (tipo === 'success' || tipo === 'error') {
            const toastType = tipo === 'error' ? 'error' : 'success';
            showToast(mensaje, toastType);
        }

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

    // ===================== NUEVO: MODAL SALDAR DEUDA MULTIMONEDA =====================

    const fullPaymentModal = document.getElementById('full-payment-modal');
    const fullPaymentClientName = document.getElementById('full-payment-client-name');
    const fullModalTotalVes = document.getElementById('full-modal-total-ves');
    const fullModalTotalUsd = document.getElementById('full-modal-total-usd');
    const fullPaymentUsdRateInput = document.getElementById('full-payment-usd-rate');

    const fullPagoVesInput = document.getElementById('full-pago-ves-efectivo');
    const fullPagoUsdInput = document.getElementById('full-pago-usd-efectivo');
    const fullPagoTarjetaInput = document.getElementById('full-pago-tarjeta');
    const fullPagoBiopagoInput = document.getElementById('full-pago-biopago');
    const fullPagoPagoMovilInput = document.getElementById('full-pago-pagomovil');
    const fullPagoZelleInput = document.getElementById('full-pago-zelle');

    const fullBtnPagoTodoVes = document.getElementById('full-btn-pago-todo-ves');
    const fullBtnPagoTodoUsd = document.getElementById('full-btn-pago-todo-usd');
    const fullBtnPagoTodoTarjeta = document.getElementById('full-btn-pago-todo-tarjeta');
    const fullBtnPagoTodoBiopago = document.getElementById('full-btn-pago-todo-biopago');
    const fullBtnPagoTodoPagoMovil = document.getElementById('full-btn-pago-todo-pagomovil');
    const fullBtnPagoTodoZelle = document.getElementById('full-btn-pago-todo-zelle');

    const fullFaltanteContainer = document.getElementById('full-faltante-container');
    const fullVueltoContainer = document.getElementById('full-vuelto-container');
    const fullModalFaltanteVes = document.getElementById('full-modal-faltante-ves');
    const fullModalFaltanteUsd = document.getElementById('full-modal-faltante-usd');
    const fullModalVueltoVes = document.getElementById('full-modal-vuelto-ves');
    const fullModalVueltoUsd = document.getElementById('full-modal-vuelto-usd');

    const fullPaymentStatus = document.getElementById('full-payment-status');
    const btnFullCompletarPago = document.getElementById('btn-full-completar-pago');
    const btnFullCancelarPago = document.getElementById('btn-full-cancelar-pago');

    const fullChangeModal = document.getElementById('full-change-modal');
    const fullChangeTotalVes = document.getElementById('full-change-total-ves');
    const fullChangeTotalUsd = document.getElementById('full-change-total-usd');
    const fullChangeUsdInput = document.getElementById('full-change-usd-efectivo');
    const fullChangeVesInput = document.getElementById('full-change-ves-efectivo');
    const fullChangePmInput = document.getElementById('full-change-pagomovil');
    const fullBtnChangeTodoUsd = document.getElementById('full-btn-change-todo-usd');
    const fullBtnChangeTodoVes = document.getElementById('full-btn-change-todo-ves');
    const fullBtnChangeTodoPm = document.getElementById('full-btn-change-todo-pm');
    const fullChangeRemainingContainer = document.getElementById('full-change-remaining-container');
    const fullChangeRemainingVes = document.getElementById('full-change-remaining-ves');
    const fullChangeStatus = document.getElementById('full-change-status');
    const btnFullConfirmarVuelto = document.getElementById('btn-full-confirmar-vuelto');
    const btnFullCancelarVuelto = document.getElementById('btn-full-cancelar-vuelto');

    let fullPaymentClientId = null;
    let fullPaymentTotalDebtUsd = 0;
    let fullPaymentTotalDebtVes = 0;
    let fullRequiredChangeVes = 0;

    let fullPaidByMethodVes = {
        VES_EFECTIVO: 0,
        USD_EFECTIVO: 0,
        TARJETA: 0,
        BIOPAGO: 0,
        PAGOMOVIL: 0,
        ZELLE: 0
    };

    function resetFullPaymentState() {
        fullPaidByMethodVes = {
            VES_EFECTIVO: 0,
            USD_EFECTIVO: 0,
            TARJETA: 0,
            BIOPAGO: 0,
            PAGOMOVIL: 0,
            ZELLE: 0
        };
        fullRequiredChangeVes = 0;
        if (fullPaymentStatus) {
            fullPaymentStatus.textContent = '';
            fullPaymentStatus.className = 'text-sm mt-3 text-center';
        }
        if (btnFullCompletarPago) {
            btnFullCompletarPago.disabled = true;
        }
    }

    function getFullTasaUsd() {
        let tasa = parseFloat(fullPaymentUsdRateInput?.value || '0');
        if (isNaN(tasa) || tasa <= 0) {
            // Fallback: PARALELO si existe, sino BCV
            tasa = (allRates.PARALELO && parseFloat(allRates.PARALELO) > 0)
                ? parseFloat(allRates.PARALELO)
                : (currentBcvRate || 1);
        }
        return tasa;
    }

    function openFullPaymentModal(clientId, clientName, totalDeudaVes, totalDeudaUsd) {
        if (!fullPaymentModal) return;

        fullPaymentClientId = parseInt(clientId, 10);
        fullPaymentClientName.textContent = clientName;
        fullPaymentTotalDebtUsd = parseFloat(totalDeudaUsd) || 0;

        // Por defecto en cobro total usamos Paralelo si existe, o el actual
        const defaultType = allRates.PARALELO ? 'PARALELO' : 'BCV';
        const radioTasa = fullPaymentModal.querySelector(`input[name="full-rate-type"][value="${defaultType}"]`);
        if (radioTasa) radioTasa.checked = true;

        const tasa = allRates[defaultType] || getPreferredRate();
        if (fullPaymentUsdRateInput) {
            fullPaymentUsdRateInput.value = tasa.toString();
        }

        fullPaymentTotalDebtVes = fullPaymentTotalDebtUsd * tasa;

        fullModalTotalVes.textContent = `${formatBs(fullPaymentTotalDebtVes)} Bs`;
        fullModalTotalUsd.textContent = `(${fullPaymentTotalDebtUsd.toFixed(2)} $)`;

        if (fullPagoVesInput) fullPagoVesInput.value = '';
        if (fullPagoUsdInput) fullPagoUsdInput.value = '';
        if (fullPagoTarjetaInput) fullPagoTarjetaInput.value = '';
        if (fullPagoBiopagoInput) fullPagoBiopagoInput.value = '';
        if (fullPagoPagoMovilInput) fullPagoPagoMovilInput.value = '';
        if (fullPagoZelleInput) fullPagoZelleInput.value = '';

        resetFullPaymentState();
        updateFullPaymentSummary();

        fullPaymentModal.classList.remove('hidden');
    }

    function closeFullPaymentModal() {
        if (!fullPaymentModal) return;
        fullPaymentModal.classList.add('hidden');
        fullPaymentClientId = null;
        fullPaymentTotalDebtUsd = 0;
        fullPaymentTotalDebtVes = 0;
    }

    function updateFullPaymentSummary() {
        if (!fullPaymentModal) return;

        const tasa = getFullTasaUsd();

        // Recalcular deuda en Bs dinamicamente
        if (fullPaymentTotalDebtUsd > 0) {
            fullPaymentTotalDebtVes = fullPaymentTotalDebtUsd * tasa;
            fullModalTotalVes.textContent = `${formatBs(fullPaymentTotalDebtVes)} Bs`;
            fullModalTotalUsd.textContent = `(${fullPaymentTotalDebtUsd.toFixed(2)} $)`;
        }

        // Leer valores ingresados
        const ves = parseFloat(fullPagoVesInput?.value || '0') || 0;
        const usd = parseFloat(fullPagoUsdInput?.value || '0') || 0;
        const tarjeta = parseFloat(fullPagoTarjetaInput?.value || '0') || 0;
        const biopago = parseFloat(fullPagoBiopagoInput?.value || '0') || 0;
        const pagomovil = parseFloat(fullPagoPagoMovilInput?.value || '0') || 0;
        const zelle = parseFloat(fullPagoZelleInput?.value || '0') || 0;

        fullPaidByMethodVes.VES_EFECTIVO = ves;
        fullPaidByMethodVes.USD_EFECTIVO = usd * tasa;
        fullPaidByMethodVes.TARJETA = tarjeta;
        fullPaidByMethodVes.BIOPAGO = biopago;
        fullPaidByMethodVes.PAGOMOVIL = pagomovil;
        fullPaidByMethodVes.ZELLE = zelle * tasa;

        const totalPagadoVes =
            fullPaidByMethodVes.VES_EFECTIVO +
            fullPaidByMethodVes.USD_EFECTIVO +
            fullPaidByMethodVes.TARJETA +
            fullPaidByMethodVes.BIOPAGO +
            fullPaidByMethodVes.PAGOMOVIL +
            fullPaidByMethodVes.ZELLE;

        const deuda = fullPaymentTotalDebtVes || 0;
        const diff = totalPagadoVes - deuda;
        const tolerancia = 0.05;

        // Si no hay deuda, bloqueamos
        if (deuda <= 0) {
            if (fullPaymentStatus) {
                fullPaymentStatus.textContent = 'Sin deuda pendiente.';
                fullPaymentStatus.className = 'text-xs mt-2 text-center text-gray-500';
            }
            if (btnFullCompletarPago) btnFullCompletarPago.disabled = true;
            if (fullFaltanteContainer) fullFaltanteContainer.classList.add('hidden');
            if (fullVueltoContainer) fullVueltoContainer.classList.add('hidden');
            return;
        }

        // PAGO COMPLETO / EXACTO
        if (Math.abs(diff) <= tolerancia) {
            fullRequiredChangeVes = 0;
            if (fullFaltanteContainer) fullFaltanteContainer.classList.add('hidden');
            if (fullVueltoContainer) fullVueltoContainer.classList.add('hidden');

            // Habilitar botón
            if (btnFullCompletarPago) btnFullCompletarPago.disabled = false;
            if (fullPaymentStatus) fullPaymentStatus.textContent = '';

        }
        // ABONO PARCIAL (Faltante)
        else if (diff < -tolerancia) {
            const faltante = -diff;
            fullRequiredChangeVes = 0;

            if (fullFaltanteContainer) fullFaltanteContainer.classList.remove('hidden');
            if (fullVueltoContainer) fullVueltoContainer.classList.add('hidden');

            if (fullModalFaltanteVes) fullModalFaltanteVes.textContent = `${formatBs(faltante)} Bs`;
            if (fullModalFaltanteUsd) fullModalFaltanteUsd.textContent = `(${(faltante / tasa).toFixed(2)} $)`;

            // LÓGICA CLAVE: Si pagó ALGO (> 0), habilitamos el botón para Abono Parcial
            if (totalPagadoVes > 0) {
                if (btnFullCompletarPago) btnFullCompletarPago.disabled = false;
                if (fullPaymentStatus) {
                    fullPaymentStatus.textContent = 'Abono Parcial Habilitado';
                    fullPaymentStatus.className = 'text-xs mt-2 text-center text-blue-600 font-semibold';
                }
            } else {
                if (btnFullCompletarPago) btnFullCompletarPago.disabled = true;
                if (fullPaymentStatus) fullPaymentStatus.textContent = '';
            }

        }
        // PAGO CON VUELTO (Excedente)
        else {
            const vuelto = diff;
            fullRequiredChangeVes = vuelto;

            if (fullFaltanteContainer) fullFaltanteContainer.classList.add('hidden');
            if (fullVueltoContainer) fullVueltoContainer.classList.remove('hidden');

            if (fullModalVueltoVes) fullModalVueltoVes.textContent = `${formatBs(vuelto)} Bs`;
            if (fullModalVueltoUsd) fullModalVueltoUsd.textContent = `(${(vuelto / tasa).toFixed(2)} $)`;

            if (btnFullCompletarPago) btnFullCompletarPago.disabled = false;
            if (fullPaymentStatus) fullPaymentStatus.textContent = '';
        }
    }

    function handleFullPagoInputChange() {
        updateFullPaymentSummary();
    }

    // Cambiar entre BCV y Paralelo en cobro total
    function handleFullRateTypeChange(e) {
        const tipo = e.target.value;
        const valor = allRates[tipo] || currentBcvRate;
        if (fullPaymentUsdRateInput) {
            fullPaymentUsdRateInput.value = valor;
        }
        updateFullPaymentSummary();
    }

    // 🔧 Llena solo el RESTANTE en un método, respetando decimales
    function setFullPagoTodoEnBs(destInput) {
        if (!destInput) return;

        const deuda = fullPaymentTotalDebtVes || 0;
        const tasa = getFullTasaUsd();

        // Valores actuales de todos los métodos
        const vesVal = parseFloat(fullPagoVesInput?.value || '0') || 0;
        const usdVal = parseFloat(fullPagoUsdInput?.value || '0') || 0;
        const tarjetaVal = parseFloat(fullPagoTarjetaInput?.value || '0') || 0;
        const biopagoVal = parseFloat(fullPagoBiopagoInput?.value || '0') || 0;
        const pmVal = parseFloat(fullPagoPagoMovilInput?.value || '0') || 0;
        const zelleVal = parseFloat(fullPagoZelleInput?.value || '0') || 0;

        // Cuánto ya está pagado en Bs SIN contar el método destino
        let pagadoSinDestinoVes = 0;

        if (destInput === fullPagoVesInput) {
            pagadoSinDestinoVes = (usdVal * tasa) + tarjetaVal + biopagoVal + pmVal + (zelleVal * tasa);
        } else if (destInput === fullPagoUsdInput) {
            pagadoSinDestinoVes = vesVal + tarjetaVal + biopagoVal + pmVal + (zelleVal * tasa);
        } else if (destInput === fullPagoTarjetaInput) {
            pagadoSinDestinoVes = vesVal + (usdVal * tasa) + biopagoVal + pmVal + (zelleVal * tasa);
        } else if (destInput === fullPagoBiopagoInput) {
            pagadoSinDestinoVes = vesVal + (usdVal * tasa) + tarjetaVal + pmVal + (zelleVal * tasa);
        } else if (destInput === fullPagoPagoMovilInput) {
            pagadoSinDestinoVes = vesVal + (usdVal * tasa) + tarjetaVal + biopagoVal + (zelleVal * tasa);
        } else if (destInput === fullPagoZelleInput) {
            pagadoSinDestinoVes = vesVal + (usdVal * tasa) + tarjetaVal + biopagoVal + pmVal;
        }

        let restanteVes = deuda - pagadoSinDestinoVes;
        if (restanteVes < 0) restanteVes = 0;

        if (destInput === fullPagoUsdInput || destInput === fullPagoZelleInput) {
            const montoUsd = restanteVes / tasa;
            destInput.value = montoUsd > 0 ? montoUsd.toFixed(2) : '0.00';
        } else {
            destInput.value = restanteVes > 0 ? restanteVes.toFixed(2) : '0.00';
        }

        updateFullPaymentSummary();
    }

    function openFullChangeModal() {
        if (!fullChangeModal) return;

        const tasa = getFullTasaUsd();
        const vuelto = fullRequiredChangeVes || 0;

        if (fullChangeTotalVes) {
            fullChangeTotalVes.textContent = `${formatBs(vuelto)} Bs`;
        }
        if (fullChangeTotalUsd) {
            fullChangeTotalUsd.textContent = `(${(vuelto / tasa).toFixed(2)} $)`;
        }

        if (fullChangeUsdInput) fullChangeUsdInput.value = '';
        if (fullChangeVesInput) fullChangeVesInput.value = '';
        if (fullChangePmInput) fullChangePmInput.value = '';
        if (fullChangeRemainingContainer) fullChangeRemainingContainer.classList.add('hidden');
        if (fullChangeRemainingVes) fullChangeRemainingVes.textContent = '0.00 Bs';
        if (fullChangeStatus) {
            fullChangeStatus.textContent = '';
            fullChangeStatus.className = 'text-sm mt-2 text-center';
        }
        if (btnFullConfirmarVuelto) btnFullConfirmarVuelto.disabled = false;

        fullChangeModal.classList.remove('hidden');
    }

    function closeFullChangeModal() {
        if (!fullChangeModal) return;
        fullChangeModal.classList.add('hidden');
    }

    function updateFullChangeSummary() {
        if (!fullChangeModal) return;

        const tasa = getFullTasaUsd();
        const requerido = fullRequiredChangeVes || 0;

        const usd = parseFloat(fullChangeUsdInput?.value || '0') || 0;
        const ves = parseFloat(fullChangeVesInput?.value || '0') || 0;
        const pm = parseFloat(fullChangePmInput?.value || '0') || 0;

        const totalCambioVes = ves + pm + usd * tasa;
        const diff = requerido - totalCambioVes;
        const tolerancia = 0.05;

        if (Math.abs(diff) <= tolerancia) {
            if (fullChangeRemainingContainer) fullChangeRemainingContainer.classList.add('hidden');
            if (fullChangeRemainingVes) fullChangeRemainingVes.textContent = '0.00 Bs';
            if (fullChangeStatus) {
                fullChangeStatus.textContent = '';
                fullChangeStatus.className = 'text-sm mt-2 text-center';
            }
            if (btnFullConfirmarVuelto) btnFullConfirmarVuelto.disabled = false;
        } else {
            if (fullChangeRemainingContainer) fullChangeRemainingContainer.classList.remove('hidden');
            if (fullChangeRemainingVes) fullChangeRemainingVes.textContent = `${formatBs(diff)} Bs`;
            if (fullChangeStatus) {
                fullChangeStatus.textContent = 'Ajusta los montos de vuelto para cuadrar el total.';
                fullChangeStatus.className = 'text-sm mt-2 text-center text-red-600';
            }
            if (btnFullConfirmarVuelto) btnFullConfirmarVuelto.disabled = true;
        }
    }

    function setFullChangeTodoEnUnMetodo(destInput) {
        const tasa = getFullTasaUsd();
        const requerido = fullRequiredChangeVes || 0;

        if (fullChangeUsdInput) fullChangeUsdInput.value = '';
        if (fullChangeVesInput) fullChangeVesInput.value = '';
        if (fullChangePmInput) fullChangePmInput.value = '';

        if (!destInput) return;

        if (destInput === fullChangeUsdInput) {
            destInput.value = (requerido / tasa).toFixed(2);
        } else {
            destInput.value = requerido.toFixed(2);
        }

        updateFullChangeSummary();
    }

    async function applyClientFullPayment(netByMethodVes, tasaUsd) {
        const clienteId = fullPaymentClientId;
        if (!clienteId) {
            if (fullPaymentStatus) {
                fullPaymentStatus.textContent = 'No se encontró el cliente.';
                fullPaymentStatus.className = 'text-sm mt-3 text-center text-red-600';
            }
            return;
        }

        try {
            const respDebts = await fetch(`/api/clients/${clienteId}/debts`);
            if (!respDebts.ok) {
                const errData = await respDebts.json().catch(() => ({}));
                throw new Error(errData.error || `Error ${respDebts.status}: No se pudieron cargar las deudas para saldar.`);
            }
            const debtsData = await respDebts.json();
            const deudas = debtsData.deudas || [];

            if (!deudas.length) {
                if (fullPaymentStatus) {
                    fullPaymentStatus.textContent = 'Este cliente no tiene deudas pendientes.';
                    fullPaymentStatus.className = 'text-sm mt-3 text-center text-red-600';
                }
                return;
            }

            const remainingByMethod = { ...netByMethodVes };

            for (const deuda of deudas) {
                // Usamos exactamente la misma lógica que detalles_venta.js
                const { pendienteVes } = await getDebtPendingAmounts(deuda);
                let restanteDeudaVes = pendienteVes;
                if (restanteDeudaVes <= 0) continue;

                const methodsOrder = ['VES_EFECTIVO', 'USD_EFECTIVO', 'TARJETA', 'BIOPAGO', 'PAGOMOVIL', 'ZELLE'];

                for (const metodo of methodsOrder) {
                    let disponibleVes = remainingByMethod[metodo] || 0;
                    if (disponibleVes <= 0 || restanteDeudaVes <= 0) continue;

                    let porcionVes = Math.min(disponibleVes, restanteDeudaVes);
                    let montoOriginal = porcionVes;

                    if (metodo === 'USD_EFECTIVO') {
                        montoOriginal = porcionVes / tasaUsd;
                        montoOriginal = parseFloat(montoOriginal.toFixed(2));
                        porcionVes = montoOriginal * tasaUsd;
                    } else {
                        montoOriginal = parseFloat(montoOriginal.toFixed(2));
                        porcionVes = montoOriginal;
                    }

                    // Verificar si esta porción liquida la deuda restante (con tolerancia agresiva 1.00)
                    const isSettling = Math.abs(restanteDeudaVes - porcionVes) <= 1.0;

                    const dataPago = {
                        cliente_id: clienteId,
                        venta_id: deuda.id,
                        monto: montoOriginal,
                        metodo,
                        tasa_usd: tasaUsd,
                        force_settle: isSettling
                    };

                    const respPago = await fetch('/api/clients/payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(dataPago)
                    });
                    const resPago = await respPago.json();
                    if (!respPago.ok) {
                        throw new Error(resPago.error || `Error al pagar la venta #${deuda.id}`);
                    }

                    remainingByMethod[metodo] -= porcionVes;
                    restanteDeudaVes -= porcionVes;
                }
            }

            if (fullPaymentStatus) {
                fullPaymentStatus.textContent = '¡Deuda saldada con éxito!';
                fullPaymentStatus.className = 'text-sm mt-3 text-center text-green-600';
            }
            showToast('¡Deuda saldada con éxito!', 'success');

            setTimeout(async () => {
                closeFullPaymentModal();
                closeFullChangeModal();
                await loadClients(searchInput.value);
            }, 1000);
        } catch (error) {
            console.error('Error saldando deuda:', error);
            if (fullPaymentStatus) {
                fullPaymentStatus.textContent = error.message;
                fullPaymentStatus.className = 'text-sm mt-3 text-center text-red-600';
            }
        }
    }

    async function handleFullCompletarPago(e) {
        e.preventDefault();
        const tasa = getFullTasaUsd();
        const deuda = fullPaymentTotalDebtVes || 0;

        if (!fullPaymentClientId || deuda <= 0) {
            mostrarMensaje(fullPaymentStatus, 'No hay deuda pendiente.', 'error');
            return;
        }

        // Recalcular totales ingresados
        const ves = parseFloat(fullPagoVesInput?.value || '0') || 0;
        const usdVal = parseFloat(fullPagoUsdInput?.value || '0') || 0;
        const tarjeta = parseFloat(fullPagoTarjetaInput?.value || '0') || 0;
        const biopago = parseFloat(fullPagoBiopagoInput?.value || '0') || 0;
        const pagomovil = parseFloat(fullPagoPagoMovilInput?.value || '0') || 0;
        const zelleVal = parseFloat(fullPagoZelleInput?.value || '0') || 0;

        const totalIngresadoVes = ves + (usdVal * tasa) + tarjeta + biopago + pagomovil + (zelleVal * tasa);
        const diff = totalIngresadoVes - deuda;
        const tolerancia = 0.05;

        // CASO 1: ABONO PARCIAL (Pago MENOR a la deuda)
        if (diff < -tolerancia) {
            // Confirmar si el usuario quiere hacer un abono parcial
            const confirm = await showGlobalConfirm(
                `El monto ingresado (${formatBs(totalIngresadoVes)} Bs) es menor a la deuda total.\n¿Deseas registrarlo como un ABONO a la cuenta?`,
                'Confirmar Abono Parcial'
            );

            if (confirm) {
                await handleBulkAbono(ves, usdVal, tarjeta, biopago, pagomovil, tasa, zelleVal);
            }
            return;
        }

        // CASO 2: PAGO COMPLETO (Quizás con vuelto)
        // Si hay vuelto pendiente, abrir modal de vuelto
        if (diff > tolerancia) {
            openFullChangeModal();
            return;
        }

        // CASO 3: PAGO EXACTO
        await applyClientFullPayment({
            VES_EFECTIVO: ves,
            USD_EFECTIVO: usdVal * tasa,
            TARJETA: tarjeta,
            BIOPAGO: biopago,
            PAGOMOVIL: pagomovil,
            ZELLE: zelleVal * tasa
        }, tasa);
    }

    async function handleBulkAbono(ves, usd, tarjeta, biopago, pagomovil, tasa, zelle = 0) {
        const clienteId = fullPaymentClientId;
        mostrarMensaje(fullPaymentStatus, 'Procesando abono...', 'info');

        try {
            // Enviar cada método con monto > 0
            const metodos = [
                { key: 'VES_EFECTIVO', monto: ves },
                { key: 'USD_EFECTIVO', monto: usd }, // OJO: aquí el monto es en USD directo si es efectivo
                { key: 'TARJETA', monto: tarjeta },
                { key: 'BIOPAGO', monto: biopago },
                { key: 'PAGOMOVIL', monto: pagomovil },
                { key: 'ZELLE', monto: zelle }
            ];

            let processedCount = 0;

            for (const m of metodos) {
                if (m.monto > 0) {
                    const payload = {
                        cliente_id: clienteId,
                        monto: m.monto,
                        metodo: m.key,
                        tasa_usd: tasa
                    };

                    const resp = await fetch('/api/clients/payment/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (!resp.ok) {
                        const errData = await resp.json();
                        throw new Error(errData.error || 'Error en abono masivo');
                    }
                    processedCount++;
                }
            }

            mostrarMensaje(fullPaymentStatus, '¡Abono registrado correctamente!', 'success');
            showToast('Abono registrado a la cuenta.', 'success');

            setTimeout(async () => {
                closeFullPaymentModal();
                await loadClients(searchInput.value);
            }, 1000);

        } catch (error) {
            console.error('Error Bulk Abono:', error);
            mostrarMensaje(fullPaymentStatus, error.message, 'error');
        }
    }

    async function handleFullConfirmarVuelto() {
        const tasa = getFullTasaUsd();
        const requerido = fullRequiredChangeVes || 0;
        const tolerancia = 0.05;

        const usd = parseFloat(fullChangeUsdInput?.value || '0') || 0;
        const ves = parseFloat(fullChangeVesInput?.value || '0') || 0;
        const pm = parseFloat(fullChangePmInput?.value || '0') || 0;

        const totalCambioVes = ves + pm + usd * tasa;
        const diff = requerido - totalCambioVes;

        if (Math.abs(diff) > tolerancia) {
            if (fullChangeStatus) {
                fullChangeStatus.textContent = 'El vuelto no cuadra con lo requerido.';
                fullChangeStatus.className = 'text-sm mt-2 text-center text-red-600';
            }
            return;
        }

        const netByMethodVes = {
            VES_EFECTIVO: fullPaidByMethodVes.VES_EFECTIVO - ves,
            USD_EFECTIVO: fullPaidByMethodVes.USD_EFECTIVO - usd * tasa,
            TARJETA: fullPaidByMethodVes.TARJETA,
            PAGOMOVIL: fullPaidByMethodVes.PAGOMOVIL - pm
        };

        await applyClientFullPayment(netByMethodVes, tasa);
    }

    // ===================== EVENTOS =====================

    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadClients(searchInput.value);
        }, 300);
    });

    btnAddClient.addEventListener('click', () => openClientModal());
    btnCancelClient.addEventListener('click', closeClientModal);
    clientForm.addEventListener('submit', handleClientSubmit);

    clientListContainer.addEventListener('click', handleClientListClick);

    paymentMethodSelect.addEventListener('change', handlePaymentMethodChange);
    paymentAmountInput.addEventListener('input', actualizarEstadoBotonPago);
    paymentUsdRateInput.addEventListener('input', actualizarEstadoBotonPago);

    paymentForm.addEventListener('submit', handlePaymentSubmit);
    btnClosePaymentModal.addEventListener('click', closePaymentModal);
    btnCancelPayment.addEventListener('click', closePaymentModal);

    // Eventos SALDAR DEUDA multi-método
    if (fullPagoVesInput) fullPagoVesInput.addEventListener('input', handleFullPagoInputChange);
    if (fullPagoUsdInput) fullPagoUsdInput.addEventListener('input', handleFullPagoInputChange);
    if (fullPagoTarjetaInput) fullPagoTarjetaInput.addEventListener('input', handleFullPagoInputChange);
    if (fullPagoBiopagoInput) fullPagoBiopagoInput.addEventListener('input', handleFullPagoInputChange);
    if (fullPagoPagoMovilInput) fullPagoPagoMovilInput.addEventListener('input', handleFullPagoInputChange);
    if (fullPagoZelleInput) fullPagoZelleInput.addEventListener('input', handleFullPagoInputChange);
    if (fullPaymentUsdRateInput) fullPaymentUsdRateInput.addEventListener('input', handleFullPagoInputChange);

    // Nuevos eventos de tipo de tasa
    paymentModal.querySelectorAll('input[name="payment-rate-type"]').forEach(radio => {
        radio.addEventListener('change', handlePaymentRateTypeChange);
    });
    fullPaymentModal.querySelectorAll('input[name="full-rate-type"]').forEach(radio => {
        radio.addEventListener('change', handleFullRateTypeChange);
    });

    if (fullBtnPagoTodoVes) fullBtnPagoTodoVes.addEventListener('click', () => setFullPagoTodoEnBs(fullPagoVesInput));
    if (fullBtnPagoTodoUsd) fullBtnPagoTodoUsd.addEventListener('click', () => setFullPagoTodoEnBs(fullPagoUsdInput));
    if (fullBtnPagoTodoTarjeta) fullBtnPagoTodoTarjeta.addEventListener('click', () => setFullPagoTodoEnBs(fullPagoTarjetaInput));
    if (fullBtnPagoTodoBiopago) fullBtnPagoTodoBiopago.addEventListener('click', () => setFullPagoTodoEnBs(fullPagoBiopagoInput));
    if (fullBtnPagoTodoPagoMovil) fullBtnPagoTodoPagoMovil.addEventListener('click', () => setFullPagoTodoEnBs(fullPagoPagoMovilInput));
    if (fullBtnPagoTodoZelle) fullBtnPagoTodoZelle.addEventListener('click', () => setFullPagoTodoEnBs(fullPagoZelleInput));

    if (btnFullCompletarPago) btnFullCompletarPago.addEventListener('click', handleFullCompletarPago);
    if (btnFullCancelarPago) btnFullCancelarPago.addEventListener('click', closeFullPaymentModal);

    if (fullChangeUsdInput) fullChangeUsdInput.addEventListener('input', updateFullChangeSummary);
    if (fullChangeVesInput) fullChangeVesInput.addEventListener('input', updateFullChangeSummary);
    if (fullChangePmInput) fullChangePmInput.addEventListener('input', updateFullChangeSummary);

    if (fullBtnChangeTodoUsd) fullBtnChangeTodoUsd.addEventListener('click', () => setFullChangeTodoEnUnMetodo(fullChangeUsdInput));
    if (fullBtnChangeTodoVes) fullBtnChangeTodoVes.addEventListener('click', () => setFullChangeTodoEnUnMetodo(fullChangeVesInput));
    if (fullBtnChangeTodoPm) fullBtnChangeTodoPm.addEventListener('click', () => setFullChangeTodoEnUnMetodo(fullChangePmInput));

    if (btnFullConfirmarVuelto) btnFullConfirmarVuelto.addEventListener('click', handleFullConfirmarVuelto);
    if (btnFullCancelarVuelto) btnFullCancelarVuelto.addEventListener('click', closeFullChangeModal);

    // Inicialización
    loadBcvRate();
    loadClients();
});
