// routes/client.routes.js
const express = require('express');
const router = express.Router();
const clientController = require('../controllers/client.controller');

// Middleware: solo ADMIN y MASTER pueden editar o eliminar clientes
function blockNonAdmin(req, res, next) {
  const rol = (req.userRol || '').toUpperCase();
  if (rol !== 'ADMIN' && rol !== 'MASTER') {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }
  next();
}

// Exportar clientes a CSV
router.get('/export', clientController.exportClients);

// Lista de clientes con resumen de deuda
router.get('/', clientController.getClients);

// Crear / actualizar / eliminar cliente
router.post('/', clientController.createClient);
router.put('/:id', blockNonAdmin, clientController.updateClient);
router.delete('/:id', blockNonAdmin, clientController.deleteClient);

// Historial de ventas por cliente
router.get('/:id/sales', clientController.getClientSales);

// Deudas pendientes (FIADO/ABONADO)
router.get('/:id/debts', clientController.getClientDebts);

// Estado de cuenta cronológico
router.get('/:id/statement', clientController.getClientAccountStatement);

// Registro de abonos
router.post('/payment', clientController.registerPayment);
router.post('/payment/bulk', clientController.bulkRegisterPayment);
router.post('/payment/:id/void', clientController.voidPayment);

module.exports = router;
