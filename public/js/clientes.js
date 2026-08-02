// public/js/clientes.js
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

    // Drawer / Panel Detalle
    const detailPanel = document.getElementById('client-detail-panel');
    const detailContent = document.getElementById('client-detail-content');
    const btnCloseDetail = document.getElementById('btn-close-detail');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    const detailName = document.getElementById('detail-client-name');
    const detailIdInfo = document.getElementById('detail-client-id-info');
    const detailInitials = document.getElementById('client-initials');

    const infoCedula = document.getElementById('info-cedula');
    const infoTelefono = document.getElementById('info-telefono');
    const infoDireccion = document.getElementById('info-direccion');

    let currentClient = null;
    let searchTimeout;

    // --- Helpers ---
    function formatBs(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(2) : '0.00';
    }

    function showToast(message, type = 'info') {
        if (window.parent && window.parent.Toast) {
            window.parent.Toast.show(message, type);
        }
    }

    // --- Restricciones de Rol ---
    // Solo ADMIN y MASTER pueden editar o inactivar clientes
    function applyClientRoleRestrictions() {
        const rol = (window.NEXUS_USER_ROLE || '').toUpperCase();
        const btnEdit = document.getElementById('btn-edit-client-detail');
        const btnDelete = document.getElementById('btn-delete-client-detail');
        const puedeEditar = (rol === 'ADMIN' || rol === 'MASTER');
        if (btnEdit) btnEdit.style.display = puedeEditar ? '' : 'none';
        if (btnDelete) btnDelete.style.display = puedeEditar ? '' : 'none';
    }

    // --- Carga de Datos ---
    async function loadClients(searchTerm = '') {
        try {
            const response = await fetch(`/api/clients?search=${encodeURIComponent(searchTerm)}`);
            if (!response.ok) throw new Error('Error al cargar clientes');
            const clients = await response.json();
            renderClients(clients);
        } catch (error) {
            console.error('Error loadClients:', error);
            clientListContainer.innerHTML = '';
            clientListPlaceholder.classList.remove('hidden');
        }
    }

    function renderClients(clients) {
        clientListContainer.innerHTML = '';
        if (clients.length === 0) {
            clientListPlaceholder.classList.remove('hidden');
            return;
        }
        clientListPlaceholder.classList.add('hidden');

        clients.forEach(client => {
            const card = document.createElement('div');
            card.className = 'card-tech group cursor-pointer';
            card.innerHTML = `
                <div class="mesh-bg" style="background-color: #3b82f6 !important;"></div>
                <div class="relative z-10">
                <div class="flex items-center gap-4">
                    <div class="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold text-xl uppercase group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        ${client.nombre.charAt(0)}
                    </div>
                    <div class="min-w-0 flex-1">
                        <h3 class="text-lg font-bold text-gray-900 dark:text-white truncate">${client.nombre}</h3>
                        <p class="text-sm text-gray-500 dark:text-gray-400 font-mono">${client.cedula || 'Sin Cédula'}</p>
                    </div>
                </div>
                <div class="mt-4 pt-4 border-t border-gray-100 dark:border-white/5 grid grid-cols-2 gap-2 text-sm">
                    <div class="text-gray-500">Deuda Bs:</div>
                    <div class="text-right font-bold ${client.deuda_total_ves > 0 ? 'text-red-500' : 'text-green-500'}">
                        ${formatBs(client.deuda_total_ves)} Bs
                    </div>
                </div>
                </div>
            `;
            card.onclick = () => openDetail(client);
            clientListContainer.appendChild(card);
        });
    }

    // --- Panel de Detalle ---
    async function openDetail(client) {
        currentClient = client;
        detailName.textContent = client.nombre;
        detailIdInfo.textContent = `C.I. ${client.cedula || 'N/A'}`;
        detailInitials.textContent = client.nombre.charAt(0);

        infoCedula.textContent = client.cedula || '---';
        infoTelefono.textContent = client.telefono || '---';
        infoDireccion.textContent = client.direccion || 'No especificada';

        // Reset Tabs
        switchTab('info');

        detailPanel.classList.remove('hidden');
        setTimeout(() => {
            detailContent.classList.remove('translate-x-full');
        }, 10);

        // Aplicar restricciones de rol cada vez que se abre el panel
        applyClientRoleRestrictions();
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

        if (tabId === 'sales') loadSalesHistory();
        if (tabId === 'statement') loadAccountStatement();
    }

    // --- Historial de Ventas ---
    async function loadSalesHistory() {
        const container = document.getElementById('sales-container');
        const loader = document.getElementById('sales-loading');

        container.innerHTML = '';
        loader.classList.remove('hidden');

        try {
            const response = await fetch(`/api/clients/${currentClient.id}/sales`);
            if (!response.ok) throw new Error('Error al cargar ventas');
            const sales = await response.json();

            loader.classList.add('hidden');
            if (sales.length === 0) {
                container.innerHTML = '<p class="text-center text-gray-500 py-8">No hay ventas registradas.</p>';
                return;
            }

            sales.forEach(sale => {
                const div = document.createElement('div');
                div.className = 'bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg border border-gray-100 dark:border-gray-700 flex justify-between items-center';
                const date = new Date(sale.creado_en).toLocaleDateString('es-VE');

                div.innerHTML = `
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-gray-900 dark:text-gray-100">Venta #${sale.id}</span>
                        <span class="text-xs text-gray-500">${date}</span>
                    </div>
                    <div class="flex flex-col items-end">
                        <span class="font-bold text-gray-900 dark:text-gray-100">${formatBs(sale.total_ves)} Bs</span>
                        <span class="text-xs px-2 py-0.5 rounded ${sale.estado_pago === 'PAGADO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                            ${sale.estado_pago}
                        </span>
                    </div>
                `;
                div.onclick = () => {
                    // Abrir detalles de venta en el frame principal si fuera necesario
                    if (window.parent && window.parent.loadPage) {
                        window.parent.loadPage(`detalles_venta.html?id=${sale.id}`);
                    }
                };
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
            const response = await fetch(`/api/clients/${currentClient.id}/statement`);
            if (!response.ok) throw new Error('Error al cargar estado de cuenta');
            const movements = await response.json();

            loader.classList.add('hidden');
            if (movements.length === 0) {
                body.innerHTML = '<tr><td colspan="4" class="text-center text-gray-500 py-8">Sin movimientos.</td></tr>';
                return;
            }

            movements.forEach(m => {
                const tr = document.createElement('tr');
                const date = new Date(m.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                const isDebit = m.tipo === 'VENTA';

                tr.innerHTML = `
                    <td class="px-4 py-3 text-xs text-gray-500 font-mono">${date}</td>
                    <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${m.referencia}</td>
                    <td class="px-4 py-3 text-right font-bold ${isDebit ? 'text-red-500' : 'text-green-500'}">
                        ${isDebit ? '-' : '+'}${formatBs(m.monto_ves)}
                    </td>
                    <td class="px-4 py-3 text-center">
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${isDebit ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}">
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
    function openModal(client = null) {
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

    async function handleFormSubmit(e) {
        e.preventDefault();
        const id = clientIdInput.value;
        const data = {
            nombre: clientNombreInput.value.trim(),
            cedula: clientCedulaInput.value.trim(),
            telefono: clientTelefonoInput.value.trim(),
            direccion: clientDireccionInput.value.trim()
        };

        const method = id ? 'PUT' : 'POST';
        const url = id ? `/api/clients/${id}` : '/api/clients';

        clientModalStatus.textContent = 'Guardando...';

        try {
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Error al guardar');

            showToast(id ? 'Cliente actualizado' : 'Cliente creado', 'success');
            clientModal.classList.add('hidden');
            loadClients(searchInput.value);
            if (id && currentClient && currentClient.id == id) {
                const updated = { ...currentClient, ...data };
                openDetail(updated); // Refrescar panel detalle
            }
        } catch (error) {
            clientModalStatus.textContent = error.message;
            clientModalStatus.className = 'text-sm mt-3 text-center text-red-500';
        }
    }

    // --- Event Listeners ---
    btnAddClient.onclick = () => openModal();
    btnCancelClient.onclick = () => clientModal.classList.add('hidden');
    clientForm.onsubmit = handleFormSubmit;

    btnCloseDetail.onclick = closeDetail;
    document.getElementById('btn-edit-client-detail').onclick = () => openModal(currentClient);

    tabBtns.forEach(btn => {
        btn.onclick = () => switchTab(btn.dataset.tab);
    });

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadClients(e.target.value);
        }, 300);
    });

    // Delegación para inactivar
    document.getElementById('btn-delete-client-detail').onclick = async () => {
        if (!currentClient) return;

        const confirmMsg = `¿Estás seguro de inactivar a "${currentClient.nombre}"? No aparecerá en las búsquedas del POS ni Cobranza.`;

        // Usar confirm global si existe
        const ctx = window.parent || window;
        let confirmed = false;
        if (ctx.openSystemConfirm) {
            confirmed = await ctx.openSystemConfirm(confirmMsg, 'Confirmar Inactivación');
        } else {
            confirmed = confirm(confirmMsg);
        }

        if (confirmed) {
            try {
                const response = await fetch(`/api/clients/${currentClient.id}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Error al inactivar');
                showToast('Cliente inactivado', 'success');
                closeDetail();
                loadClients(searchInput.value);
            } catch (error) {
                showToast(error.message, 'error');
            }
        }
    };

    // --- Restricciones de Rol (al cargar la página) ---
    applyClientRoleRestrictions();

    // Inicializar
    loadClients();
});
