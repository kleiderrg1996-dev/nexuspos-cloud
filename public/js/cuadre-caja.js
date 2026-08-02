document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('cash-status-table-body');
  const globalSummaryContainer = document.getElementById('global-method-summary');
  const btnRefresh = document.getElementById('btn-refresh');
  const statOpenCount = document.getElementById('stat-open-count');
  const statClosedCount = document.getElementById('stat-closed-count');
  const statTotalVes = document.getElementById('stat-total-ves');
  const statTotalUsd = document.getElementById('stat-total-usd');

  const filterStartDate = document.getElementById('filter-start-date');
  const filterEndDate = document.getElementById('filter-end-date');
  const btnExportPdf = document.getElementById('btn-export-pdf');

  let currentUsers = [];

  const methodLabels = {
    'VES_EFECTIVO': 'Efectivo Bs',
    'USD_EFECTIVO': 'Efectivo Dólares',
    'TARJETA': 'Tarjeta',
    'BIOPAGO': 'Biopago',
    'PAGOMOVIL': 'Pago Móvil',
    'ZELLE': 'Zelle'
  };

  // Helper para abrir ventanas tipo "App de PC"
  function openAppWindow(url, title = 'NexusPOS', w = 900, h = 800) {
    const left = (screen.width / 2) - (w / 2);
    const top = (screen.height / 2) - (h / 2);
    return window.open(url, title, `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, copyhistory=no, width=${w}, height=${h}, top=${top}, left=${left}`);
  }

  // Helper para obtener fecha local YYYY-MM-DD
  function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Establecer fechas por defecto (hoy local)
  const todayStr = formatLocalDate(new Date());
  filterStartDate.value = todayStr;
  filterEndDate.value = todayStr;

  async function loadCashStatus() {
    try {
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="px-6 py-10 text-center text-gray-500">
            <div class="flex flex-col items-center">
              <svg class="animate-spin h-8 w-8 text-blue-600 mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Cargando información...
            </div>
          </td>
        </tr>
      `;

      const start = filterStartDate.value;
      const end = filterEndDate.value;
      const url = start && end ? `/api/reports/cash-status?startDate=${start}&endDate=${end}` : '/api/reports/cash-status';

      const res = await fetch(url);
      if (!res.ok) throw new Error('No se pudo cargar el estado de las cajas');

      const data = await res.json();
      currentUsers = data.users || [];
      renderTable(currentUsers);
      renderGlobalSummary(data.globalSummary || {});
      updateStats(currentUsers);
    } catch (error) {
      console.error(error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="6" class="px-6 py-10 text-center text-red-500 font-medium">
            Error al cargar los datos: ${error.message}
          </td>
        </tr>
      `;
    }
  }

  function renderTable(users) {
    if (users.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="6" class="px-6 py-10 text-center text-gray-500">No hay datos para las fechas seleccionadas.</td></tr>`;
      return;
    }

    tableBody.innerHTML = '';
    users.forEach((item, index) => {
      const row = document.createElement('tr');
      row.className = 'hover:bg-gray-50 transition-colors';

      const statusBadge = item.status === 'ABIERTA'
        ? '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Abierta</span>'
        : '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Cerrada</span>';

      const dateStr = item.status === 'ABIERTA'
        ? (item.openSince ? `Abierta: ${new Date(item.openSince).toLocaleString('es-VE', { timeStyle: 'short', dateStyle: 'short' })}` : 'N/A')
        : (item.lastClosureDate ? `Cerrada: ${new Date(item.lastClosureDate).toLocaleString('es-VE', { timeStyle: 'short', dateStyle: 'short' })}` : 'Nunca abierta');

      row.innerHTML = `
        <td class="px-6 py-4 whitespace-nowrap">
          <div class="flex items-center">
            <div class="h-10 w-10 flex-shrink-0 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 font-bold">
              ${item.username.charAt(0).toUpperCase()}
            </div>
            <div class="ml-4">
              <div class="text-sm font-medium text-gray-900">${item.nombre}</div>
              <div class="text-xs text-gray-500">@${item.username} • ${item.rol}</div>
            </div>
          </div>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">${statusBadge}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${dateStr}</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">${item.totalVes.toFixed(2)} Bs</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">${item.totalUsd.toFixed(2)} $</td>
        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <button class="text-blue-600 hover:text-blue-900 font-bold" onclick="showUserDetails(${index})">
            Detalles
          </button>
        </td>
      `;
      tableBody.appendChild(row);
    });
  }

  function renderGlobalSummary(summary) {
    globalSummaryContainer.innerHTML = '';
    const methods = Object.keys(summary).length > 0 ? summary : {
      'VES_EFECTIVO': { total_ves: 0, total_usd: 0 },
      'USD_EFECTIVO': { total_ves: 0, total_usd: 0 }
    };

    let index = 0;
    for (const [metodo, totals] of Object.entries(methods)) {
      const card = document.createElement('div');
      card.className = `card-tech group animate-slide-up`;
      card.style.animationDelay = `${index * 0.1}s`;

      const label = methodLabels[metodo] || metodo;
      const isUsd = metodo === 'USD_EFECTIVO' || metodo === 'ZELLE';

      // Color del mesh según tipo de método
      const meshColors = {
        'USD_EFECTIVO': '#22c55e',
        'VES_EFECTIVO': '#3b82f6',
        'TARJETA': '#a855f7',
        'BIOPAGO': '#06b6d4',
        'PAGOMOVIL': '#f97316',
        'ZELLE': '#00d4aa'
      };
      const meshColor = meshColors[metodo] || '#6366f1';

      card.innerHTML = `
                <div class="mesh-bg" style="background-color: ${meshColor} !important;"></div>
                <div class="relative z-10">
                    <p class="text-[10px] font-black uppercase tracking-[0.2em] mb-1" style="color: ${meshColor}; opacity: 0.8;">${label}</p>
                    <p class="text-lg font-bold text-gray-800 dark:text-white">${isUsd ? totals.total_usd.toFixed(2) + ' $' : totals.total_ves.toFixed(2) + ' Bs'}</p>
                    ${!isUsd && totals.total_usd > 0 ? `<p class="text-xs text-gray-400">Ref: ${totals.total_usd.toFixed(2)} $</p>` : ''}
                </div>
            `;
      globalSummaryContainer.appendChild(card);
      index++;
    }
  }

  function updateStats(users) {
    let open = 0, closed = 0, totalVes = 0, totalUsd = 0;
    users.forEach(item => {
      if (item.status === 'ABIERTA') open++;
      else closed++;
      totalVes += (item.totalVes || 0);
      totalUsd += (item.totalUsd || 0);
    });
    statOpenCount.textContent = open;
    statClosedCount.textContent = closed;
    statTotalVes.textContent = `${totalVes.toFixed(2)} Bs`;
    statTotalUsd.textContent = `${totalUsd.toFixed(2)} $`;
  }

  window.showUserDetails = function (index) {
    const user = currentUsers[index];
    if (!user) return;

    document.getElementById('modal-user-name').textContent = `Movimientos de: ${user.nombre}`;
    document.getElementById('modal-user-info').textContent = `@${user.username} • ${user.rol}`;

    const methodsBody = document.getElementById('modal-methods-body');
    methodsBody.innerHTML = '';

    const methods = user.methods || {};
    const methodKeys = Object.keys(methods);

    if (methodKeys.length === 0) {
      methodsBody.innerHTML = '<tr><td colspan="2" class="px-4 py-4 text-center text-gray-400 italic text-sm">No hay movimientos registrados.</td></tr>';
    } else {
      methodKeys.forEach(key => {
        const isUsd = key === 'USD_EFECTIVO' || key === 'ZELLE';
        const label = methodLabels[key] || key;
        const amount = isUsd ? methods[key].total_usd.toFixed(2) + ' $' : methods[key].total_ves.toFixed(2) + ' Bs';
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="px-4 py-2 text-sm text-gray-700">${label}</td><td class="px-4 py-2 text-right text-sm font-bold text-gray-900">${amount}</td>`;
        methodsBody.appendChild(tr);
      });
    }

    document.getElementById('modal-total-ves').textContent = `${user.totalVes.toFixed(2)} Bs`;
    document.getElementById('modal-total-usd').textContent = `${user.totalUsd.toFixed(2)} $`;

    const openingLabel = document.getElementById('modal-opening-time');
    openingLabel.textContent = user.openSince ? new Date(user.openSince).toLocaleString('es-VE') : 'N/A';

    document.getElementById('modal-opening-amounts').textContent = `${user.openingVes.toFixed(2)} Bs | ${user.openingUsd.toFixed(2)} $`;

    document.getElementById('details-modal').classList.remove('hidden');
  };

  window.closeModal = () => document.getElementById('details-modal').classList.add('hidden');

  btnRefresh.addEventListener('click', loadCashStatus);

  function handleExport(format) {
    const start = filterStartDate.value, end = filterEndDate.value;
    if (!start || !end) return alert('Selecciona fechas.');
    const url = `/api/reports/cash-status/${format}?startDate=${start}&endDate=${end}`;
    const viewerUrl = `/pdf_viewer.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent('Cuadre de Caja')}`;
    openAppWindow(viewerUrl, 'Cuadre de Caja', 1000, 900);
  }

  btnExportPdf.addEventListener('click', () => handleExport('pdf'));

  loadCashStatus();

  // Quick Select Buttons
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

      const formatDate = (date) => formatLocalDate(date);
      filterStartDate.value = formatDate(start);
      filterEndDate.value = formatDate(end);
      loadCashStatus();
    });
  });
});
