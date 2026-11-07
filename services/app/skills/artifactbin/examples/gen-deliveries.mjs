/**
 * Example: seeded sample data for examples/csv-dashboard.html: about 1,000 deliveries over 26
 *   whole weeks and 6 whole months (2025-12-01 to 2026-05-31) in 8 cities: date, hour, city, lat,
 *   lon, category, distance_km, minutes, amount. Label it as sample data.
 * Usage: node examples/gen-deliveries.mjs > deliveries.csv; then node scripts/new-page.mjs --data
 *   deliveries.csv --title NAME (the starter's own DATA reads it as the dataset deliveries).
 * Gotchas: the same seed gives the same rows on every run. It has a shape worth charting: orders
 *   grow except in Antwerp, meals peak at lunch and dinner, and minutes rise with distance.
 */
let seed=11;const rand=()=>{seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const pick=list=>list[Math.floor(rand()*list.length)];
const CITIES=[ // name, lat, lon, orders a week at the start, growth over the 26 weeks
  ['Amsterdam',52.37,4.9,6,0.6],['Rotterdam',51.92,4.48,5,0.5],['Utrecht',52.09,5.12,4,0.7],
  ['The Hague',52.08,4.3,4,0.4],['Eindhoven',51.44,5.47,3,0.5],['Groningen',53.22,6.57,2,0.8],
  ['Antwerp',51.22,4.4,5,-0.4],['Brussels',50.85,4.35,4,0.3]];
const CATEGORIES=[ // name, hours it is ordered in, amount range, minutes to prepare
  ['Meals',[12,12,13,18,19,19,20,21],[14,48],9],['Groceries',[9,11,16,17,18,19],[22,95],4],
  ['Pharmacy',[9,10,11,14,15,16,17,20],[8,40],2],['Parcels',[9,10,11,13,14,15,16],[10,60],0]];
const rows=['date,hour,city,lat,lon,category,distance_km,minutes,amount'];
for(let week=0;week<26;week++)for(const [city,lat,lon,base,growth] of CITIES){
  const count=Math.round(base*(1+growth*week/25)+rand()*2-1);
  for(let n=0;n<count;n++){
    const [category,hours,[low,high],prep]=pick(CATEGORIES),hour=pick(hours);
    const day=new Date(Date.UTC(2025,11,1+week*7+Math.floor(rand()*7)));
    const weekend=day.getUTCDay()%6===0,km=0.4+8*rand()**1.6;
    const minutes=Math.round(11+prep+km*3.2+(hour>=17&&hour<=19?6:0)+(weekend?3:0)+rand()*14);
    rows.push([day.toISOString().slice(0,10),hour,city,(lat+(rand()-0.5)*0.05).toFixed(4),
      (lon+(rand()-0.5)*0.08).toFixed(4),category,km.toFixed(1),minutes,
      (low+rand()*(high-low)).toFixed(2)].join(','));
  }
}
console.log(rows.join('\n'));
console.error(`wrote ${rows.length-1} deliveries: 26 weeks from 2025-12-01, 8 cities`);
