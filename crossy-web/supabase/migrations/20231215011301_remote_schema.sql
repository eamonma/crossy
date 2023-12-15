alter table "public"."games" alter column "created_by" set default auth.uid();


