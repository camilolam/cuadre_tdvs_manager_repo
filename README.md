# Planes de Trabajo

Aplicación web para gestionar planes de trabajo por proyecto: tareas asignadas a colaboradores, con cuatro estados (pendiente, en ejecución, detenida, finalizada) y una línea de tiempo tipo Gantt.

- **Frontend:** HTML, CSS y JavaScript sin compilación, publicado con GitHub Pages.
- **Backend:** Supabase (proyecto `Cuadre_tdvs_manager`): autenticación, base de datos Postgres con RLS, tiempo real y una Edge Function para gestionar usuarios.

## Roles

| Acción | Administrador | Colaborador |
|---|---|---|
| Ver proyectos, tareas y equipo | Sí | Sí |
| Crear proyectos | Sí | Sí |
| Editar o eliminar proyectos | Sí | No |
| Crear tareas | Sí, para cualquier persona | Sí, siempre asignadas a sí mismo |
| Modificar tareas y cambiar su estado | Todas | Solo las asignadas a sí mismo |
| Eliminar tareas | Sí | No |
| Crear, editar, aprobar y eliminar usuarios | Sí | No |

Las reglas se aplican en la base de datos (políticas RLS en `supabase/migrations`), no solo en la interfaz.

## Primer acceso

1. Abre la app y elige **Crear cuenta**. La **primera cuenta** del sistema queda como administrador activo.
2. Confirma el correo con el enlace que envía Supabase.
3. Desde **Equipo de trabajo → Nuevo usuario**, el administrador crea a los colaboradores con un correo y una contraseña temporal. Cada uno puede cambiarla luego con el botón **Contraseña**.
4. Si alguien se registra por su cuenta, queda **pendiente de aprobación** hasta que un administrador lo apruebe.

## Estructura

```
index.html                     Página única de la aplicación
css/styles.css                 Estilos (tema claro y oscuro)
js/config.js                   URL y clave pública de Supabase
js/app.js                      Lógica: sesión, roles, proyectos, tareas, equipo, Gantt
supabase/migrations/           Esquema, triggers y políticas RLS
supabase/functions/admin-users Edge Function: crear/eliminar usuarios y cambiar contraseñas (solo admin)
```

## Configuración de Supabase recomendada

En **Authentication → URL Configuration**, pon la URL de GitHub Pages como **Site URL** y agrégala en **Redirect URLs**, para que los enlaces de confirmación y recuperación de contraseña regresen a la app.
