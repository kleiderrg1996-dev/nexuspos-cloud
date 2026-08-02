// public/js/kardex.js

// Proxy para acceder al helper de ventanas desde cualquier contexto (Iframe o Popup)
window.openAppWindow = window.openAppWindow || (window.parent && window.parent.openAppWindow) || (window.opener && window.opener.openAppWindow) || function (url, title = 'NexusPOS', w = 1000, h = 800) {
    const left = (screen.width / 2) - (w / 2);
    const top = (screen.height / 2) - (h / 2);
    return window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
};

let currentPage = 0;
const limit = 50;
let producto_id = null;

// Referencias DOM
const tableBody = document.getElementById('kardex-table-body');
const noDataMsg = document.getElementById('no-data-msg');
const movementsCountEl = document.getElementById('movements-count');
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');

const productSearchInput = document.getElementById('product-search');
const dateStartInput = document.getElementById('date-start');
const dateEndInput = document.getElementById('date-end');
const typeFilterSelect = document.getElementById('type-filter');

document.addEventListener('DOMContentLoaded', () => {
    loadKardex();

    // Eventos de Filtros (con debounce para la búsqueda)
    let searchTimeout;
    productSearchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 0;
            loadKardex();
        }, 500);
    });

    [dateStartInput, dateEndInput, typeFilterSelect].forEach(el => {
        el.addEventListener('change', () => {
            currentPage = 0;
            loadKardex();
        });
    });

    prevBtn.addEventListener('click', () => {
        if (currentPage > 0) {
            currentPage--;
            loadKardex();
        }
    });

    nextBtn.addEventListener('click', () => {
        currentPage++;
        loadKardex();
    });
});

async function loadKardex() {
    try {
        const offset = currentPage * limit;
        const queryParams = new URLSearchParams({
            limit,
            offset,
            fecha_inicio: dateStartInput.value,
            fecha_fin: dateEndInput.value ? `${dateEndInput.value} 23:59:59` : '',
            tipo: typeFilterSelect.value,
            producto_search: productSearchInput.value // Necesitamos ajustar el backend para soportar búsqueda por nombre
        });

        const response = await fetch(`/api/kardex?${queryParams}`);
        const result = await response.json();

        if (result.success) {
            renderTable(result.data);
            updatePaginationUI(result.pagination);
        }
    } catch (error) {
        console.error('Error loading Kardex:', error);
    }
}

function renderTable(movements) {
    tableBody.innerHTML = '';

    if (movements.length === 0) {
        noDataMsg.classList.remove('hidden');
        return;
    }

    noDataMsg.classList.add('hidden');

    movements.forEach(m => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors';

        const dateParts = (m.fecha || '').replace('T', ' ').split(' ');
        const dParts = (dateParts[0] || '').split('-');
        const date = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]} ${dateParts[1] || ''}` : m.fecha;
        const badgeColor = m.tipo === 'ENTRADA' ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50';

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 capitalize">${date}</td>
            <td class="px-6 py-4">
                <div class="font-medium text-gray-900 dark:text-white">${m.producto_nombre}</div>
                <div class="text-xs text-gray-500">${m.barcode || 'S/C'}</div>
            </td>
            <td class="px-6 py-4">
                <div class="flex items-center gap-2">
                    <span class="px-2 py-1 text-[10px] font-bold rounded-full uppercase tracking-wider ${badgeColor}">${m.motivo}</span>
                    ${m.referencia_id ? `
                        <button onclick="viewDetail(${m.referencia_id}, '${m.motivo}')" class="text-blue-500 hover:text-blue-700 underline text-[10px] font-bold">
                            #${m.referencia_id}
                        </button>
                    ` : ''}
                </div>
            </td>
            <td class="px-6 py-4 text-right font-medium ${m.tipo === 'ENTRADA' ? 'text-green-600' : 'text-red-600'}">
                ${m.tipo === 'ENTRADA' ? '+' : '-'}${m.cantidad}
            </td>
            <td class="px-6 py-4 text-right text-gray-500">${m.stock_anterior}</td>
            <td class="px-6 py-4 text-right font-bold text-gray-900 dark:text-white">${m.stock_nuevo}</td>
        `;
        tableBody.appendChild(tr);
    });
}

function viewDetail(refId, motivo) {
    if (motivo === 'VENTA' || motivo === 'ANULACION') {
        const url = `/api/sales/receipt/${refId}`;
        const viewerUrl = `/pdf_viewer.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent('Ticket de Venta #' + refId)}`;
        if (typeof window.openAppWindow === 'function') {
            window.openAppWindow(viewerUrl, 'Ticket', 450, 850);
        } else {
            openAppWindow(viewerUrl, 'Ticket', 450, 850);
        }
    } else {
        alert(`Referencia #${refId} - Motivo: ${motivo}`);
    }
}

function updatePaginationUI(pagination) {
    const { total, limit, offset } = pagination;
    const start = offset + 1;
    const end = Math.min(offset + limit, total);

    movementsCountEl.textContent = total > 0 ? `Mostrando ${start}-${end} de ${total} movimientos` : 'Mostrando 0 movimientos';

    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = end >= total;
}
