-- Reverte 20261019000004_md_editor.sql.
-- ATENÇÃO: apaga o registro dos documentos (os arquivos no Storage ficam; remova o bucket à mão se quiser).
begin;

drop policy if exists opportunity_documents_objects_select on storage.objects;
drop policy if exists opportunity_documents_objects_insert on storage.objects;
drop policy if exists opportunity_documents_objects_delete on storage.objects;
drop policy if exists opportunity_media_objects_broker_select on storage.objects;
drop policy if exists opportunity_media_objects_broker_insert on storage.objects;
drop policy if exists opportunity_media_objects_broker_delete on storage.objects;

drop table if exists public.opportunity_documents;
drop function if exists public.review_owner_authorization(uuid, boolean, text);
drop function if exists public.guard_document_write();
drop type if exists public.review_status;
drop type if exists public.document_sensitivity;
drop type if exists public.document_kind;

drop policy if exists opportunity_media_broker_select on public.opportunity_media;
drop policy if exists opportunity_media_broker_insert on public.opportunity_media;
drop policy if exists opportunity_media_broker_update on public.opportunity_media;
drop policy if exists opportunity_media_broker_delete on public.opportunity_media;
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'opportunity-media';

drop function if exists public.upsert_opportunity_sensitive(uuid, text, text, text, jsonb, text);
drop function if exists public.get_opportunity_geometry(uuid);
drop function if exists public.set_opportunity_geometry_geojson(uuid, jsonb);
drop function if exists public.storage_opportunity_id(text);

-- Cadastro do corretor volta a não exigir o termo-mestre.
drop policy if exists opportunities_broker_insert on public.opportunities;
create policy opportunities_broker_insert on public.opportunities for insert to authenticated
  with check (public.is_approved_broker() and responsible_party_user_id = (select auth.uid()));
drop function if exists public.can_edit_opportunity(uuid);

commit;
