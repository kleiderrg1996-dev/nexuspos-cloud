const { db } = require('../src/database');

const getAllSuppliersStmt = (search = '') => {
    const term = `%${search}%`;
    return db.prepare(`
        SELECT * FROM proveedores 
        WHERE activo = 1 
          AND (nombre LIKE ? OR rif LIKE ? OR contacto LIKE ?)
        ORDER BY nombre ASC
    `).all(term, term, term);
};

const getSupplierByIdStmt = db.prepare('SELECT * FROM proveedores WHERE id = ?');
const createSupplierStmt = db.prepare(`
    INSERT INTO proveedores (nombre, rif, telefono, direccion, contacto)
    VALUES (@nombre, @rif, @telefono, @direccion, @contacto)
`);
const updateSupplierStmt = db.prepare(`
    UPDATE proveedores
    SET nombre = @nombre, rif = @rif, telefono = @telefono, direccion = @direccion, contacto = @contacto
    WHERE id = @id
`);
const softDeleteSupplierStmt = db.prepare('UPDATE proveedores SET activo = 0 WHERE id = ?');

const getSuppliers = (req, res) => {
    try {
        const { search } = req.query;
        const suppliers = getAllSuppliersStmt(search || '');
        res.json(suppliers);
    } catch (error) {
        console.error('Error getting suppliers:', error);
        res.status(500).json({ error: 'Error interno obteniendo proveedores' });
    }
};

const getSupplierById = (req, res) => {
    try {
        const supplier = getSupplierByIdStmt.get(req.params.id);
        if (!supplier) return res.status(404).json({ error: 'Proveedor no encontrado' });
        res.json(supplier);
    } catch (error) {
        console.error('Error getting supplier by id:', error);
        res.status(500).json({ error: 'Error interno obteniendo proveedor' });
    }
};

const createSupplier = (req, res) => {
    const { nombre, rif, telefono, direccion, contacto } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    try {
        const info = createSupplierStmt.run({ nombre, rif, telefono, direccion, contacto });
        res.status(201).json({ id: info.lastInsertRowid, message: 'Proveedor creado con éxito' });
    } catch (error) {
        console.error('Error creating supplier:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'El RIF ya está registrado' });
        }
        res.status(500).json({ error: 'Error interno creando proveedor' });
    }
};

const updateSupplier = (req, res) => {
    const { id } = req.params;
    const { nombre, rif, telefono, direccion, contacto } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });

    try {
        updateSupplierStmt.run({ id, nombre, rif, telefono, direccion, contacto });
        res.json({ message: 'Proveedor actualizado con éxito' });
    } catch (error) {
        console.error('Error updating supplier:', error);
        res.status(500).json({ error: 'Error interno actualizando proveedor' });
    }
};

const deleteSupplier = (req, res) => {
    try {
        softDeleteSupplierStmt.run(req.params.id);
        res.json({ message: 'Proveedor eliminado con éxito' });
    } catch (error) {
        console.error('Error deleting supplier:', error);
        res.status(500).json({ error: 'Error interno eliminando proveedor' });
    }
};

const getSupplierPurchases = (req, res) => {
    try {
        const { id } = req.params;
        const purchases = db.prepare(`
            SELECT id, numero_factura, fecha, total_compra, moneda, estado
            FROM compras
            WHERE proveedor_id = ?
            ORDER BY fecha DESC
        `).all(id);
        res.json(purchases);
    } catch (error) {
        console.error('Error getting supplier purchases:', error);
        res.status(500).json({ error: 'Error obteniendo historial de compras' });
    }
};

const getSupplierStatement = (req, res) => {
    try {
        const { id } = req.params;
        const movements = db.prepare(`
            SELECT 'COMPRA' as tipo, id, numero_factura as referencia, fecha, total_compra as monto, moneda, estado
            FROM compras
            WHERE proveedor_id = ?
            ORDER BY fecha DESC
        `).all(id);
        res.json(movements);
    } catch (error) {
        console.error('Error getting supplier statement:', error);
        res.status(500).json({ error: 'Error obteniendo estado de cuenta' });
    }
};

module.exports = {
    getSuppliers,
    getSupplierById,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    getSupplierPurchases,
    getSupplierStatement
};
