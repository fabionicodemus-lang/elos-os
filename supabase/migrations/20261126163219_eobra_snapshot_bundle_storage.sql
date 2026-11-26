-- Bounded, immutable transport for large snapshots. Legacy JSON uploads retain
-- their separate 50 MiB bucket and uploader-only access policy.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('eobra-migration-bundles','eobra-migration-bundles',false,2097152,array['application/json'])
on conflict(id) do nothing;

create or replace function public.eobra_bundle_storage_authorized(p_company_id uuid)
returns boolean language sql stable security invoker set search_path=pg_catalog,public
as $$
  select auth.uid() is not null and p_company_id is not null
    and not exists(select 1 from unnest(array[
      'admin.company.manage','projects.manage','clients.manage','suppliers.manage',
      'sales.manage','receivables.manage','payables.manage','finance.bank_accounts.manage'
    ]) permission where public.has_company_permission(p_company_id,permission) is not true);
$$;
revoke all on function public.eobra_bundle_storage_authorized(uuid) from public,anon;
grant execute on function public.eobra_bundle_storage_authorized(uuid) to authenticated;

create policy eobra_bundle_upload_owner on storage.objects
for insert to authenticated
with check (
  bucket_id='eobra-migration-bundles'
  and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(manifest\.json|part-(00000[1-9]|0000[1-9][0-9]|000[1-9][0-9]{2}|001000)\.json)$'
    then split_part(name,'/',2)=auth.uid()::text
      and public.eobra_bundle_storage_authorized(split_part(name,'/',1)::uuid)
    else false end
);

create policy eobra_bundle_authorized_read on storage.objects
for select to authenticated
using (
  bucket_id='eobra-migration-bundles'
  and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(manifest\.json|part-(00000[1-9]|0000[1-9][0-9]|000[1-9][0-9]{2}|001000)\.json)$'
    then public.eobra_bundle_storage_authorized(split_part(name,'/',1)::uuid)
      and (split_part(name,'/',2)=auth.uid()::text or exists(
        select 1 from public.eobra_migration_runs r
        where r.company_id=split_part(storage.objects.name,'/',1)::uuid
          and r.source_storage_path=split_part(storage.objects.name,'/',1)||'/'||split_part(storage.objects.name,'/',2)||'/'||split_part(storage.objects.name,'/',3)||'/manifest.json'
      ))
    else false end
);

-- No UPDATE/DELETE policy. Another currently authorized operator can resume a
-- persisted run visible through its existing project RLS. Pre-run uploads stay
-- private to the uploader. Every read checks all native domain permissions.
commit;
