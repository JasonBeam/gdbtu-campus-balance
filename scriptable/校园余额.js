// Variables used by Scriptable.
// icon-color: green; icon-glyph: university;
// GDBTU Campus Balance — standalone. No personal companion, no telemetry.
const PREFIX = 'gdbtu_public_v1_';
const BASE = 'https://ecykt.gdbtu.edu.cn';
const PATHS = {power:'/ykt-mini/api/electricnew/service', card:'/ykt-mini/scanpay/getUserBalance',
  customer:'/ykt-mini/api/customer/getSysBindCustInfo', login:'/ykt-mini/api/customer/loginBySysId'};
const FIELDS = ['syscustid','acc_token','areacode','buildingID','custid','userAgent','timestamp'];
const TTL = 20 * 60 * 1000;
const APPID = 'wx7077a0b57d156efe', VERSION = 'v1.1.55';
const read = name => Keychain.contains(PREFIX+name) ? Keychain.get(PREFIX+name) : '';
const write = (name,value) => Keychain.set(PREFIX+name,String(value));

function amount(value){
  if(value===null||value===undefined||typeof value==='boolean'||!['number','string'].includes(typeof value)||String(value).trim()==='')throw Error('接口未返回有效余额');
  const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>1e9)throw Error('接口未返回有效余额');return n;
}
function dataOf(result){
  if(!result||result.code!==0)throw Error('学校接口拒绝请求，请核对参数或更新登录凭据');
  let data=result.data;if(typeof data==='string'){try{data=JSON.parse(data);}catch{}}return data;
}
function providerTime(value){
  if(typeof value!=='string'||value.length>40)return null;
  // School timestamps without an offset are Asia/Shanghai, not phone timezone.
  let normalized=value.replace(' ','T');
  if(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(normalized))normalized+='+08:00';
  const epoch=Date.parse(normalized);return Number.isFinite(epoch)?new Date(epoch).toISOString():null;
}
async function post(path,payload,cfg,power=false){
  if(!cfg.syscustid||!cfg.acc_token)throw Error('请先在 Scriptable 中配置查询参数');
  const req=new Request(BASE+path);req.method='POST';req.timeoutInterval=10;
  req.onRedirect=()=>null;
  req.headers={'Content-Type':'application/json','Accept':'application/json','Origin':BASE,
    'Referer':power?`${BASE}/ykt-view/powernew?interfaceName=powernew_${encodeURIComponent(cfg.areacode)}&isbind=1`:`${BASE}/ykt-view/recharge?isbind=1`,
    'acc_token':cfg.acc_token,'User-Agent':cfg.userAgent||'Mozilla/5.0'};
  req.body=JSON.stringify({syscustid:cfg.syscustid,acc_token:cfg.acc_token,...(cfg.timestamp?{timestamp:cfg.timestamp}:{}),...payload});
  let result;try{result=await req.loadJSON();}catch{throw Error('学校接口连接或解析失败');}
  if(req.response.statusCode===401||req.response.statusCode===403)throw Error('登录凭据已失效，请更新 acc_token');
  if(req.response.statusCode!==200)throw Error('学校接口暂时不可用');
  return dataOf(result);
}
async function fetchPower(cfg){
  if(!cfg.buildingID)throw Error('请配置宿舍 buildingID');
  let data=await post(PATHS.power,{server:'/api/getMeterStatus',areacode:cfg.areacode,buildingID:cfg.buildingID},cfg,true);
  if(Array.isArray(data)){if(data.length!==1)throw Error('请在官方页面核对宿舍电表绑定');data=data[0];}
  if(!data||typeof data!=='object')throw Error('电表数据格式变化');
  let remaining=null;try{remaining=amount(data.remaining);}catch{}
  return {value:amount(data.leftMoney),remaining,providerAt:providerTime(data.updateDateTime)};
}
async function fetchCard(cfg){
  let balanceId=cfg.syscustid;
  try{const session=await post(PATHS.login,{areacode:cfg.areacode,version:VERSION,appid:APPID,redirect:'/recharge?isbind=1'},cfg);if(session&&session.syscustid)balanceId=String(session.syscustid);}catch{}
  let custid=cfg.custid;
  if(!custid){const list=await post(PATHS.customer,{appid:APPID,areacode:cfg.areacode,version:VERSION},cfg);
    if(!Array.isArray(list)||list.length!==1||!list[0]||!list[0].custid)throw Error('请从自己的校园卡请求提取 custid');
    custid=String(list[0].custid);}
  const data=await post(PATHS.card,{syscustid:balanceId,custid},cfg);
  return {value:amount(data&&typeof data==='object'?data.balance:data),providerAt:data&&typeof data==='object'?providerTime(data.updatedAt||data.updateDateTime):null};
}
function demo(){return {demo:true,metrics:{power:{value:86.42,remaining:121.4,state:'demo'},card:{value:32.80,state:'demo'}}};}
async function snapshot(){
  let cache={metrics:{}};try{cache=JSON.parse(read('cache'))||cache;}catch{}
  if(!cache.metrics||typeof cache.metrics!=='object')cache={metrics:{}};
  if(cache.checkedAt&&Date.now()-cache.checkedAt<TTL)return cache;
  const cfg=Object.fromEntries(FIELDS.map(k=>[k,read(k)]));cfg.areacode=cfg.areacode||'450010';
  const metrics={};
  await Promise.all(['power','card'].map(async key=>{
    const previous=cache.metrics[key]||{};
    try{const m=await (key==='power'?fetchPower(cfg):fetchCard(cfg));metrics[key]={...m,state:'queried',fetchedAt:new Date().toISOString(),error:null};}
    catch(error){metrics[key]={...previous,value:previous.value??null,state:previous.value!=null?'stale':'unavailable',error:String(error.message)};}
  }));
  const result={demo:false,metrics,checkedAt:Date.now()};write('cache',JSON.stringify(result));return result;
}
function text(parent,value,size,color,bold=false){const t=parent.addText(String(value));t.font=bold?Font.boldSystemFont(size):Font.systemFont(size);t.textColor=color;t.lineLimit=1;t.minimumScaleFactor=0.65;return t;}
const WIDGET_NAME = "校园余额", UI_STYLE = "split";
function buildWidget(snapshot, family) {
  const power=snapshot.metrics.power||{}, card=snapshot.metrics.card||{};
  const dates=[power.fetchedAt,card.fetchedAt].filter(Boolean).sort();
  const data={balance:power.value??null,cardBalance:card.value??null,
    cardBalanceText:card.value==null?"未返回":Number(card.value).toFixed(2)+" 元",
    fetchedAt:new Date(dates[0]||Date.now()),sourceUpdated:power.providerAt||"",
    remainingKwh:power.remaining??null,todayUseText:power.state==='stale'?"缓存":"—",todayLabel:snapshot.demo?"演示":"状态",
    monthUseText:card.state==='stale'?"缓存":"—",price:null,room:"",demo:snapshot.demo,
    stale:['stale','unavailable'].includes(power.state)||['stale','unavailable'].includes(card.state)};
  const widget=buildLegacyWidget(data,family);widget.url=URLScheme.forRunningScript();return widget;
}
function buildLegacyWidget(data, familyOverride) {
  const family = familyOverride || config.widgetFamily || "medium";
  const w = new ListWidget();
  w.backgroundColor = einkBg();
  w.setPadding(0, 0, 0, 0);

  if (family === "small") buildSmall(w, data);
  else buildMedium(w, data);

  w.refreshAfterDate = new Date(Date.now() + 20 * 60 * 1000);
  return w;
}

function buildSmall(w, data) {
  w.backgroundColor = new Color("#F5F4EF");
  w.backgroundImage = nothingWidgetImage({
    kind: "campus", time: timeText(data.fetchedAt),
    power: powerValueText(data), powerRatio: powerRatio(data.balance),
    card: compactValue(data.cardBalance), cardRatio: cardRatio(data.cardBalance),
    use: data.demo ? "演示" : data.stale ? "缓存" : "查询", day: data.demo ? "DEMO" : "STATUS",
    balance: formatMoneyValue(data.balance), date: data.demo ? "DEMO" : data.stale ? "CACHE" : latestDateText(data)
  });
}

function buildSmallSplit(w, data) {
  const header = w.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();
  addText(header, WIDGET_NAME, 13, Font.boldSystemFont(13), Color.white(), 1);
  header.addSpacer();
  addText(header, data.room || "", 10, Font.mediumSystemFont(10), rgba("#FFFFFF", 0.72), 1);

  w.addSpacer(8);
  const power = w.addStack();
  power.layoutVertically();
  addText(power, "电费", 10, Font.semiboldSystemFont(10), rgba("#FFFFFF", 0.66), 1);
  const powerValue = power.addStack();
  powerValue.bottomAlignContent();
  addText(powerValue, fmt(data.balance, 2), 24, Font.boldSystemFont(24), Color.white(), 1);
  addText(powerValue, " 元", 10, Font.semiboldSystemFont(10), rgba("#FFFFFF", 0.74), 1);

  w.addSpacer(6);
  const card = w.addStack();
  card.layoutVertically();
  addText(card, "校园卡", 10, Font.semiboldSystemFont(10), rgba("#FFFFFF", 0.66), 1);
  addText(card, data.cardBalanceText, 21, Font.boldSystemFont(21), Color.white(), 1);

  w.addSpacer();
  const bottom = w.addStack();
  bottom.layoutHorizontally();
  addText(bottom, `${data.todayLabel} ${data.todayUseText}`, 10, Font.mediumSystemFont(10), rgba("#FFFFFF", 0.70), 1);
  bottom.addSpacer();
  addText(bottom, timeText(data.fetchedAt), 10, Font.mediumSystemFont(10), rgba("#FFFFFF", 0.62), 1);
}

function buildSmallMinimal(w, data) {
  const top = w.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  addText(top, WIDGET_NAME, 12, Font.boldSystemFont(12), Color.white(), 1);
  top.addSpacer();
  addText(top, timeText(data.fetchedAt), 10, Font.mediumSystemFont(10), rgba("#FFFFFF", 0.62), 1);

  w.addSpacer(8);
  addSmallMetric(w, "电费", `${fmt(data.balance, 2)} 元`, 27);
  w.addSpacer(5);
  addSmallMetric(w, "饭卡", data.cardBalanceText, 21);

  w.addSpacer();
  addText(w, data.room || "宿舍", 11, Font.semiboldSystemFont(11), rgba("#FFFFFF", 0.78), 1);
  addText(w, `${data.todayLabel} ${data.todayUseText}`, 10, Font.mediumSystemFont(10), rgba("#FFFFFF", 0.62), 1);
}

function addSmallMetric(parent, label, value, size) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  addText(row, label, 10, Font.semiboldSystemFont(10), rgba("#FFFFFF", 0.66), 1);
  row.addSpacer(6);
  addText(row, value, size, Font.boldSystemFont(size), Color.white(), 1);
}

function buildMedium(w, data) {
  const root = addEinkRoot(w, 14, 24);
  addEinkHeader(root, "○ CAMPUS", timeText(data.fetchedAt));
  root.addSpacer(7);
  addEinkDivider(root);
  root.addSpacer(9);

  const main = root.addStack();
  main.layoutHorizontally();

  const left = main.addStack();
  left.layoutVertically();
  addText(left, fmt(data.balance, 2), 38, Font.boldSystemFont(38), einkInk(), 1);
  left.addSpacer(5);
  addBalanceBar(left, data.balance);
  left.addSpacer(5);
  addText(left, data.room || "DORM", 11, Font.boldSystemFont(11), einkMuted(), 1);

  main.addSpacer(18);

  const right = main.addStack();
  right.layoutVertically();
  addEinkMetric(right, "CARD", data.cardBalanceText);
  right.addSpacer(8);
  addEinkMetric(right, data.todayLabel.toUpperCase(), data.todayUseText);
  right.addSpacer(8);
  addEinkMetric(right, "TIME", data.sourceUpdated ? shortDateTime(data.sourceUpdated) : "未提供");

  root.addSpacer();
  addEinkDivider(root);
  root.addSpacer(6);
  const bottom = root.addStack();
  bottom.layoutHorizontally();
  addText(bottom, data.sourceUpdated ? shortDateTime(data.sourceUpdated) : "接口时间未返回", 10, Font.boldSystemFont(10), einkMuted(), 1);
  bottom.addSpacer();
  if (data.price !== null) addText(bottom, `${fmt(data.price, 2)} 元/度`, 10, Font.boldSystemFont(10), einkMuted(), 1);
}

function metricRow(parent, label, value, money) {
  const box = parent.addStack();
  box.layoutVertically();
  addText(box, label, 10, Font.semiboldSystemFont(10), rgba("#FFFFFF", 0.68), 1);
  addText(box, value, 14, Font.boldSystemFont(14), Color.white(), 1);
  if (money !== null) addText(box, `${fmt(money, 2)} 元`, 10, Font.mediumSystemFont(10), rgba("#FFFFFF", 0.66), 1);
}

function addEinkRoot(widget, padding, radius) {
  const root = widget.addStack();
  root.layoutVertically();
  root.backgroundColor = einkBg();
  root.cornerRadius = radius;
  root.setPadding(padding, padding, Math.max(8, padding - 2), padding);
  return root;
}

function addEinkHeader(parent, left, right) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  addText(row, left, 11, Font.boldSystemFont(11), einkInk(), 1);
  row.addSpacer();
  addText(row, right, 11, Font.boldSystemFont(11), einkMuted(), 1);
}

function addEinkDivider(parent) {
  const img = parent.addImage(drawEinkDivider(150, 1));
  img.imageSize = new Size(150, 1);
}

function drawEinkDivider(width, height) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.setFillColor(einkInk());
  ctx.fillRect(new Rect(0, 0, width, height));
  return ctx.getImage();
}

function addBalanceBar(parent, balance) {
  const ratio = balanceRatio(balance);
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const bar = row.addImage(drawBalanceBar(ratio, 98, 14));
  bar.imageSize = new Size(98, 14);
  row.addSpacer();
  const percentBox = row.addStack();
  percentBox.size = new Size(40, 14);
  percentBox.layoutHorizontally();
  percentBox.addSpacer();
  addText(percentBox, Math.round(ratio * 100) + "%", 13, Font.boldSystemFont(13), einkInk(), 1);
}

function addMoneyBar(parent, label, value, fullAmount) {
  const ratio = moneyRatio(value, fullAmount);
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const labelBox = row.addStack();
  labelBox.size = new Size(42, 13);
  addText(labelBox, label, 9, Font.boldSystemFont(9), einkMuted(), 1);

  const bar = row.addImage(drawBalanceBar(ratio, 66, 13));
  bar.imageSize = new Size(66, 13);

  row.addSpacer();
  const amountBox = row.addStack();
  amountBox.size = new Size(34, 13);
  amountBox.layoutHorizontally();
  amountBox.addSpacer();
  addText(amountBox, compactMoney(value), 10, Font.boldSystemFont(10), einkInk(), 1);
}

function addMoneyBlock(parent, label, value, ratio, color) {
  addText(parent, label, 9, Font.boldSystemFont(9), einkMuted(), 1);

  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const bar = row.addImage(drawStateBar(ratio, 98, 13, color));
  bar.imageSize = new Size(98, 13);

  row.addSpacer();
  const amountBox = row.addStack();
  amountBox.size = new Size(42, 13);
  amountBox.layoutHorizontally();
  amountBox.addSpacer();
  addText(amountBox, compactValue(value), 11, Font.boldSystemFont(11), einkInk(), 1);
}

function drawBalanceBar(ratio, width, height) {
  return drawStateBar(ratio, width, height, statusColor(ratio));
}

function drawStateBar(ratio, width, height, color) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;

  const count = 10;
  const gap = 2;
  const segmentWidth = Math.max(4, Math.round((width - gap * (count - 1)) / count));
  const filled = Math.round(clamp(ratio, 0, 1) * count);

  for (let i = 0; i < count; i++) {
    const x = i * (segmentWidth + gap);
    const rect = new Rect(x, 2, segmentWidth, height - 4);
    if (i < filled) {
      ctx.setFillColor(color);
      ctx.fillRect(rect);
    } else {
      drawPixelOutline(ctx, x, 2, segmentWidth, height - 4, einkInk());
    }
  }

  return ctx.getImage();
}

function drawPixelOutline(ctx, x, y, width, height, color) {
  ctx.setFillColor(color);
  ctx.fillRect(new Rect(x, y, width, 1));
  ctx.fillRect(new Rect(x, y + height - 1, width, 1));
  ctx.fillRect(new Rect(x, y, 1, height));
  ctx.fillRect(new Rect(x + width - 1, y, 1, height));
}

function addEinkBottomRow(parent, value, label) {
  const row = parent.addStack();
  row.layoutHorizontally();
  addText(row, value, 14, Font.boldSystemFont(14), label === "CARD" ? einkInk() : einkMuted(), 1);
  row.addSpacer();
  addText(row, label, 14, Font.boldSystemFont(14), einkMuted(), 1);
}

function addEinkMetric(parent, label, value) {
  const row = parent.addStack();
  row.layoutHorizontally();
  addText(row, label, 10, Font.boldSystemFont(10), einkMuted(), 1);
  row.addSpacer(8);
  addText(row, value, 14, Font.boldSystemFont(14), einkInk(), 1);
}

function balanceRatio(balance) {
  if (balance === null || balance === undefined || !Number.isFinite(Number(balance))) return 0;
  return clamp(Number(balance) / 100, 0, 1);
}

function powerRatio(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 0;
  return clamp(Number(value) / 100, 0, 1);
}

function cardRatio(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 0;
  return clamp(Number(value) / 30, 0, 1);
}

function moneyRatio(value, fullAmount) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 0;
  return clamp(Number(value) / fullAmount, 0, 1);
}

function compactMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  const n = Number(value);
  if (n >= 100) return String(Math.round(n));
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}

function compactValue(value) {
  if (typeof value === "string") return value;
  return compactMoney(value);
}

function powerValueText(data) {
  if (data.remainingKwh !== null && data.remainingKwh !== undefined && Number.isFinite(Number(data.remainingKwh))) {
    const n = Number(data.remainingKwh);
    return n >= 10 ? `${n.toFixed(0)}度` : `${n.toFixed(1)}度`;
  }
  return compactMoney(data.balance);
}

function latestDateText(data) {
  if (data.sourceUpdated) return shortDateText(data.sourceUpdated);
  return "未提供";
}

function shortDateText(value) {
  const match = String(value).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return `${pad2(match[2])}-${pad2(match[3])}`;
  return String(value).slice(0, 5);
}

function powerColor(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return new Color("#B8645A");
  const n = Number(value);
  if (n < 20) return new Color("#B8645A");
  if (n < 50) return new Color("#C19A45");
  return new Color("#6C9B68");
}

function cardColor(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return new Color("#B8645A");
  const n = Number(value);
  if (n < 10) return new Color("#B8645A");
  if (n < 30) return new Color("#C19A45");
  return new Color("#6C9B68");
}

function statusColor(ratio) {
  if (ratio <= 0.2) return new Color("#B8645A");
  if (ratio <= 0.5) return new Color("#C19A45");
  return new Color("#6C9B68");
}

function einkBg() {
  return new Color("#D8D0B5");
}

function einkInk() {
  return new Color("#5F5B54");
}

function einkMuted() {
  return new Color("#A9A998");
}

function formatMoneyValue(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  return fmt(value, 2);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildErrorWidget(error) {
  const w = new ListWidget();
  w.backgroundColor = einkBg();
  w.setPadding(0, 0, 0, 0);
  const root = addEinkRoot(w, 13, 28);
  addEinkHeader(root, "○ CAMPUS", timeText(new Date()));
  root.addSpacer(7);
  addEinkDivider(root);
  root.addSpacer(8);
  addText(root, "更新失败", 24, Font.boldSystemFont(24), einkInk(), 1);
  root.addSpacer(5);
  addText(root, String(error.message || error), 10, Font.mediumSystemFont(10), einkMuted(), 4);
  root.addSpacer();
  addEinkDivider(root);
  root.addSpacer(6);
  addText(root, "CHECK CONFIG", 11, Font.boldSystemFont(11), statusColor(0), 1);
  return w;
}

function addText(parent, text, size, font, color, lineLimit) {
  const t = parent.addText(String(text));
  t.font = font || Font.systemFont(size);
  t.textColor = color || Color.white();
  t.lineLimit = lineLimit || 1;
  t.minimumScaleFactor = 0.72;
  return t;
}

function addPill(parent, text) {
  const pill = parent.addStack();
  pill.setPadding(4, 7, 4, 7);
  pill.cornerRadius = 6;
  pill.backgroundColor = rgba("#FFFFFF", 0.16);
  addText(pill, text, 10, Font.semiboldSystemFont(10), rgba("#FFFFFF", 0.88), 1);
}

function makeGradient(balance) {
  const g = new LinearGradient();
  g.locations = [0, 0.58, 1];
  if (UI_STYLE === "split") {
    g.colors = [new Color("#21333E"), new Color("#2E6E62"), new Color("#D6B45F")];
    return g;
  }
  if (UI_STYLE === "minimal") {
    g.colors = [new Color("#202633"), new Color("#3F5265"), new Color("#8A8D6F")];
    return g;
  }
  if (balance !== null && balance < 20) {
    g.colors = [new Color("#7A1F2B"), new Color("#C43C3C"), new Color("#F2A84A")];
  } else {
    g.colors = [new Color("#123B4A"), new Color("#18706E"), new Color("#E0A838")];
  }
  return g;
}

function errorGradient() {
  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [new Color("#3A2531"), new Color("#8B3030")];
  return g;
}

function shortDateTime(value) {
  if (!value) return "";
  return value.replace(/^\d{4}-/, "").slice(0, 14);
}

function timeText(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function num(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function rgba(hex, alpha) {
  return new Color(hex, alpha);
}

function nothingWidgetImage(model) {
  const ctx = new DrawContext();
  ctx.size = new Size(170, 170);
  ctx.opaque = true;
  ctx.respectScreenScale = true;
  ctx.setFillColor(new Color("#F5F4EF"));
  ctx.fillRect(new Rect(0, 0, 170, 170));
  const images = {};

  function glyph(char, display) {
    return NOTHING_GLYPHS[display ? "doto" : "mono"][char];
  }
  function width(value, size, display, tracking) {
    const text = String(value);
    return Array.from(text).reduce((sum, char) => {
      const g = glyph(char, display);
      return sum + (g ? g.advance * size : size * (/[^\x00-\x7F]/.test(char) ? 1 : 0.6));
    }, 0) + Math.max(0, text.length - 1) * (tracking || 0);
  }
  function text(value, x, y, size, options) {
    const opt = options || {};
    const chars = Array.from(String(value));
    let actualSize = size;
    let tracking = opt.tracking || 0;
    const measured = width(value, size, opt.display, tracking);
    if (opt.maxWidth && measured > opt.maxWidth) {
      actualSize *= opt.maxWidth / measured;
      tracking *= opt.maxWidth / measured;
    }
    if (opt.right) x -= width(value, actualSize, opt.display, tracking);
    const ascent = Math.max(0, ...chars.map(char => {
      const g = glyph(char, opt.display);
      return g ? -g.top * actualSize : actualSize;
    }));
    for (const char of chars) {
      const g = glyph(char, opt.display);
      if (!g) {
        ctx.setFont(Font.systemFont(actualSize));
        ctx.setTextColor(new Color(opt.muted ? "#65645F" : "#151515"));
        ctx.drawTextInRect(char, new Rect(x, y, actualSize * 1.2, actualSize * 1.5));
        x += actualSize * (/[^\x00-\x7F]/.test(char) ? 1 : 0.6) + tracking;
        continue;
      }
      const key = (opt.display ? "d" : "m") + (opt.muted ? "s" : "p") + char;
      if (g.primary) {
        if (!images[key]) {
          images[key] = Image.fromData(Data.fromBase64String(opt.muted ? g.secondary : g.primary));
        }
        ctx.drawImageInRect(images[key], new Rect(
          x + g.left * actualSize, y + ascent + g.top * actualSize,
          g.width * actualSize, g.height * actualSize
        ));
      }
      x += g.advance * actualSize + tracking;
    }
  }
  function bar(ratio, x, y, w) {
    ctx.setFillColor(new Color("#DEDDD6"));
    ctx.fillRect(new Rect(x, y, w, 3.33));
    ctx.setFillColor(new Color("#151515"));
    ctx.fillRect(new Rect(x, y, w * Math.max(0, Math.min(1, ratio)), 3.33));
  }
  function divider(x, y, w, h) {
    ctx.setFillColor(new Color("#DEDDD6"));
    ctx.fillRect(new Rect(x, y, w, h));
  }
  function amountWithUnit(value, unit, x, y, size, maximum) {
    const valueWidth = width(value, size, false, 0);
    const limit = maximum || 142;
    const actualSize = Math.min(size, size * limit / Math.max(1, valueWidth));
    text(value, x, y, actualSize);
    if (/^-?\d+(\.\d+)?$/.test(String(value))) {
      text(unit, x + width(value, actualSize, false, 0) + 3, y + Math.max(0, (actualSize - 10.67) * 0.7), 10.67, { muted: true });
    }
  }
  function footer(value, unit, label, y) {
    amountWithUnit(value, unit, 14, y, 10.67, 74);
    text(label, 156, y, 10.67, { right: true, muted: true });
  }

  ctx.setStrokeColor(new Color("#151515"));
  ctx.setLineWidth(0.8);
  ctx.strokeEllipse(new Rect(14, 18, 6, 6));
  text(model.kind === "campus" ? "CAMPUS" : "FLOW", 25, 17, 10.67);
  text(model.time, 156, 17, 10.67, { right: true, muted: true });
  if (model.kind === "campus") {
    text("POWER", 14, 39, 10.67, { muted: true });
    const hasUnit = model.power.endsWith("度");
    const amount = hasUnit ? model.power.slice(0, -1) : model.power;
    text(amount, 14, 60, 32,
      { display: true, maxWidth: 64, tracking: -1.12 });
    if (hasUnit) text("度", 14, 92, 10.67, { muted: true });
    else text("元", 14, 92, 10.67, { muted: true });
    bar(model.powerRatio, 14, 110, 65);
    divider(90, 54, 0.67, 60);
    text("CARD", 101, 39, 10.67, { muted: true });
    text(model.card, 101, 60, 32, { display: true, maxWidth: 55, tracking: -1.12 });
    text("元", 101, 92, 10.67, { muted: true });
    bar(model.cardRatio, 101, 110, 55);
    divider(14, 118, 142, 0.67);
    footer(model.use, "度", model.day, 128);
    footer(model.balance, "元", model.date, 145);
  } else {
    text("LEFT / GB", 14, 38, 10.67, { muted: true });
    text(model.remaining, 14, 57, 32,
      { display: true, maxWidth: 142, tracking: -1.12 });
    const ratio = Math.max(0, Math.min(1, model.ratio));
    const segmentWidth = (112 - 2 * 9) / 10;
    for (let i = 0; i < 10; i++) {
      const x = 14 + i * (segmentWidth + 2);
      ctx.setFillColor(new Color("#DEDDD6"));
      ctx.fillRect(new Rect(x, 99, segmentWidth, 6));
      const fraction = Math.max(0, Math.min(1, ratio * 10 - i));
      if (fraction > 0) {
        ctx.setFillColor(new Color("#151515"));
        ctx.fillRect(new Rect(x, 99, segmentWidth * fraction, 6));
      }
    }
    text(Math.round(ratio * 100) + "%", 156, 98, 10.67, { right: true });
    const labelY = model.warning ? 115 : 125;
    divider(14, labelY - 10, 142, 0.67);
    divider(85, labelY - 1, 0.67, 32);
    text("TODAY", 14, labelY, 10.67, { muted: true });
    text("TOTAL", 97, labelY, 10.67, { muted: true });
    amountWithUnit(model.today, "GB", 14, labelY + 16, 16, 43);
    amountWithUnit(model.total, "GB", 97, labelY + 16, 16, 40);
    if (model.warning) {
      ctx.setTextColor(new Color("#65645F"));
      ctx.setFont(Font.systemFont(8));
      ctx.drawTextInRect(model.warning, new Rect(14, 152, 142, 12));
    }
  }
  return ctx.getImage();
}

const NOTHING_GLYPHS = {"doto":{"-":{"left":0.0,"top":-0.3888888888888889,"width":0.6018518518518519,"height":0.3888888888888889,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAAAqCAYAAADsxDbcAAAAb0lEQVR42u3QwQnCQBAF0B+xhS3BJjxYi2BbSTNpwxKmiVw8LBJlLyGX904z8BmGP+WjtfbKvrWq3l3uluSxF6yqpd8PzA79OurazfOPzDNJf/j+J7t87UdlR38dcglKUIISlAAAAAAAAAAAAJxjA5oVHheFyZy4AAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAAAqCAYAAADsxDbcAAAAcElEQVR42u3QsQ2DQBAEwMVyK27CgVsByXZVPAGt0AbNkDh4WWB9gpzMRHfS6nTaLh/vV//MvmUs81rlbkkee8GxzFO9n5ht+rXVtZrLQWZIUh++/8hOX/tZ2dZfm1yCEpSgBCUAAAAAAAAAAAD/sQEZkB4XiJEuRAAAAABJRU5ErkJggg=="},".":{"left":0.0,"top":-0.18518518518518517,"width":0.6018518518518519,"height":0.26851851851851855,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAAAdCAYAAAD1uwHJAAAAkklEQVR42u2YwQkCMRAA58QW9mEBNuFD7m0VgjXYjQfWkjZSwjZxDSSfwEGUme8uecwnwy4cSERcgXtrlpkbk3A++P0b8OnMppFwQpSgBCUoQUSkyzKYw6/OqGRmHcnmiHgAl8ZqzcwyYzb3UvgJ1MFsfgNrY+8LFL9IO0EJSlCCiMgvZbPXZrw22wlKUIIS/p4dMo4edfExiNMAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAAAdCAYAAAD1uwHJAAAAlElEQVR42u2YsQ3CMBAALyhLMABLUCBqlggSyQhMYyPFq3gNL8MCdmMpkkF37b9cXOPTTxzIti4X4FabhZg+DMJ88PtXIDZmw0g4IUpQghKUICLSZOrM4VdjlENMpSebt3V5AOfKagkx5RGzuZXCT6B0ZvMbuFf2diD7RdoJSlCCEkREfimbvTbjtdlOUIISlPD3fAGx+h51gA95TwAAAABJRU5ErkJggg=="},"0":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA1klEQVR42u3bwQnCMBxG8a/iChnBJTy4ih46loIu4zIZQs+C7cE02MLvXVPCn3fJI6RDOlJKOSe5f1urtQ5ZCbuABBJIIOGDfef9n0lGmgFsieGHFD4kOU2k8K0hsbvs2+t0OCa5Tqy1DNtrX51AAgkkkAAAi2RzKeU18c2l1vpY09BLz+p0IIEEEkiYuU8YZ26M18aWZgUgm2WzTiCBBBJks2wGIJtls04ggQQSZLNsBjzr9aw3nvXqBBJIIAEA0JTNW0nhNf0r/bcUdkSSQAIJJADNvAHzNEXPcEjfrQAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA1ElEQVR42u3bQQrCMBgF4VfxKl7ChVepi/ZUrWAv47V0LdgujMEUvtmmhJ/ZZAhpl4qMQ98nuX9am+alSyMcAhJIIIGEN46V938kGWgGsCe6L1L4lOSyksK3gsSusm+t0+GcZF5ZKxm21r46gQQSSCABAH6SzePQP1e+uU7zsrQ09K9ndTqQQAIJJGzcJwwbN8atsadZAchm2awTSCCBBNksmwHIZtmsE0gggQTZLJsBz3o9641nvTqBBBJIAAAUZfNeUrilf6X/lsKOSBJIIIEEoJgXJSJFz+Zx/CIAAAAASUVORK5CYII="},"1":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA7klEQVR42u3bwYkCQRCF4TdiCh3CJuFhU1HQsFZYU9mDSRhCBaFnYXvRkZHR/f5rF03zX+pRVA+ZkNbaOsn3b2dVNWQmLAISSCCBhCuWE99/TLKjGcArMYyIwh9JPjtReD+29tW6wyrJV+ds/0CtnEACCSSQAACzjs2ttXOnZlNVh5g2a5EkkEBC/uW0effHxDimzQBMm2NJQ04ggQQSxOZY0gAAsVmLJIEEEkgQmwHMIDG+7VpvJloB1iJJIIEEEgBg7mu9207NT1Wdpv4Nd2ftTW8dE5t78XaT5PSE33D31N76Vi2SBBJIIAEYzwU1s0mcKWrFaAAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA60lEQVR42u3bwQnCQBCF4RexFZvwYCsRjFUlgmnFg01YjJ4FVzQSSfT7rzssy3+ZxzBbZUT2TV0nOT46a7u+ykRYBCSQQAIJdyxHvv+cpKEZwJyoBkThVZJNIQofhtbOrTusk3SFs8MHtXICCSSQQAIATDo275v6WqjZtl3fx7RZiySBBBLyl9Pm5snEOKbNAEybY0lDTiCBBBLE5ljSAACxWYskgQQSSBCbAUwgMf7sWm9GWgHWIkkggQQSAGDqa727Qs2p7frL2L/h3qx96a1DYnMp3m6TXL7wG+6d2lffqkWSQAIJJADDuQGBDkmcvbIa+wAAAABJRU5ErkJggg=="},"2":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA+0lEQVR42u3bzU3DUBBF4XGUFqYEmsiCVoJEyiISaYUFTaSEKQK2NoojQP55hu/sLI+lp2PJczUad/FDMvMYEa+37lVVt0Tt1OwCJJBAAgkD9r945j0iTivXAsBsdL3Y+jxS81ZV15YOPfVZ+93hZaTmKSKujb28Sc8qJ5BAAgkkAMB3YvOWyMyPscRYVRfdQYskgQQSYvlpcwuc7kysAaDd2GxJQ04ggQQSxGZLGgD+aWxeM95qkSSQQAIJf2S3GYC13k1/GLe01qtFkkACCSQAQLOxOTMfIuIxbg9azzEcys5Vu/rfcIc7tecv13PV+htOTiCBBBKA+fkE3g5YHHIpzV4AAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA+klEQVR42u3bUWqDUBCF4WPJVrKJPnQrFnpdlQbqVvrQTWQx6WsSYmiLxmv7/W/iCJdfcA7D2OSHdKVtk7zfutcPY/OI2rl5CkgggQQSLtj94pnPJGXlWgBYjOYstr5N1Hz0w3is6dBzn/W8OwwTNa9JjpW9vFnPKieQQAIJJADAd2LzluhKe5pKjP0wjrqDFkkCCSTk8dPmGih3JtYAUG9stqQhJ5BAAglisyUNAP80Nq8Zb7VIEkgggYQ/stsMwFrvpj+MW1rr1SJJIIEEEgCg2tjclXaf5CW3B62HXA5ll6pd/W+45zu1h6vrpWr9DScnkEACCcDyfAFccFgcFz/cJwAAAABJRU5ErkJggg=="},"3":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAABAklEQVR42u2awQ3CMBAEN4gWrgSa4EErIJGyiASt8KCJlHBFwIeHkWxkizhgMvNKxCmy5uPltJ2emNldcQ7ufgnm9pLOsUF378L3irNZZ81lJUACEpCAhBfWwXOfmLlF3vvM79eazT0rAEAxXYuHNrNj4qeru4+f3A4tcUr9d5A0khMIS0hAAhIAAP4xNpdsm7kdkIAEJCBB822bv03JthkAoM3YXKukwRWJBCQgAQmNx+ZaJQ0AAEoadJvJCUhAAhIWum0ugW4zQOXEOHVVttVa76RVWVHrJScgAQlIAABY6KLVzDaSdor3CIY5Zn9hn7B9E1uHmWa5IpGABCQgAaA+DyeiVsJ8Rt6oAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAABBUlEQVR42u3aQY6CQBRF0U/HrfQmHPRWMLFYFZjIVnrgJlyMThzQCXQgTdGWnjuC+EMqd1LPn1fFgybVtxjn0HZ9P5irI+I8Nth2fTV8zzg766xz+QiQQAIJJPxgN3hOEzOXkfc08/u5ZueeFQAWU5V46CbVx4mfvtuuv/7ldiiJbuq/Q0Rc5QRhiQQSSACAV4zNS7bNbgcSSCCBhNhu2/zfLNk2A0CZsTlXScMVSQIJJJBQeGzOVdIAACUN3WY5gQQSSHjTbfMSdJuBzIlx7apsqbXeVauyodYrJ5BAAgkA8KaL1ibVnxHxFeM9gtMWs8+wT9j/EltPG826IkkggQQSgPzcAaX1VsIlFdLMAAAAAElFTkSuQmCC"},"4":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA6ElEQVR42u3aywnCQBRG4T9iC1OCTbiwFV1YloI2YzNThK4FI/gYMtHvbDOQcLKYw+UO6YRSyjbJ6dGzWuvQ8t2LgAQSSCDhjmVH33JJsvdLAEzN0DiFV0k2Iyl8fPfs3G6HdZLDyLPjB2d1AgkkkEACAHSbza2mwqbNrkgSSCAh8542t5oKmzYD6CubSynXkTO7Wus5ljR0AgkkkPCf2bx/krOxpAFANo9k8yt52/DsVxPfFUkCCSSQ8IVsfiVvW52dOvEB+wlpPmj92bXeNFoBdkWSQAIJJACAbJbNslknkEACCUAH3AAFCEzaKSz7/wAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA5klEQVR42u3awQnCQBQG4T9iKzbhwVbiYVOVEUwztqVnwQhRF1f95pqFhMlhh8fr0ghD6fskp3vPDuPU1Xz3KiCBBBJIuGHd0LeckxS/BMCn6Sqn8CbJbiaFj8+e/bbbYZtknHl2fOGsTiCBBBJIAIBms7nWVNi02RVJAgkk5LunzbWmwqbNANrK5qH0l5kz+8M4TbGkoRNIIIGE/8zm8iBnY0kDgGyeyeYleVvx7FsT3xVJAgkkkPCGbF6St7XOfjrxAfsJqT5o/dm13lRaAXZFkkACCSQAgGyWzbJZJ5BAAglAA1wBad9M2qs3LuUAAAAASUVORK5CYII="},"5":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAABAUlEQVR42u3awYnCUBCH8cliC6+EbWIPtqKgZSmsrXiwCUuYIvTiIUKyRMiLyfr7TnkwhOG7zJ9hmnhQSrlFN9vMPLXqNhHx21WYmU37XbF2UK9D+QqQQAIJJDyxan3ve2ouHe/9wP/Xqh3aKwC8TNOKoruemnNmXj9lOhz68nhEXOUEYYkEEkgAALF53A1uzW2z6UACCSSQMMNt8yvU2jYDwHxi8zvjrSMNOYEEEkj4J0catXCkAaB+bF4SYrOcQAIJJEwYm5eE2Aw4641avS71rHfUXo1IEkgggQQAGHPRWkr5joh1dN8nHKeoncM+4eeP2HqcqNaIJIEEEkgA6nMHBj1pQKrzPnEAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA/UlEQVR42u3aQQqCYBCG4TG6Spdo0VUM0lNpkFdp0SU8TG1aGGgY+JvW8678YZDh3czHMFk8KYv8Hv0cq7ppOnV5RFz6Cqu6ybrvhLWjeh3LJkACCSSQ8MK2810M1Nx63sXI/6eqHdsrAHxM1omip4Gaa1U37b9Mh3ooj0dEKycISySQQAIAiM3TbnBTbptNBxJIIIGEBW6bPyHVthkAlhObvxlvHWnICSSQQMKPHGmkwpEGgPSxeU2IzXICCSSQMGNsXhNiM+CsN1L1utaz3kl7NSJJIIEEEgBgykVrWeS7iDhE/33CeY7aJewT9m9i63mmWiOSBBJIIAFIzwPRBGlAc1GerwAAAABJRU5ErkJggg=="},"6":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA9klEQVR42u3bwU0DMRCF4beIFlwCTXBIK0RKyiIStMIhTaQEFwHXIGEOkUdZ2O+/erQa/St5nix7SSGttZckbz+t9d6XW2tn8xCQQAIJJHzjsfj75yTHgloAKGO5IQo/JdkN4u1pK9PhOcnrYO0kJwhLJJBAAgD819jcWvsc1Ox77++mgxFJAgkkZJunzcdfToEBQGyeEZtd0pATSCCBBLHZJQ0AG43N94y3VRHfiCSBBBJImBCb1xBvnYwD9YnxMKj56L1f1tT07F6vN8bRVd19ksvKft7UXo1IEkgggQQAuNdruKrav/YarqrWiCSBBBJIAOr5Av2KVl6DNatiAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA9UlEQVR42u3bQWrDMBCF4eeSq/QSXfQqDtQ5lR2Ir9JFLpHDtNsWqi6Chrj19281mOE3aB5CGlLIaRrHJJef1uZlHe6t7c1TQAIJJJDwjUPx969JpoJaAChjuCMKPyd5bcTb816mw0uSpbF2lhOEJRJIIAEA/mtsPk3jR6PmOC/rajoYkSSQQEL2edo8/XIKDABic4/Y7JKGnEACCSSIzS5pANhpbH5kvK2K+EYkCSSQQEKH2LyFeOtkHKhPjG+Nmvd5WW9barp3r183xtZV3WOS28Z+XtdejUgSSCCBBAB41Gu4qtq/9hquqtaIJIEEEkgA6vkEe+xWXjvV0zEAAAAASUVORK5CYII="},"7":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA7UlEQVR42u3awWkCURCA4VmxhSnBJjzYigEtSyG24sEmtoQpIrnksMI+2CUY4/r9JxcHefwH5/dhFz9k5leM81FVl8HcPiI+xwarqhs+P3B20lmnsgqQQAIJJNyxHrw+NmZuI8/HiZ//qNmpZwWA2XSveOjMPDTeulZV/5vt8EqcWr8dIqLXCWKJBBJIAIAlZvOc22bbgQQSSCAh/u62+dnMuW0GANlsReoEEkggQTYDwEKz+ZkpbEWSQAIJJPzjbJbCwMKLMTM3EbFrVOD5Xb4Yt9H+W+3ZitQJJJBAAgDIZtksm3UCCSSQALwP37mOPXc6xAb/AAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA60lEQVR42u3aTQqCUBRA4Wu0lTbRoK0Y9FyVCrmVBm2ixdSkgYEPlOhH/c4o6RKPM+ieHhXxpErlPYY51k3X9ebKiDgPDdZNV/SfPzg76qxj2QRIIIEEEl7Y9l6nzMx14DmN/PxPzY49KwBMppjjoatUnjJvXeqmu72zHeZEk/vtEBE3nSCWSCCBBABYYjZPuW22HUgggQQS4nu3zb9mym0zAMhmK1InkEACCbIZABaazb9MYSuSBBJIIOGPs1kKAwsvxiqVu4g4ZCqwXcsX4z7yf6ttrUidQAIJJACAbJbNslknkEACCcB6eADR8T13H/sWGwAAAABJRU5ErkJggg=="},"8":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA50lEQVR42u3awQ2CYAyG4WJcgRFcwoOraCJjSaKreHAJR+gQesUEiBrEn+R5r5SkeTn0S2kVH1LX9T4izn3PMrOao3ZqVgESSCCBhBfWX7xzi4jmz7UA8DOqTmw9DtRcM/NeUtNT99qdDqeBmkNE3Av7eJP2KieQQAIJJADAm7H5MZTCMvNSWGyetFfTgQQSSCAhhvcJzcgWuDSW1CuApcZmRxpyAkgggQRHGgBg22xEkkACCSTYNgNw1uus11mvnEACCSQAQEH3CZuI2EX/HUE7R20Jv+G2I7G1nanWiCSBBBJIAH7PE8saY8OPD+GhAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAAA5klEQVR42u3aQQqCYBCG4TG6Spdo0VUMslOpkFdp0SU8TG0N/KVC7Reed+sIw+tiPsYp4kuuVVlGxG3sWd10xRq1c7MLkEACCSS8sf/hnUdEVH+uBYDFKAax9ZKouddN1+fU9Ny9DqdDk6g5R0Sf2cebtVc5gQQSSCABAD6Mzc9UCqubrsssNs/aq+lAAgkkkBDpfUI1sQXOjS31CmCrsdmRhpwAEkggwZEGANg2G5EkkEACCbbNAJz1Out11isnkEACCQCQ0X3CISJOMX5H0K5Rm8NvuONEbG1XqjUiSSCBBBKA5XkBfHRjw1vT6hQAAAAASUVORK5CYII="},"9":{"left":0.0,"top":-0.6851851851851852,"width":0.6018518518518519,"height":0.6851851851851852,"advance":0.6018518518518519,"primary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAABCUlEQVR42u2awQkCMRQFX8QWUoJNeLAVBbcsF7QVDzaxJfwi9LrCZtloNolm5mqEzwhm+MQpEu/9UdJ16jMzcznOpmYjQAISkICEN7YffOchqSt8FgBgNdwoW8+BM3czG2oaOvWs49vhEjhzkjRU9uMlnZVOQAISkIAEAICF2fwMVZiZ3TKkcMxmOums3A5IQAISkDCzT+hmtsA5iNk2l54VAFrI5tKPNCJnIJvpBCQgAQmtPNKIgWwGgHqyWXU80iCb6QQkIAEJtWVzDZDNAH9ejN77naSDppeyfSt/jHuFn+v2XJF0AhKQgAQAgB96n7A4b0um8NrZHJO3xVKYKxIJSEACEgC+5gX7GlYVeOJsQgAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAAEEAAABKCAYAAADkMDmGAAABCElEQVR42u2aQQrCMBQFX8SreAkXXqWC6amaQnMVF16ih9FthaY0mjbRzGyN8BnBDJ8YRdLappE0zH3WOW/2OJuagwAJSEACEt44fvCdhySb+SwAwGaYSbbeAmfunfNjSUOnnnV6O7jAmauksbAfL+msdAISkIAEJAAArMzmZ6jCOuf9Dikcs5lOOiu3AxKQgAQkLOwT7MIWeA9its25ZwWAGrI59yONyBnIZjoBCUhAQi2PNGIgmwGgnGxWGY80yGY6AQlIQEJp2VwCZDPAnxdja5uTpIvml7J9LX+MZ4Wf6/ZckXQCEpCABACAH3qfsDpvc6bw1tkck7fZUpgrEglIQAISAL7mBXl8VhX/B/XsAAAAAElFTkSuQmCC"}},"mono":{" ":{"left":0.0,"top":0.0,"width":0.6060606060606061,"height":0.0,"advance":0.6060606060606061},"%":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAEiElEQVR42r2YbWiWZRTHf89edPOhXNYJpoFbr04Qv4QmYaRkK53aqJAoiKTQCnqhQss2s+xlkRGEZUjSUrAspDdNeqEPBaO+NPuwzSINAoP+8y3d42ht9uUM7i7u535eup+db9fh3If/fa5znfM/J0MBMbNqYDlwKzAfmAHUAgJ+AvYBuySdpAKSKQDuZuB14LICfk4Dm4EtkkYnBKCZbQSeKdHfF0C7pFxFAZrZo8CrZfrcByyXdC4NgFUx4OYAXYF6BHgDWAA0APVAC7AeGAxslwEPVCyCZrYXaI+o/gKWSfouT7SnAweAORH1n0CTpLOpRtDMpvmLjcqafOAAJB0FVgJRMBcDSytxxQuBmsi5T9J7hZxIOgLsCNSLKwGwJTgfKMHX/gK+UgF4QXD+rQRfoe20SgAMH825tIp+WgCPBecZJfiaGZyPVwJgX3BeVIKvpQV8pQLwWy/K4zLfzK4rglA0A/cE6q9KAWJmGTPLJAJ0RvJRYLPbzFoSHDcCHwNTIuo/gM9LALcC6AXuKqaTzAZ+BCZF1EPAVmAPcMij3OQF+nHAAjdrJb1VBLAlzoLmueoIcJWkkUJk4WHgtTLT5lNgZRJZMLOFDiwuff7zc9VxDnK53PfZbBbg+jLo1u3RCATArs5mszuA52Ne/QkHvT2Xy40US1jbnLA2FQA2BLwAdMURVmdIzwK3xHx7xm/rFUmnSi6uZlbjjts9Vy7xyB9zyr8f2CnpeMy3VzrpXRVTMYadwr0oaXBCq7+ZzQQ6gbtj0mgEeBt4zpnQxLUnLzkbgPuCKgAwCuwCNjn7mbj+aWYXAeuAB51th/38Q6BT0kCqU10RwKYCjwGPAOflmU+eltRbkbEzAVgWeAh4IoaiAXwDbJDUU9G5OAZYHbAWeNJpfSg9QIekrydkcI8AqwVWAx15KFivA/tsojcL1cCdXsuaY0wGgI3AB3GtzVvaHcC1/n09cNKp2JdAt6TfyxncM8BtXv1n5aH3m7xAx3WOucCbPkcnyT/ANuApSaeLnYvbvCfOjbE/6n10e0K/XQW8A9SVcJN9wE1x0czEPILDQGNgNwi8BGyVNJyQEjd6aakpI90GgHlhJEPCOuxNf1xOectqlrSlALgGoDsG3F6gFbgQmOzE417gl8BuVtw+KO6KJzlh/QR4WdKJIl96p+fluIwBqyV157GfArwPtAXtcLaknws9kipJYyXWyF+BSyOqLknriyj4B4P942ZJHXm3W37VY2Wwlyi4s56zhVYmQzF2ixPXb2VKOFT1lLASTlyZpAWw7JWJc8K/I6oGM6tKG+D/WZkkfp8WwLJXJr4ArY2oTkbbZloAwzXHAjObnMbKJBWA3qKihXcqsKZIXrkuaWWSVgTx/huVLjNrTQBXD+wGLg/Iw86KDE1mdj7QD0wPusm7Dv6gz8+NwBKP3BWBm22S7q/kVHeDL43KIQv9ThbORJXVaQLM5XKHs9nsIWBFiSD7gda4AT7NHBx/MHucqP5QhPmoE9Zr8jHrimwWIle+yNce45S/zil/v7/WbkmJXedfUNOKvAEK9aQAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAEuUlEQVR42r2YfWhXZRTHPz+36aaUy15gGrj16oTh2GImsUjJVjqtUWFRcUnuRSuIohczc2bvq4wgLOt5lJ4UfCmkN016IaJgFPFr649tFmkQGNTUmU6Ha9o/Z3B5uL97f/d27+/895x7nnO/nOd5zvmekyNCPNcpA5YAtwJzgRlABfA38DOwB9imtBkiA8lFgLsJeAO4NMLPceA5YIPSZqwkAD3XWQc8HdPf50CH0uZkpgA913kYeC2hzz3AEqXN2TQATggA1wB0WepR4E1gHlANVAH1wBPAoGW7GLg/swh6rrMb6PCp/gEWK22+KxDt6cA+oMGn/guoVdqcSjWCnutMkxfrlxWFwAEobQ4BNwN+MBcBi7I44lag3LfuU9rsiHKitDkIbLHUC7IAWG+t98XwtTfCVyoAz7PWv8fwZdtOywKg/WjOppX00wJ42FrPiOFrprU+kgXAPms9P4avRRG+UgH4rSTlcZnruc61RRCKOuBeS/1lHCCe6+Q818mFAhRG8qFls91znfoQxzXAR8Bkn/pP4LMY4JYCPcDdxVSS2cBPwESfehjYCOwC9kuUayVBPwpcaLlZqbR5uwhgC4UFtYjqIHCl0ma0YC1W2vQBj1vqKaL7UajVCDAgNdsG9wnwTgSwVs91vhH20+L7VAcs99uWBTnI53u/b25qBLguAd263R8BC9hVzU2NW4DnA179UYmmyud7R4slrO1CWGsjgA0DLwBdQYRVGNIzwC0Be08ArwOvKm2OxU6unuuUi+MOOY6LJfKHhfLvBbYqbY4E7L1CSO+ygOs0IhTuRaXNYEmzv+c6M4FOwAm4RqPAZuBZYUKlK0+SctYAnpUFAMaAbcB6YT+lq5+e61wArAIeELZt1/MPgE6lzUCqXV0RwKYCjwAPAecU6E+eUtr0ZNJ2hgCbAjwIPBZA0QC+BtYobboz7YsDgFUCK4HVQutt6QbWKm2+Kknj7gNWIRl+bQEK1iPAPi31ZKEMuEtyWV2AyQCwDng/qA/2XKcVuBO4RvZXAUNCxb4AjNLmjySNew64TbL/rAL0fr0k6KDKMQd4S/roMPkX2AQ8qbQ5Xmxf3C41cU6A/SGpoyqk3i4D3gUqY5xkH3BjUDRzAY/gAFBj2Q0CLwEblTYjIVfiBkkt5Qmu2wDQYkfSJqwjUvTH5ZiUrDqlzYYIcNWACQC3G2gDzgcmCfFwgV8tu1lB86CgI54ohPVj4GWlzdEiX3qn3MtxOQMsV9qYAvaTgZ1Au1UOZyttfgkjrKeBBqXN6mLBiTjW+pVC4OQ/J4E7gN8sfnpP6HRLNp9JwF4u8alOyZ2NGpkMB9gtiASYQOymqjvGSDh0ZJIWwMQjE+GEp32qas91JqQN8P+MTEL3pwUw8chEBqAVPtWQv2ymBdAec8zzXGdSGiOTVABKifIn3qnAiiJ55aqwkUlaEUTqr1+6PNdpCwFXBWwHLrPIw9ZMmibPdc4F+oHpVjV5T8D3Sv9cAyyUyF1uudmktLkvy67uehkaJSEL/UIWTkSOPpJKPt97oLmpcT+wNCbIfqAtqIFP8w6OP5hdQlR/KMJ8TAjr1YWYdSaTBd+Rz5exxzjlrxTK3y+v1ShtQqvOfzUZj3ggpyBkAAAAAElFTkSuQmCC"},"-":{"left":0.0,"top":-0.30303030303030304,"width":0.6060606060606061,"height":0.30303030303030304,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAAQ0lEQVR42mNkIBKIioquYGBg8GCgHlB7/fr1K0KKWEgwkIeBgYGfig5kopqigQSjDhwFo2AUjIJRMApGwSgYBYMaAACuTwUpmvNXPQAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAYAAAD/Rn+7AAAAQ0lEQVR42mNkIBKkpsSvYGBg8GCgHlCbPWfhK0KKWEgwkIeBgYGfig5kopqigQSjDhwFo2AUjIJRMApGwSgYBYMaAAD6wwUpwS1N+wAAAABJRU5ErkJggg=="},".":{"left":0.0,"top":-0.12121212121212122,"width":0.6060606060606061,"height":0.13636363636363635,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAJCAYAAABADm7+AAAAsElEQVR42sWTIQoCYRBG32owDMa/iFs9gsEoeAeTJ/AAVqNRwSwewComw55ADIJNBNPXDH8wWTa6rDgrO3Ue37wZmIQKKoTQA+bACDDgAqwkbb3ZSQVyA+AAtD+015KmnvymU64FZEAoQPpmdooxXn+d0XAecAikJczEM8ArmH7BdOsUvFfE/E3wCNxKmE1tgpJewBh4FiBLSfvavhggxvgws13+yZ186TMwk7Tw5r8By6AocJwDNdoAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAJCAYAAABADm7+AAAAuUlEQVR42sWToQoCQRCGv9NgEKNFvGo+7uCCUfAdTFq0+QBWo1HBtAuyD2AVk8EHWDyDYBPBFzCaLBc9TpyVnTof/3wzMAEOajIedYA50AfqwAVYKW2MNDtwINcF9kDjQ3uttJlK8qtCuRpwBJoFSJrE0cna7PrrjIrwgD0gLGGGkgFSwfALpu1T8O6I+ZvgAbiVMBtvgkqbFzAAngXIUmmz8/bFANZmjySOtvknt/Klz8BMabOQ5r8BzhwmnG3Su8UAAAAASUVORK5CYII="},"/":{"left":0.0,"top":-0.8181818181818182,"width":0.6060606060606061,"height":0.9242424242424242,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAA9CAYAAADf5StFAAACb0lEQVR42s3Zy0sVYRzG8a9aiQ1d4SGzGxVFtHAhFARBEQTdLbW/qX+monsURYRRCxcV1KIWLrKMfDCK4pRl2sKzkJdz9Fxmxt8sn5kXPvN7GGaYF0o8JG2S1NHMmq4ygVmW3QCuZFm2N8uymSzLJiqVytxSazpKnN5GYApYvSg2sNP273rrOksc4GCCA3i9FK5s4EiN7OpyizpKqnd9td7uRfEcsNX2VIQJnk9wAKPL4coEtlRvKRVLyqpPa8+ieB7YbnsywgTPJTiAF43gygK2XG/hQEk9wOkap66FAAJngCzJxmx/iAJsq95CgZK6gbNhgcApYF2SvbI9HgXYdr2FASWtqb7eYgKBk8CGJHtr+10UYC71FgKUtAq4EBYInAA2J9l722+iAHOrN3egpC7gYlggcAxQko3bfhkFONLOl0uhQEmdwKU86817gkeB3iSbAMaiAGvWa3t+xYHVH0JDedeb5wSPANuS7DPwPAqwVr3X2603T2Ah9eYClHQY2JXEU8BoCGCdem/Y/hcFOFxUvW0DJQ0Ae5L4K/AkBLBOvTdtz0YBFlpvW0BJ/cD+JP4OPAoBrFPvbdt/ogALr7dloKQDwMEk/gk8CAEELtfI7i6351EmcKSMelsCStoH9CfxL+BeCGCd6d23XYkMLKTepoGSdgMDSTwD3AkBrDO9h7Z/RAYWVm9TQEk7gENJ/Be4FQJYnV66t/fY9rdIwFLrpdHdTkl9wMfk+lmg1/Z0hAkO17iZp0XjmgGuSL0NVSxpCzCZ3Mwc0Gf7S4QJDtW47lkZuEaBa4Hplai3mae4i4UflIMsbHEdt/2pDOB/R0i1NRJNUsUAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAA9CAYAAADf5StFAAACeUlEQVR42s3aSWsUQRjG8X/GJcTgFpCIoqKgiEIOgQiCoAjivsXxXJeqjyN+gKpL3TUm7ooiIaKHHFTQgyI5KCiORBTFNRoP9iEU3c7SXTVvHZ+Zgh/v0zA13Q0Jl9FqtdGqp509PYmBN4GdwARwCZi0zs+JABqtVgENYMmC+D2w0Tr/vWhfLeEATwY4gCf/w6UG1nOyC8021RLVuwI4EMR/susQCRM8DvQG2ZR1viEF2FG9SYBGq37gYBDPA2MigMAxoC/IHlrn30gBdlxvdKDRqg84nPPRRRFA4AjQH2TT1vlXUoCl6o0KNFr1AkfFAoFDwPIge2ydn5ECLF1vNKDRamn28yYTmB0MVgbZM+v8cynASuqNAjRaLQZOiAUC+4GBIHthnX8qBVhZvZUDjVaLgFNigcBeYE2QzVjnH0kB1sucXKICjVY14HSV9VY9wT3A2iB7DUxLAebWa52f7zowuyE0WnW9VU5wN7A+yN4CD6QA8+odK1tvlcAo9VYCNFrtAjYFcQOYEgEsqHfcOv9bCvBMrHpLA41Ww8CWIP4A3BMBLKh3otl955TAqPWWAhqthoBtQfwJuCMCWFDvFev8TynA6PV2DDRabQd2BPEX4JYIIHA2J7vW7JlHSmA9Rb0dAY1WW4GhIP4GXBcBLJjeDev8V8nAKPW2DTRabQaGg/gHcFUEsGB6t63znyUDo9XbFtBotQEYCeJfwGURwGx64RP6u9b5j5KASettGWi0Wpf991245oBxEcDs5BLWO2mdn5UC7Eq9LQGNVoP8u3NFu+8bpJrgaM737lvn30kBLgNmu1FvS0Dr/DlgENgHnAde0uL7BlWsv3NLplZ4AXAWAAAAAElFTkSuQmCC"},"0":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEC0lEQVR42sWZW4hVZRTHf+fM6CR7HC+wJrVMspKkAqWYDBFNKiIqDVOioB6KQMKECgJfkqKHIiwmiAYCK7CHsiDEN8ssELp4i5IiI+yi1p8sxfbMpDPTw/kebPjW2XufvY+z4Lys9V1++7usb521arQoZjYPuANYClwNXAZMBTqBfwABPwJfAruBPZJGis5TawHsFmATsKJg/+PAa0C/pNOVA5rZbGAAuIty8jvwmKT38zTuyAnXB3wCXE956QbWJQ3ZlaZpOUAzuxH4CJiZY/J/gSFgUo7dWQr0pmm6s1mjegbcXGBn+OqYnAS2ACuBmZK6JHUDXcC1wAZgX5Mp1pvZUy2dQTOrAZ+FL43JAPC0pFM5dmFtaD8jYj4HLJG0ryjgw8AbjnmjpP6Ct/9KYA8wJ2L+IkCO5dpiM5sEbHbm2lIUDkDSEeBOYDhi7gPuLnIG7wMujeh/Dj6wJZF0IJzZmDxZBPBBR/+MpOGSbuaFcLnGyzIzuzwT0MymAzdHBjgGvF3WCYZL9bpjvifPCq5w/ON2SaNUI+86+pV5AJc4nbdXBIekQ8APzmXJBLwmohsBvqJa+TzuQKw3C3B+RHdE0mDFgF87+vlZgLMjusNUL96Ys7IApztvbtXyl6Of4QKaWZfz/J1uA6A35kXNVrDT6XTmAgJObgbkBQ+jGYFAD/BseCJ7wuO/SdLeJt1G80RY9bLLYGbdIdreCFwMTAGWA7vN7Pay49cr2KrNwGJnq7aa2ZSJBnygiW2W865fGEAzq4/3WxG5ZMIAQ/BwLKPZLxO9xW81sf0asgoTCvhcSG+Ml2HgobIBbr2C0GkwxHEvh6zBUHA7yyV9XHb88Y56rJUPkXQGeCL8yi7OWLNG55xOSRueuqmO/qwLGM7LWIHB2gE4lLXMsUzBtDYA9jj6v7MAT0R0C9oA6I15IgvwaES30Mw6Kga8ztEfzQL8NqLrAhZWDLgodrwk/ZYF6KXLVlVFZmZzgBsipv15fJH3NN1b4eqtyTt3PeJ0jztP1yIzW1bB6nUA6x3zjrzefJujfykkNsvII855PizpYF7ArY4/7MNJkxVIYj7vmF8hbxI9TdPhJEkmO9HwrUmSfJ+m6TcF4XrDGYsFsD8Bj6ZpOlIkCHjRSfDUgHfMrN/Mkpxwq4FDwBVOkw1eWFbLGHgxsHf8n2n+X5R5D/gA+A74Q9KImU2jkaG9DViHnzEDeFXS47RaaTKzVTRSb505Fms0RCNdOXd+B7BG0tmWA1ZJHwKrc6Y/6gXgtgFrm8EVrdUtoFGWKOsLT9GorwxQVa0u3Ow/kyR5k0Zeb55TBWgmJ4F+4H5Jn9Kucux5K3oVjXrxTTTqxXNplMw6gMHz6sX7w3+UXVnbGZP/AHdfKbbvFF7yAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEFUlEQVR42sWZb4hVRRTAf+/t1ktcVy2y1TLJSpIK1orNCNEkIqLSMEMKmg/NfJAwoT8EfkmKPmRhsVG0zIBNYB/KApGgD5VZIPTHrQ2SICPsj1qRpRjrpruvD2+gWubcO/fd+9wD78s5M3N/b2buOeeeU6NNMVotAG4DbgSuAC4GZgDdwF/Ab8B3wGfAbmCPdX686HNqbYDdDGwCVhScfxh4GRi0zh+vHNBoNRcYAu6gnPwCPGidf6syQKPVALAT6KM6eRZ43DrfzBpUT4C7Hng/Ee7vcP+aCWMfA17KG1TPgZsPvAP0CEOOAluBlcC51vmGdb4HaABXARuAfRmPWG+0erStIzZa1YCPw1sak6FwRMcSTmFtGD87Yj4NLLXO7ysK+ADgBPNG6/xgwbf/MmAPMC9i/jRANpOO2Gh1FrBZeNbWonAA1vkDwO3AWMQ8ANxZ5A6uAy6K6H8IPrAtsc5/Ee5sTB4pAni/oH/COj9W0r08E16uybLMaHVJLqDRahZwU2SBQ8BrZZ1feKleEcx3pezgCqArot9hnZ+oyEm/IehXpgAuFSbvqCqEWOdHgG+FlyUX8MqIbhz4nGrlk4jufKPVnDzAhRHdAev8aMWAXwn6hXmAcyO6/VQv0pp9eYCzhJhbtfwh6GeLgEarhhD+jncAUFrznKwd7BYmnTiDgGdnAUnJw0ROItALPBlCZG8I/pus83szpk2kZFj1sttgtOoBPgQ2AhcA04DlwG6j1a1l169XcFSbgSXCUW0zWk2basD7Mmx9Qlw/M4BGq3rCt8qFUwYYkodDOcN+nOoj9hm2n0JVYUoBnwrljckyBqiyCW69gtRpNORxz4eqwcngdpZb5z8ou/5kR91s549Y508AD4df2c1pZg06LUya3oFQN0PQnxIBw31pFlisE4An87Y5VimY2QHAXkH/Zx7gkYhuUQcApTWP5AEejOgWG626Kga8WtAfzAP8OqJrAIsrBuyPXS/r/M95gFK5bFVVZEarecB1EdNwii+SQtPdFe7emtRn1yNO97AQuvqNVssq2L0uYL1g3pXqzbcL+udCYbOMaOE+77fOf5kKuE3whwMIZbICRcynBfMLyfEw9DGkOt4Wo9W6NuDmAO8C50XM3yNUzrKSgC1CgacGvG60GjRaTU+EWw2MAJcKQzZIaVktZ+ElwN7JH9P8vynzJvA28A3wq3V+3Gg1k1aF9hbgHuSKGcCL1vmHaLeRY7RaRav01p2wWRMhG2kknvwuYI11/lTbCat1fiewOrH8US8Atx1YmwVXtFe3iFZboqwvPEarvzKUMjg5ARgeHvn92mv6X6VV11sgdAGy5CgwCNxrnf+ITrVj/7Ojl9PqF99Aq188n1bLrAsY5d9+8XD4Rnkv7zhj8g/Rqx+pp+Oe6wAAAABJRU5ErkJggg=="},"1":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAABbUlEQVR42u2ZvUoDQRSFv6wahChWFywFCxsbn8DKQkQFGxtRSKGFqPFZ/GtERBREsBFBrHwIwUZsUgnHwhQJCBqtHSeQjZAZdE63595dPu7OndnLFsgpM7sEFtpMn5V0zS+U5YQbAebporKc+ZtAj+PdAyvBAc1sECh7QrtANYYKloEhx3sFToO/YjPLgA1P6EhSI4Y1OAeMOl4T2I+lSSoe70bSU3BAM5sAJls0RxTbzLbHewRugwOa2TCw6AntSfqMoYLrQNHx6sBx8JPEzPqBNU/oRFIthqNuCbBQzdEO4JbHu5P0EBzQzKaAcU9ohy4ry7ExV4Gr4IBmNgZMe3IPJH3EUMEKUHC8N+CQAMqc6g0Ay568c0kvIQB7neuG56sFoEYgfQOU1ASeiUgZkSsBJsAEmAATYAJMgAkwASbABPinAQuewX0GOOtg+Cp5/DrwnvNZq5IuWo2dAH38/N3QqUod3FNMa/BfAX4B3ApJ7Mvm+A8AAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAABeElEQVR42u2ZPUtDMRSGn161CFWcBEfBwcXFX+DkIKKCi4sYKIkOotbf4teQIEYURHARQZz8EQUXcenk4GCHFgStzsYUeis0QfNu9z3nXh7OzUnu4RbIKSXFFbDcYfqCNvaGXyjLCTcOLNFDZTnzt4E+x6sCIjigkmIYKHtC+0AthgqWgRHHewXOgr9iJUUGbHlCx9rYZgxrcBGYcLwWcBhLk1Q83q029ik4oJJiGphp0xxRbDO7Hu8RuAsOqKQYA1Y8oQNt7GcMFdwEio7XAE6CnyRKikFgwxM61cbWYzjqVoHRUM3RCeCOx7vXxj4EB1RSzAJTntAePVaWY2OuAdfBAZUUk8CcJ/dIG/sRQwUrQMHx3gBDAGVO9YaANU/ehTb2JQRgv3Pd9Hy1ANQJpG+A2tgW8ExEyohcCTABJsAEmAATYAJMgAkwASbAPw1Y8Azu88B5F8NXyeM3gPecz1rXxl62GzsBBvj5u6Fblbq4p5jW4L8C/AJuR0rVZERI5AAAAABJRU5ErkJggg=="},"2":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7272727272727273,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAADc0lEQVR42u2YT2hVVxCHvyQvQfNiStWpDVWxddFFDSEWLbiptRWKojWmVKF/qBVEwYUbsRZBpW66qKBCocFFxSBqAooLtRpagwqNiEgb2lJw0WJpw88EY8iNGJt2cxf2cc67975370sKHXibmTnnfu/MmXNmThUlipnNBNYCrwAtwDygEcgDo8AD4C7QD9wEzkn6I+l3qkoAawX2AquA2gRD/wauAAckfZM6oJk1AkeA90v5YwVyHtgs6c9UAM2sGTgLvEB6Mgi0SbpazKk6BtwSoDcB3CgwEcNvFnDJzFaVDGhmC4ALwNMel/vAl8A6YC5QJ6kByAFzgDeAg8CAZ/w04JSZtSQOsZnlgD5gsWfDHwI+lTQUIwr1wMfAJ0CNw+VnoEXSo0JDjW/SfD6/A/jQYXoEvCfp8yAIxuLEPAiC8SAIvs3n831AuyP7ZwNjQRBci7WCYcb+BjzlML8r6UQZ5+fbQJfDdA+YL2kszh7c5IE7Xg4cgKRu4JTDNBvYGDdJNjt048DulI6Y/R79+khAM5sPNDsGd0n6PQ06ST8BNxymV82sKmoFX/PMe4Z05bJDNwN4PgpwkWfCaykD9nv0TVGAC91Rib43E8o9j74xCtCVvUOkLzVxbjcXYL3nSktbnvXoh6MAXYf34wwAl8YJfTWTIGZWC7zlME0A/zrKcg6nXqAwIX5MmXEb8JxDf0vSSFFASbsyXr1m4IDH3JO4YM0A7nx4IBfKX8DRQmWuQmDVYel2OOz6XNIt6U5FAcOid03YBbYUcR0GnFsrlwFUHbAMWB12gHNiDNsq6ddMAMPqoxVYASwPf/kEU+yUdDK1xv0JsJfDfdXmOTKiZBzYLqkjtZeFcLO3hw3Q4jIW/jtgi6Qf0nxZWAZ8EbHZo+RW2A12SppI5ekjXLV9wJ4St8Rd4CLwlaTrqT4emVkNcAJ4J8Gco8DV8Fb4WlJ/OUkYlcUdMeEGgW7gJHBd0nhax1axl4UPgGMR478HPgNOS8qiJPM27g3AHeCZIiu2Q1Jn1tekL8QfFYG7DbwpaaAS97gPcINH/wvwepwHo8xCbGbTgRFPU7NSUk8lSzRXPfiSB66v0nA+wCaP77nJ6F+qPc8PvuSYEoB1Ht+BqQJY7Aqb0oCTIkkq6htmNpExz4CkF0sFnFGBBXv4nwvx/4Dlyj9G0PbfSBnArgAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAADcUlEQVR42u2YW4hNURiAv7mYjMvIJZcwuTxQTKchlBf3ErkMQomN2VuUpCSX5BIlLwqlWOvBiqYZMzXy4DrJNKbMJIkJqXkgYnLJpUGG4WU/6LTW2Xufs/aZUf46L//619rf+de/1v//K4c0xXOdAcBiYBqQAEYCRUBvoB34DLwEWoB7wGUh1euo38lJA6wUOAAsAHpEmPobuA0cEVLdsg7ouU4RcApYm84fS5IrQLmQ6o0VQM91SoBLwBjsyXugTEjVkMooNwTcFKA+Alw70BnCbiBww3OdBWkDeq4zCrgK9DeYfATOAEuBEUCBkKoPkA8MAeYCx4E2w/yeQJXnOonIW+y5Tj7QBEwyBPwJ4LCQ6kOIXegF7Ab2Ankak6dAQkj1I3kgP8W62wxwP4B1QqqqsMEmpPoK7PdcpxGoBQqTTMYDO4CjoTzon9gXQD/N8BohVUUG9+cKoFoz9A4oFlJ9CxODGwxw5zOB871ZA+i8PwhYHfaQlGt0HcAeS1fMIYN+WSCg5zrFQIlmcrWQ6pUNOiHVE6BZMzTDc52cIA/OMqxbi125qdH1BUYHAU40LHjHMmCLQT8sCHCsRvc2TN6MKO8M+qIgQN3p/YB9yQuT3XSAvQwpzbYMNeg/BQHqLu+fMQBODbP1uXSBeK7TA1iiGeoEXgXl4nog+UA8tsy4BRiu0d8XUn1JCSik2hWz90qAI4bhusgFawxwV/wLOVl+ATJKuWUTLBdYD5z0uz6d1AipWrMK6Be9i/wuMJHC9BOgDa38GKAKgOnAQr8DHBJi2mYh1fNYAP3qoxSYDcz0f70jLLFTSFVprXH/C2yyH1dlhisjSDqArUKqs9ZeFvxgX+43QJMycPxdYJOQ6pHNl4XpwOmAYA+S+343eEFI1Wnl6cP32kFgX5oh8RK4BpwTUjVafTzyXCcPqABWRlizHWjws8J1IVVLJocw6BSfDQn3HqgBKoFGIVWHrWsr1cvCOkAFzH8IHAMuCqniKMmMjXsfoBUYnMJj24VUF+JOk6Yt3pgC7gEwX0jVlo08bgJcZdA/A+aEeTCKbYs91ykEvhiamnlCqrpslmi6enCCAa4p23AmwGEG28td0b/kGp4fTIejWwAWGGzbugtgqhTWrQG7RKJU1M2e63TGzNMmpBqXLmDfLDjs+z+3xf8BM5U/Ubnpu9EfndwAAAAASUVORK5CYII="},"3":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7272727272727273,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAADaElEQVR42u2YS2hVVxSGv6ONUa9PdNmCQif1hUIg+EAHFoUOghYRB0WQIqLVQVWkKooiioiIiFpEtC3pQJCWWqRYrAWtD0QiUkuVCmJEB0ZSfkGMchLiI052IBzOPvdxzrm5Axfcybrr7v3d/Vjr3ysgYma2CThA/9hGSYf7OgZQ4/YeMK19EOPrAp5XYe46YGjZgJKOAkfzpjOzZcCpSlYwb7ABwHpgb6VbnCfcZKAZmJvmDOYBNhDYBOwCBnvC2oGWqDOoAtx04EdgRkLYSWCDpGdVAzSzOmAbsB0Y5Al7DKyRdM43TpATXKM7aw0JYT8A30jqSBoryBisHtgJbEk434+A1ZIulDJmkCHcbHfWpnpCeoBjwFZJL0sdN8gAbAiwB9iYUDrvA6skXS13/CAl3BTgLPCJJ+QtcBjYIakzq1pcjs1IgLsLrJR0o9bUzGtgH9CYFi6vSrI5qorTWNozuNxVgb7WCXRHpFsrcAs4B7RI6ulPwGJ2HzgCfCfpVS0q6olOb942szm1LPmnAFfMbHUtv0nqgBNmtqqqYsGdzxGAAbOAJuCLBFXzCpgnqfp6sA/wBOBbYEnC5ZkWvTgDqwUYhmFHGIY/FwqFN8CCmJAxQHsYhjf7BbAP6NVCoTAOmBnz9YQwDI/3yxZHtnsY8AAYF5eGJLV6S52ZXY4RABckrcgKUNJLMzvmHlFxAqQ1Kc18BIyPfMbmsJDnPf6ptZIH//X4RxcD7KmG6pHUBcRJ/2HFAON+NDanVeyqpBY/i/F9mMNNDoCRMV91FAO8F5efzOzjjBknuVoctafFAP/2DNiUMeBCj/92McA/gDcx/g2uCZRVM2mN5xV4IxFQ0v/AXx799lVW7xa3xVG77OYvmgf3e/yHzOzTlKvXhL95ebwkwSrpIhDXO6kHfjOzxRXCLQF+8sz7D3C6ZD3obu0dYLgn5ASwR1JbieJ1P7DWE9INzJF0qyzBamaLgDMJlaQb+BX4E7gGPOltcZjZGKAR+Bz40pPzem2da96XL/nd07LZk7PirNP9oVLjd0nanepNYmbzgV+c6s3KuoGvJX2f+lUn6ZKTQacygmsBZhWDq0hRm1mDy2NL8XfsfXYdOAicKbX9EaTIZ0OBz4B5wDTXMRjlbv1b4AXQBvznVux3SQ/Lnecdb8T/2iBsdp8AAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAADaElEQVR42u2YW4hNURjHfxtjmFxDFOXFNWo0RDwQ5WFCmjxIyZbWmvHgktwjjZAkuTRNWCtaqYmQRC7lnjSTHA1RMsUDQkqGmmlcxstS02mvfS577zPnwb/Oy3e+s/b/fPtb3/f/Po80SOFvAg7SPdigtDnS1dCDIsd/glHRK8DWDnwrwLNLgLKcCSpt6oC6pNlJ4S8DGvKJYNLEegDrgH35vuIkyY0HTgGzouRgEsR6ApuAWqCPw+0j0Jhu9ApAbjJwGpgW4nYGWK+0+VowglL4JcB2YAfQ2+H2DqhR2lxzneMlRK7C5lp5iJsGNiptWsPO8mImVgrsAraE5PdbQCptbmVzphcjuRk21yY6XDqBemCb0uZHtud6MRDrC+wBNoS0zteAUNo8yPV8LyK5CcAVYIzD5Q9wBNiptGmLqxfngmkh5F4Cq5Q2TcWmZn4B+4GKqOSS6iSb01VxFETNweW2C3RFG9CRJt1agBRwDWhU2nR2J8FMeA0cBU4qbX4Wo6Iea/XmMyn8mcUs+ScA96XwZTHPJCXACSl8UVCxYPNzADAMmA5UAktDVM1PYLbSpvB6sAvhUcAxoCrk8kxKvzg9C0UwlWpuTaWaz02tmPIbmBfgMgT4mEo1P+7WHFTa7LWqJgjVxXJJtgKfA+zlUvhjQludFP69AAFwS2mzMsYo/pDCr7dDVJAAaQmL4AhgZNpnaAJRvOGwTyyWOtjssA/ORLCzEKpHadMOBEn/fpkIBv1oaEJRbM+nF38NsA1PoHB7wMCAr1ozEXwVYBslhT86Zo7jbC9Ox5dMBJ84DqyMmeACh/1ZJoLXgd8B9vV2CRTXMqnGMQU2hRJU2nwC7jj0W3Vcc4t9xem4Z5+fsQ4ecNgPS+HPiRi9StzLy+NZ9WKlzW0gaHdSClyWwl+cJ7kq4KzjuU+BC1nrQXtrnwP9HS4ngD1Km/dZitcDwGqHSwcwU2mTykmwSuEvBC6FdJIO4CJwE3gIfPi34pDCHwJUAIuAFY6a9w9r7fI+d8lvR8tTjpoVhDb7h7L1r1Xa7I40k0jhzwXOW9UbFzqANUobFXmqU9rctTKoISZyjcD0TOTyGpqk8MttHVuCe2PvwiPgEHAp2/WHF6GelQHzgdnAJLsxGGRv/R/gO/AeeGEjdlVp8ybX5/wFSVT9CmwF0B4AAAAASUVORK5CYII="},"4":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAB/0lEQVR42u2YP2gUQRyFv9ucQYJ/IvKEgIWgIIJFaovUIlhHrBTRSsVG0ahEjEkUG0ELC0HQwkKwsdLKThCsREhjoYUBHwqKIv5JtEk1zHp7uZubFfaV7+2yH293Z367LfokSUPAa2BnxVN22V7odFBB/3S4C7jKKvrU3lpgOhI9BKayAwLHga2B9xs4ByxmBZS0ATgbie7YflOHW3wa2Bx434GZ7M+gpC3AqUh0y/b7OrwkF4F1gfcFuJr9LZa0DTgWia7b/lSHZWYGGA68D8CN7OugpN3AwUg0Z/trHRbquci574Db2XcSSXuA/ZHoku0fddjq5iPeAnCPBCq6bG8fMBGJLtheygooqQXMRqKXwCMSqZsGDwDjEX/K9p+sgJLawOVI9Mz2UxKqaoNHgR2x9kisokJ7Iyt7bqjHtp9nBwROAmOBtwycZwAqOrQ3CpyJRA9sv8oOuDIpbwq8XyXfH4MFlDQGnEg1yvejwWlgJNUo3xOgpO3AkUh00/ZidkDgCtAOvM/ANQasItLeODCZepTvpcF5oJV6lF8VoKQJYG/kuFnb37IDlizKb1OM8qsFHC0Z5X/WBTDUEnCfjGp3yIeAj5J6ucZwif9C0nJJNmn7SRVAgI2Jyln/j2xNij+s2b9JGsCYWqkvIOkQcJca/OVvnsEGsAFsAP9HwL8F+XvZOcyHuwAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACFElEQVR42u2YP0iVURjGf/fTpKQ/iiAIDUFBBA3OCs4hNCsux+icpoqWwsxQNLVwCWwIzoE4OjgILk41NQRNTRG4NNSQ0CBYSfTHcrnT4b3de7333PMF3zO+z/ngx/Od8573+0o0SUarNuAdcL7GRy5Y57eqLcponq7UAVezsialdxSYFqx1YDI5IHAdOB3UfgN3ge2kgEark8CEYDnr/Ps8vOLbQE9Q+w7MJd+DRqte4JZgPbHOf8rDIbkPHA9qX4CHyU+x0eoMcE2wlqzzO3loM3NAR1D7DDxO3geNVheBMcFasM5/y0OjXhCe/Qg8TX6TGK0GgMuCNWOd/5GHq25RqG0BK0RQVmd6w8CQYE1Z5/eTAhqtSsC8YL0BNoikehIcBfqF+qR1/m9SQKNVOzArWC+t8y+IqFoTNMA5KT0iK6shvc7ynRtq0zr/OjkgcBPoC2p/gHu0QFmV9LqAO4K1Zp1/mxywPCl3B7VfFb4/WgtotOoDbsQa5ZuR4DTQGWuUbwjQaHUWuCpYy9b57eSAwAOgPajtAo9osTIhvX5gJPYo30iCi0Ap9ih/KECj1RBwSVg3b53fSw5YoSl/iDHKHxawq8Io/zMvgKH2gVUSqhTswVfAoNBeGlEHcEyofy0PHZJGrPPPEXqdpFORwjnxD+9IjD+syb9JCsCqhySGjFbjwDNy8Je/2IMFYAFYAP6PgAeA+nzJWv+F2QAAAABJRU5ErkJggg=="},"5":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7272727272727273,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAADEUlEQVR42u2ZTUhVQRSAv5emwlNL8Qil/bcqSaIIgyKjaCP9LqIwsXaKEBZoEZUJQZErqSxoEYSrCmpR0M/SoMBFP4SSuNMiOUX5shtWaotmIY+Z633P+0zineWZM3O/O+fO+bkTwSIi0g+sYGalQFW/xivnMMslDThdyUzA9ifwI4UsE9MFvKaqjWkXpwHTgGnANGAa8P/NxU4RkSJgL7ARKAOKgDxgFBgG+oE3wCPguaqOzwigiCwGWoFDPmuVAKuAXcBp4L2ItJvcPpIyF4tINfAWOJzgi5YAl4AeEalKCaCItAKdxo3JyiLggYi0hAooIk3A2RDPwTkRuRgKoIhUAK7F+oBjQDmQD8wFioGtQBugPkufEJFa20Akga7ui7Gfb5lyAWhR1V8+L5drQOscJsNAmaoOJruDBQ64ZlU95QcHoKojqloPNABjFpN5JiKEGqi7VbUtkQmq2gGcdwzXiEjJlC5OtYhIBvAMqLAMN6pq+z9Ndao6BjQ7hnfOilysql3AO8vQ2tlULDyx6ApFpHi2APY49IXOYkFEGoHK+BioqkdSAPjZoc/zq2bWA7vjdEMp2sHxqTKczcW2gJubIsB8h97zA/xm0UVFJDsFgEsc+pgf4CefOi5sKXd48IMfYK9jsc0hZ5NMy2EE6Juc122ALx1rbgt596ocxUeXb6BW1X7T5MTLfhFZGCLgMYf+YZBMcteiywbOhOTePcAWy9BH4HEQwA7gt0VfJyI104RbCtxwDF+PryszrEHI82LRaLQUWGf7dqLR6KDnea+SgFsOPAVKHbtX7XneaNBi4aQjg2QBN0WkU0SWJQB3EOj2uSA6rqqxQD3JpEUrzTeR5TAZA+4bmy5gQFW/m7k5wGrzrdUCa3we1aGqDYGbpjjIA8At06UR8LpiHMgJaH8HqHb1NJGA7tkO3DaNU5jSARw1FTZJAxrIBcAVYF8IYENAvarem8owksRJ3AA0mZ9BWQlOHwCuApdV1QsyITKNeJYH7AA2mb9XK03qyuPvtVbMFKS9wGtzkF6o6kQiz/kDvyXZ6uuyM8gAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAADH0lEQVR42u2ZS0hWQRSAv9/ShLQyQijp7aokCSIMioqiFtKTiKJkjGZACcKCrEVPCopchD0smKGYcFVBLQoq2rkocBE9UAp3VhQVlb3oobZoFnG5c73/7/1L4j/LM2fmfnfOPXPOuZMiRJQUXcB0/q6UaGPfB5V5DHHJAQ5Whqdh+x34mkWW/sECntXGNuRcnAPMAeYAc4A5wP83F3tFSTEOWAPMAyqAcUAx8A34AHQBD4GbwF1tbN9fAVRSTAIOAZsj1ioDZgArgb3AcyVFs8vtn7LmYiXFJuAxUJvmi5YBx4EOJUV1VgCVFIeAVufGTGUicF1JcSBRQCXFLmB/gnFwUElxLBFAJUUV4FvsKbADqARGAflAKbAYaAJeRyy9W0khwgZSaXR175z9mJApR4ED2tgfES9X5EDrPCYfgApt7LNMo7jEo2/UxjYNNNlFbL2S4hFwEhgWMBntToStSR7U7XHgAqAtwBHPcI2SomzAHdTGlmc5QRwGlgNVAX0+sA5o/qepThvbCzR6hlcMiVysjW0DnoQMzR5KxcLtEN1YJUXpUAHs8OjHeoNESdEALAqegdrYLVkAfOvRF0dF8RxgVUD3Kks72DdQhgtzcVg2KMoS4CiP/ksU4McQ3UglxYgsAE726HuiAN9E1HFJS6XHgy+iADs9iy1IkkxJMTwkGAGe/ll0hAHe96y5JOHdq/ZURm2RB7U2tss1OUFZr6SYkCDgDo/+RpxMciVENwLYl5B7VwMLQ4ZeArfiALYAP0P0dUqKmkHCTQG0Z/hcsOjN8yTybuC8ZxGjpKjNEG4acMf1zWG7dyKdnmSPJ4MUABeUFK1KiqlpwG0E2iMuiHZqY3ti9SR/LLrIfRMFHpNe4JqzaQO6tbGf3dxCYKb71gQwK+JRLdrYbbGbpgDkBuCiq3aJeV3RBxTGtL8MbPI1XKmY7lkKXIponDKVFmC7q7DJGNBBjgdOA2sTAHsF1Gtjrw5kmMogEucCu9zPoII0p3cDZ4BT2tgvcSakBnGeFQPLgPnu71W5S13F/L7W6nEFaSfwwAXSPW1sfzrP+QUOftWIYhyRNAAAAABJRU5ErkJggg=="},"6":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEU0lEQVR42sWZa4iUVRjHf7uuYzqbbquPKy47WLn0JY2yqNQUoztpgpT1oYsVCQVbGF3wU1AYiFnRRbrAGhVFUeQWFZt2QSK6iV0ty1zMUvtXNmuNrbZbH/YEy3TOzJn3fYeej885857fPOfy/M9zGkhoZtYKLALmAicAHcAEoBE4AOwDtgEfAa9K+jTJOA0JwGYBtwOLgaYafvolcD+wXtKhzAFdxO4BriKdfQ1cL+nNmM6jIuFOBDYD80hvk4DL8/n8UD6f31wqldIBmtkC4A1gYsTgh4ChiO82AGcCR5ZKpd5KHRurwM0EXgLygS57gTUuspMkjZGUA1qAWcAtwJYKQ6wws65Ea9DMxgFbgU5P8yCwGlgl6feIWVgIPApM8TQPACdL+rzWCK4KwB0ElkhaGQMHIOll4BTABzEGWFtTBM2sAHwLjPY0L5a0IeHZebQ7F1s9zbMlvRcbwVsDcPcmhXOR3Om+7bMroyJoZqOAPYCVNfUDBUnFNGeMmY12s1Moa/pJUltMBOd64AAeSQvnongY6PE0TTazjhjAUwPf3kB29nbAf3wM4EyPrwR8kCHg9wH/f5KBL9m3e3x9bmqyst3AJo+/GAM43uP7JUM4JP0InBXT1zfF4zy+fv4na0qrEc3sCOA84BwnXKcCzS7j/AZsdynzNUkfZwEYC9YM3AzcCBwV6NYBzACWAHea2Q4nLrolDSSd4hi4ecBnwB0V4Hx2LLAO+MTMZtcF0MyWOn04LcXSOg54x8yuyRTQidcngVxG6/9xM1ueCaCZTQCeLhMRfwJPAZcA093myAGTgTOAlW4pVLIHzWx+tNwys6/cFIy0H9zpf9oI37PACkl7Iv7cIuABj0D413YAMyQdTBrB9hFwA8ANki6LgXMHc49LoRsrbJ6bstrFV0h6OEH2KAIXAu8GunSZWS4t4H2SnkuR4gaASwOZaQpwfhrAvgpquBbI3cDdgeaFaQDXZqho1rm1XG5z0gA+n6GaKQK+0sd0dyWoGbBP0t6MhcqHgcO7PQngrjooqZ0B//gkgAfqABj6ZnM1wMEs6ogpbKgaoK+c0VIHkFC1rFgNcL/vzloHwLaA/9dqgNs8vmPMbGLGgD7B+rOkfdUAtwRy9tlZkZnZWCfHqo7tA3w9sFG6MozedfiLoj1VASUpcKk+3em6tNFrCeT0w8ALsaludcDfbWbTUsA1uCvDVE/zel+2agzkyk0BcdkK9JpZZwK4HNDtNGG5/QHcVatgvTag2zqB981smaslxsCdBLxFoEjprg67an7IMbOL3LoIgXwDPAP0uuNpv6S/XQG+HVjA8HPZBRXG6pZ0deKXJjNbBjwW+egzyPBbydjImX8RWCrpr8TXTkndLgr9kS9XsXBrgIsrwdX6VlcAHgos8lrsO2C5pI3U6bVzPnAbcG6Ninw7w4+RT8QWjlLJKDNrc9Gc4ypYBSc2m5zWE/CFS1+vSNqaZJx/ADaJU02hSUDIAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEWklEQVR42sWZa4iVRRjHf7uua9qi226puOxi6dKXNMqiUlOE7qQZUtaXJmsmoWALowt+qbAMxKzoIjUDx+lCUiS5RoVpFyKim9jVssxls1Ks7GRlu5vZB+fDcph5z5z3nUPPx2fmvPM7z1ye/zzTQE5TUrQBC4DZwKlAJzAOaAQOAvuAHcBHwCva2E/zjNOQA2wGcCewEGiq4adfAg8D67Sxg8kBXcQeAK6lmH0N3KiNfSMZoJLiNGAT0EEa+xe4C7hPG3skq2NjBNw84J1IuEFgKKJfI7ACWB3TMQtuOvAScGygy143yBzgeG3sKG1sM9AKzABuA7ZlDLFMSdGTa4qVFGOA7UC3p/kwsApYqY39I2IW5gNPAhM9zQPAGdrYz2uN4MoA3CFgkTZ2eQwcgDZ2E3Am4IMYBaypKYJKii7gW2Ckp3mhNnZjzrPzRHcutnmaZ2pj34uN4O0BuAfzwrlI7nbf9pmImmIlxQjgSk/f34F7EhwxTwH9Hv/lsWtwNnCCx/+ENrZclE4bOwT0eprGKyk6YwDPCnx7I+nsrYD/lBjA6R7fX8AHCQG/D/jbKx2+ZO/LGH1ualLZHmCrx1+OARzr8f2SEA5t7I/AeUTmxEobE9jB/4s1FdWISopjgIuAC5xwnQS0uIzzG7DTpcxXtbEfpwCMBWsBbgVuBo4LdOsEpgGLgBVKil1OXJS0sQN5pzgGbg7wGXB3BpzPpgBrgU+UFDPrAqikWAy8DkwusLROBt5WUlyfFNCJ16eB5kTr3ygpliYBVFKMA56tEBF/A8+43D3VbY5mYDxwLrDcLYUse1RJMTdabikpvnJTMNx+cKf/2cN864Fl2tifIv7cAuARoCvQZRcwTRt7KG8EO4bBDQA3aWOvjoFzB3OvS6FbMjbPLal28TXa2MdzZI8ycCnwbqBLj5KiuSjgQ9rY5wukuAHgqkBmmghcXASwL0MN1wK5B7g/0Dy/COCahIpmrVvLlTarCOALCdVMGfCVPqYqKUbmAezTxu5NLFQ+DBzeHXkA++ugpHYH/GPzAB6sA2Domy3VAA+nqCMWrHxlAvrKGa11AGkP+MvVAA/47qx1AJwQ8P9aDXCHx3eSkqI9MaBPsP6sjd1XDXBbIGefn4pMSTHaybGqY/sAXwtslJ6E0bsBf1G0tyqgNnZ/4FJ9jtN1RaPXGsjpQ8CLsaluVcBfUlJMLgDX4K4MkzzN63zZqjGQK7cGxGUbsFlJ0Z0DrhkoOU1YaX8C99YqWGVAt3UD7ysplrhaYgzc6cCbBIqU7urQX/M7iZLiMrcuQiDfAM8Bm93xdEAbe8QV4DuAeRx9LrskY6ySNva63A85SoolgM6ArEyTg8DoyJnfACzWxv6T+9qpjS25KMQUkEbUALcauCILrta3ui7gscAir8W+A5ZqY7dQp9fOucAdwIU1KvKdHH2MtLGFo0IySkkxwUVzlqtgdTmx2eS03n7gC5e+XtbGbs8zzn/akUfBjXfsyAAAAABJRU5ErkJggg=="},"7":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACb0lEQVR42u2Zz4tNYRzGP3dm7r1MQvHdibKYmjEyNVNjQaZYaP4EKSsLikLEJClJIRtJYSjFxkKxsFFTmlFMfjWjZDGpSTFPaJSShM270Ol7mvvjnPuexXyXz3PqPvd5znnf9/t9SyTKzIaAMeLUHUm7/wfaKHgtCmy2OhzsNzDfgt8uAcvrFihpHFiZtzozWwPMFjnirsK+g2a2BLha5I/kTIqDn70XtdXuDQITQHuC+gT0SPoWzUEzqwI3HXEA+5PiYkR8Guhx8HuS7qetRa1yrx945rj3JUQ7F+0jMbMKcCsl2oNp4loZ8Ulgo4M/lHR3oe0mb/f6gOdAOUHNAxskfYy2DppZR4i27NBHFhLXiohPAH0O/ljSaK0nirzc6wVeAJUE9QPolfQh2lZnZu0h2opDH69VXJ4RHwUGHHwcuFLvoTFr97qBV0A1Qf0ENkl6H+3Ib2ZtYa+tOvSpesXlEfFhYLODTwKXGu0LsnKvC3gNLE1Qv4B+SdPRuroQ7agjDuBso+KyjPgAsMXB3wDnmm39mnVvPTAFdDrt66Ckl9EadzMrhWg7Hfpis+KyiHgfMOTg78LpOZPuvlH31gHTwLIE9QfYKulp7NnMDUccwOWsxDUs0Mz2AjscagYYyXqA08hM5a0z+PkLbJc0Fnv8dj1lKnUta3F1CzSzPcBOh5oFjpHTjK5WcavD8rHKoYclPSLyhPV8irjbeYmr2UEzGwitY/L5OaBb0lciz6gvpPyZQ3mKq8nB4N6kQz2RtI0CTPl3peAjUIxriGEHm5I0URSBax3sAUW4yDGzFSnH+Jmi3DSVU/Dvi1dhof4Bqf+t6psfP/QAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACbElEQVR42u2ZvWsVQRTFfy9fT4OooKUoWAQUxUACsVAMaCH5E0QYi5kiokKUSAwighFBxUZEcG6UEbSxELSwEQISbQJ+kAhiEYQgaEAlgiAiarOFLHfhvX27mS1yy3OKPdx7Z/beMzVS4awZBKaIE/e8hMP/A21UPFYEthodCvYbWFqGb9eAtU0L9BKmgfVlq3PWbAIWqlzinsr2oLNmFXCzyofkQkYGP0cX6KwZAEYU6hMwEVWgs6YO3AbaFfqol/AtdgbPA9sV/IGX8DBqDzpr+oBRhfoCHIt6SJw1XcCdjNKe8BIWY5/is8BOBX/sJdyPes04a3qBMYVaAoaj3oPOmo6ktJ0KfcpL+Bj7oj4D9Cr4Uy9hMuqfxFmzI+m9dPwAXNR50FnTnpS2S6HHvIQPsQfWUaBfwaeBG80OjUVnbxvwCqinqJ/ALi/hfbSR31nTlvxr6wp9rllxZZT4JLBbwWeAa3n3gqKy1wO8BlanqF9An5cwF22rS0o7qYgDuJhXXJElPg7sUfA3wKVWV79Ws7cVmAW6lfV1wEt4GW1xd9bUktJ2K/TVVsUVUeJhYFDB3yXTcyHbfd7sbQHmgDUp6g+w10t4EdubEUUcwPWixOUW6KxxwAGFmgfGizZw8ngqbxXj5y+w30uYim2/+QxX6lbR4poW6KwxwEGFWgBOU5JH16i4jcn1sUGhh7yEJ0R2WC9niLtblriGBTpr+oEjCrWYYQQtewavZLTDiJfwlZJ94kayN6NQz7yEfVTA5T+UgY9DNZ4hhhRs1kt4XhWBmxXsEVV4yHHWrMsY4+er8tLUmYF/X3kKS+IfSRScGy+jmYkAAAAASUVORK5CYII="},"8":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEtUlEQVR42rWZbWiWVRjHf3tL21m5rKM2stdV0oToBYooU5tKlClB2OzFgmr0ppEfKnoBP1iBkR9K+rCiN8zIMLEhhjYIKsdCsdIaSwMbjPKvczM9bW66PuwM5OGc57nv57l3fbyu+znn/5zrXNf5/88powiz1pYDNwHzgBuAK4GpQA1QCZwA+oA/gd+ANmCHpL60c5WlBFYDPAs0A5eknGsA+BJYI+mXzAFaa+8H1gLTKM1OA+8DKyUdLxmgtbYCWOdXLUvrAu6StL9ogNbaMmA90JRw0mHgJFCd8PseYJakA7EPygsM8HIBcF3AS8CtwCRJVZIMMNEXzjJgi09ryOqATdbas1OvoLV2BvCrr8pc6/PFsl7SSIJtchXwIXBL5JPVkl5JC/AL4L5i0pJnL38CLI1U+HRJhxOl2Fp7PrAoEDrlN/aBtBUh6ZRPeXsgPBF4IM0enAOcFfC3SNpTbNlKGgaWR8IL0gC8PuL/tNTeIuknoDPpnDGAUyINtiOjHrgzvLNsWVKAJuA74lOUhf0dWazqpAAHAr6KDE+R0FgjwGBSgEcCvsn5GmpKuyjg6w9lKAZwX8R/R6nIPFWbGwjtTVMkbX7Jc+3pDFbv3ggjaku6F3DO9Rtjbgbqc0L1xphO59y+IldvMvAVMClAMpY5546lIQuv+h/m2sfW2vlFgKsFtgHTA+F1krpJU5nOuR5jzBDQmBOqBJYaY8qNMe3OueEE4OZ4cNcEwnuAptg4SQjrW8DKSPgQ8AGwA9g9pjmstROAK4BZwEN5WMzvwGxJh0qi/NbaJ4G3/aGeFWFtBR6U1J+VJrkceMNXYWUJVbwPWCVpY+aqzgNd7CuxGGuVtHBcZKe1tgF4yhPO2iIBjgDfAi3AxiRsPEmRGGAVsKLE1OZaO9BcSCMXUnXTgO3AzDwnTquf7CDQCwwB5wEX+FuH24ElwLmB358EmiRtKkY01QHfBU4TgG+A5yR1priRWOGb/4SAjHhY0mdpAW6L0PDnJa0t8qib6f9cXe65AFwbEvEx0fREBNyLxYLzdH+vZzK5l0jVwEchRl0RAFcFbAbOyQntAh51zo2UUhnOuSPGGAfcmRO6GOhwzv1RaAUbAykAeF3S6Ywq+D3gcMD/SJIUh0jpoN87mZhnzlsDoXlJADYEfPslncj4duvngK/Wd4+8AKdEWEvW9k8SyRsCWB1pqFnbySSSNwRwKOCbOg4ApyYBXh65Wsu1ek9Cs7SGiP9oIYBdAV8NMD8rZF56Lop0i78KAfwxMu5rfuAsrBm4MODfJalgijdHNvCNjF73lrp6VwOrI+ENBY8659x/xpjLgOsCA8w1xvzrnNtZArjtkQLpBR5zzg0UZDO+WXYGzuMx2wIsl3QwIbAq4HFgTR5BtVzSO2no1hLg8zzznvLa5Gu/b7slDZ5RBJN9Fmb7M7Yuz1hbgbtDEqAQo34BeDMNWfHSsybBE8eYdQALYu94FQWo0Q/GmB5/iCfRI1WeMScVY63A4nzauDwB82hh9GXz+wybdC/wDHCPpGNZvnYuZPQBp7EYTQ10e8n5rqSj4yLcz6jyecBtwAzgUn+lVu2zMggcZ/QuugvY7e9vOtKS3v8B4paPq1MUwrAAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEqklEQVR42rWZbWiWVRjHf3vccm0r1ypnIynKSprQep4g6MW0Ni3SlCDW7OXuw303epuhHyoqQ8gKjPxQ0odzok5lhYaFDVG0QdDLWPTgSmsNDWwwSnTOUHFvrg87gjycc9/nftn18bru55z/c65zXef/P6eMBBb4Xg64FWgBCsB1QD1QA5QDp4Bh4C/gd6AL2CukGo47V1lMYDXAc0A7cFXMuc4AXwIbhVS/Zg4w8L2HgU3AHNLZWUACa4VUJ1MDDHxvBrBZr1qW1g/cL6Q6mBhg4HtlwBagzXHScWAUqHL8fhBYKKQ6ZPsgFzHAyxHg+oGXgDuAWUKqCiFVNVCpC8cDdui0mqwB2B743oWxVzDwvfnAb7oqS21YF8sWIdWkwza5HvgQuM3yyQYh1StxAW4FHkqSlpC9/DGwylLhc4VUR51SHPjepcAKQ2hCb+xDcStCSDWhU95tCFcCj8TZg4uBC0zzCKn2JS1bIdU40GEJL40DMG/xf5K2twipfgb6XOe0AZxtabA9GfXAnwy+y3VbcwJYbfAd0ynKwv6xLFaVK8AzBt+MDE8R01iTwIgrwGMGX11YQ41pVxp8J0wZsgE8YPHfkxaZpmp3G0L74xRJl17yUnsmg9V70MKIupwBCqkOA7sNoXsD32tNsXp1wDsWkiHjkoVX9Q9LTQW+tyQBuFpgFzDXEN4spBogTmUWi72DhXzTGNBcEioHVhXyTblCvqm7WOwddwC3WIO70RDeB7TZxnEhrG8Day3hI8AHwF6geE5zBL43E7gWWAg8FsJi/gAWCamOpKL8ge89pfdOZYaEtRN4VEh1IitNcg3wpq7C8hRVfABYL6Talrmq00BXAl8lBNcppFo+LbIz8L1G4GlNOGsTApwEvgUEsM2FjbsUSTWwHlidMrWl1g20R2nkKFU3B9gDLAg5cTr1ZIeBIWAMuAS4TN863AW0Ahcbfj8KtAmpticRTQ3Ad8A8Q3g38LyQqi/GjcRq3fxnGmTE40Kqz+IC3GWh4WuEVJsSHnUL9J9rKAmdBm4yiXibaHrSAu7FpOD0Gb9fM5nSS6Qq4CMnRh34XgXwmmH8X4CNGWiSP4F1htDtwH0uK9hsSAHAG0KqsxlV8PvAUYP/CReAJlI6YqFfaeTnTkOoxQVgo8F3UEh1KuPbrV6Dr1Z3j1CAsy2sJWv710XymgBWWRpq1jbqInlNAMcMvvppAFjvAjxnuVortXmahGZpjRb/8SiA/QZfDbAkK2Raeq6wdIu/owD+aBl3nR44C2sHrjAdBkKqyBR/bdnAtzB13Zt29W4ANljCn0f2QSHVEPCpZYDXA99bkxLcHk3HSs04b1kI1eoDLrLMtQPo0ALfBVgFEOiz3CaoOoRU78ahW63AFyHzTmht8o3etwNCqpHziqAOuBlYpM/YhpCxdgLLTBIgilG/ALwVI4untfSscXjiOGc9wFLbO17onV+x2PtDId80qA9xFz1SoRmzqxjrBFaGaeOcA/MQTL1sfp9hkx4CngUeEFL9l+Vr53KmHnCak2hqYEBLzveEVMenRbifV+UtwJ3AfOBqYJau0Jw+EU4ydRfdDxT1/U1PXNL7P9DJdZDC/vGVAAAAAElFTkSuQmCC"},"9":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEYUlEQVR42rWZX2iXVRjHP9Ntam9zmj6OYKyGUGllF5rETLJVUJO5FCuoiDKCsOwigrDAmy6CupEMRhkNKuiP2Yq1oswKysySUkr7c1HYSquvuqXtnTbnuvAIY5zz+53397574HfzPOe87+d3znue833OqaJCM7PZQDuwBFgANAL1QA1wDDgK7Af2AL3AbkmjWd9TVQHYVcB6YDkwOUPXA8BGYLOkwcIBzWwO8CxwC/nsELBW0tuFAZrZ1UA3MJvi7DngQUmncgGaWQfwOjAl4qWngRPAOZGQ7wMdkoZDDSaVgWsBXisB1wc8BVwLNAA1khK3UC4F7gM+KfGKm4AuM6vKPIJmNhPYB5zvCZ8ANgCbJJ2ImIUlwGZgXqDJWkmdWQG7gLs9oSPACklfZFz904BXgQ5P+F9gvqS+qCk2s/nAXZ7QMNCWFQ5A0hCwGvjYEz4XeCzLN/hoILZe0leVLlu3Ym8HBjzhNS6VlQY0s6nAysCCeCZvbpH0F/CkJ1QLrIoZwVagzuPfWCodVJADT3r8K2IArww8tLeoDC3pn8C3uDAG8HKP729JP1Gsfe3xzTEzKwfY4PH9QfH2a8A/qxzgdI/v8AQAHgv468sB1gbyX9F2OuCvKQc45PHNnADAJKaRD/C47+OdAMCGSgEPenzNZjarYMCFlQLuD7S7oSgyM6sF2ioFDO216wocvTXAjEoBP3XyZ7y1OHWdd/SagCdi20/ybEMnga2B9l1mdlEOuKnAW1lqm5DcehoYDaSbD8xsQQVwDcC7sYujJKCkfcALgT4XAjvNbJ2ZTYmEu9EV8NeNSWXf5io7zWy6e2hzif6/Ay8D24C9QL+kUTOrAS52xdSdwOJx/R5y+rLb88ylkj6PKjvN7BJgB3Be5IyMuIKq1C6xzVVz7TGAk8roth+BZe7fxtjkMnC7gdskjeRdJGMhv3MidmvODLMFaJXUn3uR+OoISauB64GPMoJ9D6ySdKuk41n/VXVGqb4d2G5mF7j6oQW4zBX3dS41DQA/O8XcDeyo5NitIsAxoAeATe5XtI1mnuIJsvqAf7DkCLoctsXT8U1JrxQIOCumFKj2TN+wmS33xA4BRQLODZQBf8ZM8VGPr6ngKb7G4/tFUhoD6BOtS82smmIEazMwP5DIo/LgNx5fnduiirBHAtvsO7GAPQH/hgJGbx5wT6BY640F/Cyw/y4ys8dzwE0D3gCmecKdvp3Ge8+RpulokiT/BQqbZUmS9KVpuicj3AwnWBd7wv3AHWmaDkYBAiRJshe42VO/VgEdSZJYkiRfpmk6FAHX6qT+okCT+0OntuX04BXAzsCUnP1uXgI+BHYBhyWNuNqj0SnosyIjZC9KujfPPUm7+/fVkfvoEPH3JD1O6ZzKowd7nPodiCwhYuE6gZW5b5rGjORc99C8JwwHgQcKvasbB9oGPDymQou13zhz2/n8hNx2ekAbXRpqcdtWE2cOP2vdycQR4Ae3K70H7KpEuP4PdjJfE9xI2L4AAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEdUlEQVR42rWZbWjXRRzAP9NtOm1NmzqCsRpC5TIbm0VsSTULyphLWQQRXdodhOWbkMqEvagXURFIBqPuaFwFPZjNWCtKrKDMLFmN0h5eFCbZA+qWZpusuV7sgjHu/v/7PewLvzff793v9/ndw/fhroSUoqRYBLQDrcAKoBaoAsqAU8BJ4DDwNdAPHNTGTiT9TkkKsGuArcCtwOwEXY8A2wGtjT2TO6CSYgnwHHA72eQ3YJM2dndugEqKa4FeYBH5yfPAA9rYfzMBKik6gNeBOREfPQeMAvMiId8DOrSxY6EGs4rAtQCvFYA7CjwF3ADUAGXa2Pluo1wOKOCjAp+4BehRUpQkHkElxULgEHChxzwKdAE7tLGjEbPQCmhgWaDJJm1sd1LAHuAej+kEsFYb+1nC3V8BvAp0eMx/Aw3a2KNRU6ykaADu9pjGgDVJ4QC0sSNAJ/Chx3we8GiSNfhwwLZVG/tF2m3rduydwLDHvNG5ssKASoq5wLrAhng2q2/Rxv4BPOExlQPrY0awDaj06LcXcgcpfOBZj35tDOBVgZf25+WhtbF/BdZicwzgFR7dn9rYH8hXvvToligpFhcDrPHofiV/+Tmgry4GeL5Hd3wGAE8F9FXFAMsD/i9vORfQlxUDHPHoFs4A4PyYRj7A077FOwOANWkBj3l09UqK6pwBm9MCHg60uykvMiVFObAmLWAo1m7OcfQ2AgvSAn7s0p/p0uKy66yjVwc8Htt+licMnQV2Bdr3KCkuyQA3F3grSW0TSreeBiYC7uZ9JcWKFHA1wDuxm6MgoDb2EGACfS4G9ispNisp5kTC3ewK+NVTXNlXMX1LC9i2ADcC9R7bPJcbPqSkeBnYAwwCQ9rYCSVFGXCpK6buAq6e1n+byy97M9XFSorLgH3ABZEzMu4KqkJRYo+r5toDgKu0sZ9GlZ3a2O+B693fxsjsInAHgTu0seNZN8lUyG9cErsro4fZCbRpY4eSdCpNUEd0KilWA4+4tRkr3wJd2tjeNH9VSrJUfS+wV0lxkasfWoDlrrivdK5pGPjRZcy9wL40x26pAKeAHgF2uCdvmUi0BmdQqgL6MwVH0PmwnZ6Ob2pjX8kRsDqmFPDF4jEmT087pj2tOY/g0kAZ8HvMFJ/06OpyBrzOo/tJG/tPDKAvaV2lpCgln4S1HmgIOPIoRz3g0VW6EJWHbAmE2bdjAfsC+q4cRm8ZsCFQrPXHAn4SiL8rlRTbMsBVAG8AFR5ztzb2dGw+OA48GfjOY0qKDSngFjB5aL7cYx4CngllH/6asKlxELjNU7+WAB3NTY2Lm5saPx8YGByJgGtzqf7KQJP7Qqe2xfLBK4H9gSn5f928BHwAHACOa2PHXe1R6zLoziLJxYva2Huz3JO0u78vjYyjIwnuSfqA9YUuc2LywT6X/Q4Td3MVC9cNrMt80zRlJJe6l2Y9YTgG3J/rXd000DXAg1MqtFj5hcnbzhdm5LbTA1rrzldaXNiqY/Lws9ydTJwAvnNR6V3gQJrE9T+5hk6wVz3bxQAAAABJRU5ErkJggg=="},":":{"left":0.0,"top":-0.5151515151515151,"width":0.6060606060606061,"height":0.5303030303030303,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAjCAYAAADmOUiuAAAAzUlEQVR42u2YIQpCQRRFz9dgGIxTxF9dgsEouAeTK3ABVqNRwSwuwComgysQg2ATwXSbYYLJ8qMfxfnyRd6pc3lzZuCVm1AA3vsWMAZ6gAOOwEzSMnZ2UoBcB9gA9SfHc0nDmPnVSLkasAN8TqTtnNuHEE6f3lGJ/MAukL7IDGIuiBVM38g0yxS8FJT5muAWOL/ILEoTlHQH+sAtJzKVtC5tiwFCCFfn3Crb5Eb26AMwkjTBMAzDMAzDMP6ZBGsWrFmwZsGaBWsWfrpZeADvwVDfVxGZ0QAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAjCAYAAADmOUiuAAAA1UlEQVR42u2YoQoCQRRFz2owiNEibjUvKxiMgv9g0qLND7AajQqmGZD5AKuYDH7A4BoEmwj+gNFk2eiy4qysyDt1Lm/ODLxyPTJgNBw0gCnQBcrACVgobYzrbC8DuTawBSovjpdKm7HL/KKjXAnYA9WESKsZBgdro/OndxQcP7AD+CmZvssFroL+G5l6noLXjDJfE9wBl5TMKjdBpc0D6AH3hMhcabPJbYsBrI1uzTBYx5tcix99BCZKmxmCIAiCIAiC8M94SLMgzYI0C9IsSLPw083CEw5+TTeDAV27AAAAAElFTkSuQmCC"},"A":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAC1UlEQVR42sWZy04UQRSGvykQRFGM+IvxEjVRYoILTMSIwUggXJ15Dh/AR3DvY7h2JeBtAV42Jm4UdCW49Kw0sICQ4MIeomN1T0139XBWk7pMf/WfU3/VTFfIGZKGgE+Bwx+b2cM8z3Hkj2oLY2t5HxIb8DnwwNN+VdJg2wAlnQRGPV1PgSfATkHFCys4D3R42hfMbBNYiZVmFzG9a2a2Xgf19I9J6isdUFInMONTL+VzPTqB2XYoOAacyAI0s1VgI0Yd5gH01dIWsJyhaD3mJHWUDehT4ZWZ7QQA9qfs/jiAkq4Ag03qbx86ht24COn1AprZVordtB1w1cw2UsY/87QNSbocHVDS8WQHh6S3WV+1DAVngUOtAJrZWlG7cQV3b1qdNVvAPUm90QAlOWAu0F5CALuB6ZgKjgKnAjeBz26286bZFbycLjSbmGE385IqZQKumtn3wPm+hQwAI4UBJV0ErudRL2BsLYaCtRZMOMtu1vPUocuZ3k3gTYunkE/FYUnncwNKOgqM57SX0DTfL6LgdOJZReqvHq9T7KZWBDC3vaTYzbKna0JST8uAiUfNe7o+t2AvIQvrASbzKHgTOBMpvblvNy7G5bSFNH8BvsUCTLOXFYqFb4HnJN0g5beqr/7OAr4JRwCTVASwK0OQj0GAGZI7oI9yogo8Ck1xjfbHiKSBpoCSDgMTBwBY8Z0qPgUnk1o7iKiG1GBa/V0zs6+xSCS9Be40NE9J6jaz7SwFfYf3Rky4JBY9bb2NlxPXsKph4ELgl5UB+F8GXWB6ywD8AFgMwN3kqhQ1zGwPeOHpupS84vgXUNJp4JZnwjsz+1XSrl1s5sOuYXNU2pTeeiwBe1lpdgH1t1QWnZn98J2/wG1J/fuAkrqAKc/AtC8oO80d9b9a6gqOA8d86iXF3G7A/Tp0B5Xev+I98NPTPiOp02WcHnv8efdWapjZLvDS09UH3P0NRXvG+VQ+sLgAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAC9ElEQVR42sWZO09UQRiGnx0QRFGMGDFeoiZKTLDARIwYjATCVfY3TDMTf4A/wd4/MNNMY20l4K0AL42JjYJWgqVUGiggJFh4lug65+zsOXOWr9rMZc8z7/fNO7N7KuQMreQA8Clw+GNj3cM8zxHkj7kmxlbzPiQ24HPggaf9qlayv2WAWsmTwLCn6ynwBNgpqHhhBWeBNk/7vLFuE1iOlWYRMb2rxrq1Gqinf0Qr2VM6oFayHZjyqZfyuRbtwHQrFBwBTmQBGutWgPUYdZgH0FdLW8BShqK1mNFKtpUN6FPhlbFuJwCwN2X3xwHUSl4B+hvU3z50DLsREdLrBTTWbaXYTcsBV4x16ynjn3naBrSSl6MDaiWPJzs4JL2N+ubKUHAaONQMoLFutajdiIK7N63OGi3gnlayOxqgVlIAM4H2EgLYCUzGVHAYOBW4CXx2s503zaLg5XS+0cQMu5nVSlbKBFwx1n0PnO9bSB8wVBhQK3kRuJ5HvYCx1RgKVpsw4Sy7WctThyJnejeBN02eQj4VB7WS53MDaiWPAqM57SU0zfeLKDiZeFaR+qvF6xS7qRYBzG0vKXaz5Oka00p2NQ2YeNSsp+tzE/YSsrAuYDyPgjeBM5HSm/t2I2JcTptI8xfgWyzANHtZplj4FnhOK3mDlN+qvvo7C/gmHAE2tJJFADsyBPkYBJghuQB6KCfmgEehKa7S+hjSSvY1BNRKHgbGDgCw4jtVfAqOJ7V2EDEXUoNp9XfNWPc1FolW8i1wp655QivZaazbzlLQd3ivx4RLYsHT1l1/ORF1qxoELgR+WRmA/2VQBKa3DMAPwEYMwN3kqhQ1jHV7wAtP16XkFce/gFrJ08Atz4R3xrpfJe3ahUY+LOo2R6VF6a3FIrCXlWYRUH+LZdEZ6374zl/gtlaydx9QK9kBTHgGpn1B2Wluq/3VUlNwFDjmUy8p5lYD7tehOKj0/hXvgZ+e9imtZLvIOD32+PPurdQw1u0CLz1dPcDd340WzG8SuQTEAAAAAElFTkSuQmCC"},"B":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACzElEQVR42s2ZT0hUURTGf2OjplNUyGkRLVpU9MdAKNJISILMIIiCaFEhmBAVERFU2yDoDwltlBYFRi4jqo0GJaUuCiOCiFpkBG3KD0wJR8R/LXyCDffNPMSZdz94m3M+3nz33XvunO/eBPNgZrVAL4uDKWAYGAIGgXfBu19LGo76kkQeBYZhFLgPtEj6mYtcROGRAi4AX83suI8C51AOdJjZrWykJf8NLZVaAxwFxoNnCigJmaaxeTzXkwCSEYTuTqVSSqfT/TnXYCbMrAHodKT2SXqZ65fNrBzYAuwBmoFNIdRJoFrSh4JOsaS0pPeSWgKhzcBfBzUJ3Ih1DUqakfQAqANGHJR6M6uOvUiCaWwKSR/yooolPQHeOlINPm0zjx2xjT4J/OTaxIPK90LgYEh8pS8CS0Pi474INEdsBvjji8AaR+yLpOnYBZpZAjjsSHX7UsUngr++zOm9F7tAM6sC2hypDkmfYxVoZseAN8CyjNQ34DwhXUQ+BZUA64N26xSw3UEbAPZKGllMgU/NbDIHJxm099nwDGiSNJTtJQv1FQvFDNAD3JTURYRRFhqNkh5FJcexzbSaWbuZbfNV4HKgEfhoZq1mVpqPKc5pmsysGKgIqrguqOJ1GR/nLLDDzOrDqrgoj13zhKRfkvokXQc2ABeBiQzqTqAz2JJiNU2Tku4CBxwidwHXvFiDkl4Blx2pS2a21pdmoRX4kRErBs744uomQkzTfp9MU58jVhX0il4I/I37MGuVLwLHQuJlvghcHRIf9kVgpSOWljTqi8Ajjth3L6rYzA4CtY7UCx9MUyXQHpJ+HrdpOsnsNUeFI90rqafQpqkM2DzPNG0NoU4DV4lwkVMDdEUwPqPMHnznOhxaGnEsVyTdjtKwJoEVeTZNmWgLExf3NjMOnJZ0zjdXNwY8BO5IGojTdk4ze90wd9vZH1Rwdzajnol/+oHlPSoV4okAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAC0UlEQVR42s2ZT0hUQRzHP1trpiUVUqcOHSL6YyAUaCAkQWoQRF06VAzYDJElHQLr2qmS/l1WgpnAIY8R1SWDktKgIokgog4ZQac8mB5WMbe1g09YHvN2X+Lumy+8y/c7b/b73sxvdr5vUhRASdECjLA8+AtMAhPAOPAu6PulNnYybiepMhqMQhYwwE1t7M9SjVdQeawBLgBflRQnfDS4iFpgQElx/X8M5oCpgitbZJimSlyzMY32KCm6Ys3BMJQUHcBTh3RQG/u81C8rKWqBncB+QALbI5rmgCZt7IewkC7nGGpjp4FRYFRJcQvoBG4DdQ4fV4H2xOagNnZeG3sPaA2mQBhtSoqmxIskGMbOCPmIF1WsjX0IvHVIHT4tMw8c3DafDH5yLeJB5XthcDyCX++LweoIftYXgxsd3Dzw2xeDzQ7uizY2n7hBJUUKOOqQhnyp4pPBf3R4eO8mblBJ0Qj0OaQBbeznRA0qKY4Dr4C1Iekb0O26J11mQ6uArcF26zSwx9FsDDigjZ1aToOPlBS5Em3Swfa+GB4DndrYiWKdLDVXLBXzwDBwTRs7SIynrDSENvZ+3MZJLDMZJUW/kmK3rwbrAAF8VFJklBTV5RjikqFJSVEF1AdV3BpU8ZbQy+kC9iop2qKquKypLtRXGjgP9AJVIfkN0KqN/ZNkaMppY+8Ah4C5kLwPuOLFHNTGvgB6HNJFJcVmXzYLGeBHiKsCzvqS6uYiQlO7T6HptYNrDPaKXhj85eBWAht8MTgTwdf4YnBTBD/pi8EGBzetjc36YvCYg/vuRRUrKQ4DLQ7pmQ+hqQHoj5CfJB2aTrFwzFHvkEe0scOVDk01wI6C0LQromkeuBznIKcZGIwRfLIsfPgu9XFodcxnuaSN7Y2zYU0D68ocmsLoizKX9DIzC5zRxp7zLdXNABa4oY0dSzJ25lk4blg87XwfVPBQsaAexj9GWdi5bSLcAQAAAABJRU5ErkJggg=="},"C":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAADjklEQVR42u2ZS2hVVxSGv6gV48ZoTZdSRJAoVahSGxsQtFUkalGi9EEtioPSUjsttKhUQTIQO6lQBKFgSwcVQdE2tor4QEodKIgaTYqigQzqoz+iQXOqVRIH9wwk7H3PPtdzSQb5Z3etvTnf3c+116qhQplZHbACeAeYAzQA44ExwEOgB+gGLgFngcOSevJ+p6YCsNeAb4CPUphYPQbagFZJVwoHNLPRwDbga2AUlasP2AN8Kam3EEAzM+AQsIDidA1YJenqCwGaWT1wGpgd+eEEqI3883eApZIuhxqMyIAbCRwsA/cE+B1YC8wAxkpy6RKYArSk0/kg0H8ycDSdofwjaGatwNaA+wKwXlJHxCxMAr4D1gWaHJe0zOcYmbFbfwm0+RVYLul21JwnSW+SJAedc/8BSz1NpjvnOpIk6YwGdM59D8wNjFyLpEd5d0WSJGecc7XAQo97nnNuV5Ik/Zlr0MymAmsCR8T6mOOhjLYAF32jCLwbu0nWBkb355g1V06SnqaQPn0aC/h+wP5tEQegpD+ALo+r2cxGlQU0s/HAPE/n9qxDNaf2e2x1QFPWCDYFpvcAxepUwD47C/D1QMdzBQNeCNhnZgE2BDq2F0knSYEbpj4L8FWPrUfSLYrXXY9t3PM/fGHTBI/tHtXRxTSwfV43swBrPbYH1aCT9F5WG98U+6AfMkgaERnh9A0lwCGlYcBhwGHAYcBBAOwfSn/E9+GnvkfeYAH67t1HWSFQUTKzfcC0Aea/JH1VDvB+4K1QDTV5AuR/sqbYly2oN7OXqwBYlxXa+QC7Yx4zBUzvWOCVrCjbBxh6mL9R8OjNCdivZgGeD3RsKRhwccDeURZQ0r9Ap6fjkjSZWZQ+DETu52IO4N8CR9LnBa2/+cBbHtcJSU9iAPcG7JvKZUMj4WqAHQH3nqgrLC0TnAgcC7vN7EWuvo3AIo+9CziS547dFriXPwB2Vjh6XwDbA+7Nkvry5qh/BD4JuI8BGyR1R4BNpJS6+yzQ5KSkZipIoo9Ld9UswiWHNkqptPPAbUmP03U2GWgEVgEfUyqT+XQTaJR0p9I6SQPwJ6WyQox60+xEzDoV0CypveKAVVJXuqg7IwFdJNx1YFE5uOhAVNINYD7wQ2Dj5FE/8BPwpqS/qUK1sxHYDKwGXsrR9X9KValWSZeoVjl2QA1vJfB2GulMo5S6G52uw4H14jZJ9/N+5xkpVglbwOdHPAAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAADj0lEQVR42u2ZW4hNURjHfzOYjMm4DElS0xDKSIapkVzSuEQzchtyaSd7403KnaJ5EB54VNZC64EUuYxBCkleKM0FI2JqHozLJDMxcmvGw1kPOq119trHPs08zL/Oy/ftdfZvr/Xttb79fVmkqcD38oElwBxgClAEDAEGAt+ADqAFaAAeAzeEVB1R75OVBtgE4ABQpWFc9ROoAaqFVM9jBwx8Lwc4DOwC+pO+uoAzwA4hVWcsgIHvjQSuArOIT6+BSiHVq/8CDHyvAHgAFDve+DuQ6/jwH4EFQqpntguyQ+D6AVdSwP0GaoF1wHhgkJAqT4fAGKBCL+dXy/hRwG29QkaFxdIh/ZaaVAdsFFK9SHYIqbqAVv2rDXxvP3ACWG/4nzHAeWBhpCXWb+szIMfgvgZUCal+R9wBdgPHLO7VQqrLUZb4kAWuDtgQFU7P7PEUgEcD38t2Agx8byywxrJFbHTZHlLoIFBvsI8DFrvO4Dqgn8GuTDEXcRb/aEiTNrsCrrDYj8WxAQqpbgLNBld54Hv9UwIGvjcEmG4Y3Bi2qUbUJYMtHygNm8FSy/JeJl7dt9iLwwAnWwY+iRmwzmKfGAZYZBnYGCedkKrNcsIUhAGONtg6hFTviV+fDbbBYUfdUIPtC5lRvU5s/1VrGGCuwfY1E3RCquVh12Q7JhDf6CFlOyYQXb0JsFepD7APsA+wD7AHALt704OYbvzHYMvrKUDTufsjLAWKS4HvXQQKk8yPhFQ7UwG2W74VMqFSQ4L8LmyJP5iy3MD3hmUAMD8stTMBtrh8zMSwvIOAEWFZtgnQ9mE+NebZm2KxvwoDfGoZWBEz4DyL/UVKQCHVJ6DJMHC+LmbGpVWWzP2JywZ83bIlbYkp/sqAGQbX3eSqmQ3wgsW+N1U11BEuCzhqcZ9xOsJ0m+CuZVs4ZarjRdAeYK7B3gzcinLGHracyyuBk2nO3jbgiMW9T5eO3av8ge+dBTZZ3HeArUKqFgew4SRKd77lkntCqvJ0iujbgZnAJINvEdAU+F4NiVLaU+CDkOqnjrNRQAlQCawl0SYzqRVzcd25T1IEPCRRjXdRp65OuMRpG1AupGpMO2EVUjXroG5yBMxzhHsDzE0F55yICqneAmXAacuLE0XdwDlgmpDqJRnodpYA+4BlwIAIQ3+R6EpVC6kayFQ7NqmHtxSYrTOdQhKluxwdh8n94hohVXvU+/wFS9D32OLori4AAAAASUVORK5CYII="},"D":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACN0lEQVR42u2Zz0sVURTHPy9fpaEV2AELsVW4CsWVRLQMN6EE1n8gtKhFtWgXRJs2RT+gVbRpEwTZolWEQZFuTBcupCLCSoIvIqGYpS9bOI9quPcxE713bzAHZvO998x85sw9Zy7nlkiZmfUCU/y9rQOrwCIwD7wGpoExYFrSRp6bleoAWMs+AneAm5IWsjhsobHWCVwE3pnZGTMrxQZYtZ3AdeChmbXkBawAX367lj2+K6l51bmVHKCDwKiZlTOvQcea7AfGHUPDkh54fNqA/UAvcAQ4DrTXeMwVSRca9oklLUmakXRP0giwFzidRNll582sJ9galLQm6RbQn2Ry2pqS5AmbJJJmgSHgu2N4yMw6g2expEngticfTsZSZq4Crj/K0SgAJc0BE46hQ+niHSqCAC8cWmtSnqIAfOXRD8QCOOfRO2IBnPfo7bEAfvXozbEDbo8F8EeWDUxIQGLcUReABWABWAAWgP8RoO/ZG7EA+loe32IHXI0FcJ9HX4gFsMujf44FsM+jv40F8LBDWwbeBwc0sy42G0lpe5nuYYeK4FlPb/JJ8EJtZn3AKU+Bvh8U0My6gVFgm2P4kaQPabHcILCtwAhwGdiNuy9+yeVbrhNQtUfdw68e9Z4aLtckTWU9yDkIPOfP9mwr7i7/mmPJtOR88afAgKT1rBFsAnZluPGOfxDsx8AJH1zIMrMEnAOOSVqpNbHcYLBPwF3ghiRlcagHYCXZ0y0mQG/YPO18BkzmPe38CbWFn9r5MoH2AAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACQUlEQVR42u2ZP2gUQRSHvzMXYyT+gViIhFiJVTDEJohYBhsxCGo5zYxiY6FNOiHY2ChRIcVMkCkFwVhYiSgoahMTO1ERiUkQJAQxxMTkjMXtEV1mjl3J3YywD675zbzd7+bevBt+UyIVSopeYJJ/jzVgGVgA5oB3wBTwBJjSxq7neVipAYD1YgYYA25pY+ezJGyhudEFXAE+KikuKilKsQHWYicwAtxXUrTnBawA3/74LHpyl1LzanMrOUBPAuNKinLmGnTUZD/w0jF0Wht7z5OzA9gP9ALHgFNAZ53XXNPGDjUN0PGMVuA8cBXY5fnVDmtj3wSpQW3sqjb2NtCf7OR0tCSbJ+wm0ca+BQaBn47hQSVFV/BdrI2dAEY95XY2ljZzHXD9owxEAaiNnQZeOYaOpJt3qBUEeO7QOpL2FAXga49+IBbAaY++NxbAOY/eGQvgD4++LXbAtlgAf2U5wIQEJMYTdQFYABaABWAB+B8B+t69Hgugz/JYiR1wORbAfR59PhbAbo/+JRbAPo/+IRbAow5tEfgUHFBJ0U3VSErHi7SHHWoFL3msv0fBG7WSog+44GnQd4MCKikOAuPAVsfwA23s57RYbhJYK3COqsO6G7fDOuzKLTcIqOZRH2LDo95TJ+WGNnYy60VOD/CMv+3ZDtwu/6qjZNpzfvHHwHFt7FrWFWzBbXSnY/smLPZD4IwPLmSb+Q5cBk5oY5fqTSw3GWwWuAPc1MZ+zZLQCMBKcqZbSIDeU73tfApM5L3t/A1BJZnCBHIWzQAAAABJRU5ErkJggg=="},"E":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAlklEQVR42u3XMQrCQBSE4YlaCZLqHURsLcylcpjcJpBSSO4xjUXagL0gGJKVhf2nXLb4YN/Cm0pfEhFPSTf9L1fb0+fhQZkH4NacVt5fJM2JLMsewMH2gycGCBAgQIAAAQIsdmG9R8QrgWO03ewBPEqqEwAvzCCf5Mf0lCaAAAECBAgQIEBKUyJLZ7vNtTRJ0pkZLBL4Bn8YGpSIL11+AAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAnElEQVR42u3XMQqDMBjF8dfaSSieRVw76Elc4hU8jMmSoxQ6FupRHFwD3QsFSxMJ+H9jyPCDfIHvnfQlg+mfkhrtl9o6P38enpV5AP6by4/3g6Q1kSXEAD6s8y1PDBAgQIAAAQIEeNiF9TaYfkngeFnnuxjAQlKVAHhlBvkkG3OnNAEECBAgQIAAAVKaElkm6/yYa2mSpJIZPCTwDdW0GMImDwHrAAAAAElFTkSuQmCC"},"F":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAhklEQVR42u3XuwmAMBhF4avYW/1jCO5g6wCu6A6WLiCOcRtBbMVesBAfCJ5ThhQfeUCS6KCI6CRVeq/WdrMfTPXxAF4tOzl/lTQ/ZFnuAI62S7YYIECAAAECBAjwtw/WIiKmhyy17f4qMJWUv7lYnEEuya6BTxNAgAABAgQIECBAgAD/BNwAnY0VFrT/aT8AAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAi0lEQVR42u3XuwmAMABF0afYO4ngDrYOYGeTTJU0Kd3B0gXERQSxFXvBQtQgeG8ZUhzygSTRSda0vaRK8eqcD81xMNXHA3i37OL8TdLykmV9Ajg5H0q2GCBAgAABAgQI8LcP1sKadn7JUjsfhrvAVFIec7E4g1ySQyOfJoAAAQIECBAgQIAAAf4JuAOkERNEr/uImwAAAABJRU5ErkJggg=="},"G":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAADjElEQVR42u2ZSWiUSRTHfx0zRtM2LvBEh8jIkETFBUVxGXEZR4VB9OBFPOhBRcQFES/idtKbCgouI+rF5SDqOCAijKiDhzAwQUTFFUVQUP+BRGPiFuMc+jsEqer+vq+r0UPerV+9qvp11XtV73uVIaWYWS3wOzAVGAYMAfoAGeA10ALcBW4Cl4Hrkr4knSeTAmw+sAn4JWHXZ8BBYK+ktuCAZjYUOAL8RmnyElgj6WwwQDObCZwFBhBO9gPrJX0uZNQjBtws4CKQizFpJ/Ae+CGG7USgLpvNnm9vb/f6ZkURuGHAeaCXx0TAAeBXoAboKakaqAJGASuAawWmWAzsSbXFZlYJNAJjPCZHgA2S3sbYhRnAYaDeY7JQ0p9JATcCuzzNyyUdSxj9/YC/gOmeCK+X9C7WFptZFtjsmWtnUjgASS3AfOC2o7kGWJfEB5d5IvYWsD1t2Ep6AywFOhzNq82sIi7gUo9+k6TOUs4WSTeAk46mn4DZRQHNbAgwwTHAbUkXA52Bez36eXFW0HdTnA51Qker+MjRNDsO4GTPuGcIK1cduuFmVlUMcKRD1wrcCwzY6Ana2mKAP7uiN02qVESeePSDvYBmlgEGOjrdJbw0e/S5QiuYAyoTDFaKvPPoq7v++Bqmt6dTaxkAHwB1Dv2LQoCVnsHehqaT9NFz1BQ8ZjIF8rxvIhV859IN2A34raWylM5mNhloCMy0RNKJ7i0uF+CX7+2PfO2DHR67rEffQb6SlXZxckkB38dJgbrcp/8B/VIG2KjoKzHRFrcCrmJO3zLsXi6xD0aflE0Ou9oyAPZPG8VPHbrRZQAcmBbwjttl7MfAgBPSAjZ6bBcEBpySFvCax3ZRKDIzqwfGpQKUdAd47LCdbmahfHFN3PKz74Y45bHdHWD1RgArS72LDwEfHfo5Zra8BLgq4Dj+knI8QEnPyZd4XfKHmS1IAdeHfDF+fKhsZivwCvfLwDkz22Vm1QmeMRqAWV3UN8i/RpH6ncTM5gCXCvyRF+SrXueA+8ArSR1RCbmGfClvoaOk1wYMBS4Ak1InrJL+jiLOJ4OAtcAV4Dnwwczaow/9e+Qfa1z1xi2SmoIkrJIOkX/v+BRzvN5FbI4B+4Jm1JKOAtMorcrVCewAViQp5VUkqKX8C4wFVgEPE8L9A0yVtC1pnTFTwpk2CZgbOXld5I/VkSs0R6vdAJyRdDPtPP8DxFL6e6GICScAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAADpUlEQVR42u2ZSWiUSRSAv47RaLRxgREdIookUTGKG67ojNuASDzkIh60YKwSUQeRuYjLnMabCgrjVjVCMepBXEFkQHHBQxCMElRcRhTBgBu4xH1i9ND/IUhV9///XY055N361auqr6veq3r/qwwpRUlRDSwAZgAjgCFAHyADvAJeAreAZuAscEkb+yXpPJkUYPXAemB6wq6PgN3ADm3s2+CASophgAHmUpw8AVZrY48GA1RS/AwcBQYQTv4C1mpjP+cz6hYDbg5wGsjGmLQd+AB0j2E7GaiZOGHciatXm72+WVYAbgRwAujpMXkG7AJmA1VAD21sJVAB1AESuJBniiXA9lRbrKQoB5qAsR4TA6zTxr6JsQs/AfuAWo9Jgzb2eFLA34Gtnubl2tj9CaO/H3ASmOWJ8Fpt7PtYW6yk6A1s8My1JSkcgDb2JVAP3HA0VwG/JfHBXz0Rex34I23YamNfA8uANkfzKiVFWVzAZR79em1sezFnizb2GnDQ0TQUmFcQUEkxBJjkGOCGNvZ0oDNwh0e/MM4K+m6Kw6FO6GgV7zma5sUBnOoZ9whh5bxDN1JJUVEIcLRD1wrcDgzY5Ana6kKAw13RmyZVKiAPPPrBXkAlRQYY6Oh0i/DywqPP5lvBLFCeYLBi5L1HX9nxx7cwvTydWksAeBeocegf5wMs9wz2JjSdNvaT56jJe8xk8uR530XK6OTSBdgF+L2lvJjOSoqpQGNgpqXa2ANdW1wqwC+d7Y9864NtHrveHn0buUpW2sXJJgX8ECcF6nCfXgH6pQywuugrMdEWtwKuYk7fEuxeNrEPRp+Uzx121SUA7J82ih86dGNKADgwLeBNh+4HJcWPgQEnpQVs8tguCgw4LS3gBY/t4lBkSopaYHwqQG3sTeC+w3aWkiKUL66OW3723RCHPLbbAqzeKGBFsXfxHuCTQz9fSbG8CLgK4B/8JeV4gNrYFnIlXpfsVVIsSgHXh1wxfmKobGYT8BT3y8AxJcVWJUVlgmeMRmBOB/U1cq9RpH4nUVLMB/7N80cek6t6HQPuAE+1sW1RCbmKXCmvwVHSewsMA04BU1InrNrYM1HE+WQQsAY4B7QAH5UU76IP/dvkHmtc9caN2tjnQRJWbewecu8d/8ccr1cBm/3AzqAZtTb2b2AmxVW52oE/AZmklFeWoJZyGRgHrAT+Swh3EZihjd2ctM6YKeJMmwL8Ejl5TeSPlZErvIhWuxE4oo1tTjvPVxZO+Kj0InTqAAAAAElFTkSuQmCC"},"I":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAnUlEQVR42u3ZMQoCMRCF4T8isjZazR08gZfS0iPY2Xo5vcJUWmlnv2TB4LIo/q98xfAlpJoUKomIA3Bi2lwyc9MvZ3x5BH6a+UD/AG4Nc5bAotK3zLjXyjLGKSPiDOx69TMzO9+gQIECBQoUKFCgQIECBQoUKFCgQIECBQr8VWAZWIrvgSPTbvmvmbnlzW+IDliPcAEtM1a+wb8EvgCVxxRvmNn3DQAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAoklEQVR42u3ZIQ7CMBiG4beEkGHgGpyA68xsCiRHwGFxrdmx4BagwOGXLqFhWSC8n/zEn6dN1d9AJm1TH4AT0+YSU7fplzO+PAI/zXygfwC3gjlLYJHpS2bcc2UY45RtU5+BXa9+xtRVvkGBAgUKFChQoECBAgUKFChQoECBAgUKFPirwDCwFN8DR6bd8l9j6ra8+Q1RAesRLqBkxso3+JfAF4YeFG/62SckAAAAAElFTkSuQmCC"},"L":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAbklEQVR42u3SsQmAQBBE0VEEA+PpyMSSrMQmLECwpGnBwAYuETkR7v90N3gs26mQ7VnSWRgtSQ59WK+fBxAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIE2CpweLi/274qetYk2xvgVPlgIz/YHPAGI64LLFKfQmwAAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAc0lEQVR42u3SsQ2AIBBG4R9jQuFaNk5BA0M4iQU09A5g4moWLEBDDMaE99q74svljCoF71ZJd2W0xZQvfdiknwcQIECAAAECBAgQIECAAAECBAgQIECAAAECBDgqcG7cP4N3T0fPHlM+3gCXzgez/OBwwAKUigssEMzj+gAAAABJRU5ErkJggg=="},"M":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACAUlEQVR42t2YS27UQBRFT5pPBIIgPpePlEhJ3DM2gFgAC2DCiHWwIUbsgA2wA2YmnQgiQFdISFFQPiJhgAetwpCyq8q2KKkn1+329XnvVrXeCktL0hGwysXrje0XdFiSngFvI7/+0vZrgBn9VjXQPVEGnwMngTbv8ay2e14B71MNLoDdQLsl6W4Ggu+Ao1SDAHUkka4E6xwlBviQ0lOSVoDtQD60/SWXwTqx6R8B1yJeOivBeWJ5sxpMJViVNrgAzjITrLMZtH0CfAzkB5JuTIXg335wO8Fgndtgyl4YGjxtqUgRglXEHngHuB3Iu7Z/ToVg74AMQjAlIP8XQduHwNdA3pB0dSoE2958BmyW2mL6GOxzJofXz5uTaRCC/wyKpOvAw0D+ZPt4KgSTAlKcYGpAchGsSgWks0Hb34DvgbwlaZb7j2pfgm0PWAXWp1LirifK4CGJ7kNJV4CNP7vEB2MQbCvlJnAphV5OgvMSASlNsBrL4GfgR4SZ5ID0Mmj7HNgJ5JuS7k+FYGwfjkMwpg+bYdFWcP3AtsckuFzS9ZZRck2hCWuf0yTLFlOSYDW2wb1mOtCF4HAlbqYCe4F8T9LaVAhelORqVIIRe2Fo8BjYnwRBSQLWAn1h+2wqBLMFpATBx8DTXAEBuJxgcIffc+vll3zSfMYn2EwH9hPaIWr9AthwnkjwVkqkAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACFUlEQVR42t2YTUocQRiGHyc/oiSG+C8oqD27XCB4gBzATVZSm6ozeJiqTYErb+AFvIG7jqMkkgQJCGJQQ9SFvRiKjlZ3VXUXKZjN29PTbz/f91YN3wRjS0lxDUzy/NrXxn6mwVJSfAIOPL++o43dAxjQbhUd3eNlcBu4dbRhi2fV3bMLHIUaHAEnjvZOSTEXgeAhcB1qEKD0JNKUYBmjxABfQnpKSTEBbDrylTb2RyyDZWDTrwBTHi8dleAwsLxRDYYSLFIbHAF3kQmW0QxqY2+Br468pKR4kwvBf/3gZoDBMrbBkL3QNfinpiJJCBYee+As8N6RT7Sxf3Mh2DognRAMCcj/RVAbewX8dOQ1JcXrXAjWvfkAWE+1xbQx2OZMdq/fVydTJwSfDIqSYhpYduRv2tibXAgGBSQ5wdCAxCJYpApIY4Pa2F/AhSNvKCkGsf+otiVY94BJYDWXEjc9UToPiXcfKileAWuOfK6NveyDYF0p14EXIfRiEhymCEhqgkVfBr8Dvz3MBAeklUFt7D1w7MhvlRSLuRD07cN+CPr0YTUs2nCuX2pjz/skOF7S1ZpRckmiCWub0yTKFpOSYNG3wdNqOtCEYHclrqYCp448r6SYyYXgc0kueiXosRe6Bm+AsywIKikWgBlHH2lj73IhGC0gKQh+ALZiBQTgZYDBYx7n1uMv+bH69E+wmg6cBbSD13oA4H6eSM/8i8MAAAAASUVORK5CYII="},"O":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAADlklEQVR42u2ZW4hWVRTHf984OVOnGW+sISk1RUVMkojMCwMWJSKaN5ToYUCCKIaEKIiihx4zKsRAEIJ6kaBGIcS30bGEeRhxUAcvqBEK4tSidJw8Nfcezn4Q2+ucfb5zPvFh/o9rn7P376x9W2etClVKROYBG4A1wBJgLtAE1AN3AQV+BU4BXcDPqjqWd5xKFWCvAB8Da3O+fxPYD+xT1TulA4rIbOAAsIli+h1oV9VDIQ9PCYRbAZwAnqe4Hgd2Rok64zguBigiLwLHgJkBg48Dw24dZmkN0BLH8dG0h+oy4OYAR91X+3QL+AZY5zZJg6o2ArOA5cBHwLmUId4RkQ+qWoMiUgFOui/16Xu3lm4FzMIuYC/Q7GkeBVaq6um8gG867/j0vqp+lXP3LwS6AfE09zjIiaApFpFHgE+NsfbnhQNQ1avAFmDI07wCeC3PGnwdeMpj/w14r9rtq6rdwB5rVvIAthn2T1R1uOAx84W7Ze5Xq4jMzwQUkenAS54OrruNUUiqOuhuFJ+2hnhwrXE+dvgWcZX6wbC/HAK40ni5oyQ4VPUCcNHYLJmAzxhnVS/lqsd/gEhLFuACj+2yqg6VDNhn2BdkAc722C5Svi4Y9ieyAKcbd27Zum3YZ5iAItJgXH+DNQC0gtbGNA9aYdLfNQC0PnpqGmAlJc4rW+MhEVYdD7kmAScBJwEnAR8w4MQD/BCrz4m0h0aNl6IaAFrJgBET0MV8Pi821QDQ6vPfLDcPeGzNNQBsDgnDfID9HtvCGgAuMuz9WYDXPLalIlL2Rllm2K9lAZ732B4FFpcM+KxveanqjSzA00aHm8oic39uvt/b3pCzqMvod0eJ3ttmJAe6MgFV9SZJZv5+veBSwUW9Vwe8bTQfCT3ND2InfoqqjST7+r/fUFU9Ewr4rXEetopIe8HaymdG815Ck+hxHA9FUTQVf5ZrfRRFfXEcX8oJNws4DjyNP+/4VhzHY3mCgM+BK8Yl3yEiX4rIY4FwG4GzJBUpn961UiuVjI6fI8krN2JXj34EDgOXgT9UdUxEpgFPAq8CO4HVKcN8raq7qbbSJCKbXeqtPkedpDFw5o8A21V1pOqAVVV/Ikl+3wmM8ULhDgI70uDy1uoWk5QlWgseMwPAh6p6gLJqdW5n/xlF0XcklaN5+KsAafoL2Ae8oaq/UKty7D0eXURSL17lduccFyVPAf65p17cS1KI7MyaTp/+A02D/Xk68XQzAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAADm0lEQVR42u2ZXYhWRRjHf+/uqqvmZoimqImiS5jYF5kfLGioF5GpxUZ44RDNgCIGoRGKF132YSErCjIDOYEIugkSQRfJVoIXii+ppGCGKIhf+G2Yn+vFOZDYPOfMed/zShf7v3zOzJzfmTnPzDPPU6FGGa3GAW8Cs4DngeeAIUAL8DdwEfgLOAD0AL9a5+8XfU+lBrC5wFpgdsH+Z4HNQJd1/nrpgEarUcAWYAH16Tywwjr/fWmARqtpwG5gJOXpK+BT63xvVqOmCLjXgT2RcA+A25GAnwCb8ho15cCNBX4EnhKaXAEcMD91kgHW+VZgGPAisAY4nPGK5Uar1TUtsdGqAuxNvTSk7em/dCViFT4ANgBtgcf3gOnW+YNFAT9MZyekVdb5bwp6/0RgHzA88Hh/CtkbtcRGq37AZ8K7NheFA7DOnwAWCf/oNODtIv/g+8CYgP0k8HGtbmud3wd8Ia1KEcClgn2ddf5OndvL+vSUeVwdRqvxuYBGq6HAnMAAp1PHqEvW+RvpiRLS4pgZnA00B+zdeZtqAe0Q7G/EAE4XOneXdYRY548CxwRnyQV8QdirqpSr/QHbcKPViDzACQHbcev87ZIBjwj2CXmAowK2Y5Svo4J9ZB7gUOHMLVtXBfszIqDRaoBw/N1oAKAUtLZmzWCL0OlmAwClj+6fBVjJiPPK1oOYCKuJ/7n6APsA+wD7AJ8wYO8T/BBpzN6sRveEToMbACglA+6KgGnMF5rFIQ0AlMb8J2+arwVsbQ0AbIsJw0KA5wK2iQ0AnCTYz+UBngrYJhutynaUKYL9VB7gHwHbQKC9ZMCpod/LOn8mD/CgMOCCssjSm1voeluN2Yt6hHE7S5y9d4TkQE8uoHX+LElm/nG9lqaC6529JmCZ8PiH2N18G3Lip14tJcm+/ucaap3/PRbwW2E/7DBaraiztvK58HhD9HmY1jGkJGWX0WpxDXDDgJ+AZwnnHb8rGgR8Cfwp9Ok2Wn1ttBoUCfcWcIikIhXSSim1UskZ+GWSvHIrcvVoJ7ALOA5csM7fN1o9DYwG5gHvATMzXrPROv8RtRZyjFYL09RbS+Rd907GB4W89l3r/N2aA1br/G6S5Pf1yBgvFm4b0JkFV7RW105Sluioc5u5RlIC2xLTuDl21Gr10KVXX3lpK0nlaBzhKkCWLgNdwBLr/G80qhz7yIxOIqkXz0i9c2waJTcDt/i3XlwFfgF+zlvOkB4CPxr0Q1j+UJUAAAAASUVORK5CYII="},"P":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAB0klEQVR42u2Yv0tVYRjHP3oFgxBF+kKTQZsiBBItQekSLeLQUkMQGP4HCS2CmyANDQ1R4OCSm5PQeJEIGionbQluRAhfTOP6oxB/DJ6WOC/e2/1x3uH9wlme5znn/Zzn/XGe53SQI0mPgVc0pkOgCvwEvgBrwArw3vZxrQ/paCFgSN+AZ8BL23/OC+6k/RoAngMfJV2PEfCvhoBVSfeaCVgFftVwVYGTGp53AXgj6U4ooKtOwBu2N2oJlFQC+oERYBSYBBRgWJI0aHuzbVNs+8hnemv7abb25gKZ7QPmC12Dtn9noFOBkAeSrha+SWy/BhZyXCXgUSy7eAbIOwPHowC0/R0o57iGJXXHcg6WAzv6SiyAPwL23lgAdwL2aKY4NPZJLIB9AftBLICXA/btWABvBrJXKRxQUj9wO8f14d9qu6gMTgMXc+zLhX9JJE0AT3Jc+8Bio/VgI2DdWeZmAol5YXurLYCSOoGerGC9BtwCHgKXArdUgNlmVNTrkpr9PrvAhO292JomgC3gru21GLu6ctbjvIut7fwM3AfGbH89L7jrP9rO4zp+fexm07gBfAJWbK/XM2DL2s5WlzzRKAEmwASYABNgAkyACTABJsCodQrtPouFgGWTwgAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAB6ElEQVR42u2Yv0scQRTHP6cHCiIeomBlIJ0hEAhiI/ijkTRikSYpwgQy439ggo1iHVJYWMgMyGCjXSrB8hARLEys1EYwiASCUbnLDxF/NGsjM7ind7dTzBe2ee/tzGff7My+tzkcUlJIQPM4XQAl4DewB2wDK8CGNvYq7SC5GgL69AP4AsxrY8/vC26g/uoGZoEtJUVviIC3egasKSleVxOwBJyluErAdYrxmoElJcWILyBfIWCfNnY3TaCSohFoB14CQ8AHoNPDsKyk6NHG/nwsYGppYy+BX8AqsKqkmAGmgU+OzVkAPgPvMnsHtbH/tbGTwLgn5K2S4mnmm0Qba4AFh6sReB/KLp4CXGfgaBCA2thDoOhwPVdSNIVyDhY9O/pJKIBHHntbKICnHnswS+yb+zoUwILH/i8UwC6P/SQUwH5P9g4yB1RStAODDtfm3Wo7qwx+BFoc9q+Zf0mUFGPAhMP1F1isW7nlAGtKMjflScycNva4LoBKigagNSlYXwADSa3X4bnlAJipRkW9o6So9vOUgTFt7J/QmiaAY+CVNnY7xK6umPQ466G1nd+BN8CwNnb/vuD8A9rOqwp+fZSTZdwFvgEr2tidSiasWdtZ65InGEXACBgBI2AEjIARMAJGwAgYtG4ACOqCIZTZPj0AAAAASUVORK5CYII="},"R":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAB+UlEQVR42u2XP0hWYRTGf375D/oilZ5KggKHKBD6Q9gQVNBSS04RDSFh2NqS4OJaODtEWo1NgotDW5EQNTVVLg2hDT0kgUFKWg1+QsT7ft74vu59h/uM5xxefvfc99x7nhYCknQTmKIx/QBWgC/AAvAGmANe2f6V9ZCW/wgY0wdgAnhoe3274gr5qw+4D7yW1J8i4JZOAC8lXapX1PqPh64APzPUVYBq7Ar9oSowK+mC7flmAA7Yfp+lUNIOoAc4CZwHhgEFStuBGUlHbS/n9optb3hTT22PAQeBe0BogvcCdwu9g7ZXa6AjkZIbkg4UPiS2p4HHgVQbMJTKFI8Da4H45SQAbS8CzwOp45JaU/kOhgA7gEOpAH6KxLtSAfwaiXemAljJssAUCdgVia+mArg/Ev+cCuCZQGzZ9sfCASX1AOcCqblU/iSjwM5A/FHhgJIGgTuB1LztZ43ug42AddQ6Nx5ozHfgVjMW1qwwFWBXbWE9BpwFrgN7Iu7vqu23zQB8J6mZz7IEXLP9IkXT9AQ4Ug+uaMA+YEjS7lQBTwOTwIKkgbxtZ2gBqEYasq9mPQ/b/pab7QxMdidwEXgQsJ+9wJWQV8nb1c0CtyMlp1K5gzMRb9ydBKDttb9XqnosRU3xOg2u3cmoBCwBS8ASsAQsAUvAErCufgNZoY08jsFaswAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACCElEQVR42u2YMWgUQRSGv7tEc2DEGDQqFkIqhUBUJBaKWmqjlYiFPMQZbW2i2ESsBGsLcUZlKquDa1KkUxREKyv1GgvRFBEP9QoTTKLN2YQ3l5W77E6xP0zz3mP4dpi3+/6toMgaMYCjN/0G2sA3oAm8BWaB186HP1k3qWwgYEwfgXvAI+fD8nrFVfLXOPAAeGONTKQI+E+HgFfWyJl+AraBHxlWG8hyz4aBhjVyPFYw+J+AU86HD1kKrZEBYBQ4DJwCrgA7ldLNQN0aOeB8aPUKmFnOhxXgKzAHzFkjd4DbwE2lOceAu8C1wu6g82HR+XALuBopuWyN7C28SZwPHniipDYBkkoXzwBLSvxsEoDOh8/AcyV10BoZTOU9qAEOAftSAZyPxEdSAfweiddSAaxmGWCKBByJxBdTAdwdiS+kAnhMibWcD58KB7RGRoGTSmo2lS/JDWCLEn9cOKA1cg6YVlIvnQ/Pchu3FLChzsnNKAfzSxu1NgzQGqkCWzsD6yRwArgE7Ii4vwvOh3f9AHxvjfTzWb4AF50PL1I0TU+B/d3gigYcB8Qa2ZYq4FHgPtC0Rqbytp1r109gNbLnro71HM7VdiqdXQNOAw8V+7kHOK95lbxdXQO4Hik5ksodrEf+OmxPAtD5sLR2pOrGUlQXL9Pj2J2MSsASsAQsAUvAErAELAG76i8xnZW8zHwogQAAAABJRU5ErkJggg=="},"S":{"left":0.0,"top":-0.7272727272727273,"width":0.6060606060606061,"height":0.7424242424242424,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEeElEQVR42sWZW2xVRRSGv7b0UBmoFxxQEEVLLX3Qtoox3nlAxQvBGA0EaoiJVgViiD6gvnqLMUSf5MWQRkmaaFCjoKYhajWCt4aAxoJJg1GC1L9BKnVTWml9OGPSnMycs/fpHF3Jfpm1Z8+3Z2atWWtNFWWItbYKuBpYBiwBLgcuBGYC04Bh4CRwGOgDvgI+lnQs61hVGcFmAuuBDqAh41gTQA/wKvCBpPGogNbadcBLwFymLt8A6yX1ThnQWlsHdAKriCtngM2SthR7qaYE3AzgQ+DuDIOOuH1Y6uergduMMXOTJNlV7KVisg1YWkR/AHgWuMEtfU6SAXJAI7AGeMMZTEges9Y+n3mJrbXtwJsB9UHgGUnvpty/9cAm4GmgLmBAyyV1pwK01uaci5jnUXcD90r6qwz31AzsBC7zqH8GmiSNplnilQG4z4AV5cABSOoDbgKOeNQLgYfS7sF7AsvwaOEflgF51O3NCY+6Iy3gtZ62vZIOxfAvkr4A3veoWqy1jWkAF3jaeiP7wc40k1MdcMw5T8cTkQG/DLQvLjWDoVmtj0knSc6pF8p5pWBOBTbwxcSXPz1tZxUFlDQBDHg6LnNHX0yZKHV4hJbze0/bLGBDZMDDQH/BM5DmJHkKeNGjGgPulLSb/0i80Ywx5hfgcc8M1wBrjTFVxpjvkiQZ+18AkyQZMsYsBNoCVr4U6DDGzDLG/JYkyWClAItFM7OB/cD8FN/5AdgNfAp8LWmg4oAO8krgE2B2xu/+7n5unzuBeiX1Rwd0kIuALpe9TUWOAe8AO4AeSWeiJU3W2mpgo4ueY5wo/cBzwHZJf8dMO892MdtGF79NVQ4CqyQdiAI4CbTG5SErXEK1eAqQp4AOSdujAQYsvs09rUAL0OSyuzQyDqyUtLMigAHo6S62u9XNcmuJLsNAa6G1VwzQA7wEeBJYXeS1LklrvICuINTk6TQoaTAi6C3AW8CcQHTTPDm1mHzWTneVqMJnU+RAtQe4ORChVznD84ZbE2VWH8qBPARsDqhvDw0+GoA8p0LbshMY8rQv8gK6SHq4VI4QcRZHXXBRKHOKLZ+vAjqvgsbtqzDMcKUXL+CPng7XOJ9WCRku4ri9gPs8L9cFKg0x5HxP28jkAKIQ8KPAhx6sEGBDqWUvBPw2sC/arbWXRD5Z6oEbA9G5H9BZ8mueTtOArS4ujCUbgFr8Jb6iTnhrwD/dAbwcafYayVdbfcaxo2hWlyTJiDFmCLjL84HrjDENxpjuclNOa+0Cl2Bd4FG/LWlbmry4l3wl9FKPugW4zxjzhzGmL0mS8bRBrjFmLfm6oM+3ngbuT5LkeNq081xgbyDC+Vd+dQN+7gxsUNJJ17/WuZE24HrggRIFqCckvZI17byI/D3JFRlWccw9WQpNr0t6OHOkIumIcwXvZRisNgPcOPAC8EiMu7rVwJaIZ/NRYF2pQlTWtDMHtDsfdlWZYPvJ33h2STod9Tq2AHY+sNwZQbOz+HrydURcxHwCOE6+3rgH2CPppyzj/AMyEWVHAA2+mAAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAxCAYAAACoJ+s+AAAEi0lEQVR42sWZW2wVRRiAv9PSUhHrBQMK4q3U0gftsosx3n1AxQvBGA0EajYku1WBGKIPqK/eYgzRJ/swk6ajxCYa1Che0hC1GsFbDzlobDFpMEoI1QZBaiit9PhwxqQ5mdmzezpH/2Rf5t/Z+XZm/n/+/58cVUgchTkgAFYBK4GrgIuB+cAcYBw4CRwChoCvgI+FVEezjpXLCDYf2Ax0AS0ZxyoCA8ArwPtCqmmngHEUhsCLwCJmL98Am4VUg7MGjKOwCegF1uFWzgDbhVQ7kl6qrwA3D/gQuDfDoBN6H1b6+TrgjsD3FuXzhQ+SXkqSHuC2BP0B4BngRr30jUKqs4FGoBXYALymDcYmj8ZR+FzmJY6jsBN43aIeBp4WUr2Tcv82A9uAp4AmiwGtFlL1pwKMo7BRu4jFBnU/cL+Q6q8q3FM7sBu40qD+GWgTUk2mWeK1FrjPgDXVwAEIqYaAm4HDBvXlQJR2D95nWYZHyv+wCsgjem8WDequtIDXGdr2CakOuvAvQqovgPcMqo44ClvTAC41tA069oO9aSanzuKYGw0djzsG/NLSvrzSDNpmtdklnZDqd+3Uy+WCSjCnLBv4UtzLn4a2sxIBhVRFYNTQcZU++lxKsdLhYVvO7w1t5wBbHAMeAkbKntE0J8mTwAsG1RRwt5BqD/+RGKOZwPd+AR4zzHA9sDHwvVzge9/l84WpWgMmBQs9wKaEvmNAN/CGkGr4/wBcABSAJSm+8wOwB/gU+FpINVpzQA15DfAJsCDjd3/TP7dfn0CDQqoR54AachnQp7O32chR4G1gFzAgpDrjLGmKo7AO2KqjZxcnygjwLLBTSPW3y7TzXB2zbdXx22xlGFgnpDrgBHAGaL3OQ9bohGr5LCBPAV1Cqp3OAC0Wv0I/HtABtOnsLo1MA2uFVLtrAmiBnqtju9v1LHsVuowDXrm11wzQALwSeAJYn/Ban5BqgxFQF4TaTCeGkGrMIeitwJvAQkt00z4ztZh51s7VlajyZ5vjQHUAuMUSoee04RnDrWKV1YdqIA8C2y3qO22DT1ogz6vRtuwFThjalxkBdSQ9XilHcDiLkzq4KJeFSctnqoAurqFxmyoM83TpxQj4o6HDtdqn1ULGExy3EXC/4eUmS6XBhVxoaJuYGUCUA35k+dCmGgG2VFr2csBvLfuiM47CyxyfLM3ATZbo3AyoLflVQ6c5QLeOC13JFqABc4kv0Ql3W/zTXcBLjmavlVK11WQcuxLTzny+MBH43gngHsMHrg98ryXwvf5qU844CpfqBOsig/otIVVPmrx4kFIl9AqDugN4IPC9PwLfG8rnC9Npg9zA9zZSqguafOtp4MF8vnAsbdp5PrDPEuH8K7/qAT/XBjYmpDqp+zdoN7ICuAF4qEIB6nEh1ctZ085LKN2TXJ1hFaf0k6XQJIVUceZIRUh1WLuCdzMM1pABbhp4HnjYxV3demCHw7P5CBBWKkRlTTsbgU7tw/wqwQqUbjz7hFSnnV7HlsEuAVZrI2jXFt9MqY6IjpiPA8co1Rv3AnuFVD9lGecfsJ1g7j7A+5kAAAAASUVORK5CYII="},"T":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAeUlEQVR42u3SMQqEUAxF0eswiAO2WaWVO7Fwl6nEysqpBBErFRS5r3sp8k/gF6wSETUwcm/azOyW8uHhEXg2302fgeHAnh9Q7syP7JrWpbjiyojogWb7UGZW/kGBAgUKFChQoECBAgUKFChQoECBAgUKFChQoMCXAv9BpQ5IgGgT1AAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAAAfUlEQVR42u3SoQqAMBSF4TMRUfAdV7Zk8k0MNlf2iGIyaRLGMKmgyH/aueHuuzCjJN7ZVtKid9NPIQ5HKfTxALybMuubpPnCnkZSdTK/smtNi3niSu/sKKnLH5pCrPmDAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAPwXu00UOSFDbSZoAAAAASUVORK5CYII="},"U":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7272727272727273,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAAB70lEQVR42u3YP2sVQRSG8WfvVZLr+icpDoRYKEQs7AJqZYSQIvgBRIKVooWFvcFKFBTL1GqVQlKpZVARozaCNpIioNgohFckgneJxhibtYkz2dlkFYsz3Z45e+a3MzuzsBnrmplNA6fXhRclDdBgM7NrwOVAV0fS8u+LFv95c6ADHehABzrQgQ50oAMd6EAHOtCBDnSgA2sBV//Rg8Rq/qhKWg7Edv8F4J4QTlIlcCkQ6zGz3oaBfYHYl5Rp/hgpuL9h4L5A7EMKcCFS8CjN/f5tA8MpY4eAryJ1jzc4e4eBHSlj/wGUtAjMB24+ZWa7GgKei8Qfp271e4HYTuBCA8s7CExE3v2XqcA7wFogfsXMDm3ReAvIQ2NK+pkElPQWmAl09QIPzOzAJmauZWZTwIlA91dgqu6nbhLoBuJDwAszmzCzLBE3BNwHLkZSrkpSqCOrKHwWuL1ByhvgLvCwPCKWJK2ZWQcYAI6VM3YS2Bap8QQYCy1vJbBEXgcuJa7kKvAd6CTmzwMjkj7HEtpVFYqieJTn+QowmvBALWB7Iu45ML4RLglYIufyPH8GjAD9W9zF34AbwBlJ3arkrOZO7AHOly/7wZqwLjAN3JT0LvWmjM0fuMPAOHCkxO4tD/M2UACfgPfAa+ApMCupqDvOL9n0eZLgSE7IAAAAAElFTkSuQmCC","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAwCAYAAABjezibAAAB/0lEQVR42u3Yv2sWMRjA8e+9r9K+/u5WdLBQcXDqD9vJCuJQ+geIFIdQSYYO3RUnUVAcuyYKgQ7ipB1FRdR2KbwiSAdB6VKhKFLBt9QftS7nUpNerj1LhyfbPXnuyeeSSw4uY0MzWk0BlzaEl6zznVTYjFY3gWuBroZ1fvXvRY1d3gQoQAEKUIACFKAABShAAQpQgAIUoAAFKMBSwLUdepBYzV9FSauB2KH/ADwcwlnnC4HLgVib0aq9YuCRQOxryjR/jBTsqhh4PBBbTAG+ixQcpLrfv3WgN2XsELAZqXu2wtk7DexLGfsfoHV+CZgP3HzRaHWwIqCOxJ+lbvWHgdgBYLyC5T0KjEbe/blU4D1gPRC/brQ6tU2jA/aHxrTO/04CWuffAw8CXe3AtNHqxBZmrma0mgRGAt3fgMmyn7qrQCsQ7wZmjVajRqssEdcNPAImIik3rPOfQh1ZQeHLwN1NUt4C94En+RGxbJ1fN1o1gE7gTD5jF4A9kRrPgfOh5S0E5shbwJXElVwDfgCNxPx5YMg6/yWWUC+q0Gy+edrf1/MTOJfwQDVgbyJuBhjeDJcEzJEv+/t6XgFDQMc2d/F34DYwZp1vFSVnJXdiG2Dyl/1kSVgLmALuWOc/pN6UsfUDtxcYBgZy7LH8MK8DK8BnYAF4DbwAHlvnV8qO8wdwZ300jWHzbAAAAABJRU5ErkJggg=="},"W":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACm0lEQVR42tWYPXLUQBBG3y5b/sHlssumrZUuQEZMwBmICEmJOQWXIIELwCWIOAAZ8a5xl8HYhQ24bJOMYREzUk/vaKtQlYIdjWZ63tdfz6xGIvIIeMff13tVfUjPJSInwA791xNVfdMz1jPgZav51RiYRfrXhuA2jMEBTA19YnPOUwFORWTkmPQj8NoZYBNpm41V9Ttw0nqwBuw7AvwAvC1NEKfMsUnn4S4V4Gy8MLAFed+kh+EuJfFSBKsEwU/AjaHvouFGqfGKE1TVS+A4J0DgAJi02o5V9ecQORhb8JqI7OXmH0AXwdqZgzjysE4ttotgrsQ3C4HlOrkZgmAVyZlLZ4AugnWH63aAzYS8pST+Q1BVL4CvrQ7rHYlddRgkRbDKrYGLBHMpdhmkPEFHLZw6CE7/S4Jdu0jpAH9TU9VT4NxIcD+cntoV4ceQEsd+3xOROznyDilx7Pc47Llmg1gI1s4yk1Nq6mUIWiW+CHmHwyhNUYLBdQcGWtZSYyOoqueR3WRTRHbbyR45ux0acnJpglaKUyOtsgQznLyKALMINgYnWiWucmvqkASPgKuud8NpaaPV5/PtLlIyB/+hparXgPa8W/ct1kKwcRKMte+KyLrVwYMSNJaalRC8DvmGw8nZBD0mOVLVK2eAdVaAYTdp76lbIrIdXDcB9ozyWkpNtsR9MlfAyGiQQSTuM0qOQQYxSV8e5pQYbw7OPQQbJ8FkgOGU1P7z/yV88V0NwfBB4DRBsLbMXYLgvOcbzjzh4sYyVi7BKlPi2PO7oWwVJVgXJHg7Tl2SYEris1DccZSaxkVQVb8BZ63mbRHZigTYR28QgimKz4HtzPxL9XkMPLDMO+lY9f1W2wtH/qX6PLX2zSGIw8HWRSTn/QVxWgpnM5meIwAAAABJRU5ErkJggg==","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACqklEQVR42tWYT27UMBTGvxlG/UM1atVWTZwLsGPNgjOwYomUTbzmFFwCWwIfAC7BigOwYz1TigqlFS1QtWXjlsHY8XtvnJGIlMU4jv38+9737MlId+1jAO/w9/XeWPcImUt37QmAbeSvp8a6N5mxNICXQfOrMYBZpL8iBLdBDA4AakKf2JzzVIC17tqRYNKPAF4LA2wibbOxse4HgJPgwRqAPUGAHwC8LU0QQpljk879XSrA2XhhYAry3KSH/i4l8VIEqwTBTwBuCH0XDTdKjVecoLHuEsAxJ0AABwAmQduxse7XEDkYW/Ca7tpdbv4BQB9BJcxBCPJQpRbbR5Ar8c1CYFwnN0MQrCI5cykMUERQ9bhuG8BmQt5SEv8haKy7APAt6LDek9hVj0FSBCtuDVwkyKXYZ5DyBAW1sBYQrP9Lgn27SOkA76gZ604BnBMJ7vnTU1gRfg4pcez3vu7aexx5h5Q49nvs91yyQSgElbDMcEqNWoYgVeILn3cQGKUpStC77oBAi1pqaASNdeeR3WRTd+1OmOyRs9shISeXJkilWBNplSXIcPIqAmQRbAhOpEpccWvqkASPAFz1vetPSxtBny+3u0jJHPyHlrHuGsDnzLsqt1gKwUZIMNa+o7t2nergQQkSS81KCF77fIPAyWyCEpMcGeuuhAEqVoB+Nwn31C3dtVPvugmAXaK8lFLDljgncwVgRDTIIBLnjMIxyCAmyeUhp8RIc3AuIdgICSYD9Kek8M//V//FdzUE/QeB0wRBRZm7BMF55hvOPOHihjIWl2DFlDj2/L4vW0UJqoIEb8dRJQmmJD7zxR2CUtOICBrrvgM4C5qnumu3IgHm6A1CMEXxOYApM/9SfZ4AeEiZd9Kz6gdB2wtB/qX6PKP25RCEwMHURSTn/Q2SbgtQ8lxgvQAAAABJRU5ErkJggg=="},"Y":{"left":0.0,"top":-0.7121212121212122,"width":0.6060606060606061,"height":0.7121212121212122,"advance":0.6060606060606061,"primary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACsUlEQVR42u2YzUsWURSHH0ekYEgquNDCRS1rkZuiRVCbqEW7gj6gIISK6Lv0D2ilWYqhFVgRlYTRIomkTRFFEIQbkSAXEVlJ9CuhDysttc0I9nbvODP3HSiYs3vPxz3PnJk7vztvBYAxZh4wBMznb1sl6Sk5mTGmH1huCe2SdCUAkPQFOOtYoz5HuA0OuNfAdYBghvMM8N2SvMkYsyQnRtfFt0j6+QegJAGXLMmVwNEcplcLrLOEPgAXpn8EJcHTwC9LUZ0xZmGZGRsc/nZJ36yAkl4B3ZaiENhXxunVAFssoa9Ax0xHYElqAqYs/gPGmDllYjwCVFn8nZJGYgElPQPuWIoXATvLML1qYLclNA60ljoDxzqNDv8xY0yFJ+NeoNri75L0NhGgpCfAI0toKbDRY3pVwCFLaBJottUEMes1pdx9SWw7UGPx35I0mApQ0l2g3xJaY4xZmRHweMphxE4wrrA+w+1d75C1e5L6sgLeBF5Y/JszyF9D2unNCihpIlIXL/mLkbU+SfczA0Z2GXjnkL8FnoeCxtkKZwWUNAa0ZZW/SNa2WkKDQI83YGTngU8W/8EE8ueStWZJk2UBlPQZOOeQvx0ZZO0N0JWkd5BiF7YBP2zvthj52+OQtVZJ42UFlPQ+2jCJ5C+StcOW/BGgM2nfIOW77BQwkXCXbnPIWruk0VwAJb0EblhCa40xKxLI2ijQnqZn2gkmOkREslZrybko6WOugJIGgF6H/C2OueU/gZa0/SqzHEnCMBwC6iwXG4RhOBw9q6V2TdLVtL0qPA6fj4HVCdOngGWSnqftE5DdGlPk9mSB8wKU1AsMeG6sXCcIcDJBzgOfP598AbuB28Cw47l7CJzwaeD7CTm9YTqA/SXuMUlzfdcO+MetACwAC8ACsAAsAAvAAvD/BvwN0R/MVTvjaV0AAAAASUVORK5CYII=","secondary":"iVBORw0KGgoAAAANSUhEUgAAACgAAAAvCAYAAACR+4jVAAACy0lEQVR42u2Yz0sVURTHP45IQSTVqoWLWrZJ0aJdbaIW7Qr6AcWEzBRR2S/9A1pplmJoBd4TcUrCaJFE0qaIogjCjUiQi4isJPoh9MNKTW0zgr3uvDc/3ouCObt3zj33fObcufd755UB+J67GBgBlvCnrTOiTyiR+Z47CKy2hPYaUXUAjOgX4FzIHI0lhNscAvcKuArgzHOeBb5bBm/1PXdliRjDHr7NiE79BmhE3wMXLYPLgWMl6F41sNES+gCYuR9OTvAM8NOSVO977rIiMzaF+DuN6DcroBF9CfRakhYBB4rYvSpguyX0Feia73Asg1qAWYv/kO+5C4rEeBSosPi7jehYXkAj+hS4ZUleDuwpQvcqAd8SmgTac51OyDzNIf7jvueWpWTcD1Ra/D1G9E0kQCP6GHhgCa0CtqToXgXQYAnNAK22HCfPfC0xd18U2wVUWfw3jOhwLEAjehsYtITW+567NiHgiZjNyNvBfImNCZZ3U4is3TGiA0kBrwPPLf5tCeSvKW73CgIa0elAXVLJXx5ZGzCidxMDBnYJeBsif0tTXgqaCyUWBDSiE0BHUvkLZG2HJTQM9KUGDOwC8MniPxxB/sJkrdWIzhQF0Ih+Bs6HyN/uBLL2GuiJUtuJsQs7gB+2sy2P/O0LkbV2IzpZVEAj+i7YMJHkL5C1I5bxY0B31LpOzLPsNDAdcZfuDJG1TiM6XhJAI/oCuGYJbfA9d00EWRsHOuPUjNvBSJeIQNaqLWPEiH4sKaARHQL6Q+RvRZ4lnwLa4tYrT3IlqautGQHqLQ/r1NXWjAbvaq5dMaKX49ZKssQY0YfAI0uoIeSKNgucSlIrEWBUHZ1nfUb02V8FNKL9wFDKjVXSDhJx2e6l+fMpLWAvcBMYDXnv7gMn0xRI+wk5d+51AQdz3BNGdGHauR3+ccsAM8AMMAPMADPADDAD/L8BfwEIuMjZ4+ndqgAAAABJRU5ErkJggg=="}}};

async function configure(){
  const alert=new Alert();alert.title='配置自己的查询参数';alert.message='参数保存在 Keychain；学校接口可能变更。';
  for(const k of FIELDS){if(k==='acc_token')alert.addSecureTextField(k,read(k));else alert.addTextField(k+(k==='custid'?'（可留空）':''),read(k)||(k==='areacode'?'450010':''));}
  alert.addAction('保存');alert.addCancelAction('取消');if(await alert.presentAlert()!==0)return;
  FIELDS.forEach((k,i)=>write(k,alert.textFieldValue(i).trim()));if(Keychain.contains(PREFIX+'cache'))Keychain.remove(PREFIX+'cache');
}
async function importConfig(){
  const form=new Alert();form.title='导入官方页面配置';form.message='粘贴导出工具生成的 JSON；仅存入本机 Keychain。';form.addSecureTextField('配置 JSON','');form.addAction('导入');form.addCancelAction('取消');
  if(await form.presentAlert()!==0)return;
  let cfg;try{cfg=JSON.parse(form.textFieldValue(0));if(!cfg||typeof cfg!=='object'||Array.isArray(cfg))throw Error();
    for(const k of FIELDS)if(cfg[k]!==undefined&&typeof cfg[k]!=='string')throw Error();
    for(const k of ['syscustid','acc_token','areacode','buildingID'])if(!cfg[k]||!cfg[k].trim())throw Error();
  }catch{const msg=new Alert();msg.title='配置格式不正确';msg.message='请粘贴完整 JSON，并确认登录与宿舍参数齐全。';msg.addAction('知道了');await msg.presentAlert();return;}
  FIELDS.forEach(k=>write(k,cfg[k]||''));if(Keychain.contains(PREFIX+'cache'))Keychain.remove(PREFIX+'cache');
  const msg=new Alert();msg.title='已导入';msg.message='可以查询并预览小组件了。';msg.addAction('知道了');await msg.presentAlert();
}
async function main(){
  if(config.runsInWidget){const data=args.widgetParameter==='demo'?demo():await snapshot();Script.setWidget(buildWidget(data,config.widgetFamily||'small'));Script.complete();return;}
  const menu=new Alert();menu.title='校园余额 · GDBTU';menu.message='广东工商职业技术大学 / 非官方个人工具';
  menu.addAction('配置 / 更新参数');menu.addAction('查询并预览');menu.addAction('预览演示数据');menu.addAction('查看查询状态');menu.addAction('导入官方页面配置');menu.addCancelAction('取消');
  const choice=await menu.presentSheet();
  if(choice===0)await configure();
  if(choice===1)await buildWidget(await snapshot(),'small').presentSmall();
  if(choice===2)await buildWidget(demo(),'small').presentSmall();
  if(choice===4)await importConfig();
  if(choice===3){const data=await snapshot();const info=new Alert();info.title='查询状态';info.message=['power','card'].map(k=>{const m=data.metrics[k];return `${k==='power'?'电费':'校园卡'}：${m.error||'查询成功'}\n学校更新时间：${m.providerAt||'未提供'}\n查询时间：${m.fetchedAt||'无'}`;}).join('\n\n');info.addAction('知道了');await info.presentAlert();}
  Script.complete();
}
// Node can import parsing helpers without starting Scriptable.
if(typeof Script==='undefined'&&typeof module!=='undefined'&&module.exports)module.exports={amount,dataOf,providerTime,fetchPower,fetchCard,snapshot};
else await main();
