/** Paired real-account scenarios. IDs and image URLs below are substituted only
 * after normal local OTP/profile/dataset API operations on each actual server.
 * The unchanged fixture definition remains the paired input identity. */
export const identityProfileImage={contentType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==','base64')};
const declaration='<Helmet><Import name="identity" src="ref:{{identityDataset}}" /><Query name="identityRows">{`select who from identity.rows`}</Query></Helmet>';
const link='<link rel="af-dataset" data-af-name="identity" href="ref:{{identityDataset}}" data-af-mode="live">';
const setup='import {client,gql} from "@afbin/apollo";const result=await client.query({query:gql`query($ids:[ID!]!){identity{people(ids:$ids){id name handle image}}}`,variables:{ids:["{{identityId}}"]}});if(result.errors?.length)throw Error("Actual identity lookup failed");const person=result.data.identity.people.find(person=>person.id==="{{identityId}}");if(!person)throw Error("Actual identity was not returned");document.querySelector("#identity-person").person=person;';
export const identityBrowserParityFixtures=[
 {id:'user-known-handle',family:'User',modules:['user'],oldJsx:declaration+'<User id="identity-person" userId="{{identityId}}" avatar={false} fallback="Unassigned" />',newHtml:link+'<af-user id="identity-person" avatar="false" fallback="Unassigned"></af-user>',setup,states:[{id:'loaded',actions:[],expected:{textIncludes:['@mxmx_test_identity'],roles:[{role:'link',name:'@mxmx_test_identity'}]}}]},
 {id:'user-known-image',family:'User',modules:['user'],oldJsx:declaration+'<User id="identity-person" userId="{{identityId}}" fallback="Unassigned" />',newHtml:link+'<af-user id="identity-person" fallback="Unassigned"></af-user>',setup,states:[{id:'loaded',actions:[],expected:{textIncludes:['@mxmx_test_identity'],roles:[{role:'link',name:'@mxmx_test_identity'}]}}]},
 {id:'avatar-real-image',family:'Avatar',modules:['avatar'],oldJsx:'<Avatar id="identity-avatar"><AvatarImage src="{{identityImage}}" alt="Identity portrait" /><AvatarFallback>IP</AvatarFallback></Avatar>',newHtml:'<af-avatar id="identity-avatar"><af-avatar-image src="{{identityImage}}" alt="Identity portrait"></af-avatar-image><af-avatar-fallback>IP</af-avatar-fallback></af-avatar>',states:[{id:'loaded',actions:[],expected:{roles:[{role:'img',name:'Identity portrait'}]}}]},
];
export const identityBaselineReadiness={
 'user-known-handle':()=>document.querySelector('#identity-person')?.textContent.includes('@mxmx_test_identity'),
 'user-known-image':()=>{const image=document.querySelector('#identity-person img');return image?.complete&&image.naturalWidth>0;},
 'avatar-real-image':()=>{const image=document.querySelector('#identity-avatar img');return image?.complete&&image.naturalWidth>0;},
};
