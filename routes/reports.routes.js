const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reports.controller');

// Resumen diario de ventas
router.get('/daily-close', reportsController.getDailyCloseReport);

// Reportes por rango
router.get('/range', reportsController.getReportByDateRange);
router.get('/range/pdf', reportsController.getReportByDateRangePDF);

// Abonos por rango
router.get('/payments-range', reportsController.getPaymentsByDateRange);

// Búsqueda Global
router.get('/search', reportsController.searchSales);

// Resumen de pagos del día (para Cierre Z)
router.get('/summary', reportsController.getTodayPaymentSummary);
router.post('/print-cierre-z', reportsController.printCierreZ);

// Anular venta
router.delete('/void/:saleId', reportsController.voidSale);

// Dashboard
router.get('/dashboard-stats', reportsController.getTodayDashboardStats);
router.get('/top-products', reportsController.getTopSellingProducts);

// Registrar retiro de caja (Bs / USD)
router.post('/cash-withdrawal', reportsController.registerCashWithdrawal);

// NUEVO: Registrar Avance de Efectivo
router.post('/cash-advance', reportsController.registerCashAdvance);

// 🔹 NUEVO: Apertura de caja (inicio de caja del día)
router.post('/cash-opening', reportsController.registerCashOpening);
router.get('/cash-opening/today', reportsController.getTodayCashOpening);

// NUEVO: imprimir inventario y fiados en PDF
router.get('/inventory-pdf', reportsController.printInventoryPdf);
router.get('/fiados-pdf', reportsController.printFiadosPdf);

// 🔹 NUEVO: Historial de cierres Z
router.get('/cierre-z/history', reportsController.getCierreZHistory);

// 🔹 NUEVO: Reimpresión / visualización de un cierre Z en PDF
router.get('/cierre-z/:id/pdf', reportsController.printCierreZById);

// 🔹 NUEVO: Estado de caja por usuario (Cuadre de Caja)
router.get('/cash-status', reportsController.getCashStatus);
router.get('/cash-status/pdf', reportsController.exportCashStatusPDF);
router.get('/cash-status/excel', reportsController.exportCashStatusExcel);

// Nuevos exports solicitados
router.get('/range/excel', reportsController.exportSalesReportExcel);
router.get('/cierre-z/history-excel', reportsController.exportZHistoryExcel);

// Reimpresión POS: facturas del día por usuario
router.get('/today-sales', reportsController.getTodaySalesByUser);

// 🔹 NUEVO: Reimpresión / visualización de una compra en PDF
router.get('/purchases/:id/pdf', reportsController.printPurchasePdf);

module.exports = router;
