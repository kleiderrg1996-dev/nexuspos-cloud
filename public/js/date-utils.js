/**
 * Parsea una fecha YYYY-MM-DD sin el offset UTC.
 * new Date('2026-06-03') interpreta como medianoche UTC, que en Venezuela (UTC-4)
 * es June 2 a las 8PM. Esta función evita eso parseando el string directamente.
 */
function parseLocalDate(fechaStr) {
    if (!fechaStr) return '';
    const clean = fechaStr.split('T')[0];
    const parts = clean.split('-');
    if (parts.length !== 3) return fechaStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function parseLocalDateTime(fechaStr) {
    if (!fechaStr) return { date: '', time: '' };
    const parts = fechaStr.split(' ');
    const date = parseLocalDate(parts[0]);
    const time = parts[1] || '';
    return { date, time };
}
