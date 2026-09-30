-- Importador KML/KMZ: grava a geometria de uma oportunidade a partir de GeoJSON.
-- Várias feições do mesmo MD (ex.: polígono + marcador) viram uma só geometria (união), sem Z.
create or replace function public.set_opportunity_geometry(p_memorial_number text, p_geometries jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_geom extensions.geometry;
begin
  select extensions.st_force2d(extensions.st_union(extensions.st_setsrid(extensions.st_geomfromgeojson(g), 4326)))
    into v_geom
  from jsonb_array_elements(p_geometries) as g;

  -- Polígono + ponto do mesmo lote: fica o polígono (o ponto não acrescenta informação).
  if extensions.st_geometrytype(v_geom) = 'ST_GeometryCollection' then
    v_geom := coalesce(nullif(extensions.st_collectionextract(v_geom, 3), 'GEOMETRYCOLLECTION EMPTY'), v_geom);
  end if;

  update public.opportunities set geometry = v_geom where memorial_number = p_memorial_number;
  return found;
end;
$$;

-- Só scripts com service_role (importador). Admin via UI chega na Fase 2.
revoke execute on function public.set_opportunity_geometry(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_opportunity_geometry(text, jsonb) to service_role;
