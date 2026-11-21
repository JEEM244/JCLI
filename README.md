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

## Comandos disponibles

```powershell
troc init
troc tasks list
troc tasks add
troc tasks done <ID>
troc tasks move <ID> <pendientes|en_proceso|completadas|archivadas>
troc providers list
troc providers status
```

## Tareas TXT

Las tareas viven en `data/tasks/`. Puedes editarlas con Bloc de notas. Cada tarea usa este formato:

```text
[TASK]
id=JCLI-001
title=Mi primera tarea
description=Describe aquí el trabajo pendiente.
status=pendientes
priority=media
created=2026-11-20
[/TASK]
```

Estados: `pendientes`, `en_proceso`, `completadas`, `archivadas`.

## Registro de proyectos

Los proyectos se guardan en `data/projects/projects.json`. Puedes registrarlos desde la terminal con `troc project add`, consultar el registro con `troc project list` y abrir su carpeta con `troc project open <ID>`.

- `troc project analyze <ID>`: cuenta archivos, identifica lenguajes, manifiestos y algunas tecnologías. Omite carpetas generadas y dependencias.
- `troc project git <ID>`: muestra la rama y los cambios de Git sin modificar archivos.
- `troc ide vscode detect` y `troc ide vs2026 detect`: buscan instalaciones de los IDE.
- `troc ide vscode open <ID>`: abre la carpeta registrada en VS Code.
- `troc ide vs2026 open <ID>`: abre la solución o proyecto .NET encontrado en Visual Studio 2026.

## Estado del proyecto

La CLI ya puede analizar proyectos, consultar el estado de Git y detectar/abrir Visual Studio Code y Visual Studio 2026 cuando están instalados. Todavía no realiza llamadas a APIs de IA ni ejecuta compilaciones o pruebas desde los IDEs. Las claves API se configuran por variables de entorno y nunca deben subirse al repositorio.
