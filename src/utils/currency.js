/**
 * Módulo de Tasas de Cambio (Offline)
 * Almacena las tasas en memoria mientras el servidor esté activo.
 * El usuario las actualizará manualmente.
 */

// Valores iniciales por defecto (para que la app no inicie en cero)
// Tasa de 1 COP a VES (Bolívares)
let currentRates = {
  BCV: 226.13,
  PARALELO: 315.09,
  COP: 0.0817 
};

/**
 * Obtiene las tasas de cambio guardadas actualmente.
 * @returns {Object} Un objeto con las tasas BCV, PARALELO, y COP.
 */
const getRates = () => {
  console.log("Devolviendo tasas guardadas:", currentRates);
  return currentRates;
};

/**
 * Actualiza las tasas de cambio en memoria.
 * @param {Object} newRates - Objeto con las nuevas tasas (ej: { BCV: 37.00, ... })
 */
const updateRates = (newRates) => {
  // Usamos parseFloat para asegurar que guardamos números
  const bcv = parseFloat(newRates.BCV);
  const paralelo = parseFloat(newRates.PARALELO);
  const cop = parseFloat(newRates.COP);

  // Actualizamos solo si los valores son números válidos
  if (!isNaN(bcv)) currentRates.BCV = bcv;
  if (!isNaN(paralelo)) currentRates.PARALELO = paralelo;
  if (!isNaN(cop)) currentRates.COP = cop;
  
  console.log("Tasas actualizadas a:", currentRates);
  return currentRates;
};

// Exportamos las funciones
module.exports = {
  getRates,
  updateRates
};