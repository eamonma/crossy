alter table "public"."games" drop constraint "games_created_by_fkey";

drop view if exists "public"."user_related_games";

alter table "public"."games" alter column "created_by" drop default;

alter table "public"."games" alter column "created_by" drop not null;

alter table "public"."games" add constraint "games_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."games" validate constraint "games_created_by_fkey";


