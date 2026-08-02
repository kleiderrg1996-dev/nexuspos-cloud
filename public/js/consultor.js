document.addEventListener('DOMContentLoaded', () => {
    const barcodeInput = document.getElementById('barcode-input');
    const welcomeView = document.getElementById('welcome-view');
    const productCard = document.getElementById('product-card');
    const loadingSpinner = document.getElementById('loading-spinner');
    const currentBcvRateEl = document.getElementById('current-bcv-rate');

    const productNameEl = document.getElementById('product-name');
    const productCategoryEl = document.getElementById('product-category');
    const productBarcodeEl = document.getElementById('product-barcode');
    const priceVesEl = document.getElementById('price-ves');
    const priceUsdEl = document.getElementById('price-usd');
    const productStockEl = document.getElementById('product-stock');
    const stockBadge = document.getElementById('stock-badge');
    const productImageContainer = document.getElementById('product-image-container');
    const productImage = document.getElementById('product-image');

    let currentRates = { BCV: 0 };
    let clearTimer = null;

    const toggleCameraBtn = document.getElementById('toggle-camera');
    const readerDiv = document.getElementById('reader');
    const scanIcon = document.getElementById('scan-icon');
    let html5QrCode = null;
    let isScanning = false;

    // Mantener el foco en el input para el escáner (compatible con input ahora visible)
    document.addEventListener('click', (e) => {
        // No quitar foco si el clic fue en un botón o en el propio input
        if (!isScanning && e.target !== barcodeInput && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SVG' && e.target.tagName !== 'PATH') {
            barcodeInput.focus();
        }
    });
    barcodeInput.focus();

    // ... (fetch tasas igual)

    toggleCameraBtn.addEventListener('click', () => {
        if (!isScanning) {
            startCamera();
        } else {
            stopCamera();
        }
    });

    async function startCamera() {
        try {
            isScanning = true;
            readerDiv.classList.remove('hidden');
            scanIcon.classList.add('hidden');
            toggleCameraBtn.innerHTML = `
                <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
                Detener Cámara
            `;
            toggleCameraBtn.classList.replace('bg-blue-600', 'bg-red-600');
            toggleCameraBtn.classList.replace('hover:bg-blue-700', 'hover:bg-red-700');

            html5QrCode = new Html5Qrcode("reader");
            const config = { fps: 10, qrbox: { width: 250, height: 250 } };

            await html5QrCode.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    // Éxito al escanear
                    consultProduct(decodedText);
                    // Opcional: Detener tras el primer escaneo exitoso para ahorrar batería/recursos
                    // stopCamera(); 
                },
                (errorMessage) => {
                    // Errores de escaneo (comunes mientras busca)
                }
            );
        } catch (err) {
            console.error("Error al iniciar cámara:", err);

            let errorMsg = "No se pudo acceder a la cámara. Asegúrese de dar permisos.";

            // Detectar específicamente contexto no seguro (HTTP en móvil)
            if (!window.isSecureContext) {
                errorMsg = "ACCESO BLOQUEADO POR NAVEGADOR: Los navegadores bloquean la cámara en conexiones HTTP (no seguras).\n\n" +
                    "SOLUCIÓN:\n" +
                    "1. En su móvil, abra Chrome y escriba: chrome://flags/#unsafely-treat-insecure-origin-as-secure\n" +
                    "2. Escriba la dirección de este servidor (" + window.location.origin + ") en el cuadro de texto.\n" +
                    "3. Cámbielo a 'Enabled' y reinicie Chrome.";
            }

            alert(errorMsg);
            stopCamera();
        }
    }

    async function stopCamera() {
        if (html5QrCode) {
            try {
                await html5QrCode.stop();
                await html5QrCode.clear();
            } catch (e) {
                console.warn("Error deteniendo cámara:", e);
            }
            html5QrCode = null;
        }
        isScanning = false;
        readerDiv.classList.add('hidden');
        scanIcon.classList.remove('hidden');
        toggleCameraBtn.innerHTML = `
            <svg class="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
            </svg>
            Usar Cámara
        `;
        toggleCameraBtn.classList.replace('bg-red-600', 'bg-blue-600');
        toggleCameraBtn.classList.replace('hover:bg-red-700', 'hover:bg-blue-700');
        barcodeInput.focus();
    }

    // Cargar tasas al iniciar
    fetch('/api/settings/rates')
        .then(res => res.json())
        .then(data => {
            currentRates.BCV = parseFloat(data.BCV) || 0;
            currentRates.PARALELO = parseFloat(data.PARALELO) || 0;
            currentRates.COP = parseFloat(data.COP) || 0;
            currentBcvRateEl.textContent = `${currentRates.BCV.toFixed(2)} Bs`;
        })
        .catch(err => console.error('Error cargando tasas:', err));

    barcodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const barcode = barcodeInput.value.trim();
            if (barcode) {
                consultProduct(barcode);
            }
            barcodeInput.value = '';
        }
    });

    let lastBarcode = "";
    let isProcessing = false;

    async function consultProduct(barcode) {
        if (isProcessing) return;

        // Si es el mismo código de antes y el card ya está visible, NO reiniciamos el cronómetro.
        // Esto permite que los 10 segundos pasen aunque el producto siga frente a la cámara.
        if (barcode === lastBarcode && !productCard.classList.contains('hidden')) {
            return;
        }

        isProcessing = true;
        lastBarcode = barcode;
        showLoading();
        if (clearTimer) clearTimeout(clearTimer);

        try {
            let productData = null;
            let presentationData = null;

            // 1. Intentar como presentación primero
            try {
                const presResponse = await fetch(`/api/presentations/barcode/${encodeURIComponent(barcode)}`);
                if (presResponse.ok) {
                    const data = await presResponse.json();
                    productData = data.producto;
                    presentationData = data;
                }
            } catch (e) {
                console.warn("No es una presentación:", e);
            }

            // 2. Si no fue presentación, intentar como producto normal
            if (!productData) {
                const prodResponse = await fetch(`/api/products/barcode/${encodeURIComponent(barcode)}`);
                if (prodResponse.ok) {
                    productData = await prodResponse.json();
                } else if (prodResponse.status === 404) {
                    throw new Error('Producto no encontrado');
                } else {
                    throw new Error('Error al consultar el producto');
                }
            }

            if (!productData) {
                throw new Error('Producto no encontrado');
            }

            renderProduct(productData, presentationData);
        } catch (error) {
            console.error(error);
            showError(error.message);
        } finally {
            // Cooldown de 2 segundos para evitar "spam" de escaneos
            setTimeout(() => {
                isProcessing = false;
            }, 2000);
        }
    }

    function renderProduct(product, presentation = null) {
        const bcv = currentRates.BCV || 0;

        // Si tenemos una presentación, usamos sus datos específicos
        if (presentation) {
            productNameEl.textContent = `${product.nombre} (${presentation.nombre})`;
            productBarcodeEl.textContent = presentation.barcode;
            priceVesEl.textContent = `${parseFloat(presentation.precio_ves || 0).toFixed(2)} Bs`;
            priceUsdEl.textContent = `${parseFloat(presentation.precio_usd_bcv || 0).toFixed(2)} $`;
        } else {
            // Lógica original para producto base
            let costVes = 0;
            const costo = parseFloat(product.costo) || 0;
            const moneda = product.moneda_costo;

            if (moneda === 'VES') costVes = costo;
            else if (moneda === 'BCV') costVes = costo * bcv;
            else if (moneda === 'PARALELO' && currentRates.PARALELO) costVes = costo * currentRates.PARALELO;
            else if (moneda === 'COP' && currentRates.COP) costVes = costo * currentRates.COP;

            const ganancia = (parseFloat(product.porcentaje_ganancia) || 0) / 100;
            const priceVes = costVes * (1 + ganancia);
            const priceUsd = bcv > 0 ? priceVes / bcv : 0;

            productNameEl.textContent = product.nombre;
            productBarcodeEl.textContent = product.barcode;
            priceVesEl.textContent = `${priceVes.toFixed(2)} Bs`;
            priceUsdEl.textContent = `${priceUsd.toFixed(2)} $`;
        }

        productCategoryEl.textContent = product.categoria || 'General';

        if (product.imagen) {
            productImage.src = product.imagen;
            productImageContainer.classList.remove('hidden');
        } else {
            productImageContainer.classList.add('hidden');
        }

        const stock = parseFloat(product.stock) || 0;
        productStockEl.textContent = `${stock} ${product.tipo_venta === 'PESO' ? 'Kg' : 'Unid'}`;
        const stockLabel = document.getElementById('stock-label');
        const stockDot = stockBadge.querySelector('span:first-child');

        if (stock <= 0) {
            stockBadge.className = 'flex items-center gap-2 px-3 py-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-500';
            if (stockDot) stockDot.className = 'w-1.5 h-1.5 rounded-full bg-red-500';
            if (stockLabel) stockLabel.textContent = 'Agotado';
        } else {
            stockBadge.className = 'flex items-center gap-2 px-3 py-1 rounded-full border border-green-500/40 bg-green-500/10 text-green-500';
            if (stockDot) stockDot.className = 'w-1.5 h-1.5 rounded-full bg-green-500';
            if (stockLabel) stockLabel.textContent = 'Disponible';
        }

        showCard();

        // Limpiar después de 10 segundos de inactividad
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(resetView, 10000);
    }

    function showLoading() {
        welcomeView.classList.add('hidden');
        productCard.classList.add('hidden');
        productCard.classList.add('opacity-0');
        productCard.classList.add('scale-95');
        loadingSpinner.classList.remove('hidden');
    }

    function showCard() {
        loadingSpinner.classList.add('hidden');
        productCard.classList.remove('hidden');
        setTimeout(() => {
            productCard.classList.remove('opacity-0');
            productCard.classList.remove('scale-95');
        }, 50);
    }

    function showError(message) {
        loadingSpinner.classList.add('hidden');
        // Podríamos mostrar un mensaje de error elegante aquí
        alert(message);
        resetView();
    }

    function resetView() {
        if (clearTimer) {
            clearTimeout(clearTimer);
            clearTimer = null;
        }
        lastBarcode = ""; // Resetear para permitir escanear el mismo producto después de limpiar
        productCard.classList.add('opacity-0');
        productCard.classList.add('scale-95');
        setTimeout(() => {
            productCard.classList.add('hidden');
            welcomeView.classList.remove('hidden');
        }, 300);
    }
});
