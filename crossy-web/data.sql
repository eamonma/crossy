
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS "pgsodium" WITH SCHEMA "pgsodium";

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "pgjwt" WITH SCHEMA "extensions";

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

CREATE TYPE "public"."game_status" AS ENUM (
    'ongoing',
    'completed',
    'abandoned'
);

ALTER TYPE "public"."game_status" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    -- Initialize variables for 'avatar_url' and 'full_name'
    DECLARE
        v_avatar_url TEXT;
        v_full_name TEXT;
    BEGIN
        -- Extract 'avatar_url' if it exists
        IF NEW.raw_user_meta_data ? 'avatar_url' THEN
            v_avatar_url := NEW.raw_user_meta_data ->> 'avatar_url';
        ELSE
            v_avatar_url := NULL;
        END IF;

        -- Extract 'full_name' if it exists
        IF NEW.raw_user_meta_data ? 'full_name' THEN
            v_full_name := NEW.raw_user_meta_data ->> 'full_name';
        ELSE
            v_full_name := NULL;
        END IF;

        -- Insert into 'profiles' with extracted data
        INSERT INTO public.profiles (id, avatar_url, full_name)
        VALUES (NEW.id, v_avatar_url, v_full_name);
    END;
    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."initialize_grid"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;

ALTER FUNCTION "public"."initialize_grid"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."update_grid_element"("game_id" "uuid", "grid_index" integer, "new_value" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    row_count int;
BEGIN
    UPDATE games
    SET grid[grid_index + 1] = new_value
    WHERE id = game_id;

END;
$$;

ALTER FUNCTION "public"."update_grid_element"("game_id" "uuid", "grid_index" integer, "new_value" "text") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."user_has_game_access"("game_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  current_user_id uuid;
BEGIN
  SELECT auth.uid() INTO current_user_id;
  RETURN EXISTS (
    SELECT 1 FROM public.game_user
    WHERE game_user.game_id = user_has_game_access.game_id AND game_user.user_id = current_user_id
  );
END;
$$;

ALTER FUNCTION "public"."user_has_game_access"("game_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

CREATE TABLE IF NOT EXISTS "public"."game_user" (
    "game_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "n_actions" bigint DEFAULT '0'::bigint NOT NULL
);

ALTER TABLE "public"."game_user" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."games" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "grid" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "puzzle_id" "uuid" NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "password" "text" DEFAULT "md5"(("random"())::"text") NOT NULL
);

ALTER TABLE "public"."games" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text",
    "full_name" "text",
    "avatar_url" "text",
    "updated_at" timestamp with time zone
);

ALTER TABLE "public"."profiles" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."puzzles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "name" "text",
    "rows" smallint NOT NULL,
    "cols" smallint NOT NULL,
    "grid" "text"[] NOT NULL,
    "gridnums" smallint[] NOT NULL,
    "circles" boolean[],
    "created_by" "uuid" DEFAULT "auth"."uid"(),
    "clues" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "answers" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

ALTER TABLE "public"."puzzles" OWNER TO "postgres";

CREATE OR REPLACE VIEW "public"."user_related_games" AS
 SELECT "g"."created_at",
    "g"."updated_at",
    "g"."created_by",
    "g"."grid",
    "g"."puzzle_id",
    "g"."id",
    "g"."password"
   FROM ("public"."games" "g"
     JOIN "public"."game_user" "gu" ON (("g"."id" = "gu"."game_id")))
  WHERE ("gu"."user_id" = "auth"."uid"());

ALTER TABLE "public"."user_related_games" OWNER TO "postgres";

ALTER TABLE ONLY "public"."puzzles"
    ADD CONSTRAINT "Puzzles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."game_user"
    ADD CONSTRAINT "game_user_pkey" PRIMARY KEY ("game_id", "user_id");

ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");

CREATE OR REPLACE TRIGGER "set_grid_default" BEFORE INSERT ON "public"."games" FOR EACH ROW EXECUTE FUNCTION "public"."initialize_grid"();

ALTER TABLE ONLY "public"."game_user"
    ADD CONSTRAINT "game_user_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id");

ALTER TABLE ONLY "public"."game_user"
    ADD CONSTRAINT "game_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");

ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_puzzle_id_fkey" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("id");

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ONLY "public"."puzzles"
    ADD CONSTRAINT "puzzles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

CREATE POLICY "Allow allowed user" ON "public"."games" FOR SELECT TO "authenticated" USING ((("auth"."uid"() = "created_by") OR "public"."user_has_game_access"("id")));

CREATE POLICY "Allow authorized user to participate" ON "public"."games" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "created_by") OR "public"."user_has_game_access"("id"))) WITH CHECK ((("auth"."uid"() = "created_by") OR "public"."user_has_game_access"("id")));

CREATE POLICY "Allow insertion " ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));

CREATE POLICY "Allow read if user" ON "public"."game_user" FOR SELECT TO "authenticated" USING (true);

CREATE POLICY "Allow user to select if user_game includes a valid row" ON "public"."puzzles" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."games"
     JOIN "public"."game_user" ON (("games"."id" = "game_user"."game_id")))
  WHERE (("games"."puzzle_id" = "puzzles"."id") AND ("game_user"."user_id" = "auth"."uid"())))));

CREATE POLICY "Enable all actions for users based on user_id" ON "public"."puzzles" TO "authenticated" USING (("auth"."uid"() = "created_by")) WITH CHECK (("auth"."uid"() = "created_by"));

CREATE POLICY "Enable insert for authenticated users only" ON "public"."puzzles" FOR INSERT TO "authenticated" WITH CHECK (true);

CREATE POLICY "Enable insertion for user that created puzzle" ON "public"."games" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."puzzles"
  WHERE (("puzzles"."id" = "games"."puzzle_id") AND ("puzzles"."created_by" = "auth"."uid"())))));

CREATE POLICY "Enable read access for all users" ON "public"."profiles" FOR SELECT USING (true);

CREATE POLICY "Enable update for users based on id" ON "public"."games" FOR UPDATE USING (("auth"."uid"() = "created_by")) WITH CHECK (("auth"."uid"() = "created_by"));

CREATE POLICY "Enable update for users based on user_id" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));

ALTER TABLE "public"."game_user" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."puzzles" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT ALL ON FUNCTION "public"."initialize_grid"() TO "anon";
GRANT ALL ON FUNCTION "public"."initialize_grid"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."initialize_grid"() TO "service_role";

GRANT ALL ON FUNCTION "public"."update_grid_element"("game_id" "uuid", "grid_index" integer, "new_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_grid_element"("game_id" "uuid", "grid_index" integer, "new_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_grid_element"("game_id" "uuid", "grid_index" integer, "new_value" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."user_has_game_access"("game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_game_access"("game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_game_access"("game_id" "uuid") TO "service_role";

GRANT ALL ON TABLE "public"."game_user" TO "anon";
GRANT ALL ON TABLE "public"."game_user" TO "authenticated";
GRANT ALL ON TABLE "public"."game_user" TO "service_role";

GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";

GRANT ALL ON TABLE "public"."puzzles" TO "anon";
GRANT ALL ON TABLE "public"."puzzles" TO "authenticated";
GRANT ALL ON TABLE "public"."puzzles" TO "service_role";

GRANT ALL ON TABLE "public"."user_related_games" TO "anon";
GRANT ALL ON TABLE "public"."user_related_games" TO "authenticated";
GRANT ALL ON TABLE "public"."user_related_games" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "service_role";

RESET ALL;
