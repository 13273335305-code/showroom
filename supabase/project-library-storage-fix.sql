begin;

-- Deduplicating inserts also check SELECT before the new record is visible.
drop policy if exists spenic_resources_read on public.spenic_resource_files;
create policy spenic_resources_read on public.spenic_resource_files for select to authenticated using (
  owner_id = auth.uid() or public.spenic_can_read_resource(storage_path)
);

-- Uploads must be readable by their owner before resource registration.
drop policy if exists spenic_storage_read on storage.objects;
create policy spenic_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'spenic-project-resources' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.spenic_can_read_resource(name)
  )
);

commit;
