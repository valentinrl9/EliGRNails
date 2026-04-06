// =========================================
// 1. CONFIGURACIÓN DE BASE DE DATOS (V2)
// =========================================
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

let calendar;
let citaParaCobrar = null;

// =========================================
// 2. INICIALIZACIÓN AL CARGAR LA PÁGINA
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    initCalendar();
    listarClientas();
    listarServicios();
    actualizarSelectores();
});

// =========================================
// 3. LÓGICA DEL CALENDARIO (FullCalendar)
// =========================================
function initCalendar() {
    const calendarEl = document.getElementById('calendario');
    if (!calendarEl) return;

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        locale: 'es',
        firstDay: 1,
        allDaySlot: false,
        nowIndicator: true,
        slotMinTime: '10:00:00',
        slotMaxTime: '21:00:00',
        slotDuration: '00:30:00',
        slotLabelInterval: "00:30",
        defaultTimedEventDuration: '01:30:00',
        slotLabelFormat: {
            hour: '2-digit',
            minute: '2-digit',
            omitZeroMinute: false, // Esto fuerza el :00
            meridiem: false,
            hour12: false // Formato 24h
        },
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'timeGridWeek,timeGridDay'
        },

        // Click en hueco vacío (Nueva Cita)
        dateClick: function(info) {
            const modalEl = document.getElementById('modalCita');
            
            // 1. Limpiamos el ID de edición (esto indica que es NUEVA cita)
            modalEl.removeAttribute('data-edit-id');
            
            // 2. DESBLOQUEAMOS todos los campos y botones (IMPORTANTE)
            const inputs = modalEl.querySelectorAll('input, select');
            inputs.forEach(i => i.disabled = false); // Volver a habilitar
            
            const btnGuardar = modalEl.querySelector('button[onclick="agendarCita()"]');
            const btnEliminar = document.getElementById('btnEliminarCita');
            const btnCobrar = document.getElementById('btnCobrarCita');

            // 3. Restauramos la visualización original
            document.getElementById('modalCitaTitulo').innerText = "Nueva Cita";
            btnGuardar.style.display = 'block';
            btnEliminar.style.display = 'none'; // No se puede eliminar algo que no existe
            btnCobrar.style.display = 'none';   // No se puede cobrar algo que no existe
            
            // Restaurar estilo del botón cobrar por si venía de una cita bloqueada
            btnCobrar.disabled = false;
            btnCobrar.classList.replace('btn-secondary', 'btn-success');
            btnCobrar.innerHTML = '<i class="fa-solid fa-cash-register me-2"></i> FINALIZAR Y COBRAR';

            // 4. Seteamos la fecha (con el redondeo de 15 min que ya tenías)
            let fecha = new Date(info.date);
            fecha.setMinutes(Math.round(fecha.getMinutes() / 15) * 15);
            const tzoffset = (new Date()).getTimezoneOffset() * 60000;
            const localISOTime = (new Date(fecha - tzoffset)).toISOString().slice(0, 16);
            document.getElementById('citaFecha').value = localISOTime;
            
            new bootstrap.Modal(modalEl).show();
        },

        // Click en cita existente (Editar/Cobrar)
        eventClick: function(info) {
            if (info.event && info.event.id) {
                prepararEdicionCita(info.event.id);
            }
        },

        // Carga de eventos desde Dexie
        // Dentro de initCalendar -> events:
        events: async function(info, successCallback) {
            const citas = await db.agenda.toArray();
            const eventos = await Promise.all(citas.map(async (c) => {
                const cli = await db.clientas.get(c.clienteId);
                const ser = await db.servicios.get(c.servicioId);
                const isCobrado = (c.cobrado === true || c.cobrado === "true");
                
                // Si está cobrada, añadimos el check y cambiamos estilo
                const titulo = c.cobrado ? `✅ ${cli.nombre}` : `${cli ? cli.nombre : 'S/N'}`;
                const colorFondo = c.cobrado ? '#d1d1d1' : '#e69c9c'; // Gris si está cobrada
                const colorBorde = c.cobrado ? '#bc9c59' : '#c5a059';

                return {
                    id: c.id,
                    title: `${titulo} - ${ser ? ser.nombre : ''}`,
                    start: c.fecha,
                    backgroundColor: colorFondo,
                    borderColor: colorBorde,
                    textColor: c.cobrado ? '#777' : '#1a1a1a',
                    extendedProps: { cobrado: c.cobrado } // Pasamos esta info para el bloqueo
                };
            }));
            successCallback(eventos);
        }
    });
    calendar.render();
}

// =========================================
// 4. GESTIÓN DE CITAS
// =========================================
async function prepararEdicionCita(id) {
    const cita = await db.agenda.get(parseInt(id));
    if (!cita) return;

    const modalEl = document.getElementById('modalCita');
    modalEl.setAttribute('data-edit-id', id);
    
    // Referencias a elementos
    const btnGuardar = modalEl.querySelector('button[onclick="agendarCita()"]');
    const btnEliminar = document.getElementById('btnEliminarCita');
    const btnCobrar = document.getElementById('btnCobrarCita');
    const inputs = modalEl.querySelectorAll('input, select');

    if (cita.cobrado) {
        document.getElementById('modalCitaTitulo').innerText = "Cita Finalizada (Bloqueada)";
        // Desactivar todo
        inputs.forEach(i => i.disabled = true);
        btnGuardar.style.display = 'none';
        btnEliminar.style.display = 'none';
        btnCobrar.innerHTML = '<i class="fa-solid fa-lock me-2"></i> YA COBRADO';
        btnCobrar.disabled = true;
        btnCobrar.classList.replace('btn-success', 'btn-secondary');
        document.getElementById('btnForzarDesbloqueo').style.display = 'inline-block'; // Mostrar botón de pánico
    } else {
        document.getElementById('modalCitaTitulo').innerText = "Gestionar Cita";
        // Activar todo
        inputs.forEach(i => i.disabled = false);
        btnGuardar.style.display = 'block';
        btnEliminar.style.display = 'block';
        btnCobrar.innerHTML = '<i class="fa-solid fa-cash-register me-2"></i> FINALIZAR Y COBRAR';
        btnCobrar.disabled = false;
        btnCobrar.classList.replace('btn-secondary', 'btn-success');
        btnCobrar.style.display = 'block';
        document.getElementById('btnForzarDesbloqueo').style.display = 'none'; // Esconderlo si está pendiente
    }

    document.getElementById('selCli').value = cita.clienteId;
    document.getElementById('selSer').value = cita.servicioId;
    document.getElementById('citaFecha').value = cita.fecha;

    new bootstrap.Modal(modalEl).show();
}

async function agendarCita() {
    const modalEl = document.getElementById('modalCita');
    const editId = modalEl.getAttribute('data-edit-id');
    
    // 1. Recogemos los valores básicos
    const clienteId = parseInt(document.getElementById('selCli').value);
    const servicioId = parseInt(document.getElementById('selSer').value);
    const fecha = document.getElementById('citaFecha').value;

    if (!clienteId || !servicioId || !fecha) {
        alert("Por favor, rellena todos los campos.");
        return;
    }

    if (editId) {
        // 2. Si editamos, solo actualizamos los campos que cambian.
        // NO tocamos el campo 'cobrado' para que no se desconfigure.
        await db.agenda.update(parseInt(editId), {
            clienteId: clienteId,
            servicioId: servicioId,
            fecha: fecha
        });
    } else {
        // 3. Si es nueva, la creamos con cobrado: false por defecto
        await db.agenda.add({
            clienteId: clienteId,
            servicioId: servicioId,
            fecha: fecha,
            cobrado: false
        });
    }

    // 4. Refrescamos y cerramos
    calendar.refetchEvents();
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();
}

async function eliminarCita() {
    const id = document.getElementById('modalCita').getAttribute('data-edit-id');
    if (id && confirm("¿Estás segura de eliminar esta cita?")) {
        await db.agenda.delete(parseInt(id));
        calendar.refetchEvents();
        bootstrap.Modal.getInstance(document.getElementById('modalCita')).hide();
    }
}

// =========================================
// 5. SISTEMA DE COBROS Y VENTAS
// =========================================
// Al iniciar el cobro, ponemos el precio base del servicio en el input
async function iniciarCobro() {
    const idCita = document.getElementById('modalCita').getAttribute('data-edit-id');
    if (!idCita) return alert("Guarda la cita antes de cobrar.");

    // 1. LEER EL SERVICIO SELECCIONADO EN PANTALLA (NO EL DE LA BD)
    const idServicioEnPantalla = parseInt(document.getElementById('selSer').value);

    // 2. BUSCAR LOS DATOS DE ESE SERVICIO ESPECÍFICO
    const servicioReal = await db.servicios.get(idServicioEnPantalla);
    const citaActual = await db.agenda.get(parseInt(idCita));

    if (!servicioReal || !citaActual) {
        alert("Error al recuperar los datos del servicio o la cita.");
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
    const importeFinal = parseFloat(document.getElementById('inputImporteFinal').value);
    const metodo = document.getElementById('metodoPago').value;

    if (isNaN(importeFinal) || importeFinal < 0) {
        alert("Por favor, introduce un importe válido.");
        return;
    }
    await db.ventas.add({
        citaId: citaParaCobrar.id, // <--- Añadimos esto
        clienteId: citaParaCobrar.clienteId,
        servicioId: citaParaCobrar.servicioId,
        fecha: new Date().toISOString(),
        importe: importeFinal,
        metodoPago: metodo
    });

    await db.agenda.update(citaParaCobrar.id, { cobrado: true });
    
    calendar.refetchEvents();
    bootstrap.Modal.getInstance(document.getElementById('modalCobro')).hide();
    
    // Si tienes abierta la pestaña de ventas, la actualizamos
    if(typeof cargarHistorialVentas === 'function') cargarHistorialVentas();
    alert(`Venta registrada: ${importeFinal}€`);
}

async function revertirCobro(ventaId, citaId) {
    if (!confirm("¿Segura que quieres anular este cobro? La cita volverá a estar pendiente.")) return;

    try {
        // 1. Eliminamos el registro de la venta
        await db.ventas.delete(parseInt(ventaId));

        // 2. IMPORTANTE: Cambiamos el estado en la agenda
        // Usamos parseInt para asegurar que el ID es numérico
        await db.agenda.update(parseInt(citaId), { cobrado: false });

        // 3. Forzamos la actualización de la interfaz
        alert("Cobro anulado. La cita vuelve a estar pendiente.");
        
        // Refrescar tabla de ventas
        await cargarHistorialVentas();
        
        // Refrescar calendario
        if (calendar) {
            calendar.refetchEvents();
        }

    } catch (error) {
        console.error("Error al revertir:", error);
        alert("No se pudo anular el cobro.");
    }
}

async function cargarHistorialVentas() {
    const ventas = await db.ventas.orderBy('fecha').reverse().toArray();
    const tabla = document.getElementById('tablaVentasBody');
    let totalAcumulado = 0;

    const filasHTML = await Promise.all(ventas.map(async (v) => {
        const cli = await db.clientas.get(v.clienteId);
        const ser = await db.servicios.get(v.servicioId);
        totalAcumulado += v.importe;
        
        const fechaFormateada = new Date(v.fecha).toLocaleString('es-ES', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });

        return `
            <tr>
                <td>${fechaFormateada}</td>
                <td>${cli ? cli.nombre : 'Eliminada'}</td>
                <td>${ser ? ser.nombre : 'Eliminado'}</td>
                <td><span class="badge bg-secondary">${v.metodoPago}</span></td>
                <td class="fw-bold">${v.importe}€</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-danger" onclick="revertirCobro(${v.id}, ${v.citaId})">
                        <i class="fa-solid fa-rotate-left"></i> Anular
                    </button>
                </td>
            </tr>
        `;
    }));

    tabla.innerHTML = filasHTML.join('');
    document.getElementById('totalCajaGeneral').innerText = `${totalAcumulado.toFixed(2)}€`;
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

    // 4. Mostramos el modal
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();
    actualizarSugerenciasLocalidad(); // <--- Añade esto
}

async function guardarClienta() {
    const modalEl = document.getElementById('modalClienta');
    const id = modalEl.getAttribute('data-edit-id');
    
    // Recogemos Día y Mes para formar el string de cumpleaños
    const dia = document.getElementById('selectDia').value;
    const mes = document.getElementById('selectMes').value;
    const cumpleStr = (dia && mes) ? `${dia}/${mes}` : "";

    const datos = {
        nombre: document.getElementById('inputNombre').value,
        telefono: document.getElementById('inputTelefono').value,
        email: document.getElementById('inputEmail').value,
        fechaNacimiento: cumpleStr, // Guardado como "Día/Mes"
        direccion: document.getElementById('inputDireccion').value,
        cp: document.getElementById('inputCP').value,
        localidad: document.getElementById('inputLocalidad').value,
        observaciones: document.getElementById('inputObservaciones').value
    };

    // Validación mínima
    if (!datos.nombre) {
        alert("Por favor, introduce al menos el nombre de la clienta.");
        return;
    }

    try {
        if (id) {
            // Editando clienta existente
            await db.clientas.update(parseInt(id), datos);
            console.log("Clienta actualizada con éxito");
        } else {
            // Añadiendo nueva clienta
            await db.clientas.add(datos);
            console.log("Nueva clienta añadida con éxito");
        }

        // Refrescar la interfaz
        listarClientas();
        if (typeof actualizarSelectores === "function") actualizarSelectores();
        
        // Cerrar modal y limpiar
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
        
        document.getElementById('formClienta').reset();
        modalEl.removeAttribute('data-edit-id');

    } catch (error) {
        console.error("Error al guardar clienta:", error);
        alert("Hubo un error al guardar los datos.");
    }
}

async function prepararEdicionClienta(id) {
    // 1. Buscamos la clienta en la base de datos
    const c = await db.clientas.get(parseInt(id));
    if (!c) return;

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

    // 5. Mostramos el modal
    const modalInstance = new bootstrap.Modal(modalEl);
    modalInstance.show();
    actualizarSugerenciasLocalidad(); // <--- Añade esto
}

async function listarClientas() {
    const clis = await db.clientas.toArray();
    const contenedor = document.getElementById('listaClientes');
    if (!contenedor) return;

    // Ordenar alfabéticamente por nombre
    clis.sort((a, b) => a.nombre.localeCompare(b.nombre));

    contenedor.innerHTML = clis.map(c => `
        <div class="col-md-4 mb-3">
            <div class="list-group-item p-3 shadow-sm border-gold bg-dark text-white h-100" 
                 onclick="prepararEdicionClienta(${c.id})" 
                 style="cursor: pointer; border-left: 4px solid #d4af37;">
                <div class="d-flex justify-content-between align-items-start">
                    <h6 class="mb-1 fw-bold text-gold">${c.nombre}</h6>
                    ${c.fechaNacimiento ? `<small class="text-muted"><i class="fa-solid fa-cake-candles"></i> ${c.fechaNacimiento}</small>` : ''}
                </div>
                <p class="mb-0 small" style="color: #e0e0e0;">
                    <i class="fa-solid fa-phone me-2 text-gold"></i>${c.telefono || 'Sin teléfono'}
                </p>
            </div>
        </div>
    `).join('');
}


async function ejecutarEliminarClienta() {
    // 1. Buscamos el modal para extraer el ID de la clienta que estamos editando
    const modalEl = document.getElementById('modalClienta');
    const id = modalEl.getAttribute('data-edit-id');

    // Si no hay ID, significa que el modal está vacío (Nueva Clienta)
    if (!id) {
        alert("No hay ninguna clienta seleccionada para eliminar.");
        return;
    }

    // 2. Confirmación de seguridad para evitar sustos
    if (confirm("¿Estás segura? Se borrará la ficha de la clienta permanentemente.")) {
        try {
            // 3. Borramos de la tabla 'clientas' en Dexie
            await db.clientas.delete(parseInt(id));

            // 4. Cerramos el modal de Bootstrap
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();

            // 5. Refrescamos la lista de clientas en pantalla
            if (typeof listarClientas === 'function') {
                listarClientas();
            } else if (typeof listarClientes === 'function') {
                listarClientes();
            }

            // 6. Actualizamos los desplegables de las citas
            if (typeof actualizarSelectores === 'function') {
                actualizarSelectores();
            }

            console.log("Clienta eliminada correctamente.");
        } catch (error) {
            console.error("Error al eliminar:", error);
            alert("Hubo un fallo al intentar borrar la ficha.");
        }
    }
}

async function guardarServicio() {
    const modalEl = document.getElementById('modalServicio');
    const id = modalEl.getAttribute('data-edit-id');
    
    const datos = {
        nombre: document.getElementById('serNom').value,
        coste: parseFloat(document.getElementById('serCos').value)
    };

    if (!datos.nombre || isNaN(datos.coste)) {
        alert("Por favor, completa nombre y precio.");
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
    if (confirm("¿Seguro que quieres eliminar este servicio?")) {
        await db.servicios.delete(id);
        listarServicios();
        if(typeof actualizarSelectores === 'function') actualizarSelectores();
    }
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
                <h6 class="fw-bold">${s.nombre}</h6>
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

    if (id && confirm("¿Estás segura de que quieres eliminar este servicio definitivamente?")) {
        await db.servicios.delete(parseInt(id));
        
        // Cerramos modal y refrescamos todo
        bootstrap.Modal.getInstance(modalEl).hide();
        listarServicios();
        if(typeof actualizarSelectores === 'function') actualizarSelectores();
    }
}

async function actualizarSelectores() {
    const clis = await db.clientas.toArray();
    const sers = await db.servicios.toArray();
    
    const selCli = document.getElementById('selCli');
    const selSer = document.getElementById('selSer');
    
    if(selCli) selCli.innerHTML = clis.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    if(selSer) selSer.innerHTML = sers.map(s => `<option value="${s.id}">${s.nombre} (${s.coste}€)</option>`).join('');
}

async function forzarDesbloqueo() {
    const id = document.getElementById('modalCita').getAttribute('data-edit-id');
    if (confirm("Esta cita parece bloqueada. ¿Quieres desbloquearla para poder editarla o borrarla?")) {
        await db.agenda.update(parseInt(id), { cobrado: false });
        
        // Cerramos el modal y refrescamos
        bootstrap.Modal.getInstance(document.getElementById('modalCita')).hide();
        calendar.refetchEvents();
        alert("Cita desbloqueada. Ya puedes gestionarla normalmente.");
    }
}

 // COPIA DE SEGURIDAD
 async function exportarBackup() {
    try {
        // 1. Extraemos todas las tablas de tu BD versión 2
        const [clientas, servicios, agenda, ventas] = await Promise.all([
            db.clientas.toArray(),
            db.servicios.toArray(),
            db.agenda.toArray(),
            db.ventas.toArray()
        ]);
        
        // 2. Estructuramos el objeto de respaldo
        const ahora = new Date();
        const backupData = {
            info: {
                fecha: ahora.toLocaleString(),
                dispositivo: navigator.userAgent,
                totalRegistros: clientas.length + servicios.length + agenda.length + ventas.length
            },
            tablas: {
                clientas: clientas,
                servicios: servicios,
                agenda: agenda,
                ventas: ventas
            }
        };

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });

        // --- NUEVA LÓGICA DE NOMBRE CON HORA ---
        const fecha = ahora.toISOString().slice(0, 10); // YYYY-MM-DD
        const horas = ahora.getHours().toString().padStart(2, '0');
        const minutos = ahora.getMinutes().toString().padStart(2, '0');
        
        const nombreArchivo = `eli_backup_${fecha}_${horas}-${minutos}.json`;
        // ---------------------------------------

        // 3. Lógica de compartir (Móvil/Tablet) o Descargar (PC)
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], nombreArchivo, { type: 'application/json' })] })) {
            const archivo = new File([blob], nombreArchivo, { type: 'application/json' });
            await navigator.share({
                title: 'Copia Seguridad Peluquería',
                text: `Backup completo (${ahora.toLocaleString()})`,
                files: [archivo]
            });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = nombreArchivo;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("Descarga local completada: " + nombreArchivo);
        }

    } catch (error) {
        console.error("Error crítico en el backup:", error);
        if (error.name !== 'AbortError') {
            alert("Error al generar la copia. Revisa la consola.");
        }
    }
}

// RESTAURAR COPIA DE SEGURIDAD EXTERNA
async function importarBackup(event) {
    const archivo = event.target.files[0];
    if (!archivo) return;

    // Confirmación de seguridad
    const confirmar = confirm("¿Estás segura? Esto reemplazará todos los datos actuales de la tablet por los del archivo.");
    if (!confirmar) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const contenido = JSON.parse(e.target.result);
            
            // Validamos que el archivo tenga la estructura correcta
            if (!contenido.tablas) {
                throw new Error("El archivo no parece ser un backup válido.");
            }

            // 1. Limpiamos las tablas actuales para evitar duplicados
            await Promise.all([
                db.clientas.clear(),
                db.servicios.clear(),
                db.agenda.clear(),
                db.ventas.clear()
            ]);

            // 2. Insertamos los datos del archivo
            await Promise.all([
                db.clientas.bulkAdd(contenido.tablas.clientas),
                db.servicios.bulkAdd(contenido.tablas.servicios),
                db.agenda.bulkAdd(contenido.tablas.agenda),
                db.ventas.bulkAdd(contenido.tablas.ventas)
            ]);

            alert("¡Éxito! Datos restaurados correctamente. La página se recargará ahora.");
            location.reload(); // Recargamos para que la agenda y listas se actualicen

        } catch (error) {
            console.error("Error al importar:", error);
            alert("Error: El archivo está dañado o no es compatible.");
        }
    };
    reader.readAsText(archivo);
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
        .map(loc => `<option value="${loc}">`)
        .join('');
}