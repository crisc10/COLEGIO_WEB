const video = document.getElementById('video');
const estadoCarga = document.getElementById('estadoCarga');
const tablaBody = document.getElementById('tabla-asistencia-body');
const mensajeInstruccion = document.getElementById('mensajeInstruccion');

// Variables de Control
let modoActual = 'asistencia'; 
let descriptoresGuardados = [];
let faceMatcher;

// AHORA TENEMOS DOS LISTAS PARA NO DUPLICAR
let entradasHoy = []; 
let salidasHoy = [];

// --- 1. CARGA INICIAL ---
Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('/models')
]).then(iniciarSistema).catch(err => console.error(err));

async function iniciarSistema() {
    cargarCarasDeMemoria();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        video.srcObject = stream;
        estadoCarga.innerText = "🟢 Sistema En Línea";
        estadoCarga.style.background = "rgba(16, 185, 129, 0.2)";
    } catch (err) {
        alert("No se pudo acceder a la cámara");
    }
}

// --- 2. CEREBRO (DETECCIÓN) ---
video.addEventListener('play', () => {
    const canvas = faceapi.createCanvasFromMedia(video);
    document.querySelector('.marco-camara').append(canvas);
    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        const currentDisplaySize = { width: video.offsetWidth, height: video.offsetHeight };
        faceapi.matchDimensions(canvas, currentDisplaySize);

        const detecciones = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
            .withFaceLandmarks()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detecciones, currentDisplaySize);
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);

        if (modoActual === 'registro') {
            faceapi.draw.drawDetections(canvas, resizedDetections);
        } 
        else if (modoActual === 'asistencia' && faceMatcher) {
            // VERIFICAR QUÉ TIPO ESTAMOS MARCANDO (ENTRADA O SALIDA)
            const tipoAccion = document.querySelector('input[name="tipoAsistencia"]:checked').value;

            const resultados = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

            resultados.forEach((resultado, i) => {
                const box = resizedDetections[i].detection.box;
                const etiqueta = resultado.label;
                
                if (etiqueta !== 'unknown' && resultado.distance < 0.45) {
                    const nombreSolo = etiqueta.split(' (')[0]; 
                    
                    // Verificamos si ya está en la lista CORRESPONDIENTE (entrada o salida)
                    let yaMarco = false;
                    if (tipoAccion === 'entrada') {
                        yaMarco = entradasHoy.includes(nombreSolo);
                    } else {
                        yaMarco = salidasHoy.includes(nombreSolo);
                    }
                    
                    // Colores: Azul (Ya marcó), Verde (Entrada nueva), Naranja (Salida nueva)
                    let colorCaja = '#3b82f6'; // Azul por defecto
                    if (!yaMarco) {
                        colorCaja = (tipoAccion === 'entrada') ? '#10b981' : '#f97316'; 
                    }

                    const textoCaja = yaMarco ? "✅ Registrado" : `Detectando ${tipoAccion}...`;
                    const drawBox = new faceapi.draw.DrawBox(box, { label: textoCaja, boxColor: colorCaja });
                    drawBox.draw(canvas);
                    
                    // Procesar
                    const partes = etiqueta.match(/(.*)\s\((.*)\)/);
                    if (partes) {
                        procesarAsistencia(partes[1], partes[2], tipoAccion);
                    }
                } else {
                    new faceapi.draw.DrawBox(box, { label: "Desconocido", boxColor: '#ef4444' }).draw(canvas);
                }
            });
        }
    }, 100);
});

// --- 3. LÓGICA DE ASISTENCIA ---

function procesarAsistencia(nombre, rol, tipo) {
    // Si estamos en ENTRADA, revisamos la lista de entradas
    if (tipo === 'entrada') {
        if (entradasHoy.includes(nombre)) return; // Ya entró, no hacer nada
        entradasHoy.push(nombre); // Agregamos a lista de entrada
    } 
    // Si estamos en SALIDA, revisamos la lista de salidas
    else {
        if (salidasHoy.includes(nombre)) return; // Ya salió, no hacer nada
        salidasHoy.push(nombre); // Agregamos a lista de salida
    }

    // Agregamos a la tabla
    agregarFilaTabla(nombre, rol, tipo);
    
    mensajeInstruccion.innerText = `✅ ${tipo.toUpperCase()} DE: ${nombre}`;
    mensajeInstruccion.style.color = (tipo === 'entrada') ? "#10b981" : "#f97316";
    
    setTimeout(() => { 
        mensajeInstruccion.innerText = "El sistema está buscando rostros...";
        mensajeInstruccion.style.color = "#64748b";
    }, 3000);
}

function agregarFilaTabla(nombre, rol, tipo) {
    const tiempo = new Date();
    const hora = tiempo.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const fila = document.createElement('tr');
    fila.classList.add('fila-nueva');
    
    // Icono según tipo
    const iconoTipo = (tipo === 'entrada') ? '🌞 Entrada' : '🌙 Salida';
    const claseTipo = (tipo === 'entrada') ? 'tipo-entrada' : 'tipo-salida';

    fila.innerHTML = `
        <td>${hora}</td>
        <td><strong>${nombre}</strong></td>
        <td><span class="etiqueta rol-${rol}">${rol}</span></td>
        <td class="${claseTipo}">${iconoTipo}</td>
    `;
    
    tablaBody.prepend(fila);
}

// --- 4. GESTIÓN DE REGISTRO ---
document.getElementById('btnGuardarCara').addEventListener('click', async () => {
    const nombre = document.getElementById('nombrePersona').value;
    const rol = document.getElementById('rolPersona').value;

    if (!nombre) { alert("¡Falta el nombre!"); return; }

    const deteccion = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (deteccion) {
        const etiquetaCompleta = `${nombre} (${rol})`;
        const nuevoDescriptor = new faceapi.LabeledFaceDescriptors(etiquetaCompleta, [deteccion.descriptor]);
        
        descriptoresGuardados.push(nuevoDescriptor);
        guardarEnMemoriaLocal();
        faceMatcher = new faceapi.FaceMatcher(descriptoresGuardados, 0.6);
        
        alert(`✅ Usuario registrado: ${nombre}`);
        document.getElementById('nombrePersona').value = '';
        cambiarModo('asistencia');
    } else {
        alert("❌ No se detectó rostro.");
    }
});

// --- UTILIDADES ---
function guardarEnMemoriaLocal() {
    const datos = descriptoresGuardados.map(d => ({
        label: d.label,
        descriptors: d.descriptors.map(desc => Array.from(desc))
    }));
    localStorage.setItem('rostrosDB_Escolar', JSON.stringify(datos));
}

function cargarCarasDeMemoria() {
    const datos = localStorage.getItem('rostrosDB_Escolar');
    if (datos) {
        const parsed = JSON.parse(datos);
        descriptoresGuardados = parsed.map(d => new faceapi.LabeledFaceDescriptors(
            d.label,
            d.descriptors.map(desc => new Float32Array(desc))
        ));
        faceMatcher = new faceapi.FaceMatcher(descriptoresGuardados, 0.6);
    }
}

function limpiarTabla() {
    tablaBody.innerHTML = '';
    // Opcional: limpiar memoria de hoy
    // entradasHoy = []; salidasHoy = [];
}

// --- CAMBIO DE MODOS ---
const btnAsis = document.getElementById('btnModoAsistencia');
const btnReg = document.getElementById('btnModoRegistro');
const formReg = document.getElementById('formRegistro');
const controlTipo = document.getElementById('controlTipo');

btnAsis.addEventListener('click', () => cambiarModo('asistencia'));
btnReg.addEventListener('click', () => cambiarModo('registro'));

function cambiarModo(modo) {
    modoActual = modo;
    if (modo === 'registro') {
        formReg.style.display = 'flex';
        controlTipo.style.display = 'none'; // Ocultar switch en registro
        btnReg.classList.add('activo');
        btnAsis.classList.remove('activo');
        mensajeInstruccion.innerText = "Modo Registro";
    } else {
        formReg.style.display = 'none';
        controlTipo.style.display = 'block'; // Mostrar switch en asistencia
        btnAsis.classList.add('activo');
        btnReg.classList.remove('activo');
        mensajeInstruccion.innerText = "Modo Asistencia";
    }
}