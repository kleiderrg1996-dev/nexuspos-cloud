// js/retenciones.js
document.addEventListener('DOMContentLoaded', () => {

    const session = JSON.parse(sessionStorage.getItem('nexuspos_session'));
    const token = session ? session.sessionToken : null;
    
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const headers = {
        'Authorization': `Bearer ${token}`
    };

    // DOM Elements
    const tabIva = document.getElementById('tabIva');
    const tabIslr = document.getElementById('tabIslr');
    const contentIva = document.getElementById('contentIva');
    const contentIslr = document.getElementById('contentIslr');
    
    const listaRetencionesIva = document.getElementById('listaRetencionesIva');
    const listaRetencionesIslr = document.getElementById('listaRetencionesIslr');

    // Event Listeners for Tabs
    tabIva.addEventListener('click', () => switchTab('iva'));
    tabIslr.addEventListener('click', () => switchTab('islr'));

    function switchTab(tabName) {
        if (tabName === 'iva') {
            tabIva.classList.add('active', 'border-blue-500', 'text-blue-600');
            tabIva.classList.remove('border-transparent', 'text-gray-500');
            
            tabIslr.classList.remove('active', 'border-blue-500', 'text-blue-600');
            tabIslr.classList.add('border-transparent', 'text-gray-500');

            contentIva.classList.remove('hidden');
            contentIslr.classList.add('hidden');
            
            cargarRetencionesIva();
        } else {
            tabIslr.classList.add('active', 'border-blue-500', 'text-blue-600');
            tabIslr.classList.remove('border-transparent', 'text-gray-500');
            
            tabIva.classList.remove('active', 'border-blue-500', 'text-blue-600');
            tabIva.classList.add('border-transparent', 'text-gray-500');

            contentIslr.classList.remove('hidden');
            contentIva.classList.add('hidden');
            
            cargarRetencionesIslr();
        }
    }

    // Funciones de carga
    async function cargarRetencionesIva() {
        listaRetencionesIva.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Cargando...</td></tr>';
        
        try {
            const res = await fetch('/api/purchases/retenciones-iva', { headers });
            const data = await res.json();
            
            if (data.success) {
                renderizarTablaIva(data.data);
            } else {
                listaRetencionesIva.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-red-500">Error: ${data.error}</td></tr>`;
            }
        } catch (error) {
            console.error("Error loading IVA retentions:", error);
            listaRetencionesIva.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-red-500">Error de conexión</td></tr>`;
        }
    }

    async function cargarRetencionesIslr() {
        listaRetencionesIslr.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-gray-500"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Cargando...</td></tr>';
        
        try {
            const res = await fetch('/api/purchases/retenciones-islr', { headers });
            const data = await res.json();
            
            if (data.success) {
                renderizarTablaIslr(data.data);
            } else {
                listaRetencionesIslr.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red-500">Error: ${data.error}</td></tr>`;
            }
        } catch (error) {
            console.error("Error loading ISLR retentions:", error);
            listaRetencionesIslr.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red-500">Error de conexión</td></tr>`;
        }
    }

    function renderizarTablaIva(retenciones) {
        listaRetencionesIva.innerHTML = '';
        if (retenciones.length === 0) {
            listaRetencionesIva.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500 italic">No hay comprobantes de retención de IVA registrados.</td></tr>';
            return;
        }

        retenciones.forEach(ret => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition-colors';
            
            const badgeClass = ret.estado === 'EMITIDO' ? 'badge-emitido' : 'badge-anulado';
            
            tr.innerHTML = `
                <td>${formatDate(ret.fecha_retencion)}</td>
                <td>
                    <div class="font-medium text-gray-800">${ret.proveedor_nombre}</div>
                    <div class="text-xs text-gray-500">${ret.proveedor_rif}</div>
                </td>
                <td>
                    <div class="text-gray-700">Fac: ${ret.numero_factura}</div>
                    <div class="text-xs text-gray-500">Ctrl: ${ret.numero_control}</div>
                </td>
                <td class="font-bold text-blue-600">${ret.numero_comprobante}</td>
                <td>${ret.porcentaje_retencion}%</td>
                <td class="text-right font-semibold text-gray-700">Bs. ${Number(ret.monto_retenido).toFixed(2)}</td>
                <td class="text-center">
                    <span class="badge ${badgeClass}">${ret.estado}</span>
                </td>
            `;
            listaRetencionesIva.appendChild(tr);
        });
    }

    function renderizarTablaIslr(retenciones) {
        listaRetencionesIslr.innerHTML = '';
        if (retenciones.length === 0) {
            listaRetencionesIslr.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-gray-500 italic">No hay comprobantes de retención de ISLR registrados.</td></tr>';
            return;
        }

        retenciones.forEach(ret => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 transition-colors';
            
            const badgeClass = ret.estado === 'EMITIDO' ? 'badge-emitido' : 'badge-anulado';
            
            tr.innerHTML = `
                <td>${formatDate(ret.fecha_retencion)}</td>
                <td>
                    <div class="font-medium text-gray-800">${ret.proveedor_nombre}</div>
                    <div class="text-xs text-gray-500">${ret.proveedor_rif}</div>
                </td>
                <td>
                    <div class="text-gray-700">Fac: ${ret.numero_factura}</div>
                    <div class="text-xs text-gray-500">Ctrl: ${ret.numero_control}</div>
                </td>
                <td class="font-bold text-blue-600">${ret.numero_comprobante}</td>
                <td>${ret.codigo_concepto}</td>
                <td>${ret.porcentaje_retencion}%</td>
                <td class="text-right font-semibold text-gray-700">Bs. ${Number(ret.monto_retenido).toFixed(2)}</td>
                <td class="text-center">
                    <span class="badge ${badgeClass}">${ret.estado}</span>
                </td>
            `;
            listaRetencionesIslr.appendChild(tr);
        });
    }

    function formatDate(dateString) {
        if (!dateString) return '';
        try {
            const d = new Date(dateString);
            return d.toLocaleDateString('es-VE', { year: 'numeric', month: '2-digit', day: '2-digit' });
        } catch {
            return dateString;
        }
    }

    // Inicializar cargando la primera pestaña
    cargarRetencionesIva();
});
