-- El acceso real lo deciden las políticas RLS; estos permisos solo habilitan la API para usuarios con sesión.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant usage on type public.app_role, public.task_status to authenticated;
