import {identity} from '@/lib/auth';
import {redirect} from 'next/navigation';
import Workbench from './workbench';
export const dynamic='force-dynamic';
export default async function Page(){const u=await identity();if(!u)redirect('/');return <Workbench user={u.email}/>;}
