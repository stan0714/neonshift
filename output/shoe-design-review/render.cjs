// Static artwork review from the actual TSX paths. Not an Android screenshot.
const fs=require('fs'), path=require('path'), vm=require('vm');
const root=path.resolve(__dirname,'../../app/src');
const ts=require('../../app/node_modules/typescript');
const cache={};
const createElement=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
const react={createElement,useEffect:()=>{},useId:()=> 'review',useState:v=>[v,()=>{}],useRef:v=>({current:v})};
const names=['Svg','G','Path','Circle','Ellipse','Defs','LinearGradient','RadialGradient','Stop'];
const svg=Object.fromEntries(names.map(n=>[n,n[0].toLowerCase()+n.slice(1)]));svg.default='svg';svg.__esModule=true;
function load(file){
 file=path.resolve(file);if(cache[file]) return cache[file];
 const mod={exports:{}};cache[file]=mod.exports;
 const req=(n)=>{
  if(n==='react')return react;
  if(n==='react-native')return {View:'div',Animated:{View:'div',Value:class{interpolate(o){return o.outputRange[0]}}},AppState:{currentState:'active'},StyleSheet:{create:x=>x,absoluteFill:{}}};
  if(n==='react-native-svg')return svg;
  if(n==='@/theme')return {...load(root+'/theme/tokens.ts'),Text:'span'};
  if(n==='@/state/walletStore')return {useWalletStore:()=>null};
  if(n==='@/hooks/useReduceMotion')return {useReduceMotion:()=>true};
  if(n==='@/i18n')return {useT:()=>({t:k=>k})};
  let f=n.startsWith('@/')?root+'/'+n.slice(2):path.resolve(path.dirname(file),n);
  for(const ext of ['.ts','.tsx'])if(fs.existsSync(f+ext))return load(f+ext);
  throw Error(n);
 };
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext('(function(require,module,exports){'+code+'})',{console,React:react})(req,mod,mod.exports);cache[file]=mod.exports;return mod.exports;
}
const Hero=load(root+'/components/ShoeHero.tsx').ShoeHero;
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function expand(n){if(!n||typeof n!=='object')return n;if(typeof n.type==='function')return expand(n.type({...n.props,children:n.children}));return {...n,children:n.children.map(expand)}}
function serialize(n){
 if(!n||typeof n!=='object')return '';
 const attrs=Object.entries(n.props).filter(([k,v])=> !['children','style','testID','key','width','height'].includes(k)&& typeof v!=='object').map(([k,v])=>`${k==='viewBox'?k:k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}="${esc(v)}"`).join(' ');
 return `<${n.type} ${attrs}>${n.children.map(serialize).join('')}</${n.type}>`;
}
const blocks=[];
for(let level=2;level<=5;level++){
 const nodes=[]; const collect=n=>{if(!n||typeof n!=='object')return;if(n.type==='svg')nodes.push(n);else n.children.forEach(collect)};
 collect(expand(Hero({level,owner:null,size:520,active:false,badge:false})));
 const main=nodes[2];
 const art=serialize(main).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" width="780" height="624" ');
 fs.writeFileSync(path.join(__dirname,`shoe-${level}.svg`),art);
 blocks.push(`<article><h2>${['','','FOREST PATH / ASIAN ELEPHANT','REEF CURRENT / HAWKSBILL','FOREST LIGHT / TIGER','WINTER TRACE / AMUR LEOPARD'][level]}</h2><img src="shoe-${level}.svg"></article>`);
}
fs.writeFileSync(path.join(__dirname,'preview.html'),`<!doctype html><meta charset="utf-8"><title>Wild Guardians — Design review</title><style>body{background:#050711;color:#ddd;font:14px Arial;margin:32px}main{display:grid;grid-template-columns:1fr 1fr;gap:20px}article{background:#0B1020;padding:20px}img{width:100%}h2{font-size:16px;color:#30EBC8}</style><h1>WILD GUARDIANS / Detail refinement</h1><p>Static vectors from App components · not device captures · preview finishes</p><main>${blocks.join('')}</main>`);
