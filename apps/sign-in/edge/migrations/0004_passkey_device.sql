-- The device that asked for an invitation and the passkey made with it (`Invite` in `auth.ts`), and the device whose
-- Add Passkey made a passkey, which lets it unlock with no code to check.
alter table "invite" add column "device" text;
alter table "invite" add column "credential" text;
alter table "passkey" add column "device" text;
