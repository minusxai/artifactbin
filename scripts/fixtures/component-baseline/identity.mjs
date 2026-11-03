/** Paired real-account scenarios. IDs and image URLs below are substituted only
 * after normal local OTP/profile/dataset API operations on each actual server.
 * The unchanged fixture definition remains the paired input identity. */
export const identityProfileImage={contentType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASklEQVRYhe2WQQ0AQAzCZqpeEIH/98nYZWkyAYRA2dB8dbOuAAVFh2qGsGVZxw+CMTpUM4QtyzqE8EGLDtUMYcsihyIY63RweFwfuYvWTPPtUKAAAAAASUVORK5CYII=','base64')};
const declaration='<Helmet><Import name="identity" src="ref:{{identityDataset}}" /><Query name="identityRows">{`select who from identity.rows`}</Query></Helmet>';
// The page supplies the card (af-user never looks an account up): the seeded account's id, handle and avatar address.
const setup='document.querySelector("#identity-person").person={id:"{{identityId}}",name:"mxmx_test_identity",handle:"mxmx_test_identity",image:"{{identityImage}}"};';
export const identityBrowserParityFixtures=[
 {id:'user-known-handle',family:'User',modules:['user'],oldJsx:declaration+'<User id="identity-person" userId="{{identityId}}" avatar={false} fallback="Unassigned" />',newHtml:'<af-user id="identity-person" avatar="false" fallback="Unassigned"></af-user>',setup,states:[{id:'loaded',actions:[],expected:{textIncludes:['@mxmx_test_identity']}}]},
 {id:'user-known-image',family:'User',modules:['user'],oldJsx:declaration+'<User id="identity-person" userId="{{identityId}}" fallback="Unassigned" />',newHtml:'<af-user id="identity-person" fallback="Unassigned"></af-user>',setup,states:[{id:'loaded',actions:[],expected:{textIncludes:['@mxmx_test_identity']}}]},
 {id:'avatar-real-image',family:'Avatar',modules:['avatar'],oldJsx:'<Avatar id="identity-avatar"><AvatarImage src="{{identityImage}}" alt="Identity portrait" /><AvatarFallback>IP</AvatarFallback></Avatar>',newHtml:'<af-avatar id="identity-avatar"><af-avatar-image src="{{identityImage}}" alt="Identity portrait"></af-avatar-image><af-avatar-fallback>IP</af-avatar-fallback></af-avatar>',states:[{id:'loaded',actions:[],expected:{roles:[{role:'img',name:'Identity portrait'}]}}]},
];
export const identityBaselineReadiness={
 'user-known-handle':()=>document.querySelector('#identity-person')?.textContent.includes('@mxmx_test_identity'),
 'user-known-image':()=>{const image=document.querySelector('#identity-person img');return image?.complete&&image.naturalWidth>0;},
 'avatar-real-image':()=>{const image=document.querySelector('#identity-avatar img');return image?.complete&&image.naturalWidth>0;},
};
