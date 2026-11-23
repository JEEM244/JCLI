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
- [x] Generación confirmada de `.vscode/tasks.json` sin sobrescribir configuraciones existentes.
- [x] Ejecuciones disponibles desde la CLI y desde las tareas de Visual Studio Code.
- [ ] Lectura estructurada de errores por IDE y diagnóstico contextual.
- [ ] Gestión de extensiones de VS Code y cargas de trabajo de Visual Studio.
- [ ] Gestión de Git con confirmaciones antes de cambios importantes.

## V0.6 — Cambios asistidos y reversibles
- [x] Crear propuestas a partir de un archivo original y un candidato explícito.
- [x] Mostrar diferencias antes de aprobar.
- [x] Bloquear rutas externas, traversal, symlinks y archivos/carpetas sensibles.
- [x] Limitar tamaño y número de líneas de archivos propuestos.
- [x] Exigir aprobación humana y `--confirm` para aplicar.
- [x] Verificar SHA-256 para detectar cambios externos antes de aplicar.
- [x] Crear respaldos locales antes de escribir.
- [x] Revertir solo cuando el archivo no haya cambiado después de la aplicación.
- [x] Guardar el estado de propuestas y decisiones en el almacenamiento local.

## V0.7 — Git local
- [x] Consultar rama y estado de archivos del repositorio.
- [x] Mostrar diferencias del área de trabajo y del staging.
- [x] Preparar archivos individuales seleccionados explícitamente.
- [x] Retirar archivos del staging sin descartar cambios locales.
- [x] Crear commits a partir de cambios ya preparados.
- [x] Consultar historial local de commits.
- [x] Listar, crear y cambiar ramas locales.
- [x] Validar rutas y nombres de rama y evitar comandos libres.
- [x] Exigir confirmación para operaciones que modifican el repositorio.
- [ ] Comparación visual enriquecida entre ramas y commits.
- [ ] Integración remota con revisión explícita de `push` y autenticación.

## V0.8 — GitHub
- [x] Identificar el repositorio GitHub desde el remoto origin.
- [x] Consultar datos del repositorio y ramas remotas.
- [x] Comparar ramas mediante la API oficial de GitHub.
- [x] Consultar Pull Requests abiertos, cerrados y por número.
- [x] Crear Pull Requests tras confirmar que la rama local está limpia y publicada.
- [x] Consultar y crear Issues.
- [x] Asociar Issues existentes con tareas locales y guardar vínculos fuera de Git.
- [x] Requerir token, habilitación doble y --confirm para publicaciones.
- [x] Mantener deshabilitados push y operaciones remotas destructivas.

## V0.9 — Memoria técnica por proyecto
- [x] Guardar un resumen técnico independiente por proyecto.
- [x] Registrar, listar y eliminar notas del proyecto.
- [x] Registrar, listar y eliminar decisiones con contexto.
- [x] Generar una instantánea de lenguajes, tecnologías y manifiestos sin copiar archivos fuente.
- [x] Integrar automáticamente el contexto persistente en los planes y prompts multiagente.
- [x] Mostrar las entradas de memoria incluidas en el plan del equipo.
- [x] Limitar el tamaño y cantidad de registros y redactar patrones comunes de secretos.
- [x] Guardar la memoria fuera de Git con identificación local por hash.

## V0.10 — SQL Server Management Studio 22
- [x] Detectar SSMS 22 en rutas habituales y permitir una ruta personalizada.
- [x] Abrir SSMS 22 y scripts .sql desde proyectos registrados.
- [x] Integrar JCLI en Herramientas externas de SSMS usando macros del archivo actual.
- [x] Inspeccionar metadatos de scripts .sql con límites de tamaño y rutas dentro del proyecto, sin ejecutar SQL.
- [x] Detectar proyectos .sqlproj SDK-style y proponer solo compilación compatible.
- [x] Identificar proyectos SSDT clásicos sin inventar comandos build/test.

## V0.11 — JCLI Project Setup (primera etapa)
- [x] Recibir una ruta local sin registrar el proyecto.
- [x] Analizar lenguajes, frameworks, manifiestos, soluciones .NET y proyectos SQL.
- [x] Detectar proveedores de Entity Framework, motores SQL y nombres de ConnectionStrings sin mostrar sus valores.
- [x] Detectar scripts SQL, migraciones y respaldos.
- [x] Generar un plan que separa restauraciones automatizables de pasos manuales.
- [x] Restaurar dependencias con lockfile para .NET, npm/pnpm/yarn y Composer con confirmación explícita.
- [x] Desactivar scripts de instalación de paquetes cuando el gestor lo permite.
- [x] Mantener SQL, migraciones y respaldos como acciones manuales.
- [ ] Detectar SDK instalados, instancias SQL Server y servicios MySQL en tiempo real.
- [ ] Preparar perfiles locales y cadenas de conexión sin sobrescribir configuraciones.
- [ ] Validar soluciones en Visual Studio 2026 y flujos de SSMS 22.
- [ ] Diagnosticar errores y reparar configuraciones con reversión.

## V0.12 — Diagnóstico del entorno y motores locales
- [x] Comprobar herramientas requeridas por los manifiestos (Node/npm, .NET, PHP/Composer, Python, Go, Rust y Java).
- [x] Consultar versiones de ejecutables compatibles y mostrar sus rutas.
- [x] Detectar Visual Studio 2026, VS Code y SSMS 22 cuando el tipo de proyecto lo requiere.
- [x] Consultar servicios locales SQL Server, MySQL y PostgreSQL en Windows, con estados activo/detenido/no detectado.
- [x] Separar herramientas requeridas de utilidades opcionales.
- [x] Mantener el diagnóstico como operación de solo lectura, sin credenciales ni conexiones a bases de datos.
- [x] Probar una conexión SQL Server concreta con autenticación integrada de Windows y consentimiento explícito (V0.14.0).
- [ ] Preparar perfiles locales de conexión sin mostrar ni guardar contraseñas en texto plano.
- [ ] Guiar instalación de SDK y cargas de trabajo de Visual Studio sin elevación automática.

## V0.13 — Inventario seguro de conexiones
- [x] Leer secciones ConnectionStrings de appsettings*.json sin imprimir valores.
- [x] Identificar si cada perfil declara servidor, base y tipo de autenticación.
- [x] Detectar referencias `${VARIABLE}`, `$(VARIABLE)` y `%VARIABLE%` sin resolverlas.
- [x] Mostrar únicamente nombres de variables de entorno, nunca sus valores.
- [x] Mantener el análisis como solo lectura, sin conexión ni ejecución SQL.
- [x] Probar conectividad con autenticación integrada de SQL Server y consulta fija de solo lectura (V0.14.0).
- [ ] Añadir perfiles locales cifrados o referencias al almacén de credenciales del sistema.


## Principios

- Priorizar Windows 11 y PowerShell 7.
- Mantener una CLI sencilla y comandos fáciles de recordar.
- No simular integraciones: una función solo se considera terminada cuando ejecuta una operación real y comprobable.
- No ejecutar comandos arbitrarios ni modificar archivos importantes sin autorización.
- Mantener los proyectos independientes: no imponerles el nombre JCLI.


## V0.14.0 — Prueba de conexión SQL Server de solo lectura

- [x] Selección explícita de un perfil de `ConnectionStrings` en `appsettings*.json`.
- [x] Resolución en memoria de referencias `${VARIABLE}`, `$(VARIABLE)` y `%VARIABLE%` desde el entorno actual; los valores nunca se imprimen ni se guardan.
- [x] Primera conexión limitada a Windows Integrated Authentication mediante `sqlcmd -E`.
- [x] Rechazo de perfiles con usuario o contraseña SQL, incluso si también declaran autenticación integrada.
- [x] Consulta fija `SET NOCOUNT ON; SELECT 1;`; no se aceptan instrucciones SQL del usuario.
- [x] Confirmación obligatoria `--confirm`, timeout corto y resultado sin mensajes de error que puedan filtrar la cadena.
- [x] `-X1` evita cargar el script de inicio `SQLCMDINI` y deshabilita comandos de script adicionales.
- [x] Pruebas automatizadas con cliente simulado; CI no intenta conexiones reales.

### Límites de esta versión

La comprobación requiere Windows, `sqlcmd`, permisos de Windows sobre SQL Server y un perfil con servidor, base y autenticación integrada. La comprobación no crea bases, no ejecuta migraciones y no comprueba permisos de escritura. MySQL, PostgreSQL y autenticación SQL quedan fuera de esta primera prueba real.

## Siguientes fases

- [ ] Extender las comprobaciones de conexión de solo lectura a MySQL y PostgreSQL con sus mecanismos de autenticación seguros.
- [ ] Añadir perfiles locales protegidos por el almacén de credenciales del sistema; nunca guardar contraseñas en texto plano.
- [ ] Completar los flujos de restauración para Python, Go, Rust y Java con validación de sus gestores de paquetes.
- [x] Diagnosticar componentes relevantes de Visual Studio 2026 para ASP.NET, .NET Framework y SQL SSDT clásico (V0.15.0).
- [ ] Incorporar informes de preparación exportables y una verificación posterior a cada acción.


## V0.15.0 — Diagnóstico de componentes de Visual Studio 2026

- [x] Detectar proyectos ASP.NET Framework clásicos a partir de referencias web del proyecto.
- [x] Distinguir proyectos SQL SDK-style de proyectos SSDT clásicos.
- [x] Consultar con \`vswhere\` la presencia de herramientas ASP.NET y desarrollo web.
- [x] Comprobar los targeting packs .NET Framework 4.8 y 4.8.1 cuando el proyecto los declara.
- [x] Comprobar SQL Server Data Tools en proyectos \`.sqlproj\` clásicos.
- [x] Mostrar estados disponible, faltante o no comprobable, sin abrir Visual Studio Installer ni modificar la instalación.
- [x] Probar el mapeo de componentes y sus estados con pruebas automatizadas.
