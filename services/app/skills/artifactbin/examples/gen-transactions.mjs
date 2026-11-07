/**
 * Example: seeded sample-data generator: about 300 transactions over
 *   12 months (date, merchant, category, amount, payer) for a dataset labelled as sample.
 * Usage: cp examples/gen-transactions.mjs gen.mjs; change only names: PAYERS, and the category
 *   and merchant names in CATEGORIES; run once: node gen.mjs > rows.csv; then node
 *   scripts/new-page.mjs --data rows.csv --title NAME (and label the page as sample data).
 * Gotchas: keep the amounts, visits and seed as they are. A merchant listed alone is a monthly
 *   bill (once a month); monthly totals vary.
 */
let seed=7;const rand=()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const pick=list=>list[Math.floor(rand()*list.length)],PAYERS=['Alex','Sam'];
const CATEGORIES=[ // name, amount range, visits a month, merchants
  ['Rent',[1650,1650],1,['Landlord']],['Utilities',[70,150],1,['Power Co']],
  ['Internet',[55,55],1,['FiberNet']],
  ['Groceries',[25,140],9,['FreshMart','Green Grocer','Corner Market','Bulk Barn','City Foods']],
  ['Dining out',[15,85],7,['Noodle Bar','Taco Stand','Bistro 9','Cafe Lune','Pizza Place']],
  ['Transport',[8,60],6,['Metro Card','Fuel Stop','Rideshare','Parking Co']]];
const rows=['date,merchant,category,amount,payer'];
for(let m=0;m<12;m++){
  const month=new Date(Date.UTC(2025,10+m,1)).toISOString().slice(0,7),scale=0.85+rand()*0.3;
  for(const [name,[low,high],visits,merchants] of CATEGORIES){
    const count=merchants.length===1?1:visits+Math.floor(rand()*3)-1;
    for(let n=0;n<count;n++){
      const amount=low===high?low:(low+rand()*(high-low))*scale,day=1+Math.floor(rand()*28);
      rows.push([`${month}-${String(day).padStart(2,'0')}`,pick(merchants),name,amount.toFixed(2),
        pick(PAYERS)].join(','));
    }
  }
}
console.log(rows.join('\n'));
console.error(`wrote ${rows.length-1} transactions (12 months, ${rows[1].slice(0,7)}..`+
  `${rows.at(-1).slice(0,7)})`);
