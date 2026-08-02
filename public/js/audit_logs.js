document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('logs-table-body');
    const noLogsMsg = document.getElementById('no-logs-msg');
    const logsCount = document.getElementById('logs-count');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');

    let currentPage = 1;

    loadLogs();

    prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadLogs();
        }
    });

    nextBtn.addEventListener('click', () => {
        currentPage++;
        loadLogs();
    });

    async function loadLogs() {
        try {
            const res = await fetch(`/api/audit?page=${currentPage}&limit=50`);
            const data = await res.json();
            renderLogs(data.logs);
            updatePagination(data);
        } catch (error) {
            console.error('Error loading logs:', error);
        }
    }

    function renderLogs(logs) {
        tableBody.innerHTML = '';
        if (logs.length === 0) {
            noLogsMsg.classList.remove('hidden');
            return;
        }
        noLogsMsg.classList.add('hidden');

        logs.forEach(log => {
            const date = new Date(log.fecha).toLocaleString();
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors border-b dark:border-gray-700";

            let details = '-';
            try {
                const prev = log.detalles_previos ? JSON.parse(log.detalles_previos) : null;
                const nuevo = log.detalles_nuevos ? JSON.parse(log.detalles_nuevos) : null;

                if (prev || nuevo) {
                    details = `<div class="text-xs space-y-1">`;
                    if (prev) details += `<div class="text-red-500"><span class="font-bold">Previo:</span> ${formatDetails(prev)}</div>`;
                    if (nuevo) details += `<div class="text-green-600 dark:text-green-400"><span class="font-bold">Nuevo:</span> ${formatDetails(nuevo)}</div>`;
                    details += `</div>`;
                }
            } catch (e) {
                details = 'Error parseando detalles';
            }

            tr.innerHTML = `
                <td class="px-6 py-4 text-gray-400 font-mono">${date}</td>
                <td class="px-6 py-4 font-bold text-gray-700 dark:text-gray-300">${log.usuario_nombre || 'SISTEMA'}</td>
                <td class="px-6 py-4">
                    <span class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${getActionClass(log.accion)}">
                        ${log.accion}
                    </span>
                </td>
                <td class="px-6 py-4 text-gray-600 dark:text-gray-400">
                    ${log.entidad_tipo} ${log.entidad_id ? `<span class="text-xs">(ID: ${log.entidad_id})</span>` : ''}
                </td>
                <td class="px-6 py-4">${details}</td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function formatDetails(obj) {
        if (typeof obj !== 'object' || obj === null) return obj;
        return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(', ');
    }

    function getActionClass(action) {
        if (action.includes('UPDATE')) return 'bg-blue-100 text-blue-700';
        if (action.includes('DELETE')) return 'bg-red-100 text-red-700';
        if (action.includes('STOCK')) return 'bg-orange-100 text-orange-700';
        return 'bg-gray-100 text-gray-700';
    }

    function updatePagination(data) {
        logsCount.textContent = `Mostrando ${data.logs.length} de ${data.totalLogs} registros`;
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = currentPage >= data.totalPages;
    }
});
