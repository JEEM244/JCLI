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

## Estado del proyecto

Esta es la primera base funcional. Todavía no realiza llamadas a APIs de IA ni ejecuta acciones sobre Visual Studio. Las claves API se configuran por variables de entorno y nunca deben subirse al repositorio.
