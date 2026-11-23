-- Where the network's apps are downloaded from is the Downloads app's (`apps/downloads`), which reads what Software Update
-- publishes: Sign-In keeps it no longer.
delete from "setting" where "name" = 'downloads';
