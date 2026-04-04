// 1. CONFIGURACIÓN DE BASE DE DATOS (DEXIE)
const db = new Dexie("SalonDB");
db.version(1).stores({
    clientas: "++id, nombre, apellidos, telefono, direccion, cp, poblacion, cumpleaños, observaciones",
    servicios: "++id, nombre, coste",
    agenda: "++id, clienteId, servicioId, fecha"
});

let calendar;

// 2. INICIALIZACIÓN AL CARGAR EL DOM
document.addEventListener('DOMContentLoaded', () => {
    initCalendar();
    actualizarSelectores();
    listarServicios();
    listarClientes();
});

// 3. FUNCIÓN DEL CALENDARIO
function initCalendar() {
    const calendarEl = document.getElementById('calendario');
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        locale: 'es',
        firstDay: 1,
        allDaySlot: false,
        nowIndicator: true,

        // --- FORMATO DE HORA (Ajustado para legibilidad) ---
        slotLabelFormat: {
            hour: 'numeric',
            minute: '2-digit',
            omitZeroMinute: false,
            meridiem: false,
            hour12: false
        },
        slotLabelContent: function(arg) {
            return { html: '&nbsp;' + arg.text + '&nbsp;' }; 
        },
        slotLabelInterval: "00:30", 
        
        // --- CONFIGURACIÓN DE TIEMPOS ---
        slotMinTime: '10:00:00', 
        slotMaxTime: '21:00:00',
        slotDuration: '00:15:00', 
        
        businessHours: {
            daysOfWeek: [ 1, 2, 3, 4, 5 ],
            startTime: '10:00',
            endTime: '21:00',
        },

        headerToolbar: { 
            left: 'prev,next today', 
            center: 'title', 
            right: 'timeGridWeek,timeGridDay' 
        },

        // --- COMPORTAMIENTO AUTOMÁTICO ---
        datesSet: function(info) {
            if (info.view.type === 'timeGridDay') {
                const hoy = new Date().toDateString();
                const diaVista = info.view.currentStart.toDateString();
                if (diaVista !== hoy) {
                    calendar.today();
                }
            }
        },

        expandRows: true,
        height: 'auto',

        // --- CARGA DE EVENTOS ---
        events: async function(info, successCallback) {
            try {
                const citas = await db.agenda.toArray();
                const eventos = await Promise.all(citas.map(async (c) => {
                    const cli = await db.clientas.get(c.clienteId);
                    const ser = await db.servicios.get(c.servicioId);
                    return {
                        id: c.id,
                        title: `${cli ? cli.nombre : 'S/N'} - ${ser ? ser.nombre : ''}`,
                        start: c.fecha,
                        backgroundColor: '#e69c9c', 
                        borderColor: '#c5a059',      
                        textColor: '#1a1a1a'
                    };
                }));
                successCallback(eventos);
            } catch (e) { console.error(e); }
        },

        // Click en hueco vacío (NUEVA CITA)
        dateClick: function(info) {
            const modalEl = document.getElementById('modalCita');
            modalEl.removeAttribute('data-edit-id'); // Limpiamos ID de edición
            document.getElementById('modalCitaTitulo').innerText = "Nueva Cita";
            
            const inputFecha = document.getElementById('citaFecha');
            if (inputFecha) inputFecha.value = info.dateStr.substring(0, 16);
            
            new bootstrap.Modal(modalEl).show();
        },

        // Click en cita existente (EDITAR/ELIMINAR)
        eventClick: function(info) {
            prepararEdicionCita(info.event.id);
        }
    });

    calendar.render();
}

// 4. GESTIÓN DE CITAS (AGENDA)
async function prepararEdicionCita(id) {
    const cita = await db.agenda.get(parseInt(id));
    if (!cita) return;

    const modalEl = document.getElementById('modalCita');
    modalEl.setAttribute('data-edit-id', id); // Guardamos el ID para saber que editamos
    
    document.getElementById('modalCitaTitulo').innerText = "Gestionar Cita";
    document.getElementById('selCli').value = cita.clienteId;
    document.getElementById('selSer').value = cita.servicioId;
    document.getElementById('citaFecha').value = cita.fecha.substring(0, 16);

    new bootstrap.Modal(modalEl).show();
}

async function agendarCita() {
    const modalEl = document.getElementById('modalCita');
    const editId = modalEl.getAttribute('data-edit-id');

    const cId = document.getElementById('selCli').value;
    const sId = document.getElementById('selSer').value;
    const f = document.getElementById('citaFecha').value;

    if (!cId || !sId || !f) return alert("Por favor, completa todos los campos");

    const datos = { 
        clienteId: parseInt(cId), 
        servicioId: parseInt(sId), 
        fecha: f 
    };

    if (editId) {
        await db.agenda.update(parseInt(editId), datos);
    } else {
        await db.agenda.add(datos);
    }

    calendar.refetchEvents();
    bootstrap.Modal.getInstance(modalEl).hide();
    modalEl.removeAttribute('data-edit-id');
}

async function eliminarCita() {
    const modalEl = document.getElementById('modalCita');
    const id = modalEl.getAttribute('data-edit-id');
    
    if (!id) return;
    
    if (confirm("¿Seguro que quieres eliminar esta cita?")) {
        await db.agenda.delete(parseInt(id));
        calendar.refetchEvents();
        bootstrap.Modal.getInstance(modalEl).hide();
        modalEl.removeAttribute('data-edit-id');
    }
}

// 5. GESTIÓN DE CLIENTES
async function listarClientes(filtrados = null) {
    const div = document.getElementById('listaClientes');
    if (!div) return;
    const lista = filtrados || await db.clientas.orderBy('nombre').toArray();
    
    div.innerHTML = lista.map(c => `
        <div class="list-group-item d-flex justify-content-between align-items-center shadow-sm p-3 mb-2">
            <div onclick="prepararEdicion(${c.id})" style="cursor:pointer; flex-grow:1;">
                <h6 class="mb-0 fw-bold">${c.nombre} ${c.apellidos}</h6>
                <small class="text-muted"><i class="fa-solid fa-phone me-1"></i>${c.telefono || '--'}</small>
            </div>
            <div class="btn-group">
                <button class="btn btn-sm btn-outline-primary border-0" onclick="prepararEdicion(${c.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-sm btn-outline-danger border-0" onclick="eliminarCliente(${c.id})"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
    `).join('');
}

async function filtrarClientes() {
    const texto = document.getElementById('inputBusqueda').value.toLowerCase();
    const todos = await db.clientas.toArray();
    const filtrados = todos.filter(c => {
        const full = (c.nombre + " " + (c.apellidos || "")).toLowerCase();
        return full.includes(texto) || (c.telefono || "").includes(texto);
    });
    listarClientes(filtrados); 
}

function prepararNuevoCliente() {
    const campos = ['edit_cli_id', 'nom', 'ape', 'tel', 'dir', 'cp', 'pob', 'cumple', 'obs'];
    campos.forEach(id => document.getElementById(id).value = '');
    document.getElementById('modalClienteTitulo').innerText = 'Nueva Clienta';
}

async function prepararEdicion(id) {
    const c = await db.clientas.get(id);
    if (!c) return;
    document.getElementById('edit_cli_id').value = c.id;
    document.getElementById('nom').value = c.nombre;
    document.getElementById('ape').value = c.apellidos;
    document.getElementById('tel').value = c.telefono;
    document.getElementById('dir').value = c.direccion || '';
    document.getElementById('cp').value = c.cp || '';
    document.getElementById('pob').value = c.poblacion || '';
    document.getElementById('cumple').value = c.cumpleaños || '';
    document.getElementById('obs').value = c.observaciones || '';
    document.getElementById('modalClienteTitulo').innerText = 'Editar Clienta';
    new bootstrap.Modal(document.getElementById('modalNuevoCliente')).show();
}

async function guardarCliente() {
    const id = document.getElementById('edit_cli_id').value;
    const datos = {
        nombre: document.getElementById('nom').value,
        apellidos: document.getElementById('ape').value,
        telefono: document.getElementById('tel').value,
        direccion: document.getElementById('dir').value,
        cp: document.getElementById('cp').value,
        poblacion: document.getElementById('pob').value,
        cumpleaños: document.getElementById('cumple').value,
        observaciones: document.getElementById('obs').value
    };
    if (id) await db.clientas.update(parseInt(id), datos);
    else await db.clientas.add(datos);
    
    bootstrap.Modal.getInstance(document.getElementById('modalNuevoCliente')).hide();
    listarClientes();
    actualizarSelectores();
}

async function eliminarCliente(id) {
    if (confirm("¿Eliminar clienta?")) { 
        await db.clientas.delete(id); 
        listarClientes(); 
        actualizarSelectores(); 
    }
}

// 6. GESTIÓN DE SERVICIOS
async function listarServicios() {
    const todos = await db.servicios.toArray();
    const lista = document.getElementById('listaServicios');
    if (!lista) return;

    todos.sort((a, b) => a.nombre.localeCompare(b.nombre));

    lista.innerHTML = todos.map(s => `
        <li class="list-group-item d-flex align-items-center py-3 border-0 border-bottom">
            <div class="flex-grow-1" onclick="prepararEdicionServicio(${s.id})" style="cursor:pointer;">
                <span class="fw-bold text-uppercase" style="color: var(--negro-suave);">${s.nombre}</span>
            </div>
            <div class="me-3">
                <span class="fw-bold" style="color: var(--dorado); font-size: 1.1rem;">${s.coste}€</span>
            </div>
            <div class="btn-group">
                <button class="btn btn-sm text-muted" onclick="prepararEdicionServicio(${s.id})"><i class="fa-solid fa-pen fa-xs"></i></button>
                <button class="btn btn-sm text-danger opacity-50" onclick="eliminarServicio(${s.id})"><i class="fa-solid fa-trash fa-xs"></i></button>
            </div>
        </li>
    `).join('');
}

function prepararNuevoServicio() {
    document.getElementById('edit_ser_id').value = '';
    document.getElementById('sNom').value = '';
    document.getElementById('sPre').value = '';
    document.getElementById('modalServicioTitulo').innerHTML = '<i class="fa-solid fa-plus me-2"></i>Nuevo Servicio';
}

async function prepararEdicionServicio(id) {
    const s = await db.servicios.get(id);
    if (!s) return;
    document.getElementById('edit_ser_id').value = s.id;
    document.getElementById('sNom').value = s.nombre;
    document.getElementById('sPre').value = s.coste;
    document.getElementById('modalServicioTitulo').innerHTML = '<i class="fa-solid fa-pen-to-square me-2"></i>Editar Servicio';
    new bootstrap.Modal(document.getElementById('modalNuevoServicio')).show();
}

async function guardarServicio() {
    const id = document.getElementById('edit_ser_id').value;
    const nombre = document.getElementById('sNom').value;
    const precio = document.getElementById('sPre').value;

    if (!nombre || !precio) return alert("Nombre y precio son obligatorios");
    const datos = { nombre, coste: precio };

    if (id) await db.servicios.update(parseInt(id), datos);
    else await db.servicios.add(datos);

    bootstrap.Modal.getInstance(document.getElementById('modalNuevoServicio')).hide();
    listarServicios();
    actualizarSelectores();
}

async function eliminarServicio(id) {
    if (confirm("¿Seguro que quieres eliminar este servicio?")) {
        await db.servicios.delete(id);
        listarServicios();
        actualizarSelectores();
    }
}

// 7. UTILIDADES
async function actualizarSelectores() {
    const clis = await db.clientas.orderBy('nombre').toArray();
    const sers = await db.servicios.toArray();
    const selCli = document.getElementById('selCli');
    const selSer = document.getElementById('selSer');
    
    if (selCli) selCli.innerHTML = clis.map(c => `<option value="${c.id}">${c.nombre} ${c.apellidos}</option>`).join('');
    if (selSer) selSer.innerHTML = sers.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}

async function descargarBackup() {
    const data = { 
        clientas: await db.clientas.toArray(), 
        agenda: await db.agenda.toArray(), 
        servicios: await db.servicios.toArray() 
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Backup_Salon_EliGR.json`;
    link.click();
}