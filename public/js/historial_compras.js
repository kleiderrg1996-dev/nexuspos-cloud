// public/js/historial_compras.js

    // Helper para obtener fecha local YYYY-MM-DD
    function formatLocalDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

document.addEventListener('DOMContentLoaded', () => {
    // Inicializar fechas
    const todayStr = formatLocalDate(new Date());
    // Por defecto hoy para concordar con cuadre de caja, o mantener primer día del mes?
    // El usuario pidió "mismo estilo", en cuadre de caja empieza en hoy.
    document.getElementById('filter-date-start').value = todayStr;
    document.getElementById('filter-date-end').value = todayStr;

    loadPurchases();

    document.getElementById('btn-filter').addEventListener('click', loadPurchases);
    
    // Buscar al presionar Enter en el input de factura
    document.getElementById('filter-invoice').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadPurchases();
    });

    // Botones Rápidos
    const quickDateBtns = document.querySelectorAll('.btn-quick-date');
    quickDateBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const range = btn.dataset.range;
            const today = new Date();
            let start = new Date();
            let end = new Date();

            switch (range) {
                case 'today': break;
                case 'yesterday':
                    start.setDate(today.getDate() - 1);
                    end.setDate(today.getDate() - 1);
                    break;
                case 'last7':
                    start.setDate(today.getDate() - 7);
                    break;
            }

            document.getElementById('filter-date-start').value = formatLocalDate(start);
            document.getElementById('filter-date-end').value = formatLocalDate(end);
            loadPurchases();
        });
    });
});

async function loadPurchases() {
    const start = document.getElementById('filter-date-start').value;
    const end = document.getElementById('filter-date-end').value;
    const invoice = document.getElementById('filter-invoice').value.trim();

    const tbody = document.getElementById('purchases-table-body');
    const noResults = document.getElementById('no-results');
    
    tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-gray-500">Cargando compras...</td></tr>`;
    noResults.classList.add('hidden');

    try {
        const queryParams = new URLSearchParams({
            fecha_inicio: start,
            fecha_fin: end,
            numero_factura: invoice
        });

        const response = await fetch(`/api/purchases?${queryParams}`);
        const result = await response.json();

        if (result.success && result.data.length > 0) {
            renderTable(result.data);
        } else {
            tbody.innerHTML = '';
            noResults.classList.remove('hidden');
        }
    } catch (error) {
        console.error('Error:', error);
        tbody.innerHTML = `<tr><td colspan="9" class="py-8 text-center text-red-500">Error al cargar datos del servidor</td></tr>`;
    }
}

function renderTable(purchases) {
    const tbody = document.getElementById('purchases-table-body');
    tbody.innerHTML = purchases.map(p => {
        let fechaDisplay = p.fecha || '';
        let horaDisplay = '';
        if (p.fecha && p.fecha.includes(' ')) {
            const parts = p.fecha.split(' ');
            const dateParts = parts[0].split('-');
            fechaDisplay = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
            horaDisplay = parts[1] || '';
        } else if (p.fecha && p.fecha.includes('-')) {
            const dateParts = p.fecha.split('-');
            fechaDisplay = `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`;
        }
        const total = parseFloat(p.total_compra) || 0;
        const tasa = parseFloat(p.tasa_bcv) || 0;
        const moneda = p.moneda || 'USD';
        const conversion = moneda === 'USD' ? (total * tasa) : (total / tasa);
        const monedaDest = moneda === 'USD' ? 'VES' : 'USD';
        
        return `
            <tr class="hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all border-b border-gray-100 dark:border-white/5 group">
                <td class="px-6 py-5 whitespace-nowrap">
                    <div class="text-sm font-bold text-gray-800 dark:text-gray-100">${fechaDisplay}</div>
                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-1 flex items-center gap-1">
                        <i class="far fa-clock text-[10px]"></i> ${horaDisplay}
                    </div>
                </td>
                <td class="px-6 py-5 whitespace-nowrap">
                    <span class="text-sm font-black text-blue-600 dark:text-blue-400">#${p.id.toString().padStart(4, '0')}</span>
                </td>
                <td class="px-6 py-5 whitespace-nowrap">
                    <div class="flex items-center gap-2">
                        <div class="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-500/10 to-blue-600/10 dark:from-blue-400/10 dark:to-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg">
                            <i class="fas fa-file-invoice text-blue-500 dark:text-blue-400 text-xs"></i>
                            <span class="text-sm font-bold text-blue-700 dark:text-blue-300">${p.numero_factura}</span>
                        </div>
                        <div class="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-gray-100 to-gray-50 dark:from-white/5 dark:to-white/[0.02] border border-gray-200 dark:border-white/10 rounded-lg">
                            <i class="fas fa-hashtag text-gray-400 dark:text-gray-500 text-xs"></i>
                            <span class="text-sm font-semibold text-gray-600 dark:text-gray-400">${p.numero_control}</span>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-5 whitespace-nowrap">
                    <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">${p.proveedor_nombre}</span>
                </td>
                <td class="px-4 py-5 whitespace-nowrap text-center">
                    <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">${moneda === 'USD' ? total.toFixed(2) : conversion.toFixed(2)}</span>
                </td>
                <td class="px-4 py-5 whitespace-nowrap text-center">
                    <span class="text-sm font-semibold text-emerald-600 dark:text-emerald-400">${moneda === 'VES' ? total.toFixed(2) : conversion.toFixed(2)}</span>
                </td>
                <td class="px-4 py-5 whitespace-nowrap text-center">
                    <span class="text-sm font-medium text-gray-500 dark:text-gray-400">${tasa.toFixed(2)}</span>
                </td>
                <td class="px-6 py-5 whitespace-nowrap text-center">
                    <span class="text-base font-black text-blue-600 dark:text-blue-400">${total.toFixed(2)}</span>
                    <span class="text-[10px] font-bold text-gray-400 dark:text-gray-500 ml-1">${moneda}</span>
                </td>
                <td class="px-6 py-5 whitespace-nowrap text-center">
                    <div class="flex items-center justify-center gap-2">
                        <button onclick="viewReceipt(${p.id})" class="inline-flex items-center gap-2 px-4 py-2.5 text-white rounded-xl hover:scale-105 active:scale-95 transition-all text-xs font-bold shadow-lg shadow-blue-500/25" style="background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);">
                            <i class="fas fa-eye text-[11px]"></i> Ver Factura
                        </button>
                        <button onclick="deletePurchase(${p.id})" class="inline-flex items-center gap-2 px-3 py-2.5 text-white rounded-xl hover:scale-105 active:scale-95 transition-all text-xs font-bold shadow-lg shadow-red-500/25" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">
                            <i class="fas fa-trash text-[11px]"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function viewReceipt(id) {
    window.open(`/api/reports/purchases/${id}/pdf`, '_blank');
}

async function deletePurchase(id) {
    const result = await Swal.fire({
        title: 'Eliminar compra?',
        text: 'Se revertira el stock en inventario y esta accion no se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Si, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        const resp = await fetch(`/api/purchases/${id}`, { method: 'DELETE' });
        const json = await resp.json();
        if (json.success) {
            Swal.fire('Eliminada', 'La compra fue eliminada y el stock revertido.', 'success');
            loadPurchases();
        } else {
            Swal.fire('Error', json.error || 'No se pudo eliminar', 'error');
        }
    } catch (error) {
        Swal.fire('Error', 'Error de conexion', 'error');
    }
}
