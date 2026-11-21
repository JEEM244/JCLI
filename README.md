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
npm run dev -- init
npm run dev -- tasks list
```

Para compilar y usar el comando global:

```powershell
npm run build
npm link
troc
```

## Comandos principales

```powershell
troc init
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
troc history
troc history 50

troc project list
troc project add
troc project open WEB
troc project analyze WEB
troc project git WEB

troc ide vscode detect
troc ide vs2026 detect
troc ide vscode open WEB
troc ide vs2026 open WEB

troc providers list
troc providers status
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

La línea `project=` es opcional, por lo que los TXT creados con versiones anteriores siguen siendo compatibles. Los estados disponibles son: `pendientes`, `en_proceso`, `completadas` y `archivadas`. Si un bloque tiene campos obligatorios inválidos o declara un estado distinto al archivo donde está guardado, JCLI muestra un error para que puedas corregirlo con Bloc de notas.

Los filtros disponibles para `tasks list` son `--project ID`, `--priority nivel` y `--search texto`. La búsqueda `tasks search` consulta ID, título, descripción, prioridad, estado y proyecto.

## Historial

Las operaciones se guardan localmente en `data/history/events.jsonl`. El archivo usa JSON Lines: cada línea representa un evento independiente y puede consultarse con `troc history`. Registra creación y edición de tareas, cambios de estado, asociación/desasociación de proyectos y registro de proyectos.

## Registro de proyectos e IDEs

Los proyectos se guardan en `data/projects/projects.json`. Puedes registrarlos desde la terminal con `troc project add`.

- `troc project analyze ID`: cuenta archivos, identifica lenguajes, manifiestos y algunas tecnologías.
- `troc project git ID`: muestra la rama y los cambios de Git sin modificarlos.
- `troc ide vscode detect` y `troc ide vs2026 detect`: buscan instalaciones de los IDE.
- `troc ide vscode open ID`: abre la carpeta registrada en Visual Studio Code.
- `troc ide vs2026 open ID`: abre una solución o proyecto .NET encontrado en Visual Studio 2026.

## Estado actual y límites

JCLI administra tareas TXT, registro de proyectos, asociación tarea-proyecto, historial local, análisis básico de proyectos, consulta de Git y apertura de Visual Studio Code y Visual Studio 2026. Todavía no realiza llamadas a APIs de IA ni ejecuta compilaciones o pruebas desde los IDEs. La presencia de una clave de API en el entorno no confirma que sea válida ni que tenga saldo. Nunca subas `.env`, claves ni tokens al repositorio.
