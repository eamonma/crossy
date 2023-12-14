# Crossy

Online collaborative crossword solving app

![image](https://github.com/eamonma/crossy/assets/16643012/4ce24d27-663d-49ee-9efb-6f2301e57175)

## Development setup

```sh
npm i
npx supabase start
```

Paste parts of the output into `.env.local`:

```diff
+           API URL: ___ # as NEXT_PUBLIC_SUPABASE_URL
        GraphQL URL: 
             DB URL: 
         Studio URL: 
       Inbucket URL: 
         JWT secret: 
+          anon key: ___ # as NEXT_PUBLIC_SUPABASE_ANON_KEY
+  service_role key: ___ # as SUPABASE_SERVICE_ROLE_KEY
```

Then, go to the studio URL and create a new user in the authentication tab. Use this for email password login.
```diff
            API URL: 
        GraphQL URL: 
             DB URL: 
+        Studio URL: ___
       Inbucket URL: 
         JWT secret: 
           anon key: 
   service_role key: 
```