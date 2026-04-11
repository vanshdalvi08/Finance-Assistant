alter table "platform_events"
  add column if not exists "fingerprint" text,
  add column if not exists "acknowledged_at" timestamp with time zone,
  add column if not exists "acknowledged_by_user_id" uuid,
  add column if not exists "resolved_at" timestamp with time zone,
  add column if not exists "resolved_by_user_id" uuid;

DO $$ BEGIN
  ALTER TABLE "platform_events"
    ADD CONSTRAINT "platform_events_acknowledged_by_user_id_users_id_fk"
    FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "platform_events"
    ADD CONSTRAINT "platform_events_resolved_by_user_id_users_id_fk"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

update "platform_events"
set "fingerprint" = md5(
  coalesce("category"::text, '') || '|' ||
  coalesce("title", '') || '|' ||
  coalesce("path", '') || '|' ||
  coalesce("method", '') || '|' ||
  coalesce("status_code"::text, '')
)
where "fingerprint" is null;

create index if not exists "platform_events_fingerprint_index" on "platform_events" using btree ("fingerprint");
create index if not exists "platform_events_unresolved_index" on "platform_events" using btree ("resolved_at", "created_at");
