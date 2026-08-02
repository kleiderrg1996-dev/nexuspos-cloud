// public/js/proveedores.js
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('supplier-search-input');
    const supplierListContainer = document.getElementById('supplier-list-container');
    const supplierListPlaceholder = document.getElementById('supplier-list-placeholder');
    const btnAddSupplier = document.getElementById('btn-add-supplier');

    const supplierModal = document.getElementById('supplier-modal');
    const supplierModalTitle = document.getElementById('supplier-modal-title');
    const supplierForm = document.getElementById('form-supplier');
    const supplierIdInput = document.getElementById('supplier-id');
    const supplierNombreInput = document.getElementById('supplier-nombre');
    const supplierRifInput = document.getElementById('supplier-rif');
    const supplierTelefonoInput = document.getElementById('supplier-telefono');
    const supplierDireccionInput = document.getElementById('supplier-direccion');
    const supplierContactoInput = document.getElementById('supplier-contacto');
    const btnCancelSupplier = document.getElementById('btn-cancel-supplier');
    const supplierModalStatus = document.getElementById('supplier-modal-status');

    // Drawer / Panel Detalle
    const detailPanel = document.getElementById('supplier-detail-panel');
    const detailContent = document.getElementById('supplier-detail-content');
    const btnCloseDetail = document.getElementById('btn-close-detail');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    const detailName = document.getElementById('detail-supplier-name');
    const detailIdInfo = document.getElementById('detail-supplier-id-info');
    const detailInitials = document.getElementById('supplier-initials');

    const infoRif = document.getElementById('info-rif');
    const infoTelefono = document.getElementById('info-telefono');
    const infoDireccion = document.getElementById('info-direccion');
    const infoContacto = document.getElementById('info-contacto');

    let currentSupplier = null;
    let searchTimeout;

    // --- Helpers ---
    function formatCurrency(value, currency = 'USD') {
        const n = Number(value);
        const formatted = Number.isFinite(n) ? n.toFixed(2) : '0.00';
        return `${formatted} ${currency}`;
    }

    function showToast(message, type = 'info') {
        if (window.parent && window.parent.Toast) {
            window.parent.Toast.show(message, type);
        } else if (typeof Swal !== 'undefined') {
            Swal.fire({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true,
                icon: type,
                title: message
            });
        }
    }

    // --- Carga de Datos ---
    async function loadSuppliers(searchTerm = '') {
        try {
            const response = await fetch(`/api/suppliers?search=${encodeURIComponent(searchTerm)}`);
            if (!response.ok) throw new Error('Error al cargar proveedores');
            const suppliers = await response.json();
            renderSuppliers(suppliers);
        } catch (error) {
            console.error('Error loadSuppliers:', error);
            supplierListContainer.innerHTML = '';
            supplierListPlaceholder.classList.remove('hidden');
        }
    }

    function renderSuppliers(suppliers) {
        supplierListContainer.innerHTML = '';
        if (suppliers.length === 0) {
            supplierListPlaceholder.classList.remove('hidden');
            return;
        }
        supplierListPlaceholder.classList.add('hidden');

        suppliers.forEach(supplier => {
            const card = document.createElement('div');
            card.className = 'card-tech group cursor-pointer';
            card.innerHTML = `
                <div class="mesh-bg" style="background-color: #6366f1 !important;"></div>
                <div class="relative z-10">
                <div class="flex items-center gap-4">
                    <div class="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-xl uppercase group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        ${supplier.nombre.charAt(0)}
                    </div>
                    <div class="min-w-0 flex-1">
                        <h3 class="text-lg font-bold text-gray-900 dark:text-white truncate">${supplier.nombre}</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400 font-mono">${supplier.rif || 'Sin RIF'}</p>
                    </div>
                </div>
                <div class="mt-4 pt-4 border-t border-gray-100 dark:border-white/5 space-y-1">
                    <div class="flex justify-between text-sm">
                        <span class="text-gray-500">Contacto:</span>
                        <span class="text-gray-700 dark:text-gray-300 font-medium truncate ml-2">${supplier.contacto || '---'}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span class="text-gray-500">Teléfono:</span>
                        <span class="text-gray-700 dark:text-gray-300 font-mono">${supplier.telefono || '---'}</span>
                    </div>
                </div>
                </div>
            `;
            card.onclick = () => openDetail(supplier);
            supplierListContainer.appendChild(card);
        });
    }

    // --- Panel de Detalle ---
    async function openDetail(supplier) {
        currentSupplier = supplier;
        detailName.textContent = supplier.nombre;
        detailIdInfo.textContent = `RIF: ${supplier.rif || 'N/A'}`;
        detailInitials.textContent = supplier.nombre.charAt(0);

        infoRif.textContent = supplier.rif || '---';
        infoTelefono.textContent = supplier.telefono || '---';
        infoContacto.textContent = supplier.contacto || '---';
        infoDireccion.textContent = supplier.direccion || 'No especificada';

        // Reset Tabs
        switchTab('info');

        detailPanel.classList.remove('hidden');
        setTimeout(() => {
            detailContent.classList.remove('translate-x-full');
        }, 10);
    }

    function closeDetail() {
        detailContent.classList.add('translate-x-full');
        setTimeout(() => {
            detailPanel.classList.add('hidden');
        }, 300);
    }

    function switchTab(tabId) {
        tabBtns.forEach(btn => {
            if (btn.dataset.tab === tabId) {
                btn.classList.add('border-blue-500', 'text-blue-600', 'dark:text-blue-400');
                btn.classList.remove('border-transparent', 'text-gray-500', 'dark:text-gray-400');
            } else {
                btn.classList.remove('border-blue-500', 'text-blue-600', 'dark:text-blue-400');
                btn.classList.add('border-transparent', 'text-gray-500', 'dark:text-gray-400');
            }
        });

        tabPanes.forEach(pane => {
            pane.id === `tab-${tabId}` ? pane.classList.remove('hidden') : pane.classList.add('hidden');
        });

        if (tabId === 'purchases') loadPurchasesHistory();
        if (tabId === 'statement') loadAccountStatement();
    }

    // --- Historial de Compras ---
    async function loadPurchasesHistory() {
        const container = document.getElementById('purchases-container');
        const loader = document.getElementById('purchases-loading');

        container.innerHTML = '';
        loader.classList.remove('hidden');

        try {
            const response = await fetch(`/api/suppliers/${currentSupplier.id}/purchases`);
            if (!response.ok) throw new Error('Error al cargar historial de compras');
            const purchases = await response.json();

            loader.classList.add('hidden');
            if (purchases.length === 0) {
                container.innerHTML = '<p class="text-center text-gray-500 py-8">No hay compras registradas.</p>';
                return;
            }

            purchases.forEach(purchase => {
                const div = document.createElement('div');
                div.className = 'bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg border border-gray-100 dark:border-gray-700 flex justify-between items-center';
                const date = new Date(purchase.fecha).toLocaleDateString('es-VE');

                div.innerHTML = `
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-gray-900 dark:text-gray-100">Factura #${purchase.numero_factura}</span>
                        <span class="text-xs text-gray-500">${date}</span>
                    </div>
                    <div class="flex flex-col items-end">
                        <span class="font-bold text-gray-900 dark:text-gray-100">${formatCurrency(purchase.total_compra, purchase.moneda)}</span>
                        <span class="text-[10px] px-2 py-0.5 rounded font-bold uppercase ${purchase.estado === 'COMPLETADO' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">
                            ${purchase.estado}
                        </span>
                    </div>
                `;
                container.appendChild(div);
            });
        } catch (error) {
            loader.innerHTML = `<p class="text-red-500 text-sm">${error.message}</p>`;
        }
    }

    // --- Estado de Cuenta ---
    async function loadAccountStatement() {
        const body = document.getElementById('statement-body');
        const loader = document.getElementById('statement-loading');

        body.innerHTML = '';
        loader.classList.remove('hidden');

        try {
            const response = await fetch(`/api/suppliers/${currentSupplier.id}/statement`);
            if (!response.ok) throw new Error('Error al cargar estado de cuenta');
            const movements = await response.json();

            loader.classList.add('hidden');
            if (movements.length === 0) {
                body.innerHTML = '<tr><td colspan="4" class="text-center text-gray-500 py-8">Sin movimientos registrados.</td></tr>';
                return;
            }

            movements.forEach(m => {
                const tr = document.createElement('tr');
                const date = new Date(m.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
                
                tr.innerHTML = `
                    <td class="px-4 py-3 text-xs text-gray-500 font-mono">${date}</td>
                    <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${m.referencia}</td>
                    <td class="px-4 py-3 text-right font-bold text-red-500">
                        -${formatCurrency(m.monto, m.moneda)}
                    </td>
                    <td class="px-4 py-3 text-center">
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase bg-yellow-100 text-yellow-800">
                            ${m.tipo}
                        </span>
                    </td>
                `;
                body.appendChild(tr);
            });
        } catch (error) {
            loader.innerHTML = `<p class="text-red-500 text-sm">${error.message}</p>`;
        }
    }

    // --- Modal CRUD ---
    function openModal(supplier = null) {
        supplierForm.reset();
        supplierIdInput.value = '';
        if (supplier) {
            // Si estamos editando desde el panel de detalles, lo cerramos para evitar traslapes
            if (!detailPanel.classList.contains('hidden')) {
                closeDetail();
            }
            
            supplierModalTitle.textContent = 'Editar Proveedor';
            supplierIdInput.value = supplier.id;
            supplierNombreInput.value = supplier.nombre;
            supplierRifInput.value = supplier.rif || '';
            supplierTelefonoInput.value = supplier.telefono || '';
            supplierDireccionInput.value = supplier.direccion || '';
            supplierContactoInput.value = supplier.contacto || '';
        } else {
            supplierModalTitle.textContent = 'Añadir Nuevo Proveedor';
        }
        supplierModalStatus.textContent = '';
        supplierModal.classList.remove('hidden');
    }

    async function handleFormSubmit(e) {
        e.preventDefault();
        const id = supplierIdInput.value;
        const data = {
            nombre: supplierNombreInput.value.trim(),
            rif: supplierRifInput.value.trim(),
            telefono: supplierTelefonoInput.value.trim(),
            direccion: supplierDireccionInput.value.trim(),
            contacto: supplierContactoInput.value.trim()
        };

        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/suppliers/${id}` : '/api/suppliers';

        supplierModalStatus.textContent = 'Guardando...';
        supplierModalStatus.className = 'text-sm mt-3 text-center text-blue-500';

        try {
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Error al guardar');

            showToast(id ? 'Proveedor actualizado' : 'Proveedor creado', 'success');
            supplierModal.classList.add('hidden');
            loadSuppliers(searchInput.value);
            if (id && currentSupplier && currentSupplier.id == id) {
                const updated = { ...currentSupplier, ...data };
                openDetail(updated); // Refrescar panel detalle
            }
        } catch (error) {
            supplierModalStatus.textContent = error.message;
            supplierModalStatus.className = 'text-sm mt-3 text-center text-red-500';
        }
    }

    // --- Event Listeners ---
    btnAddSupplier.onclick = () => openModal();
    btnCancelSupplier.onclick = () => supplierModal.classList.add('hidden');
    supplierForm.onsubmit = handleFormSubmit;

    btnCloseDetail.onclick = closeDetail;
    document.getElementById('btn-edit-supplier-detail').onclick = () => openModal(currentSupplier);

    tabBtns.forEach(btn => {
        btn.onclick = () => switchTab(btn.dataset.tab);
    });

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadSuppliers(e.target.value);
        }, 300);
    });

    document.getElementById('btn-delete-supplier-detail').onclick = async () => {
        if (!currentSupplier) return;

        const confirmMsg = `¿Estás seguro de inactivar a "${currentSupplier.nombre}"?`;
        
        // Usar confirm de SweetAlert2 si está disponible
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title: '¿Confirmar inactivación?',
                text: confirmMsg,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Sí, inactivar',
                cancelButtonText: 'Cancelar'
            });
            
            if (result.isConfirmed) {
                try {
                    const response = await fetch(`/api/suppliers/${currentSupplier.id}`, { method: 'DELETE' });
                    if (!response.ok) throw new Error('Error al inactivar');
                    showToast('Proveedor inactivado', 'success');
                    closeDetail();
                    loadSuppliers(searchInput.value);
                } catch (error) {
                    showToast(error.message, 'error');
                }
            }
        } else if (confirm(confirmMsg)) {
            try {
                const response = await fetch(`/api/suppliers/${currentSupplier.id}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Error al inactivar');
                showToast('Proveedor inactivado', 'success');
                closeDetail();
                loadSuppliers(searchInput.value);
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    };

    // Inicializar
    loadSuppliers();
});
