# JCLI

Centro de control local para proyectos, tareas, herramientas de desarrollo e integraciones de IA.

> El nombre del programa es **JCLI**. El comando de terminal es **`troc`**.

## Requisitos

- Windows 11 y PowerShell 7 recomendado.
- Node.js 20 o superior.
- npm.
- Para ejecutar acciones de un proyecto: su toolchain correspondiente (por ejemplo .NET SDK, Composer, pytest, Go o Cargo).

## Instalación

```powershell
git clone https://github.com/JEEM244/JCLI.git
cd JCLI
npm install
Copy-Item .env.example .env
notepad .env
npm run build
npm link
troc init
```

Para desarrollo, también puedes usar `npm run dev -- <comando>`.

## Comandos principales

```powershell
troc init

# Tareas
troc tasks list
troc tasks list pendientes --project WEB --priority alta
troc tasks add
troc tasks show WEB-001
troc tasks search "panel"
troc tasks edit WEB-001
troc tasks link WEB-001 WEB
troc tasks unlink WEB-001
troc tasks agents WEB-001 planner,reviewer
troc tasks agents WEB-001 none
troc tasks done WEB-001
troc tasks move WEB-001 en_proceso

# Proyectos
troc project list
troc project add
troc project open WEB
troc project analyze WEB
troc project git WEB

# Configurador de proyectos
troc setup inspect "C:\Proyectos\MVCConexion_5L1"
troc setup plan "C:\Proyectos\MVCConexion_5L1"
troc setup run "C:\Proyectos\MVCConexion_5L1" --confirm
troc setup report "C:\Proyectos\MVCConexion_5L1"
troc setup doctor "C:\Proyectos\MVCConexion_5L1"
troc setup db-config "C:\Proyectos\MVCConexion_5L1"

# Visual Studio 2026, Visual Studio Code y SQL Server Management Studio 22
troc ide vscode detect
troc ide vs2026 detect
troc ide ssms22 detect
troc ide vscode open WEB
troc ide vs2026 open WEB
troc ide ssms22 open WEB
troc ide ssms22 open WEB database/schema.sql
troc ide ssms22 external-tool WEB

# Entorno de desarrollo
troc dev inspect WEB
troc dev plan WEB build
troc dev plan WEB test
troc dev run WEB build --confirm
troc dev run WEB test --confirm
troc dev show ID_EJECUCION
troc dev runs
troc dev vscode-tasks WEB --confirm

# Proveedores de IA
troc providers list
troc providers status
troc providers test openai
troc providers models gemini
troc ai ask deepseek "Resume este fragmento de código"
troc ai usage

# Memoria técnica por proyecto
troc memory show WEB
troc memory summary WEB "Panel administrativo para gestionar solicitudes."
troc memory scan WEB
troc memory note add WEB "El login utiliza sesiones del servidor."
troc memory note list WEB
troc memory decision add WEB "Base de datos" "Mantener MySQL por ahora" "La aplicación ya utiliza MySQL."
troc memory decision list WEB
troc memory context WEB

# Equipo multiagente
troc team agents
troc tasks agents WEB-001 planner,implementer,reviewer,tester
troc team plan WEB-001 --file README.md
troc team run WEB-001 --file README.md
troc team show ID_EJECUCION
troc team decide ID_EJECUCION accept

# Git local
troc git status WEB
troc git diff WEB
troc git diff WEB --staged
troc git stage WEB src/app.ts --confirm
troc git unstage WEB src/app.ts --confirm
troc git commit WEB "Actualiza el panel" --confirm
troc git log WEB 10
troc git branch list WEB
troc git branch create WEB feature/panel --confirm
troc git branch switch WEB main --confirm

# GitHub
troc github status
troc github repo WEB
troc github branches WEB
troc github compare WEB main feature/panel
troc github prs WEB open
troc github pr show WEB 12
troc github pr create WEB main "Agrega panel" "Descripción del cambio" --confirm
troc github issues WEB open
troc github issue show WEB 15
troc github issue create WEB "Error en formulario" "Pasos para reproducir" --confirm
troc github issue link WEB WEB-001 15 --confirm
troc github issue links WEB
troc github issue unlink WEB WEB-001 --confirm

# Historial
troc history
troc history 50
```

## JCLI Project Setup

El configurador recibe una ruta local y analiza lenguajes, frameworks, manifiestos, soluciones .NET, proyectos SQL, migraciones, scripts, respaldos y referencias de bases de datos. No es necesario registrar el proyecto primero.

```powershell
troc setup inspect "C:\Proyectos\MVCConexion_5L1"
troc setup plan "C:\Proyectos\MVCConexion_5L1"
troc setup run "C:\Proyectos\MVCConexion_5L1" --confirm
troc setup report "C:\Proyectos\MVCConexion_5L1"
```

- inspect y report solo leen el proyecto y no muestran valores de cadenas de conexión.
- plan separa las restauraciones automáticas de los pasos manuales para Visual Studio 2026, SSMS 22 y bases de datos.
- run --confirm puede restaurar paquetes .NET, npm/pnpm/yarn y Composer si encuentra los manifiestos y lockfiles adecuados. Desactiva scripts de instalación de terceros cuando el gestor lo permite.
- Python se reconoce, pero la creación del entorno virtual y la instalación de paquetes siguen siendo manuales en esta primera etapa.
- No se ejecutan SQL, migraciones, compilaciones ni restauraciones de respaldos. Tampoco se crean, modifican o eliminan bases de datos.
- El análisis tiene límites de profundidad y cantidad de archivos para no recorrer carpetas de dependencias y resultados de compilación.

Revisa el plan antes de confirmar: las restauraciones descargan paquetes y pueden crear o modificar carpetas de dependencias y archivos generados. En particular, npm ci reemplaza node_modules. No se ejecutan scripts del proyecto.


### Inventario de cadenas de conexión

`troc setup db-config "RUTA"` revisa las secciones `ConnectionStrings` de `appsettings*.json` y muestra si cada perfil tiene servidor/base configurados, el tipo de autenticación y los nombres de variables de entorno referenciadas.

No imprime hosts, nombres de bases, usuarios ni contraseñas; tampoco resuelve variables, modifica archivos ni abre conexiones. No sustituye una prueba real de conectividad.

### Diagnóstico del equipo

`troc setup doctor "RUTA"` comprueba herramientas requeridas por el proyecto (Node.js/npm, .NET, PHP/Composer, Python, Go, Rust o Java), busca Visual Studio 2026, VS Code y SSMS 22 cuando aplican, y consulta servicios locales de SQL Server, MySQL o PostgreSQL en Windows.

La detección de un servicio no demuestra que una base concreta exista, que el usuario tenga permisos o que la conexión funcione. El diagnóstico no usa credenciales, no se conecta a motores ni ejecuta SQL. Los servidores remotos no aparecen como servicios locales.

## Entorno de desarrollo

El módulo dev detecta herramientas y propone comandos build/test basándose en archivos del proyecto, pero no instala dependencias. Para restauraciones iniciales limitadas y confirmadas, usa troc setup.

| Toolchain | Detección | Comandos |
|---|---|---|
| Node.js | `package.json` | Scripts `build` y `test` declarados |
| .NET / Visual Studio | `.sln`, `.slnx` o `.csproj` | `dotnet build`, `dotnet test` |
| PHP / Composer | `composer.json` | `composer test`, si el script existe |
| Python | `pyproject.toml` | `py -m pytest -q` en Windows; `python3 -m pytest -q` en otros sistemas |
| Go | `go.mod` | `go build ./...`, `go test ./...` |
| Rust | `Cargo.toml` | `cargo build`, `cargo test` |

### Cómo funciona

`troc dev inspect ID` muestra toolchains y comandos detectados. `troc dev plan ID build|test` muestra lo que se ejecutaría, sin ejecutar nada. Para iniciar una compilación o prueba se requiere el parámetro `--confirm`.

Los scripts build/test pertenecen al proyecto y pueden ejecutar código. Revisa el manifiesto y el plan antes de confirmar. JCLI limita la ejecución a perfiles conocidos, no acepta comandos libres, ejecuta en la carpeta registrada, aplica un timeout local de tres minutos (configurable hasta diez) y recorta la salida guardada.

Los procesos hijos no reciben variables de entorno cuyos nombres indiquen claves, tokens, secretos, contraseñas o credenciales. JCLI no ejecuta `npm install`, Composer install ni gestores de paquetes de forma automática.

Los resultados quedan en `data/dev-runs/`; puedes consultarlos con `troc dev show ID` y `troc dev runs`. Esa carpeta está excluida de Git.

### Tareas de Visual Studio Code

`troc dev vscode-tasks ID --confirm` crea `.vscode/tasks.json` con las tareas build/test encontradas. Después, en VS Code abre la paleta de comandos y elige **Tasks: Run Task**. Si ya existe `.vscode/tasks.json`, JCLI se niega a sobrescribirlo; tendrás que combinar las tareas manualmente.

Visual Studio 2026 abre la solución registrada y usa los comandos del .NET SDK para build/test.

### SQL Server Management Studio 22

JCLI detecta SSMS 22 en su ruta de instalación habitual. Para una instalación personalizada puedes definir `SSMS22_PATH` con la ruta completa a `Ssms.exe` (o a su carpeta).

- `troc ide ssms22 detect`: comprueba si SSMS 22 está instalado.
- `troc ide ssms22 open ID`: abre SSMS 22.
- `troc ide ssms22 open ID ARCHIVO.sql`: abre un script SQL del proyecto registrado. El archivo debe estar dentro de esa carpeta.
- `troc ide ssms22 external-tool ID`: muestra los valores para registrar JCLI en **Herramientas > Herramientas externas**.
- `troc ide ssms22 inspect ID ARCHIVO.sql`: muestra ruta, tamaño y líneas del script, sin conectarse al servidor ni ejecutar SQL.

#### Conectar JCLI al menú Herramientas de SSMS

1. Ejecuta `troc ide ssms22 external-tool ID` y conserva los valores mostrados.
2. En SSMS abre **Herramientas > Herramientas externas** y agrega una entrada con el título indicado.
3. Usa `troc.cmd` como comando y copia los argumentos que genera JCLI. El argumento `$(ItemPath)` apunta al archivo actual del editor. Como directorio inicial, pega la ruta absoluta que muestra JCLI; debe ser la carpeta desde donde JCLI lee `data/projects/projects.json`.
4. Activa **Usar ventana de resultados** y **Tratar salida como Unicode**.
5. Abre un archivo `.sql` guardado y ejecuta la nueva herramienta desde el menú **Herramientas**.

La inspección solo lee metadatos básicos del archivo; no envía el contenido a una API, no abre conexiones, no modifica bases de datos y no ejecuta instrucciones SQL. La herramienta requiere que `troc.cmd` esté en PATH. Si lo acabas de instalar o modificar PATH, reinicia SSMS.

### Proyectos de base de datos SQL

JCLI detecta archivos `.sqlproj`. Si el archivo declara el SDK `Microsoft.Build.Sql`, propone `dotnet build` y no genera una tarea test falsa. Los proyectos SSDT clásicos se detectan, pero JCLI avisa que pueden requerir MSBuild y SSDT de Visual Studio; no intenta ejecutarlos mediante un comando incompatible.

JCLI no controla extensiones, cargas de trabajo ni ventanas gráficas de los IDEs.

## Conectores de IA

JCLI implementa llamadas HTTP directas a las APIs de OpenAI Responses, Gemini generateContent, DeepSeek Chat Completions y Anthropic Messages. Utiliza `fetch` de Node.js, sin SDK adicionales.

Los modelos predeterminados pueden cambiarse en `.env`. Consulta los disponibles con `troc providers models ID`; el acceso depende de tu cuenta y del modelo habilitado.

### Seguridad y costos

- Las claves van únicamente en `.env`, excluido de Git. Nunca las pegues en issues, commits o archivos TXT compartidos.
- `JCLI_ENABLE_API_CALLS=false` es el valor inicial.
- `JCLI_ENABLE_TEAM_RUNS=false` mantiene desactivadas las ejecuciones multiagente. Para ejecutar agentes necesitas habilitar ambos ajustes.
- Las llamadas a proveedores pueden generar cargos. Revisa la facturación y los precios con tu madre, padre o tutor antes de habilitarlas.
- El límite local inicial es de 5 solicitudes al día, 6,000 caracteres de entrada, 512 tokens de salida y 90 segundos por solicitud. No es un tope monetario ni reemplaza los límites de gasto del proveedor.

## Tareas TXT

Las tareas viven en `data/tasks/` y se pueden editar con Bloc de notas. Ejemplo:

```text
[TASK]
id=WEB-001
title=Crear panel
description=Describe aquí el trabajo pendiente.
status=pendientes
priority=media
created=2026-11-20
project=WEB
agents=planner,reviewer
[/TASK]
```

`project=` y `agents=` son opcionales. Estados: `pendientes`, `en_proceso`, `completadas` y `archivadas`.

## Coordinación multiagente

Hay cuatro perfiles editables en `config/agents.json`: planificador, proponente de código, revisor y analista de pruebas. Una tarea puede asignar hasta cuatro agentes.

- `troc team agents`: muestra los perfiles.
- `troc tasks agents ID planner,reviewer`: asigna perfiles. Usa `none` para quitar la asignación.
- `troc team plan ID --file README.md`: prepara el plan sin llamar a las APIs.
- `troc team run ID --file README.md`: ejecuta secuencialmente los agentes asignados.
- `troc team show RUN_ID`: consulta resultados.
- `troc team decide RUN_ID accept|reject`: registra revisión humana.

Solo se envían los archivos seleccionados después de `--file`. JCLI bloquea rutas externas, archivos y carpetas sensibles, y limita el tamaño del contexto. Los resultados quedan en `data/agents/runs/`. Aceptar una propuesta no modifica archivos del proyecto; los cambios deben revisarse y aplicarse manualmente.

## Historial y datos locales

Las operaciones generales se guardan en `data/history/events.jsonl`; el consumo de IA en `data/history/ai-usage.jsonl`; los resultados de build/test en `data/dev-runs/`. Los datos locales y potencialmente sensibles están excluidos de Git.

## V0.6 — Propuestas de cambios revisables

JCLI permite preparar y aplicar cambios de archivos de forma controlada. La propuesta se crea comparando un archivo existente con un archivo candidato que tú preparaste. Ambos deben estar dentro de la carpeta del proyecto registrada.

```powershell
# 1. Prepara una copia modificada del archivo dentro del proyecto.
# 2. Compara el original y el candidato:
troc patch draft WEB src/app.ts src/app.proposed.ts
troc patch show ID_PROPUESTA

# 3. Después de revisar el diff:
troc patch approve ID_PROPUESTA
troc patch apply ID_PROPUESTA --confirm

# 4. Para restaurar la versión anterior:
troc patch rollback ID_PROPUESTA --confirm

troc patch list
troc patch reject ID_PROPUESTA
```

### Reglas de protección

- La propuesta solo puede modificar un archivo existente dentro del proyecto registrado; no crea ni elimina archivos.
- Se bloquean rutas externas, traversal (`..`), enlaces simbólicos, dependencias, carpetas generadas y archivos típicos de credenciales.
- El archivo original se compara mediante SHA-256 al aplicar. Si cambió desde que se creó la propuesta, JCLI cancela la operación.
- Solo se aplican propuestas aprobadas y el comando de aplicación exige `--confirm`.
- Antes de escribir, se guarda una copia del contenido original en `data/patches/backups/`.
- La reversión exige que el archivo siga coincidiendo con la versión aplicada; no pisa cambios posteriores del usuario.
- Los registros y respaldos se guardan localmente en `data/patches/` y están excluidos de Git.
- Tamaño máximo por archivo: 256 KiB; máximo de 1,500 líneas.

Los agentes de IA siguen generando propuestas, no editan archivos directamente. Para usar una propuesta de un agente, prepara el archivo candidato, revísalo con `troc patch show` y sigue el flujo de aprobación.

## V0.7 — Git local

JCLI ahora puede consultar y administrar operaciones Git locales en proyectos registrados:

- `troc git status ID`: rama y archivos modificados, preparados o sin seguimiento.
- `troc git diff ID [--staged] [ARCHIVO]`: diferencias del área de trabajo o del staging.
- `troc git stage ID ARCHIVO... --confirm`: prepara hasta 20 archivos indicados explícitamente.
- `troc git unstage ID ARCHIVO... --confirm`: retira archivos del staging sin borrar sus cambios.
- `troc git commit ID "mensaje" --confirm`: crea un commit cuando ya hay cambios preparados.
- `troc git log ID [limite]`: consulta los commits recientes.
- `troc git branch list ID`: lista ramas locales.
- `troc git branch create ID RAMA --confirm`: crea y activa una rama local.
- `troc git branch switch ID RAMA --confirm`: cambia a una rama local existente.

### Límites y seguridad

- No acepta comandos Git libres ni construye comandos a través de una shell.
- Las rutas se validan como archivos individuales y se bloquean rutas externas, enlaces simbólicos, `.git`, dependencias, carpetas generadas y nombres típicos de secretos.
- Las operaciones de staging, commits y cambios de rama requieren `--confirm`.
- `unstage` no descarta cambios del directorio de trabajo. No se implementan `reset --hard`, `clean`, `checkout` destructivo ni `push` remoto.
- Git puede ejecutar filtros configurados al preparar archivos y hooks al crear commits. Revisa la configuración del repositorio antes de confirmar esas operaciones.
- Cada operación de escritura registra un evento en el historial local.

Versión actual: **0.7.0**.

## V0.8 — GitHub

JCLI usa el remoto `origin` del proyecto registrado y solo admite repositorios alojados en `github.com`.

### Consultas

- `troc github status`: muestra si hay token y si las escrituras están habilitadas.
- `troc github repo ID`: muestra repositorio, URL, rama principal y visibilidad.
- `troc github branches ID`: consulta ramas remotas.
- `troc github compare ID BASE HEAD`: consulta commits y archivos modificados entre dos ramas.
- `troc github prs ID [open|closed|all]` y `troc github pr show ID NUMERO`: consulta Pull Requests.
- `troc github issues ID [open|closed|all]` y `troc github issue show ID NUMERO`: consulta Issues (sin mezclar Pull Requests).

### Publicación

Para crear PRs o Issues configura `GITHUB_TOKEN` en `.env` y habilita `JCLI_ENABLE_GITHUB_WRITES=true`. Ambas condiciones son obligatorias además de `--confirm` en cada operación.

- `troc github pr create ID BASE TITULO DESCRIPCION --confirm`: crea un Pull Request desde la rama local actual.
- `troc github issue create ID TITULO DESCRIPCION --confirm`: crea un Issue.

El Pull Request solo se crea si la rama local está limpia y su último commit coincide con la rama ya publicada en GitHub. JCLI no hace `push`; publica la rama manualmente antes de solicitar el PR.

### Vínculos con tareas

- `troc github issue link ID_PROYECTO ID_TAREA NUMERO --confirm`: vincula una tarea existente con un Issue real del repositorio.
- `troc github issue links ID_PROYECTO`: consulta los vínculos locales.
- `troc github issue unlink ID_PROYECTO ID_TAREA --confirm`: elimina la asociación local sin cerrar ni borrar el Issue.

Los vínculos se guardan en `data/github/issue-links.json`, excluido de Git. No modifican los archivos TXT de tareas ni los Issues remotos.

### Token y permisos

Las consultas de repositorios públicos pueden funcionar sin token. Para privados configura un token de acceso personal granular limitado al repositorio que vas a usar. Para consultar, concede lectura de Contents, Pull requests e Issues según las funciones que necesites. Para publicar PRs concede escritura de Pull requests; para crear Issues concede escritura de Issues. No compartas el token ni lo pegues en conversaciones o archivos del proyecto.

`JCLI_ENABLE_GITHUB_WRITES=false` es el valor inicial. Las consultas GET siguen disponibles aunque las escrituras estén apagadas. El token se envía únicamente a `api.github.com`; los mensajes de error ocultan su valor.

JCLI no implementa `push`, fusión, cierre de PRs/Issues ni cambios de permisos.

Versión actual: **0.8.0**.

## V0.9 — Memoria técnica por proyecto

Cada proyecto registrado puede mantener una memoria local independiente de sus archivos de código:

- `troc memory summary ID TEXTO...`: guarda el resumen del proyecto y su objetivo.
- `troc memory scan ID`: guarda una instantánea de estructura a partir de un análisis limitado (lenguajes, tecnologías, manifiestos y presencia de Git).
- `troc memory note add ID TEXTO...`, `note list` y `note remove`: administra notas técnicas.
- `troc memory decision add ID TITULO DECISION [CONTEXTO...]`, `decision list` y `decision remove`: registra decisiones y su motivo.
- `troc memory show ID`: muestra la memoria completa del proyecto.
- `troc memory context ID`: muestra el contexto que se compartiría con los agentes.

Los análisis de estructura revisan como máximo 2,500 entradas y no almacenan el contenido de los archivos fuente. La memoria guarda metadatos del análisis, no copias de código. Notas y decisiones son información escrita por el usuario. Se limitan a 100 registros de cada tipo; las notas y decisiones tienen límites individuales de longitud. Se ocultan patrones comunes de credenciales al guardar.

Los registros viven en `data/knowledge/projects/`, se identifican mediante un hash del ID del proyecto y están excluidos de Git. La memoria se incorpora automáticamente a `troc team plan` y al contexto de cada agente. Se trata como dato histórico no confiable, no como instrucciones del sistema. Para compartirla con APIs se siguen aplicando los permisos y límites de llamadas multiagente ya configurados.

Versión actual: **0.10.0**.
