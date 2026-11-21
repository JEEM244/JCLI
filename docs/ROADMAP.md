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
- [ ] Conectores oficiales para OpenAI, Gemini, DeepSeek y Claude.
- [ ] Prueba de conexión y manejo seguro de errores.
- [ ] Presupuestos, límites y registro de consumo cuando las APIs lo permitan.
- [ ] Las claves se mantienen fuera del repositorio.

## V0.4 — Coordinación multiagente
- [ ] Coordinador de tareas y asignación de agentes.
- [ ] Contexto compartido por proyecto.
- [ ] Revisión de resultados y registro de decisiones.
- [ ] Aprobación explícita antes de acciones importantes o destructivas.

## V0.5 — Entorno de desarrollo
- [x] Detección y apertura de proyectos en Visual Studio 2026.
- [x] Detección y apertura de carpetas en Visual Studio Code.
- [x] Gestión centralizada inicial de proyectos y tecnologías.
- [ ] Compilación, ejecución de pruebas y lectura estructurada de errores.
- [ ] Gestión de extensiones de VS Code y cargas de trabajo de Visual Studio.
- [ ] Gestión de Git con confirmaciones antes de cambios importantes.

## Principios

- Priorizar Windows 11 y PowerShell 7.
- Mantener una CLI sencilla y comandos fáciles de recordar.
- No simular integraciones: una función solo se considera terminada cuando ejecuta una operación real y comprobable.
- No ejecutar comandos arbitrarios ni modificar archivos importantes sin autorización.
- Mantener los proyectos independientes: no imponerles el nombre JCLI.
