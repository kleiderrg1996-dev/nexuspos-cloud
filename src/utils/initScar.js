// src/utils/initScar.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataBasePath } = require('./settings');

const uploadsBasePath = path.join(getDataBasePath(), 'uploads');
const scarDir = path.join(uploadsBasePath, '.sys');  // camuflado
const scarFile = path.join(scarDir, 'init.dat');

function ensureScarFile() {
  try {
    // Asegurar carpetas
    if (!fs.existsSync(uploadsBasePath)) {
      fs.mkdirSync(uploadsBasePath, { recursive: true });
    }
    if (!fs.existsSync(scarDir)) {
      fs.mkdirSync(scarDir, { recursive: true });
    }

    // Si no existe el archivo, lo creamos
    if (!fs.existsSync(scarFile)) {
      const data = {
        installedAt: new Date().toISOString(),
        token: crypto.randomUUID()
      };
      fs.writeFileSync(scarFile, JSON.stringify(data), 'utf8');
      console.log('init.dat creado en:', scarFile);
    } else {
      console.log('init.dat ya existe en:', scarFile);
    }
  } catch (err) {
    console.error('Error creando/verificando init.dat:', err);
  }
}

function readScarInfo() {
  try {
    if (!fs.existsSync(scarFile)) {
      return null;
    }
    const raw = fs.readFileSync(scarFile, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error leyendo init.dat:', err);
    return null;
  }
}

module.exports = {
  ensureScarFile,
  readScarInfo,
  scarFile
};
