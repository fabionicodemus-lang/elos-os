-- Elos OS — Imagens de capa dos empreendimentos

alter table public.projects
  add column if not exists cover_image_path text;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'project-images',
  'project-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "project_images_member_read" on storage.objects;
create policy "project_images_member_read"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-images'
  and public.is_company_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "project_images_manager_insert" on storage.objects;
create policy "project_images_manager_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-images'
  and public.has_company_permission(
    ((storage.foldername(name))[1])::uuid,
    'projects.manage'
  )
  and exists (
    select 1
    from public.projects project
    where project.company_id = ((storage.foldername(name))[1])::uuid
      and project.id = ((storage.foldername(name))[2])::uuid
  )
);

drop policy if exists "project_images_manager_update" on storage.objects;
create policy "project_images_manager_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'project-images'
  and public.has_company_permission(
    ((storage.foldername(name))[1])::uuid,
    'projects.manage'
  )
)
with check (
  bucket_id = 'project-images'
  and public.has_company_permission(
    ((storage.foldername(name))[1])::uuid,
    'projects.manage'
  )
);

drop policy if exists "project_images_manager_delete" on storage.objects;
create policy "project_images_manager_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-images'
  and public.has_company_permission(
    ((storage.foldername(name))[1])::uuid,
    'projects.manage'
  )
);
