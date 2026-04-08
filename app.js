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
// 2. INICIALIZACIÓN AL CARGAR LA PÁGINA
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    initCalendar();
    listarClientas();
    listarServicios();
    actualizarSelectores();
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
        slotMinTime: '10:00:00',
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
            document.getElementById('modalCitaTitulo').innerText = "Nueva Cita";
            document.getElementById('btnEliminarCita').style.display = 'none';
            document.getElementById('btnCobrarCita').style.display = 'none';
            document.querySelector('button[onclick="agendarCita()"]').style.display = 'block';

            // 2. CORRECCIÓN DE HORA (EL ARREGLO)
            // Usamos la fecha que viene en 'info.date' pero la formateamos a mano
            // para evitar que el navegador le sume o reste horas por la zona horaria.
            const d = info.date;
            const año = d.getFullYear();
            const mes = String(d.getMonth() + 1).padStart(2, '0');
            const dia = String(d.getDate()).padStart(2, '0');
            const hora = String(d.getHours()).padStart(2, '0');
            const minutos = String(d.getMinutes()).padStart(2, '0');

            // Creamos el formato exacto que necesita el input datetime-local: YYYY-MM-DDTHH:mm
            const fechaLocalCorrecta = `${año}-${mes}-${dia}T${hora}:${minutos}`;
            
            document.getElementById('citaFecha').value = fechaLocalCorrecta;

            // 3. Mostrar el modal
            new bootstrap.Modal(modalEl).show();
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
                        title: `${icono}${cli.nombre} - ${ser.nombre}`,
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
    const importeInput = document.getElementById('inputImporteFinal').value;
    const importeFinal = parseFloat(importeInput);
    const metodo = document.getElementById('metodoPago').value;

    if (isNaN(importeFinal) || importeFinal < 0) {
        alert("Por favor, introduce un importe válido.");
        return;
    }

    try {
        // 1. Guardamos la venta asegurando IDs numéricos
        // Si importeFinal es 0, la función obtenerEstadoFidelidad lo ignorará automáticamente
        await db.ventas.add({
            citaId: parseInt(citaParaCobrar.id), 
            clienteId: parseInt(citaParaCobrar.clienteId),
            servicioId: parseInt(citaParaCobrar.servicioId),
            fecha: new Date().toISOString(),
            importe: importeFinal,
            metodoPago: metodo
        });

        // 2. Marcamos la cita como cobrada
        await db.agenda.update(parseInt(citaParaCobrar.id), { cobrado: true });
        
        // 3. Actualizamos el calendario
        if (calendar) calendar.refetchEvents();
        
        // 4. Cerramos el modal
        const modalCobroEl = document.getElementById('modalCobro');
        const modalInstance = bootstrap.Modal.getInstance(modalCobroEl);
        if (modalInstance) modalInstance.hide();
        
        // 5. Actualizamos el historial de ventas si existe la función
        if (typeof cargarHistorialVentas === 'function') {
            await cargarHistorialVentas();
        }

        // 6. ACTUALIZACIÓN CRÍTICA: Refrescamos la lista de clientas 
        // para que la barra de progreso suba (o no, si el cobro fue 0€)
        if (typeof listarClientas === 'function') {
            await listarClientas();
        }

        alert(importeFinal === 0 ? "Sesión de regalo registrada correctamente." : `Venta registrada: ${importeFinal}€`);

    } catch (error) {
        console.error("Error al procesar el cobro:", error);
        alert("Hubo un error al registrar la venta.");
    }
}


async function revertirCobro(ventaId, citaId) {
    if (!confirm("¿Segura que quieres anular este cobro? La cita volverá a estar pendiente y el progreso de la clienta se actualizará.")) return;

    try {
        // 1. Eliminamos el registro de la venta
        // Al borrar la venta, el 'motor' dejará de contarla automáticamente
        await db.ventas.delete(parseInt(ventaId));

        // 2. IMPORTANTE: Cambiamos el estado en la agenda a pendiente (cobrado: false)
        if (citaId) {
            await db.agenda.update(parseInt(citaId), { cobrado: false });
        }

        // 3. Refrescar la tabla de historial de ventas
        if (typeof cargarHistorialVentas === 'function') {
            await cargarHistorialVentas();
        }
        
        // 4. Refrescar el calendario para que la cita pierda el color de "cobrada"
        if (typeof calendar !== 'undefined' && calendar) {
            calendar.refetchEvents();
        }

        // 5. ACTUALIZACIÓN DE BARRA: Refrescamos la lista de clientas
        // Como la venta ya no existe (o el importe > 0 ya no está), la barra bajará sola
        if (typeof listarClientas === 'function') {
            await listarClientas();
        }

        alert("Cobro anulado correctamente. Se ha actualizado el historial y la fidelidad.");

    } catch (error) {
        console.error("Error al revertir el cobro:", error);
        alert("No se pudo anular el cobro. Revisa la consola para más detalles.");
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
        if (typeof actualizarSelectores === "function"){
            await listarClientas();
        } 
        actualizarSelectores();
        
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

    // --- NUEVO: Obtenemos el estado de fidelidad para mostrarlo en el modal ---
    const estado = await obtenerEstadoFidelidad(id);
    // -------------------------------------------------------------------------

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
            <div class="alert alert-dark border-gold mb-3">
                <div class="d-flex justify-content-between mb-1">
                    <span class="small fw-bold text-gold">SESIONES ACUMULADAS: ${estado.actual}/10</span>
                    ${estado.tocaRegalo ? '<span class="badge bg-warning text-dark">¡REGALO LISTO!</span>' : ''}
                </div>
                <div class="progress" style="height: 10px; background-color: #444;">
                    <div class="progress-bar bg-gold" style="width: ${estado.porcentaje}%"></div>
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
    
    // 1. Función interna para limpiar tildes y pasar a minúsculas
    const limpiarTexto = (texto) => {
        if (!texto) return "";
        return texto
            .toLowerCase()
            .normalize("NFD") // Descompone tildes (á -> a + ´)
            .replace(/[\u0300-\u036f]/g, ""); // Elimina los símbolos de tilde
    };

    // 2. Preparamos el filtro del buscador
    const filtro = limpiarTexto(inputBusqueda ? inputBusqueda.value : "");

    const clis = await db.clientas.toArray();

    // 3. FILTRADO INTELIGENTE
    const clientasFiltradas = clis.filter(c => {
        const nombreLimpio = limpiarTexto(c.nombre);
        const telefono = (c.telefono || "");
        
        // Comparamos el nombre limpio con el filtro limpio
        return nombreLimpio.includes(filtro) || telefono.includes(filtro);
    });

    // 4. ORDEN (alfabético)
    clientasFiltradas.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

    // 5. MAPEADO (Diseño de Lujo)
    const htmlPromesas = clientasFiltradas.map(async (c) => {
        const idLimpio = parseInt(c.id);
        const estado = await obtenerEstadoFidelidad(idLimpio);
        
        const ventasPagadas = await db.ventas
            .where('clienteId').equals(idLimpio)
            .filter(v => v.importe > 0).toArray();
        const totalHistorico = ventasPagadas.length;

        return `
            <div class="col-12" style="margin-bottom: 1px !important; padding: 0 8px !important;"> 
                <div onclick="prepararEdicionClienta(${idLimpio})" 
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
                                ${c.nombre}
                            </span>
                        </div>
                        <div style="flex: 1; color: #888; font-size: 0.75rem; white-space: nowrap;">
                            <i class="fa-solid fa-phone" style="font-size: 0.65rem; margin-right: 5px; color: #c5a059;"></i>${c.telefono || ''}
                        </div>
                        <div style="width: 55px; text-align: center; border-left: 1px solid #333; border-right: 1px solid #333;">
                            <span style="font-size: 0.95rem; font-weight: bold; color: #ffffff;">${totalHistorico}</span>
                        </div>
                        <div style="flex: 2; display: flex; align-items: center; gap: 12px; justify-content: flex-end;">
                            <span style="font-size: 0.8rem; font-weight: bold; color: #eee; min-width: 38px; text-align: right;">
                                ${estado.actual}/10
                            </span>
                            <div style="width: 75px; background: #000; height: 5px; border-radius: 10px; border: 1px solid #444; overflow: hidden;">
                                <div style="width: ${estado.porcentaje}%; background: linear-gradient(90deg, #c5a059, #fcf6ba); height: 100%;"></div>
                            </div>
                            <div style="width: 20px; text-align: center;">
                                ${estado.tocaRegalo ? '<i class="fa-solid fa-crown text-warning" style="font-size: 0.9rem; filter: drop-shadow(0 0 3px rgba(255,215,0,0.6));"></i>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });

    try {
        const resultadosHtml = await Promise.all(htmlPromesas);
        contenedor.innerHTML = resultadosHtml.join('');
    } catch (err) {
        console.error("Error al renderizar:", err);
    }
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