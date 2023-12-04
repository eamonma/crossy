import React from 'react'

import Create from './create'

// const CreateGame = async () => {
//   const cookieStore = cookies();
//   const supabase = createClient(cookieStore);

//   const {
//     data: { user },
//   } = await supabase.auth.getUser();

//   const createGame = async (formData: FormData) => {
//     'use server';

//     const cookieStore = cookies();
//     const supabase = createClient(cookieStore);

//     const { error, data } = await supabase
//       .from('games')
//       .insert({
//         created_by: user?.id,
//         puzzle_id: formData.get('puzzle_id'),
//       })
//       .select();

//     console.log(data, error);

//     if (error) {
//       return redirect('/puzzles/create?message=Could not create game');
//     }

//     // setPuzzles(data);
//     return data;
//   };

//   return (
//     <form action={createGame}>
//       <input className='border' type='text' name='puzzle_id' />
//       <button>submit</button>
//     </form>
//   );
// };

const Page: React.FC = async () => {
  return (
    <div className="flex flex-col gap-4">
      {/* <pre>{JSON.stringify(data, null, 2)}</pre> */}
      <Create />

      {/* <UserInfo /> */}
      {/* <CreateGame /> */}
    </div>
  )
}

export default Page
