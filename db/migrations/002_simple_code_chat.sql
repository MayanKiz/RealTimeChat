alter table users add column if not exists display_name text;
alter table users add column if not exists contact_code text;
alter table messages add column if not exists body text;
alter table messages alter column encrypted_payload drop not null;
create unique index if not exists users_contact_code_unique on users(contact_code) where contact_code is not null;
update users set display_name=coalesce(display_name, split_part(email,'@',1)) where display_name is null;
