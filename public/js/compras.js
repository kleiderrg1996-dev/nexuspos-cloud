// js/compras.js
document.addEventListener('DOMContentLoaded', () => {
    
    // Variables de Estado
    let compraItems = [];
    let proveedores = [];
    let productosDisponibles = [];
    let choicesProveedor = null;
    let tasaBCVOriginal = 36.50;
    let tasaParaleloOriginal = 36.50;
    let currentTasaBCV = 36.50;
    let tasaActiva = 'BCV';
    let monedaActual = 'VES';

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
    const proveedorSelect = document.getElementById('proveedorSelect');
    const monedaFactura = document.getElementById('monedaFactura');
    const buscarProducto = document.getElementById('buscarProducto');
    const listaItemsCompras = document.getElementById('listaItemsCompras');
    const filaVacia = document.getElementById('filaVacia');
    
    // Summary Elements
    const lblExento = document.getElementById('lblExento');
    const lblBase16 = document.getElementById('lblBase16');
    const lblIva16 = document.getElementById('lblIva16');
    const lblTotalFactura = document.getElementById('lblTotalFactura');
    const lblMonedaResumen = document.getElementById('lblMonedaResumen');
    const lblTasaBCV = document.getElementById('lblTasaBCV');

    // Retenciones Elements
    const chkRetenerIva = document.getElementById('chkRetenerIva');
    const divRetencionIva = document.getElementById('divRetencionIva');
    const porcentajeRetIva = document.getElementById('porcentajeRetIva');
    const montoRetIva = document.getElementById('montoRetIva');

    // Inicializar
    initApp();

    async function initApp() {
        if (lblTasaBCV) lblTasaBCV.textContent = currentTasaBCV.toFixed(2);
        
        await cargarConfiguracion();
        await cargarProveedores();
        await cargarProductosDisponibles();
        
        setupEventListeners();
    }

    async function cargarConfiguracion() {
        try {
            const res = await fetch('/api/settings/rates', { headers });
            const data = await res.json();
            
            if (data && data.BCV) {
                const bcv = parseFloat(data.BCV);
                if (bcv > 0) tasaBCVOriginal = bcv;
            }
            if (data && data.PARALELO) {
                const paralelo = parseFloat(data.PARALELO);
                if (paralelo > 0) tasaParaleloOriginal = paralelo;
            }
            currentTasaBCV = tasaActiva === 'BCV' ? tasaBCVOriginal : tasaParaleloOriginal;
            if (lblTasaBCV) lblTasaBCV.textContent = currentTasaBCV.toFixed(2);
            console.log(`[Compras] BCV: ${tasaBCVOriginal} | Paralelo: ${tasaParaleloOriginal}`);
        } catch (error) {
            console.error("Error cargando configuración:", error);
        }
    }

    async function cargarProveedores() {
        try {
            const res = await fetch('/api/suppliers', { headers });
            const data = await res.json();

            // /api/suppliers devuelve un array directo
            if (Array.isArray(data)) {
                proveedores = data;
            } else if (data.success && Array.isArray(data.data)) {
                proveedores = data.data;
            } else {
                proveedores = [];
            }

            const options = proveedores.map(p => ({
                value: p.id,
                label: `${p.nombre}${p.rif ? ' (' + p.rif + ')' : ''}`
            }));

            // Inicializar Choices.js para un buscador bonito
            choicesProveedor = new Choices(proveedorSelect, {
                choices: options,
                searchEnabled: true,
                placeholder: true,
                placeholderValue: 'Buscar proveedor...',
                noResultsText: 'No se encontraron proveedores',
                itemSelectText: 'Presione para seleccionar'
            });

        } catch (error) {
            console.error('Error cargando proveedores:', error);
            Swal.fire('Error', 'No se pudieron cargar los proveedores.', 'error');
        }
    }

    async function cargarProductosDisponibles() {
        try {
            // /api/products retorna { products:[...], totalProducts, totalPages, currentPage }
            const res = await fetch('/api/products?limit=5000&page=1', { headers });
            const data = await res.json();

            if (data.products && Array.isArray(data.products)) {
                productosDisponibles = data.products;
            } else if (Array.isArray(data)) {
                productosDisponibles = data;
            } else if (data.data && Array.isArray(data.data)) {
                productosDisponibles = data.data;
            } else {
                productosDisponibles = [];
            }

            console.log(`[Compras] ${productosDisponibles.length} productos cargados.`);
        } catch (error) {
            console.error("Error cargando productos:", error);
        }
    }

    function setupEventListeners() {
        // Buscador de productos — sugerencias en tiempo real
        buscarProducto.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            if (query.length < 2) {
                cerrarSugerencias();
                return;
            }
            mostrarSugerencias(query);
        });

        buscarProducto.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = buscarProducto.value.trim();
                cerrarSugerencias();
                if (query) buscarYAgregarProducto(query);
            }
        });

        buscarProducto.addEventListener('blur', () => {
            // Pequeño delay para permitir click en sugerencia
            setTimeout(cerrarSugerencias, 200);
        });

        // Cambio de moneda
        monedaFactura.addEventListener('change', (e) => {
            const viejaMoneda = monedaActual;
            monedaActual = e.target.value;
            lblMonedaResumen.textContent = monedaActual;

            // Preguntar si desea convertir los precios actuales
            if (compraItems.length > 0) {
                Swal.fire({
                    title: '¿Convertir precios?',
                    text: `Ha cambiado la moneda a ${monedaActual}. ¿Desea convertir los costos unitarios actuales usando la tasa BCV (${currentTasaBCV})?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, convertir',
                    cancelButtonText: 'No, mantener valores'
                }).then((result) => {
                    if (result.isConfirmed) {
                        compraItems.forEach(item => {
                            if (monedaActual === 'VES' && viejaMoneda === 'USD') {
                                item.costo_unitario = item.costo_unitario * currentTasaBCV;
                            } else if (monedaActual === 'USD' && viejaMoneda === 'VES') {
                                item.costo_unitario = item.costo_unitario / currentTasaBCV;
                            }
                        });
                        renderizarTabla();
                    } else {
                        recalcularTotales();
                    }
                });
            } else {
                recalcularTotales();
            }
        });

        // Ocultar/Mostrar Retenciones
        chkRetenerIva.addEventListener('change', (e) => {
            divRetencionIva.classList.toggle('hidden', !e.target.checked);
            recalcularTotales();
        });
        porcentajeRetIva.addEventListener('change', recalcularTotales);

        // Toggle Contado / Crédito
        document.getElementById('btnPagoContado').addEventListener('click', () => setTipoPago('CONTADO'));
        document.getElementById('btnPagoCredito').addEventListener('click', () => setTipoPago('CREDITO'));

        // Procesar Compra
        document.getElementById('btnProcesarCompra').addEventListener('click', procesarCompra);
    }

    function setTipoPago(tipo) {
        document.getElementById('tipoPago').value = tipo;
        const btnContado = document.getElementById('btnPagoContado');
        const btnCredito = document.getElementById('btnPagoCredito');
        const lblInfo = document.getElementById('lblInfoCredito');

        if (tipo === 'CONTADO') {
            btnContado.className = 'flex-1 py-3 rounded-lg text-sm font-bold transition-all bg-blue-600 text-white shadow-md shadow-blue-500/20';
            btnCredito.className = 'flex-1 py-3 rounded-lg text-sm font-bold transition-all bg-gray-100 text-gray-500 hover:bg-gray-200';
            lblInfo.classList.add('hidden');
        } else {
            btnCredito.className = 'flex-1 py-3 rounded-lg text-sm font-bold transition-all bg-orange-500 text-white shadow-md shadow-orange-500/20';
            btnContado.className = 'flex-1 py-3 rounded-lg text-sm font-bold transition-all bg-gray-100 text-gray-500 hover:bg-gray-200';
            lblInfo.classList.remove('hidden');
        }
    }

    window.setTasaTipo = (tipo) => {
        tasaActiva = tipo;
        document.getElementById('tipoTasa').value = tipo;
        const btnBcv = document.getElementById('btnTasaBCV');
        const btnParalelo = document.getElementById('btnTasaParalelo');

        if (tipo === 'BCV') {
            btnBcv.className = 'px-3 py-1 rounded-md text-[10px] font-bold transition-all bg-blue-600 text-white shadow';
            btnParalelo.className = 'px-3 py-1 rounded-md text-[10px] font-bold transition-all text-gray-400 hover:text-gray-600';
            currentTasaBCV = tasaBCVOriginal;
        } else {
            btnParalelo.className = 'px-3 py-1 rounded-md text-[10px] font-bold transition-all bg-blue-600 text-white shadow';
            btnBcv.className = 'px-3 py-1 rounded-md text-[10px] font-bold transition-all text-gray-400 hover:text-gray-600';
            currentTasaBCV = tasaParaleloOriginal;
        }
        if (lblTasaBCV) lblTasaBCV.textContent = currentTasaBCV.toFixed(2);
        recalcularTotales();
    };

    // Crea o actualiza el dropdown de sugerencias
    function mostrarSugerencias(query) {
        const q = query.toLowerCase();
        const resultados = productosDisponibles.filter(p =>
            (p.nombre && p.nombre.toLowerCase().includes(q)) ||
            (p.barcode && p.barcode.toLowerCase().includes(q))
        ).slice(0, 10); // Máximo 10 sugerencias

        let dropdown = document.getElementById('compras-sugerencias');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'compras-sugerencias';
            dropdown.style.cssText = `
                position: absolute; z-index: 9999; background: white;
                border: 1px solid #d1d5db; border-radius: 6px;
                box-shadow: 0 8px 16px rgba(0,0,0,0.12);
                max-height: 280px; overflow-y: auto;
                min-width: 100%;
            `;
            buscarProducto.parentElement.style.position = 'relative';
            buscarProducto.parentElement.appendChild(dropdown);
        }

        if (resultados.length === 0) {
            dropdown.innerHTML = `<div style="padding:10px 14px; color:#6b7280; font-size:13px;">Sin resultados para "${query}"</div>`;
            dropdown.classList.remove('hidden');
            return;
        }

        dropdown.innerHTML = resultados.map(p => `
            <div class="sugerencia-item" data-id="${p.id}" style="
                padding: 9px 14px; cursor: pointer; font-size: 13px;
                border-bottom: 1px solid #f3f4f6; display:flex; justify-content:space-between; align-items:center;
            ">
                <span><strong>${p.nombre}</strong><br><span style="color:#6b7280;font-size:11px;">
                    ${p.barcode ? 'Cód: ' + p.barcode + ' · ' : ''}Stock: ${p.stock ?? 0}
                </span></span>
                <span style="color:#059669; font-weight:600; font-size:12px;">${parseFloat(p.costo||0).toFixed(2)} ${p.moneda_costo||''}</span>
            </div>
        `).join('');

        dropdown.querySelectorAll('.sugerencia-item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.background = '#f0f9ff');
            item.addEventListener('mouseleave', () => item.style.background = 'white');
            item.addEventListener('click', () => {
                const prod = productosDisponibles.find(p => p.id == item.dataset.id);
                if (prod) {
                    agregarItem(prod);
                    buscarProducto.value = '';
                    cerrarSugerencias();
                }
            });
        });

        dropdown.classList.remove('hidden');
    }

    function cerrarSugerencias() {
        const dropdown = document.getElementById('compras-sugerencias');
        if (dropdown) dropdown.remove();
    }


    function buscarYAgregarProducto(query) {
        query = query.trim().toLowerCase();
        if (!query) return;

        // Buscar exacta por código primero, luego por nombre
        let match = productosDisponibles.find(p => p.barcode === query);
        if (!match) {
            match = productosDisponibles.find(p => p.nombre.toLowerCase().includes(query));
        }

        if (match) {
            agregarItem(match);
            buscarProducto.value = '';
        } else {
            // Si hay muchos productos, tal vez buscar en Backend. Por ahora alertamos.
            Swal.fire({
                icon: 'warning',
                title: 'No encontrado',
                text: 'El producto no fue encontrado en la base de datos local.',
                timer: 2000,
                showConfirmButton: false
            });
        }
    }

    function agregarItem(producto) {
        // Verificar si ya existe para sumar cantidad
        const existe = compraItems.find(i => i.id === producto.id);
        if (existe) {
            existe.cantidad += 1;
        } else {
            // Lógica de conversión de moneda
            let costoConvertido = parseFloat(producto.costo || 0);
            const monedaProd = (producto.moneda_costo || 'USD').toUpperCase();

            // Solo convertimos si la factura es VES y el producto esta en USD
            if (monedaActual === 'VES' && (monedaProd === 'USD')) {
                costoConvertido = costoConvertido * currentTasaBCV;
                console.log(`[Conversión] ${producto.nombre}: ${producto.costo} USD -> ${costoConvertido.toFixed(2)} VES (Tasa: ${currentTasaBCV})`);
            }

            const alicuota = producto.exento_iva ? 'EXENTO' : '16%';
            
            compraItems.push({
                ...producto,
                cantidad: 1,
                costo_unitario: costoConvertido,
                alicuota: alicuota
            });
        }
        
        renderizarTabla();
    }

    function eliminarItem(index) {
        compraItems.splice(index, 1);
        renderizarTabla();
    }

    function renderizarTabla() {
        listaItemsCompras.innerHTML = '';
        
        if (compraItems.length === 0) {
            listaItemsCompras.appendChild(filaVacia);
            recalcularTotales();
            return;
        }

        compraItems.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-50 transition-colors";
            
            const totalLinea = item.cantidad * item.costo_unitario;

            tr.innerHTML = `
                <td class="font-medium text-gray-800">
                    ${item.nombre}
                    <div class="text-xs text-gray-400">Cod: ${item.barcode || item.id}</div>
                </td>
                <td>
                    <input type="number" min="0.01" step="0.01" value="${item.cantidad}" class="w-20 text-center evt-update p-1" data-index="${index}" data-field="cantidad">
                </td>
                <td>
                    <input type="number" min="0" step="0.01" value="${item.costo_unitario.toFixed(2)}" class="w-24 text-right evt-update p-1" data-index="${index}" data-field="costo_unitario">
                </td>
                <td>
                    <select class="evt-update p-1 w-full text-xs" data-index="${index}" data-field="alicuota">
                        <option value="EXENTO" ${item.alicuota === 'EXENTO' ? 'selected' : ''}>Exento (E)</option>
                        <option value="16%" ${item.alicuota === '16%' ? 'selected' : ''}>16%</option>
                        <option value="8%" ${item.alicuota === '8%' ? 'selected' : ''}>8% (Reducida)</option>
                    </select>
                </td>
                <td class="text-right font-semibold text-gray-700">
                    ${totalLinea.toFixed(2)}
                </td>
                <td class="text-center">
                    <button class="btn-danger btn-eliminar text-sm" data-index="${index}" title="Eliminar fila">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            listaItemsCompras.appendChild(tr);
        });

        // Eventos en los inputs dinámicos
        document.querySelectorAll('.evt-update').forEach(el => {
            el.addEventListener('change', (e) => {
                const index = e.target.getAttribute('data-index');
                const field = e.target.getAttribute('data-field');
                
                if (field === 'alicuota') {
                    compraItems[index][field] = e.target.value;
                } else {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0) {
                        compraItems[index][field] = val;
                    }
                }
                renderizarTabla(); // Re-render para actualizar totales
            });
        });

        document.querySelectorAll('.btn-eliminar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.currentTarget.getAttribute('data-index');
                eliminarItem(idx);
            });
        });

        recalcularTotales();
    }

    function recalcularTotales() {
        let exento = 0;
        let base16 = 0;
        let iva16 = 0;
        let base8 = 0;
        let iva8 = 0;

        compraItems.forEach(item => {
            const lineaTotal = item.cantidad * item.costo_unitario;
            
            if (item.alicuota === 'EXENTO') {
                exento += lineaTotal;
            } else if (item.alicuota === '16%') {
                base16 += lineaTotal;
                iva16 += (lineaTotal * 0.16);
            } else if (item.alicuota === '8%') {
                base8 += lineaTotal;
                iva8 += (lineaTotal * 0.08);
            }
        });

        const totalTotal = exento + base16 + iva16 + base8 + iva8;

        lblExento.textContent = exento.toFixed(2);
        lblBase16.textContent = base16.toFixed(2);
        lblIva16.textContent = iva16.toFixed(2);
        lblTotalFactura.textContent = totalTotal.toFixed(2);

        // Calcular Retención IVA si está activa
        if (chkRetenerIva.checked) {
            const factor = parseInt(porcentajeRetIva.value) / 100;
            const totalRetener = (iva16 + iva8) * factor; // Retenes el % configurado del IVA cobrado
            montoRetIva.value = totalRetener.toFixed(2);
        } else {
            montoRetIva.value = '0.00';
        }

        // Mostrar Conversión
        const divConversion = document.getElementById('divConversion');
        const lblConversion = document.getElementById('lblConversion');
        
        if (currentTasaBCV > 0 && totalTotal > 0) {
            divConversion.classList.remove('hidden');
            if (monedaActual === 'VES') {
                const totalUSD = totalTotal / currentTasaBCV;
                lblConversion.textContent = `${totalUSD.toFixed(2)} USD`;
            } else {
                const totalVES = totalTotal * currentTasaBCV;
                lblConversion.textContent = `${totalVES.toFixed(2)} VES`;
            }
        } else {
            divConversion.classList.add('hidden');
        }

        // Dejar objeto global preparado
        window.compraTotales = {
            total_exento: exento,
            base_imponible_16: base16,
            iva_16: iva16,
            base_imponible_8: base8,
            iva_8: iva8,
            total_compra: totalTotal
        };
    }

    async function procesarCompra() {
        const proveedorId = proveedorSelect.value;
        const nroFactura = document.getElementById('numeroFactura').value.trim();
        const nroControl = document.getElementById('numeroControl').value.trim();

        if (!proveedorId || !nroFactura || !nroControl) {
            Swal.fire('Atención', 'Debe completar el Proveedor, Número de Factura y de Control (Obligatorios SENIAT).', 'warning');
            return;
        }

        if (compraItems.length === 0) {
            Swal.fire('Atención', 'No hay productos en la lista de compra.', 'warning');
            return;
        }

        // Validaciones Retención
        let comprobanteIva = null;
        let montoReteIva = 0;
        let porcReteIva = 0;

        if (chkRetenerIva.checked) {
            comprobanteIva = document.getElementById('compRetIva').value.trim();
            montoReteIva = parseFloat(montoRetIva.value) || 0;
            porcReteIva = parseInt(porcentajeRetIva.value) || 75;

            if (!comprobanteIva) {
                Swal.fire('Atención', 'Si activa retención de IVA, debe ingresar el Número de Comprobante emitido.', 'warning');
                return;
            }
            if (montoReteIva <= 0) {
                 Swal.fire('Atención', 'El monto a retener calculado es 0. Verifique los productos agregados.', 'warning');
                 return;
            }
        }

        // Preparar Payload
        const tipoPago = document.getElementById('tipoPago').value || 'CONTADO';
        const tipoTasa = document.getElementById('tipoTasa').value || 'BCV';
        const payload = {
            proveedor_id: parseInt(proveedorId),
            numero_factura: nroFactura,
            numero_control: nroControl,
            moneda: monedaActual,
            tasa_bcv: currentTasaBCV,
            tasa_tipo: tipoTasa,
            tipo_pago: tipoPago,
            ...window.compraTotales,
            items: compraItems.map(i => ({
                producto_id: i.id,
                cantidad: i.cantidad,
                costo_unitario: i.costo_unitario,
                alicuota: i.alicuota
            })),
            // Data Retenciones
            comprobante_iva: comprobanteIva,
            monto_retenido_iva: montoReteIva,
            porcentaje_iva: porcReteIva
        };

        try {
            Swal.fire({
                title: 'Procesando Compra y Actualizando Kardex...',
                allowOutsideClick: false,
                didOpen: () => { Swal.showLoading(); }
            });

            const res = await fetch('/api/purchases', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            
            if (res.ok && data.success) {
                Swal.fire({
                    icon: 'success',
                    title: 'Compra Exitosa',
                    text: 'Se ha registrado la compra y actualizado el inventario correctamente.',
                    showCancelButton: true,
                    confirmButtonText: '<i class="fas fa-file-pdf"></i> Ver PDF',
                    cancelButtonText: 'Nueva Compra',
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#6e7881'
                }).then((result) => {
                    if (result.isConfirmed) {
                        window.open(`/api/reports/purchases/${data.compra_id}/pdf`, '_blank');
                        window.location.reload();
                    } else {
                        window.location.reload();
                    }
                });
            } else {

                console.error('Error al registrar compra:', data);
                let errorMsg = data.error || 'Error interno al registrar la compra.';
                if (data.details) {
                    errorMsg += `\n\nDetalles: ${data.details}`;
                }
                
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: errorMsg,
                    footer: data.stack ? '<pre style="text-align:left; font-size:10px; max-height:100px; overflow:auto">' + data.stack + '</pre>' : ''
                });
            }

        } catch (error) {
            console.error(error);
            Swal.fire('Error', 'Hubo un error de red al procesar la compra.', 'error');
        }
    }

});
