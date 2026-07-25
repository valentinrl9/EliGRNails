// =========================================
// 1. CONFIGURACIÓN DE BASE DE DATOS (V2)
// =========================================

//Constantes de Google para el calendario
// Restringe este Client ID en Google Cloud Console a los orígenes exactos de producción.
const CLIENT_ID = '674688988885-fmjjdoe5svfabqj1t619c940enn6gc3d.apps.googleusercontent.com';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

let tokenClient;
let gapiInited = false;
let gsiInited = false;

const db = new Dexie("SalonDB");

// Subimos a versión 3
db.version(3).stores({
    clientas: "++id, nombre, telefono, email, direccion, cp, localidad, observaciones, fechaNacimiento",
    servicios: "++id, nombre, coste",
    agenda: "++id, clienteId, servicioId, fecha",
    ventas: "++id, clienteId, servicioId, fecha, importe, metodoPago" 
}).upgrade(tx => {
    // Esta parte asegura que las clientas antiguas no den error al no tener el campo nuevo
    return tx.clientas.toCollection().modify({
        fechaNacimiento: ""
    });
});

// --- 🎨 CONFIGURACIÓN DE COLORES SWEETALERT2 PARA ELI-GR NAILS ---
const swalConfig = {
    background: '#1a1a1a', 
    color: '#d39e00', 
    confirmButtonColor: '#c48b00', 
    cancelButtonColor: '#444',
    customClass: {
        confirmButton: 'swal-gold-button'
    },
    didOpen: () => {
        const swalContainer = document.querySelector('.swal2-container');
        if (swalContainer) swalContainer.style.zIndex = '20000';
    }
};

// Opcional: Añadir un pequeño estilo CSS al vuelo para el botón dorado
const style = document.createElement('style');
style.innerHTML = `
  .swal2-styled.swal-gold-button {
    color: #fff !important; /* Texto blanco en el botón dorado para contraste */
    border: 1px solid #c48b00;
  }
`;
document.head.appendChild(style);
// ------------------------------------------------------------------

function escaparHTML(str) {
    if (!str) return "";
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, m => map[m]);
}

function normalizarNombre(texto) {
    return texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
}

function normalizarTelefono(telefono) {
    if (!telefono) return "";
    let t = String(telefono).replace(/[\s\-().]/g, "");
    if (t.startsWith("+34")) t = t.slice(3);
    else if (t.startsWith("0034")) t = t.slice(4);
    else if (t.startsWith("34") && t.length > 9) t = t.slice(2);
    return t;
}

function telefonosCoinciden(a, b) {
    const na = normalizarTelefono(a);
    const nb = normalizarTelefono(b);
    return na !== "" && nb !== "" && na === nb;
}

async function hashPin(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const PIN_STORAGE_KEY = 'eligr_pin_hash';
const PIN_SESSION_KEY = 'eligr_unlocked';

async function verificarBloqueoApp() {
    const hashGuardado = localStorage.getItem(PIN_STORAGE_KEY);
    const overlay = document.getElementById('overlayBloqueo');
    if (!overlay) return;

    // Sin PIN configurado: app libre (configura PIN con el botón de la llave)
    if (!hashGuardado || sessionStorage.getItem(PIN_SESSION_KEY) === '1') {
        overlay.style.display = 'none';
        return;
    }

    overlay.style.display = 'flex';
    const titulo = document.getElementById('tituloBloqueo');
    const btnPin = document.getElementById('btnConfirmarPin');
    const inputPin = document.getElementById('inputPinAcceso');
    const grupoConfirm = document.getElementById('grupoPinConfirmacion');

    if (titulo) titulo.textContent = 'Introduce tu PIN';
    if (grupoConfirm) grupoConfirm.style.display = 'none';
    if (inputPin) inputPin.value = '';

    const desbloquear = async () => {
        const pin = inputPin?.value?.trim() || '';
        if (!/^\d{4,6}$/.test(pin)) {
            Swal.fire({ ...swalConfig, icon: 'warning', title: 'PIN inválido', text: 'Usa entre 4 y 6 dígitos numéricos.' });
            return;
        }

        const hashIntroducido = await hashPin(pin);
        if (hashIntroducido !== hashGuardado) {
            Swal.fire({ ...swalConfig, icon: 'error', title: 'PIN incorrecto', text: 'Inténtalo de nuevo.' });
            if (inputPin) inputPin.value = '';
            return;
        }

        sessionStorage.setItem(PIN_SESSION_KEY, '1');
        overlay.style.display = 'none';
    };

    if (btnPin) btnPin.onclick = desbloquear;
    if (inputPin) {
        inputPin.onkeydown = (e) => { if (e.key === 'Enter') desbloquear(); };
    }
}

async function cambiarPinAcceso() {
    const hashGuardado = localStorage.getItem(PIN_STORAGE_KEY);

    if (!hashGuardado) {
        const { value: pinNuevo } = await Swal.fire({
            ...swalConfig,
            title: 'Configurar PIN (4-6 dígitos)',
            input: 'password',
            inputAttributes: { maxlength: 6, inputmode: 'numeric', autocomplete: 'off' },
            showCancelButton: true,
            confirmButtonText: 'Continuar',
            cancelButtonText: 'Cancelar'
        });
        if (!pinNuevo || !/^\d{4,6}$/.test(pinNuevo)) return;

        const { value: pinConfirm } = await Swal.fire({
            ...swalConfig,
            title: 'Repite el PIN',
            input: 'password',
            inputAttributes: { maxlength: 6, inputmode: 'numeric', autocomplete: 'off' },
            showCancelButton: true,
            confirmButtonText: 'Guardar PIN',
            cancelButtonText: 'Cancelar'
        });
        if (pinNuevo !== pinConfirm) {
            Swal.fire({ ...swalConfig, icon: 'error', title: 'Los PIN no coinciden' });
            return;
        }

        localStorage.setItem(PIN_STORAGE_KEY, await hashPin(pinNuevo));
        sessionStorage.setItem(PIN_SESSION_KEY, '1');
        Swal.fire({ ...swalConfig, icon: 'success', title: 'PIN configurado', text: 'Tu acceso quedará protegido al bloquear la app.', timer: 2500, showConfirmButton: false });
        return;
    }

    const { value: pinActual } = await Swal.fire({
        ...swalConfig,
        title: 'PIN actual',
        input: 'password',
        inputAttributes: { maxlength: 6, inputmode: 'numeric', autocomplete: 'off' },
        showCancelButton: true,
        confirmButtonText: 'Continuar',
        cancelButtonText: 'Cancelar'
    });
    if (!pinActual) return;

    if (await hashPin(pinActual) !== localStorage.getItem(PIN_STORAGE_KEY)) {
        Swal.fire({ ...swalConfig, icon: 'error', title: 'PIN incorrecto' });
        return;
    }

    const { value: pinNuevo } = await Swal.fire({
        ...swalConfig,
        title: 'Nuevo PIN (4-6 dígitos)',
        input: 'password',
        inputAttributes: { maxlength: 6, inputmode: 'numeric', autocomplete: 'off' },
        showCancelButton: true,
        confirmButtonText: 'Guardar',
        cancelButtonText: 'Cancelar'
    });
    if (!pinNuevo || !/^\d{4,6}$/.test(pinNuevo)) return;

    localStorage.setItem(PIN_STORAGE_KEY, await hashPin(pinNuevo));
    Swal.fire({ ...swalConfig, icon: 'success', title: 'PIN actualizado', timer: 1500, showConfirmButton: false });
}

function cerrarSesionApp() {
    sessionStorage.removeItem(PIN_SESSION_KEY);
    location.reload();
}

async function derivarClaveBackup(password, salt) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function cifrarBackup(jsonString, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derivarClaveBackup(password, salt);
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(jsonString)
    );
    return {
        encrypted: true,
        version: 1,
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        data: bufferToBase64(encrypted)
    };
}

async function descifrarBackup(contenido, password) {
    const salt = new Uint8Array(base64ToBuffer(contenido.salt));
    const iv = new Uint8Array(base64ToBuffer(contenido.iv));
    const key = await derivarClaveBackup(password, salt);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        base64ToBuffer(contenido.data)
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
}

function configurarRefrescoPestanas() {
    document.getElementById('tab-inicio')?.addEventListener('shown.bs.tab', () => {
        if (typeof cargarDashboard === 'function') cargarDashboard();
    });

    document.getElementById('tab-agenda')?.addEventListener('shown.bs.tab', () => {
        if (calendar) {
            calendar.updateSize();
            calendar.refetchEvents();
        }
    });

    document.getElementById('tab-clientes')?.addEventListener('shown.bs.tab', () => {
        if (typeof listarClientas === 'function') listarClientas();
    });

    document.getElementById('tab-servicios')?.addEventListener('shown.bs.tab', () => {
        if (typeof listarServicios === 'function') listarServicios();
    });

    document.getElementById('tab-ventas')?.addEventListener('shown.bs.tab', () => {
        if (typeof cargarHistorialVentas === 'function') cargarHistorialVentas();
    });
}

function configurarBotonesApp() {
    document.getElementById('btnExportarBackup')?.addEventListener('click', exportarBackup);
    document.getElementById('btnImportarBackup')?.addEventListener('click', dispararImportacionBackup);
    document.getElementById('btnCambiarPin')?.addEventListener('click', cambiarPinAcceso);
    document.getElementById('btnBloquearApp')?.addEventListener('click', cerrarSesionApp);
    document.getElementById('btnRestaurarOverlay')?.addEventListener('click', dispararImportacionBackup);
    document.getElementById('importFileNavbar')?.addEventListener('change', importarBackup);
    configurarOrdenClientas();
    configurarDashboardEventos();
    document.getElementById('btnConectarGoogle')?.addEventListener('click', manejarAuthClick);
}

let ordenClientas = { campo: 'nombre', asc: true };

function parseFechaNacimientoOrden(fecha) {
    if (!fecha || !String(fecha).includes('/')) return null;
    const partes = String(fecha).split('/');
    const dia = parseInt(partes[0], 10);
    const mes = parseInt(partes[1], 10);
    if (isNaN(dia) || isNaN(mes)) return null;
    return mes * 100 + dia;
}

function actualizarCabeceraOrdenClientas() {
    document.querySelectorAll('#cabeceraClientas .clientas-cabecera-btn').forEach(btn => {
        const activo = btn.dataset.sort === ordenClientas.campo;
        btn.classList.toggle('active', activo);
        const icono = btn.querySelector('.clientas-sort-icon');
        if (icono) icono.textContent = activo ? (ordenClientas.asc ? '▲' : '▼') : '';
    });
}

function configurarOrdenClientas() {
    const cabecera = document.getElementById('cabeceraClientas');
    if (!cabecera) return;

    cabecera.addEventListener('click', (e) => {
        const btn = e.target.closest('.clientas-cabecera-btn');
        if (!btn) return;

        const campo = btn.dataset.sort;
        if (ordenClientas.campo === campo) {
            ordenClientas.asc = !ordenClientas.asc;
        } else {
            ordenClientas.campo = campo;
            ordenClientas.asc = true;
        }

        actualizarCabeceraOrdenClientas();
        listarClientas();
    });

    actualizarCabeceraOrdenClientas();
}

function ordenarClientasEnriquecidas(items) {
    const dir = ordenClientas.asc ? 1 : -1;

    return [...items].sort((a, b) => {
        let resultado = 0;

        switch (ordenClientas.campo) {
            case 'nombre':
                resultado = (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' });
                break;
            case 'fechaNacimiento': {
                const fa = parseFechaNacimientoOrden(a.fechaNacimiento);
                const fb = parseFechaNacimientoOrden(b.fechaNacimiento);
                if (fa === null && fb === null) resultado = 0;
                else if (fa === null) resultado = 1;
                else if (fb === null) resultado = -1;
                else resultado = fa - fb;
                break;
            }
            case 'telefono':
                resultado = normalizarTelefono(a.telefono).localeCompare(normalizarTelefono(b.telefono), 'es');
                break;
            case 'visitas':
                resultado = a.totalHistorico - b.totalHistorico;
                break;
            case 'fidelidad': {
                const scoreA = (a.estado.tocaRegalo ? 1000 : 0) + a.estado.actual;
                const scoreB = (b.estado.tocaRegalo ? 1000 : 0) + b.estado.actual;
                resultado = scoreA - scoreB;
                break;
            }
            default:
                resultado = 0;
        }

        return dir * resultado;
    });
}

let cargandoHistorialVentas = false;
let recargaVentasPendiente = false;

function parseFechaVenta(fecha) {
    if (fecha instanceof Date) return fecha;
    if (typeof fecha === 'number') return new Date(fecha);
    if (typeof fecha === 'string') {
        const iso = new Date(fecha);
        if (!isNaN(iso.getTime())) return iso;
        const partes = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (partes) {
            return new Date(parseInt(partes[3], 10), parseInt(partes[2], 10) - 1, parseInt(partes[1], 10));
        }
    }
    return new Date(NaN);
}

function parseFechaVenta(fecha) {
    if (fecha instanceof Date) return fecha;
    if (typeof fecha === 'number') return new Date(fecha);
    if (typeof fecha === 'string') {
        const iso = new Date(fecha);
        if (!isNaN(iso.getTime())) return iso;
        const partes = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (partes) {
            return new Date(parseInt(partes[3], 10), parseInt(partes[2], 10) - 1, parseInt(partes[1], 10));
        }
    }
    return new Date(NaN);
}

// =========================================
// DASHBOARD INICIO
// =========================================
let cargandoDashboard = false;
let dashboardAlertasCache = [];

function inicioDia(fecha = new Date()) {
    return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

function inicioSemana(fecha = new Date()) {
    const lunes = new Date(fecha);
    lunes.setDate(lunes.getDate() - (lunes.getDay() === 0 ? 6 : lunes.getDay() - 1));
    lunes.setHours(0, 0, 0, 0);
    return lunes;
}

function inicioMes(fecha = new Date()) {
    return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}

function esPerfilEspecial(nombre) {
    return nombre === 'Ex-Clienta' || nombre === 'Salon Loma';
}

function esMismoDia(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function cumpleEnProximosDias(fechaNacimiento, diasVentana = 7) {
    if (!fechaNacimiento || !String(fechaNacimiento).includes('/')) return false;
    const partes = String(fechaNacimiento).split('/');
    const diaNac = parseInt(partes[0], 10);
    const mesNac = parseInt(partes[1], 10);
    if (isNaN(diaNac) || isNaN(mesNac)) return false;

    const hoy = inicioDia();
    for (let i = 0; i <= diasVentana; i++) {
        const d = new Date(hoy);
        d.setDate(d.getDate() + i);
        if (d.getDate() === diaNac && d.getMonth() + 1 === mesNac) return true;
    }
    return false;
}

function esCumpleHoy(fechaNacimiento) {
    if (!fechaNacimiento || !String(fechaNacimiento).includes('/')) return false;
    const partes = String(fechaNacimiento).split('/');
    const hoy = new Date();
    return parseInt(partes[0], 10) === hoy.getDate()
        && parseInt(partes[1], 10) === hoy.getMonth() + 1;
}

function pctCambio(actual, anterior) {
    if (anterior === 0) return actual > 0 ? 100 : 0;
    return ((actual - anterior) / anterior) * 100;
}

function fmtPct(n) {
    const signo = n > 0 ? '+' : '';
    return `${signo}${n.toFixed(0)}%`;
}

function fmtEuros(n) {
    return `${n.toFixed(2)}€`;
}

function irATab(tabId) {
    const tab = document.getElementById(tabId);
    if (tab) bootstrap.Tab.getOrCreateInstance(tab).show();
}

function ejecutarAccionDashboard(accion, id) {
    switch (accion) {
        case 'clienta':
            if (id) abrirDashboardClienta(id);
            break;
        case 'agenda':
            irATab('tab-agenda');
            break;
        case 'clientes':
            irATab('tab-clientes');
            break;
        case 'ventas':
            irATab('tab-ventas');
            break;
        case 'servicios':
            irATab('tab-servicios');
            break;
        default:
            break;
    }
}

function configurarDashboardEventos() {
    const wrap = document.getElementById('content-inicio');
    if (!wrap || wrap.dataset.eventsBound) return;
    wrap.dataset.eventsBound = '1';
    wrap.addEventListener('click', (e) => {
        const item = e.target.closest('[data-accion]');
        if (!item) return;
        if (item.classList.contains('dashboard-seccion-card') && e.target.closest('[data-accion-inner]')) return;
        ejecutarAccionDashboard(item.dataset.accion, item.dataset.id || '');
    });
    wrap.addEventListener('keydown', (e) => {
        const card = e.target.closest('.dashboard-seccion-card[data-accion]');
        if (!card || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        ejecutarAccionDashboard(card.dataset.accion, '');
    });
}

function renderKpiMini(valor, label) {
    return `<div class="dashboard-kpi-mini"><div class="kpi-val">${valor}</div><div class="kpi-lbl">${label}</div></div>`;
}

function renderChip(valor, label, extraClass = '') {
    return `<div class="dashboard-chip ${extraClass}"><span class="chip-val">${valor}</span><span class="chip-lbl">${label}</span></div>`;
}

function renderSeccionStat(valor, label) {
    return `<div class="seccion-stat"><span class="stat-val">${valor}</span><span class="stat-lbl">${label}</span></div>`;
}

async function calcularDatosDashboard() {
    const ahora = new Date();
    const hoy0 = inicioDia(ahora);
    const manana0 = new Date(hoy0);
    manana0.setDate(manana0.getDate() + 1);
    const pasadoManana0 = new Date(hoy0);
    pasadoManana0.setDate(pasadoManana0.getDate() + 2);

    const iniSem = inicioSemana(ahora);
    const iniSemPas = new Date(iniSem);
    iniSemPas.setDate(iniSemPas.getDate() - 7);
    const diasTranscurridosSem = Math.floor((hoy0 - iniSem) / 86400000) + 1;
    const finSemPasComp = new Date(iniSemPas);
    finSemPasComp.setDate(finSemPasComp.getDate() + diasTranscurridosSem - 1);
    finSemPasComp.setHours(23, 59, 59, 999);

    const iniMes = inicioMes(ahora);
    const iniMesPas = inicioMes(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));
    const finMesPasComp = new Date(iniMesPas);
    const ultimoDiaMesPas = new Date(ahora.getFullYear(), ahora.getMonth(), 0).getDate();
    finMesPasComp.setDate(Math.min(ahora.getDate(), ultimoDiaMesPas));
    finMesPasComp.setHours(23, 59, 59, 999);

    const [ventas, clientas, agenda, servicios] = await Promise.all([
        db.ventas.toArray(),
        db.clientas.toArray(),
        db.agenda.toArray(),
        db.servicios.toArray()
    ]);

    const servicioMap = Object.fromEntries(servicios.map(s => [s.id, s]));
    const clientaMap = Object.fromEntries(clientas.map(c => [c.id, c]));
    const idLoma = clientas.find(c => c.nombre === 'Salon Loma')?.id;

    let ingresosHoy = 0, ingresosSem = 0, ingresosSemPas = 0;
    let ingresosMes = 0, ingresosMesPas = 0;
    let ingresosMioMes = 0, ingresosLomaMes = 0;
    const ingresosPorDia7 = Array(7).fill(0);
    const conteoServiciosMes = {};
    const ingresosServiciosMes = {};

    const ultimaVisitaPorCliente = {};
    const primeraVisitaPorCliente = {};
    const totalGastadoPorCliente = {};
    const visitasPagadasPorCliente = {};

    ventas.forEach(v => {
        const f = parseFechaVenta(v.fecha);
        if (isNaN(f.getTime())) return;
        const importe = parseFloat(v.importe) || 0;
        const ts = f.getTime();
        const cid = parseInt(v.clienteId);

        if (importe > 0) {
            if (ts >= hoy0.getTime() && ts < manana0.getTime()) ingresosHoy += importe;
            if (ts >= iniSem.getTime() && ts <= ahora.getTime()) ingresosSem += importe;
            if (ts >= iniSemPas.getTime() && ts <= finSemPasComp.getTime()) ingresosSemPas += importe;
            if (ts >= iniMes.getTime() && ts <= ahora.getTime()) {
                ingresosMes += importe;
                if (cid === idLoma) ingresosLomaMes += importe;
                else ingresosMioMes += importe;
            }
            if (ts >= iniMesPas.getTime() && ts <= finMesPasComp.getTime()) ingresosMesPas += importe;

            const diasAtras = Math.floor((hoy0 - inicioDia(f)) / 86400000);
            if (diasAtras >= 0 && diasAtras < 7) ingresosPorDia7[6 - diasAtras] += importe;

            if (!ultimaVisitaPorCliente[cid] || ts > ultimaVisitaPorCliente[cid]) ultimaVisitaPorCliente[cid] = ts;
            if (!primeraVisitaPorCliente[cid] || ts < primeraVisitaPorCliente[cid]) primeraVisitaPorCliente[cid] = ts;
            totalGastadoPorCliente[cid] = (totalGastadoPorCliente[cid] || 0) + importe;
            visitasPagadasPorCliente[cid] = (visitasPagadasPorCliente[cid] || 0) + 1;

            if (ts >= iniMes.getTime()) {
                const sid = parseInt(v.servicioId);
                const nom = servicioMap[sid]?.nombre || 'Otro';
                conteoServiciosMes[nom] = (conteoServiciosMes[nom] || 0) + 1;
                ingresosServiciosMes[nom] = (ingresosServiciosMes[nom] || 0) + importe;
            }
        }
    });

    const citasHoy = agenda.filter(c => esMismoDia(parseFechaVenta(c.fecha), ahora)).length;
    const citasManana = agenda.filter(c => esMismoDia(parseFechaVenta(c.fecha), manana0)).length;
    const citasPasadoManana = agenda.filter(c => esMismoDia(parseFechaVenta(c.fecha), pasadoManana0)).length;

    const citasSinCobrar = agenda.filter(c => {
        const f = parseFechaVenta(c.fecha);
        return !isNaN(f.getTime()) && f < ahora && c.cobrado !== true && c.cobrado !== 'true';
    });

    const clientasActivas = clientas.filter(c => !esPerfilEspecial(c.nombre) && visitasPagadasPorCliente[c.id] > 0);

    let regalosPendientes = 0;
    const clientasRegalo = [];
    clientasActivas.forEach(c => {
        const pagadas = visitasPagadasPorCliente[c.id] || 0;
        if (pagadas > 0 && pagadas % 10 === 0) {
            regalosPendientes++;
            clientasRegalo.push(c);
        }
    });

    const cumpleSemana = clientas.filter(c => !esPerfilEspecial(c.nombre) && cumpleEnProximosDias(c.fechaNacimiento, 7));
    const cumpleHoy = clientas.filter(c => !esPerfilEspecial(c.nombre) && esCumpleHoy(c.fechaNacimiento));

    const UMBRAL_INACTIVA = 90;
    const UMBRAL_RIESGO = 60;
    const ms90 = UMBRAL_INACTIVA * 86400000;
    const ms60 = UMBRAL_RIESGO * 86400000;
    const inactivas90 = [];
    const inactivas60 = [];

    clientasActivas.forEach(c => {
        const ultima = ultimaVisitaPorCliente[c.id];
        if (!ultima) return;
        const diff = ahora.getTime() - ultima;
        if (diff > ms90) inactivas90.push(c);
        else if (diff > ms60) inactivas60.push(c);
    });

    let nuevasMes = 0;
    clientasActivas.forEach(c => {
        const primera = primeraVisitaPorCliente[c.id];
        if (primera && primera >= iniMes.getTime()) nuevasMes++;
    });

    const visitasPagadasMes = ventas.filter(v => {
        const f = parseFechaVenta(v.fecha);
        return !isNaN(f.getTime()) && f >= iniMes && parseFloat(v.importe) > 0;
    }).length;
    const ticketMedio = visitasPagadasMes > 0 ? ingresosMes / visitasPagadasMes : 0;

    const diasMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
    const proyeccionMes = ahora.getDate() > 0 ? (ingresosMes / ahora.getDate()) * diasMes : 0;

    const pctMes = pctCambio(ingresosMes, ingresosMesPas);
    const pctSem = pctCambio(ingresosSem, ingresosSemPas);

    const topServicios = Object.entries(conteoServiciosMes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    const estrellaServicio = Object.entries(ingresosServiciosMes)
        .sort((a, b) => b[1] - a[1])[0];

    const topVip = clientasActivas
        .map(c => ({ c, total: totalGastadoPorCliente[c.id] || 0, visitas: visitasPagadasPorCliente[c.id] || 0 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    const alertas = [];

    citasSinCobrar.forEach(c => {
        const cli = clientaMap[c.clienteId];
        alertas.push({
            nivel: 'urgente',
            icono: 'fa-cash-register',
            titulo: 'Cita sin cobrar',
            texto: `${cli?.nombre || 'Clienta'} — ${parseFechaVenta(c.fecha).toLocaleDateString('es-ES')}`,
            accion: 'agenda'
        });
    });

    clientasRegalo.forEach(c => {
        alertas.push({
            nivel: 'urgente',
            icono: 'fa-gift',
            titulo: 'Regalo de fidelidad listo',
            texto: `${c.nombre} ha completado 10 sesiones pagadas`,
            accion: 'clienta',
            id: c.id
        });
    });

    cumpleHoy.forEach(c => {
        alertas.push({
            nivel: 'info',
            icono: 'fa-cake-candles',
            titulo: '¡Cumpleaños hoy!',
            texto: c.nombre,
            accion: 'clienta',
            id: c.id
        });
    });

    if (inactivas90.length > 0) {
        alertas.push({
            nivel: 'importante',
            icono: 'fa-user-clock',
            titulo: `${inactivas90.length} clienta(s) inactiva(s)`,
            texto: `Sin visita en más de ${UMBRAL_INACTIVA} días — riesgo de perder cartera`,
            accion: 'clientes'
        });
    }

    if (pctSem <= -15 && ingresosSemPas > 0) {
        alertas.push({
            nivel: 'importante',
            icono: 'fa-chart-line',
            titulo: 'Ingresos semana en bajada',
            texto: `${fmtPct(pctSem)} respecto a la semana pasada (mismo periodo)`,
            accion: 'ventas'
        });
    }

    if (pctMes <= -15 && ingresosMesPas > 0) {
        alertas.push({
            nivel: 'importante',
            icono: 'fa-arrow-trend-down',
            titulo: 'Ingresos mes en bajada',
            texto: `${fmtPct(pctMes)} vs el mismo periodo del mes anterior`,
            accion: 'ventas'
        });
    }

    if (cumpleSemana.length > 0 && cumpleHoy.length === 0) {
        alertas.push({
            nivel: 'info',
            icono: 'fa-cake-candles',
            titulo: `${cumpleSemana.length} cumpleaños esta semana`,
            texto: cumpleSemana.slice(0, 3).map(c => c.nombre).join(', ') + (cumpleSemana.length > 3 ? '…' : ''),
            accion: 'clientes'
        });
    }

    if (citasManana < 3) {
        alertas.push({
            nivel: 'sugerencia',
            icono: 'fa-calendar-plus',
            titulo: 'Mañana hay poca carga',
            texto: `Solo ${citasManana} cita(s) — buen momento para contactar clientas inactivas`,
            accion: 'agenda'
        });
    }

    if (pctMes >= 10 && ingresosMesPas > 0) {
        alertas.push({
            nivel: 'sugerencia',
            icono: 'fa-trophy',
            titulo: '¡Buen mes!',
            texto: `Ingresos ${fmtPct(pctMes)} por encima del mes pasado (mismo periodo)`,
            accion: 'ventas'
        });
    }

    inactivas60.filter(c => (totalGastadoPorCliente[c.id] || 0) >= 100).slice(0, 3).forEach(c => {
        alertas.push({
            nivel: 'sugerencia',
            icono: 'fa-phone',
            titulo: 'Reactivar clienta VIP',
            texto: `${c.nombre} — ${fmtEuros(totalGastadoPorCliente[c.id])} históricos, sin visita reciente`,
            accion: 'clienta',
            id: c.id
        });
    });

    if (topVip[0]) {
        alertas.push({
            nivel: 'sugerencia',
            icono: 'fa-crown',
            titulo: 'Clienta top del salón',
            texto: `${topVip[0].c.nombre} — ${fmtEuros(topVip[0].total)} en ${topVip[0].visitas} visitas`,
            accion: 'clienta',
            id: topVip[0].c.id
        });
    }

    const ordenNivel = { urgente: 0, importante: 1, info: 2, sugerencia: 3 };
    alertas.sort((a, b) => ordenNivel[a.nivel] - ordenNivel[b.nivel]);

    const alertasPrioritarias = alertas.filter(a => a.nivel === 'urgente' || a.nivel === 'importante');

    return {
        ingresosHoy, ingresosMes, pctMes, ingresosSem, pctSem,
        citasHoy, citasManana, citasPasadoManana,
        citasSinCobrar: citasSinCobrar.length,
        alertas, alertasPrioritarias,
        ticketMedio, proyeccionMes, ingresosMioMes, ingresosLomaMes,
        regalosPendientes, cumpleSemana: cumpleSemana.length,
        clientasActivas: clientasActivas.length, nuevasMes,
        inactivas90: inactivas90.length, inactivas60: inactivas60.length,
        topServicios, estrellaServicio, topVip, ingresosPorDia7
    };
}

function renderAlertaItem(a) {
    return `
        <div class="dashboard-alert-item nivel-${a.nivel}" data-accion="${a.accion}" ${a.id ? `data-id="${a.id}"` : ''}>
            <div class="alert-icon"><i class="fa-solid ${a.icono}"></i></div>
            <div>
                <div class="alert-titulo">${escaparHTML(a.titulo)}</div>
                <div class="alert-texto">${escaparHTML(a.texto)}</div>
            </div>
        </div>
    `;
}

function renderDashboard(d) {
    const pctClass = d.pctMes >= 0 ? 'text-up' : 'text-down';
    const alertasUrgentes = d.alertasPrioritarias.length;

    document.getElementById('dashboardHero').innerHTML = `
        <div class="dashboard-hero-card dashboard-hero-card--primary">
            <div class="hero-icon"><i class="fa-solid fa-euro-sign"></i></div>
            <div class="hero-valor">${fmtEuros(d.ingresosHoy)}</div>
            <div class="hero-label">Ingresos hoy</div>
        </div>
        <div class="dashboard-hero-card">
            <div class="hero-icon"><i class="fa-solid fa-chart-line"></i></div>
            <div class="hero-valor">${fmtEuros(d.ingresosMes)}</div>
            <div class="hero-label">Ingresos mes</div>
            <div class="hero-sub ${pctClass}">${fmtPct(d.pctMes)} vs mes ant.</div>
        </div>
        <div class="dashboard-hero-card">
            <div class="hero-icon"><i class="fa-solid fa-calendar-check"></i></div>
            <div class="hero-valor">${d.citasHoy}</div>
            <div class="hero-label">Citas hoy</div>
            <div class="hero-sub text-muted">Mañana: ${d.citasManana}</div>
        </div>
    `;

    document.getElementById('dashboardChips').innerHTML = `
        ${renderChip(fmtEuros(d.ingresosSem), 'Semana')}
        ${renderChip(fmtPct(d.pctSem), 'Vs sem.', d.pctSem >= 0 ? 'chip-up' : 'chip-down')}
        ${renderChip(fmtEuros(d.ticketMedio), 'Ticket')}
        ${renderChip(fmtEuros(d.proyeccionMes), 'Proyección')}
        ${renderChip(d.citasSinCobrar, 'Sin cobrar', d.citasSinCobrar > 0 ? 'chip-warn' : '')}
        ${renderChip(alertasUrgentes, 'Alertas', alertasUrgentes > 0 ? 'chip-danger' : '')}
        ${renderChip(d.clientasActivas, 'Activas', '')}
        ${renderChip(d.regalosPendientes, 'Regalos', d.regalosPendientes > 0 ? 'chip-ok' : '')}
    `;

    const sugerencias = d.alertas.filter(a => a.nivel === 'sugerencia');
    const alertasNoSugerencia = d.alertas.filter(a => a.nivel !== 'sugerencia');
    const visiblesAlertas = alertasNoSugerencia.slice(0, 5);

    const badgeAlertas = document.getElementById('dashboardAlertasBadge');
    const badgeSugerencias = document.getElementById('dashboardSugerenciasBadge');
    if (badgeAlertas) badgeAlertas.textContent = alertasNoSugerencia.length;
    if (badgeSugerencias) badgeSugerencias.textContent = sugerencias.length;

    let alertasHtml = '';
    if (alertasNoSugerencia.length === 0) {
        alertasHtml = '<p class="dashboard-empty"><i class="fa-solid fa-circle-check"></i>Todo en orden — no hay alertas pendientes</p>';
    } else {
        alertasHtml = `<div class="dashboard-alertas-list dashboard-alertas-list-doble">${visiblesAlertas.map(renderAlertaItem).join('')}</div>`;
        if (alertasNoSugerencia.length > 5) {
            alertasHtml += `<button type="button" class="btn btn-sm btn-outline-gold w-100 mt-3" onclick="mostrarTodasAlertasDashboard('alertas')">
                Ver todas (${alertasNoSugerencia.length})
            </button>`;
        }
    }

    let sugerenciasHtml = '';
    if (sugerencias.length === 0) {
        sugerenciasHtml = '<p class="dashboard-empty dashboard-empty--muted">Sin sugerencias por ahora</p>';
    } else {
        sugerenciasHtml = `<div class="dashboard-alertas-list dashboard-alertas-list-doble">${sugerencias.map(renderAlertaItem).join('')}</div>`;
    }

    document.getElementById('dashboardAlertas').innerHTML = alertasHtml;
    document.getElementById('dashboardSugerencias').innerHTML = sugerenciasHtml;

    dashboardAlertasCache = d.alertas;

    document.getElementById('dashboardAcordeonCaja').innerHTML = `
        <div data-accion-inner="1">
            <div class="seccion-principal">${fmtEuros(d.ingresosSem)}</div>
            <div class="seccion-principal-lbl">Esta semana</div>
            <div class="seccion-stats">
                ${renderSeccionStat(fmtEuros(d.ingresosMioMes), 'Mío')}
                ${renderSeccionStat(fmtEuros(d.ingresosLomaMes), 'Loma')}
                ${renderSeccionStat(fmtEuros(d.ticketMedio), 'Ticket')}
            </div>
        </div>
        <span class="seccion-link">Ver caja <i class="fa-solid fa-arrow-right"></i></span>
    `;

    document.getElementById('dashboardAcordeonAgenda').innerHTML = `
        <div data-accion-inner="1">
            <div class="seccion-principal">${d.citasManana}</div>
            <div class="seccion-principal-lbl">Citas mañana</div>
            <div class="seccion-stats">
                ${renderSeccionStat(d.citasSinCobrar, 'Sin cobrar')}
                ${renderSeccionStat(d.citasPasadoManana, 'Pasado')}
                ${renderSeccionStat(d.citasHoy, 'Hoy')}
            </div>
        </div>
        <span class="seccion-link">Ver agenda <i class="fa-solid fa-arrow-right"></i></span>
    `;

    document.getElementById('dashboardAcordeonClientas').innerHTML = `
        <div data-accion-inner="1">
            <div class="seccion-principal">${d.clientasActivas}</div>
            <div class="seccion-principal-lbl">Clientas activas</div>
            <div class="seccion-stats">
                ${renderSeccionStat(d.nuevasMes, 'Nuevas')}
                ${renderSeccionStat(d.regalosPendientes, 'Regalos')}
                ${renderSeccionStat(d.cumpleSemana, 'Cumples')}
            </div>
        </div>
        <span class="seccion-link">Ver clientas <i class="fa-solid fa-arrow-right"></i></span>
    `;

    const estrellaNom = d.estrellaServicio ? escaparHTML(d.estrellaServicio[0]) : '—';

    document.getElementById('dashboardAcordeonServicios').innerHTML = `
        <div data-accion-inner="1">
            <div class="seccion-principal seccion-principal--sm">${estrellaNom}</div>
            <div class="seccion-principal-lbl">Estrella del mes</div>
            <div class="seccion-stats">
                ${renderSeccionStat(d.topServicios[0]?.[1] || 0, 'Top ventas')}
                ${renderSeccionStat(d.topServicios[1] ? escaparHTML(d.topServicios[1][0]).slice(0, 8) : '—', '2º servicio')}
                ${renderSeccionStat(d.estrellaServicio ? fmtEuros(d.estrellaServicio[1]) : '—', 'Ingresos')}
            </div>
        </div>
        <span class="seccion-link">Ver servicios <i class="fa-solid fa-arrow-right"></i></span>
    `;
}

function mostrarTodasAlertasDashboard(tipo) {
    const lista = tipo === 'alertas'
        ? dashboardAlertasCache.filter(a => a.nivel !== 'sugerencia')
        : dashboardAlertasCache;
    if (!lista.length) return;
    Swal.fire({
        ...swalConfig,
        title: tipo === 'alertas' ? 'Todas las alertas' : 'Todas las alertas y sugerencias',
        html: `<div class="dashboard-alertas-list dashboard-alertas-list-modal">${lista.map(renderAlertaItem).join('')}</div>`,
        width: 600,
        confirmButtonText: 'Cerrar',
        didOpen: () => {
            document.querySelector('.swal2-html-container')?.addEventListener('click', (e) => {
                const item = e.target.closest('[data-accion]');
                if (!item) return;
                Swal.close();
                ejecutarAccionDashboard(item.dataset.accion, item.dataset.id || '');
            });
        }
    });
}

async function cargarDashboard() {
    if (cargandoDashboard) return;
    cargandoDashboard = true;
    try {
        const datos = await calcularDatosDashboard();
        renderDashboard(datos);
    } catch (err) {
        console.error('Error cargando dashboard:', err);
    } finally {
        cargandoDashboard = false;
    }
}

// Función para comprobar si hoy es el cumpleaños de alguna clienta
async function checkCumpleaños() {
    try {
        const hoy = new Date();
        const diaHoy = hoy.getDate();
        const mesHoy = hoy.getMonth() + 1;
        const añoActual = hoy.getFullYear();

        // Formateamos el día/mes como "D/M" para comparar directamente con el string
        const hoyStr = `${diaHoy}/${mesHoy}`;

        // 🛡️ MEJORA DE RENDIMIENTO:
        // En lugar de traer todas, filtramos de forma más eficiente
        // Buscamos clientas que tengan fecha de nacimiento y cuyo último cumple no sea este año
        const posibles = await db.clientas
            .where('fechaNacimiento')
            .notEqual("")
            .filter(c => c.ultimoCumpleFelicitado !== añoActual)
            .toArray();
        
        const cumpleañeras = posibles.filter(c => {
            let diaNac, mesNac;

            // Manejo robusto de formatos (Soporta "1/5" y "2024-05-01")
            if (c.fechaNacimiento.includes('/')) {
                const partes = c.fechaNacimiento.split('/');
                diaNac = parseInt(partes[0]);
                mesNac = parseInt(partes[1]);
            } 
            else if (c.fechaNacimiento.includes('-')) {
                const f = new Date(c.fechaNacimiento);
                // Si la fecha es inválida, saltamos
                if (isNaN(f.getTime())) return false;
                diaNac = f.getUTCDate(); // Usamos UTC para evitar líos de zona horaria
                mesNac = f.getUTCMonth() + 1;
            }

            return diaNac === diaHoy && mesNac === mesHoy;
        });

        if (cumpleañeras.length > 0) {
            console.log("🎂 ¡Cumpleaños detectados!", cumpleañeras);
            
            // Pasamos añoActual para que la función que muestra la alerta 
            // pueda marcar a la clienta como "felicitada este año"
            mostrarAlertaCumple(cumpleañeras, añoActual);
        }
    } catch (error) {
        console.error("Error al comprobar cumpleaños:", error);
    }
}


// Función para calcular cuántas sesiones lleva una clienta
async function obtenerEstadoFidelidad(clienteId) {
    try {
        // 1. Convertimos el ID a número para evitar errores de búsqueda
        const idBusqueda = parseInt(clienteId);
        
        // 2. Buscamos ventas que coincidan con la clienta Y que tengan importe mayor a 0
        // Las sesiones gratis (0€) no computan para el siguiente regalo.
        const ventasPagadas = await db.ventas
            .where('clienteId')
            .equals(idBusqueda)
            .filter(v => v.importe > 0) 
            .toArray();
        
        const totalPagadas = ventasPagadas.length;
        
        // 3. Calculamos el progreso actual (ciclos de 10)
        let actual = totalPagadas % 10;
        let tocaRegalo = false;

        // 4. Si ha llegado a 10, 20, 30... el resto es 0, pero marcamos 10 y aviso de regalo
        if (totalPagadas > 0 && actual === 0) {
            actual = 10;
            tocaRegalo = true;
        }

        return {
            actual: actual,           // Puntos actuales pagados (0-10)
            porcentaje: actual * 10,  // Ancho de la barra
            tocaRegalo: tocaRegalo    // Indica si la siguiente sesión es el regalo
        };
    } catch (e) {
        console.error("Error al calcular fidelidad:", e);
        return { actual: 0, porcentaje: 0, tocaRegalo: false };
    }
}


let calendar;
let citaParaCobrar = null;

// =========================================
// 2. INICIALIZACIÓN AL CARGAR LA PÁGINA (Optimizado para Tablet)
// =========================================
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof Dexie === 'undefined') {
        alert('Error: no se pudo cargar la base de datos (Dexie). Comprueba tu conexión a internet y recarga la página.');
        return;
    }

    configurarBotonesApp();
    await verificarBloqueoApp();
    configurarRefrescoPestanas();

    // 1. PRIORIDAD MÁXIMA: Interfaz de trabajo
    initCalendar();
    listarClientas();
    listarServicios();
    actualizarSelectores();

    cargarDashboard();

    // 2. CARGA DIFERIDA: Historial y Gráficos
    setTimeout(async () => {
        console.log("Cargando historial y estadísticas en segundo plano...");
        if (typeof cargarHistorialVentas === 'function') {
            await cargarHistorialVentas();
        }
    }, 800);
});


function initCalendar() {
    const calendarEl = document.getElementById('calendario');
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        locale: 'es',
        buttonText: {
        today:    'Hoy',
        month:    'Mes',
        week:     'Semana',
        day:      'Día',
        list:     'Lista'
        },
        firstDay: 1,
        allDaySlot: false,
        nowIndicator: true,
        contentHeight: 'auto',
        slotMinTime: '09:30:00',
        slotMaxTime: '21:30:00',
        slotDuration: '00:30:00',
        slotLabelInterval: "00:30",
        defaultTimedEventDuration: '01:30:00',
        slotLabelFormat: {
            hour: '2-digit', minute: '2-digit',
            omitZeroMinute: false, meridiem: false, hour12: false
        },
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridWeek,timeGridDay'
        },

        dateClick: function(info) {
            const modalEl = document.getElementById('modalCita');
            modalEl.removeAttribute('data-edit-id');
            
            // 1. Resetear el formulario
            const inputs = modalEl.querySelectorAll('input, select');
            inputs.forEach(i => i.disabled = false);

            // --- AQUÍ LAS LÍNEAS QUE FALTABAN PARA LIMPIAR LOS SELECTORES ---
            document.getElementById('selCli').value = ""; // Limpia la clienta
            document.getElementById('selSer').value = ""; // Limpia el servicio
            // ----------------------------------------------------------------

            document.getElementById('modalCitaTitulo').textContent = "Nueva Cita";
            document.getElementById('btnEliminarCita').style.display = 'none';
            document.getElementById('btnCobrarCita').style.display = 'none';
            
            // Buscamos también el botón de desbloqueo si lo tienes para ocultarlo
            const btnDesbloquear = document.getElementById('btnForzarDesbloqueo');
            if(btnDesbloquear) btnDesbloquear.style.display = 'none';

            document.querySelector('button[onclick="agendarCita()"]').style.display = 'block';

            // 2. CORRECCIÓN DE HORA (Tu código intacto)
            const d = info.date;
            const año = d.getFullYear();
            const mes = String(d.getMonth() + 1).padStart(2, '0');
            const dia = String(d.getDate()).padStart(2, '0');
            const hora = String(d.getHours()).padStart(2, '0');
            const minutos = String(d.getMinutes()).padStart(2, '0');

            const fechaLocalCorrecta = `${año}-${mes}-${dia}T${hora}:${minutos}`;
            document.getElementById('citaFecha').value = fechaLocalCorrecta;

            // 3. Mostrar el modal (Usando instancia para evitar parpadeos)
            const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
            modalInstance.show();
        },

        eventClick: function(info) {
            if (info.event && info.event.id) {
                prepararEdicionCita(info.event.id);
            }
        },

        events: async function(info, successCallback, failureCallback) {
            try {
                const citas = await db.agenda.toArray();
                const eventos = await Promise.all(citas.map(async (c) => {
                    // Buscamos clienta y servicio, con plan B si no existen
                    const cli = await db.clientas.get(parseInt(c.clienteId)) || { nombre: "Clienta borrada" };
                    const ser = await db.servicios.get(parseInt(c.servicioId)) || { nombre: "" };
                    
                    const isCobrado = (c.cobrado === true || c.cobrado === "true");
                    
                    // Definimos textos y colores
                    const icono = isCobrado ? '✅ ' : '';
                    const colorFondo = isCobrado ? '#444444' : '#e69c9c'; // Gris oscuro si está cobrada
                    const colorTexto = isCobrado ? '#aaa' : '#1a1a1a';

                    return {
                        id: c.id,
                        title: `${icono}${cli.nombre}`,
                        start: c.fecha,
                        backgroundColor: colorFondo,
                        borderColor: isCobrado ? '#222' : '#c5a059',
                        textColor: colorTexto,
                        extendedProps: { cobrado: isCobrado }
                    };
                }));
                successCallback(eventos);
            } catch (error) {
                console.error("Error cargando eventos:", error);
                failureCallback(error);
            }
        }
    });
    calendar.render();

    checkCumpleaños();
}


// =========================================
// 4. GESTIÓN DE CITAS
// =========================================
async function prepararEdicionCita(id) {
    const modalEl = document.getElementById('modalCita');
    
    // =========================================================
    // 1. RESET DE EMERGENCIA (Limpieza total antes de empezar)
    // =========================================================
    modalEl.removeAttribute('data-edit-id'); // Borramos el rastro de la cita anterior
    modalEl.querySelectorAll('input, select').forEach(i => {
        i.disabled = false; // Desbloqueamos todo
        i.value = "";       // Vaciamos todo
    });

    // Resetear visibilidad de botones por defecto
    const btnGuardar = modalEl.querySelector('button[onclick="agendarCita()"]');
    const btnEliminar = document.getElementById('btnEliminarCita');
    const btnCobrar = document.getElementById('btnCobrarCita');
    const btnDesbloquear = document.getElementById('btnForzarDesbloqueo');

    if(btnGuardar) btnGuardar.style.display = 'block';
    if(btnEliminar) btnEliminar.style.display = 'none';
    if(btnCobrar) btnCobrar.style.display = 'none';
    if(btnDesbloquear) btnDesbloquear.style.display = 'none';
    
    document.getElementById('modalCitaTitulo').textContent = "Nueva Cita";

    // =========================================================
    // 2. CARGAR LISTAS (Actualizar Selectores)
    // =========================================================
    const clientas = await db.clientas.toArray();
    clientas.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", 'es', { sensitivity: 'base' }));
    
    document.getElementById('selCli').innerHTML = '<option value="">--- Selecciona Clienta ---</option>' + 
        clientas.map(c => `<option value="${c.id}">${escaparHTML(c.nombre)}</option>`).join('');

    const servicios = await db.servicios.toArray();
    document.getElementById('selSer').innerHTML = '<option value="">--- Selecciona Servicio ---</option>' + 
        servicios.map(s => `<option value="${s.id}">${escaparHTML(s.nombre)}</option>`).join('');

    // =========================================================
    // 3. SI ES EDICIÓN: RELLENAR Y BLOQUEAR SEGÚN CORRESPONDA
    // =========================================================
    if (id) {
        const cita = await db.agenda.get(parseInt(id));
        if (!cita) return;

        modalEl.setAttribute('data-edit-id', id); // Aquí sí ponemos el ID
        
        if (cita.cobrado) {
            document.getElementById('modalCitaTitulo').textContent = `Cita Finalizada - ${escaparHTML(cita.nombreClienta)}`;
            modalEl.querySelectorAll('input, select').forEach(i => i.disabled = true);
            if(btnGuardar) btnGuardar.style.display = 'none';
            if(btnEliminar) btnEliminar.style.display = 'none';
            if(btnCobrar) btnCobrar.style.display = 'none';
            if(btnDesbloquear) btnDesbloquear.style.display = 'block';
        } else {
            document.getElementById('modalCitaTitulo').textContent = "Gestionar Cita";
            if(btnEliminar) btnEliminar.style.display = 'block';
            if(btnCobrar) btnCobrar.style.display = 'block';
        }

        // Ponemos los valores de la cita
        document.getElementById('selCli').value = cita.clienteId;
        document.getElementById('selSer').value = cita.servicioId;
        document.getElementById('citaFecha').value = cita.fecha;
    }

    // =========================================================
    // 4. MOSTRAR MODAL
    // =========================================================
    // Usamos la instancia existente o creamos una nueva
    const modalInstance = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
    modalInstance.show();
}


async function agendarCita() {
    const modalEl = document.getElementById('modalCita');
    const editId = modalEl.getAttribute('data-edit-id');
    
    const clienteId = parseInt(document.getElementById('selCli').value);
    const servicioId = parseInt(document.getElementById('selSer').value);
    const fecha = document.getElementById('citaFecha').value;

    // 1. Validación de campos vacíos
    if (!clienteId || !servicioId || !fecha) {
        Swal.fire({
                    ...swalConfig,
                    icon: 'info',
                    title: 'Campos incompletos',
                    text: 'Por favor, selecciona clienta, servicio y fecha para agendar la cita.',
                    confirmButtonText: 'Entendido'
                }); 
        return;
    }

    // --- 🛡️ ESCUDO DE INTEGRIDAD ---
    const [cliente, servicio] = await Promise.all([
        db.clientas.get(clienteId),
        db.servicios.get(servicioId)
    ]);

    if (!cliente || !servicio) {
        Swal.fire({
                    ...swalConfig,
                    icon: 'error',
                    title: '¡Vaya!',
                    text: 'La clienta o el servicio seleccionados ya no existen en el sistema.',
                    confirmButtonText: 'Cerrar'
                });
        return;
    }

    if (editId) {
        const citaExistente = await db.agenda.get(parseInt(editId));
        if (citaExistente && citaExistente.cobrado) {
            Swal.fire({
                            ...swalConfig,
                            icon: 'warning',
                            title: 'Cita Bloqueada',
                            text: 'Esta cita ya ha sido cobrada y no se puede modificar por seguridad contable.',
                            confirmButtonText: 'Entendido'
                        });
            return;
        }
    }

    const datosCita = {
        nombreClienta: cliente.nombre,
        servicio: servicio.nombre,
        fechaInicio: fecha,
        fechaFin: new Date(new Date(fecha).getTime() + 60 * 60 * 1000).toISOString()
    };

    let idFinal;

    try {
        // --- OPERACIÓN EN BASE DE DATOS LOCAL ---
        if (editId) {
            idFinal = parseInt(editId);
            await db.agenda.update(idFinal, {
                clienteId: clienteId,
                servicioId: servicioId,
                fecha: fecha
            });
        } else {
            idFinal = await db.agenda.add({
                clienteId: clienteId,
                servicioId: servicioId,
                fecha: fecha,
                cobrado: false
            });
        }
        
        // --- INTEGRACIÓN CON GOOGLE CALENDAR (solo si ya está conectado) ---
        if (estaGoogleConectado() && gapi.client.calendar) {
            try {
                const citaActualizada = await db.agenda.get(idFinal);

                if (editId && citaActualizada.googleEventId) {
                    await actualizarEventoGoogle(citaActualizada.googleEventId, datosCita);
                } else {
                    const googleId = await crearEventoGoogle(datosCita);
                    if (googleId) {
                        await db.agenda.update(idFinal, { googleEventId: googleId });
                        console.log("✅ Cita sincronizada en Google");
                    }
                }
            } catch (errorGoogle) {
                console.error("Error al sincronizar con Google:", errorGoogle);
            }
        }

        // --- FINALIZACIÓN ---
        if (typeof calendar !== 'undefined') calendar.refetchEvents();

        if (typeof cargarDashboard === 'function') cargarDashboard();
        
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

    } catch (error) {
        console.error("Error al agendar la cita:", error);
            Swal.fire({
                        ...swalConfig,
                        icon: 'error',
                        title: 'Error de Sistema',
                        text: 'Hubo un fallo técnico al intentar guardar la cita. Por favor, inténtalo de nuevo o reinicia la App.',
                        confirmButtonText: 'Cerrar'
                    });
    }
}

async function eliminarCita() {
    const id = document.getElementById('modalCita').getAttribute('data-edit-id');
    if (!id) return;

    Swal.fire({
        ...swalConfig,
        icon: 'warning',
        title: '¿Eliminar cita?',
        text: 'Esta acción no se puede deshacer.',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#444'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // --- TU LÓGICA INTACTA DESDE AQUÍ ---
                const cita = await db.agenda.get(parseInt(id));
                
                await db.agenda.delete(parseInt(id));
                calendar.refetchEvents();

                if (typeof cargarDashboard === 'function') cargarDashboard();
                
                // Cerramos el modal sin esperar a Google
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('modalCita'));
                if (modalInstance) modalInstance.hide();

                console.log("Cita eliminada visualmente. Procesando en Google en segundo plano...");

                // 3. PROCESO EN SEGUNDO PLANO (Google, solo si conectado)
                if (cita && cita.googleEventId && estaGoogleConectado()) {
                    eliminarEventoGoogle(cita.googleEventId).then(() => {
                        console.log("✅ Borrado en Google completado");
                    }).catch(err => {
                        console.error("❌ Falló el borrado en Google, pero ya se quitó de la app:", err);
                    });
                }
                // --- HASTA AQUÍ ---

            } catch (error) {
                console.error("Error al eliminar:", error);
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('modalCita'));
                if (modalInstance) modalInstance.hide();
            }
        }
    });
}

// NO OLVIDES añadir esta función de apoyo si no la pusiste antes:
async function eliminarEventoGoogle(googleEventId) {
    if (!gapi.client.calendar || !googleEventId) return;
    try {
        await gapi.client.calendar.events.delete({
            'calendarId': 'primary',
            'eventId': googleEventId
        });
        console.log('🗑️ Evento eliminado de Google con éxito');
    } catch (err) {
        // Si el evento ya fue borrado manualmente en el móvil, Google dará error 404, 
        // lo ignoramos porque el objetivo es que ya no esté.
        console.warn('Aviso: No se pudo borrar en Google (quizás ya no existía)', err);
    }
}

// =========================================
// 5. SISTEMA DE COBROS Y VENTAS
// =========================================
// Al iniciar el cobro, ponemos el precio base del servicio en el input
async function iniciarCobro() {
    const idCita = document.getElementById('modalCita').getAttribute('data-edit-id');
    if (!idCita) {
            Swal.fire({
                ...swalConfig,
                icon: 'info',
                title: 'Paso necesario',
                text: 'Primero debes guardar los datos de la cita antes de proceder al cobro.',
                confirmButtonText: 'Entendido'
            });
            return;
        }
    // 1. LEER EL SERVICIO SELECCIONADO EN PANTALLA (NO EL DE LA BD)
    const idServicioEnPantalla = parseInt(document.getElementById('selSer').value);

    // 2. BUSCAR LOS DATOS DE ESE SERVICIO ESPECÍFICO
    const servicioReal = await db.servicios.get(idServicioEnPantalla);
    const citaActual = await db.agenda.get(parseInt(idCita));

    if (!servicioReal || !citaActual) {
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Error de Recuperación',
            text: 'No se han podido localizar los datos del servicio o la cita en el sistema.',
            confirmButtonText: 'Cerrar'
        });
        return;
    }

    // 3. PREPARAR EL OBJETO DE COBRO CON LOS DATOS "FRESCOS"
    // Guardamos el nuevo servicioId por si lo has cambiado en el modal
    citaParaCobrar = { 
        ...citaActual, 
        servicioId: idServicioEnPantalla, 
        importe: servicioReal.coste 
    };
    
    // 4. RELLENAR EL INPUT CON EL PRECIO DEL NUEVO SERVICIO
    document.getElementById('inputImporteFinal').value = servicioReal.coste;
    
    // 5. CAMBIO DE MODALES
    const modalCita = bootstrap.Modal.getInstance(document.getElementById('modalCita'));
    if (modalCita) modalCita.hide();
    
    new bootstrap.Modal(document.getElementById('modalCobro')).show();
}

// Al confirmar, guardamos el valor que haya en el input (el editado)
async function confirmarCobro() {
    const importeInput = document.getElementById('inputImporteFinal').value;
    const importeFinal = parseFloat(importeInput);
    const metodo = document.getElementById('metodoPago').value;

    if (isNaN(importeFinal) || importeFinal < 0) {
        Swal.fire({
            ...swalConfig,
            icon: 'warning',
            title: 'Importe no válido',
            text: 'Por favor, introduce un número válido para el precio del servicio.',
            confirmButtonText: 'Corregir'
        });
        return;
    }

    try {
        // =====================================================
        // 🛡️ PASO 0: ESCUDO DE SEGURIDAD (Validación de BD)
        // =====================================================
        const citaRealEnBD = await db.agenda.get(parseInt(citaParaCobrar.id));

        if (!citaRealEnBD) {
            Swal.fire({
                ...swalConfig,
                icon: 'error',
                title: 'Cita no encontrada',
                text: 'No se puede procesar el cobro porque esta cita parece haber sido eliminada de la agenda.',
                confirmButtonText: 'Cerrar'
            });
            return;
        }

        if (citaRealEnBD.cobrado === true) {
            Swal.fire({
                ...swalConfig,
                icon: 'warning',
                title: 'Cita ya cobrada',
                text: 'Esta cita ya figura como COBRADA en el sistema. No se puede generar un nuevo ingreso para el mismo servicio.',
                confirmButtonText: 'Entendido'
            });
            const modalCobroEl = document.getElementById('modalCobro');
            const modalInstance = bootstrap.Modal.getInstance(modalCobroEl);
            if (modalInstance) modalInstance.hide();
            return;
        }
        // =====================================================

        // 1. Guardamos la venta asegurando IDs numéricos 
        // -> CAMBIO CLAVE: Usamos citaRealEnBD.fecha para mantener el día de la cita
        await db.ventas.add({
            citaId: parseInt(citaParaCobrar.id), 
            clienteId: parseInt(citaParaCobrar.clienteId),
            servicioId: parseInt(citaParaCobrar.servicioId),
            fecha: citaRealEnBD.fecha, // <-- Cambiado aquí para heredar el día de la agenda
            importe: importeFinal,
            metodoPago: metodo
        });

        // 2. Marcamos la cita como cobrada en la agenda
        await db.agenda.update(parseInt(citaParaCobrar.id), { cobrado: true });
        
        // 3. ACTUALIZACIÓN DE INTERFAZ (Una sola vez cada una)
        if (typeof cargarHistorialVentas === 'function') {
            await cargarHistorialVentas(); 
        }

        if (typeof listarClientas === 'function') {
            await listarClientas();
        }
        
        if (typeof calendar !== 'undefined' && calendar) {
            calendar.refetchEvents();
        }

        if (typeof cargarDashboard === 'function') cargarDashboard();
        
        // 4. Cerrar el modal
        const modalCobroEl = document.getElementById('modalCobro');
        const modalInstance = bootstrap.Modal.getInstance(modalCobroEl);
        if (modalInstance) modalInstance.hide();
        
        // 5. Mensaje de éxito final
        Swal.fire({
            ...swalConfig,
            icon: 'success',
            title: '¡Operación Exitosa!',
            text: importeFinal === 0 
                ? "Sesión de regalo registrada correctamente." 
                : `Venta registrada por un importe de ${importeFinal}€`,
            confirmButtonText: 'Excelente'
        });
        
    } catch (error) {
        console.error("Error al procesar el cobro:", error);
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Error al Registrar Venta',
            text: 'Hubo un error al registrar la venta. Revisa la consola para más detalles.',
            confirmButtonText: 'Cerrar'
        });
    }
}

async function revertirCobro(ventaId, citaId) {
    Swal.fire({
        ...swalConfig,
        icon: 'question',
        title: '¿Anular este cobro?',
        text: 'La cita volverá a estar pendiente y el progreso de la clienta se actualizará.',
        showCancelButton: true,
        confirmButtonText: 'Sí, anular',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#444'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // --- TU LÓGICA INTACTA DESDE AQUÍ ---
                // 1. Eliminamos el registro de la venta
                await db.ventas.delete(parseInt(ventaId));

                // 2. IMPORTANTE: Cambiamos el estado en la agenda a pendiente (cobrado: false)
                if (citaId) {
                    await db.agenda.update(parseInt(citaId), { cobrado: false });
                }

                // Forzamos la actualización de datos
                if (typeof cargarHistorialVentas === 'function') {
                    await cargarHistorialVentas(); 
                }

                // Forzamos la actualización de la lista de clientas (Fidelidad)
                if (typeof listarClientas === 'function') {
                    await listarClientas();
                }

                if (typeof calendar !== 'undefined') calendar.refetchEvents();

                if (typeof cargarDashboard === 'function') cargarDashboard();

                Swal.fire({
                    ...swalConfig,
                    icon: 'success',
                    title: 'Anulación Completada',
                    text: 'El cobro ha sido anulado. Se ha actualizado el historial y los puntos de fidelidad de la clienta correctamente.',
                    confirmButtonText: 'Entendido'
                });
                // --- HASTA AQUÍ ---

            } catch (error) {
                console.error("Error al revertir el cobro:", error);
                Swal.fire({
                    ...swalConfig,
                    icon: 'error',
                    title: 'Error al Anular Cobro',
                    text: 'No se pudo anular el cobro. Revisa la consola para más detalles.',
                    confirmButtonText: 'Cerrar'
                });
            }
        }
    });
}

async function cargarHistorialVentas() {
    if (cargandoHistorialVentas) {
        recargaVentasPendiente = true;
        return;
    }
    cargandoHistorialVentas = true;

    try {
    const ventas = await db.ventas.orderBy('fecha').reverse().toArray();
    
    let contenedor = document.getElementById('acordeonVentas');
    const tablaOriginal = document.getElementById('tablaVentasBody');
    
    let destino;
    if (contenedor) {
        destino = contenedor.parentElement;
    } else if (tablaOriginal) {
        destino = tablaOriginal.closest('.table-responsive') || tablaOriginal.parentElement.parentElement;
    } else {
        return;
    }

    let totalAcumulado = 0;

    const ahora = new Date();
    const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
    const lunes = new Date(ahora);
    lunes.setDate(ahora.getDate() - (ahora.getDay() === 0 ? 6 : ahora.getDay() - 1));
    lunes.setHours(0,0,0,0);
    const inicioSemana = lunes.getTime();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
    const inicioAño = new Date(ahora.getFullYear(), 0, 1).getTime();

    const grupos = { hoy: [], semana: [], mes: [], año: [], resto: [] };

    await Promise.all(ventas.map(async (v) => {
        const cli = await db.clientas.get(v.clienteId);
        const ser = await db.servicios.get(v.servicioId);
        
        totalAcumulado += v.importe;
        const fVenta = parseFechaVenta(v.fecha).getTime();
        if (isNaN(fVenta)) return;
        const item = { v, cli, ser };

        if (fVenta >= hoyInicio) grupos.hoy.push(item);
        if (fVenta >= inicioSemana) grupos.semana.push(item);
        if (fVenta >= inicioMes) grupos.mes.push(item);
        if (fVenta >= inicioAño) grupos.año.push(item);
        if (fVenta < inicioAño) grupos.resto.push(item);
    }));

    // --- FUNCIÓN MODIFICADA PARA LAS 3 COLUMNAS ---
    const crearSeccion = (titulo, id, datos, abierto = false) => {
        const seccionesFijas = ['hoy', 'sem', 'mes', 'anio'];
        if (datos.length === 0 && !seccionesFijas.includes(id)) return '';

        // Calculamos los tres sacos de dinero
        let sumaLoma = 0;
        let sumaMio = 0;
        
        datos.forEach(item => {
            if (item.cli && item.cli.nombre === "Salon Loma") {
                sumaLoma += item.v.importe;
            } else {
                sumaMio += item.v.importe;
            }
        });
        
        const sumaTotal = sumaMio + sumaLoma;

        return `
            <div class="accordion-item bg-dark border-secondary mb-2">
                <h2 class="accordion-header">
                    <button class="accordion-button ${abierto ? '' : 'collapsed'} bg-black text-white" 
                            type="button" data-bs-toggle="collapse" data-bs-target="#coll-${id}">
                        <div class="d-flex justify-content-between w-100 me-3 align-items-center" style="font-size: 0.85rem;">
                            <span class="fw-bold">${titulo}</span>
                            <div class="d-flex gap-3">
                                <span style="color: #eec9c3;">Mío: ${sumaMio.toFixed(2)}€</span>
                                <span style="color: #01a00c;">Loma: ${sumaLoma.toFixed(2)}€</span>
                                <span class="text-warning fw-bold" style="border-left: 1px solid #444; padding-left: 10px;">Total: ${sumaTotal.toFixed(2)}€</span>
                            </div>
                        </div>
                    </button>
                </h2>
                <div id="coll-${id}" class="accordion-collapse collapse ${abierto ? 'show' : ''}" data-bs-parent="#acordeonVentas">
                    <div class="accordion-body p-0">
                        <table class="table table-dark table-hover m-0" style="font-size: 0.85rem;">
                            <thead>
                                <tr style="font-size: 0.7rem; color: #888; border-bottom: 1px solid #333;">
                                    <th class="ps-3">FECHA</th>
                                    <th>CLIENTA</th>
                                    <th>SERVICIO</th>
                                    <th>IMPORTE</th>
                                    <th class="text-end pe-3">ACCIÓN</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${datos.length === 0 ? `
                                    <tr>
                                        <td colspan="5" class="text-center text-muted py-3">Sin ventas en este periodo</td>
                                    </tr>
                                ` : datos.map(item => `
                                    <tr>
                                        <td class="ps-3">${parseFechaVenta(item.v.fecha).toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit'})} ${parseFechaVenta(item.v.fecha).toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})}</td>
                                        <td class="fw-bold" style="${item.cli && item.cli.nombre === 'Salon Loma' ? 'color: #c5a059;' : ''}">
                                            ${item.cli ? escaparHTML(item.cli.nombre) : '---'}
                                        </td>
                                        <td>${item.ser ? escaparHTML(item.ser.nombre) : '---'}</td>
                                        <td class="fw-bold">${item.v.importe.toFixed(2)}€</td>
                                        <td class="text-end pe-3">
                                            <button class="btn btn-sm btn-outline-danger" onclick="revertirCobro(${item.v.id}, ${item.v.citaId})">
                                                <i class="fa-solid fa-rotate-left"></i>
                                            </button>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>`;
    };

    destino.innerHTML = `
        <div class="accordion accordion-flush" id="acordeonVentas">
            ${crearSeccion('HOY', 'hoy', grupos.hoy, true)}
            ${crearSeccion('ESTA SEMANA', 'sem', grupos.semana)}
            ${crearSeccion('ESTE MES', 'mes', grupos.mes)}
            ${crearSeccion('ESTE AÑO', 'anio', grupos.año)}
            ${crearSeccion('AÑOS ANTERIORES', 'resto', grupos.resto)}
        </div>
    `;

    const elTotal = document.getElementById('totalCajaGeneral');
    if (elTotal) elTotal.innerText = `${totalAcumulado.toFixed(2)}€`;

    setTimeout(() => {
        if (typeof renderizarGraficos === 'function') {
            renderizarGraficos(ventas);
        }
    }, 100);
    } finally {
        cargandoHistorialVentas = false;
        if (recargaVentasPendiente) {
            recargaVentasPendiente = false;
            cargarHistorialVentas();
        }
    }
}

// =========================================
// 6. GESTIÓN DE CLIENTAS Y SERVICIOS
// =========================================

function abrirModalNuevoCliente() {
    const modalEl = document.getElementById('modalClienta');
    if (!modalEl) return;

    // 1. Limpiamos el ID de edición
    modalEl.removeAttribute('data-edit-id');
    
    // 2. Reseteamos el título del modal
    const titulo = modalEl.querySelector('.modal-title');
    if (titulo) titulo.innerText = "Añadir Nueva Clienta";
    
    // 3. Limpiamos el formulario y los selectores manuales
    const form = document.getElementById('formClienta');
    if (form) form.reset();
    
    // Limpieza manual de los selectores de fecha
    document.getElementById('selectDia').value = "";
    document.getElementById('selectMes').value = "";
    
    // Ocultamos el botón eliminar para nuevas clientas
    document.getElementById('btnEliminarClienta').style.display = 'none';

    const contenedorPuntos = document.getElementById('infoFidelidadModal');
    if (contenedorPuntos) contenedorPuntos.innerHTML = '';

    // 4. Mostramos el modal
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();
    actualizarSugerenciasLocalidad();
}

async function persistirClienta(idEdicion, datos, modalEl) {
    if (idEdicion) {
        await db.clientas.update(parseInt(idEdicion), datos);
        console.log("Clienta actualizada con éxito");
    } else {
        await db.clientas.add(datos);
        console.log("Nueva clienta añadida con éxito");
    }

    await listarClientas();
    if (typeof actualizarSelectores === "function") actualizarSelectores();
    if (typeof cargarDashboard === 'function') cargarDashboard();

    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();

    document.getElementById('formClienta').reset();
    modalEl.removeAttribute('data-edit-id');
}

function construirAdvertenciaDuplicados(nombreRepetido, telRepetido, telefonoIntroducido) {
    const avisos = [];

    if (nombreRepetido && telRepetido && telRepetido.id === nombreRepetido.id) {
        avisos.push(`⚠️ ¡CUIDADO! Los datos coinciden totalmente con otra ficha existente (${nombreRepetido.nombre}).`);
    } else {
        if (nombreRepetido) {
            avisos.push(`⚠️ AVISO: Ya existe otra clienta con el nombre "${nombreRepetido.nombre}".`);
        }
        if (telRepetido) {
            avisos.push(`⚠️ AVISO: El teléfono "${telefonoIntroducido}" ya lo tiene asignado: ${telRepetido.nombre}.`);
        }
    }

    return avisos.join('\n\n');
}

async function guardarClienta() {
    const modalEl = document.getElementById('modalClienta');
    const idEdicion = modalEl.getAttribute('data-edit-id');
    
    const dia = document.getElementById('selectDia').value;
    const mes = document.getElementById('selectMes').value;
    const cumpleStr = (dia && mes) ? `${dia}/${mes}` : "";

    const datos = {
        nombre: document.getElementById('inputNombre').value,
        telefono: document.getElementById('inputTelefono').value,
        email: document.getElementById('inputEmail').value,
        fechaNacimiento: cumpleStr,
        direccion: document.getElementById('inputDireccion').value,
        cp: document.getElementById('inputCP').value,
        localidad: document.getElementById('inputLocalidad').value,
        observaciones: document.getElementById('inputObservaciones').value
    };

    if (!datos.nombre) {
        Swal.fire({
            ...swalConfig,
            icon: 'warning',
            title: 'Nombre Requerido',
            text: 'Por favor, introduce al menos el nombre de la clienta.',
            confirmButtonText: 'Entendido'
        });
        return;
    }

    try {
        const nombreBusqueda = normalizarNombre(datos.nombre);
        const todasLasClientas = await db.clientas.toArray();
        const idEdicionNum = idEdicion ? parseInt(idEdicion) : null;

        const nombreRepetido = todasLasClientas.find(c =>
            normalizarNombre(c.nombre) === nombreBusqueda && c.id !== idEdicionNum
        );

        const telRepetido = datos.telefono
            ? todasLasClientas.find(c =>
                telefonosCoinciden(c.telefono, datos.telefono) && c.id !== idEdicionNum
            )
            : null;

        const advertencia = construirAdvertenciaDuplicados(nombreRepetido, telRepetido, datos.telefono);

        if (advertencia) {
            Swal.fire({
                ...swalConfig,
                icon: 'warning',
                title: 'Atención',
                text: advertencia,
                showCancelButton: true,
                confirmButtonText: 'Sí, guardar de todos modos',
                cancelButtonText: 'Revisar',
                confirmButtonColor: '#d33',
                cancelButtonColor: '#444'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        await persistirClienta(idEdicion, datos, modalEl);
                    } catch (error) {
                        console.error("Error al guardar clienta:", error);
                        Swal.fire({
                            ...swalConfig,
                            icon: 'error',
                            title: 'Error al Guardar Clienta',
                            text: 'Hubo un error al guardar los datos. Revisa la consola para más detalles.',
                            confirmButtonText: 'Cerrar'
                        });
                    }
                }
            });
            return;
        }

        await persistirClienta(idEdicion, datos, modalEl);

    } catch (error) {
        console.error("Error al guardar clienta:", error);
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Error al Guardar Clienta',
            text: 'Hubo un error al guardar los datos. Revisa la consola para más detalles.',
            confirmButtonText: 'Cerrar'
        });
    }
}

async function abrirDashboardClienta(id) {
    const idNum = parseInt(id);
    const c = await db.clientas.get(idNum);
    if (!c) return;

    const modalEl = document.getElementById('modalDashboardClienta');
    modalEl.setAttribute('data-cliente-id', idNum);

    document.getElementById('dashboardClientaTitulo').textContent = c.nombre || 'Clienta';

    const estado = await obtenerEstadoFidelidad(idNum);
    const ventas = await db.ventas.where('clienteId').equals(idNum).toArray();
    ventas.sort((a, b) => parseFechaVenta(b.fecha) - parseFechaVenta(a.fecha));

    let totalEuros = 0;
    let visitasPagadas = 0;
    let regalos = 0;
    const conteoServicios = {};

    const historial = await Promise.all(ventas.map(async (v) => {
        const ser = await db.servicios.get(parseInt(v.servicioId));
        const nombreServicio = ser ? ser.nombre : 'Servicio eliminado';
        const importe = parseFloat(v.importe) || 0;

        if (importe > 0) {
            visitasPagadas++;
            totalEuros += importe;
            conteoServicios[nombreServicio] = (conteoServicios[nombreServicio] || 0) + 1;
        } else {
            regalos++;
        }

        return { v, nombreServicio, importe };
    }));

    const servicioFavorito = Object.entries(conteoServicios).sort((a, b) => b[1] - a[1])[0];
    const primeraVisita = ventas.length ? parseFechaVenta(ventas[ventas.length - 1].fecha) : null;
    const ultimaVisita = ventas.length ? parseFechaVenta(ventas[0].fecha) : null;

    const fmtFecha = (f) => f && !isNaN(f.getTime())
        ? f.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '—';

    document.getElementById('dashboardResumenContenido').innerHTML = `
        <div class="row g-3 mb-4">
            <div class="col-6 col-md-3">
                <div class="dashboard-stat-card">
                    <div class="stat-valor">${visitasPagadas}</div>
                    <div class="stat-label">Visitas pagadas</div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="dashboard-stat-card">
                    <div class="stat-valor">${totalEuros.toFixed(2)}€</div>
                    <div class="stat-label">Total gastado</div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="dashboard-stat-card">
                    <div class="stat-valor">${regalos}</div>
                    <div class="stat-label">Regalos</div>
                </div>
            </div>
            <div class="col-6 col-md-3">
                <div class="dashboard-stat-card">
                    <div class="stat-valor">${estado.actual}/10</div>
                    <div class="stat-label">Fidelidad ${estado.tocaRegalo ? '🎁' : ''}</div>
                </div>
            </div>
        </div>
        <div class="progress mb-4" style="height: 10px; background: #333; border-radius: 10px;">
            <div class="progress-bar" style="width: ${estado.porcentaje}%; background: linear-gradient(90deg, #c5a059, #fcf6ba);"></div>
        </div>
        <div class="row">
            <div class="col-md-6">
                ${c.telefono ? `<div class="dashboard-info-row"><i class="fa-solid fa-phone"></i> ${escaparHTML(c.telefono)}</div>` : ''}
                ${c.email ? `<div class="dashboard-info-row"><i class="fa-solid fa-envelope"></i> ${escaparHTML(c.email)}</div>` : ''}
                ${c.fechaNacimiento ? `<div class="dashboard-info-row"><i class="fa-solid fa-cake-candles"></i> ${escaparHTML(c.fechaNacimiento)}</div>` : ''}
                ${c.localidad ? `<div class="dashboard-info-row"><i class="fa-solid fa-location-dot"></i> ${escaparHTML(c.localidad)}</div>` : ''}
            </div>
            <div class="col-md-6">
                <div class="dashboard-info-row"><i class="fa-solid fa-calendar"></i> Primera visita: ${fmtFecha(primeraVisita)}</div>
                <div class="dashboard-info-row"><i class="fa-solid fa-calendar-check"></i> Última visita: ${fmtFecha(ultimaVisita)}</div>
                ${servicioFavorito ? `<div class="dashboard-info-row"><i class="fa-solid fa-star"></i> Servicio habitual: ${escaparHTML(servicioFavorito[0])} (${servicioFavorito[1]}x)</div>` : ''}
            </div>
        </div>
    `;

    const historialHtml = historial.length === 0
        ? '<p class="text-muted text-center py-4">Esta clienta aún no tiene visitas registradas.</p>'
        : `
            <div class="table-responsive">
                <table class="table table-dark table-hover dashboard-historial-table mb-0">
                    <thead>
                        <tr>
                            <th>Fecha</th>
                            <th>Servicio</th>
                            <th>Importe</th>
                            <th>Pago</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${historial.map(({ v, nombreServicio, importe }) => {
                            const f = parseFechaVenta(v.fecha);
                            const fechaStr = !isNaN(f.getTime())
                                ? `${f.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
                                : '—';
                            return `
                                <tr>
                                    <td>${fechaStr}</td>
                                    <td>${escaparHTML(nombreServicio)}</td>
                                    <td class="fw-bold ${importe === 0 ? 'dashboard-regalo-badge' : ''}">${importe === 0 ? 'Regalo' : importe.toFixed(2) + '€'}</td>
                                    <td>${importe > 0 ? escaparHTML(v.metodoPago || '—') : '—'}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;

    document.getElementById('dashboardHistorialContenido').innerHTML = historialHtml;

    const tabResumen = document.getElementById('tab-resumen-clienta');
    if (tabResumen) bootstrap.Tab.getOrCreateInstance(tabResumen).show();

    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    modalInstance.show();
}

function editarClientaDesdeDashboard() {
    const modalDash = document.getElementById('modalDashboardClienta');
    const id = modalDash.getAttribute('data-cliente-id');
    if (!id) return;

    bootstrap.Modal.getInstance(modalDash)?.hide();
    prepararEdicionClienta(id);
}

async function prepararEdicionClienta(id) {
    const c = await db.clientas.get(parseInt(id));
    if (!c) return;

    const estado = await obtenerEstadoFidelidad(id);

    const modalEl = document.getElementById('modalClienta');

    // 2. Rellenamos los inputs básicos
    document.getElementById('inputNombre').value = c.nombre || '';
    document.getElementById('inputTelefono').value = c.telefono || '';
    document.getElementById('inputEmail').value = c.email || '';
    document.getElementById('inputDireccion').value = c.direccion || '';
    document.getElementById('inputCP').value = c.cp || '';
    document.getElementById('inputLocalidad').value = c.localidad || '';
    document.getElementById('inputObservaciones').value = c.observaciones || '';
    
    // 3. Rellenamos los selectores de Cumpleaños (Día/Mes)
    if (c.fechaNacimiento && c.fechaNacimiento.includes('/')) {
        const partes = c.fechaNacimiento.split('/');
        document.getElementById('selectDia').value = partes[0];
        document.getElementById('selectMes').value = partes[1];
    } else {
        document.getElementById('selectDia').value = "";
        document.getElementById('selectMes').value = "";
    }

    // 4. Configuraciones visuales del modal
    document.getElementById('btnEliminarClienta').style.display = 'block';
    modalEl.querySelector('.modal-title').innerText = "Editar Ficha de Clienta";
    modalEl.setAttribute('data-edit-id', id);

    // --- OPCIONAL: Si quieres mostrar los puntos dentro del modal ---
    // Si tienes un div con id="infoFidelidadModal" en tu HTML, podrías hacer:
    const contenedorPuntos = document.getElementById('infoFidelidadModal');
        if (contenedorPuntos) {
        contenedorPuntos.innerHTML = `
            <div class="alert alert-dark border-gold mb-3 shadow-sm" style="background-color: #1a1a1a;">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="small fw-bold text-gold" style="letter-spacing: 1px;">
                        <i class="bi bi-star-fill me-1"></i> SESIONES ACUMULADAS: ${estado.actual}/10
                    </span>
                    ${estado.tocaRegalo ? 
                        '<span class="badge bg-gold text-dark animate__animated animate__pulse animate__infinite">🎁 ¡REGALO LISTO!</span>' 
                        : ''}
                </div>
                <div class="progress" style="height: 12px; background-color: #333; border-radius: 10px; overflow: hidden;">
                    <div class="progress-bar bg-gold" 
                        role="progressbar" 
                        style="width: ${estado.porcentaje}%; transition: width 1s ease-in-out;" 
                        aria-valuenow="${estado.actual}" 
                        aria-valuemin="0" 
                        aria-valuemax="10">
                    </div>
                </div>
            </div>
        `;
    }

    // 5. Mostramos el modal
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();
    
    // Si tienes esta función para el autocompletado:
    if (typeof actualizarSugerenciasLocalidad === 'function') {
        actualizarSugerenciasLocalidad();
    }
}

async function listarClientas() {
    const contenedor = document.getElementById('listaClientes');
    if (!contenedor) return;

    const inputBusqueda = document.getElementById('buscadorClientas');

    const limpiarTexto = (texto) => {
        if (!texto) return "";
        return texto
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    };

    const filtro = limpiarTexto(inputBusqueda ? inputBusqueda.value : "");
    const clis = await db.clientas.toArray();

    const clientasFiltradas = clis.filter(c => {
        const nombreLimpio = limpiarTexto(c.nombre);
        const telefono = (c.telefono || "");
        return nombreLimpio.includes(filtro) || telefono.includes(filtro);
    });

    const clientasEnriquecidas = await Promise.all(clientasFiltradas.map(async (c) => {
        const idLimpio = parseInt(c.id);
        const estado = await obtenerEstadoFidelidad(idLimpio);
        const ventasPagadas = await db.ventas
            .where('clienteId').equals(idLimpio)
            .filter(v => v.importe > 0).toArray();

        return {
            ...c,
            idLimpio,
            estado,
            totalHistorico: ventasPagadas.length
        };
    }));

    const clientasOrdenadas = ordenarClientasEnriquecidas(clientasEnriquecidas);
    actualizarCabeceraOrdenClientas();

    contenedor.innerHTML = clientasOrdenadas.map(c => `
            <div class="col-12 clienta-fila">
                <div onclick="abrirDashboardClienta(${c.idLimpio})" 
                     style="cursor: pointer !important; 
                            display: flex !important; 
                            align-items: center !important; 
                            background: #1a1a1a !important; 
                            color: white !important;
                            padding: 3px 15px !important; 
                            min-height: 42px !important; 
                            border: 1px solid #c5a059 !important; 
                            border-left: 6px solid #c5a059 !important; 
                            border-radius: 12px !important; 
                            transition: all 0.2s ease;
                            position: relative;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    
                    <div style="display: flex; width: 100%; align-items: center; gap: 15px;">
                        <div style="flex: 2.5; min-width: 160px;">
                            <span style="font-size: 1.15rem !important; font-weight: 700 !important; color: #fcf6ba !important; white-space: nowrap; letter-spacing: 0.3px;">
                                ${escaparHTML(c.nombre)}
                            </span>
                        </div>

                        <div style="flex: 0.8; color: #eec9c3; font-size: 0.75rem; white-space: nowrap; min-width: 70px;">
                            ${c.fechaNacimiento ? `
                                <i class="fa-solid fa-cake-candles" style="font-size: 0.65rem; margin-right: 5px;"></i>${escaparHTML(c.fechaNacimiento)}
                            ` : ''}
                        </div>

                        <div style="flex: 1; color: #888; font-size: 0.75rem; white-space: nowrap;">
                            <i class="fa-solid fa-phone" style="font-size: 0.65rem; margin-right: 5px; color: #c5a059;"></i>${escaparHTML(c.telefono || '')}
                        </div>

                        <div style="width: 55px; text-align: center; border-left: 1px solid #333; border-right: 1px solid #333;">
                            <span style="font-size: 0.95rem; font-weight: bold; color: #ffffff;">${c.totalHistorico}</span>
                        </div>

                        <div style="flex: 2; display: flex; align-items: center; gap: 12px; justify-content: flex-end;">
                            <span style="font-size: 0.8rem; font-weight: bold; color: #eee; min-width: 38px; text-align: right;">
                                ${c.estado.actual}/10
                            </span>
                            <div style="width: 75px; background: #000; height: 5px; border-radius: 10px; border: 1px solid #444; overflow: hidden;">
                                <div style="width: ${c.estado.porcentaje}%; background: linear-gradient(90deg, #c5a059, #fcf6ba); height: 100%;"></div>
                            </div>
                            <div style="width: 20px; text-align: center;">
                                ${c.estado.tocaRegalo ? '<i class="fa-solid fa-crown text-warning" style="font-size: 0.9rem; filter: drop-shadow(0 0 3px rgba(255,215,0,0.6));"></i>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
}

async function ejecutarEliminarClienta() {
    const modalEl = document.getElementById('modalClienta');
    const idOriginal = modalEl.getAttribute('data-edit-id');

    if (!idOriginal) return;

    Swal.fire({
        ...swalConfig,
        icon: 'warning',
        title: '¿Confirmar baja definitiva?',
        text: "Los datos personales se borrarán, pero el historial de ingresos se moverá a 'Ex-Clienta' para no perder tus estadísticas.",
        showCancelButton: true,
        confirmButtonText: 'Sí, dar de baja',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#444'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // --- INICIO DE TU LÓGICA ORIGINAL (MÁXIMA ATENCIÓN) ---
                const clienteIdNum = parseInt(idOriginal);

                // 1. 🛡️ ASEGURAR QUE EXISTE EL PERFIL "EX-CLIENTA"
                let exClienta = await db.clientas.where('nombre').equalsIgnoreCase('Ex-Clienta').first();
                
                if (!exClienta) {
                    // Si no existe, la creamos ahora mismo
                    const exId = await db.clientas.add({
                        nombre: "Ex-Clienta",
                        telefono: "000",
                        observaciones: "Perfil genérico para mantener historial de bajas."
                    });
                    exClienta = { id: exId };
                }

                // 2. 🔄 TRASPASAR HISTORIAL (Citas y Ventas)
                const citas = await db.agenda.where('clienteId').equals(clienteIdNum).toArray();
                const ventas = await db.ventas.where('clienteId').equals(clienteIdNum).toArray();

                // Actualizamos cada cita y venta para que ahora pertenezcan a "Ex-Clienta"
                const promesasCitas = citas.map(c => db.agenda.update(c.id, { clienteId: exClienta.id }));
                const promesasVentas = ventas.map(v => db.ventas.update(v.id, { clienteId: exClienta.id }));

                await Promise.all([...promesasCitas, ...promesasVentas]);

                // 3. 🗑️ BORRAR FICHA ORIGINAL
                await db.clientas.delete(clienteIdNum);

                // 4. FEEDBACK Y REFRESCAR
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();

                await listarClientas();
                if (typeof actualizarSelectores === 'function') actualizarSelectores();
                if (calendar) calendar.refetchEvents();
                if (typeof cargarHistorialVentas === 'function') await cargarHistorialVentas();

                // Mensaje de éxito final
                Swal.fire({
                    ...swalConfig,
                    icon: 'success',
                    title: 'Traspaso Finalizado',
                    text: `El proceso se ha completado con éxito: se han movido ${citas.length} citas y ${ventas.length} ventas al perfil 'Ex-Clienta'.`,
                    confirmButtonText: 'Entendido'
                });
                // --- FIN DE TU LÓGICA ORIGINAL ---
                
            } catch (error) {
                console.error("Error en el traspaso de datos:", error);
                Swal.fire({
                    ...swalConfig,
                    icon: 'error',
                    title: 'Error en el Traspaso',
                    text: 'Hubo un fallo al intentar mover el historial. Revisa la consola para más detalles.',
                    confirmButtonText: 'Cerrar'
                });
            }
        }
    });
}

async function guardarServicio() {
    const modalEl = document.getElementById('modalServicio');
    const id = modalEl.getAttribute('data-edit-id');
    
    const datos = {
        nombre: document.getElementById('serNom').value,
        coste: parseFloat(document.getElementById('serCos').value)
    };

    if (!datos.nombre || isNaN(datos.coste)) {
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Error al Guardar Servicio',
            text: 'Por favor, completa nombre y precio.',
            confirmButtonText: 'Cerrar'
        });
        return;
    }

    if (id) {
        await db.servicios.update(parseInt(id), datos);
    } else {
        await db.servicios.add(datos);
    }

    // Limpieza y refresco
    modalEl.removeAttribute('data-edit-id');
    modalEl.querySelector('.modal-title').innerText = "Nuevo Servicio";
    document.getElementById('serNom').value = '';
    document.getElementById('serCos').value = '';
    
    bootstrap.Modal.getInstance(modalEl).hide();
    listarServicios();
    if(typeof actualizarSelectores === 'function') actualizarSelectores();
}

async function eliminarServicio(id) {
    Swal.fire({
        ...swalConfig,
        icon: 'warning',
        title: '¿Eliminar servicio?',
        text: 'Este servicio dejará de aparecer como opción para nuevas citas.',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#444'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // --- LÓGICA ORIGINAL ---
                await db.servicios.delete(id);
                listarServicios();
                if(typeof actualizarSelectores === 'function') actualizarSelectores();
                
                // Pequeño aviso de confirmación (opcional, pero recomendado para feedback)
                Swal.fire({
                    ...swalConfig,
                    icon: 'success',
                    title: 'Servicio eliminado',
                    timer: 1500,
                    showConfirmButton: false
                });
                // -----------------------
            } catch (error) {
                console.error("Error al eliminar servicio:", error);
            }
        }
    });
}

function abrirModalNuevoServicio() {
    const modalEl = document.getElementById('modalServicio');
    if (!modalEl) return;

    // 1. Limpiamos el ID de edición
    modalEl.removeAttribute('data-edit-id');
    
    // 2. Reseteamos el título
    modalEl.querySelector('.modal-title').innerText = "Nuevo Servicio";
    
    // 3. Vaciamos los inputs
    document.getElementById('serNom').value = '';
    document.getElementById('serCos').value = '';

    // 4. Ocultamos el botón de eliminar (porque es un servicio nuevo)
    const btnEliminar = document.getElementById('btnEliminarServicio');
    if (btnEliminar) btnEliminar.style.display = 'none';
    // ------------------------
    
    // 5. Lo abrimos manualmente
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();
}

async function listarServicios() {
    const sers = await db.servicios.toArray();
    const contenedor = document.getElementById('listaServicios');
    if (!contenedor) return;

    contenedor.innerHTML = sers.map(s => `
        <div class="col-md-3 mb-3">
            <div class="list-group-item card-servicio-lujo" 
                 onclick="prepararEdicionServicio(${s.id})" 
                 style="cursor: pointer;">
                <h6 class="fw-bold">${escaparHTML(s.nombre)}</h6>
                <div class="text-gold h4">${s.coste}€</div>
            </div>
        </div>
    `).join('');
}

async function prepararEdicionServicio(id) {
    const s = await db.servicios.get(parseInt(id));
    if (!s) return;

    const modalEl = document.getElementById('modalServicio');
    document.getElementById('serNom').value = s.nombre;
    document.getElementById('serCos').value = s.coste;

    // 1. Guardamos el ID en el modal para saber que estamos editando
    modalEl.setAttribute('data-edit-id', id);
    modalEl.querySelector('.modal-title').innerText = "Editar Servicio";

    // --- NUEVA LÍNEA AQUÍ ---
    // 2. MOSTRAMOS el botón de eliminar (porque estamos editando uno existente)
    const btnEliminar = document.getElementById('btnEliminarServicio');
    if (btnEliminar) btnEliminar.style.display = 'block';
    // ------------------------

    new bootstrap.Modal(modalEl).show();
}

async function ejecutarEliminarServicio() {
    const modalEl = document.getElementById('modalServicio');
    const id = modalEl.getAttribute('data-edit-id');

    if (id) {
        Swal.fire({
            ...swalConfig,
            icon: 'warning',
            title: '¿Eliminar servicio?',
            text: '¿Estás segura de que quieres eliminar este servicio definitivamente?',
            showCancelButton: true,
            confirmButtonText: 'Sí, eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#d33',
            cancelButtonColor: '#444'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    // 1. Borramos de la base de datos
                    await db.servicios.delete(parseInt(id));
                    
                    // 2. Cerramos el modal SOLO si se confirma y se borra
                    const modalInstance = bootstrap.Modal.getInstance(modalEl);
                    if (modalInstance) modalInstance.hide();
                    
                    // 3. Refrescamos las listas y selectores
                    if (typeof listarServicios === 'function') listarServicios();
                    if (typeof actualizarSelectores === 'function') actualizarSelectores();
                    
                    // 4. Aviso de éxito
                    Swal.fire({
                        ...swalConfig,
                        icon: 'success',
                        title: 'Eliminado',
                        text: 'El servicio ha sido quitado del catálogo.',
                        timer: 1500,
                        showConfirmButton: false
                    });

                } catch (error) {
                    console.error("Error al eliminar servicio:", error);
                    Swal.fire({
                        ...swalConfig,
                        icon: 'error',
                        title: 'Error',
                        text: 'No se pudo eliminar el servicio.'
                    });
                }
            }
        });
    }
} 

async function actualizarSelectores() {
    const clis = await db.clientas.toArray();
    const sers = await db.servicios.toArray();
    
    // 1. Ordenar clientas alfabéticamente
    clis.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", 'es', { sensitivity: 'base' }));

    const selCli = document.getElementById('selCli');
    const selSer = document.getElementById('selSer');
    
    if(selCli) {
        // Añadimos la opción vacía al principio para que no salga ninguna clienta por defecto
        selCli.innerHTML = '<option value="" disabled selected>--- Selecciona Clienta ---</option>' + 
            clis.map(c => `<option value="${c.id}">${escaparHTML(c.nombre)}</option>`).join('');
    }

    if(selSer) {
        // Añadimos la opción vacía al principio para los servicios
        selSer.innerHTML = '<option value="" disabled selected>--- Selecciona Servicio ---</option>' + 
            sers.map(s => `<option value="${s.id}">${escaparHTML(s.nombre)} (${s.coste}€)</option>`).join('');
    }
}

async function forzarDesbloqueo() {
    const idCita = document.getElementById('modalCita').getAttribute('data-edit-id');
    if (!idCita) return;

    Swal.fire({
        ...swalConfig,
        icon: 'warning',
        title: '¿Desbloquear cita cobrada?',
        text: 'Si la desbloqueas para editarla, se eliminará el registro de pago de las estadísticas. ¿Deseas continuar?',
        showCancelButton: true,
        confirmButtonText: 'Sí, desbloquear',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#444'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                // --- INICIO DE TU LÓGICA ORIGINAL ---
                // 1. Buscamos la venta
                const venta = await db.ventas.where('citaId').equals(parseInt(idCita)).first();
                
                // 2. Si existe, intentamos borrarla. Si NO existe, avisamos
                if (venta) {
                    await db.ventas.delete(venta.id);
                } else {
                    console.warn("No se encontró una venta vinculada a esta cita, pero procederemos a desbloquear.");
                }

                // 3. SOLO si el paso anterior no dio error, actualizamos la agenda
                await db.agenda.update(parseInt(idCita), { cobrado: false });

                // 4. Refresco total de la interfaz
                if (calendar) calendar.refetchEvents();
                if (typeof cargarHistorialVentas === 'function') await cargarHistorialVentas();
                if (typeof listarClientas === 'function') await listarClientas();
                
                // 5. Cerrar modal al final de todo el proceso exitoso
                const modalEl = document.getElementById('modalCita');
                const modalInstance = bootstrap.Modal.getInstance(modalEl);
                if (modalInstance) modalInstance.hide();

                Swal.fire({
                    ...swalConfig,
                    icon: 'success',
                    title: 'Cita Desbloqueada',
                    text: 'Los registros de venta han sido eliminados correctamente.',
                    confirmButtonText: 'Entendido'
                });
                // --- FIN DE TU LÓGICA ORIGINAL ---

            } catch (error) {
                console.error("Error al desbloquear:", error);
                Swal.fire({
                    ...swalConfig,
                    icon: 'error',
                    title: 'Error',
                    text: 'No se pudo completar el desbloqueo. Revisa la consola.'
                });
            }
        }
    });
}


 // COPIA DE SEGURIDAD RECTIFICADA
async function exportarBackup() {
    try {
        const { value: password } = await Swal.fire({
            ...swalConfig,
            title: 'Proteger copia de seguridad',
            text: 'Opcional: introduce una contraseña para cifrar el archivo. Déjalo vacío para guardar sin cifrar.',
            input: 'password',
            inputPlaceholder: 'Contraseña (opcional)',
            showCancelButton: true,
            confirmButtonText: 'Continuar',
            cancelButtonText: 'Cancelar'
        });
        if (password === undefined) return;

        const [clientas, servicios, agenda, ventas] = await Promise.all([
            db.clientas.toArray(),
            db.servicios.toArray(),
            db.agenda.toArray(),
            db.ventas.toArray()
        ]);
        
        const ahora = new Date();
        const backupData = {
            info: {
                fecha: ahora.toLocaleString(),
                totalRegistros: clientas.length + servicios.length + agenda.length + ventas.length
            },
            tablas: { clientas, servicios, agenda, ventas }
        };

        let contenidoFinal;
        let nombreArchivo;
        const fecha = ahora.toISOString().slice(0, 10);
        const horas = ahora.getHours().toString().padStart(2, '0');
        const minutos = ahora.getMinutes().toString().padStart(2, '0');

        if (password && password.trim() !== '') {
            contenidoFinal = JSON.stringify(await cifrarBackup(JSON.stringify(backupData), password.trim()), null, 2);
            nombreArchivo = `eli_backup_cifrado_${fecha}_${horas}-${minutos}.json`;
        } else {
            contenidoFinal = JSON.stringify(backupData, null, 2);
            nombreArchivo = `eli_backup_${fecha}_${horas}-${minutos}.json`;
        }

        const blob = new Blob([contenidoFinal], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = url;
        link.download = nombreArchivo;
        
        document.body.appendChild(link);
        link.click();
        
        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        }, 500);

        Swal.fire({
            ...swalConfig,
            icon: 'success',
            title: 'Copia de Seguridad Creada',
            text: password && password.trim()
                ? `Copia cifrada guardada como '${nombreArchivo}'.`
                : `Copia guardada como '${nombreArchivo}'.`,
            confirmButtonText: 'Entendido'
        });

    } catch (error) {
        console.error("Error en backup:", error);
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Error en Backup',
            text: 'Error al acceder a la base de datos. Asegúrate de que no tienes otras pestañas abiertas.',
            confirmButtonText: 'Cerrar'
        });
    }
}

// RESTAURAR COPIA DE SEGURIDAD EXTERNA
function dispararImportacionBackup() {
    const input = document.getElementById('importFileNavbar');
    if (input) input.click();
}

function extraerTablasBackup(contenido) {
    const origen = contenido.tablas || contenido;
    if (!origen || !Array.isArray(origen.clientas) || !Array.isArray(origen.servicios)) {
        throw new Error("El archivo de copia está incompleto o el formato no es válido.");
    }
    return {
        clientas: origen.clientas,
        servicios: origen.servicios,
        agenda: Array.isArray(origen.agenda) ? origen.agenda : [],
        ventas: Array.isArray(origen.ventas) ? origen.ventas : []
    };
}

function sanitizarRegistroImport(registro, camposTexto) {
    const limpio = { ...registro };
    camposTexto.forEach(campo => {
        if (typeof limpio[campo] === 'string') {
            limpio[campo] = limpio[campo].replace(/<[^>]*>/g, '').trim();
        }
    });
    return limpio;
}

function prepararTablasImport(tablas) {
    const camposClienta = ['nombre', 'telefono', 'email', 'direccion', 'cp', 'localidad', 'observaciones', 'fechaNacimiento'];
    const camposServicio = ['nombre'];

    const clientas = tablas.clientas.map(c => {
        const reg = sanitizarRegistroImport(c, camposClienta);
        if (reg.id != null) reg.id = parseInt(reg.id, 10);
        return reg;
    });

    const servicios = tablas.servicios.map(s => {
        const reg = sanitizarRegistroImport(s, camposServicio);
        if (reg.id != null) reg.id = parseInt(reg.id, 10);
        if (reg.coste != null) reg.coste = parseFloat(reg.coste);
        return reg;
    });

    const agenda = tablas.agenda.map(a => {
        const reg = { ...a };
        if (reg.id != null) reg.id = parseInt(reg.id, 10);
        if (reg.clienteId != null) reg.clienteId = parseInt(reg.clienteId, 10);
        if (reg.servicioId != null) reg.servicioId = parseInt(reg.servicioId, 10);
        return reg;
    });

    const ventas = tablas.ventas.map(v => {
        const reg = { ...v };
        if (reg.id != null) reg.id = parseInt(reg.id, 10);
        if (reg.clienteId != null) reg.clienteId = parseInt(reg.clienteId, 10);
        if (reg.servicioId != null) reg.servicioId = parseInt(reg.servicioId, 10);
        if (reg.citaId != null) reg.citaId = parseInt(reg.citaId, 10);
        if (reg.importe != null) reg.importe = parseFloat(reg.importe);
        return reg;
    });

    return { clientas, servicios, agenda, ventas };
}

async function volcarBackupEnBD(tablas) {
    const datos = prepararTablasImport(tablas);

    await db.transaction('rw', db.clientas, db.servicios, db.agenda, db.ventas, async () => {
        await db.clientas.clear();
        await db.servicios.clear();
        await db.agenda.clear();
        await db.ventas.clear();

        if (datos.clientas.length) await db.clientas.bulkPut(datos.clientas);
        if (datos.servicios.length) await db.servicios.bulkPut(datos.servicios);
        if (datos.agenda.length) await db.agenda.bulkPut(datos.agenda);
        if (datos.ventas.length) await db.ventas.bulkPut(datos.ventas);
    });
}

async function importarBackup(event) {
    const input = event.target;
    const archivo = input.files[0];
    if (!archivo) return;

    const resultado = await Swal.fire({
        ...swalConfig,
        icon: 'warning',
        title: '¿Reemplazar todos los datos?',
        text: 'Esto borrará toda la información actual y la sustituirá por la del archivo. Esta acción es irreversible.',
        showCancelButton: true,
        confirmButtonText: 'Sí, restaurar todo',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#444'
    });

    if (!resultado.isConfirmed) {
        input.value = "";
        return;
    }

    try {
        const texto = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error("No se pudo leer el archivo seleccionado."));
            reader.readAsText(archivo);
        });

        let contenido = JSON.parse(texto);

        if (contenido.encrypted === true) {
            const { value: password } = await Swal.fire({
                ...swalConfig,
                title: 'Copia cifrada',
                text: 'Introduce la contraseña para descifrar el archivo.',
                input: 'password',
                inputPlaceholder: 'Contraseña',
                showCancelButton: true,
                confirmButtonText: 'Descifrar',
                cancelButtonText: 'Cancelar'
            });
            if (!password) {
                input.value = "";
                return;
            }
            contenido = await descifrarBackup(contenido, password);
        }

        const tablas = extraerTablasBackup(contenido);
        await volcarBackupEnBD(tablas);

        await Swal.fire({
            ...swalConfig,
            icon: 'success',
            title: '¡Sistema Restaurado!',
            html: `<p>Importados: ${tablas.clientas.length} clientas, ${tablas.servicios.length} servicios, ${tablas.agenda.length} citas y ${tablas.ventas.length} ventas.</p><p>La página se recargará ahora.</p>`,
            confirmButtonText: 'Genial',
            allowOutsideClick: false
        });

        input.value = "";
        location.reload();

    } catch (error) {
        console.error("Error al importar:", error);
        input.value = "";
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: '¡Error al importar!',
            html: `
                <p>No se han realizado cambios en tus datos actuales.</p>
                <div style="background: #333; padding: 10px; border-radius: 5px; color: #ff5f5f; font-family: monospace; font-size: 0.85em; margin-top: 15px;">
                    ${escaparHTML(error.message || String(error))}
                </div>
            `,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#d33'
        });
    }
}

async function actualizarSugerenciasLocalidad() {
    const datalist = document.getElementById('listaLocalidades');
    if (!datalist) return;

    // 1. Obtenemos todas las clientas
    const clis = await db.clientas.toArray();

    // 2. Extraemos solo las localidades, quitamos vacíos y duplicados
    const localidadesUnicas = [...new Set(clis
        .map(c => c.localidad)
        .filter(l => l && l.trim() !== "")
    )];

    // 3. Ordenamos alfabéticamente
    localidadesUnicas.sort();

    // 4. Limpiamos y rellenamos el datalist
    datalist.innerHTML = localidadesUnicas
        .map(loc => `<option value="${escaparHTML(loc)}">`)
        .join('');
}


function mostrarAlertaCumple(cumpleañeras) {
    const modalEl = document.getElementById('modalCumple');
    const modal = new bootstrap.Modal(modalEl);
    const listaTexto = document.getElementById('listaCumplesTexto');
    const contenedorBotones = document.getElementById('contenedorBotonesCumple');
    
    listaTexto.innerHTML = cumpleañeras.length === 1 
        ? `Hoy es el cumple de <strong class="text-gold">${escaparHTML(cumpleañeras[0].nombre)}</strong>.`
        : `Hoy hay <strong>${cumpleañeras.length}</strong> clientas de cumpleaños:`;

    contenedorBotones.innerHTML = ''; 

    cumpleañeras.forEach(c => {
        const añoActual = new Date().getFullYear();
        const yaFelicitada = c.ultimoCumpleFelicitado === añoActual;
        
        const divFila = document.createElement('div');
        divFila.className = 'mb-4 p-3 border border-gold rounded bg-black text-white'; 
        divFila.id = 'fila-cumple-' + c.id;
        if (yaFelicitada) divFila.style.opacity = '0.4';
        
        divFila.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <span class="fw-bold">${escaparHTML(c.nombre)}</span>
                <span class="badge bg-gold text-dark">🎂 Regalo</span>
            </div>
            <div class="d-grid gap-2" id="wrapper-btn-${c.id}"></div>
        `;
        contenedorBotones.appendChild(divFila);

        const btn = document.createElement('button');
        btn.id = 'btn-cumple-' + c.id;
        
        if (yaFelicitada) {
            btn.className = 'btn btn-secondary w-100 mt-2';
            btn.innerHTML = '✅ Completado';
            btn.disabled = true;
        } else {
            btn.className = 'btn btn-success w-100';
            btn.innerHTML = '<i class="bi bi-whatsapp"></i> 1. Enviar a Clienta';
            btn.setAttribute('data-paso', '1');
            btn.onclick = function() {
                enviarWhatsAppCumple(c.telefono, c.nombre, c.id);
            };
        }

        document.getElementById('wrapper-btn-' + c.id).appendChild(btn);
    });

    modal.show();
}

function enviarWhatsAppCumple(telefono, nombre, id) {
    const miTelefono = "615821328"; 
    const boton = document.getElementById('btn-cumple-' + id);
    const paso = boton.getAttribute('data-paso');

    if (paso === '2') {
        const mensajeParaMi = "✅ Registro: Regalo enviado a *" + nombre + "*";
        window.open("https://wa.me/34" + miTelefono + "?text=" + encodeURIComponent(mensajeParaMi), '_blank');
        
        // Guardamos el año en la base de datos
        db.clientas.update(id, { ultimoCumpleFelicitado: new Date().getFullYear() });

        boton.innerHTML = "✅ Completado";
        boton.className = "btn btn-secondary w-100 mt-2";
        boton.disabled = true;
        document.getElementById('fila-cumple-' + id).style.opacity = '0.4';
    } else {
        const mensajeClienta = "¡Hola " + nombre + "! 🎂 Desde Eli·GR Nails te deseamos un muy feliz cumpleaños. ✨ Tenemos un regalito especial para ti en el salón, ¡pásate a vernos cuando quieras!";
        window.open("https://wa.me/34" + telefono + "?text=" + encodeURIComponent(mensajeClienta), '_blank');

        boton.innerHTML = "2. Registrar en MI WhatsApp";
        boton.className = "btn btn-info w-100 text-white mt-2"; 
        boton.setAttribute('data-paso', '2');
    }
}


// GRAFICOS
let chartSemana; 
let chartMes;    
Chart.register(ChartDataLabels); 

async function renderizarGraficos(ventas) {
    const canvasSem = document.getElementById('graficoSemanas');
    const canvasMes = document.getElementById('graficoMeses');
    if (!canvasSem || !canvasMes) return;

    // 1. IDENTIFICAR A SALON LOMA POR SU ID REAL
    const clientas = await db.clientas.toArray();
    const objetoLoma = clientas.find(c => c.nombre === "Salon Loma");
    const idLoma = objetoLoma ? objetoLoma.id : null;

    const ahora = new Date();
    const añoActual = ahora.getFullYear();

    function getWeekNumber(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    const semanaActual = getWeekNumber(ahora);
    
    // Arrays de datos
    const miosSem = Array(semanaActual).fill(0);
    const lomaSem = Array(semanaActual).fill(0);
    const totalSem = Array(semanaActual).fill(0);
    const miosMes = Array(12).fill(0);
    const lomaMes = Array(12).fill(0);
    const totalMes = Array(12).fill(0);

    // 2. PROCESAR VENTAS USANDO EL ID
    ventas.forEach(v => {
        const fVenta = parseFechaVenta(v.fecha);
        if (isNaN(fVenta.getTime()) || fVenta.getFullYear() !== añoActual) return;
            const mesIdx = fVenta.getMonth();
            const numSemana = getWeekNumber(fVenta);
            const importe = parseFloat(v.importe) || 0;
            
            // Comprobación infalible por ID
            const esLoma = (v.clienteId === idLoma);

            if (esLoma) {
                lomaMes[mesIdx] += importe;
                if (numSemana > 0 && numSemana <= semanaActual) lomaSem[numSemana - 1] += importe;
            } else {
                miosMes[mesIdx] += importe;
                if (numSemana > 0 && numSemana <= semanaActual) miosSem[numSemana - 1] += importe;
            }
            
            totalMes[mesIdx] += importe;
            if (numSemana > 0 && numSemana <= semanaActual) totalSem[numSemana - 1] += importe;
    });

    // 3. CONFIGURACIÓN DE DATASETS (Sincronizado con tus colores)
    const configurarDatasets = (dMios, dLoma, dTotal) => [
        {
            label: 'Total',
            data: dTotal,
            borderColor: '#ffc107', 
            borderWidth: 4,
            fill: false,
            //tension: 0.3,
            pointRadius: 0, 
            order: 3, // Al fondo
            datalabels: { align: 'top', anchor: 'end', color: '#ffc107', offset: 10, formatter: v => v > 0 ? v + '€' : '' }
        },
        {
            label: 'Mis Clientas',
            data: dMios,
            borderColor: '#eec9c3', 
            borderWidth: 3,
            fill: false,
            //tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#eec9c3',
            order: 1, // Al frente
            datalabels: { 
                align: 'bottom', 
                anchor: 'start', 
                color: '#eec9c3', 
                formatter: (v, ctx) => (dLoma[ctx.dataIndex] > 0 && v > 0) ? v + '€' : '' 
            }
        },
        {
            label: 'Salon Loma',
            data: dLoma,
            borderColor: 'green', 
            borderWidth: 2,
            fill: false,
            //tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: 'green',
            order: 2, // En medio
            datalabels: { align: 'top', anchor: 'center', color: 'green', formatter: v => v > 0 ? v + '€' : '' }
        }
    ];

    const opciones = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
            legend: { display: true, labels: { color: '#fff', boxWidth: 12, font: { size: 10 } } },
            datalabels: { display: true, font: { weight: 'bold', size: 10 } }
        },
        scales: {
            y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#fff', callback: v => v + '€' } },
            x: { grid: { display: false }, ticks: { color: '#fff' } }
        }
    };

    // 4. RENDERIZADO
    if (chartSemana) chartSemana.destroy();
    chartSemana = new Chart(canvasSem.getContext('2d'), {
        type: 'line',
        data: { labels: Array.from({length: semanaActual}, (_, i) => `S${i + 1}`), datasets: configurarDatasets(miosSem, lomaSem, totalSem) },
        options: opciones
    });

    if (chartMes) chartMes.destroy();
    chartMes = new Chart(canvasMes.getContext('2d'), {
        type: 'line',
        data: { labels: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"], datasets: configurarDatasets(miosMes, lomaMes, totalMes) },
        options: opciones
    });
}

//Lógica para el calendario de Gmail
async function crearEventoGoogle(cita) {
    if (!gapi.client.calendar) {
        console.error("Google Calendar no está listo");
        return;
    }

    try {
        // Aseguramos que las fechas sean objetos Date antes de convertirlas a ISO
        const inicioISO = new Date(cita.fechaInicio).toISOString();
        const finISO = new Date(cita.fechaFin).toISOString();

        const evento = {
            'summary': `💅 ${cita.nombreClienta}`,
            'description': `Servicio: ${cita.servicio}`,
            'start': {
                'dateTime': inicioISO,
                'timeZone': 'Europe/Madrid'
            },
            'end': {
                'dateTime': finISO,
                'timeZone': 'Europe/Madrid'
            }
        };

        const response = await gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': evento,
        });

        console.log('✅ Evento creado en Google Calendar: ' + response.result.htmlLink);
        return response.result.id; 
    } catch (err) {
        console.error('❌ Error creando evento en Google:', err);
        // Si el error es 401, es que el token ha caducado y hay que volver a conectar
        if (err.status === 401) {
            Swal.fire({
                ...swalConfig,
                icon: 'error',
                title: 'Sesión de Google Caducada',
                text: 'La sesión de Google ha caducado. Por favor, pulsa "Conectar Calendario" de nuevo.',
                confirmButtonText: 'Entendido'
            });
        }
    }
}


// Google Calendar — carga bajo demanda (solo al pulsar el botón)
const GOOGLE_GSI_URL = 'https://accounts.google.com/gsi/client';
const GOOGLE_GAPI_URL = 'https://apis.google.com/js/api.js';
let googleCargaPromesa = null;

function cargarScriptExterno(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
        document.head.appendChild(script);
    });
}

async function asegurarGoogleListo() {
    if (googleCargaPromesa) return googleCargaPromesa;

    googleCargaPromesa = (async () => {
        await cargarScriptExterno(GOOGLE_GSI_URL);
        await cargarScriptExterno(GOOGLE_GAPI_URL);

        await new Promise((resolve, reject) => {
            if (typeof gapi === 'undefined') {
                reject(new Error('Google API no disponible'));
                return;
            }
            gapi.load('client', resolve);
        });

        await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
        gapiInited = true;

        if (!gsiInited && typeof google !== 'undefined') {
            inicializarGoogle();
        }
    })();

    return googleCargaPromesa;
}

function inicializarGoogle() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.error) {
                console.warn("Google OAuth:", tokenResponse.error);
                actualizarBotonGoogle(false);
                if (window._googleAuthManual) {
                    mostrarErrorGoogleOAuth(tokenResponse.error);
                }
                window._googleAuthManual = false;
                return;
            }
            if (tokenResponse && tokenResponse.access_token) {
                gapi.client.setToken(tokenResponse);
                console.log("✅ Acceso concedido a Google Calendar");
                actualizarBotonGoogle(true);
            }
            window._googleAuthManual = false;
        },
        error_callback: (err) => {
            console.warn("Google OAuth error:", err);
            actualizarBotonGoogle(false);
            if (window._googleAuthManual) {
                mostrarErrorGoogleOAuth(err?.type || 'unknown');
            }
            window._googleAuthManual = false;
        },
    });
    gsiInited = true;
}

function mostrarErrorGoogleOAuth(codigo) {
    const origen = window.location.origin;
    Swal.fire({
        ...swalConfig,
        icon: 'info',
        title: 'Google Calendar no conectado',
        html: `
            <p style="text-align:left;font-size:0.9rem;">
                No se pudo autorizar desde <strong>${escaparHTML(origen)}</strong>.
            </p>
            <p style="text-align:left;font-size:0.85rem;color:#aaa;">
                Si usas Live Server o XAMPP, hay que registrar ese origen en
                <strong>Google Cloud Console → Credenciales → Orígenes JavaScript autorizados</strong>:
            </p>
            <ul style="text-align:left;font-size:0.85rem;">
                <li><code>http://localhost</code> (XAMPP)</li>
                <li><code>http://127.0.0.1:5500</code> (Live Server)</li>
                <li><code>http://localhost:5500</code> (Live Server alternativo)</li>
            </ul>
            <p style="text-align:left;font-size:0.8rem;color:#888;">Código: ${escaparHTML(String(codigo))}</p>
        `,
        confirmButtonText: 'Entendido'
    });
}

function solicitarTokenGoogle(manual = false) {
    if (!tokenClient) {
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Google aún no está listo',
            text: 'Espera un segundo y vuelve a pulsar el botón de Google.',
            confirmButtonText: 'Entendido'
        });
        return;
    }
    window._googleAuthManual = manual;
    tokenClient.requestAccessToken({ prompt: manual ? 'select_account' : '' });
}

function estaGoogleConectado() {
    return typeof gapi !== 'undefined'
        && gapi.client
        && typeof gapi.client.getToken === 'function'
        && gapi.client.getToken() !== null;
}

function actualizarBotonGoogle(conectado) {
    const btn = document.getElementById('btnConectarGoogle');
    if (!btn) return;

    if (conectado) {
        btn.classList.add('connected');
        btn.title = 'Google Calendar conectado (pulsa para desconectar)';
    } else {
        btn.classList.remove('connected');
        btn.title = 'Conectar con Google Calendar (opcional)';
    }
}

async function manejarAuthClick() {
    if (estaGoogleConectado()) {
        const { isConfirmed } = await Swal.fire({
            ...swalConfig,
            icon: 'question',
            title: '¿Desconectar Google Calendar?',
            text: 'Las citas seguirán en la app, pero no se sincronizarán con Google hasta que vuelvas a conectar.',
            showCancelButton: true,
            confirmButtonText: 'Sí, desconectar',
            cancelButtonText: 'Cancelar'
        });
        if (isConfirmed) {
            const token = gapi.client.getToken();
            if (token?.access_token && google?.accounts?.oauth2?.revoke) {
                google.accounts.oauth2.revoke(token.access_token, () => {});
            }
            gapi.client.setToken(null);
            actualizarBotonGoogle(false);
        }
        return;
    }

    try {
        await asegurarGoogleListo();
        solicitarTokenGoogle(true);
    } catch (error) {
        console.error('Error cargando Google:', error);
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Google Calendar no disponible',
            text: 'Comprueba tu conexión a internet e inténtalo de nuevo.',
            confirmButtonText: 'Entendido'
        });
    }
}

async function actualizarEventoGoogle(googleEventId, datos) {
    if (!gapi.client.calendar || !googleEventId) return;
    try {
        await gapi.client.calendar.events.patch({
            'calendarId': 'primary',
            'eventId': googleEventId,
            'resource': {
                'summary': `${datos.nombreClienta} - ${datos.servicio}`,
                'start': { 'dateTime': new Date(datos.fechaInicio).toISOString() },
                'end': { 'dateTime': datos.fechaFin }
            }
        });
        console.log('✅ Evento actualizado en Google con éxito');
    } catch (err) {
        console.error('❌ Error al actualizar en Google:', err);
    }
}