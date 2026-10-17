// MC DIGITAL — escritório da equipe de IA na tela Início (canvas, sem dependências).
// Os agentes andam sozinhos: trabalham, tomam café, vão ao banheiro, jogam sinuca e vão à reunião.
// Quem tem trabalho de verdade no app (posts, aprovações, cobranças, follow-ups) fica "em missão" e pausa menos.
import { h, toast } from '/shared.js';

export const SETORES = ["dir","plan","cont","des","atd","ven","fin"];
const ROOMS = {
  dir: {nome:"Diretoria",   pessoa:"Maria Carolina", cargo:"Prioridades e decisões", shirt:"#2B2B2B", skin:"#C68B63", hair:"#1F1610", style:"long", home:[3,3]},
  plan:{nome:"Planejamento",pessoa:"Bia",  cargo:"Pautas e calendário",             shirt:"#B8962E", skin:"#E2B08C", hair:"#5A3A22", style:"long",  home:[11,11]},
  cont:{nome:"Conteúdo",    pessoa:"Léo",  cargo:"Roteiros, legendas e carrosséis", shirt:"#7A1426", skin:"#8D5A3B", hair:"#141010", style:"short", home:[16,11]},
  des: {nome:"Design",      pessoa:"Nina", cargo:"Artes e briefs visuais",          shirt:"#3E7A80", skin:"#F0C7A4", hair:"#B8792F", style:"bun",   home:[21,11]},
  atd: {nome:"Atendimento", pessoa:"Duda", cargo:"Aprovações e relacionamento",     shirt:"#2E7D50", skin:"#A86E4A", hair:"#2A1A12", style:"long",  home:[11,15]},
  ven: {nome:"Vendas",      pessoa:"Caio", cargo:"Prospecção e propostas",          shirt:"#C2801A", skin:"#D9A07A", hair:"#3B2416", style:"short", home:[16,15]},
  fin: {nome:"Financeiro",  pessoa:"Purga", cargo:"Mensalidades e caixa",           shirt:"#3E5C76", skin:"#E8BC98", hair:"#6B4A2E", style:"bun",   home:[21,15]},
  reu: {nome:"Sala de reunião", cargo:"Planejar a semana com toda a equipe", meeting:true}
};
const R = ROOMS;
const WORK_LINES = {
  dir:["Revendo as prioridades","Aprovando o planejamento","Olhando os números"],
  plan:["Montando o calendário","Pauta de novembro…","Equilibrando os formatos"],
  cont:["Escrevendo o gancho","Roteiro quase pronto","Legenda revisada"],
  des:["Ajustando o carrossel","Exportando as artes","Cores da cliente ok"],
  atd:["Mandando para aprovação","Respondendo a cliente","Ajuste anotado"],
  ven:["Prospectando perfis","Montando a proposta","DM enviada"],
  fin:["Conferindo mensalidades","Planilha em dia","Caixa do mês ok"]
};
const LINES = {
  coffee:["Um café e já volto","Café é vida","Recarregando…"],
  wc:["Já volto!"], sofa:["Pausa de 5 minutos","Pensando em ideias…"],
  pool:["Bora uma partida?","Na caçapa do canto!","Essa foi sorte"],
  arcade:["Recorde novo!","Só mais uma fase"], puff:["Que puff confortável"],
  meeting:["Anotado!","Boa ideia","Fechado"], chat:["Viu o Reels de ontem?","Bora alinhar isso?","Ficou top!"],
  wander:["Como estamos, equipe?","Bom trabalho!"]
};
const ACT_LABEL = {work:"Trabalhando", walk:"Andando", coffee1:"Pegando café", coffee2:"Na copa", wc:"No banheiro", wash:"No banheiro", sofa:"No sofá", pool:"Jogando sinuca", arcade:"No fliperama", puff:"Descansando", meeting:"Em reunião", chat:"Conversando", wander:"Passando pelas mesas", home:"Fora do expediente"};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
const has = () => true;               // todos os móveis do escritório já estão no lugar
let LOAD = {};                        // trabalho aberto por setor, vindo do app
let MISSIONS = [];                    // missões da semana (para o quadro de metas)
const abertas = (id) => ({ length: LOAD[id] || 0 });
let sel = null;
let pickHandler = () => {};
const onTap = (id) => { sel = id; pickHandler(id); updateZoomUI(); };
const UI = { wrap: null, zin: null, zout: null, zfollow: null };
/* =================== Mundo em pixel art =================== */
const COLS = 26, ROWS = 18, HW = 14, HH = 7, ZU = 16;
const OX = ROWS*HW + 14, OY = 56;
const LW = (COLS+ROWS)*HW + 28, LH = OY + (COLS+ROWS)*HH + 18;
const P = (x,y,z=0) => [(x-y)*HW + OX, (x+y)*HH - z*ZU + OY];
const PAL = {
  wall:"#EFEBE2", cap:"#34332F", glass:"#BFD6DC", desk:"#F4F1EA", deskTop:"#FBFAF6", wood:"#A47B52", woodD:"#6E4C30",
  dark:"#2F2E2B", gold:"#D6BC6A", wine:"#5C1220", plant:"#5E8C4E", plant2:"#7FAE6A", pot:"#E9E4D8", felt:"#2F6B4F",
  sofa:"#3E4A57", screenOff:"#4A4944", white:"#F7F6F2", sky:"#A9C4CC", city:"#7F9AA3", tile:"#D8E4E7"
};
function hex(h){ h = h.replace("#",""); return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
const shadeCache = {};
function shade(h,k){ const key = h+k; if (shadeCache[key]) return shadeCache[key]; const f = 1-k; return shadeCache[key] = "#"+hex(h).map(v => Math.max(0,Math.min(255,Math.round(v*f))).toString(16).padStart(2,"0")).join(""); }
function poly(c, pts, color, alpha){
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i=1;i<pts.length;i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath(); c.globalAlpha = alpha ?? 1; c.fillStyle = color; c.fill();
  if (alpha == null){ c.strokeStyle = color; c.lineWidth = .45; c.lineJoin = "round"; c.stroke(); }
  c.globalAlpha = 1;
}
function line(c, a, b, color, alpha){ c.globalAlpha = alpha ?? 1; c.strokeStyle = color; c.lineWidth = .7; c.lineCap = "round"; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); c.globalAlpha = 1; }
function drawBox(c, b){
  const {x,y,z,w,d,h} = b;
  const t = [P(x,y,z+h),P(x+w,y,z+h),P(x+w,y+d,z+h),P(x,y+d,z+h)];
  const f = [P(x,y+d,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x,y+d,z+h)];
  const s = [P(x+w,y,z),P(x+w,y+d,z),P(x+w,y+d,z+h),P(x+w,y,z+h)];
  if (b.ef !== false) poly(c, f, b.fc || shade(b.col,.14), b.alpha);
  if (b.es !== false) poly(c, s, b.sc || shade(b.col,.28), b.alpha);
  poly(c, t, b.top || b.col, b.alpha);
  if (b.line !== false){
    const lc = b.lc || shade(b.col,.5), la = b.alpha != null ? .8 : .55;
    if (b.ef !== false) line(c, t[3], t[2], lc, la);
    if (b.es !== false) line(c, t[2], t[1], lc, la);
    if (b.ef !== false && b.es !== false) line(c, t[2], f[1], lc, la);
  }
}
/* Corta cada caixa em fatias por célula para a ordem de desenho funcionar com os agentes andando entre os móveis */
let FURN = [];
function addBox(b){
  const x1 = b.x+b.w, y1 = b.y+b.d;
  for (let cx = Math.floor(b.x); cx < x1; cx++) for (let cy = Math.floor(b.y); cy < y1; cy++){
    const sx = Math.max(b.x,cx), ex = Math.min(x1,cx+1), sy = Math.max(b.y,cy), ey = Math.min(y1,cy+1);
    if (ex-sx < 1e-6 || ey-sy < 1e-6) continue;
    const sub = {...b, x:sx, y:sy, w:ex-sx, d:ey-sy, ef: ey >= y1-1e-6, es: ex >= x1-1e-6};
    FURN.push({key:(sx+ex)/2 + (sy+ey)/2 + (b.k||0), draw:c => drawBox(c, sub)});
  }
}
const addItem = (key, draw) => FURN.push({key, draw});

/* Paredes: bloqueiam a passagem entre células, menos nas portas */
const blocked = new Set(), edges = new Set();
const ck = (x,y) => x+","+y;
const block = (x,y,w=1,d=1) => { for (let i=0;i<w;i++) for (let j=0;j<d;j++) blocked.add(ck(x+i,y+j)); };
const WALLS = [
  {ax:"x", at:7,  a:0,  b:6,  door:[],   glass:true},
  {ax:"y", at:6,  a:0,  b:7,  door:[5],  glass:true},
  {ax:"x", at:13, a:0,  b:6,  door:[],   glass:true},
  {ax:"y", at:6,  a:7,  b:13, door:[10], glass:true},
  {ax:"x", at:21, a:0,  b:6,  door:[]},
  {ax:"y", at:6,  a:21, b:26, door:[22]},
  {ax:"x", at:23, a:0,  b:2,  door:[], h:1.25, stall:true},
  {ax:"x", at:24, a:0,  b:2,  door:[], h:1.25, stall:true},
  {ax:"x", at:25, a:0,  b:2,  door:[], h:1.25, stall:true}
];
function canStep(x,y,nx,ny){
  if (nx<0 || ny<0 || nx>=COLS || ny>=ROWS || blocked.has(ck(nx,ny))) return false;
  if (nx !== x) return !edges.has("x"+Math.max(x,nx)+","+y);
  return !edges.has("y"+x+","+Math.max(y,ny));
}
function bfs(from, to){
  const [sx,sy] = from, [tx,ty] = to;
  if (sx===tx && sy===ty) return [];
  const prev = new Map([[ck(sx,sy), null]]); const q = [[sx,sy]];
  while (q.length){
    const [x,y] = q.shift();
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = x+dx, ny = y+dy, k = ck(nx,ny);
      if (prev.has(k) || !canStep(x,y,nx,ny)) continue;
      prev.set(k, [x,y]);
      if (nx===tx && ny===ty){ const path = []; let cur = [nx,ny]; while (cur && !(cur[0]===sx && cur[1]===sy)){ path.unshift(cur); cur = prev.get(ck(cur[0],cur[1])); } return path; }
      q.push([nx,ny]);
    }
  }
  return null;
}

/* Pontos de interesse: onde cada atividade acontece e para onde a pessoa olha */
const POI = {
  coffee:[{c:[15,1],f:[0,-1]}],
  bistro:[{c:[14,3],f:[1,0]},{c:[16,3],f:[-1,0]},{c:[18,3],f:[1,0]},{c:[20,3],f:[-1,0]}],
  stalls:[{c:[23,1],f:[0,-1]},{c:[24,1],f:[0,-1]},{c:[25,1],f:[0,-1]}],
  sink:[{c:[22,3],f:[-1,0]},{c:[22,4],f:[-1,0]}],
  sofa:[{c:[0,14],f:[1,0]},{c:[0,15],f:[1,0]},{c:[0,16],f:[1,0]}],
  puff:[{c:[5,16],f:[-1,-1]},{c:[6,16],f:[-1,-1]}],
  pool:[{c:[2,12],f:[1,0]},{c:[5,12],f:[-1,0]},{c:[3,10],f:[0,1]},{c:[4,14],f:[0,-1]}],
  arcade:[{c:[8,10],f:[0,-1]}],
  meet:[{c:[8,1],f:[0,1]},{c:[9,1],f:[0,1]},{c:[10,1],f:[0,1]},{c:[11,1],f:[0,1]},{c:[8,4],f:[0,-1]},{c:[9,4],f:[0,-1]},{c:[10,4],f:[0,-1]},{c:[11,4],f:[0,-1]}],
  chat:[{c:[23,9],f:[1,0]},{c:[24,10],f:[-1,-1]}],
  wander:[{c:[14,12],f:[0,1]},{c:[19,13],f:[0,1]},{c:[13,7],f:[0,1]},{c:[18,7],f:[0,1]}]
};

const balls = [];
function resetBalls(){
  balls.length = 0;
  const cols = ["#F7F6F2","#D6BC6A","#B23A3A","#2F5D86","#2B2B2B","#C2801A"];
  cols.forEach((col,i) => balls.push({u:.5+(i%3)*.5, v:.9+Math.floor(i/3)*.6, vu:0, vv:0, col}));
}
resetBalls();

function buildWorld(){
  blocked.clear(); edges.clear(); FURN = [];
  for (const w of WALLS){
    for (let i=w.a;i<w.b;i++){
      if (w.door.includes(i)) continue;
      if (w.ax === "x") edges.add("x"+w.at+","+i); else edges.add("y"+i+","+w.at);
      const h = w.h || (w.glass ? 2.1 : 1.35);
      const g = w.glass ? {col:PAL.glass, alpha:.38, lc:PAL.cap, top:PAL.cap} : {col: w.stall ? "#E7EEF0" : PAL.wall, top:PAL.cap};
      if (w.ax === "x") addBox({x:w.at-.06, y:i, z:0, w:.12, d:1, h, ...g});
      else addBox({x:i, y:w.at-.06, z:0, w:1, d:.12, h, ...g});
    }
  }
  /* Diretoria */
  block(2,2,3,1);
  addBox({x:2.05,y:2.1,z:0,w:2.9,d:.8,h:.78,col:PAL.wood,top:"#B88D60"});
  addBox({x:3.05,y:2.2,z:.78,w:1,d:.08,h:.6,col:PAL.dark,k:.3});
  addItem(6.2, c => screen(c, 3.1, 2.28, .78, .9, "dir"));
  addBox({x:2.3,y:2.3,z:.78,w:.4,d:.3,h:.06,col:PAL.white,k:.3});
  chair(3,3);
  block(0,3,1,2); addBox({x:0,y:3.05,z:0,w:.45,d:1.9,h:1.8,col:PAL.woodD});
  for (let j=0;j<4;j++) addBox({x:.02,y:3.15+j*.45,z:.35+(j%2)*.7,w:.4,d:.32,h:.3,col:["#7A1426","#D6BC6A","#3E5C76","#F7F6F2"][j],line:false});
  plant(6,0,true);
  block(5,4); addBox({x:5.15,y:4.15,z:0,w:.7,d:.7,h:.42,col:PAL.sofa}); addBox({x:5.15,y:4.15,z:.42,w:.15,d:.7,h:.4,col:PAL.sofa});
  /* Sala de reunião */
  block(8,2,4,2);
  addBox({x:8.1,y:2.15,z:0,w:3.8,d:1.7,h:.72,col:PAL.wood,top:"#B88D60"});
  addBox({x:9.6,y:2.7,z:.72,w:.6,d:.45,h:.05,col:PAL.dark,k:.3});
  for (const p of POI.meet){ const [x,y] = p.c; meetChair(x,y,p.f[1]); }
  /* Copa */
  block(14,0,5,1);
  addBox({x:14,y:0,z:0,w:5,d:.85,h:.9,col:PAL.white,top:"#3A3934"});
  addItem(15.5+.5, c => coffeeMachine(c));
  addBox({x:17.2,y:.15,z:.9,w:.6,d:.45,h:.12,col:"#B9C3C6",k:.3});
  block(19,0); addBox({x:19.08,y:.05,z:0,w:.85,d:.8,h:1.95,col:"#E2E3DF",top:"#CFD1CC"});
  plant(20,0,false);
  for (const tx of [15,19]){ block(tx,3); addBox({x:tx+.2,y:3.2,z:0,w:.6,d:.6,h:.72,col:PAL.dark,top:PAL.white}); }
  for (const p of POI.bistro){ const [x,y] = p.c; addBox({x:x+.3,y:y+.3,z:0,w:.4,d:.4,h:.42,col:PAL.dark,top:PAL.gold,k:-.2}); }
  /* Banheiro */
  for (const p of POI.stalls){ const [x] = p.c; block(x,0); addBox({x:x+.25,y:.1,z:0,w:.5,d:.55,h:.45,col:PAL.white,top:"#E9ECEC"}); addBox({x:x+.25,y:.05,z:.45,w:.5,d:.15,h:.35,col:PAL.white}); addItem(x+1.95, c => stallDoor(c,x)); }
  block(21,3,1,2); addBox({x:21.05,y:3.05,z:0,w:.7,d:1.9,h:.85,col:PAL.white,top:"#E3E6E6"});
  for (const sy of [3.5,4.5]) addBox({x:21.2,y:sy-.2,z:.85,w:.35,d:.4,h:.04,col:"#B9C3C6",line:false});
  /* Área de trabalho */
  for (const id of SETORES){ if (id === "dir") continue; const [sx,sy] = R[id].home; desk(sx,sy,id); }
  block(25,9); addBox({x:25.2,y:9.2,z:0,w:.6,d:.6,h:.8,col:PAL.white}); addBox({x:25.3,y:9.3,z:.8,w:.4,d:.4,h:.4,col:"#9CC7E0",alpha:.85});
  plant(10,8,true); plant(25,17,true); plant(14,17,false);
  if (has("metas")){ block(18,8,2,1); addBox({x:18.1,y:8.35,z:0,w:1.8,d:.12,h:1.65,col:PAL.white,top:PAL.cap}); addItem(27.5, c => metasBoard(c)); }
  /* Área de descanso */
  for (const [px,py] of [[9,8],[9,9],[9,16],[9,17]]){ block(px,py); addBox({x:px+.1,y:py+.1,z:0,w:.8,d:.8,h:.5,col:"#CFC6B4",top:"#5E8C4E"}); }
  block(3,11,2,3);
  addBox({x:3.05,y:11.05,z:0,w:1.9,d:2.9,h:.62,col:PAL.woodD,top:"#55381F"});
  addItem(17.96, c => poolTop(c));
  block(2,15); addBox({x:2.15,y:15.15,z:0,w:.7,d:.7,h:.32,col:PAL.wood,top:"#B88D60"});
  for (const p of POI.sofa){ const [x,y] = p.c; addBox({x:.1,y:y+.05,z:0,w:.85,d:.9,h:.32,col:PAL.sofa,k:-.15}); addBox({x:.02,y:y+.05,z:.32,w:.22,d:.9,h:.45,col:shade(PAL.sofa,-.08),k:-.3}); }
  addBox({x:.1,y:13.9,z:0,w:.85,d:.15,h:.55,col:PAL.sofa}); addBox({x:.1,y:16.95,z:0,w:.85,d:.15,h:.55,col:PAL.sofa});
  plant(0,8,true); plant(0,17,false);
  if (has("pufes")) for (const p of POI.puff){ const [x,y] = p.c; addBox({x:x+.2,y:y+.2,z:0,w:.6,d:.6,h:.35,col: x===5 ? PAL.gold : "#7A1426", k:-.15}); }
  if (has("fliper")){ block(8,9); addBox({x:8.12,y:9.1,z:0,w:.76,d:.75,h:1.7,col:PAL.wine,top:"#2B2B2B"}); addItem(8.5+9.95, c => arcadeScreen(c)); }
  if (has("plantas")){ plant(12,0,false); plant(7,17,false); plant(20,17,false); plant(13,5,true); plant(1,8,false); plant(25,6,false); }
}
function plant(x,y,big){
  block(x,y);
  addBox({x:x+.3,y:y+.3,z:0,w:.4,d:.4,h:.42,col:PAL.pot});
  addItem(x+y+1.05, c => {
    const [cx,cy] = P(x+.5,y+.5, big ? 1.05 : .8), r = big ? 8 : 6;
    c.fillStyle = PAL.plant; c.beginPath(); c.arc(cx,cy,r,0,7); c.fill();
    c.fillStyle = PAL.plant2; c.beginPath(); c.arc(cx-2,cy-3,r*.55,0,7); c.fill();
    if (big){ c.fillStyle = PAL.plant; c.beginPath(); c.arc(cx+1,cy-r+1,r*.5,0,7); c.fill(); }
  });
}
function chair(x,y){
  addBox({x:x+.22,y:y+.25,z:0,w:.56,d:.56,h:.34,col:PAL.dark,k:-.2});
  addBox({x:x+.22,y:y+.78,z:.34,w:.56,d:.1,h:.36,col:PAL.dark});
}
function meetChair(x,y,fy){
  addBox({x:x+.22,y:y+.22,z:0,w:.56,d:.56,h:.34,col:PAL.dark,k:-.2});
  if (fy > 0) addBox({x:x+.22,y:y+.12,z:.34,w:.56,d:.1,h:.5,col:PAL.dark,k:-.3});
  else addBox({x:x+.22,y:y+.78,z:.34,w:.56,d:.1,h:.5,col:PAL.dark});
}
function desk(sx,sy,id){
  block(sx,sy-1,2,1);
  addBox({x:sx+.05,y:sy-.88,z:0,w:1.9,d:.78,h:.72,col:PAL.desk,top:PAL.deskTop});
  addBox({x:sx+.22,y:sy-.8,z:.72,w:.95,d:.08,h:.55,col:PAL.dark,k:.3});
  addItem(sx+sy+.45, c => screen(c, sx+.27, sy-.72, .72, .85, id));
  addBox({x:sx+.35,y:sy-.5,z:.72,w:.6,d:.18,h:.03,col:"#B9B6AE",line:false,k:.3});
  addBox({x:sx+1.45,y:sy-.75,z:.72,w:.25,d:.25,h:.22,col:PAL.pot,k:.3});
  addItem(sx+sy+1.3, c => { const [cx,cy] = P(sx+1.57,sy-.62,1.08); c.fillStyle = PAL.plant2; c.beginPath(); c.arc(cx,cy,3.5,0,7); c.fill(); });
  chair(sx,sy);
}
function screen(c, x, y, z, w, id){
  const a = agents.find(g => g.id === id);
  const on = a && a.act === "work";
  const pts = [P(x,y+.0801,z+.07),P(x+w,y+.0801,z+.07),P(x+w,y+.0801,z+.5),P(x,y+.0801,z+.5)];
  poly(c, pts, on ? (id === "des" ? "#E9D8A6" : "#CFE3EA") : PAL.screenOff);
  if (on){
    const t = performance.now()/600;
    for (let i=0;i<3;i++){ const l = .15 + ((Math.sin(t+i*1.7)+1)/2)*.45*w; line(c, P(x+.08, y+.081, z+.4-i*.1), P(x+.08+l, y+.081, z+.4-i*.1), id === "des" ? "#7A1426" : "#2F5D86", .8); }
  }
}
function coffeeMachine(c){
  const gold = has("cafe");
  drawBox(c, {x:15.2,y:.12,z:.9,w:.6,d:.5,h:.6,col: gold ? PAL.gold : PAL.dark, top: gold ? "#E8D492" : "#3A3934"});
  if (agents.some(a => a.act === "coffee1")){
    const t = performance.now()/250, [bx,by] = P(15.5,.62,1.5);
    c.fillStyle = "rgba(255,255,255,.75)";
    for (let i=0;i<3;i++){ const k = (t+i)%3; c.globalAlpha = .8 - k*.25; c.beginPath(); c.arc(bx+Math.sin(t+i)*1.6, by-k*3, 1.1+k*.35, 0, 7); c.fill(); } c.globalAlpha = 1;
  }
}
function stallDoor(c, x){
  const busy = agents.some(a => a.act === "wc" && a.cell[0] === x);
  if (busy) drawBox(c, {x:x+.05, y:1.92, z:.1, w:.9, d:.08, h:1.15, col:"#C7A472", top:PAL.cap});
}
function metasBoard(c){
  const pts = [P(18.2,8.47,.55),P(19.8,8.47,.55),P(19.8,8.47,1.55),P(18.2,8.47,1.55)];
  poly(c, pts, "#FFFFFF");
  const done = MISSIONS.filter(m => m.total && m.n >= m.total).length, tot = Math.max(1, MISSIONS.length);
  line(c, P(18.35,8.48,1.35), P(19.65,8.48,1.35), "#2B2B2B", .5);
  const [a1,a2] = [P(18.35,8.48,1.05), P(18.35+1.3*done/tot,8.48,1.05)];
  c.lineWidth = 3; c.lineCap = "round"; c.strokeStyle = PAL.gold; c.beginPath(); c.moveTo(a1[0],a1[1]); c.lineTo(a2[0],a2[1]); c.stroke(); c.lineWidth = 1;
}
function arcadeScreen(c){
  const t = performance.now()/300;
  const pts = [P(8.25,9.851,1.0),P(8.75,9.851,1.0),P(8.75,9.851,1.45),P(8.25,9.851,1.45)];
  poly(c, pts, agents.some(a => a.act === "arcade") ? ["#5B8FD0","#D6BC6A","#3FA36B"][Math.floor(t)%3] : "#20262E");
}
function poolTop(c){
  const felt = [P(3.2,11.2,.63),P(4.8,11.2,.63),P(4.8,13.8,.63),P(3.2,13.8,.63)];
  poly(c, felt, PAL.felt);
  for (const [u,v] of [[3.2,11.2],[4.8,11.2],[3.2,12.5],[4.8,12.5],[3.2,13.8],[4.8,13.8]]){ const [px,py] = P(u,v,.63); c.fillStyle = "#111"; c.beginPath(); c.ellipse(px, py, 1.6, 1, 0, 0, 7); c.fill(); }
  for (const b of balls){ const [px,py] = P(3.2+b.u, 11.2+b.v, .64); c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(px+.4, py+.6, 1.2, .6, 0, 0, 7); c.fill(); c.fillStyle = b.col; c.beginPath(); c.arc(px, py-.3, 1.15, 0, 7); c.fill(); c.fillStyle = "rgba(255,255,255,.6)"; c.beginPath(); c.arc(px-.4, py-.7, .35, 0, 7); c.fill(); }
}
function updateBalls(dt){
  for (const b of balls){
    b.u += b.vu*dt; b.v += b.vv*dt; b.vu *= Math.pow(.35,dt); b.vv *= Math.pow(.35,dt);
    if (b.u < .08 || b.u > 1.52){ b.vu *= -1; b.u = Math.min(1.52, Math.max(.08, b.u)); }
    if (b.v < .08 || b.v > 2.52){ b.vv *= -1; b.v = Math.min(2.52, Math.max(.08, b.v)); }
  }
}

/* Camada fixa: piso, tapetes e paredes do fundo */
const stat = document.createElement("canvas"); stat.width = LW; stat.height = LH; let SC = 1;
function zone(x,y){
  if (y<6){ if (x<7) return "dir"; if (x<13) return "reu"; if (x<21) return "copa"; return "wc"; }
  if (y<8) return "corr";
  if (x<=9) return "lounge";
  return "work";
}
const FLOOR = { dir:["#C9A97A","#C1A070"], reu:["#DAD5C8","#D3CEC0"], copa:["#F3F0E9","#DED9CD"], wc:["#DCE7EA","#CCDBDF"], corr:["#E6DFD1","#E1DACB"], lounge:["#D8C4A1","#CFBA95"], work:["#EAE3D2","#E4DCC8"] };
function buildStatic(){
  const c = stat.getContext("2d"); c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,stat.width,stat.height); c.setTransform(SC,0,0,SC,0,0); c.imageSmoothingEnabled = true;
  drawBox(c, {x:0,y:0,z:-.45,w:COLS,d:ROWS,h:.45,col:"#BDB6A6",line:false});
  for (let x=0;x<COLS;x++) for (let y=0;y<ROWS;y++){
    const z = zone(x,y), pal = FLOOR[z];
    const alt = (z === "dir" || z === "lounge") ? (x%2) : ((x+y)%2);
    poly(c, [P(x,y),P(x+1,y),P(x+1,y+1),P(x,y+1)], pal[alt]);
  }
  const rug = (x0,y0,x1,y1,col,border) => { poly(c, [P(x0,y0),P(x1,y0),P(x1,y1),P(x0,y1)], border); poly(c, [P(x0+.15,y0+.15),P(x1-.15,y0+.15),P(x1-.15,y1-.15),P(x0+.15,y1-.15)], col); };
  rug(1.5,9.6,6.5,14.6,PAL.wine,PAL.gold);
  rug(1,1.2,6,5,"#3A3934","#55534C");
  rug(1.2,13.6,3.6,17,"#5E6B57","#4A5545");
  for (const [dx,dy] of [[5,6],[10,6],[22,6]]) poly(c, [P(dx,dy-.25),P(dx+1,dy-.25),P(dx+1,dy+.25),P(dx,dy+.25)], "#B9B2A2");
  drawBox(c, {x:-.2,y:-.2,z:0,w:COLS+.2,d:.2,h:2.6,col:PAL.wall,top:PAL.cap});
  drawBox(c, {x:-.2,y:0,z:0,w:.2,d:ROWS,h:2.6,col:PAL.wall,top:PAL.cap,ef:false});
  poly(c, [P(21,0,0),P(26,0,0),P(26,0,1.3),P(21,0,1.3)], PAL.tile);
  const winY = (x1,x2,z1,z2) => { poly(c,[P(x1,0,z1),P(x2,0,z1),P(x2,0,z2),P(x1,0,z2)],PAL.sky); let s = 7*x1; for (let x=x1+.1;x<x2-.15;x+=.32){ s = (s*9301+49297)%233280; const h = .25+(s/233280)*.6; poly(c,[P(x,0,z1),P(x+.26,0,z1),P(x+.26,0,z1+h),P(x,0,z1+h)],PAL.city); } for (let x=x1;x<=x2+1e-6;x+=1) line(c,P(x,0,z1),P(x,0,z2),PAL.cap,.9); line(c,P(x1,0,z2),P(x2,0,z2),PAL.cap,.9); line(c,P(x1,0,z1),P(x2,0,z1),PAL.cap,.9); };
  const winX = (y1,y2,z1,z2) => { poly(c,[P(0,y1,z1),P(0,y2,z1),P(0,y2,z2),P(0,y1,z2)],PAL.sky); let s = 3*y1; for (let y=y1+.1;y<y2-.15;y+=.32){ s = (s*9301+49297)%233280; const h = .25+(s/233280)*.6; poly(c,[P(0,y,z1),P(0,y+.26,z1),P(0,y+.26,z1+h),P(0,y,z1+h)],PAL.city); } for (let y=y1;y<=y2+1e-6;y+=1) line(c,P(0,y,z1),P(0,y,z2),PAL.cap,.9); line(c,P(0,y1,z2),P(0,y2,z2),PAL.cap,.9); line(c,P(0,y1,z1),P(0,y2,z1),PAL.cap,.9); };
  winY(4.6,6.6,.9,2.2); winX(.4,2.4,.9,2.2); winX(9,13,.9,2.2); winY(13.4,14,1.1,2.2);
  poly(c, [P(1.3,0,1.05),P(4.1,0,1.05),P(4.1,0,2.15),P(1.3,0,2.15)], "#232320");
  const [lx,ly] = P(2.7,0,1.6); c.fillStyle = PAL.gold; c.beginPath(); c.moveTo(lx,ly-7); c.lineTo(lx+7,ly); c.lineTo(lx,ly+7); c.lineTo(lx-7,ly); c.closePath(); c.fill();
  c.fillStyle = "#232320"; c.beginPath(); c.arc(lx, ly, 2.2, 0, 7); c.fill();
  poly(c, [P(8.4,0,1.0),P(11.6,0,1.0),P(11.6,0,2.05),P(8.4,0,2.05)], "#232320");
  [.3,.45,.38,.62,.55,.8].forEach((h,i) => poly(c, [P(8.8+i*.45,0,1.15),P(9.1+i*.45,0,1.15),P(9.1+i*.45,0,1.15+h),P(8.8+i*.45,0,1.15+h)], i===5 ? PAL.gold : "#8E8B80"));
  poly(c, [P(15.6,0,1.35),P(17.6,0,1.35),P(17.6,0,2.1),P(15.6,0,2.1)], "#2F3A33");
  for (let i=0;i<3;i++) line(c, P(15.8,0,1.9-i*.18), P(16.9-i*.2,0,1.9-i*.18), "#E9E4D8", .8);
  poly(c, [P(0,6.3,1.0),P(0,7.7,1.0),P(0,7.7,2.0),P(0,6.3,2.0)], PAL.gold);
  poly(c, [P(0,6.45,1.12),P(0,7.55,1.12),P(0,7.55,1.88),P(0,6.45,1.88)], PAL.wine);
  poly(c, [P(0,14.2,1.0),P(0,16.8,1.0),P(0,16.8,1.9),P(0,14.2,1.9)], "#F7F6F2");
  [[14.4,"#3E7A80"],[15.2,"#D6BC6A"],[16,"#7A1426"]].forEach(([y,col]) => poly(c, [P(0,y,1.15),P(0,y+.6,1.15),P(0,y+.6,1.75),P(0,y,1.75)], col));
}

/* =================== Agentes =================== */
const agents = [];
const reserved = new Map();
function makeAgents(){
  for (const id of SETORES){
    const r = R[id], [hx,hy] = r.home;
    const a = {id, r, x:hx+.5, y:hy+.5, cell:[hx,hy], path:[], act:"work", next:null, until:0, seated:true, hidden:false, fx:0, fy:-1,
      energia:rnd(40,100), wc:rnd(0,60), step:0, bubble:null, bubbleUntil:0, nextLine: performance.now()/1000 + rnd(4,25), target:null};
    reserved.set(ck(hx,hy), id); a.target = [hx,hy];
    agents.push(a);
  }
  const ini = agents.filter(a => a.id !== "dir").sort(() => Math.random()-.5);
  ini[0].energia = 15; ini[1].energia = 22; ini[2].wc = 79;
}
let meetingActive = false, meetingUntil = 0, paused = false, last = 0;
const now = () => performance.now()/1000;
function hour(){ return new Date().getHours(); }
function period(){ const h = hour(); if (h < 7 || h >= 19) return "fora"; if (h === 12) return "almoco"; return "exp"; }
function release(a){ if (a.target && reserved.get(ck(a.target[0],a.target[1])) === a.id) reserved.delete(ck(a.target[0],a.target[1])); a.target = null; }
function freeSpot(list){ const f = list.filter(p => !reserved.has(ck(p.c[0],p.c[1]))); return f.length ? pick(f) : null; }
function say(a, text, sec=3.2){ a.bubble = text; a.bubbleUntil = now() + sec; }
function goTo(a, cell, next){
  release(a);
  a.target = cell; reserved.set(ck(cell[0],cell[1]), a.id);
  const path = bfs(a.cell, cell);
  a.seated = false; a.hidden = false;
  if (path === null){ a.x = cell[0]+.5; a.y = cell[1]+.5; a.cell = cell.slice(); a.path = []; arrive(a, next); return; }
  a.path = path; a.next = next;
  if (!path.length) arrive(a, next); else a.act = "walk";
}
function arrive(a, next){
  a.act = next.act; a.seated = !!next.seat; a.until = now() + (next.dur || 0);
  if (next.f){ a.fx = next.f[0]; a.fy = next.f[1]; }
  if (next.act === "wc") a.hidden = true;
  const l = next.act === "work" ? null : LINES[next.act];
  if (l && Math.random() < .8) say(a, pick(l));
  if (next.act === "pool") shot();
}
function goWork(a){ goTo(a, R[a.id].home, {act:"work", seat:true, f:[0,-1]}); }
function shot(){ const b = pick(balls); const ang = rnd(0,Math.PI*2), sp = rnd(1.5,3.2); b.vu = Math.cos(ang)*sp; b.vv = Math.sin(ang)*sp; }
function drainRate(a){
  let r = .42;
  if (abertas(a.id).length) r *= .72; else r *= 1.25;
  if (has("metas")) r *= .85;
  if (a.id === "dir") r *= .8;
  return r;
}
function recover(a, base){ return base * (has("plantas") ? 1.15 : 1); }
function chooseBreak(a){
  const per = period();
  if (a.wc > 80){ const s = freeSpot(POI.stalls); if (s) return goTo(a, s.c, {act:"wc", dur:rnd(6,9), f:s.f}); }
  const opts = [["coffee", per === "almoco" ? 60 : 38], ["sofa", 22], ["pool", agents.some(g => g.act === "pool") ? 45 : 22]];
  if (has("pufes")) opts.push(["puff", 14]);
  if (has("fliper")) opts.push(["arcade", 22]);
  if (a.id === "dir") opts.push(["wander", 40]);
  if (a.id !== "dir") opts.push(["chat", 10]);
  let tot = opts.reduce((s,o) => s+o[1], 0), r = Math.random()*tot, choice = opts[0][0];
  for (const [k,w] of opts){ r -= w; if (r <= 0){ choice = k; break; } }
  const go = (list, act, dur, seat) => { const s = freeSpot(list); if (!s) return false; goTo(a, s.c, {act, dur, f:s.f, seat}); return true; };
  if (choice === "coffee" && go(POI.coffee, "coffee1", rnd(3.5,5.5))) return;
  if (choice === "sofa" && go(POI.sofa, "sofa", rnd(14,24), true)) return;
  if (choice === "puff" && go(POI.puff, "puff", rnd(12,20), true)) return;
  if (choice === "pool" && go(POI.pool, "pool", rnd(18,30))) return;
  if (choice === "arcade" && go(POI.arcade, "arcade", rnd(12,20))) return;
  if (choice === "wander" && go(POI.wander, "wander", rnd(4,7))) return;
  if (choice === "chat"){
    const mate = agents.find(g => g !== a && g.id !== "dir" && g.act === "work" && Math.random() < .6);
    const [s1,s2] = POI.chat;
    if (mate && !reserved.has(ck(...s1.c)) && !reserved.has(ck(...s2.c))){
      const d = rnd(7,11); goTo(a, s1.c, {act:"chat", dur:d, f:s1.f}); goTo(mate, s2.c, {act:"chat", dur:d, f:s2.f}); return;
    }
  }
  if (!go(POI.coffee, "coffee1", rnd(3.5,5.5))) go(POI.sofa, "sofa", rnd(14,24), true);
}
function update(a, dt){
  const t = now();
  if (a.act === "walk"){
    const n = a.path[0];
    if (!n){ arrive(a, a.next); return; }
    const tx = n[0]+.5, ty = n[1]+.5, dx = tx-a.x, dy = ty-a.y, dist = Math.hypot(dx,dy), sp = 2.4*dt;
    if (dist > 1e-3){ a.fx = Math.sign(Math.round(dx*10)/10); a.fy = Math.sign(Math.round(dy*10)/10); }
    a.step += dt*6;
    if (dist <= sp){ a.x = tx; a.y = ty; a.cell = [n[0],n[1]]; a.path.shift(); if (!a.path.length) arrive(a, a.next); }
    else { a.x += dx/dist*sp; a.y += dy/dist*sp; }
    a.energia = Math.max(0, a.energia - .05*dt); a.wc = Math.min(100, a.wc + .2*dt);
    return;
  }
  if (meetingActive && a.act !== "meeting") return;
  switch (a.act){
    case "work": {
      a.energia = Math.max(0, a.energia - drainRate(a)*dt);
      a.wc = Math.min(100, a.wc + .26*dt);
      if (t > a.nextLine){ a.nextLine = t + rnd(18,40); if (Math.random() < .7) say(a, pick(WORK_LINES[a.id])); }
      const per = period(), thr = per === "fora" ? 92 : per === "almoco" ? 70 : 34;
      if (a.energia < thr || a.wc > 80) chooseBreak(a);
      break;
    }
    case "coffee1":
      if (t > a.until){ const s = freeSpot(POI.bistro); if (s) goTo(a, s.c, {act:"coffee2", dur:rnd(10,16), seat:true, f:s.f}); else { a.act = "coffee2"; a.until = t + 8; } }
      break;
    case "coffee2": case "sofa": case "puff": case "pool": case "arcade": case "chat": case "wander": {
      const base = {coffee2: has("cafe") ? 11 : 6, sofa:5, puff:5, pool:4, arcade:5, chat:2, wander:1}[a.act];
      a.energia = Math.min(100, a.energia + recover(a, base)*dt);
      if (a.act === "pool" && Math.random() < dt/3.5) shot();
      if (t > a.until && (a.energia > 80 || ["chat","wander"].includes(a.act) || t > a.until + 20)){
        if (period() === "fora" && Math.random() < .55 && a.act !== "wander") { a.until = t + rnd(10,20); break; }
        goWork(a);
      }
      break;
    }
    case "wc":
      if (t > a.until){ a.wc = 0; a.hidden = false; const s = freeSpot(POI.sink); if (s) goTo(a, s.c, {act:"wash", dur:2.5, f:s.f}); else goWork(a); }
      break;
    case "wash": if (t > a.until) goWork(a); break;
    case "meeting":
      a.energia = Math.max(0, a.energia - .1*dt);
      if (!meetingActive && t > meetingUntil) goWork(a);
      break;
  }
}
function callMeeting(sec){
  meetingActive = true;
  POI.meet.forEach(p => { const k = ck(p.c[0],p.c[1]); if (reserved.has(k)) reserved.delete(k); });
  agents.forEach((a,i) => { a.hidden = false; const p = POI.meet[i % POI.meet.length]; goTo(a, p.c, {act:"meeting", seat:true, f:p.f}); });
  if (sec){ setTimeout(() => endMeeting(4), sec*1000); }
}
function endMeeting(extra){ meetingActive = false; meetingUntil = now() + (extra || 0); }

/* =================== Desenho =================== */
const game = document.createElement("canvas"); game.className = "office-canvas"; game.setAttribute("role","img"); game.setAttribute("aria-label","Escritório da MC Digital com a equipe se movendo entre as mesas, a copa, o banheiro e a área de descanso"); const gctx = game.getContext("2d");
function statusColor(a){ if (a.act === "meeting") return "#5B8FD0"; if (a.act === "work") return "#3FA36B"; if (a.act === "walk" && a.next?.act === "work") return "#3FA36B"; if (a.act === "walk" && a.next?.act === "meeting") return "#5B8FD0"; return "#E0A32E"; }
function rr(c, x, y, w, h, r, col){
  c.fillStyle = col; c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
  c.fill();
}
function circ(c, x, y, r, col){ c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI*2); c.fill(); }
function drawAgent(c, a){
  if (a.hidden) return;
  const z = a.seated ? .3 : 0;
  const [gx,gy] = P(a.x,a.y,0), [X,Y] = P(a.x,a.y,z);
  c.fillStyle = "rgba(0,0,0,.18)"; c.beginPath(); c.ellipse(gx, gy, 5.6, 2.3, 0, 0, 7); c.fill();
  if (a.id === sel){ c.strokeStyle = PAL.gold; c.lineWidth = 1.2; c.beginPath(); c.ellipse(gx, gy, 8.5, 4.1, 0, 0, 7); c.stroke(); }
  c.save(); c.translate(X, Y); c.scale(1.22, 1.22); c.translate(-X, -Y);
  const front = a.fx + a.fy > 0, right = a.fx - a.fy > 0, dir = right ? 1 : -1;
  const walking = a.act === "walk", sw = walking ? Math.sin(a.step*Math.PI) : 0;
  const r = a.r, shirtD = shade(r.shirt,.22), pants = "#2E2D2A", shoe = "#1C1B19";
  if (!a.seated){
    const l1 = Math.max(0, sw)*1.4, l2 = Math.max(0, -sw)*1.4;
    rr(c, X-3.1, Y-6.6+l1, 2.5, 6.4-l1, 1.2, pants);
    rr(c, X+0.6, Y-6.6+l2, 2.5, 6.4-l2, 1.2, pants);
    c.fillStyle = shoe; c.beginPath(); c.ellipse(X-1.9, Y-.2+l1*.2, 1.6, .9, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(X+1.9, Y-.2+l2*.2, 1.6, .9, 0, 0, 7); c.fill();
  } else rr(c, X-3.6, Y-5.4, 7.2, 3, 1.4, pants);
  const bob = walking ? -Math.abs(sw)*.7 : 0;
  const TY = Y - 14 + bob, hx = X + (front ? dir*.3 : 0), hy = TY - 4.4;
  if (r.style === "long") rr(c, hx-4.1, hy-1.5, 8.2, front ? 8.2 : 9, 3.4, r.hair);
  rr(c, X-4.4, TY, 8.8, 9, 3.4, shirtD);
  rr(c, right ? X-4.4 : X-2.4, TY, 6.8, 9, 3.4, r.shirt);
  c.fillStyle = "rgba(255,255,255,.12)"; c.beginPath(); c.ellipse(right ? X-1.6 : X+1.6, TY+2.4, 1.6, 1, 0, 0, 7); c.fill();
  if (a.act === "pool"){ rr(c, X+(dir>0 ? 2.4 : -6.8), TY+2.6, 4.4, 1.8, .9, shirtD); circ(c, X+dir*6.9, TY+3.5, 1.05, r.skin); }
  else if (a.act === "coffee1" || a.act === "coffee2"){
    rr(c, X+(dir>0 ? 2.8 : -5.6), TY+3, 2.8, 1.7, .8, shirtD);
    rr(c, X+dir*5.6-1.4, TY+1.6, 2.8, 3.2, .7, "#F7F6F2"); rr(c, X+dir*5.6-1.4, TY+1.6, 2.8, .9, .4, "#6E4C30");
  } else {
    rr(c, X-5.6, TY+1, 1.9, 6.4, .95, shirtD); rr(c, X+3.7, TY+1, 1.9, 6.4, .95, shirtD);
    circ(c, X-4.65, TY+7.6, 1, r.skin); circ(c, X+4.65, TY+7.6, 1, r.skin);
  }
  rr(c, X-1.1, TY-1.4, 2.2, 2, .6, shade(r.skin,.12));
  circ(c, hx, hy, 3.9, r.skin);
  c.fillStyle = r.hair; c.beginPath();
  if (front){
    c.arc(hx, hy, 4.15, Math.PI*.98, Math.PI*2.02); c.quadraticCurveTo(hx+dir*1.5, hy-1.4, hx-dir*4.15, hy+.2); c.fill();
    circ(c, hx-dir*3.3, hy+.6, 1.15, r.hair);
    c.fillStyle = "#1E1B19"; const ex = dir*.8;
    c.beginPath(); c.ellipse(hx-1.35+ex, hy+.9, .5, .65, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(hx+1.35+ex, hy+.9, .5, .65, 0, 0, 7); c.fill();
    c.fillStyle = "rgba(214,120,110,.35)"; c.beginPath(); c.arc(hx+2.3+ex, hy+2.1, .8, 0, 7); c.fill(); c.beginPath(); c.arc(hx-2.3+ex, hy+2.1, .8, 0, 7); c.fill();
  } else {
    c.arc(hx, hy, 4.15, 0, Math.PI*2); c.fill();
    circ(c, hx+dir*3.6, hy+.8, .9, r.skin);
  }
  if (r.style === "bun") circ(c, hx-dir*.4, hy-4.6, 2, r.hair);
  c.fillStyle = statusColor(a); c.strokeStyle = "#FFFFFF"; c.lineWidth = .7;
  c.beginPath(); c.arc(hx, hy-7.6, 1.5, 0, 7); c.fill(); c.stroke();
  c.restore();
  if (a.act === "pool"){
    const tb = balls.reduce((m,b) => { const [px,py] = P(3.2+b.u,11.2+b.v,.64); const d = Math.hypot(px-X,py-TY); return d < m.d ? {d,px,py} : m; }, {d:1e9});
    if (tb.d < 200){ const k = Math.min(1, 18/tb.d); c.strokeStyle = "#8B5E34"; c.lineWidth = .9; c.lineCap = "round"; c.beginPath(); c.moveTo(X+dir*7.5, TY+3.5); c.lineTo(X+dir*7.5+(tb.px-X)*k, TY+3.5+(tb.py-TY)*k); c.stroke(); }
  }
}
/* Câmera: zoom e arraste dentro do escritório */
const cam = {x:LW/2, y:LH/2, z:1, tx:LW/2, ty:LH/2, tz:1, follow:false};
const ZMIN = 1, ZMAX = 3.2;
let FIT = 1, statS = 0, staticDirty = true, lastZoomAt = 0;
const scaleNow = () => FIT * cam.z;
function clampCam(){
  const S = scaleNow(), hw = game.width/(2*S), hh = game.height/(2*S);
  cam.x = LW <= 2*hw ? LW/2 : Math.min(LW-hw, Math.max(hw, cam.x));
  cam.y = LH <= 2*hh ? LH/2 : Math.min(LH-hh, Math.max(hh, cam.y));
}
function clampTarget(){
  const S = FIT*cam.tz, hw = game.width/(2*S), hh = game.height/(2*S);
  cam.tx = LW <= 2*hw ? LW/2 : Math.min(LW-hw, Math.max(hw, cam.tx));
  cam.ty = LH <= 2*hh ? LH/2 : Math.min(LH-hh, Math.max(hh, cam.ty));
}
const toWorld = (sx, sy) => { const S = scaleNow(); return [(sx - game.width/2)/S + cam.x, (sy - game.height/2)/S + cam.y]; };
function zoomAt(sx, sy, factor, animate){
  const nz = Math.min(ZMAX, Math.max(ZMIN, (animate ? cam.tz : cam.z) * factor));
  const [wx, wy] = toWorld(sx, sy);
  const S2 = FIT*nz;
  const nx = wx - (sx - game.width/2)/S2, ny = wy - (sy - game.height/2)/S2;
  cam.tz = nz; cam.tx = nx; cam.ty = ny; clampTarget();
  if (!animate){ cam.z = cam.tz; cam.x = cam.tx; cam.y = cam.ty; }
  lastZoomAt = now(); updateZoomUI();
}
function setZoom(z, cx, cy){ cam.tz = Math.min(ZMAX, Math.max(ZMIN, z)); if (cx != null){ cam.tx = cx; cam.ty = cy; } clampTarget(); lastZoomAt = now(); updateZoomUI(); }
function updateZoomUI(){
  const zi = UI.zin, zo = UI.zout, f = UI.zfollow;
  if (zi) zi.disabled = cam.tz >= ZMAX - .01;
  if (zo) zo.disabled = cam.tz <= ZMIN + .01;
  if (f){ f.setAttribute("aria-pressed", cam.follow); f.classList.toggle("on", cam.follow); }
  game.style.cursor = cam.tz > 1.01 ? "grab" : "pointer";
}
function stepCam(dt){
  if (cam.follow){
    const a = agents.find(g => g.id === sel);
    if (a){ const [ax,ay] = P(a.x, a.y, .6); cam.tx = ax; cam.ty = ay; clampTarget(); }
  }
  const k = 1 - Math.exp(-dt*9);
  const oz = cam.z;
  cam.z += (cam.tz - cam.z)*k; cam.x += (cam.tx - cam.x)*k; cam.y += (cam.ty - cam.y)*k;
  if (Math.abs(cam.z - oz) > 1e-4) lastZoomAt = now();
  clampCam();
}
function ensureStatic(){
  const want = Math.min(scaleNow(), 4096/LW, 4096/LH);
  if (!statS || (Math.abs(want - statS)/want > .03 && now() - lastZoomAt > .18) || staticDirty){
    statS = want; staticDirty = false;
    stat.width = Math.ceil(LW*statS); stat.height = Math.ceil(LH*statS); SC = statS; buildStatic();
  }
}
function render(){
  if (!game.isConnected || !game.width || !game.height) return;
  ensureStatic();
  const c = gctx, S = scaleNow(), ox = game.width/2 - cam.x*S, oy = game.height/2 - cam.y*S;
  c.setTransform(1,0,0,1,0,0);
  c.clearRect(0,0,game.width,game.height);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
  c.setTransform(S/statS,0,0,S/statS,ox,oy);
  c.drawImage(stat, 0, 0);
  c.setTransform(S,0,0,S,ox,oy);
  const items = FURN.slice();
  for (const a of agents) items.push({key: a.x + a.y + .001, draw: cc => drawAgent(cc, a)});
  items.sort((p,q) => p.key - q.key);
  for (const it of items) it.draw(c);
  c.setTransform(1,0,0,1,0,0);
  if (period() === "fora"){ c.fillStyle = "rgba(20,24,48,.22)"; c.fillRect(0,0,game.width,game.height); }
  const dpr = Math.min(3, window.devicePixelRatio || 1), t = now(), ls = Math.min(1.25, .85 + cam.z*.15);
  c.textAlign = "center"; c.textBaseline = "middle";
  for (const a of agents){
    if (a.hidden) continue;
    const [bx,by] = P(a.x,a.y,a.seated ? .3 : 0);
    const x = bx*S + ox, y = (by-33)*S + oy;
    if (x < -80 || x > game.width + 80 || y < -40 || y > game.height + 60) continue;
    c.font = `600 ${11*dpr*ls}px Poppins, "Helvetica Neue", Arial, sans-serif`;
    const name = a.r.pessoa, w = c.measureText(name).width + 12*dpr*ls, h = 16*dpr*ls;
    rr(c, x - w/2, y - h, w, h, h/2, a.id === sel ? "#D6BC6A" : "rgba(35,35,32,.84)");
    c.fillStyle = a.id === sel ? "#232320" : "#F7F6F2"; c.textAlign = "center";
    c.fillText(name, x, y - h/2 + .5*dpr);
    if (a.bubble && t < a.bubbleUntil){
      c.font = `500 ${11.5*dpr*ls}px Poppins, "Helvetica Neue", Arial, sans-serif`;
      const bw = c.measureText(a.bubble).width + 16*dpr*ls, bh = 22*dpr*ls, base = y - h - 6*dpr;
      const bx2 = Math.max(4*dpr, Math.min(game.width - bw - 4*dpr, x - bw/2));
      c.save(); c.shadowColor = "rgba(0,0,0,.18)"; c.shadowBlur = 6*dpr; c.shadowOffsetY = 2*dpr;
      rr(c, bx2, base - bh, bw, bh, 8*dpr*ls, "#FFFFFF"); c.restore();
      c.fillStyle = "#FFFFFF"; c.beginPath(); c.moveTo(x - 5*dpr, base - 1); c.lineTo(x + 5*dpr, base - 1); c.lineTo(x, base + 5*dpr); c.closePath(); c.fill();
      c.fillStyle = "#2B2B2B"; c.textAlign = "left"; c.fillText(a.bubble, bx2 + 8*dpr*ls, base - bh/2 + .5*dpr);
    }
  }
}
let firstSize = true;
function resize(){
  const wrap = UI.wrap; if (!wrap) return; const cw = wrap.clientWidth, narrow = cw < 560;
  const ch = Math.round(narrow ? Math.max(cw * LH / LW, Math.min(cw * .92, 400)) : cw * LH / LW);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  game.style.width = cw + "px"; game.style.height = ch + "px";
  const W = Math.round(cw*dpr), H = Math.round(ch*dpr);
  if (game.width === W && game.height === H) return;
  game.width = W; game.height = H;
  FIT = Math.min(W/LW, H/LH);
  if (firstSize){ firstSize = false; if (narrow){ const z = Math.min(ZMAX, (H/LH)/FIT * 1.02); cam.z = cam.tz = z; cam.x = cam.tx = LW*.42; cam.y = cam.ty = LH*.55; } }
  clampTarget(); clampCam(); staticDirty = true; updateZoomUI();
}
function loop(ts){
  const dt = Math.min(.1, (ts - (last || ts)) / 1000); last = ts;
  if (!paused && !document.hidden){ for (const a of agents) update(a, dt); updateBalls(dt); }
  stepCam(dt);
  render();
  requestAnimationFrame(loop);
}
function tapAt(sx, sy){
  const [lx, ly] = toWorld(sx, sy);
  let hit = null, best = -1;
  for (const a of agents){
    if (a.hidden) continue;
    const [bx,by] = P(a.x,a.y,a.seated ? .3 : 0);
    if (lx > bx-8 && lx < bx+8 && ly > by-34 && ly < by+3 && a.x+a.y > best){ hit = a; best = a.x+a.y; }
  }
  if (hit){ onTap(hit.id); return; }
  const u = (lx-OX)/HW, v = (ly-OY)/HH, wx = Math.floor((u+v)/2), wy = Math.floor((v-u)/2);
  if (wx<0 || wy<0 || wx>=COLS || wy>=ROWS) return;
  const z = zone(wx,wy);
  if (z === "dir") return onTap("dir");
  if (z === "reu") return onTap("reu");
  const info = {copa:["Copa", ["coffee1","coffee2"]], wc:["Banheiro", ["wc","wash"]], lounge:["Área de descanso", ["sofa","pool","arcade","puff"]]}[z];
  if (info){ const n = agents.filter(a => info[1].includes(a.act)).length; toast(`<b>${info[0]}</b> · ${n ? `${n} ${n>1 ? "pessoas" : "pessoa"} aqui agora` : "vazia agora"}`); }
}
const ptrs = new Map(); let gesture = null;
const devPt = ev => { const r = game.getBoundingClientRect(); return [(ev.clientX - r.left) * game.width / r.width, (ev.clientY - r.top) * game.height / r.height]; };
game.addEventListener("pointerdown", ev => {
  game.setPointerCapture(ev.pointerId);
  ptrs.set(ev.pointerId, devPt(ev));
  if (ptrs.size === 1){ const [x,y] = devPt(ev); gesture = {type:"pan", sx:x, sy:y, cx:cam.x, cy:cam.y, moved:false, t:now()}; }
  else if (ptrs.size === 2){ const [a,b] = [...ptrs.values()]; gesture = {type:"pinch", d:Math.hypot(a[0]-b[0], a[1]-b[1]), z:cam.z, mx:(a[0]+b[0])/2, my:(a[1]+b[1])/2, moved:true}; cam.follow = false; updateZoomUI(); }
});
game.addEventListener("pointermove", ev => {
  if (!ptrs.has(ev.pointerId) || !gesture) return;
  ptrs.set(ev.pointerId, devPt(ev));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (gesture.type === "pan" && ptrs.size === 1){
    const [x,y] = devPt(ev), dx = x - gesture.sx, dy = y - gesture.sy;
    if (!gesture.moved && Math.hypot(dx,dy) > 6*dpr){ gesture.moved = true; if (cam.z > 1.01){ cam.follow = false; updateZoomUI(); game.style.cursor = "grabbing"; } }
    if (gesture.moved && cam.z > 1.01){ const S = scaleNow(); cam.x = cam.tx = gesture.cx - dx/S; cam.y = cam.ty = gesture.cy - dy/S; clampCam(); cam.tx = cam.x; cam.ty = cam.y; }
  } else if (gesture.type === "pinch" && ptrs.size === 2){
    const [a,b] = [...ptrs.values()], d = Math.hypot(a[0]-b[0], a[1]-b[1]), mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2;
    const target = Math.min(ZMAX, Math.max(ZMIN, gesture.z * d / gesture.d));
    zoomAt(gesture.mx, gesture.my, target / cam.z, false);
    const S = scaleNow(); cam.x -= (mx - gesture.mx)/S; cam.y -= (my - gesture.my)/S; clampCam(); cam.tx = cam.x; cam.ty = cam.y;
    gesture.mx = mx; gesture.my = my;
  }
});
function endPtr(ev){
  if (!ptrs.has(ev.pointerId)) return;
  const was = gesture; ptrs.delete(ev.pointerId);
  if (was && was.type === "pan" && !was.moved && ptrs.size === 0 && ev.type === "pointerup"){
    const [x,y] = devPt(ev);
    const tNow = now();
    if (lastTap && tNow - lastTap.t < .32 && Math.hypot(x-lastTap.x, y-lastTap.y) < 30){ lastTap = null; zoomAt(x, y, cam.tz >= ZMAX - .05 ? 1/ZMAX : 1.8, true); }
    else { lastTap = {t:tNow, x, y}; tapAt(x, y); }
  }
  if (ptrs.size === 1){ const [p] = [...ptrs.values()]; gesture = {type:"pan", sx:p[0], sy:p[1], cx:cam.x, cy:cam.y, moved:true}; }
  else if (ptrs.size === 0){ gesture = null; updateZoomUI(); }
}
let lastTap = null;
game.addEventListener("pointerup", endPtr);
game.addEventListener("pointercancel", endPtr);
game.addEventListener("wheel", ev => {
  ev.preventDefault();
  const [x,y] = devPt(ev);
  zoomAt(x, y, Math.exp(-ev.deltaY * (ev.ctrlKey ? .01 : .0018)), false);
}, {passive:false});


/* =================== API usada pela tela Início =================== */
let started = false, ro = null;
function start(){
  if (started) return; started = true;
  makeAgents(); buildWorld();
  requestAnimationFrame(loop);
}
const ICON = {
  zin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  zout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
  zfit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  zfollow: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
};
const iconBtn = (key, label, onclick) => { const b = h('button', { type: 'button', class: 'of-zbtn', 'aria-label': label, title: label, onclick }); b.innerHTML = ICON[key]; return b; };

// load: { dir, plan, cont, des, atd, ven, fin } com a quantidade de trabalho aberto de cada setor
// missions: [{ s, t, n, total }]
// describe(id): { title, sub, items: [{ label, href?, onclick? }] } para o painel do agente tocado
export function officeCard({ load = {}, missions = [], describe = () => null } = {}) {
  LOAD = load; MISSIONS = missions;
  start();
  const detail = h('div', { class: 'of-detail', 'aria-live': 'polite' });
  const drawDetail = () => {
    const id = sel;
    if (!id) { detail.replaceChildren(h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Toque em alguém da equipe para ver o que está com essa pessoa.')); return; }
    const d = describe(id) || {};
    const r = R[id] || {};
    const who = r.meeting ? 'Sala de reunião' : `${r.pessoa} · ${r.nome}`;
    const a = agents.find((g) => g.id === id);
    const now = a ? (a.act === 'walk' ? (a.next?.act === 'work' ? 'Voltando para a mesa' : a.next?.act === 'meeting' ? 'Indo para a reunião' : 'Andando') : ACT_LABEL[a.act]) : '';
    detail.replaceChildren(
      h('div', { class: 'of-who' },
        r.meeting ? null : h('span', { class: 'of-av', style: `background:${r.shirt}` }, (r.pessoa || '?').split(' ').map((w) => w[0]).join('').slice(0, 2)),
        h('div', {}, h('b', {}, who), h('div', { class: 'muted', style: 'font-size:12.5px' }, [d.sub || r.cargo, now ? ` · agora: ${now.toLowerCase()}` : ''].join('')))),
      d.items?.length ? h('div', { class: 'of-items' }, ...d.items.map((it) => it.href ? h('a', { class: 'of-item', href: it.href }, it.label, h('span', { 'aria-hidden': 'true' }, '→')) : h('button', { type: 'button', class: 'of-item', onclick: it.onclick }, it.label, h('span', { 'aria-hidden': 'true' }, '→'))))
        : h('p', { class: 'muted', style: 'margin:0;font-size:13px' }, 'Nada pendente com essa pessoa agora.'));
  };
  pickHandler = () => drawDetail();

  const zin = iconBtn('zin', 'Aproximar', () => setZoom(cam.tz * 1.5));
  const zout = iconBtn('zout', 'Afastar', () => { setZoom(cam.tz / 1.5); if (cam.tz <= 1.01) cam.follow = false; updateZoomUI(); });
  const zfit = iconBtn('zfit', 'Ver o escritório inteiro', () => { cam.follow = false; setZoom(1, LW / 2, LH / 2); });
  const zfollow = iconBtn('zfollow', 'Seguir a pessoa selecionada', () => {
    if (!sel || sel === 'reu') { toast('Toque em alguém da equipe primeiro.'); return; }
    cam.follow = !cam.follow; if (cam.follow && cam.tz < 1.9) setZoom(2.2); updateZoomUI();
  });
  const wrap = h('div', { class: 'of-wrap' }, game, h('div', { class: 'of-zoom' }, zin, zout, zfit, zfollow));
  Object.assign(UI, { wrap, zin, zout, zfollow });

  const busy = SETORES.filter((id) => (load[id] || 0) > 0).length;
  const meetBtn = h('button', { type: 'button', class: 'btn sm', onclick: () => {
    if (meetingActive){ endMeeting(1); meetBtn.textContent = 'Chamar reunião'; toast('Reunião encerrada. Todo mundo de volta às mesas.'); }
    else { callMeeting(0); meetBtn.textContent = 'Encerrar reunião'; toast('Equipe a caminho da sala de reunião.'); }
  } }, meetingActive ? 'Encerrar reunião' : 'Chamar reunião');
  const card = h('section', { class: 'card office-card' },
    h('div', { class: 'home-card-head' }, h('h3', {}, 'Sua equipe agora'),
      h('span', { class: 'of-head-r' }, h('span', { class: 'muted', style: 'font-size:13px' }, busy ? `${busy} de 7 em missão` : 'Equipe livre'), meetBtn)),
    wrap,
    h('div', { class: 'of-legend muted' }, h('span', {}, h('i', { style: 'background:#3FA36B' }), 'Trabalhando'), h('span', {}, h('i', { style: 'background:#E0A32E' }), 'Pausa'), h('span', {}, h('i', { style: 'background:#5B8FD0' }), 'Reunião'), h('span', { class: 'of-hint' }, 'Pinça, roda do mouse ou toque duplo para dar zoom')),
    detail);
  drawDetail();
  if (ro) ro.disconnect();
  ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  requestAnimationFrame(() => { resize(); updateZoomUI(); });
  return card;
}
export const AGENTS = ROOMS;
