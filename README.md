# JCLI

Centro de control local para proyectos, tareas e integraciones con herramientas de desarrollo e IA.

> El nombre del programa es **JCLI**. El comando de terminal es **`troc`**.

## Requisitos

- Windows 11 (PowerShell 7 recomendado)
- Node.js 20 o superior
- npm

## Instalación y ejecución

```powershell
npm install
Copy-Item .env.example .env
notepad .env
npm run dev -- init
```

Para compilar y usar el comando global:

```powershell
npm run build
npm link
troc
```

## Comandos

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
troc tasks done WEB-001
troc tasks move WEB-001 en_proceso

# Proyectos
troc project list
troc project add
troc project open WEB
troc project analyze WEB
troc project git WEB

# IDEs
troc ide vscode detect
troc ide vs2026 detect
troc ide vscode open WEB
troc ide vs2026 open WEB

# Proveedores de IA
troc providers list
troc providers status
troc providers test openai
troc providers models gemini

# Generación y consumo local
troc ai ask deepseek "Resume este fragmento de código"
troc ai usage
troc ai usage 50

# Entorno de desarrollo

JCLI detecta toolchains y comandos comunes sin instalar dependencias automáticamente:

- Node.js: ejecuta scripts `build` y `test` declarados en `package.json`.
- .NET: utiliza `dotnet build` y `dotnet test` sobre la solución o proyecto detectado.
- PHP: ejecuta `composer test` únicamente cuando el manifiesto declara ese script.
- Python: propone `pytest` si encuentra `pyproject.toml`.
- Go: utiliza `go build ./...` y `go test ./...`.
- Rust: utiliza `cargo build` y `cargo test`.

Comandos:

```powershell
troc dev inspect WEB
troc dev plan WEB build
troc dev plan WEB test
troc dev run WEB build --confirm
troc dev run WEB test --confirm
troc dev show ID_EJECUCION
troc dev runs
troc dev vscode-tasks WEB --confirm
```

La planificación no ejecuta nada. La ejecución requiere `--confirm`, corre localmente dentro de la carpeta registrada, no usa una shell con comandos escritos por el usuario, tiene un tiempo máximo y limita la salida guardada. Los scripts de compilación/pruebas pertenecen al proyecto y pueden ejecutar código; revisa el plan antes de confirmar. JCLI no instala paquetes, no ejecuta `npm install` y filtra variables con nombres de credenciales antes de iniciar los procesos. Las salidas quedan en `data/dev-runs/`, excluida de Git.

Visual Studio 2026 y Visual Studio Code siguen abriendo el proyecto mediante `troc ide`; .NET usa los comandos CLI del SDK, y VS Code puede recibir tareas locales con `troc dev vscode-tasks WEB --confirm`. El generador no sobrescribe `.vscode/tasks.json` existente. JCLI todavía no controla las ventanas gráficas ni sus extensiones.

# Equipo multiagente
troc team agents
troc tasks agents WEB-001 planner,implementer,reviewer
troc team plan WEB-001 --file README.md
troc team run WEB-001 --file README.md
troc team show <ID_EJECUCIÓN>
troc team decide <ID_EJECUCIÓN> accept

# Historial
troc history
troc history 50
```

## Conectores de IA

JCLI implementa llamadas HTTP directas a las APIs oficiales de OpenAI Responses, Gemini generateContent, DeepSeek Chat Completions y Anthropic Messages. No requiere SDKs adicionales: utiliza `fetch` de Node.js.

Cada proveedor tiene un modelo predeterminado editable mediante variables de entorno:

| Proveedor | Variable de modelo | Predeterminado |
|---|---|---|
| OpenAI | `OPENAI_MODEL` | `gpt-5.4-mini` |
| Gemini | `GEMINI_MODEL` | `gemini-3.8-flash` |
| DeepSeek | `DEEPSEEK_MODEL` | `deepseek-flash` |
| Claude | `ANTHROPIC_MODEL` | `claude-haiku-5-5` |

Los nombres pueden cambiar y el acceso depende de cada cuenta. Consulta los modelos disponibles con `troc providers models ID`. Si el modelo configurado no está disponible para tu clave, cambia la variable correspondiente en `.env`.

### Seguridad y costos

- Las claves van únicamente en `.env`, que está excluido de Git. Nunca pegues una clave en un issue, commit o archivo TXT compartido.
- `JCLI_ENABLE_API_CALLS=false` es el valor inicial. La generación no funciona hasta que se active explícitamente.
- `JCLI_ENABLE_TEAM_RUNS=false` mantiene desactivadas las ejecuciones multiagente. Para usarlas se requieren ambas opciones activadas; una ejecución puede enviar hasta 4 solicitudes secuenciales.
- Antes de habilitar llamadas que pueden generar cargos, revisa el precio y la facturación del proveedor con tu madre, padre o tutor.
- `troc providers test ID` consulta el catálogo de modelos para comprobar credenciales; no genera texto.
- El límite local inicial es de 5 solicitudes por día, 6,000 caracteres de entrada, 512 tokens máximos de salida y 90 segundos por solicitud.
- Estos límites son una protección local, no un tope monetario ni un sustituto de los límites de gasto de la cuenta del proveedor.
- `troc ai usage` muestra intentos registrados y tokens reportados por la API. No calcula importes ni garantiza que todos los proveedores reporten el uso con el mismo detalle.

El equipo se puede configurar y planear sin contactar a ningún proveedor. Para una ejecución remota, revisa primero los costos con un adulto responsable. Las llamadas multiagente pueden generar varios cargos, por lo que permanecen desactivadas por defecto.

Para activar generación después de revisar lo anterior, cambia en `.env`:

```dotenv
JCLI_ENABLE_API_CALLS=true
JCLI_ENABLE_TEAM_RUNS=true
```

## Tareas TXT

Las tareas viven en `data/tasks/`. Puedes editarlas con Bloc de notas. Cada tarea usa este formato:

```text
[TASK]
id=WEB-001
title=Crear panel
description=Describe aquí el trabajo pendiente.
status=pendientes
priority=media
created=2026-11-20
project=WEB
[/TASK]
```

La línea `project=` es opcional. Estados: `pendientes`, `en_proceso`, `completadas` y `archivadas`. Los filtros de `tasks list` incluyen `--project ID`, `--priority nivel` y `--search texto`.

## Coordinación multiagente

Las asignaciones de agentes se guardan en los propios TXT con la línea opcional `agents=planner,reviewer`. Hay cuatro perfiles editables en `config/agents.json`: planificador, proponente de código, revisor y analista de pruebas. Cada tarea puede asignar hasta cuatro.

- `troc team agents`: muestra los perfiles.
- `troc tasks agents ID planner,reviewer`: asigna perfiles a una tarea. Usa `none` para quitar la asignación.
- `troc team plan ID --file README.md`: valida la selección de contexto y muestra las solicitudes previstas sin llamar a APIs.
- `troc team run ID --file README.md`: envía la tarea en secuencia a los agentes asignados.
- `troc team show RUN_ID`: consulta resultados guardados localmente.
- `troc team decide RUN_ID accept|reject`: registra la revisión humana.

Solo se envían archivos escritos después de `--file`. JCLI bloquea rutas fuera del proyecto, archivos `.env`, credenciales, carpetas de dependencias y archivos demasiado grandes. El contenido del repositorio se trata como datos, no como instrucciones. Las respuestas quedan guardadas en `data/agents/runs/`. **Aceptar un resultado no modifica ningún archivo**: las propuestas requieren revisión y aplicación manual.

## Historial y uso

Las operaciones generales se guardan en `data/history/events.jsonl`. Las solicitudes a proveedores y sus métricas de uso se guardan por separado en `data/history/ai-usage.jsonl`.

## Registro de proyectos e IDEs

Los proyectos se guardan en `data/projects/projects.json`. `troc project analyze ID` cuenta archivos e identifica lenguajes, manifiestos y algunas tecnologías. `troc project git ID` muestra la rama y los cambios de Git sin modificarlos. JCLI puede detectar y abrir Visual Studio Code y Visual Studio 2026.

## Estado actual y límites

JCLI administra tareas, proyectos y conexiones directas de generación con los cuatro proveedores configurados. La etapa actual no incluye conversación persistente, lectura automática de todo un repositorio por IA, streaming de respuestas ni cálculos de costos. Los cambios de archivos, Git y compilaciones desde IDEs siguen requiriendo etapas posteriores.
