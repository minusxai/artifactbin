import {expect,it} from 'vitest';
import {isPlatformPage} from '@artifactbin/utils/page-paths';

it('admits only first-party UI paths, never retired frames, APIs, byte routes or arbitrary URLs',()=>{
 for(const path of ['/','/login','/account','/tokens/new','/chat','/docs-human','/privacy','/@alice','/datasets/Abc123/edit'])expect(isPlatformPage(path),path).toBe(true);
 for(const path of ['/controls/page/login','/controls/consent','/controls/region/home','/api/auth/get-session','/oauth/token','/a/Abc123/raw','/docs','/assets/ref/Abc123','https://evil.test/','//evil.test/'])expect(isPlatformPage(path),path).toBe(false);
});
