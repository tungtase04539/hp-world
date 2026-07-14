import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
const tiles = JSON.parse(process.argv[2]);
const outdir = process.argv[3] || 'aerialshot';
mkdirSync(outdir, { recursive: true });
const br = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args:['--use-gl=angle','--use-angle=swiftshader'] });
const pg = await br.newPage({ viewport: { width: 900, height: 900 } });
await pg.goto('http://localhost:8177/', { waitUntil: 'domcontentloaded' });
for (let i=0;i<80;i++){const ok=await pg.evaluate(()=>{const b=document.getElementById('startBtn');if(b){b.click();return true}return false}).catch(()=>0);if(ok)break;await pg.waitForTimeout(1000);}
for (let i=0;i<120;i++){const ok=await pg.evaluate(()=>!!(window.__hp&&window.__hp.aerial)).catch(()=>0);if(ok)break;await pg.waitForTimeout(1000);}
await pg.evaluate(()=>window.__hp.setTime(0.38));
await pg.waitForTimeout(3500);
await pg.evaluate(()=>{ document.querySelectorAll('body *').forEach(e=>{ if(e.tagName!=='CANVAS') e.style.visibility='hidden'; }); const c=document.querySelector('canvas'); if(c){c.style.visibility='visible';} });
for (const [name,cx,cz,half] of tiles){
  await pg.evaluate(([cx,cz,half])=>window.__hp.aerial(cx,cz,half), [cx,cz,half]);
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: `${outdir}/${name}.png` });
}
await pg.evaluate(()=>window.__hp.aerialOff());
console.log('AERIAL_DONE', tiles.length);
await br.close();
