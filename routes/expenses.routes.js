// routes/expenses.routes.js
const express = require('express');
const router = express.Router();
const expensesController = require('../controllers/expenses.controller');

// Categorías
router.get('/categories', expensesController.getCategories);
router.post('/categories', expensesController.createCategory);
router.delete('/categories/:id', expensesController.deleteCategory);

// Gastos
router.get('/', expensesController.getExpenses);
router.post('/', expensesController.createExpense);
router.put('/:id', expensesController.updateExpense);
router.delete('/:id', expensesController.deleteExpense);

// Cuentas por Pagar
router.get('/cuentas-por-pagar', expensesController.getCuentasPorPagar);

// Abonos
router.post('/abonos', expensesController.registerAbono);

module.exports = router;
