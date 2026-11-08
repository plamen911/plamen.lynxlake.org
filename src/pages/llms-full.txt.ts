import { llmsFullTxt } from '../data/discovery';
import { profile } from '../data/profile';

export const GET = (): Response =>
  new Response(llmsFullTxt(profile), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
