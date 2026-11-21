# Hoja de ruta de JCLI

La hoja de ruta es incremental: cada etapa debe quedar utilizable antes de ampliar el alcance.

## Base — V0.1
- [x] CLI con nombre de comando `troc`.
- [x] Tareas almacenadas en archivos TXT editables.
- [x] Configuración inicial de proveedores de IA.
- [x] Registro local de proyectos.
- [x] Listar, registrar y abrir carpetas de proyectos.
- [x] Analizar lenguajes, manifiestos y tecnologías comunes.
- [x] Consultar rama y cambios de Git sin modificarlos.
- [x] Detectar y abrir proyectos en Visual Studio Code y Visual Studio 2026.

## V0.2 — Experiencia de uso
- [x] Búsqueda, edición y filtros de tareas.
- [x] Asociación y desasociación de tareas con proyectos.
- [x] Validación de campos y detección de inconsistencias entre el TXT y su archivo de estado.
- [x] Escritura mediante archivos temporales para reducir el riesgo de corrupción.
- [x] Historial local de operaciones en JSONL.
- [ ] Recuperación interactiva de archivos TXT mal formados.
- [ ] Configuración de rutas y perfiles de trabajo.

## V0.3 — Proveedores de IA
- [x] Conectores HTTP oficiales para OpenAI Responses, Gemini generateContent, DeepSeek Chat Completions y Anthropic Messages.
- [x] Consulta de catálogos de modelos para verificar credenciales sin generar una respuesta.
- [x] Manejo de errores HTTP, tiempo de espera y protección de claves en mensajes de error.
- [x] Límites locales por día, tamaño de entrada, salida y duración de solicitud.
- [x] Registro local de solicitudes y tokens reportados por los proveedores.
- [x] Generación desactivada por defecto y habilitación explícita mediante configuración local.
- [ ] Cálculo monetario exacto y presupuestos sincronizados con cada proveedor.
- [ ] Streaming de respuestas y conversaciones persistentes.

## V0.4 — Coordinación multiagente
- [x] Coordinador secuencial de hasta 4 agentes por tarea.
- [x] Asignación de agentes mediante la línea `agents=` en cada TXT.
- [x] Perfiles configurables para planificación, propuesta de código, revisión y pruebas.
- [x] Contexto de proyecto mediante archivos elegidos explícitamente.
- [x] Bloqueo de rutas externas, secretos, dependencias y archivos de tamaño excesivo.
- [x] Resultados persistidos y consultables localmente.
- [x] Registro de aceptación o rechazo humano; no aplica cambios al proyecto.
- [x] Doble activación explícita para llamadas multiagente.
- [ ] Reanudación de ejecuciones interrumpidas y cancelación controlada.
- [ ] Aprobación y aplicación asistida de parches revisables.

## V0.5 — Entorno de desarrollo
- [x] Detección y apertura de proyectos en Visual Studio 2026.
- [x] Detección y apertura de carpetas en Visual Studio Code.
- [x] Gestión centralizada inicial de proyectos y tecnologías.
- [x] Detección de toolchains Node.js, .NET, Composer, pytest, Go y Cargo.
- [x] Planes build/test antes de ejecución.
- [x] Ejecución local con confirmación explícita, timeout y límite de salida.
- [x] Registro local de logs y códigos de salida.
- [x] Filtrado de variables sensibles al lanzar procesos.
- [ ] Lectura estructurada de errores por IDE y diagnóstico contextual.
- [ ] Gestión de extensiones de VS Code y cargas de trabajo de Visual Studio.
- [ ] Gestión de Git con confirmaciones antes de cambios importantes.

## Principios

- Priorizar Windows 11 y PowerShell 7.
- Mantener una CLI sencilla y comandos fáciles de recordar.
- No simular integraciones: una función solo se considera terminada cuando ejecuta una operación real y comprobable.
- No ejecutar comandos arbitrarios ni modificar archivos importantes sin autorización.
- Mantener los proyectos independientes: no imponerles el nombre JCLI.
