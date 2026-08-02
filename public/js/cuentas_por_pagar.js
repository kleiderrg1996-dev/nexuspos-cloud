document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const debtTableBody = document.getElementById('debt-table-body');
    const noResults = document.getElementById('no-results');
    const debtSearch = document.getElementById('debt-search');
    const btnRefresh = document.getElementById('btn-refresh');
    
    // KPI
    const totalDebtVes = document.getElementById('total-debt-ves');
    const totalDebtUsd = document.getElementById('total-debt-usd');
    const debtPurchasesVes = document.getElementById('debt-purchases-ves');
    const debtExpensesVes = document.getElementById('debt-expenses-ves');
    const creditorCount = document.getElementById('creditor-count');

    // Modals
    const modalAbono = document.getElementById('modal-abono');
    const abonoMonto = document.getElementById('abono-monto');
    const abonoMetodo = document.getElementById('abono-metodo');
    const wrapperReferencia = document.getElementById('wrapper-referencia');
    const abonoReferencia = document.getElementById('abono-referencia');
    const abonoEntity = document.getElementById('abono-entity');
    const abonoRef = document.getElementById('abono-ref');
    const abonoMax = document.getElementById('abono-max');
    const btnConfirmAbono = document.getElementById('confirm-abono');
    const btnCancelAbono = document.getElementById('cancel-abono');
    const wrapperTasa = document.getElementById('wrapper-tasa');
    const abonoTasa = document.getElementById('abono-tasa');

    // Filter Buttons
    const filterBtns = document.querySelectorAll('.filter-type-btn');

    // --- State ---
    let allDebts = [];
    let currentFilterType = 'ALL';
    let currentBcvRate = 1;
    let activeDebtForAbono = null;

    // --- Initialization ---
    async function init() {
        await fetchBcvRate();
        await loadDebts();
    }

    async function fetchBcvRate() {
        try {
            const resp = await fetch('/api/settings');
            const settings = await resp.json();
            const bcv = settings.find(s => s.key === 'BCV');
            if (bcv) currentBcvRate = parseFloat(bcv.value) || 1;
        } catch (error) {
            console.error('Error fetching BCV:', error);
        }
    }

    async function loadDebts() {
        try {
            const resp = await fetch('/api/expenses/cuentas-por-pagar');
            const json = await resp.json();
            allDebts = json.data || [];
            renderDebts();
            updateSummary();
        } catch (error) {
            console.error('Error loading debts:', error);
            showToast('Error al conectar con el servidor', 'error');
        }
    }

    function renderDebts() {
        debtTableBody.innerHTML = '';
        
        const filtered = allDebts.filter(d => {
            const typeMatch = currentFilterType === 'ALL' || d.tipo === currentFilterType;
            const search = debtSearch.value.toLowerCase();
            const searchMatch = !search || 
                (d.proveedor || '').toLowerCase().includes(search) || 
                (d.referencia || '').toLowerCase().includes(search);
            return typeMatch && searchMatch;
        });

        if (filtered.length === 0) {
            noResults.classList.remove('hidden');
            return;
        }
        noResults.classList.add('hidden');

        filtered.forEach(debt => {
            const isPurchase = debt.tipo === 'COMPRA';
            const icon = isPurchase ? 'fa-truck-field' : 'fa-building-columns';
            const typeLabel = isPurchase ? 'Mercancía' : 'Operativo';
            const typeClass = isPurchase ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-red-500/10 text-red-500 border-red-500/20';

            const moneda = debt.moneda || 'VES';
            const rate = debt.tasa_bcv || currentBcvRate || 1;
            
            let montoOriginalDisplay = '';
            if (moneda === 'USD') {
                const montoUsd = (debt.monto_usd > 0) ? debt.monto_usd : debt.total_compra;
                montoOriginalDisplay = `${Number(montoUsd).toLocaleString('en-US', {minimumFractionDigits:2})} $`;
            } else {
                montoOriginalDisplay = `${Number(debt.total_compra).toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
            }

            // Lógica de Saldo Pendiente
            let mainBalance = '';
            let subBalance = '';
            const pendienteVes = Number(debt.monto_pendiente_ves);
            
            if (moneda === 'USD') {
                const pendienteUsd = debt.monto_pendiente_usd || (pendienteVes / rate);
                mainBalance = `${Number(pendienteUsd).toLocaleString('en-US', {minimumFractionDigits:2})} $`;
                subBalance = `(${pendienteVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs)`;
            } else {
                const pendienteUsd = pendienteVes / rate;
                mainBalance = `${pendienteVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
                subBalance = `(${Number(pendienteUsd).toLocaleString('en-US', {minimumFractionDigits:2})} USD)`;
            }
            
            const row = document.createElement('tr');
            row.className = "debt-row transition-all border-b border-gray-50 dark:border-white/5 group";
            row.innerHTML = `
                <td class="pl-14 pr-8 py-6">
                    <span class="px-3 py-1.5 rounded-xl text-[9px] font-black border uppercase tracking-widest ${typeClass}">
                        <i class="fa-solid ${icon} mr-1"></i> ${typeLabel}
                    </span>
                </td>
                <td class="px-8 py-6 text-xs text-gray-500 uppercase tracking-tighter">
                    ${debt.fecha ? debt.fecha.split('T')[0].split('-').reverse().join('/') : ''}
                </td>
                <td class="px-8 py-6">
                    <div class="flex flex-col">
                        <span class="text-sm font-black text-slate-800 dark:text-slate-100 uppercase truncate max-w-[250px]" title="${debt.proveedor}">
                            ${debt.proveedor || 'Sin Nombre'}
                        </span>
                    </div>
                </td>
                <td class="px-8 py-6">
                    <span class="text-xs font-bold text-slate-400 font-mono tracking-tight group-hover:text-amber-500 transition-colors">
                        #${debt.referencia || 'N/A'}
                    </span>
                </td>
                <td class="px-8 py-6">
                    <span class="text-xs font-bold text-slate-500">
                        ${montoOriginalDisplay}
                    </span>
                </td>
                <td class="px-8 py-6">
                    <div class="flex flex-col">
                        <span class="text-base font-black text-orange-600 dark:text-orange-400">
                            ${mainBalance}
                        </span>
                        <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest opacity-70">
                            ${subBalance}
                        </span>
                    </div>
                </td>
                <td class="pl-8 pr-14 py-6 text-right">
                    <button onclick="openAbonoModal(${debt.id}, '${debt.tipo}')" class="inline-flex items-center gap-2 px-5 py-2.5 text-white rounded-xl hover:scale-105 active:scale-95 transition-all text-xs font-bold shadow-lg shadow-orange-500/25" style="background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);">
                        <i class="fas fa-coins text-[11px]"></i> Liquidación
                    </button>
                </td>
            `;
            debtTableBody.appendChild(row);
        });
    }

    function updateSummary() {
        const total = allDebts.reduce((sum, d) => sum + Number(d.monto_pendiente_ves), 0);
        
        // Calcular total en USD usando el saldo pendiente en USD
        const totalUsd = allDebts.reduce((sum, d) => {
            if (d.monto_pendiente_usd > 0) return sum + Number(d.monto_pendiente_usd);
            if (d.moneda === 'USD' && d.monto_usd) return sum + Number(d.monto_usd);
            return sum + (Number(d.monto_pendiente_ves) / (d.tasa_bcv || currentBcvRate));
        }, 0);

        const purch = allDebts.filter(d => d.tipo === 'COMPRA').reduce((sum, d) => sum + Number(d.monto_pendiente_ves), 0);
        const expen = allDebts.filter(d => d.tipo === 'GASTO').reduce((sum, d) => sum + Number(d.monto_pendiente_ves), 0);
        
        totalDebtVes.textContent = `${total.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        totalDebtUsd.textContent = `${totalUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;
        
        debtPurchasesVes.textContent = `${purch.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        debtExpensesVes.textContent = `${expen.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        
        creditorCount.textContent = allDebts.length;
    }

    // --- Actions ---

    abonoMetodo.onchange = () => {
        const val = abonoMetodo.value;
        if (['PAGO_MOVIL', 'TRANSFERENCIA', 'PUNTO_DE_VENTA', 'BIOPAGO'].includes(val)) {
            wrapperReferencia.classList.remove('hidden');
        } else {
            wrapperReferencia.classList.add('hidden');
            abonoReferencia.value = '';
        }

        if (val === 'DOLARES') {
            wrapperTasa.classList.add('hidden');
        } else {
            wrapperTasa.classList.remove('hidden');
            if (!abonoTasa.value) abonoTasa.value = currentBcvRate || '';
        }

        if (!activeDebtForAbono) return;
        const rate = parseFloat(abonoTasa.value) || activeDebtForAbono.tasa_bcv || currentBcvRate || 1;
        const pendVes = Number(activeDebtForAbono.monto_pendiente_ves) || 0;
        const pendUsd = activeDebtForAbono.monto_pendiente_usd || (pendVes / rate);
        const labelMonto = document.getElementById('label-monto-abono');
        const abonoMaxEl = document.getElementById('abono-max');

        if (val === 'DOLARES') {
            abonoMonto.value = pendUsd.toFixed(2);
            if (labelMonto) labelMonto.textContent = 'Importe a Pagar (USD)';
            if (abonoMaxEl) abonoMaxEl.textContent = `${pendUsd.toLocaleString('en-US', {minimumFractionDigits: 2})} $`;
        } else {
            abonoMonto.value = pendVes.toFixed(2);
            if (labelMonto) labelMonto.textContent = 'Importe a Pagar (VES)';
            if (abonoMaxEl) abonoMaxEl.textContent = `${pendVes.toLocaleString('es-VE', {minimumFractionDigits: 2})} Bs`;
        }
    };

    window.openAbonoModal = (id, tipo) => {
        const debt = allDebts.find(d => d.id === id && d.tipo === tipo);
        if (!debt) return;
        activeDebtForAbono = debt;
        
        abonoEntity.textContent = debt.proveedor;
        abonoRef.textContent = debt.referencia || 'N/A';
        
        const rate = debt.tasa_bcv || currentBcvRate || 1;
        
        // Reset campos adicionales
        abonoMetodo.value = 'EFECTIVO_VES';
        wrapperReferencia.classList.add('hidden');
        abonoReferencia.value = '';
        wrapperTasa.classList.remove('hidden');
        abonoTasa.value = currentBcvRate || '';

        const pendVes = Number(debt.monto_pendiente_ves) || 0;
        const pendUsd = debt.monto_pendiente_usd || (pendVes / rate);

        const labelMonto = document.getElementById('label-monto-abono');
        if (labelMonto) labelMonto.textContent = 'Importe a Pagar (VES)';
        
        abonoMax.textContent = `${pendVes.toLocaleString('es-VE', {minimumFractionDigits: 2})} Bs`;
        abonoMonto.value = pendVes.toFixed(2);
        
        modalAbono.style.display = '';
        modalAbono.classList.remove('hidden');
        setTimeout(() => abonoMonto.focus(), 100);
    };

    btnConfirmAbono.onclick = async () => {
        const monto = parseFloat(abonoMonto.value);
        if (!monto || monto <= 0 || !activeDebtForAbono) {
            showToast('Ingrese un monto valido', 'warning');
            return;
        }

        const metodo = abonoMetodo.value;
        const referencia = abonoReferencia.value.trim();

        if (['PAGO_MOVIL', 'TRANSFERENCIA', 'PUNTO_DE_VENTA', 'BIOPAGO'].includes(metodo) && !referencia) {
            showToast('El codigo de referencia es obligatorio para este metodo', 'warning');
            abonoReferencia.focus();
            return;
        }

        const monedaAbono = (metodo === 'DOLARES') ? 'USD' : 'VES';

        const payload = {
            amount: monto,
            currency: monedaAbono,
            method: metodo,
            referencia: referencia || null,
            usuario_id: null,
            tasa_bcv: parseFloat(abonoTasa.value) || currentBcvRate || 1
        };

        if (activeDebtForAbono.tipo === 'COMPRA') {
            payload.purchase_id = activeDebtForAbono.id;
        } else {
            payload.expense_id = activeDebtForAbono.id;
        }

        btnConfirmAbono.disabled = true;
        btnConfirmAbono.textContent = 'PROCESANDO...';

        try {
            const resp = await fetch('/api/expenses/abonos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            let data;
            try {
                data = await resp.json();
            } catch (parseErr) {
                data = { error: 'Respuesta invalida del servidor' };
            }

            modalAbono.classList.add('hidden');
            modalAbono.style.display = 'none';

            if (resp.ok && data.success) {
                activeDebtForAbono = null;
                loadDebts().then(() => {
                    showToast('Pago registrado exitosamente', 'success');
                });
            } else {
                showToast(data.error || 'No se pudo registrar el pago', 'warning');
            }
        } catch (error) {
            console.error('Error payment:', error);
            modalAbono.classList.add('hidden');
            modalAbono.style.display = 'none';
            showToast('Error de conexion: ' + error.message, 'error');
        } finally {
            btnConfirmAbono.disabled = false;
            btnConfirmAbono.textContent = 'ABONAR PAGO';
        }
    };

    // --- Helpers & Listeners ---

    btnCancelAbono.onclick = () => {
        modalAbono.style.display = 'none';
        modalAbono.classList.add('hidden');
    };

    btnRefresh.onclick = loadDebts;
    debtSearch.oninput = renderDebts;

    filterBtns.forEach(btn => {
        btn.onclick = () => {
            filterBtns.forEach(b => b.classList.remove('active', 'bg-orange-500', 'text-white'));
            filterBtns.forEach(b => b.classList.add('bg-slate-100', 'dark:bg-slate-900', 'text-slate-500'));
            
            btn.classList.add('active', 'bg-orange-500', 'text-white');
            btn.classList.remove('bg-slate-100', 'dark:bg-slate-900', 'text-slate-500');
            
            currentFilterType = btn.dataset.type;
            renderDebts();
        };
    });

    function showToast(msg, type = 'info') {
        if (window.Toast) {
            window.Toast.fire({
                icon: type,
                title: msg
            });
        } else {
            Swal.fire({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true,
                icon: type,
                title: msg
            });
        }
    }

    init();
});
