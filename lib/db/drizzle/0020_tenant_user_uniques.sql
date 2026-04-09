drop index if exists "users_phone_unique";
drop index if exists "users_employee_id_unique";

create unique index if not exists "users_tenant_phone_unique" on "users" using btree ("tenant_id","phone");
create unique index if not exists "users_tenant_employee_id_unique" on "users" using btree ("tenant_id","employee_id");
