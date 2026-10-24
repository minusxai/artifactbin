/** Local paired-reader sessions use normal OTP login. Only a disposable account
 * reference is serializable; cookies stay in the capture process. */
export function baselineLocalOrigin(base) {
 const url=new URL(base);
 if(url.username||url.password||!['http:','https:'].includes(url.protocol)||(!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)&&!url.hostname.endsWith('.lvh.me')))throw Error('Baseline identity requires an isolated local origin');
 return url.origin;
}
/** @param {import('../fixtures/component-baseline/contract').BaselineAccountReference} account */
export function validateBaselineAccount(account) {
 if(!account||Object.keys(account).some(key=>key!=='email'))throw Error('Baseline account reference must not contain credentials');
 if(typeof account.email!=='string'||!/^mxmx_test_[a-zA-Z0-9_-]+@example\.com$/.test(account.email))throw Error('Baseline identity must be a disposable test account');
 return account;
}
/** @returns {Promise<import('../fixtures/component-baseline/contract').BaselineBrowserSession>} */
export async function createBaselineSession({base,account,signIn}) {
 const origin=baselineLocalOrigin(base);validateBaselineAccount(account);
 const {cookie}=await signIn(origin,{email:account.email});
 if(typeof cookie!=='string'||!cookie)throw Error('Baseline login did not establish a browser session');
 const cookies=cookie.split(';').map(part=>{const value=part.trim(),at=value.indexOf('=');if(at<=0)throw Error('Malformed baseline session cookie');return {name:value.slice(0,at),value:value.slice(at+1),url:origin};});
 return {mount:async page=>{
  await page.context().addCookies(cookies);
  const response=await page.request.get(origin+'/api/auth/get-session');
  const session=response.ok()?await response.json():null;
  if(!session?.user?.id?.startsWith('usr_')||session.user.email!==account.email)throw Error('Baseline browser session identity was not confirmed');
 }};
}

/** Real local profile fixture hook. It returns public API data, never a supplied
 * synthetic person or a credential. Call separately against each paired server. */
/** @returns {Promise<import('../fixtures/component-baseline/contract').BaselineSeededIdentity>} */
export async function seedBaselineIdentity({base,account,handle,profileImage,signIn,send=fetch}) {
 const origin=baselineLocalOrigin(base);validateBaselineAccount(account);
 if(typeof handle!=='string'||!/^mxmx_test_[a-z0-9_]+$/.test(handle))throw Error('Baseline profile requires a disposable test handle');
 const {cookie}=await signIn(origin,{email:account.email});
 if(!cookie)throw Error('Baseline login did not establish a browser session');
 const request=async(route,options={})=>{
  const response=await send(origin+route,{method:'GET',...options,headers:{origin,cookie,...options.headers}});
  if(!response.ok)throw Error(`Baseline profile operation failed (${response.status})`);
  return response.json();
 };
 await request('/api/my/profile',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({username:handle})});
 if(profileImage)await request('/api/my/profile/image',{method:'PUT',headers:{'content-type':profileImage.contentType},body:profileImage.bytes});
 const session=await request('/api/auth/get-session');
 if(!session?.user?.id?.startsWith('usr_')||session.user.email!==account.email)throw Error('Baseline profile account identity was not confirmed');
 const profile=await request('/api/my/profile');
 if(profile.username!==handle||typeof profile.name!=='string'||(profile.image!==null&&typeof profile.image!=='string'))throw Error('Baseline profile readback was not confirmed');
 if(profileImage&&!profile.image)throw Error('Baseline profile image was not retained');
 return {id:session.user.id,name:profile.name,handle:profile.username,image:profile.image};
}
