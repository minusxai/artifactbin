import {libraryImports} from '@/lib/libraries';
import {publicRevalidatedResponse} from '@/lib/http';
/** The import map a new page gets (`@afbin/<library|component>` -> platform path), for the skill's local preview. Public. */
export const GET=(request:Request)=>publicRevalidatedResponse(request,JSON.stringify({imports:libraryImports(undefined)}),'application/json; charset=utf-8');
export const HEAD=GET;
