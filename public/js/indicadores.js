document.addEventListener('DOMContentLoaded', () => {

    const loadingMessage = document.getElementById('dashboard-loading');
    const dashboardContent = document.getElementById('dashboard-content');

    const statProfitVes = document.getElementById('stat-profit-ves');
    const statProfitUsd = document.getElementById('stat-profit-usd');
    const statTotalFiadoVes = document.getElementById('stat-total-fiado-ves');
    const statTotalFiadoUsd = document.getElementById('stat-total-fiado-usd');
    const statRevenueVes = document.getElementById('stat-revenue-ves');
    const statRevenueUsd = document.getElementById('stat-revenue-usd');
    const statRevenueVentas = document.getElementById('stat-revenue-ventas');
    const statRevenueAbonos = document.getElementById('stat-revenue-abonos');

    const statExpensesVes = document.getElementById('stat-expenses-ves');
    const statExpensesUsd = document.getElementById('stat-expenses-usd');
    const statNetProfitVes = document.getElementById('stat-net-profit-ves');
    const statNetProfitUsd = document.getElementById('stat-net-profit-usd');

    const topProductsList = document.getElementById('top-products-list');
    const lowStockList = document.getElementById('low-stock-list');
    const expirationAlertsList = document.getElementById('expiration-alerts-list');

    const statInvCostVes = document.getElementById('stat-inventory-cost-ves');
    const statInvCostUsd = document.getElementById('stat-inventory-cost-usd');
    const statInvSaleVes = document.getElementById('stat-inventory-sale-ves');
    const statInvSaleUsd = document.getElementById('stat-inventory-sale-usd');

    const dashStartDate = document.getElementById('dash-start-date');
    const dashEndDate = document.getElementById('dash-end-date');
    const btnRefreshDash = document.getElementById('btn-refresh-dash');

    function getThemeTextColor() {
        return document.body.classList.contains('dark-mode') ? '#f8fafc' : '#475569';
    }
    
    function getThemeGridColor() {
        return document.body.classList.contains('dark-mode') ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
    }

    // --- INSTANCIAS DE CHART.JS ---
    let chartSalesProfit = null;
    let chartTopProducts = null;
    let chartInventoryDist = null;
    let chartRevenueExpenses = null;
    let chartTopDebtors = null; 
    let chartCategoryValuation = null;
    let refreshInterval = null;
    const REFRESH_TIME = 60000; // 60 segundos

    Chart.defaults.color = getThemeTextColor(); 
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.weight = 'bold';

    const now = new Date();
    // toLocaleDateString('en-CA') devuelve YYYY-MM-DD en hora LOCAL, evitando desfases UTC
    const todayStr = now.toLocaleDateString('en-CA'); 
    dashStartDate.value = todayStr;
    dashEndDate.value = todayStr;

    let currentBcvRate = 1;
    let currentRates = { BCV: 1, PARALELO: 0, COP: 0, CALC_METHOD: 1 };

    function normalizeRates(rates) {
        const out = { BCV: 0, PARALELO: 0, COP: 0, CALC_METHOD: 1 };
        if (!rates || typeof rates !== 'object') return out;
        out.BCV = parseFloat(rates.BCV) || 0;
        out.PARALELO = parseFloat(rates.PARALELO) || 0;
        out.COP = parseFloat(rates.COP) || 0;
        out.CALC_METHOD = parseInt(rates.CALC_METHOD, 10) || 1;
        return out;
    }

    function calculateInternalCostVes(product, rates) {
        const r = rates || currentRates;
        const moneda = (product.moneda_costo || '').toUpperCase();
        const costo = parseFloat(product.costo) || 0;
        if (!costo || costo < 0) return 0;
        switch (moneda) {
            case 'VES': return costo;
            case 'BCV': return costo * (r.BCV || 0);
            case 'PARALELO': return costo * (r.PARALELO || 0);
            case 'COP': return costo * (r.COP || 0);
            default: return 0;
        }
    }

    function calculateSalePriceVes(product, rates) {
        const r = rates || currentRates;
        const costInVes = calculateInternalCostVes(product, r);
        const percentage = (parseFloat(product.porcentaje_ganancia) || 0) / 100;
        if (costInVes <= 0) return 0;
        const calcMethod = r.CALC_METHOD || 1;
        return calcMethod === 2 ? costInVes / (1 - percentage) : costInVes * (1 + percentage);
    }

    function computeRealizedSummary(sales) {
        return (sales || []).reduce((acc, sale) => {
            const totalVes = Number(sale.total_ves) || 0;
            const costoVes = Number(sale.total_costo_ves) || 0;
            const pagosTotales = (Number(sale.total_pagos_ves) || 0) + (Number(sale.total_abonos_ves) || 0);
            const pagadoVes = Math.max(0, pagosTotales);
            
            if (sale.estado_pago === 'ANULADO') return acc;
            
            let gananciaOp = 0;
            let gananciaCamb = 0;
            if (pagadoVes > totalVes) {
                gananciaCamb = pagadoVes - totalVes;
                gananciaOp = totalVes - costoVes;
            } else {
                gananciaOp = Math.max(0, pagadoVes - costoVes);
            }

            acc.totalIngresos += pagadoVes;
            acc.totalCosto += pagadoVes <= costoVes ? pagadoVes : costoVes;
            acc.totalGanancia += (gananciaOp + gananciaCamb);
            acc.totalGananciaOp += gananciaOp;
            acc.totalGananciaCamb += gananciaCamb;
            acc.totalFiado += Math.max(0, totalVes - pagadoVes);
            return acc;
        }, { totalIngresos: 0, totalCosto: 0, totalGanancia: 0, totalGananciaOp: 0, totalGananciaCamb: 0, totalFiado: 0 });
    }

    // ✅ Estado de Licencia en header (mismo que en Configuracion)
    async function loadDashboardLicenseStatus() {
        const container = document.getElementById('dashboard-license-status');
        const textEl = document.getElementById('dashboard-license-text');
        if (!container || !textEl) return;

        try {
            const res = await fetch('/api/license/info');
            if (res.ok) {
                const data = await res.json();
                textEl.textContent = data.message || 'Estado desconocido';
                let colorClass = 'text-red-500 dark:text-red-400';
                if (data.status === 'LICENSED') {
                    colorClass = 'text-green-600 dark:text-green-400';
                } else if (data.status === 'TRIAL') {
                    colorClass = 'text-yellow-600 dark:text-yellow-400';
                }
                container.className = `mt-1 text-[9px] font-black uppercase tracking-widest ${colorClass}`;
                container.classList.remove('hidden');

                // ✅ Notificación visual 3 días antes de expirar
                checkLicenseExpirationAlert(data);
            }
        } catch (e) {
            console.warn('No se pudo cargar el estado de licencia en el dashboard:', e.message);
        }
    }

    // ✅ Verifica si la licencia está próxima a expirar y muestra una notificación visual (3 días antes)
    function checkLicenseExpirationAlert(data) {
        // Solo aplica para licencias activas con fecha de expiración
        if (data.status !== 'LICENSED' || !data.expDate) return;

        // Licencias vitalicias (2099-12-31) no expiran
        if (data.expDate === '2099-12-31' || data.isLifetime) return;

        // Parsear fecha de expiración (formato YYYY-MM-DD) sin usar new Date() para evitar UTC shift
        const [year, month, day] = data.expDate.split('-').map(Number);
        if (!year || !month || !day) return;

        // Calcular diferencia en días usando fecha local
        const expDate = new Date(year, month - 1, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        expDate.setHours(0, 0, 0, 0);

        const diffMs = expDate - today;
        const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        // Mostrar alerta si faltan 3 días o menos (y aún no ha expirado)
        if (daysLeft <= 3 && daysLeft >= 0) {
            showLicenseAlert(daysLeft, data.message);
        }
    }

    function showLicenseAlert(daysLeft, message) {
        // Evitar mostrar la alerta múltiples veces en la misma sesión
        const alertKey = 'license_alert_shown_' + new Date().toDateString();
        if (sessionStorage.getItem(alertKey)) return;
        sessionStorage.setItem(alertKey, '1');

        let alertText;
        if (daysLeft === 0) {
            alertText = '⚠️ ¡Tu licencia expira HOY! Renuévala para evitar interrupciones.';
        } else if (daysLeft === 1) {
            alertText = '⚠️ ¡Tu licencia expira MAÑANA! Renuévala pronto.';
        } else {
            alertText = `⚠️ ¡Tu licencia expira en ${daysLeft} días! Renuévala antes del vencimiento.`;
        }

        // Usar el toast del sistema nexusAI si está disponible
        if (window.nexusAIInstance && typeof window.nexusAIInstance.showToast === 'function') {
            window.nexusAIInstance.showToast(alertText);
        } else {
            // Fallback: crear un toast propio
            showCustomLicenseToast(alertText);
        }
    }

    function showCustomLicenseToast(message) {
        // Toast de respaldo si nexusAI no está cargado
        if (document.getElementById('license-alert-toast')) return;

        const toast = document.createElement('div');
        toast.id = 'license-alert-toast';
        toast.className = 'fixed top-20 right-4 z-[9999] bg-red-50 border-l-4 border-red-500 text-red-800 px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 transition-all duration-300 max-w-md';
        toast.style.transform = 'translateX(120%)';
        toast.innerHTML = `
            <i class="fas fa-exclamation-triangle text-red-500 text-xl"></i>
            <div class="flex-1 text-sm font-bold">${message}</div>
            <span class="cursor-pointer text-red-500 hover:text-red-700 text-xl font-bold leading-none" onclick="this.parentElement.remove()">&times;</span>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.transform = 'translateX(0)';
        }, 100);

        // Auto cerrar después de 12 segundos
        setTimeout(() => {
            toast.style.transform = 'translateX(120%)';
            setTimeout(() => toast.remove(), 300);
        }, 12000);
    }

    async function loadAllStats(showOverlay = true) {
        if (showOverlay) {
            if (loadingMessage) loadingMessage.classList.remove('hidden');
            if (dashboardContent) dashboardContent.classList.add('hidden');
        }

        const liveIndicator = document.getElementById('live-indicator');
        if (liveIndicator) liveIndicator.style.opacity = '1';

        try {
            const startDate = dashStartDate.value;
            const endDate = dashEndDate.value;
            const [ratesRes, dashboardRes, topProductsRes, allProductsRes, salesRangeRes, clientsRes] = await Promise.all([
                fetch('/api/settings/rates'),
                fetch('/api/reports/dashboard-stats'),
                fetch('/api/reports/top-products'),
                fetch('/api/products?limit=99999&page=1'),
                fetch(`/api/reports/range?startDate=${startDate}&endDate=${endDate}`),
                fetch('/api/clients?search=')
            ]);

            const ratesRaw = await ratesRes.json();
            const dashboardStats = await dashboardRes.json();
            const topProducts = await topProductsRes.json();
            const allProductsData = await allProductsRes.json();
            const salesRangeData = await salesRangeRes.json();
            const clients = await clientsRes.json();

            currentRates = normalizeRates(ratesRaw);
            currentBcvRate = (currentRates.PARALELO && currentRates.PARALELO > 0) ? currentRates.PARALELO : (currentRates.BCV || 1);

            const sales = salesRangeData.detailedSales || [];
            const realizedSummary = computeRealizedSummary(sales);
            const totalFiadoGlobalVes = (clients || []).reduce((acc, c) => acc + (Number(c.deuda_total_ves) || 0), 0);
            // Usar deuda_total_usd directo de la API (respeta la tasa_referencia de cada venta)
            const totalFiadoGlobalUsd = (clients || []).reduce((acc, c) => acc + (Number(c.deuda_total_usd) || 0), 0);

            // Agrupar todas las tasas únicas de los clientes con deudas reales
            const allTasas = new Set();
            (clients || []).forEach(c => {
                if ((c.deuda_total_usd || 0) > 0.005 && Array.isArray(c.tasas_referencia)) {
                    c.tasas_referencia.forEach(t => {
                        if (t) allTasas.add(t.toUpperCase());
                    });
                }
            });

            let tasaLabel = 'MIXTA';
            if (allTasas.size === 0) {
                tasaLabel = 'N/A';
            } else if (allTasas.size === 1) {
                tasaLabel = Array.from(allTasas)[0];
            }

            renderDashboardStats(dashboardStats, realizedSummary, totalFiadoGlobalVes, totalFiadoGlobalUsd, sales, salesRangeData.historicalExpenses, salesRangeData.historicalWithdrawals, tasaLabel);
            renderTopProducts(topProducts);
            renderInventoryStats(allProductsData.products, currentRates);
            renderTopDebtorsChart(clients);

            if (showOverlay) {
                if (loadingMessage) loadingMessage.classList.add('hidden');
                if (dashboardContent) dashboardContent.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error dashboard:', error);
        } finally {
            // Pequeño delay visual para el indicador "En Vivo"
            setTimeout(() => {
                if (liveIndicator) liveIndicator.style.opacity = '0.5';
            }, 2000);
        }
    }

    function renderDashboardStats(dashboardStats, realized, fiadoVes, fiadoUsdReal, sales, historicalExpenses, historicalWithdrawals, tasaLabel = 'N/A') {
        const grossProfitVes = realized.totalGanancia || 0;
        if (statProfitVes) {
            statProfitVes.textContent = `${grossProfitVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
            let subtitleDiv = document.getElementById('dash-profit-breakdown');
            if (!subtitleDiv) {
                subtitleDiv = document.createElement('div');
                subtitleDiv.id = 'dash-profit-breakdown';
                subtitleDiv.className = 'text-xs text-blue-200 mt-1 font-normal opacity-90';
                statProfitVes.parentElement.appendChild(subtitleDiv);
            }
            if (realized.totalGananciaCamb > 0) {
                subtitleDiv.innerHTML = `Op: ${realized.totalGananciaOp.toLocaleString('es-VE', {minimumFractionDigits:2})} | Dif. Tasa: +${realized.totalGananciaCamb.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
            } else {
                subtitleDiv.innerHTML = '';
            }
        }
        if (statProfitUsd) statProfitUsd.textContent = `${(grossProfitVes/currentBcvRate).toLocaleString('en-US', {style:'currency', currency:'USD'})}`;

        const totalExpensesVes = Number(dashboardStats.total_gastos_hoy_ves || 0);
        // Usar el monto_usd REAL de la BD (respeta la tasa que se uso al registrar: BCV, PARALELO, etc.)
        const totalExpensesUsdReal = Number(dashboardStats.total_gastos_hoy_usd || 0);
        const totalExpensesUsd = totalExpensesUsdReal > 0 ? totalExpensesUsdReal : (totalExpensesVes / (currentBcvRate || 1));
        const netProfitVes = grossProfitVes - totalExpensesVes;

        if (statExpensesVes) statExpensesVes.textContent = `${totalExpensesVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        if (statExpensesUsd) statExpensesUsd.textContent = `${totalExpensesUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;

        if (statNetProfitVes) {
            statNetProfitVes.textContent = `${netProfitVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
            let netSubtitleDiv = document.getElementById('dash-netprofit-breakdown');
            if (!netSubtitleDiv) {
                netSubtitleDiv = document.createElement('div');
                netSubtitleDiv.id = 'dash-netprofit-breakdown';
                netSubtitleDiv.className = 'text-xs text-green-200 mt-1 font-normal opacity-90';
                statNetProfitVes.parentElement.appendChild(netSubtitleDiv);
            }
            if (realized.totalGananciaCamb > 0) {
                // Al gasto se lo restamos al margen operativo para la utilidad neta operativa
                const netOp = realized.totalGananciaOp - totalExpensesVes;
                netSubtitleDiv.innerHTML = `Op: ${netOp.toLocaleString('es-VE', {minimumFractionDigits:2})} | Dif. Tasa: +${realized.totalGananciaCamb.toLocaleString('es-VE', {minimumFractionDigits:2})}`;
            } else {
                netSubtitleDiv.innerHTML = '';
            }
        }
        if (statNetProfitUsd) statNetProfitUsd.textContent = `${(netProfitVes/currentBcvRate).toLocaleString('en-US', {style:'currency', currency:'USD'})}`;

        // Siempre convertir USD pendiente a Bs usando la tasa PREFERIDA vigente (PARALELO > BCV)
        const preferredRate = (currentRates.PARALELO && currentRates.PARALELO > 0)
            ? currentRates.PARALELO
            : (currentRates.BCV || 1);
        const preferredLabel = (currentRates.PARALELO && currentRates.PARALELO > 0) ? 'PARALELO' : 'BCV';

        const fiadoUsd = fiadoUsdReal || 0;
        // Recalcular Bs usando tasa preferida actual (igual que Cuentas por Cobrar)
        const fiadoVesCalculado = fiadoUsd * preferredRate;

        if (statTotalFiadoUsd) statTotalFiadoUsd.textContent = `${fiadoUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;
        // Mostrar Bs con la tasa preferida vigente
        if (statTotalFiadoVes) statTotalFiadoVes.textContent = `${fiadoVesCalculado.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs (tasa/${preferredLabel})`;

        const revenueTotalVes = dashboardStats.total_cobrado_ves || 0;
        const revenueTotalUsd = dashboardStats.total_cobrado_usd || 0;
        if (statRevenueVes) statRevenueVes.textContent = `${revenueTotalVes.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        if (statRevenueUsd) statRevenueUsd.textContent = `${revenueTotalUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;

        const revenueVentas = dashboardStats.total_ventas_hoy_ves || 0;
        const revenueVentasUsd = dashboardStats.total_ventas_hoy_usd || 0;
        const revenueAbonos = dashboardStats.total_abonos_hoy_ves || 0;
        const revenueAbonosUsd = dashboardStats.total_abonos_hoy_usd || 0;
        if (statRevenueVentas) statRevenueVentas.textContent = `${revenueVentas.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        const statRevenueVentasUsd = document.getElementById('stat-revenue-ventas-usd');
        if (statRevenueVentasUsd) statRevenueVentasUsd.textContent = `${revenueVentasUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;
        if (statRevenueAbonos) statRevenueAbonos.textContent = `${revenueAbonos.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs`;
        const statRevenueAbonosUsd = document.getElementById('stat-revenue-abonos-usd');
        if (statRevenueAbonosUsd) statRevenueAbonosUsd.textContent = `${revenueAbonosUsd.toLocaleString('en-US', {style:'currency', currency:'USD'})}`;

        // --- CALCULO DE VOLUMEN Y TICKET PROMEDIO ---
        const successfulSalesCount = sales.filter(s => s.estado_pago !== 'ANULADO').length;
        const avgTicket = successfulSalesCount > 0 ? (realized.totalIngresos / successfulSalesCount) : 0;

        const statSalesCount = document.getElementById('stat-sales-count');
        const statAvgTicket = document.getElementById('stat-avg-ticket');
        if (statSalesCount) statSalesCount.textContent = successfulSalesCount;
        if (statAvgTicket) statAvgTicket.textContent = `${avgTicket.toFixed(2)} Bs`;

        updateIntegratedFinancialChart(sales, historicalExpenses, historicalWithdrawals);
    }

    function updateIntegratedFinancialChart(sales, historicalExpenses, historicalWithdrawals) {
        const canvas = document.getElementById('chart-sales-profit');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (chartSalesProfit) chartSalesProfit.destroy();

        const dataMap = {};
        let totalV = 0, totalG = 0, totalEx = 0;

        // 1. Mapear Ventas y Ganancias
        sales.forEach(s => {
            const d = (s.creado_en || s.fecha || '').split('T')[0];
            if (!d) return;
            if (!dataMap[d]) dataMap[d] = { v: 0, g: 0, ex: 0 };
            const pagosTotales = (Number(s.total_pagos_ves) || 0) + (Number(s.total_abonos_ves) || 0);
            const pagado = Math.max(0, pagosTotales);
            if (s.estado_pago !== 'ANULADO') {
                dataMap[d].v += pagado;
                dataMap[d].g += Math.max(0, pagado - (Number(s.total_costo_ves) || 0));
                totalV += pagado;
                totalG += Math.max(0, pagado - (Number(s.total_costo_ves) || 0));
            }
        });

        // 2. Mapear Gastos y Retiros
        (historicalExpenses || []).forEach(g => {
            const d = g.fecha;
            if (!dataMap[d]) dataMap[d] = { v: 0, g: 0, ex: 0 };
            const m = Number(g.total_ves) || 0;
            dataMap[d].ex += m;
            totalEx += m;
        });
        (historicalWithdrawals || []).forEach(w => {
            const d = w.fecha;
            if (!dataMap[d]) dataMap[d] = { v: 0, g: 0, ex: 0 };
            const m = Number(w.total_ves) || 0;
            dataMap[d].ex += m;
            totalEx += m;
        });

        // Actualizar Leyendas
        const legendV = document.getElementById('legend-total-ventas');
        const legendG = document.getElementById('legend-total-ganancias');
        const legendEx = document.getElementById('legend-total-gastos-all');
        if (legendV) legendV.textContent = totalV.toLocaleString('es-VE', {minimumFractionDigits:2}) + ' Bs';
        if (legendG) legendG.textContent = totalG.toLocaleString('es-VE', {minimumFractionDigits:2}) + ' Bs';
        if (legendEx) legendEx.textContent = totalEx.toLocaleString('es-VE', {minimumFractionDigits:2}) + ' Bs';

        const labels = Object.keys(dataMap).sort();
        
        // Degradados
        const gradV = ctx.createLinearGradient(0, 0, 0, 400);
        gradV.addColorStop(0, 'rgba(59, 130, 246, 0.4)'); 
        gradV.addColorStop(1, 'rgba(59, 130, 246, 0)');

        const gradG = ctx.createLinearGradient(0, 0, 0, 400);
        gradG.addColorStop(0, 'rgba(34, 197, 94, 0.4)'); 
        gradG.addColorStop(1, 'rgba(34, 197, 94, 0)');

        const gradEx = ctx.createLinearGradient(0, 0, 0, 400);
        gradEx.addColorStop(0, 'rgba(239, 68, 68, 0.3)'); 
        gradEx.addColorStop(1, 'rgba(239, 68, 68, 0)');

        chartSalesProfit = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { 
                        label: 'Ventas', 
                        data: labels.map(l => dataMap[l].v), 
                        borderColor: '#3b82f6', 
                        backgroundColor: gradV, 
                        fill: true, 
                        tension: 0.4, 
                        borderWidth: 4,
                        pointRadius: 4,
                        pointBackgroundColor: '#3b82f6',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 8
                    },
                    { 
                        label: 'Ganancias', 
                        data: labels.map(l => dataMap[l].g), 
                        borderColor: '#22c55e', 
                        backgroundColor: gradG, 
                        fill: true, 
                        tension: 0.4, 
                        borderWidth: 3,
                        pointRadius: 4,
                        pointBackgroundColor: '#22c55e',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 8
                    },
                    { 
                        label: 'Gastos', 
                        data: labels.map(l => dataMap[l].ex), 
                        borderColor: '#ef4444', 
                        backgroundColor: gradEx, 
                        fill: true, 
                        tension: 0.4, 
                        borderWidth: 2,
                        pointRadius: 4,
                        pointBackgroundColor: '#ef4444',
                        pointBorderColor: '#fff',
                        pointBorderWidth: 2,
                        pointHoverRadius: 8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        padding: 12,
                        cornerRadius: 12,
                        titleFont: { size: 14, weight: 'bold' },
                        bodyFont: { size: 13 },
                        displayColors: true
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { 
                            color: getThemeTextColor(), 
                            font: { size: 10, weight: '900' },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 12
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: getThemeGridColor(), drawBorder: false },
                        ticks: { 
                            color: getThemeTextColor(), 
                            font: { size: 10 },
                            callback: function(value) {
                                if (value >= 1000) return (value/1000) + 'k';
                                return value;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderTopProducts(products) {
        if (!topProductsList) return;
        topProductsList.innerHTML = '';
        (products || []).slice(0, 5).forEach((p, i) => {
            const li = document.createElement('li');
            li.className = "flex items-center gap-4 p-2";
            li.innerHTML = `<div class="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 font-black text-xs">${i+1}</div><div class="flex-1 min-w-0"><p class="text-sm font-bold text-gray-800 dark:text-gray-200 truncate uppercase">${p.nombre}</p><p class="text-[10px] font-black text-gray-500 uppercase">${p.total_sold} UNIDADES</p></div>`;
            topProductsList.appendChild(li);
        });
        updateTopChart(products);
    }

    function updateTopChart(products) {
        const ctx = document.getElementById('chart-top-products');
        if (!ctx) return;
        const list = (products || []).slice(0, 5);
        if (chartTopProducts) chartTopProducts.destroy();
        
        const canvas = ctx.getContext('2d');
        const grad = canvas.createLinearGradient(0, 0, 300, 0);
        grad.addColorStop(0, '#00d4ff');
        grad.addColorStop(1, '#39ff14');

        chartTopProducts = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: list.map(p => p.nombre.substring(0, 10)),
                datasets: [{ 
                    data: list.map(p => p.total_sold), 
                    backgroundColor: grad, 
                    borderRadius: 10,
                    barThickness: 16
                }]
            },
            options: { 
                indexAxis: 'y', 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { display: false } },
                scales: { x: { display: false }, y: { grid: { display: false }, ticks: { color: getThemeTextColor(), font: { size: 10, weight: '900' } } } }
            }
        });
    }

    function renderInventoryStats(products, rates) {
        let costVes = 0, saleVes = 0;
        let lowStock = [];
        let expirationAlerts = [];
        
        const today = new Date();
        today.setHours(0,0,0,0);

        const categoryData = {};
        
        (products || []).forEach(p => {
            const s = Number(p.stock) || 0;
            const min = parseFloat(p.stock_minimo) || 5;
            const cost = calculateInternalCostVes(p, rates);
            const sale = calculateSalePriceVes(p, rates);
            const cat = (p.categoria || 'GENERAL').toUpperCase();

            // Lógica de vencimiento
            if (p.fecha_vencimiento) {
                const expDate = new Date(p.fecha_vencimiento + 'T00:00:00');
                const diffTime = expDate - today;
                const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                
                if (daysLeft <= 15) {
                    expirationAlerts.push({ ...p, daysLeft });
                }
            }

            if (s > 0) {
                costVes += cost * s;
                saleVes += sale * s;

                if (!categoryData[cat]) categoryData[cat] = 0;
                categoryData[cat] += cost * s;
            }

            if (s <= min) {
                lowStock.push(p);
            }
        });

        renderExpirationAlerts(expirationAlerts);
        
        const bcv = currentBcvRate || 1;
        if (statInvCostVes) statInvCostVes.textContent = `${costVes.toFixed(2)} Bs`;
        if (statInvCostUsd) statInvCostUsd.textContent = `${(costVes/bcv).toFixed(2)} $`;
        if (statInvSaleVes) statInvSaleVes.textContent = `${saleVes.toFixed(2)} Bs`;
        if (statInvSaleUsd) statInvSaleUsd.textContent = `${(saleVes/bcv).toFixed(2)} $`;

        if (lowStockList) {
            lowStockList.innerHTML = '';
            
            if (lowStock.length === 0) {
                 lowStockList.innerHTML = `
                    <div class="flex flex-col items-center justify-center p-6 text-center h-[200px] animate-fade-in opacity-80">
                        <div class="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mb-4 ring-4 ring-green-500/5">
                            <i class="fa-solid fa-check text-3xl text-green-500"></i>
                        </div>
                        <p class="text-sm font-black text-gray-800 dark:text-gray-200 uppercase tracking-widest">Stock Saludable</p>
                        <p class="text-[10px] text-gray-500 uppercase mt-1">Inventario en niveles óptimos</p>
                    </div>
                `;
            } else {
                // Ordenar: primero los agotados, luego los de menor stock
                lowStock.sort((a,b) => (Number(a.stock)||0) - (Number(b.stock)||0));

                lowStock.slice(0, 8).forEach(p => {
                    const s = Number(p.stock) || 0;
                    const isZero = s <= 0;
                    const colorClass = isZero ? 'red' : 'orange';
                    const label = isZero ? 'AGOTADO' : `${s} DISPONIBLES`;
                    
                    const li = document.createElement('li');
                    li.className = "flex items-center gap-3 p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all cursor-default group";
                    li.innerHTML = `
                        <div class="w-1.5 h-10 bg-${colorClass}-500 rounded-full shadow-lg shadow-${colorClass}-500/40 group-hover:scale-y-110 transition-transform"></div>
                        <div class="flex-1 min-w-0">
                            <p class="text-[11px] sm:text-xs font-bold text-gray-800 dark:text-gray-200 truncate uppercase" title="${p.nombre}">${p.nombre}</p>
                            <div class="flex items-center gap-2 mt-1">
                                <span class="px-2 py-0.5 rounded text-[9px] font-black bg-${colorClass}-500/10 text-${colorClass}-500 uppercase tracking-widest border border-${colorClass}-500/20">
                                    ${label}
                                </span>
                            </div>
                        </div>
                        <div class="w-8 h-8 rounded-full bg-${colorClass}-500/10 flex items-center justify-center text-${colorClass}-500">
                            <i class="fa-solid ${isZero ? 'fa-triangle-exclamation animate-pulse' : 'fa-box-open'} text-xs"></i>
                        </div>
                    `;
                    lowStockList.appendChild(li);
                });
                
                // Si hay más de 8 productos en alerta, mostrar mensaje
                if (lowStock.length > 8) {
                    const li = document.createElement('li');
                    li.className = "text-center pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100 dark:border-white/5";
                    li.textContent = `+ ${lowStock.length - 8} productos más en alerta`;
                    lowStockList.appendChild(li);
                }
            }
        }
        renderExpirationAlerts(expirationAlerts);
        updateInvChart(costVes, saleVes);
        renderCategoryValuationChart(categoryData);
    }

    function renderTopDebtorsChart(clients) {
        const canvas = document.getElementById('chart-top-debtors');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (chartTopDebtors) chartTopDebtors.destroy();

        // Filtrar y ordenar top 5 deudores
        const top5 = (clients || [])
            .filter(c => (Number(c.deuda_total_ves) || 0) > 0)
            .sort((a, b) => (Number(b.deuda_total_ves) || 0) - (Number(a.deuda_total_ves) || 0))
            .slice(0, 5);

        if (top5.length === 0) {
            // Mostrar mensaje de "Sin Deudas" si no hay datos
            return;
        }

        const labels = top5.map(c => (c.nombre || 'Anonimo').split(' ')[0]);
        const data = top5.map(c => Number(c.deuda_total_ves) || 0);

        const grad = ctx.createLinearGradient(0, 0, 400, 0);
        grad.addColorStop(0, 'rgba(239, 68, 68, 0.8)');
        grad.addColorStop(1, 'rgba(239, 68, 68, 0.2)');

        chartTopDebtors = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Deuda (Bs)',
                    data,
                    backgroundColor: grad,
                    borderRadius: 8,
                    borderWidth: 0,
                    barThickness: 20
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        padding: 10,
                        bodyFont: { size: 12, weight: 'bold' },
                        callbacks: {
                            label: function(item) {
                                const ves = item.raw;
                                const usd = currentBcvRate > 0 ? ves / currentBcvRate : 0;
                                return ` Deuda: ${ves.toLocaleString('es-VE')} Bs (${usd.toFixed(2)} $)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { display: false },
                        ticks: { color: getThemeTextColor(), font: { size: 9 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: getThemeTextColor(), font: { size: 10, weight: 'bold' } }
                    }
                }
            }
        });
    }

    function renderCategoryValuationChart(categoryData) {
        const ctx = document.getElementById('chart-category-valuation');
        if (!ctx) return;
        if (chartCategoryValuation) chartCategoryValuation.destroy();

        const sortedKeys = Object.keys(categoryData).sort((a, b) => categoryData[b] - categoryData[a]).slice(0, 5);
        if (sortedKeys.length === 0) return;

        const labels = sortedKeys;
        const data = sortedKeys.map(k => categoryData[k]);
        
        const colors = [
            '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444'
        ];

        chartCategoryValuation = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: colors,
                    borderWidth: 2,
                    borderColor: document.body.classList.contains('dark-mode') ? '#0f172a' : '#fff',
                    hoverOffset: 15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            boxWidth: 8,
                            usePointStyle: true,
                            pointStyle: 'circle',
                            font: { size: 9, weight: 'bold' },
                            color: getThemeTextColor(),
                            padding: 10
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(item) {
                                const ves = item.raw;
                                const usd = currentBcvRate > 0 ? ves / currentBcvRate : 0;
                                return ` ${item.label}: ${ves.toLocaleString('es-VE')} Bs (${usd.toFixed(2)} $)`;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderExpirationAlerts(expirations) {
        if (!expirationAlertsList) return;
        expirationAlertsList.innerHTML = '';

        if (expirations.length === 0) {
            expirationAlertsList.innerHTML = `
                <div class="flex flex-col items-center justify-center p-6 text-center h-[200px] animate-fade-in opacity-80">
                    <div class="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4 ring-4 ring-blue-500/5">
                        <i class="fa-solid fa-calendar-check text-3xl text-blue-500"></i>
                    </div>
                    <p class="text-sm font-black text-gray-800 dark:text-gray-200 uppercase tracking-widest">Sin Vencimientos</p>
                    <p class="text-[10px] text-gray-500 uppercase mt-1">No hay productos próximos a vencer</p>
                </div>
            `;
            return;
        }

        expirations.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 8).forEach(p => {
            const isExpired = p.daysLeft <= 0;
            const colorClass = isExpired ? 'red' : 'orange';
            const label = isExpired ? 'VENCIDO' : `VENCE EN ${p.daysLeft}D`;
            
            const li = document.createElement('li');
            li.className = "flex items-center gap-3 p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-all cursor-default group";
            li.innerHTML = `
                <div class="w-1.5 h-10 bg-${colorClass}-600 rounded-full shadow-lg shadow-${colorClass}-600/40 group-hover:scale-y-110 transition-transform"></div>
                <div class="flex-1 min-w-0">
                    <p class="text-[11px] sm:text-xs font-bold text-gray-800 dark:text-gray-200 truncate uppercase" title="${p.nombre}">${p.nombre}</p>
                    <div class="flex items-center gap-2 mt-1">
                        <span class="px-2 py-0.5 rounded text-[9px] font-black bg-${colorClass}-600/10 text-${colorClass}-600 uppercase tracking-widest border border-${colorClass}-600/20">
                            ${label}
                        </span>
                        <span class="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">STOCK: ${p.stock}</span>
                    </div>
                </div>
                <div class="w-8 h-8 rounded-full bg-${colorClass}-600/10 flex items-center justify-center text-${colorClass}-600">
                    <i class="fa-solid ${isExpired ? 'fa-calendar-xmark animate-pulse' : 'fa-clock'} text-xs"></i>
                </div>
            `;
            expirationAlertsList.appendChild(li);
        });

        if (expirations.length > 8) {
            const li = document.createElement('li');
            li.className = "text-center pt-2 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-t border-gray-100 dark:border-white/5";
            li.textContent = `+ ${expirations.length - 8} productos más próximos a vencer`;
            expirationAlertsList.appendChild(li);
        }
    }

    function updateInvChart(cost, sale) {
        const ctx = document.getElementById('chart-inventory-dist');
        if (!ctx) return;
        if (chartInventoryDist) chartInventoryDist.destroy();
        
        const canvas = ctx.getContext('2d');
        const grad1 = canvas.createLinearGradient(0, 0, 0, 200);
        grad1.addColorStop(0, '#00d4ff'); // Electric Blue
        grad1.addColorStop(1, '#0088ff');

        const grad2 = canvas.createLinearGradient(0, 0, 0, 200);
        grad2.addColorStop(0, '#39ff14'); // Acid Green
        grad2.addColorStop(1, '#10b981');

        chartInventoryDist = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Inversión', 'Venta'],
                datasets: [{ 
                    data: [cost, sale], 
                    backgroundColor: [grad1, grad2], 
                    borderWidth: 2,
                    borderColor: document.body.classList.contains('dark-mode') ? '#0f172a' : '#f8fafc',
                    borderRadius: 6,
                    spacing: 6,
                    hoverOffset: 20
                }]
            },
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '68%', 
                plugins: { 
                    legend: { 
                        position: 'bottom', 
                        labels: { 
                            font: { size: 14, weight: '900' },
                            color: getThemeTextColor(),
                            padding: 25,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        } 
                    } 
                } 
            }
        });
    }

    function startClock() {
        const el = document.getElementById('digital-clock');
        if (!el) return;
        setInterval(() => {
            el.textContent = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).toUpperCase();
        }, 1000);
    }

    function setupAutoRefresh() {
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(() => {
            loadAllStats(false); // Refresco silencioso
        }, REFRESH_TIME);
    }

    if (btnRefreshDash) {
        btnRefreshDash.addEventListener('click', () => {
            loadAllStats(true); // Refresco manual con overlay
            setupAutoRefresh(); // Reiniciar contador
        });
    }

    window.addEventListener('theme-changed', () => {
        loadAllStats(false); // Refrescar gráficos con el nuevo color del tema
    });

    startClock();
    loadAllStats();
    setupAutoRefresh();
    loadDashboardLicenseStatus(); // ✅ Estado de licencia en header

    // ✅ Re-verificar la licencia cada 30 min para detectar expiración en tiempo real
    setInterval(() => loadDashboardLicenseStatus(), 1000 * 60 * 30);
});
