// js/libros_fiscales.js
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
    const mesSelect = document.getElementById('mesSelect');
    const anioSelect = document.getElementById('anioSelect');
    
    // Setters por defecto (Mes actual, Año actual)
    const today = new Date();
    mesSelect.value = today.getMonth() + 1; // 0-indexed
    anioSelect.value = today.getFullYear();

    // Event Listeners
    document.getElementById('btnLibroCompras').addEventListener('click', () => generarLibro('compras'));
    document.getElementById('btnLibroVentas').addEventListener('click', () => generarLibro('ventas'));
    document.getElementById('btnLibroInventario').addEventListener('click', () => generarLibro('inventario'));
    document.getElementById('btnLibroInventarioPDF').addEventListener('click', () => descargarInventarioPDF());

    async function generarLibro(tipo) {
        const mes = mesSelect.value;
        const anio = parseInt(anioSelect.value);

        if (!anio || anio < 2000) {
            Swal.fire('Atención', 'Por favor, ingrese un año válido.', 'warning');
            return;
        }

        let endpoint = '';
        let fileName = '';
        
        if (tipo === 'compras') {
            endpoint = `/api/purchases/libro-compras?mes=${mes}&anio=${anio}`;
            fileName = `Libro_Compras_SENIAT_${mes}_${anio}.xlsx`;
        } else if (tipo === 'ventas') {
            endpoint = `/api/sales/libro-ventas?mes=${mes}&anio=${anio}`;
            fileName = `Libro_Ventas_SENIAT_${mes}_${anio}.xlsx`;
        } else if (tipo === 'inventario') {
            endpoint = `/api/kardex/libro-inventario?mes=${mes}&anio=${anio}`;
            fileName = `Libro_Inventario_Art177_${mes}_${anio}.xlsx`;
        }

        try {
            Swal.fire({
                title: 'Generando Libro...',
                text: 'Consultando datos del período y construyendo el archivo Excel.',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            const res = await fetch(endpoint, { headers });
            const data = await res.json();

            if (res.ok && data.success) {
                if (data.data.length === 0) {
                    Swal.fire('Información', 'No hay movimientos registrados para el período seleccionado.', 'info');
                    return;
                }
                
                exportarExcel(data.data, tipo, fileName, `${mes}_${anio}`);
                
                Swal.close();
            } else {
                Swal.fire('Error', data.error || 'Error al generar el reporte', 'error');
            }

        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Hubo un error de conexión con el servidor.', 'error');
        }
    }

    function exportarExcel(data, tipo, fileName, periodoStr) {
        // En Excel, a veces es útil tener los headers formateados
        // SheetJS (XLSX) permite usar json_to_sheet
        
        let ws;

        if (tipo === 'compras') {
            const formattedData = data.map((row, index) => ({
                'N° Operación': index + 1,
                'Fecha Factura': formatDate(row.fecha_factura),
                'RIF Proveedor': row.proveedor_rif,
                'Nombre Proveedor': row.proveedor_nombre,
                'N° Factura': row.numero_factura,
                'N° Control': row.numero_control,
                'Total Compras con IVA': row.total_compras_con_iva,
                'Compras Internas Exentas': row.compras_internas_no_gravadas,
                'Base Imponible (16%)': row.base_imponible_16,
                '% Alicuota': '16%',
                'Impuesto IVA': row.iva_16,
                'IVA Retenido': row.iva_retenido,
                'N° Comprobante Ret.': row.numero_comprobante || ''
            }));
            ws = XLSX.utils.json_to_sheet(formattedData);

        } else if (tipo === 'ventas') {
             const formattedData = data.map((row, index) => ({
                'N° Operación': index + 1,
                'Fecha Factura': formatDate(row.fecha_venta),
                'C.I. o R.I.F.': row.cliente_cedula_rif,
                'Nombre o Razón Social Cliente': row.cliente_nombre,
                'N° Factura': row.numero_factura,
                'N° Control': row.numero_control,
                'Total Ventas con IVA': row.total_ventas_con_iva,
                'Ventas Internas Exentas': row.ventas_internas_no_gravadas,
                'Base Imponible (16%)': row.base_imponible_16,
                '% Alicuota': '16%',
                'Impuesto IVA': row.iva_16,
                'Estado': row.estado_pago === 'ANULADO' ? 'ANULADA' : 'EMITIDA'
            }));
            ws = XLSX.utils.json_to_sheet(formattedData);
            
        } else if (tipo === 'inventario') {
            const formattedData = data.map((row) => ({
                'Código Producto': row.codigo,
                'Descripción': row.descripcion,
                'Unidad de Medida': row.unidad_medida,
                'Inv. Inicial (Unds)': row.inventario_inicial,
                'Entradas (Unds)': row.entradas,
                'Salidas (Unds)': row.salidas,
                'Inv. Final (Unds)': row.inventario_final,
                'Costo Unitario (VES)': row.costo_unitario,
                'Valor Total (VES)': (row.inventario_final * row.costo_unitario).toFixed(2)
            }));
            ws = XLSX.utils.json_to_sheet(formattedData);
        }

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Libro_${periodoStr}`);
        
        // Disparar descarga
        XLSX.writeFile(wb, fileName);
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        // Simplificado, asumiendo formato ISO desde DB (ej: 2026-03-22 10:00:00)
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('es-VE'); // DD/MM/YYYY
        } catch {
            return dateStr.substring(0, 10);
        }
    }

    async function descargarInventarioPDF() {
        const mes = document.getElementById('mesSelect').value;
        const anio = document.getElementById('anioSelect').value;

        Swal.fire({
            title: 'Generando PDF SENIAT...',
            text: 'Esto puede tardar unos segundos...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        try {
            const url = `/api/kardex/libro-inventario-pdf?mes=${mes}&anio=${anio}`;
            const response = await fetch(url, { headers });
            
            if (response.ok) {
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                
                // Abrir en ventana nueva para vista previa
                window.open(downloadUrl, '_blank');
                
                Swal.close();
            } else {
                throw new Error('Error al generar el PDF');
            }
        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'No se pudo generar el reporte PDF', 'error');
        }
    }

});
