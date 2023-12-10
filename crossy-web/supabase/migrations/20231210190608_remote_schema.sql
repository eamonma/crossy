create type "public"."game_status" as enum ('ongoing', 'completed', 'abandoned');

drop policy "Enable delete for users based on user_id" on "public"."games";

alter table "public"." user_game" drop constraint " user_game_game_fkey";

alter table "public"." user_game" drop constraint " user_game_user_fkey";

alter table "public"."games" drop constraint "games_created_by_fkey";

alter table "public"." user_game" drop constraint " user_game_pkey";

drop index if exists "public"." user_game_pkey";

drop table "public"." user_game";

create table "public"."game_user" (
    "game_id" uuid not null,
    "user_id" uuid not null,
    "created_at" timestamp with time zone not null default now(),
    "n_actions" bigint not null default '0'::bigint
);


alter table "public"."game_user" enable row level security;

create table "public"."status_of_game" (
    "id" uuid not null,
    "status" game_status not null default 'ongoing'::game_status,
    "game_ended_at" timestamp with time zone
);


alter table "public"."status_of_game" enable row level security;

alter table "public"."games" add column "password" text not null default md5((random())::text);

alter table "public"."games" alter column "created_by" set default auth.uid();

alter table "public"."games" alter column "created_by" set not null;

alter table "public"."games" alter column "grid" set default '{}'::text[];

alter table "public"."games" alter column "grid" set not null;

CREATE UNIQUE INDEX game_user_pkey ON public.game_user USING btree (game_id, user_id);

CREATE UNIQUE INDEX status_of_game_pkey ON public.status_of_game USING btree (id);

alter table "public"."game_user" add constraint "game_user_pkey" PRIMARY KEY using index "game_user_pkey";

alter table "public"."status_of_game" add constraint "status_of_game_pkey" PRIMARY KEY using index "status_of_game_pkey";

alter table "public"."game_user" add constraint "game_user_game_id_fkey" FOREIGN KEY (game_id) REFERENCES games(id) not valid;

alter table "public"."game_user" validate constraint "game_user_game_id_fkey";

alter table "public"."game_user" add constraint "game_user_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) not valid;

alter table "public"."game_user" validate constraint "game_user_user_id_fkey";

alter table "public"."status_of_game" add constraint "status_of_game_id_fkey" FOREIGN KEY (id) REFERENCES games(id) not valid;

alter table "public"."status_of_game" validate constraint "status_of_game_id_fkey";

alter table "public"."games" add constraint "games_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) not valid;

alter table "public"."games" validate constraint "games_created_by_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.create_status_of_game()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Insert a row into status_of_game
  INSERT INTO status_of_game (id, status, game_ended_at)
  VALUES (NEW.id, 'ongoing', NULL);
  
  -- Return the new row to indicate successful completion
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.initialize_grid()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  puzzle_rows INT;
  puzzle_columns INT;
BEGIN
  -- Fetch row and column values from the puzzles table for the current puzzle_id
  SELECT rows, cols INTO puzzle_rows, puzzle_columns
  FROM puzzles
  WHERE id = NEW.puzzle_id;

  -- Now use these values to generate the grid array
  NEW.grid := ARRAY(SELECT NULL FROM generate_series(1, puzzle_rows * puzzle_columns));

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_grid_element(game_id uuid, grid_index integer, new_value text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    current_status public.game_status;
BEGIN
    -- Check the current status of the game
    SELECT status INTO current_status FROM status_of_game WHERE id = game_id;

    -- Proceed only if the status is 'ongoing'
    IF current_status = 'ongoing' THEN
        UPDATE games
        SET grid[grid_index + 1] = new_value
        WHERE id = game_id;
    -- ELSE
        -- Optionally, raise an error if the game is not ongoing
        -- RAISE EXCEPTION 'Cannot update grid as the game status is not ongoing.';
    END IF;

END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_has_game_access(game_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  current_user_id uuid;
BEGIN
  SELECT auth.uid() INTO current_user_id;
  RETURN EXISTS (
    SELECT 1 FROM public.game_user
    WHERE game_user.game_id = user_has_game_access.game_id AND game_user.user_id = current_user_id
  );
END;
$function$
;

create or replace view "public"."user_related_games" as  SELECT g.created_at,
    g.updated_at,
    g.created_by,
    g.grid,
    g.puzzle_id,
    g.id,
    g.password
   FROM (games g
     JOIN game_user gu ON ((g.id = gu.game_id)))
  WHERE (gu.user_id = auth.uid());


create policy "Allow read"
on "public"."game_user"
as permissive
for select
to authenticated
using (true);


create policy "Allow allowed user"
on "public"."games"
as permissive
for select
to authenticated
using (((auth.uid() = created_by) OR user_has_game_access(id)));


create policy "Allow authorized user to participate"
on "public"."games"
as permissive
for update
to authenticated
using (((auth.uid() = created_by) OR user_has_game_access(id)))
with check (((auth.uid() = created_by) OR user_has_game_access(id)));


create policy "Enable update for users based on id"
on "public"."games"
as permissive
for update
to public
using ((auth.uid() = created_by))
with check ((auth.uid() = created_by));


create policy "Allow user to select if user_game includes a valid row"
on "public"."puzzles"
as permissive
for select
to authenticated
using ((EXISTS ( SELECT 1
   FROM (games
     JOIN game_user ON ((games.id = game_user.game_id)))
  WHERE ((games.puzzle_id = puzzles.id) AND (game_user.user_id = auth.uid())))));


create policy "Allow insert"
on "public"."status_of_game"
as permissive
for insert
to authenticated
with check (true);


create policy "Enable read access for all users"
on "public"."status_of_game"
as permissive
for select
to authenticated
using (true);


CREATE TRIGGER set_grid_default BEFORE INSERT ON public.games FOR EACH ROW EXECUTE FUNCTION initialize_grid();

CREATE TRIGGER trigger_create_status_of_game AFTER INSERT ON public.games FOR EACH ROW EXECUTE FUNCTION create_status_of_game();


