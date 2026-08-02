const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { getDataBasePath } = require('./utils/settings');

function runAutoMigration() {
    try {
        console.log('--- NEXUSPOS: Verificando integridad de base de datos ---');

        // 1. Usar la misma ruta que database.js
        const dataDir = getDataBasePath();
        const targetDB = path.join(dataDir, 'mi-tienda.db');
        // Asegurar que el directorio exista
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        console.log(`Base de datos objetivo: ${targetDB}`);
        const db = new Database(targetDB);

        // 2. Verificar/Crear tabla compras
        db.prepare(`
            CREATE TABLE IF NOT EXISTS compras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                proveedor_id INTEGER NOT NULL,
                usuario_id INTEGER,
                numero_factura TEXT NOT NULL,
                numero_control TEXT NOT NULL,
                total_exento REAL DEFAULT 0,
                base_imponible_16 REAL DEFAULT 0,
                iva_16 REAL DEFAULT 0,
                base_imponible_8 REAL DEFAULT 0,
                iva_8 REAL DEFAULT 0,
                base_imponible_31 REAL DEFAULT 0,
                iva_31 REAL DEFAULT 0,
                total_compra REAL NOT NULL,
                moneda TEXT DEFAULT 'USD',
                tasa_bcv REAL DEFAULT 1,
                estado TEXT DEFAULT 'REGISTRADA',
                fecha DATETIME DEFAULT (datetime('now', 'localtime')),
                creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
            )
        `).run();

        // Migración compras: Renombrar fecha_compra -> fecha si es necesario
        const comprasInfo = db.prepare("PRAGMA table_info(compras)").all();
        const hasFecha = comprasInfo.some(col => col.name === 'fecha');
        const hasFechaCompra = comprasInfo.some(col => col.name === 'fecha_compra');
        if (!hasFecha && hasFechaCompra) {
            console.log('MIGRACION: Renombrando columna fecha_compra -> fecha en compras...');
            db.prepare("ALTER TABLE compras RENAME COLUMN fecha_compra TO fecha").run();
        }
        if (!comprasInfo.some(col => col.name === 'estado')) {
            db.prepare("ALTER TABLE compras ADD COLUMN estado TEXT DEFAULT 'REGISTRADA'").run();
        }
        if (!comprasInfo.some(col => col.name === 'monto_pendiente_ves')) {
            db.prepare("ALTER TABLE compras ADD COLUMN monto_pendiente_ves REAL DEFAULT 0").run();
        }
        if (!comprasInfo.some(col => col.name === 'monto_pendiente_usd')) {
            db.prepare("ALTER TABLE compras ADD COLUMN monto_pendiente_usd REAL DEFAULT 0").run();
        }

        // 3. Verificar/Crear tabla compras_detalle
        db.prepare(`
            CREATE TABLE IF NOT EXISTS compras_detalle (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                compra_id INTEGER NOT NULL,
                producto_id INTEGER NOT NULL,
                cantidad REAL NOT NULL,
                costo_unitario REAL NOT NULL,
                total_linea REAL NOT NULL,
                FOREIGN KEY (compra_id) REFERENCES compras(id),
                FOREIGN KEY (producto_id) REFERENCES productos(id)
            )
        `).run();

        // 3.1 Verificar/Crear tabla kardex (Asegurar que compras pueda registrar inventario)
        db.prepare(`
            CREATE TABLE IF NOT EXISTS kardex (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                producto_id INTEGER NOT NULL,
                tipo TEXT NOT NULL DEFAULT 'ENTRADA',
                cantidad REAL NOT NULL,
                motivo TEXT NOT NULL,
                referencia_id INTEGER,
                stock_anterior REAL NOT NULL,
                stock_nuevo REAL NOT NULL,
                fecha DATETIME DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (producto_id) REFERENCES productos(id)
            )
        `).run();

        // Migración compras_detalle: Asegurar columnas críticas

        const detailInfo = db.prepare("PRAGMA table_info(compras_detalle)").all();
        if (!detailInfo.some(col => col.name === 'costo_unitario')) {
            db.prepare("ALTER TABLE compras_detalle ADD COLUMN costo_unitario REAL DEFAULT 0").run();
        }
        if (!detailInfo.some(col => col.name === 'total_linea')) {
            db.prepare("ALTER TABLE compras_detalle ADD COLUMN total_linea REAL DEFAULT 0").run();
        }

        // 3.2 Tabla de abonos a compras
        db.prepare(`
            CREATE TABLE IF NOT EXISTS compras_abonos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                compra_id INTEGER NOT NULL,
                monto_ves REAL NOT NULL DEFAULT 0,
                monto_usd REAL NOT NULL DEFAULT 0,
                tasa_bcv_momento REAL DEFAULT 1,
                metodo TEXT NOT NULL,
                referencia TEXT,
                usuario_id INTEGER,
                fecha DATETIME DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (compra_id) REFERENCES compras(id)
            )
        `).run();

        // 4. Verificar columna referencia en venta_pagos (Retrocompatibilidad)
        const tableInfo = db.prepare("PRAGMA table_info(venta_pagos)").all();
        const hasReferencia = tableInfo.some(col => col.name === 'referencia');

        if (!hasReferencia) {
            console.log('🛠️ MIGRACION: Agregando columna "referencia" a "venta_pagos"...');
            db.prepare("ALTER TABLE venta_pagos ADD COLUMN referencia TEXT").run();
        }

        // 5. Reparar gastos PENDIENTES con monto_pendiente_ves en 0
        const gastosPendientes = db.prepare(`
            SELECT id, monto_ves, monto_pendiente_ves FROM gastos WHERE estado_pago = 'PENDIENTE' AND (monto_pendiente_ves = 0 OR monto_pendiente_ves IS NULL)
        `).all();
        for (const g of gastosPendientes) {
            db.prepare('UPDATE gastos SET monto_pendiente_ves = ? WHERE id = ?').run(g.monto_ves, g.id);
        }
        if (gastosPendientes.length > 0) {
            console.log(`🛠️ MIGRACION: Reparados ${gastosPendientes.length} gastos pendientes con saldo en 0.`);
        }

        // 6. Agregar columna tasa_tipo a gastos si no existe
        const gastosInfo = db.prepare("PRAGMA table_info(gastos)").all();
        if (!gastosInfo.some(col => col.name === 'tasa_tipo')) {
            db.prepare("ALTER TABLE gastos ADD COLUMN tasa_tipo TEXT DEFAULT 'BCV'").run();
        }

        // 7. Migración: Agregar rol MASTER y CONSULTOR a la tabla usuarios
        const usuariosInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='usuarios'").get();
        if (usuariosInfo && (!usuariosInfo.sql.includes("'CONSULTOR'") || !usuariosInfo.sql.includes("'MASTER'"))) {
            console.log('🛠️ MIGRACION: Agregando roles MASTER y CONSULTOR a tabla usuarios...');
            
            // Eliminar tabla temporal residual si existe
            try { db.exec('DROP TABLE IF EXISTS usuarios_temp'); } catch(e) {}
            
            // Crear tabla temporal con el nuevo constraint
            db.exec(`
                CREATE TABLE usuarios_temp (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    nombre TEXT,
                    rol TEXT NOT NULL CHECK(rol IN ('ADMIN', 'CAJERO', 'VISOR', 'VENDEDOR', 'MASTER', 'CONSULTOR')),
                    activo INTEGER NOT NULL DEFAULT 1,
                    creado_en DATETIME DEFAULT (datetime('now', 'localtime')),
                    current_session_token TEXT,
                    last_active_at DATETIME
                );
            `);

            // Copiar datos existentes
            db.exec(`
                INSERT INTO usuarios_temp (id, username, password_hash, nombre, rol, activo, creado_en, current_session_token, last_active_at)
                SELECT id, username, password_hash, nombre, rol, activo, creado_en, current_session_token, last_active_at
                FROM usuarios;
            `);

            // Eliminar tabla antigua y renombrar
            db.exec('DROP TABLE usuarios;');
            db.exec('ALTER TABLE usuarios_temp RENAME TO usuarios;');
            
            console.log('✅ Roles MASTER y CONSULTOR agregados exitosamente.');
        }

        // 8. Crear usuario master si no existe
        const crypto = require('crypto');
        const HASH_SECRET = 'nexuspos-super-secreto-para-passwords-2024!';
        
        const masterUser = db.prepare('SELECT id FROM usuarios WHERE username = ?').get('master');
        if (!masterUser) {
            console.log('🛠️ MIGRACION: Creando usuario master...');
            const passwordHash = crypto.createHmac('sha256', HASH_SECRET).update('nexus2026').digest('hex');
            db.prepare(`
                INSERT INTO usuarios (username, password_hash, nombre, rol) 
                VALUES (?, ?, ?, ?)
            `).run('master', passwordHash, 'Administrador Master', 'MASTER');
            console.log('✅ Usuario master creado exitosamente.');
        }

        console.log('✅ Integridad de base de datos verificada y actualizada.');
        db.close();
    } catch (error) {
        console.error('❌ Error en Reparador Automático:', error.message);
    }
}

// Ejecutar automáticamente al ser requerido
runAutoMigration();


