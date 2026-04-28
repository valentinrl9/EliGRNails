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

// --- 🎨 CONFIGURACIÓN DE COLORES SWEETALERT2 PARA ELI-GR NAILS ---
const swalConfig = {
    background: '#1a1a1a', 
    color: '#d39e00', 
    confirmButtonColor: '#c48b00', 
    cancelButtonColor: '#444',
    customClass: {
        confirmButton: 'swal-gold-button'
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
        
        // --- INTEGRACIÓN CON GOOGLE CALENDAR ---
        if (typeof gapi !== 'undefined') {
            try {
                if (gapi.client.getToken() === null && typeof tokenClient !== 'undefined') {
                    console.log("Sesión no detectada, intentando auto-conexión...");
                    tokenClient.requestAccessToken({ prompt: '' });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (gapi.client.calendar && gapi.client.getToken() !== null) {
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
                }
            } catch (errorGoogle) {
                console.error("Error al sincronizar con Google:", errorGoogle);
            }
        }

        // --- FINALIZACIÓN ---
        if (typeof calendar !== 'undefined') calendar.refetchEvents();
        
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
                
                // Cerramos el modal sin esperar a Google
                const modalInstance = bootstrap.Modal.getInstance(document.getElementById('modalCita'));
                if (modalInstance) modalInstance.hide();

                console.log("Cita eliminada visualmente. Procesando en Google en segundo plano...");

                // 3. PROCESO EN SEGUNDO PLANO (Google)
                if (cita && cita.googleEventId) {
                    if (!gapi.client.getToken() && tokenClient) {
                        tokenClient.requestAccessToken({ prompt: '' });
                        await new Promise(r => setTimeout(r, 500));
                    }

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
        // Buscamos el estado REAL de la cita en la base de datos
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
            // Cerramos el modal para evitar más intentos
            const modalCobroEl = document.getElementById('modalCobro');
            const modalInstance = bootstrap.Modal.getInstance(modalCobroEl);
            if (modalInstance) modalInstance.hide();
            return;
        }
        // =====================================================

        // 1. Guardamos la venta asegurando IDs numéricos
        await db.ventas.add({
            citaId: parseInt(citaParaCobrar.id), 
            clienteId: parseInt(citaParaCobrar.clienteId),
            servicioId: parseInt(citaParaCobrar.servicioId),
            fecha: new Date().toISOString(),
            importe: importeFinal,
            metodoPago: metodo
        });

        // 2. Marcamos la cita como cobrada en la agenda
        await db.agenda.update(parseInt(citaParaCobrar.id), { cobrado: true });
        
        // 3. ACTUALIZACIÓN DE INTERFAZ (Una sola vez cada una)
        
        // Refrescar el Historial de Ventas/Estadísticas
        if (typeof cargarHistorialVentas === 'function') {
            await cargarHistorialVentas(); 
        }

        // Refrescar la Lista de Clientas (Para que suban los puntos/fidelidad)
        if (typeof listarClientas === 'function') {
            await listarClientas();
        }
        
        // Refrescar el Calendario
        if (typeof calendar !== 'undefined' && calendar) {
            calendar.refetchEvents();
        }
        
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
                
                // Si tienes el calendario, refresca también
                if (typeof calendar !== 'undefined') calendar.refetchEvents();

                // 5. ACTUALIZACIÓN DE BARRA: Refrescamos la lista de clientas
                if (typeof listarClientas === 'function') {
                    await listarClientas();
                }

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
        // --- 🛡️ ESCUDO GLOBAL DE DUPLICADOS (Para Nuevo y Edición) ---
        
        const normalizar = (texto) => 
            texto ? texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

        const nombreBusqueda = normalizar(datos.nombre);
        const todasLasClientas = await db.clientas.toArray();

        // Buscamos coincidencias EXCLUYENDO a la clienta que estamos editando actualmente
        const nombreRepetido = todasLasClientas.find(c => 
            normalizar(c.nombre) === nombreBusqueda && c.id !== parseInt(idEdicion)
        );

        const telRepetido = datos.telefono 
            ? todasLasClientas.find(c => c.telefono === datos.telefono && c.id !== parseInt(idEdicion)) 
            : null;

        let advertencia = "";

        if (nombreRepetido && telRepetido && telRepetido.id === nombreRepetido.id) {
            advertencia = `⚠️ ¡CUIDADO! Los datos coinciden totalmente con otra ficha existente (${nombreRepetido.nombre}).`;
        } else if (nombreRepetido) {
            advertencia = `⚠️ AVISO: Ya existe otra clienta con el nombre "${nombreRepetido.nombre}".`;
        } else if (telRepetido) {
            advertencia = `⚠️ AVISO: El teléfono "${datos.telefono}" ya lo tiene asignado: ${telRepetido.nombre}.`;
        }

        if (advertencia) {
        Swal.fire({
            ...swalConfig,
            icon: 'warning',
            title: 'Atención',
            text: advertencia,
            showCancelButton: true,
            confirmButtonText: 'Sí, guardar de todos modos',
            cancelButtonText: 'Revisar',
            confirmButtonColor: '#d33', // Color de advertencia
            cancelButtonColor: '#444'
        }).then((result) => {
            if (result.isConfirmed) {
                // Aquí ejecutas la función de guardado
                ejecutarGuardado(); 
            }
        });
        return; // Detiene la ejecución normal para esperar la decisión del SweetAlert
    }
        // ----------------------------------------------------------

        if (idEdicion) {
            await db.clientas.update(parseInt(idEdicion), datos);
            console.log("Clienta actualizada con éxito");
        } else {
            await db.clientas.add(datos);
            console.log("Nueva clienta añadida con éxito");
        }

        // Refrescar y cerrar
        await listarClientas();
        if (typeof actualizarSelectores === "function") actualizarSelectores();
        
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();
        
        document.getElementById('formClienta').reset();
        modalEl.removeAttribute('data-edit-id');

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
        Swal.fire({
            ...swalConfig,
            icon: 'success',
            title: 'Copia de Seguridad Creada',
            text: `¡Copia de seguridad creada!\n\nBusca el archivo '${nombreArchivo}' en la carpeta de Descargas de tu tablet.`,
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
async function importarBackup(event) {
    const archivo = event.target.files[0];
    if (!archivo) return;

    // Confirmación de seguridad con SweetAlert2
    Swal.fire({
        ...swalConfig,
        icon: 'warning',
        title: '¿Reemplazar todos los datos?',
        text: 'Esto borrará toda la información actual de la tablet y la sustituirá por la del archivo. Esta acción es irreversible.',
        showCancelButton: true,
        confirmButtonText: 'Sí, restaurar todo',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#d33',
        cancelButtonColor: '#444'
    }).then(async (result) => {
        if (result.isConfirmed) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const contenido = JSON.parse(e.target.result);
                    
                    // --- 🛡️ ESCUDO DE INTEGRIDAD ---
                    const tablas = contenido.tablas;
                    if (!tablas || !tablas.clientas || !tablas.servicios || !tablas.agenda || !tablas.ventas) {
                        throw new Error("El archivo de copia está incompleto o el formato no es válido.");
                    }

                    // 1. Limpieza de base de datos
                    await Promise.all([
                        db.clientas.clear(),
                        db.servicios.clear(),
                        db.agenda.clear(),
                        db.ventas.clear()
                    ]);

                    // 2. Inserción de nuevos datos
                    await Promise.all([
                        db.clientas.bulkAdd(tablas.clientas || []),
                        db.servicios.bulkAdd(tablas.servicios || []),
                        db.agenda.bulkAdd(tablas.agenda || []),
                        db.ventas.bulkAdd(tablas.ventas || [])
                    ]);

                    // Éxito
                    Swal.fire({
                        ...swalConfig,
                        icon: 'success',
                        title: '¡Sistema Restaurado!',
                        text: 'Los datos se han volcado correctamente. La página se recargará ahora.',
                        confirmButtonText: 'Genial',
                        willClose: () => {
                            location.reload(); 
                        }
                    });

                } catch (error) {
                    console.error("Error al importar:", error);
                    Swal.fire({
                        ...swalConfig,
                        icon: 'error',
                        title: '¡Error Crítico!',
                        html: `
                            <p>No se han realizado cambios en tus datos actuales.</p>
                            <div style="background: #333; padding: 10px; border-radius: 5px; color: #ff5f5f; font-family: monospace; font-size: 0.85em; margin-top: 15px;">
                                ${error.message}
                            </div>
                        `,
                        confirmButtonText: 'Entendido',
                        confirmButtonColor: '#d33'
                    });
                }
            };
            reader.readAsText(archivo);
        } else {
            // Si cancela, reseteamos el input file para que pueda volver a elegir el mismo archivo si quiere
            event.target.value = "";
        }
    });
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
    
    // --- 1. INICIALIZAR ARRAYS ---
    const ingresosSemanales = Array(semanaActual).fill(0);
    const cantidadServiciosSemanales = Array(semanaActual).fill(0);
    const etiquetasSemanas = Array.from({length: semanaActual}, (_, i) => `S${i + 1}`);

    const mesesNombres = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const ingresosMensuales = Array(12).fill(0);
    const cantidadServiciosMensuales = Array(12).fill(0); // <-- Añadido para la mensual

    // --- 2. PROCESAR DATOS ---
    ventas.forEach(v => {
        const fVenta = new Date(v.fecha);
        
        if (fVenta.getFullYear() === añoActual) {
            // Lógica Mensual
            const mesIdx = fVenta.getMonth();
            ingresosMensuales[mesIdx] += v.importe;
            cantidadServiciosMensuales[mesIdx] += 1; // Contamos servicios por mes

            // Lógica Semanal
            const numSemana = getWeekNumber(fVenta);
            if (numSemana >= 1 && numSemana <= semanaActual) {
                ingresosSemanales[numSemana - 1] += v.importe;
                cantidadServiciosSemanales[numSemana - 1] += 1; // Contamos servicios por semana
            }
        }
    });

    // --- 3. CONFIGURACIÓN COMÚN DE DATASETS DE SERVICIOS ---
    const datasetServicios = (datos, ejeId) => ({
        label: 'Servicios',
        data: datos,
        type: 'line',
        yAxisID: ejeId,
        borderColor: '#ffffff',
        borderWidth: 2,
        borderDash: [5, 5],
        pointRadius: 3,
        tension: 0.3,
        fill: false,
        datalabels: {
            align: 'bottom',
            anchor: 'start',
            formatter: (v) => v > 0 ? v : '',
            color: '#c5a059',
            font: { size: 10, weight: 'bold' }
        }
    });

    // --- 4. DIBUJAR GRÁFICO SEMANAL ---
    if (chartSemana) chartSemana.destroy();
    chartSemana = new Chart(canvasSem.getContext('2d'), {
        type: 'line',
        data: {
            labels: etiquetasSemanas, 
            datasets: [
                {
                    label: 'Ingresos (€)',
                    data: ingresosSemanales,
                    yAxisID: 'y',
                    borderColor: '#eec9c3',
                    backgroundColor: 'rgba(236, 95, 156, 0.5)',
                    borderWidth: 2,
                    fill: true,
                    datalabels: { align: 'top', anchor: 'end', formatter: (v) => v > 0 ? v + '€' : '', color: '#ffffff' }
                },
                datasetServicios(cantidadServiciosSemanales, 'y1')
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 35, left: 10, right: 30, bottom: 10 } },
            plugins: { legend: { display: false }, datalabels: { display: true } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#ffffff' } },
                y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: '#c5a059', stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: '#ffffff' } }
            }
        }
    });

    // --- 5. DIBUJAR GRÁFICO MENSUAL (Ahora también con Doble Eje) ---
    if (chartMes) chartMes.destroy();
    chartMes = new Chart(canvasMes.getContext('2d'), {
        type: 'line',
        data: {
            labels: mesesNombres,
            datasets: [
                {
                    label: 'Ingresos (€)',
                    data: ingresosMensuales,
                    yAxisID: 'y',
                    borderColor: '#eec9c3',
                    backgroundColor: 'rgba(236, 95, 156, 0.5)',
                    borderWidth: 2,
                    fill: true,
                    datalabels: { align: 'top', anchor: 'end', formatter: (v) => v > 0 ? v + '€' : '', color: '#ffffff' }
                },
                datasetServicios(cantidadServiciosMensuales, 'y1') // <-- SEGUNDA LÍNEA AÑADIDA
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { top: 35, left: 10, right: 30, bottom: 10 } }, // Padding ajustado para el eje derecho
            plugins: { legend: { display: false }, datalabels: { display: true } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#222' }, ticks: { color: '#ffffff' } },
                y1: { 
                    position: 'right', 
                    beginAtZero: true, 
                    grid: { drawOnChartArea: false }, 
                    ticks: { color: '#c5a059', stepSize: 1 } // Eje para servicios mensuales
                },
                x: { grid: { display: false }, ticks: { color: '#ffffff' } }
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
        Swal.fire({
            ...swalConfig,
            icon: 'error',
            title: 'Error de Conexión',
            text: 'La librería de Google aún se está cargando, espera un segundo.',
            confirmButtonText: 'Entendido'
        });
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