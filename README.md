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

# Visual Studio 2026 y Visual Studio Code
troc ide vscode detect
troc ide vs2026 detect
troc ide vscode open WEB
troc ide vs2026 open WEB

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

# Equipo multiagente
troc team agents
troc tasks agents WEB-001 planner,implementer,reviewer,tester
troc team plan WEB-001 --file README.md
troc team run WEB-001 --file README.md
troc team show ID_EJECUCION
troc team decide ID_EJECUCION accept

# Historial
troc history
troc history 50
```

## Entorno de desarrollo

JCLI detecta herramientas y propone comandos basándose en archivos del proyecto. No instala dependencias automáticamente.

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

Visual Studio 2026 abre la solución registrada y usa los comandos del .NET SDK para build/test. JCLI todavía no controla extensiones, cargas de trabajo ni ventanas gráficas de los IDEs.

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

## Estado actual

Versión actual: **0.6.0**.

JCLI incluye gestión de tareas y proyectos, conectores de IA, coordinación multiagente, detección y ejecución controlada de build/test, integración inicial con VS Code y Visual Studio 2026, y aplicación asistida de cambios con revisión, respaldo y reversión.
