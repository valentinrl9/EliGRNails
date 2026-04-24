// =========================================
// 1. CONFIGURACIÓN DE BASE DE DATOS (V2)
// =========================================

//Constantes de Google para el calendario
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

function escaparHTML(str) {
    if (!str) return "";
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, m => map[m]);
}

// Función para comprobar si hoy es el cumpleaños de alguna clienta
async function checkCumpleaños() {
    try {
        const hoy = new Date();
        const diaHoy = hoy.getDate();
        const mesHoy = hoy.getMonth() + 1;
        const añoActual = hoy.getFullYear(); // <-- 1. Necesitamos el año actual

        const todas = await db.clientas.toArray();
        
        const cumpleañeras = todas.filter(c => {
            if (!c.fechaNacimiento || c.fechaNacimiento === "") return false;

            let diaNac, mesNac;

            if (c.fechaNacimiento.includes('/')) {
                const partes = c.fechaNacimiento.split('/');
                diaNac = parseInt(partes[0]);
                mesNac = parseInt(partes[1]);
            } 
            else if (c.fechaNacimiento.includes('-')) {
                const f = new Date(c.fechaNacimiento);
                diaNac = f.getDate();
                mesNac = f.getMonth() + 1;
            }

            // 2. MODIFICAMOS EL RETURN:
            // Es su cumple SI coincide el día/mes Y NO ha sido felicitada este año
            return diaNac === diaHoy && 
                   mesNac === mesHoy && 
                   c.ultimoCumpleFelicitado !== añoActual; 
        });

        if (cumpleañeras.length > 0) {
            console.log("¡Cumpleaños detectados!", cumpleañeras);
            mostrarAlertaCumple(cumpleañeras);
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

    if (!clienteId || !servicioId || !fecha) {
        alert("Por favor, rellena todos los campos.");
        return;
    }

    // --- NUEVO: Obtener datos para Google Calendar ---
    const cliente = await db.clientas.get(clienteId);
    const servicio = await db.servicios.get(servicioId);
    
    const datosCita = {
        nombreClienta: cliente ? cliente.nombre : "Cliente",
        servicio: servicio ? servicio.nombre : "Servicio",
        fechaInicio: fecha, // Formato que viene del input datetime-local
        // Calculamos el fin (por ejemplo, +1 hora)
        fechaFin: new Date(new Date(fecha).getTime() + 60 * 60 * 1000).toISOString()
    };

    let idFinal;

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

    // --- INTEGRACIÓN CON GOOGLE CALENDAR MEJORADA ---
    if (typeof gapi !== 'undefined') {
        try {
            if (gapi.client.getToken() === null && tokenClient) {
                console.log("Sesión no detectada, intentando auto-conexión...");
                tokenClient.requestAccessToken({ prompt: '' });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (gapi.client.calendar && gapi.client.getToken() !== null) {
                // --- CAMBIO ESENCIAL AQUÍ ---
                const citaActualizada = await db.agenda.get(idFinal);

                if (editId && citaActualizada.googleEventId) {
                    // Si es edición y ya existe en Google, actualizamos
                    await actualizarEventoGoogle(citaActualizada.googleEventId, datosCita);
                } else {
                    // Si es nueva o no tenía ID previo, creamos
                    const googleId = await crearEventoGoogle(datosCita);
                    if (googleId) {
                        await db.agenda.update(idFinal, { googleEventId: googleId });
                        console.log("✅ Cita creada y sincronizada en Google");
                    }
                }
                // -----------------------------
            }
        } catch (error) {
            console.error("Error al sincronizar con Google:", error);
        }
    }

    calendar.refetchEvents();
    const modalInstance = bootstrap.Modal.getInstance(modalEl);
    if (modalInstance) modalInstance.hide();
}

async function eliminarCita() {
    const id = document.getElementById('modalCita').getAttribute('data-edit-id');
    if (!id) return;

    if (confirm("¿Estás segura de eliminar esta cita?")) {
        try {
            // 1. OBTENEMOS LOS DATOS (Rápido)
            const cita = await db.agenda.get(parseInt(id));
            
            // 2. ACCIÓN INMEDIATA (Lo que ve el usuario)
            // Borramos de la base de datos local y refrescamos la interfaz ya mismo
            await db.agenda.delete(parseInt(id));
            calendar.refetchEvents();
            
            // Cerramos el modal sin esperar a Google
            const modalInstance = bootstrap.Modal.getInstance(document.getElementById('modalCita'));
            if (modalInstance) modalInstance.hide();

            console.log("Cita eliminada visualmente. Procesando en Google en segundo plano...");

            // 3. PROCESO EN SEGUNDO PLANO (Google)
            // Si tiene ID de Google, lo borramos, pero el usuario ya no tiene que esperar
            if (cita && cita.googleEventId) {
                // Si no hay token, lo pedimos (esto puede abrir el popup si es necesario)
                if (!gapi.client.getToken() && tokenClient) {
                    tokenClient.requestAccessToken({ prompt: '' });
                    // Esperamos un poco solo para que el proceso de Google tenga tiempo de arrancar
                    await new Promise(r => setTimeout(r, 500));
                }

                // Llamamos a borrar pero ya no usamos 'await' de forma que bloquee la interfaz
                eliminarEventoGoogle(cita.googleEventId).then(() => {
                    console.log("✅ Borrado en Google completado");
                }).catch(err => {
                    console.error("❌ Falló el borrado en Google, pero ya se quitó de la app:", err);
                });
            }

        } catch (error) {
            console.error("Error al eliminar:", error);
            // Si algo falla, intentamos asegurar que al menos se cierre el modal
            const modalInstance = bootstrap.Modal.getInstance(document.getElementById('modalCita'));
            if (modalInstance) modalInstance.hide();
        }
    }
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
        
        // Forzamos la actualización de datos
        if (typeof cargarHistorialVentas === 'function') {
            await cargarHistorialVentas(); 
        }

        // Forzamos la actualización de la lista de clientas (Fidelidad)
        if (typeof listarClientas === 'function') {
            await listarClientas();
        }
        
        // Si tienes el calendario, refresca también
        if (typeof calendar !== 'undefined') calendar.refetchEvents();

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

        // Forzamos la actualización de datos
        if (typeof cargarHistorialVentas === 'function') {
            await cargarHistorialVentas(); 
        }

        // Forzamos la actualización de la lista de clientas (Fidelidad)
        if (typeof listarClientas === 'function') {
            await listarClientas();
        }
        
        // Si tienes el calendario, refresca también
        if (typeof calendar !== 'undefined') calendar.refetchEvents();

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
    
    // CAMBIO CLAVE: Buscamos el acordeón o la tabla
    let contenedor = document.getElementById('acordeonVentas');
    const tablaOriginal = document.getElementById('tablaVentasBody');
    
    // Si ya existe el acordeón, lo usamos como destino. 
    // Si no, buscamos el contenedor de la tabla original.
    let destino;
    if (contenedor) {
        destino = contenedor.parentElement;
    } else if (tablaOriginal) {
        destino = tablaOriginal.closest('.table-responsive') || tablaOriginal.parentElement.parentElement;
    } else {
        // Si no encuentra nada de nada, salimos para evitar errores
        return;
    }

    let totalAcumulado = 0;

    // 1. Marcas de tiempo para vistas acumulativas
    const ahora = new Date();
    const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();

    const lunes = new Date(ahora);
    lunes.setDate(ahora.getDate() - (ahora.getDay() === 0 ? 6 : ahora.getDay() - 1));
    lunes.setHours(0,0,0,0);
    const inicioSemana = lunes.getTime();

    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
    const inicioAño = new Date(ahora.getFullYear(), 0, 1).getTime();

    const grupos = { hoy: [], semana: [], mes: [], año: [], resto: [] };

    // 2. Procesar datos (Calculamos el total real una sola vez aquí)
    await Promise.all(ventas.map(async (v) => {
        const cli = await db.clientas.get(v.clienteId);
        const ser = await db.servicios.get(v.servicioId);
        
        // El total general SOLO se suma una vez por cada venta real
        totalAcumulado += v.importe;
        
        const fVenta = new Date(v.fecha).getTime();
        const item = { v, cli, ser };

        // 3. Lógica ACUMULATIVA (Sin "else")
        // Una misma venta puede entrar en varios grupos a la vez
        if (fVenta >= hoyInicio) {
            grupos.hoy.push(item);
        }
        if (fVenta >= inicioSemana) {
            grupos.semana.push(item);
        }
        if (fVenta >= inicioMes) {
            grupos.mes.push(item);
        }
        if (fVenta >= inicioAño) {
            grupos.año.push(item);
        }
        if (fVenta < inicioAño) {
            grupos.resto.push(item); // Solo lo que sea de años anteriores
        }
    }));

    // 4. Función para generar las secciones
    const crearSeccion = (titulo, id, datos, abierto = false) => {
        const suma = datos.reduce((acc, item) => acc + item.v.importe, 0);
        if (datos.length === 0 && id !== 'hoy') return ''; 

        return `
            <div class="accordion-item bg-dark border-secondary mb-2">
                <h2 class="accordion-header">
                    <button class="accordion-button ${abierto ? '' : 'collapsed'} bg-black text-white" 
                            type="button" data-bs-toggle="collapse" data-bs-target="#coll-${id}">
                        <div class="d-flex justify-content-between w-100 me-3 align-items-center">
                            <span>${titulo}</span>
                            <span class="text-warning fw-bold">${suma.toFixed(2)}€</span>
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
                                ${datos.map(item => `
                                    <tr>
                                        <td class="ps-3">${new Date(item.v.fecha).toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit'})} ${new Date(item.v.fecha).toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})}</td>
                                        <td class="fw-bold">${item.cli ? item.cli.nombre : '---'}</td>
                                        <td>${item.ser ? item.ser.nombre : '---'}</td>
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

    // 5. Renderizado final
    destino.innerHTML = `
        <div class="accordion accordion-flush" id="acordeonVentas">
            ${crearSeccion('HOY', 'hoy', grupos.hoy, true)}
            ${crearSeccion('ESTA SEMANA (Acumulado)', 'sem', grupos.semana)}
            ${crearSeccion('ESTE MES (Acumulado)', 'mes', grupos.mes)}
            ${crearSeccion('ESTE AÑO (Acumulado)', 'anio', grupos.año)}
            ${crearSeccion('AÑOS ANTERIORES', 'resto', grupos.resto)}
        </div>
    `;

    // 6. Actualizar el total general sin duplicados
    const elTotal = document.getElementById('totalCajaGeneral');
    if (elTotal) elTotal.innerText = `${totalAcumulado.toFixed(2)}€`;

    // USAR UN PEQUEÑO TIMEOUT PARA LOS GRÁFICOS
    // Esto permite que la tabla y el total se dibujen primero sin esperar al gráfico
    setTimeout(() => {
        if (typeof renderizarGraficos === 'function') {
            renderizarGraficos(ventas);
        }
    }, 100); 
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
    clientasFiltradas.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", 'es', { sensitivity: 'base' }));
    
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

    if (confirm("Esta cita está cobrada. Si la desbloqueas para editarla, se eliminará el registro de pago de las estadísticas. ¿Deseas continuar?")) {
        try {
            // 1. Borrar la venta vinculada para que los gráficos bajen
            const venta = await db.ventas.where('citaId').equals(parseInt(idCita)).first();
            if (venta) {
                await db.ventas.delete(venta.id);
            }

            // 2. Cambiar estado en la agenda
            await db.agenda.update(parseInt(idCita), { cobrado: false });

            // 3. Cerrar y refrescar todo
            bootstrap.Modal.getInstance(document.getElementById('modalCita')).hide();
            if (calendar) calendar.refetchEvents();
            if (typeof cargarHistorialVentas === 'function') await cargarHistorialVentas();
            if (typeof listarClientas === 'function') await listarClientas();

        } catch (error) {
            console.error("Error al desbloquear:", error);
        }
    }
}


 // COPIA DE SEGURIDAD RECTIFICADA
async function exportarBackup() {
    try {
        // 1. Extraemos los datos (Tu lógica original que funciona perfecto)
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

        // 2. Creamos el archivo
        const json = JSON.stringify(backupData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        
        const fecha = ahora.toISOString().slice(0, 10);
        const horas = ahora.getHours().toString().padStart(2, '0');
        const minutos = ahora.getMinutes().toString().padStart(2, '0');
        const nombreArchivo = `eli_backup_${fecha}_${horas}-${minutos}.json`;

        // 3. DESCARGA DIRECTA (Sin usar navigator.share para evitar el error de la tablet)
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        link.href = url;
        link.download = nombreArchivo;
        
        // El truco para tablets: El link debe estar físicamente en el documento para que el click funcione
        document.body.appendChild(link);
        link.click();
        
        // Limpiamos rápido
        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        }, 500);

        // Mensaje de éxito manual
        alert("¡Copia de seguridad creada!\n\nBusca el archivo '" + nombreArchivo + "' en la carpeta de Descargas de tu tablet.");

    } catch (error) {
        console.error("Error en backup:", error);
        alert("Error al acceder a la base de datos. Asegúrate de que no tienes otras pestañas abiertas.");
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


//GRAFICOS

let chartSemana; // Variable global para el gráfico semanal
let chartMes;    // Variable global para el gráfico mensual
Chart.register(ChartDataLabels); 

function renderizarGraficos(ventas) {
    const canvasSem = document.getElementById('graficoSemanas');
    const canvasMes = document.getElementById('graficoMeses');
    if (!canvasSem || !canvasMes) return;

    const ahora = new Date();
    const añoActual = ahora.getFullYear();

    function getWeekNumber(d) {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    const semanaActual = getWeekNumber(ahora);
    const ingresosSemanales = Array(semanaActual).fill(0);
    const etiquetasSemanas = Array.from({length: semanaActual}, (_, i) => `S${i + 1}`);

    // --- 2. LÓGICA MENSUAL (Ya la tienes bien) ---
    const mesesNombres = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const ingresosMensuales = Array(12).fill(0);

    // --- 3. PROCESAR DATOS ---
    ventas.forEach(v => {
        const fVenta = new Date(v.fecha);
        
        if (fVenta.getFullYear() === añoActual) {
            // Sumar para meses (esto estaba bien)
            ingresosMensuales[fVenta.getMonth()] += v.importe;

            // NUEVA LÓGICA PARA SEMANAS:
            const numSemana = getWeekNumber(fVenta);
            
            // Si la semana de la venta es del año actual y no es futura
            if (numSemana >= 1 && numSemana <= semanaActual) {
                ingresosSemanales[numSemana - 1] += v.importe;
            }
        }
    });

    // --- 4. DIBUJAR GRÁFICO SEMANAL ---
    if (chartSemana) chartSemana.destroy();
    chartSemana = new Chart(canvasSem.getContext('2d'), {
        type: 'line',
        data: {
            labels: etiquetasSemanas, 
            datasets: [{
                data: ingresosSemanales,
                borderColor: '#eec9c3', // Rosa Nude
                backgroundColor: 'rgba(236, 95, 156, 0.5)',
                borderWidth: 2,
                pointBackgroundColor: '#c5a059', // Dorado Eli-GR
                pointRadius: 4,
                tension: 0,
                fill: true,
                datalabels: {
                    align: 'top',
                    anchor: 'end',
                    formatter: (v) => v > 0 ? v + '€' : '',
                    color: '#ffffff', // Blanco
                    font: { size: 10}
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            backgroundColor: 'transparent',
            layout: { padding: { top: 25, left: 10, right: 10, bottom: 10 } },
            plugins: { 
                legend: { display: false },
                datalabels: {
                    align: 'top',
                    anchor: 'end',
                    color: '#ffffff',
                    font: { size: 10},
                    formatter: (v) => v > 0 ? v + '€' : ''
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: '#222' }, 
                    ticks: { color: '#ffffff', font: { size: 10 } } 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { color: '#ffffff', font: { size: 10 } } 
                }
            }
        }
    });

    // --- 5. DIBUJAR GRÁFICO MENSUAL ---
    if (chartMes) chartMes.destroy();
    chartMes = new Chart(canvasMes.getContext('2d'), {
        type: 'line',
        data: {
            labels: mesesNombres,
            datasets: [{
                data: ingresosMensuales,
                borderColor: '#eec9c3', // Rosa Nude
                backgroundColor: 'rgba(236, 95, 156, 0.5)',
                borderWidth: 2,
                pointBackgroundColor: '#c5a059', // Dorado Eli-GR
                pointRadius: 4,
                tension: 0,
                fill: true,
                datalabels: {
                    align: 'top',
                    anchor: 'end',
                    formatter: (v) => v > 0 ? v + '€' : '',
                    color: '#ffffff',
                    font: { size: 11}
                }
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 25, left: 10, right: 10, bottom: 10 } },
            backgroundColor: 'transparent',
            plugins: { 
                legend: { display: false },
                datalabels: {
                    align: 'top',
                    anchor: 'end',
                    color: '#ffffff',
                    font: { size: 11},
                    formatter: (v) => v > 0 ? v + '€' : ''
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: '#222' }, 
                    ticks: { color: '#ffffff', font: { size: 10 } } 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { color: '#ffffff', font: { size: 10 } } 
                }
            }
        }
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
            alert("La sesión de Google ha caducado. Por favor, pulsa 'Conectar Calendario' de nuevo.");
        }
    }
}


// 2. Esta función configura todo lo de Google
function inicializarGoogle() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '674688988885-fmjjdoe5svfabqj1t619c940enn6gc3d.apps.googleusercontent.com',
        scope: 'https://www.googleapis.com/auth/calendar.events',
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                console.log("✅ Acceso concedido a Google Calendar");
                actualizarBotonGoogle(true);
            }
        },
    });
    gsiInited = true;

    // Intento automático al cargar
    setTimeout(() => {
        try {
            // Si el navegador tiene la sesión abierta, esto lo conectará en silencio
            tokenClient.requestAccessToken({ prompt: '' }); 
        } catch (e) {
            console.log("Sesión no recuperada automáticamente.");
        }
    }, 1500); 
}

// Función auxiliar para no repetir código del botón
function actualizarBotonGoogle(conectado) {
    const btn = document.getElementById('btnConectarGoogle');
    if (!btn) return;

    if (conectado) {
        btn.classList.add('connected');
        // No añadimos texto, el CSS se encarga del color verde y el punto
    } else {
        btn.classList.remove('connected');
    }
}

// 3. Esta función lanza la ventana al pulsar el botón
function manejarAuthClick() {
    if (tokenClient) {
        // Si el navegador bloquea el popup, esto pedirá permiso
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        console.error("Error: El cliente de Google no se ha cargado.");
        alert("La librería de Google aún se está cargando, espera un segundo.");
    }
}

// 4. Cargamos las librerías al abrir la web
window.addEventListener('load', () => {
    // Cargamos GSI (Identity)
    if (typeof google !== 'undefined') {
        inicializarGoogle();
    }
    
    // Cargamos GAPI (Calendar API)
    gapi.load('client', async () => {
        try {
            await gapi.client.init({
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
            });
            gapiInited = true;
            console.log("🚀 Google Calendar API lista");

            // --- INTENTO DE AUTO-CONEXIÓN SILENCIOSA ---
            // Si el usuario ya inició sesión antes, se conectará solo
            setTimeout(() => {
                if (tokenClient) {
                    console.log("Intentando auto-conexión...");
                    tokenClient.requestAccessToken({ prompt: '' });
                }
            }, 1500);

        } catch (error) {
            console.error("Error inicializando GAPI:", error);
        }
    });

    // Vincular el botón manualmente por seguridad
    const btn = document.getElementById('btnConectarGoogle');
    if (btn) {
        btn.onclick = manejarAuthClick;
    }
});

// 5. Función para el clic manual del botón
function manejarAuthClick() {
    if (tokenClient) {
        // Al hacer clic, sí mostramos el selector de cuenta (prompt)
        tokenClient.requestAccessToken({ prompt: 'select_account' });
    } else {
        console.error("El cliente de Google no está listo.");
    }
}

// 6. Eliminar evento de Google
async function eliminarEventoGoogle(googleEventId) {
    if (!gapi.client.calendar || !googleEventId) return;

    try {
        await gapi.client.calendar.events.delete({
            'calendarId': 'primary',
            'eventId': googleEventId
        });
        console.log('🗑️ Evento eliminado de Google Calendar');
    } catch (err) {
        // Si el error es 404 es que ya no existe en Google, lo consideramos éxito
        if (err.status === 404) {
            console.warn('El evento ya no existía en Google Calendar.');
        } else {
            console.error('❌ Error al eliminar en Google:', err);
        }
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