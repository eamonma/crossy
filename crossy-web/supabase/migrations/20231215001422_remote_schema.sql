drop policy "Enable all actions for users based on user_id" on "public"."puzzles";

drop policy "Enable update for users based on id" on "public"."games";

create policy "Enable all actions for user if they created"
on "public"."puzzles"
as permissive
for all
to authenticated
using ((auth.uid() = created_by))
with check ((auth.uid() = created_by));


create policy "Enable update for users based on id"
on "public"."games"
as permissive
for update
to authenticated
using ((auth.uid() = created_by))
with check ((auth.uid() = created_by));



