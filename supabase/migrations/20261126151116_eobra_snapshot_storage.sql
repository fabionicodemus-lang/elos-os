-- Large migration packets go directly to private Storage, avoiding HTTP body
-- limits on the application server. A packet is immutable and owned by its uploader.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('eobra-migration-snapshots', 'eobra-migration-snapshots', false, 52428800, array['application/json'])
on conflict (id) do nothing;

create policy eobra_snapshot_upload_owner on storage.objects
for insert to authenticated
with check (
  bucket_id = 'eobra-migration-snapshots'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case when name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.json$'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then public.has_company_permission(((storage.foldername(name))[1])::uuid, 'admin.company.manage')
  else false end
);

create policy eobra_snapshot_read_owner on storage.objects
for select to authenticated
using (
  bucket_id = 'eobra-migration-snapshots'
  and (storage.foldername(name))[2] = auth.uid()::text
  and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then public.has_company_permission(((storage.foldername(name))[1])::uuid, 'admin.company.manage')
  else false end
);

-- No UPDATE/DELETE policy: the reviewed file cannot be overwritten in place.
