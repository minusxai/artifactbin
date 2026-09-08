/** TEST ONLY: record the actual browser response without replaying the OTP POST.
 * This gate observed Playwright response.text stalling despite a readable body.
 * Clone before returning the unchanged Response; never consume the app's body.
 * Self-contained so Playwright can serialize it as a pre-navigation init script.
 */
export function recordOtpResponses(){
 if(!/^https?:$/.test(new URL(window.location.href).protocol))return;
 const nativeFetch=window.fetch;
 const endpoint=new URL('/api/auth/email-otp/send-verification-otp',window.location.href).href;
 const records=window.__gateOtpResponses=[];
 window.fetch=async function(input,init){
  const url=new URL(input instanceof Request?input.url:input,window.location.href).href;
  const method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  const record=url===endpoint&&method==='POST'?{complete:false}:null;
  if(record)records.push(record);
  try {
   const response=await nativeFetch.call(this,input,init);
   if(record){
    record.status=response.status;
    response.clone().text().then(body=>{record.body=body;record.complete=true;},error=>{record.error=error.name;record.complete=true;});
   }
   return response;
  } catch(error){if(record){record.error=error.name;record.complete=true;}throw error;}
 };
}
