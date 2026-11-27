-- An invitation may be for nobody yet (`Invite` in `auth.ts`): a link to join as someone new makes their user as they
-- join, so `userId` can be empty, and it may name the email of the only Google account that joins by it. SQLite can't
-- drop `not null`, so the table is made again.
create table "invite_new" ("id" text not null primary key, "userId" text references "user" ("id") on delete cascade, "email" text, "expiresAt" date not null, "device" text, "credential" text);
insert into "invite_new" ("id", "userId", "expiresAt", "device", "credential") select "id", "userId", "expiresAt", "device", "credential" from "invite";
drop table "invite";
alter table "invite_new" rename to "invite";
