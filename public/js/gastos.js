document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const expensesTableBody = document.getElementById('expenses-table-body');
    const noResults = document.getElementById('no-results');
    const btnAddExpense = document.getElementById('btn-add-expense');
    const btnRefresh = document.getElementById('btn-refresh');
    const btnManageCategories = document.getElementById('btn-manage-categories');
    
    // Modals
    const modalExpense = document.getElementById('modal-expense');
    const modalCategories = document.getElementById('modal-categories');
    const modalAbono = document.getElementById('modal-abono');
    const expenseForm = document.getElementById('expense-form');
    
    // Filters
    const searchInput = document.getElementById('search-input');
    const filterStartDate = document.getElementById('filter-start-date');
    const filterEndDate = document.getElementById('filter-end-date');
    const filterCategory = document.getElementById('filter-category');
    
    // KPI
    const summaryTotalVes = document.getElementById('summary-total-ves');
    const summaryTotalUsd = document.getElementById('summary-total-usd');
    const summaryPendingVes = document.getElementById('summary-pending-ves');
    const summaryPendingUsd = document.getElementById('summary-pending-usd');
    const summaryCount = document.getElementById('summary-count');

    // Category elements
    const categoryList = document.getElementById('category-list');
    const newCategoryName = document.getElementById('new-category-name');
    const btnSaveCategory = document.getElementById('btn-save-category');
    
    // Abono elements
    const abonoMonto = document.getElementById('abono-monto');
    const abonoInfo = document.getElementById('abono-info');
    const btnConfirmAbono = document.getElementById('confirm-abono');
    const btnCancelAbono = document.getElementById('cancel-abono');

    // --- State ---
    let expenses = [];
    let categories = [];
    let currentBcvRate = 1;
    let currentParaleloRate = 1;
    let activeExpenseForAbono = null;

    // --- Currency Toggle ---
    window.setMoneda = (moneda) => {
        document.getElementById('expense-moneda').value = moneda;
        const btnVes = document.getElementById('moneda-ves');
        const btnUsd = document.getElementById('moneda-usd');
        
        if (moneda === 'VES') {
            btnVes.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnVes.classList.remove('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
            btnUsd.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnUsd.classList.add('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
        } else {
            btnUsd.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnUsd.classList.remove('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
            btnVes.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnVes.classList.add('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
        }
    };

    // --- Initialization ---
    async function init() {
        // Set default dates (current month)
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('sv-SE');
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toLocaleDateString('sv-SE');
        filterStartDate.value = firstDay;
        filterEndDate.value = lastDay;
        document.getElementById('expense-fecha').value = new Date().toLocaleDateString('sv-SE');

        await fetchBcvRate();
        await loadCategories();
        await loadExpenses();
    }

    async function fetchBcvRate() {
        try {
            const resp = await fetch('/api/settings');
            const settings = await resp.json();
            const bcv = settings.find(s => s.key === 'BCV');
            if (bcv) currentBcvRate = parseFloat(bcv.value) || 1;
            const paralelo = settings.find(s => s.key === 'PARALELO');
            if (paralelo) currentParaleloRate = parseFloat(paralelo.value) || 1;
        } catch (error) {
            console.error('Error fetching BCV:', error);
        }
    }

    window.setTasaTipo = (tipo) => {
        document.getElementById('expense-tasa-tipo').value = tipo;
        const btnBcv = document.getElementById('tasa-bcv-btn');
        const btnParalelo = document.getElementById('tasa-paralelo-btn');
        const tasaInput = document.getElementById('expense-tasa');

        if (tipo === 'BCV') {
            btnBcv.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnBcv.classList.remove('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
            btnParalelo.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnParalelo.classList.add('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
            tasaInput.value = currentBcvRate || '';
        } else {
            btnParalelo.classList.add('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnParalelo.classList.remove('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
            btnBcv.classList.remove('bg-blue-600', 'text-white', 'shadow-lg', 'shadow-blue-500/20');
            btnBcv.classList.add('text-gray-400', 'hover:text-gray-600', 'dark:hover:text-white');
            tasaInput.value = currentParaleloRate || '';
        }
    };

    async function loadCategories() {
        try {
            const resp = await fetch('/api/expenses/categories');
            const json = await resp.json();
            categories = json.data || [];
            
            // Fill filter
            filterCategory.innerHTML = '<option value="">TODAS LAS CATEGORÍAS</option>';
            filterCategory.insertAdjacentHTML('beforeend', '<option value="RETIRO">RETIROS DE CAJA</option>');
            
            const formCategory = document.getElementById('expense-category');
            formCategory.innerHTML = '<option value="" disabled selected>Seleccionar...</option>';
            
            categories.forEach(cat => {
                const opt = `<option value="${cat.id}">${cat.nombre.toUpperCase()}</option>`;
                filterCategory.insertAdjacentHTML('beforeend', opt);
                formCategory.insertAdjacentHTML('beforeend', opt);
            });
            
            renderCategoryList();
        } catch (error) {
            console.error('Error loading categories:', error);
        }
    }

    function renderCategoryList() {
        categoryList.innerHTML = '';
        categories.forEach(cat => {
            const li = document.createElement('li');
            li.className = "flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-white/5 group";
            li.innerHTML = `
                <span class="font-bold text-sm uppercase tracking-tight text-slate-700 dark:text-slate-300">${cat.nombre}</span>
                <button onclick="deleteCategory(${cat.id})" class="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            `;
            categoryList.appendChild(li);
        });
    }

    async function loadExpenses() {
        const start = filterStartDate.value;
        const end = filterEndDate.value;
        const catId = filterCategory.value;
        const search = searchInput.value;

        try {
            const params = new URLSearchParams({ startDate: start, endDate: end });
            if (catId) params.append('categoryId', catId);
            if (search) params.append('search', search);

            // Añadir cache-buster para forzar actualización real
            const resp = await fetch(`/api/expenses?${params.toString()}&_t=${Date.now()}`);
            const json = await resp.json();
            
            expenses = []; // Limpiar estado actual
            expenses = json.data || [];
            
            renderExpenses();
            updateSummary();
        } catch (error) {
            console.error('Error loading expenses:', error);
            showToast('Error al cargar gastos', 'error');
        }
    }

    function renderExpenses() {
        expensesTableBody.innerHTML = '';
        
        if (expenses.length === 0) {
            noResults.classList.remove('hidden');
            return;
        }
        noResults.classList.add('hidden');

        expenses.forEach((exp, index) => {
            const dateStr = (exp.fecha || '').split('T')[0];
            const dateParts = dateStr.split('-');
            const dateFormatted = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : dateStr;

            const isPaid = exp.estado_pago === 'PAGADO' || exp.estado_pago === 'ABONADO';
            const statusClass = exp.estado_pago === 'PAGADO' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 
                               (exp.estado_pago === 'ABONADO' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : 'bg-orange-500/10 text-orange-500 border-orange-500/20');
            
            const isRetiro = exp.fuente === 'RETIRO';
            const moneda = exp.moneda || 'VES';
            const montoVes = Number(exp.monto_ves) || 0;
            const montoUsd = Number(exp.monto_usd) || 0;
            const tasa = Number(exp.tasa_bcv) || currentBcvRate;
            
            // Lógica de visualización dual
            let mainAmount = '';
            let subAmount = '';
            if (moneda === 'USD') {
                mainAmount = `${montoUsd.toLocaleString('en-US', {minimumFractionDigits:2})} $`;
                subAmount = `${montoVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
            } else {
                mainAmount = `${montoVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
                subAmount = `${montoUsd.toLocaleString('en-US', {minimumFractionDigits:2})} $`;
            }

            const pendVes = Number(exp.monto_pendiente_ves) || 0;
            const pendUsd = pendVes / tasa;

            const row = document.createElement('tr');
            row.className = "expense-row transition-all border-b border-gray-50 dark:border-white/5 group";
            row.style.animationDelay = `${index * 50}ms`;
            
            row.innerHTML = `
                <td class="pl-16 pr-6 py-6">
                    <div class="flex flex-col">
                        <span class="date-badge text-sm text-slate-900 dark:text-white bg-slate-100 dark:bg-slate-700/50 px-4 py-2 border border-slate-200 dark:border-white/10 shadow-sm w-fit text-center min-w-[100px]" style="border-radius: 15px;">
                            ${dateFormatted}
                        </span>
                    </div>
                </td>
                <td class="px-6 py-6 text-center">
                    <span class="px-5 py-2 ${isRetiro ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'} text-[10px] font-black uppercase border tracking-widest shadow-sm whitespace-nowrap" style="border-radius: 15px;">
                        <i class="fa-solid ${isRetiro ? 'fa-cash-register' : 'fa-tag'} mr-2"></i>
                        ${exp.categoria_nombre || 'S/C'}
                    </span>
                </td>
                <td class="px-8 py-6">
                    <div class="flex flex-col">
                        <span class="text-sm font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">${exp.concepto}</span>
                        ${exp.notas ? `<span class="text-[10px] font-bold text-slate-400 italic mt-1 leading-none uppercase opacity-80">${exp.notas}</span>` : ''}
                    </div>
                </td>
                <td class="px-8 py-6">
                    <div class="flex flex-col">
                        <span class="text-base font-black text-slate-900 dark:text-white">${mainAmount}</span>
                        <span class="text-[10px] font-bold text-slate-400 opacity-60">${subAmount}</span>
                        ${pendVes > 0 ? `<span class="text-[10px] font-black text-orange-500 mt-1 uppercase bg-orange-500/5 px-2 py-0.5 w-fit" style="border-radius: 8px;">Deuda: ${pendVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs</span>` : ''}
                    </div>
                </td>
                <td class="px-8 py-6 text-center">
                    <span class="px-5 py-2 text-[10px] font-black border uppercase tracking-[0.1em] shadow-inner ${statusClass}" style="border-radius: 15px;">
                        ${exp.estado_pago}
                    </span>
                </td>
                <td class="pl-6 pr-16 py-6 text-right">
                    <div class="flex items-center justify-end gap-3 opacity-60 group-hover:opacity-100 transition-opacity">
                        ${pendVes > 0 && !isRetiro ? `
                            <button onclick="openAbonoModal(${exp.id})" class="p-3 bg-blue-500/10 text-blue-500 rounded-full hover:bg-blue-600 hover:text-white transition-all shadow-sm" title="Abonar Pago" style="border-radius: 50%;">
                                <i class="fa-solid fa-coins text-sm"></i>
                            </button>
                        ` : ''}
                        ${!isRetiro ? `
                            <button onclick="editExpense(${exp.id})" class="p-4 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all shadow-sm" style="border-radius: 15px;">
                                <i class="fa-solid fa-pen-to-square text-sm"></i>
                            </button>
                            <button onclick="deleteExpense(${exp.id})" class="p-4 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm" style="border-radius: 15px;">
                                <i class="fa-solid fa-trash text-sm"></i>
                            </button>
                        ` : `
                            <div class="flex items-center gap-2 px-5 py-2 bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-white/10 shadow-inner" style="border-radius: 15px;">
                                <i class="fa-solid fa-lock text-[10px] text-slate-400"></i>
                                <span class="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase italic tracking-tighter">Movimiento de Caja</span>
                            </div>
                        `}
                    </div>
                </td>
            `;
            expensesTableBody.appendChild(row);
        });
    }

    function updateSummary() {
        const pagados = expenses.filter(e => e.estado_pago === 'PAGADO');
        const pendientes = expenses.filter(e => e.estado_pago === 'PENDIENTE' || e.estado_pago === 'ABONADO');

        const totalVes = pagados.reduce((sum, e) => sum + (Number(e.monto_ves) || 0), 0);
        const totalUsd = pagados.reduce((sum, e) => sum + (Number(e.monto_usd) || 0), 0);
        const pendingVes = pendientes.reduce((sum, e) => sum + (Number(e.monto_pendiente_ves) || 0), 0);
        const pendingUsd = pendientes.reduce((sum, e) => {
            const tasa = Number(e.tasa_bcv) || currentBcvRate;
            return sum + ((Number(e.monto_pendiente_ves) || 0) / tasa);
        }, 0);
        
        summaryTotalVes.textContent = `${totalVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        summaryTotalUsd.textContent = `${totalUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;
        
        summaryPendingVes.textContent = `${pendingVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        summaryPendingUsd.textContent = `${pendingUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;
        
        summaryCount.textContent = expenses.length;
    }

    // --- Actions ---

    expenseForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btnSubmit = e.submitter || expenseForm.querySelector('button[type="submit"]');
        const originalBtnText = btnSubmit.innerHTML;

        const id = document.getElementById('expense-id').value;
        const concepto = document.getElementById('expense-concepto').value.trim();
        const montoRaw = document.getElementById('expense-monto').value;
        const moneda = document.getElementById('expense-moneda').value;
        const categoria_id = document.getElementById('expense-category').value;
        const fecha = document.getElementById('expense-fecha').value;
        const estado = document.getElementById('expense-estado').value;
        const notas = document.getElementById('expense-notas').value.trim();
        const tasaBcv = parseFloat(document.getElementById('expense-tasa').value) || currentBcvRate;
        const tasaTipo = document.getElementById('expense-tasa-tipo').value || 'BCV';

        // Validaciones Manuales de Seguridad
        if (!concepto) return showToast('El concepto es obligatorio', 'warning');
        if (!montoRaw || parseFloat(montoRaw) <= 0) return showToast('Monto inválido', 'warning');
        if (!categoria_id) return showToast('Selecciona una categoría', 'warning');
        if (!fecha) return showToast('La fecha es obligatoria', 'warning');

        const data = {
            concepto,
            monto: parseFloat(montoRaw),
            moneda,
            categoria_id: parseInt(categoria_id),
            fecha,
            estado,
            notas,
            tasa_bcv: tasaBcv,
            tasa_tipo: tasaTipo
        };

        try {
            // Bloquear botón para evitar duplicados
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Guardando...';

            const method = id ? 'PUT' : 'POST';
            const url = id ? `/api/expenses/${id}` : '/api/expenses';
            
            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (resp.ok) {
                showToast(id ? 'Registro actualizado' : '¡Gasto guardado!', 'success');
                closeAllModals();
                await loadExpenses(); // Forzar espera de carga
            } else {
                const err = await resp.json().catch(() => ({ error: 'Error desconocido' }));
                throw new Error(err.error || 'No se pudo guardar');
            }
        } catch (error) {
            console.error('Error saving expense:', error);
            Swal.fire({
                icon: 'error',
                title: 'No se pudo procesar',
                text: error.message,
                background: document.body.classList.contains('dark-mode') ? '#1e293b' : '#fff',
                color: document.body.classList.contains('dark-mode') ? '#fff' : '#000'
            });
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalBtnText;
        }
    });

    window.deleteExpense = async (id) => {
        const result = await Swal.fire({
            title: '¿Eliminar registro?',
            text: "Esta acción no se puede deshacer.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#64748b',
            confirmButtonText: 'SÍ, ELIMINAR',
            cancelButtonText: 'CANCELAR',
            background: document.body.classList.contains('dark-mode') ? '#1e293b' : '#fff',
            color: document.body.classList.contains('dark-mode') ? '#fff' : '#000'
        });

        if (result.isConfirmed) {
            try {
                // Notificar al usuario que el proceso comenzó
                showToast('Eliminando...', 'info');

                const resp = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
                if (resp.ok) {
                    showToast('Registro eliminado con éxito', 'success');
                    await loadExpenses(); // Sincronizar recarga
                } else {
                    const err = await resp.json();
                    throw new Error(err.error || 'Error al eliminar');
                }
            } catch (error) {
                console.error('Error deleting:', error);
                Swal.fire({ icon: 'error', title: 'Error', text: error.message });
            }
        }
    };

    window.editExpense = (id) => {
        const exp = expenses.find(e => e.id === id);
        if (!exp) return;

        const moneda = exp.moneda || 'VES';

        document.getElementById('expense-id').value = exp.id;
        document.getElementById('expense-concepto').value = exp.concepto;
        
        // Al editar, mostramos el monto original dependiendo de la moneda guardada
        document.getElementById('expense-monto').value = (moneda === 'USD') ? exp.monto_usd : exp.monto_ves;
        setMoneda(moneda);

        document.getElementById('expense-category').value = exp.categoria_id;
        document.getElementById('expense-fecha').value = exp.fecha;
        document.getElementById('expense-estado').value = exp.estado_pago;
        document.getElementById('expense-notas').value = exp.notas || '';
        document.getElementById('expense-tasa').value = exp.tasa_bcv || currentBcvRate;
        setTasaTipo(exp.tasa_tipo || 'BCV');

        document.getElementById('modal-title').textContent = 'Editar Gasto';
        modalExpense.classList.remove('hidden');
    };

    // Categorias Logic
    btnSaveCategory.onclick = async () => {
        const nombre = newCategoryName.value.trim();
        if (!nombre) return;

        try {
            const resp = await fetch('/api/expenses/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre })
            });

            if (resp.ok) {
                newCategoryName.value = '';
                loadCategories();
            }
        } catch (error) {
            console.error('Error category:', error);
        }
    };

    window.deleteCategory = async (id) => {
        try {
            const resp = await fetch(`/api/expenses/categories/${id}`, { method: 'DELETE' });
            if (resp.ok) loadCategories();
        } catch (error) {
            console.error('Error delete cat:', error);
        }
    };

    // Abonos Logic
    window.openAbonoModal = (id) => {
        const exp = expenses.find(e => e.id === id);
        if (!exp) return;
        activeExpenseForAbono = exp;
        
        const moneda = exp.moneda || 'VES';
        const pendVes = Number(exp.monto_pendiente_ves) || 0;
        const tasa = Number(exp.tasa_bcv) || currentBcvRate;
        const pendUsd = pendVes / tasa;

        // Reset fields
        const abonoMetodo = document.getElementById('abono-metodo');
        const containerRef = document.getElementById('container-referencia');
        const abonoReferencia = document.getElementById('abono-referencia');
        const labelMonto = document.getElementById('label-monto-abono');

        abonoMetodo.value = 'EFECTIVO';
        containerRef.classList.add('hidden');
        abonoReferencia.value = '';

        if (moneda === 'USD') {
            abonoInfo.textContent = `Pendiente: ${pendUsd.toLocaleString('en-US', {minimumFractionDigits:2})} $ (${pendVes.toLocaleString('es-VE')} Bs) - ${exp.concepto}`;
            abonoMonto.value = pendUsd.toFixed(2);
            labelMonto.textContent = 'Monto a Liquidar (USD)';
        } else {
            abonoInfo.textContent = `Pendiente: ${pendVes.toLocaleString('es-VE')} Bs - ${exp.concepto}`;
            abonoMonto.value = pendVes.toFixed(2);
            labelMonto.textContent = 'Monto a Liquidar (VES)';
        }

        modalAbono.classList.remove('hidden');
        setTimeout(() => abonoMonto.focus(), 100);
    };

    // Toggle Referencia + Actualizar label de monto segun metodo
    document.getElementById('abono-metodo').addEventListener('change', (e) => {
        const containerRef = document.getElementById('container-referencia');
        if (e.target.value === 'TRANSFERENCIA' || e.target.value === 'PAGO_MOVIL') {
            containerRef.classList.remove('hidden');
        } else {
            containerRef.classList.add('hidden');
            abonoReferencia.value = '';
        }

        if (!activeExpenseForAbono) return;
        const pendVes = Number(activeExpenseForAbono.monto_pendiente_ves) || 0;
        const tasa = Number(activeExpenseForAbono.tasa_bcv) || currentBcvRate;
        const labelMonto = document.getElementById('label-monto-abono');
        const metodo = e.target.value;

        if (metodo === 'USD') {
            const pendUsd = pendVes / tasa;
            abonoMonto.value = pendUsd.toFixed(2);
            labelMonto.textContent = 'Monto a Liquidar (USD)';
        } else {
            abonoMonto.value = pendVes.toFixed(2);
            labelMonto.textContent = 'Monto a Liquidar (VES)';
        }
    });

    btnConfirmAbono.onclick = async () => {
        const montoRaw = parseFloat(abonoMonto.value);
        const metodo = document.getElementById('abono-metodo').value;
        const referencia = document.getElementById('abono-referencia').value.trim();

        if (!montoRaw || montoRaw <= 0 || !activeExpenseForAbono) return;

        // Validación obligatoria de referencia
        if ((metodo === 'TRANSFERENCIA' || metodo === 'PAGO_MOVIL') && !referencia) {
            return showToast('El código de referencia es obligatorio', 'warning');
        }

        const tasa = Number(activeExpenseForAbono.tasa_bcv) || currentBcvRate;

        // La moneda del abono depende del metodo seleccionado
        const monedaAbono = (metodo === 'USD') ? 'USD' : 'VES';
        const montoVes = (monedaAbono === 'USD') ? (montoRaw * tasa) : montoRaw;
        const montoUsd = (monedaAbono === 'USD') ? montoRaw : (montoRaw / tasa);

        try {
            btnConfirmAbono.disabled = true;
            btnConfirmAbono.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> PROCESANDO...';

            const resp = await fetch('/api/expenses/abonos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    expense_id: activeExpenseForAbono.id,
                    amount: montoRaw,
                    currency: monedaAbono,
                    method: metodo,
                    referencia: referencia,
                    usuario_id: null
                })
            });

            if (resp.ok) {
                showToast('Abono registrado con éxito', 'success');
                modalAbono.classList.add('hidden');
                loadExpenses();
            } else {
                const err = await resp.json();
                showToast(err.error || 'Monto excede el saldo', 'warning');
            }
        } catch (error) {
            console.error('Error abono:', error);
            showToast('Error al procesar el abono', 'error');
        } finally {
            btnConfirmAbono.disabled = false;
            btnConfirmAbono.innerHTML = 'PROCESAR PAGO';
        }
    };

    // --- Helpers & Listeners ---

    function closeAllModals() {
        modalExpense.classList.add('hidden');
        modalCategories.classList.add('hidden');
        modalAbono.classList.add('hidden');
        expenseForm.reset();
        document.getElementById('expense-id').value = '';
        document.getElementById('modal-title').textContent = 'Registrar Gasto';
    }

    btnAddExpense.onclick = () => {
        closeAllModals();
        setTasaTipo('BCV');
        document.getElementById('expense-tasa').value = currentBcvRate || '';
        modalExpense.classList.remove('hidden');
    };
    btnManageCategories.onclick = () => modalCategories.classList.remove('hidden');
    
    document.querySelectorAll('.close-modal, #cancel-abono').forEach(btn => {
        btn.onclick = closeAllModals;
    });

    btnRefresh.onclick = loadExpenses;
    searchInput.oninput = loadExpenses;
    filterStartDate.onchange = loadExpenses;
    filterEndDate.onchange = loadExpenses;
    filterCategory.onchange = loadExpenses;

    // Toast placeholder if not included
    function showToast(msg, type = 'info') {
        if (window.Toast && typeof window.Toast.fire === 'function') {
            window.Toast.fire({
                icon: type,
                title: msg
            });
        } else {
            console.log(`Toast: [${type}] ${msg}`);
            // Fallback simplistic sweetalert if toast.js not found or failing
            Swal.fire({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true,
                icon: type,
                title: msg,
                background: document.body.classList.contains('dark-mode') ? '#1e293b' : '#fff',
                color: document.body.classList.contains('dark-mode') ? '#fff' : '#000'
            });
        }
    }

    init();
});
