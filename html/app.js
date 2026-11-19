const C = (zhText, ptText) => lang === 'zh' ? zhText : ptText;
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[char]));
const now = () => new Date().toISOString();
const date = value => value ? new Date(value).toLocaleString(C('zh-CN','pt-BR')) : C('暂无记录','Sem histórico');
const money = value => Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const mask = value => value ? value.slice(0,2) + '••••' + value.slice(-2) : '';
const byId = (items,id) => items.find(item => String(item.id) === String(id));
const storageKey = 'cashclub-demo-v1';

function loadDemo() {
  try { return JSON.parse(localStorage.getItem(storageKey)) || {}; }
  catch { return {}; }
}
const saved = loadDemo();
const demo = {
  member:null, balance:360, bindings:{}, address:null, pix:null, orders:[], ledger:[],
  reviews:{}, claims:[], wheel:null, withdrawals:[], invites:[], checkin:'', ...saved
};
lang = saved.lang === 'pt' ? 'pt' : 'zh';
signedIn = Boolean(demo.member);
for (const index of saved.favorites || []) favorites.add(index);
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify({...demo,lang,favorites:[...favorites]})); }
  catch { /* The current session still works when storage is unavailable. */ }
}

const forms = new Map();
const attachmentPreviews = new Map();
const reviewTab = new Map();
const walletFilter = {kind:'all'};
let orderFilter = 'all';
let shopQuery = '';
let protectionTab = 'eligibility';
let loginTarget = 'account';
let pickTarget = '';
let pendingOrder = null;
let pendingWithdrawal = false;
let spinPending = false;
let result = null;
let toastTimer;
let dragStart;
const isTop = route => navRoutes.includes(route);
const routeOf = () => location.hash.slice(1) || 'home';
const link = (route,label,style='quiet') => `<a class="${style}" href="#${route}">${label}</a>`;
const button = (action,label,style='quiet',extra='') => `<button class="${style}" type="button" data-act="${action}" ${extra}>${label}</button>`;
const heading = label => `<h2 class="block-title">${label}</h2>`;
const empty = label => `<p class="empty">${label}</p>`;
const fields = rows => `<dl class="facts">${rows.map(([key,value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
const group = (items, extra='') => `<div class="actions ${extra}">${items.join('')}</div>`;
const pointText = value => `${value} ${C('积分','pts')}`;
const statusLabel = type => ({
  pending:C('处理中','Em andamento'), completed:C('已完成','Concluído'),
  paid:C('已到账','Creditado'), transit:C('配送中','Em transporte'),
  verified:C('已生效','Ativa'), inactive:C('未生效','Inativa'),
  review:C('审核中','Em análise'), supplement:C('待补件','Aguardando documentos'),
  rejected:C('未通过','Recusado'), failed:C('失败','Falhou')
}[type] || C('待确认','Pendente'));
const pill = type => `<span class="pill ${type}">${statusLabel(type)}</span>`;
const submit = label => `<button class="primary" type="submit">${label}</button>`;
const msg = () => '<p class="status form-status" role="status"></p>';
const asset = name => `assets/${name}.jpg`;
const modal = $('#action-dialog');

function demoNote() {
  return `<p class="demo-note">${C('本地演示 · 请仅填写示例资料','Demonstração local · use apenas dados fictícios')}</p>`;
}
function input(name,label,options={}) {
  const {value='',type='text',required=true,attributes=''} = options;
  return `<label>${label}<input name="${name}" type="${type}" value="${safe(value)}" ${required?'required':''} ${attributes}></label>`;
}
function textarea(name,label,value='',required=true) {
  return `<label>${label}<textarea rows="4" name="${name}" maxlength="1000" ${required?'required':''}>${safe(value)}</textarea></label>`;
}
function routeItem(route,title,secondary='',graphic='arrow') {
  return `<a class="route-item" href="#${route}"><span class="route-icon">${icon(graphic)}</span><span><b>${title}</b>${secondary ? `<small>${secondary}</small>` : ''}</span>${icon('arrow')}</a>`;
}
function showToast(text) {
  const target = $('#toast');
  target.textContent = text;
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.hidden = true; },2400);
}
function dialog(title,body) {
  if (modal.open) modal.close();
  modal.innerHTML = `<form method="dialog"><button class="close" aria-label="${t().close}">${icon('close')}</button></form>
    <h2 id="action-title">${title}</h2><div class="dialog-body">${body}</div>`;
  modal.setAttribute('aria-labelledby','action-title');
  modal.showModal();
}
function formStatus(form,message) {
  form.querySelector('.form-status').textContent = message;
}
function credit(change,kind,name,ref='',platform=null) {
  demo.balance += change;
  demo.ledger.unshift({id:recordId(),change,kind,name,ref,platform,at:now()});
}

function go(route,{replace=false}={}) {
  const from = routeOf();
  if (from===route) { renderRoute(true); return; }
  const depth = history.state?.ccDepth || 0;
  history[replace?'replaceState':'pushState']({ccDepth:replace?depth:depth+1,
    ccParent:replace?history.state?.ccParent:from},'', '#' + route);
  renderRoute(false);
}
function back(fallback='home') {
  if ((history.state?.ccDepth || 0) > 0) history.back();
  else go(fallback,{replace:true});
}
function requireMember(destination) {
  if (signedIn) return true;
  loginTarget = destination;
  go('login');
  return false;
}
const privateViews = new Set(['wallet','ledger','orders','order','address','pix','bindings','binding','protection','claim','claim-detail','withdraw','withdrawal','invites','password']);

function platformHeader(platform) {
  return `<div class="platform-head"><img class="detail-logo" src="${platform.image}" alt="">
    <div><h2>${platform.name}</h2><span class="rating">★ ${score(platform)}</span></div></div>`;
}
function platformList() {
  return [t().nav[1],`${input('list-search',t().search,{type:'search',value:listQuery,required:false,attributes:'id="list-search" autocomplete="off"'})}<div id="list-results"></div>`];
}
const seedReviews = lang => lang==='zh'
  ? ['平台说明容易找到，操作入口也很清楚。','页面加载流畅，客服入口比较好找。']
  : ['As informações e os atalhos da plataforma são fáceis de encontrar.','A página abre rápido e o atendimento é fácil de localizar.'];

function detailView(id) {
  const platform = platforms[id];
  if (!platform) return missing();
  const reviews = (demo.reviews[id] || []).concat(seedReviews(lang).map((body,index) => ({
    stars:index===0?5:4, author:index===0?'ab••••23':'lu••••18',body,at:index===0?'2026-10-18':'2026-10-10'
  })).slice(0,id<4?2:0));
  const active = reviewTab.get(id) || 0;
  const tabLabels = C(['用户评价','平台简介','优惠活动'],['Avaliações','Sobre','Promoções']);
  const content = [
    `${fields([[C('综合评分','Nota geral'),`<span class="rating">★ ${score(platform)}</span>`],[C('评价数','Avaliações'),reviews.length]])}
      ${link('review/'+id,C('写评价','Escrever avaliação'),'primary')}
      <div class="record-stack">${reviews.length ? reviews.map(review => `<article class="review"><div class="split">
        <b>${safe(review.author)}</b><span class="rating">${'★'.repeat(review.stars)}${'☆'.repeat(5-review.stars)}</span></div>
        <p>${safe(review.body)}</p><small>${date(review.at)}</small></article>`).join('') :
        empty(C('暂无评价，写下第一条评价。','Nenhuma avaliação. Escreva a primeira.'))}</div>`,
    `<p>${C('这里展示平台基本资料、服务与公开规则。当前平台介绍为演示内容。','Aqui ficam os dados, serviços e regras públicas da plataforma. Conteúdo de demonstração.')}</p>
      ${button('official',C('打开官网','Abrir site'))}`,
    Number(id)<3 ? `<article class="promo-card"><img src="${asset('banner-shop')}" alt="">
      <div><h3>${C('新会员活动示例','Exemplo para novos membros')}</h3>
      <p>${C('活动资格及有效期以平台发布规则为准。','Consulte as condições e datas publicadas pela plataforma.')}</p></div></article>` :
      empty(C('暂无已发布的优惠活动','Nenhuma promoção publicada'))
  ];
  return [platform.name,`${platformHeader(platform)}
    <div class="detail-tools">${button('platform-chat/'+id,C('平台客服','Suporte da plataforma'))}
    <span class="muted">${reviews.length} ${C('条评价','avaliações')}</span></div>
    <aside class="callout">${icon('shield')}<div><b>${C('平台保障','Proteção da plataforma')}</b>
    <p>${C('可查看适用条件及拒绝出款申诉流程。','Consulte critérios e o processo de contestação de saques.')}</p>
    ${link('terms/'+id,C('查看保障条款','Ver condições'),'text-link')}</div></aside>
    <div class="tabs detail-tabs" role="tablist">${tabLabels.map((label,index) =>
      `<button type="button" role="tab" aria-selected="${active===index}" data-act="detail-tab/${id}/${index}">${label}</button>`).join('')}</div>
    <div role="tabpanel">${content[active]}</div>
    ${group([button('favorite/'+id,favorites.has(Number(id))?'★ '+t().unfavorite:'☆ '+t().favorite),
    button('partner/'+id,C('通过本站注册','Cadastrar via CASH CLUB'),'primary')],'detail-footer')}`];
}
function termsView(id) {
  const platform = platforms[id];
  if (!platform) return missing();
  return [C('保障条款','Condições de proteção'),`${platformHeader(platform)}${demoNote()}
    ${heading(C('适用条件','Elegibilidade'))}<p>${C('通过本站入口注册、完成账号关联，并满足对应平台公布的保障条件。','Cadastre-se pelo canal indicado, vincule a conta e atenda às condições publicadas.')}</p>
    ${heading(C('申诉与核实','Contestação e análise'))}<p>${C('遇到拒绝出款时，提供申请金额、时间、问题说明和相关截图。核实符合条款后进入赔付流程。','Se o saque for recusado, envie valor, data, descrição e comprovantes. Casos elegíveis seguem para compensação.')}</p>
    ${link('protection',C('查看我的保障','Minha proteção'),'primary')}`];
}
function reviewView(id) {
  const platform = platforms[id];
  if (!platform) return missing();
  if (!demo.bindings[id]) return [C('写评价','Escrever avaliação'),`${platformHeader(platform)}
    ${empty(C('绑定该平台后可发表评价','Vincule sua conta para avaliar'))}
    ${link('bind/'+id,C('去绑定','Vincular'),'primary')}`];
  const draft = forms.get(currentRoute) || {};
  return [C('写评价','Escrever avaliação'),`${platformHeader(platform)}<form data-form="review/${id}">
    <fieldset class="star-picker"><legend>${C('选择评分','Selecione a nota')}</legend>
    ${[1,2,3,4,5].map(value => `<label><input type="radio" name="stars" value="${value}" ${Number(draft.stars || 5)===value?'checked':''}><span>★ ${value}</span></label>`).join('')}</fieldset>
    ${textarea('body',C('评价内容','Sua avaliação'),draft.body)}${submit(C('提交评价','Enviar avaliação'))}${msg()}</form>`];
}

function accountFormView(route,id) {
  const preset = platforms[id] ? String(id) : '';
  const draft = {platform:preset,...forms.get(currentRoute)};
  const chosen = draft.platform;
  const platform = platforms[chosen];
  const binding = demo.bindings[chosen];
  const bindingMode = route==='bind';
  const choose = `<label>${t().pick}</label>${button('pick',platform ? `<img src="${platform.image}" alt=""> ${platform.name}` : t().pick,'selector')}`;
  const account = binding ? fields([[t().account,safe(binding.account)]])
    : input('account',t().account,{value:draft.account,attributes:'maxlength="60" autocomplete="off"'});
  const content = bindingMode && binding ? `${pill('verified')} ${C('已绑定','Vinculada')}${account}` :
    `<form data-form="${route}">${account}
      ${bindingMode?`<p class="muted">${t().bindHint}</p>`:''}
      ${!bindingMode && platform && !binding ? link('bind/'+chosen,C('去绑定','Vincular'),'text-link') : ''}
      ${submit(bindingMode?t().bindAction:t().query)}${msg()}</form>`;
  return [t().quick[bindingMode?0:1],`${demoNote()}${choose}<div class="form-body">${content}</div>
    ${route==='redeem'?'<div id="redeem-result"></div>':''}`];
}
function selectorView() {
  const remembered = (forms.get(currentRoute) || {}).query;
  return [t().pick,`${input('pick-search',t().search,{value:remembered,type:'search',required:false,attributes:'id="pick-search" autocomplete="off"'})}
    <div id="pick-results" class="route-stack"></div>`];
}
function renderPicker() {
  const inputElement = $('#pick-search');
  const items = findPlatforms(inputElement.value);
  $('#pick-results').innerHTML = items.length ? items.map(({image,name,index}) =>
    `<button type="button" class="route-item" data-act="choose/${index}"><img src="${image}" alt=""><b>${name}</b>${icon('arrow')}</button>`).join('') :
    empty(t().noResults);
}

const sampleRates = {multiple:2, points:1.25};
function makeQuote(id,binding,account) {
  const count = binding?.count || 0;
  const deposit = count===0 ? [40.6,35.2,0.2][id%3] : count===1 ? 10.4 : 0;
  const bet = id%3===1 ? deposit : deposit*2.5;
  const raw = Math.round((deposit*sampleRates.points+(binding?.remainder || 0))*10000)/10000;
  return {id,account,deposit,bet,needed:deposit*sampleRates.multiple,points:Math.floor(raw),
    remainder:Math.round((raw-Math.floor(raw))*10000)/10000, from:binding?.cutoff || binding?.since || new Date(Date.now()-86400000).toISOString(), to:now()};
}
function renderQuote() {
  const area = $('#redeem-result');
  if (!area) return;
  if (!result) { area.innerHTML = ''; return; }
  if (result.success) {
    area.innerHTML = `<div class="callout success"><div><b>${C('兑换成功','Resgate concluído')} · ${pointText(result.points)}</b>
      ${link('wallet',C('查看积分记录','Ver extrato'),'text-link')}</div></div>`;
    return;
  }
  const q = result;
  const meets = q.bet>=q.needed;
  const binding = demo.bindings[q.id];
  const canRedeem = meets && q.points>0 && Boolean(binding);
  area.innerHTML = `<section class="quote">
    <small>${C('本次预计到账','Pontos previstos')}</small><strong>${pointText(q.points)}</strong>
    ${fields([
      [C('当前充值总额','Total depositado'),money((binding?.deposits || 0)+q.deposit)],
      [C('本次待兑换存款','Depósitos elegíveis'),money(q.deposit)],
      [C('当前投注额','Total apostado'),money(q.bet)],
      [C('统一投注倍数（演示）','Multiplicador de exemplo'),sampleRates.multiple+'×'],
      [C('所需投注额','Aposta necessária'),money(q.needed)],
      [C('达标状态','Requisito'),meets?C('已达标','Atendido'):C('未达标','Não atendido')],
      [C('适用积分比例（演示）','Taxa de exemplo'),`R$ 1 = ${sampleRates.points} ${C('积分','pts')}`],
      [C('历史已兑换积分','Pontos já resgatados'),pointText(binding?.points || 0)],
      [C('本次统计范围','Período desta consulta'),date(q.from)+' – '+date(q.to)],
      [C('上次兑换时间','Último resgate'),date(binding?.last)]
    ])}
    ${!meets ? empty(C('当前投注额未达兑换要求','O volume atual não atende ao requisito')) :
      q.points<=0 ? empty(C('暂无可兑积分','Sem pontos disponíveis')) :
      !binding ? link('bind/'+q.id,C('去绑定','Vincular'),'text-link') : ''}
    ${button('confirm-redeem',C('确认兑换','Confirmar resgate'),'primary',canRedeem?'':'disabled')}
    </section>`;
}
const productList = [
  {id:'bottle',name:()=>C('保温随行杯','Garrafa térmica'),points:120,stock:24},
  {id:'headset',name:()=>C('无线头戴耳机','Fone sem fio'),points:280,stock:12},
  {id:'umbrella',name:()=>C('便携折叠伞','Guarda-chuva dobrável'),points:95,stock:36},
  {id:'bag',name:()=>C('保温便当包','Bolsa térmica'),points:150,stock:18}
];
const stock = item => item.stock-demo.orders.filter(order => order.kind==='goods' && order.item===item.id).length;
function shopView() {
  return [t().nav[2],`<div class="balance-box split"><div><small>${C('可用积分','Pontos disponíveis')}</small>
    <strong>${signedIn ? pointText(demo.balance) : '—'}</strong></div>
    ${link('orders',C('兑换记录','Histórico de trocas'))}</div>
    ${input('shop-search',C('搜索商品或平台','Buscar produto ou plataforma'),{value:shopQuery,type:'search',required:false,attributes:'id="shop-search"'})}
    <div id="shop-results"></div>`];
}
function renderShop() {
  const query = shopQuery.trim().toLowerCase();
  const goods = productList.filter(item => item.name().toLowerCase().includes(query));
  const currency = findPlatforms(query);
  $('#shop-results').innerHTML = `${heading(C('商品兑换','Troca por produtos'))}
    ${goods.length ? `<div class="product-grid">${goods.map(item => `<article class="product">
      <img src="${asset(item.id)}" alt="${item.name()}"><div><h3>${item.name()}</h3>
      <p><b>${pointText(item.points)}</b> <small>${C('库存','Estoque')} ${stock(item)}</small></p>
      ${button('product/'+item.id,C('兑换','Trocar'),'primary',stock(item)>0?'':'disabled')}</div></article>`).join('')}</div>` :
      empty(C('没有匹配的商品','Nenhum produto encontrado'))}
    ${heading(C('平台资金兑换','Troca por saldo'))}<div class="route-stack">${currency.map(platform =>
      `<article class="route-item fund-item"><img src="${platform.image}" alt=""><span><b>${platform.name}</b>
      <small>${C('1 积分 = R$ 1,00 平台资金','1 pt = R$ 1,00 de saldo')}</small></span>
      ${button('fund/'+platform.index,C('兑换','Trocar'),'quiet')}</article>`).join('') ||
      empty(t().noResults)}</div>`;
}
function checkout() {
  const order = pendingOrder;
  if (!order) return;
  const goods = order.kind==='goods';
  const item = goods ? byId(productList,order.id) : platforms[order.id];
  const title = goods ? item.name() : item.name;
  const ready = goods ? Boolean(demo.address) : Boolean(demo.bindings[order.id]);
  const missingText = goods ? C('您还没有绑定收货地址','Cadastre um endereço de entrega') :
    C('您还没有绑定该平台账号','Vincule sua conta nessa plataforma');
  const action = goods ? 'address' : 'bind/'+order.id;
  if (!ready) {
    dialog(title,`<p>${missingText}</p>${group([button('cancel-order',C('取消','Cancelar')),
      link(action,C('去绑定','Cadastrar'),'primary')])}`);
    return;
  }
  const amount = goods ? item.points : order.amount;
  dialog(C('确认兑换','Confirmar troca'),`<form data-form="checkout">
    ${fields([[goods?C('商品','Produto'):C('平台','Plataforma'),title],
      [goods?C('收货地址','Endereço'):t().account,goods?safe(addressText(demo.address)):safe(demo.bindings[order.id].account)]])}
    ${goods?'':input('amount',C('兑换金额（R$）','Valor (R$)'),{value:amount,type:'number',attributes:'min="1" max="999999" step="1"'})}
    <div class="split total"><b>${C('所需积分','Pontos necessários')}</b><b id="order-total">${pointText(amount)}</b></div>
    ${group([button('cancel-order',C('取消','Cancelar')),submit(C('确认','Confirmar'))])}${msg()}</form>`);
}

function addressText(address) {
  return [address.recipient,mask(address.phone),address.street+' '+address.number,address.extra,address.district,
    address.city+' / '+address.state,address.postcode].filter(Boolean).join(' · ');
}
function addressView() {
  if (demo.address) return [C('收货地址','Endereço de entrega'),`<div class="callout"><div><b>${safe(demo.address.recipient)}</b>
    <p>${safe(addressText(demo.address))}</p></div></div>${link('address-edit',C('编辑','Editar'),'primary')}`];
  return [C('收货地址','Endereço de entrega'),empty(C('暂无收货地址','Nenhum endereço cadastrado')) +
    link('address-edit',C('添加收货地址','Adicionar endereço'),'primary')];
}
function addressEdit() {
  const address = {...(demo.address || {}),...(forms.get(currentRoute) || {})};
  const names = [
    ['recipient',C('收件人姓名','Nome do destinatário')],['phone',C('联系电话','Telefone')],
    ['postcode','CEP'],['state',C('州','Estado')],['city',C('城市','Cidade')],['district',C('街区','Bairro')],
    ['street',C('街道','Rua')],['number',C('门牌号','Número')],['extra',C('地址补充信息（选填）','Complemento (opcional)')]
  ];
  return [C('编辑收货地址','Editar endereço'),`${demoNote()}<form data-form="address">
    <div class="form-grid">${names.map(([key,label]) => input(key,label,{value:address[key],required:key!=='extra',
      type:key==='phone'?'tel':'text',attributes:'maxlength="100"'})).join('')}</div>
    ${submit(C('保存','Salvar'))}${msg()}</form>`];
}

function orderList() {
  const filters = [['all',C('全部','Todas')],['goods',C('商品','Produtos')],['funds',C('平台资金','Saldo')]];
  const records = demo.orders.filter(item => orderFilter==='all' || orderFilter===item.kind);
  return [C('商城兑换记录','Histórico de trocas'),`${filtersMarkup(filters,orderFilter,'order-filter')}
    <div class="route-stack">${records.length ? records.map(item => routeItem('order/'+item.id,safe(orderName(item)),
      date(item.at)+' · −'+pointText(item.points), 'shop').replace(icon('arrow')+'</a>',pill(item.status)+'</a>')).join('') :
      empty(C('暂无兑换记录','Nenhuma troca registrada'))}</div>`];
}
function filtersMarkup(filters,active,action) {
  return `<div class="filters" aria-label="${C('筛选','Filtrar')}">${filters.map(([key,label]) =>
    button(action+'/'+key,label,active===key?'filter active':'filter',`aria-pressed="${active===key}"`)).join('')}</div>`;
}
const orderName = order => order.kind==='goods' ? byId(productList,order.item)?.name() || order.name : order.name;
function orderDetail(id) {
  const order = byId(demo.orders,id);
  if (!order) return missing();
  const goods = order.kind==='goods';
  return [C('兑换详情','Detalhes da troca'),`<div class="split"><h2>${safe(orderName(order))}</h2>${pill(order.status)}</div>
    ${fields([[C('扣减积分','Pontos debitados'),pointText(order.points)],[C('提交时间','Enviado em'),date(order.at)],
      goods ? [C('提交时的地址','Endereço do pedido'),safe(order.destination)] : [t().account,safe(order.destination)],
      goods ? [C('配送进度','Entrega'),C('订单已提交，等待发货','Pedido recebido, aguardando envio')] :
        [C('到账金额','Valor'),money(order.points)]])}`];
}
function walletView() {
  const filters = [['all',C('全部','Todos')],['in',C('获得','Créditos')],['out',C('支出','Débitos')]];
  const records = demo.ledger.filter(item => (walletFilter.platform==null || item.platform===walletFilter.platform) &&
    (walletFilter.kind==='all' || (walletFilter.kind==='in' ? item.change>0 : item.change<0)));
  return [C('积分钱包','Carteira de pontos'),`<div class="balance-box"><small>${C('当前可用积分','Pontos disponíveis')}</small>
    <strong>${pointText(demo.balance)}</strong>${group([link('redeem',t().quick[1],'primary'),link('shop',C('去商城','Ir à loja'))])}</div>
    ${walletFilter.platform!=null?`<div class="split"><b>${platforms[walletFilter.platform].name}</b>
      ${button('wallet-all',C('查看全部平台','Todas as plataformas'),'text-link')}</div>`:''}
    ${filtersMarkup(filters,walletFilter.kind,'wallet-filter')}
    <div class="route-stack">${records.length ? records.map(item => routeItem('ledger/'+item.id,safe(ledgerName(item)),
      date(item.at),'coins').replace(icon('arrow')+'</a>',`<strong class="${item.change>0?'positive':''}">${item.change>0?'+':''}${item.change}</strong></a>`)).join('') :
      empty(C('暂无积分明细','Nenhuma movimentação'))}</div>`];
}
function ledgerName(item) {
  const kind = {redeem:C('存款换积分','Conversão de depósitos'),goods:C('商品兑换','Troca por produto'),
    funds:C('平台资金兑换','Troca por saldo'),refund:C('积分退回','Estorno de pontos'),opening:C('演示积分','Pontos de demonstração')}[item.kind];
  return item.name ? kind+' · '+item.name : kind;
}
function ledgerDetail(id) {
  const item = byId(demo.ledger,id);
  if (!item) return missing();
  const order = byId(demo.orders,item.ref);
  return [C('积分明细','Detalhes dos pontos'),`<h2>${safe(ledgerName(item))}</h2>
    ${fields([[C('积分变动','Movimentação'),pointText(item.change)],[C('时间','Data'),date(item.at)],
      [C('处理状态','Status'),pill(order?.status || 'completed')]])}
    ${order?link('order/'+item.ref,C('查看关联兑换记录','Ver troca relacionada'),'primary'):''}`];
}

function profileView() {
  if (!signedIn) return [t().nav[4],`<div class="profile-intro"><span class="avatar">${icon('account')}</span>
    <h2>${C('欢迎来到 CASH CLUB','Bem-vindo à CASH CLUB')}</h2>
    ${group([link('login',C('登录','Entrar'),'primary'),link('register',C('注册','Criar conta'))])}</div>
    <div class="route-stack">${routeItem('help',t().quick[2],'','help')}${routeItem('chat',t().quick[3],'','chat')}</div>`];
  const checked = demo.checkin===new Date().toDateString();
  return [t().nav[4],`<div class="split profile-bar"><div class="split"><span class="avatar">${icon('account')}</span>
    <b>${safe(demo.member)}</b></div>${button('checkin',checked?C('今日已签到','Check-in concluído'):C('签到','Check-in'),'quiet',checked?'disabled':'')}</div>
    <a class="balance-box" href="#wallet"><small>${C('当前可用积分','Pontos disponíveis')}</small><strong>${pointText(demo.balance)}</strong></a>
    <div class="route-stack">
      ${routeItem('wheel',C('我的红包','Meu prêmio'),'','wheel')}
      ${routeItem('protection',C('我的保障','Minha proteção'),'','shield')}
      ${routeItem('orders',C('商城兑换记录','Histórico de trocas'),'','shop')}
      ${routeItem('bindings',C('已绑定平台','Plataformas vinculadas'),'','link')}
      ${routeItem('address',C('收货地址','Endereço de entrega'))}
      ${routeItem('pix',C('收款账户','Conta de recebimento'))}
      ${routeItem('password',C('修改密码','Alterar senha'))}
    </div>${button('logout',C('退出登录','Sair'),'quiet')}`];
}
function bindingList() {
  const entries = Object.entries(demo.bindings);
  return [C('已绑定平台','Plataformas vinculadas'),link('bind',C('绑定新平台','Vincular plataforma'),'primary') +
    `<div class="route-stack">${entries.map(([id,value]) => `<a class="route-item" href="#binding/${id}">
      <img src="${platforms[id].image}" alt=""><span><b>${platforms[id].name}</b>
      <small>${safe(value.account)} · ${pointText(value.points)}</small></span>${icon('arrow')}</a>`).join('') ||
      empty(C('暂无已绑定平台','Nenhuma conta vinculada'))}</div>`];
}
function bindingDetail(id) {
  const value = demo.bindings[id];
  if (!value) return missing();
  return [C('平台绑定详情','Detalhes do vínculo'),`${platformHeader(platforms[id])}${fields([
    [t().account,safe(value.account)],[C('绑定时间','Vinculada em'),date(value.since)],
    [C('历史已兑换积分','Pontos resgatados'),pointText(value.points)],[C('保障状态','Proteção'),pill(value.status)]])}
    ${group([link('redeem/'+id,C('查询可兑积分','Consultar pontos'),'primary'),
      button('wallet-platform/'+id,C('查看该平台的积分记录','Ver extrato da plataforma')),
      link('protection/'+id,C('我的保障','Minha proteção'))])}`];
}

function pixView() {
  return [C('收款账户','Conta de recebimento'),`<div class="callout"><div><b>Pix</b>
    <p>${demo.pix ? 'CPF · '+safe(demo.pix) : C('暂无绑定账户','Nenhuma conta cadastrada')}</p></div></div>
    ${link('pix-edit',demo.pix?C('更换 Pix','Alterar Pix'):C('绑定 Pix','Cadastrar Pix'),'primary')}`];
}
function pixEdit() {
  const draft = forms.get(currentRoute) || {};
  return [C('绑定 Pix','Cadastrar Pix'),`${demoNote()}<form data-form="pix">
    ${input('cpf','CPF',{value:draft.cpf,attributes:'inputmode="numeric" pattern="[0-9.\\-]{11,14}" placeholder="000.000.000-00"'})}
    <p class="muted">${C('填写已注册为 Pix 收款键的 CPF。演示可用任意 11 位示例数字。','Informe a chave Pix do tipo CPF. Na demonstração, use 11 dígitos fictícios.')}</p>
    ${submit(C('保存','Salvar'))}${msg()}</form>`];
}
const wheelGoal = 10000;
const initialPrize = 9150;
const prizeAmounts = [1,5,15,30,65,91.5];
function wheelView() {
  const activity = `<div class="activity-line">${icon('notice')}<span id="activity-text"></span></div>`;
  if (!demo.wheel) return [t().nav[3],`${activity}<div class="wheel-stage"><div class="wheel-arrow"></div>
    <div class="prize-wheel" id="prize-wheel">${prizeAmounts.map((amount,i) =>
      `<span style="--angle:${i*60}deg">${money(amount)}</span>`).join('')}<b>CC</b></div>
    <h2>${C('转动轮盘，开启本期红包','Gire a roleta e abra seu prêmio')}</h2>
    ${button('spin',C('立即抽奖','Girar agora'),'primary',spinPending?'disabled':'')}
    ${link('wheel-rules',C('查看活动规则','Ver regras'),'text-link')}</div>`];
  const left = Math.max(0,wheelGoal-demo.wheel.cents);
  const progress = Math.min(100,(demo.wheel.cents/wheelGoal)*100);
  return [C('红包进度','Progresso do prêmio'),`${activity}<div class="balance-box wheel-balance">
    <small>${C('累计红包','Prêmio acumulado')}</small><strong>${money(demo.wheel.cents/100)}</strong>
    <progress value="${progress}" max="100"></progress>
    <p>${C('目标','Meta')} ${money(wheelGoal/100)} · ${left ?
      C('距提现还差','Faltam')+' '+money(left/100) : C('已达提现目标','Meta atingida')}</p>
    ${group([button('share',C('邀请好友','Convidar amigos'),'primary'),button('copy-invite',C('复制链接','Copiar link')),
      link('invites',C('邀请明细','Histórico de convites')),button('withdraw-start',C('申请提现','Solicitar saque'),
      'quiet',left || demo.wheel.withdrawn?'disabled':'')])}
    ${link('wheel-rules',C('活动规则','Regras'),'text-link')}</div>
    ${heading(C('提现记录','Histórico de saques'))}
    <div class="route-stack">${demo.withdrawals.map(item => routeItem('withdrawal/'+item.id,money(item.cents/100),
      date(item.at),'wheel').replace(icon('arrow')+'</a>',pill(item.status)+'</a>')).join('') ||
      empty(C('暂无提现记录','Nenhum saque registrado'))}</div>`];
}
function renderActivity() {
  const target = $('#activity-text');
  if (!target) return;
  const nick = ['ab••••23','lu••••18','ma••••40'][Math.floor(Date.now()/4200)%3];
  target.textContent = C('演示动态 · 会员 ','Exemplo · membro ') + nick +
    C(' 成功提现了 ',' sacou ') + money(100);
}
function wheelRules() {
  return [C('活动规则','Regras da roleta'),`${demoNote()}<ol class="tutorial">
    <li>${C('首次抽奖发放本期初始红包。本原型固定发放演示金额。','O primeiro giro libera o prêmio inicial. Neste protótipo, o valor é fixo.')}</li>
    <li>${C('好友通过邀请链接完成注册，每个有效邀请可获得 R$ 0,01–10,00。','Cada cadastro válido pelo convite rende de R$ 0,01 a R$ 10,00.')}</li>
    <li>${C('达到演示目标 R$ 100,00 后，可用已绑定的 Pix CPF 提交提现申请。','Ao atingir a meta de demonstração de R$ 100,00, solicite um saque por Pix CPF.')}</li>
    </ol>${link('wheel',C('返回轮盘','Voltar à roleta'),'primary')}`];
}
function inviteView() {
  const records = demo.invites;
  return [C('邀请明细','Histórico de convites'),`${fields([[C('有效邀请','Convites válidos'),records.length],
    [C('获得红包','Recompensas'),money(records.reduce((total,item)=>total+item.cents,0)/100)]])}
    ${group([button('copy-invite',C('复制链接','Copiar link')),button('sample-invite',C('模拟好友注册','Simular cadastro de um amigo'),'primary')])}
    <div class="route-stack">${records.map(item => `<div class="record split"><span><b>${safe(item.name)}</b>
      <small>${date(item.at)}</small></span><b class="positive">+${money(item.cents/100)}</b></div>`).join('') ||
      empty(C('暂无有效邀请','Nenhum convite válido'))}</div>`];
}
function withdrawView() {
  if (!demo.wheel || demo.wheel.cents<wheelGoal || demo.wheel.withdrawn) return missing();
  return [C('提现确认','Confirmar saque'),`${demoNote()}${fields([
    [C('本次提现金额','Valor'),money(wheelGoal/100)],[C('收款方式','Método'),'Pix'],
    ['CPF',safe(demo.pix) || C('未绑定','Não cadastrado')]])}
    ${demo.pix ? button('withdraw-confirm',C('确认提现','Confirmar saque'),'primary') :
      link('pix',C('去绑定 Pix','Cadastrar Pix'),'primary')}`];
}
function withdrawalDetail(id) {
  const item = byId(demo.withdrawals,id);
  if (!item) return missing();
  return [C('提现详情','Detalhes do saque'),`${fields([
    [C('申请金额','Valor'),money(item.cents/100)],['CPF',safe(item.pix)],
    [C('申请时间','Solicitado em'),date(item.at)],[C('处理状态','Status'),pill(item.status)],
    ...(item.paidAt?[[C('到账时间','Creditado em'),date(item.paidAt)]]:[]),
    ...(item.error?[[C('失败原因','Motivo da falha'),safe(item.error)]]:[])
  ])}${item.error?link('pix',C('检查收款账户','Verificar conta')):''}`];
}

function protectionView(id) {
  const entries = Object.entries(demo.bindings);
  return [C('我的保障','Minha proteção'),`${filtersMarkup([
    ['eligibility',C('保障资格','Elegibilidade')],['claims',C('申诉记录','Solicitações')]],protectionTab,'protection-tab')}
    ${protectionTab==='eligibility' ? `<div class="route-stack">${entries.map(([key,binding]) =>
      `<article class="record ${key===id?'highlight':''}"><div class="split">${platformHeader(platforms[key])}
      ${pill(binding.status)}</div><p>${safe(binding.account)}</p>
      ${group([link('terms/'+key,C('查看保障条款','Ver condições')),
        link('claim/'+key,C('申请保障','Solicitar proteção'),'primary')])}</article>`).join('') ||
      empty(C('暂无保障资格，绑定平台后可查看。','Vincule uma plataforma para consultar a proteção.'))}</div>
      ${link('bind',C('绑定平台','Vincular plataforma'),'primary')}` :
      `<div class="route-stack">${demo.claims.map(item => routeItem('claim-detail/'+item.id,platforms[item.platform].name,
        date(item.at)+' · '+money(item.amount),'shield').replace(icon('arrow')+'</a>',pill(item.status)+'</a>')).join('') ||
        empty(C('暂无申诉记录','Nenhuma solicitação'))}</div>`}`];
}
function claimView(id) {
  const binding = demo.bindings[id];
  if (!binding) return missing();
  const draft = forms.get(currentRoute) || {};
  return [C('申请保障','Solicitar proteção'),`${platformHeader(platforms[id])}
    ${fields([[t().account,safe(binding.account)]])}${demoNote()}<form data-form="claim/${id}">
    ${input('amount',C('出款金额（R$）','Valor do saque (R$)'),{value:draft.amount,type:'number',attributes:'min=".01" step=".01"'})}
    ${input('requested',C('出款时间','Data e hora do saque'),{value:draft.requested,type:'datetime-local'})}
    ${textarea('body',C('问题说明','Descreva o problema'),draft.body)}
    <label>${C('相关截图（选填）','Comprovantes (opcional)')}<input type="file" name="attachments" accept="image/*" multiple></label>
    ${submit(C('提交申诉','Enviar solicitação'))}${msg()}</form>`];
}
function claimDetail(id) {
  const item = byId(demo.claims,id);
  if (!item) return missing();
  return [C('申诉详情','Detalhes da solicitação'),`${platformHeader(platforms[item.platform])}
    ${fields([[t().account,safe(item.account)],[C('金额','Valor'),money(item.amount)],
      [C('出款时间','Data do saque'),date(item.requested)],[C('提交时间','Enviado em'),date(item.at)],
      [C('处理状态','Status'),pill(item.status)],[C('问题说明','Descrição'),safe(item.body)],
      [C('截图','Comprovantes'),item.attachments.map(safe).join('、') || '—']])}
    ${(attachmentPreviews.get(item.id) || []).map((file,index) =>
      `<button class="attachment-thumb" type="button" data-act="attachment/${item.id}/${index}" aria-label="${C('查看截图','Ver comprovante')} ${index+1}">
      <img src="${file.url}" alt="${safe(file.name)}"></button>`).join('')}
    ${heading(C('处理进度','Andamento'))}<ol class="timeline"><li class="done">${C('申诉已提交','Solicitação enviada')}</li>
    <li>${C('等待核实','Aguardando verificação')}</li><li>${C('处理结果','Resultado')}</li></ol>`];
}

function authView(route) {
  const draft = forms.get(currentRoute) || {};
  const login = route==='login';
  const register = route==='register';
  const change = route==='password';
  const title = login ? C('登录','Entrar') : register ? C('注册','Criar conta') :
    change ? C('修改密码','Alterar senha') : C('忘记密码','Redefinir senha');
  const verification = `<div class="verify-row">${input('code',C('短信验证码','Código SMS'),
    {attributes:'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"'})}
    ${button('sms',C('获取验证码','Obter código'))}</div>`;
  return [title,`${demoNote()}<div class="auth-brand"><span class="mark">${icon('shield')}</span><b>CASH <em>CLUB</em></b></div>
    <form data-form="auth/${route}">
    ${input('phone',C('手机号','Telefone'),{value:draft.phone,type:'tel',attributes:'inputmode="tel" minlength="8" maxlength="18" autocomplete="off"'})}
    ${login?'':verification}
    ${input('password',login||register?C('密码','Senha'):C('新密码','Nova senha'),
      {type:'password',attributes:'minlength="6" maxlength="40" autocomplete="off"'})}
    ${login ? link('reset',C('忘记密码','Esqueci minha senha'),'text-link') : ''}
    ${submit(login ? C('登录','Entrar') : register ? C('注册','Criar conta') : C('确认修改','Confirmar alteração'))}${msg()}
    </form>
    <div class="auth-actions">${login?link('register',C('去注册','Criar conta'),'text-link'):
      register?link('login',C('已有账号，去登录','Já tenho uma conta'),'text-link'):''}
    ${link('chat',t().quick[3],'text-link')}</div>`];
}

function tutorialPreview(id,step) {
  const labels = [
    [t().pick,t().account,t().bindAction],
    [t().pick,C('预计到账积分','Pontos previstos'),t().query],
    [C('平台保障','Proteção'),C('保障摘要','Resumo da proteção'),C('查看保障条款','Ver condições')],
    [C('红包进度','Progresso do prêmio'),C('目标金额','Meta'),C('申请提现','Solicitar saque')]
  ][id];
  return `<div class="tutorial-preview" data-step="${step}" aria-hidden="true"><div class="mock-head">
    <span class="mark">${icon(['link','coins','shield','wheel'][id])}</span><b>${t().topics[id]}</b></div>
    <div class="mock-field ${step===0?'mock-highlight':''}">${labels[0]}${icon('arrow')}</div>
    <div class="mock-field ${step===1?'mock-highlight':''}">${labels[1]}</div>
    <span class="mock-button ${step>=2?'mock-highlight':''}">${labels[2]}</span></div>`;
}
function tutorialView(id) {
  const copy = t();
  if (!copy.questions[id]) return missing();
  return [copy.questions[id],`<ol class="tutorial-steps">${copy.steps[id].map((step,i) =>
    `<li><h2>${step}</h2><figure>
      <button type="button" class="step-picture" aria-label="${C('放大步骤图','Ampliar etapa')} ${i+1}" data-act="zoom/${id}/${i}">
      ${tutorialPreview(Number(id),i)}</button>
      <figcaption>${C('步骤示意图','Ilustração da etapa')} ${i+1} · ${copy.topics[id]}</figcaption></figure></li>`).join('')}</ol>
    ${group([link(['bind','redeem','platforms','wheel'][id],copy.actions[id],'primary'),
      link('chat/'+id,C('联系在线客服','Falar com atendimento'))])}`];
}
function helpView() {
  return [t().quick[2],`${input('help-search',t().helpSearch,{type:'search',value:helpQuery,required:false,attributes:'id="help-search"'})}<div id="help-results"></div>`];
}
function chatView(id) {
  const copy = t();
  return [copy.ai,`${copy.questions[id]?`<p class="chat-context">${C('咨询教程','Guia em questão')} · ${copy.questions[id]}</p>`:''}
    <div class="chat-log" id="chat-log" role="log"></div>
    <div class="chat-prompts">${copy.questions.map((question,i) => button('question/'+i,question,'filter')).join('')}</div>
    <form class="chat-form" data-form="chat"><input required maxlength="300" name="message"
    aria-label="${copy.message}" placeholder="${copy.message}">${submit(copy.send)}</form>
    ${button('human',C('联系人工客服','Falar com uma pessoa'),'text-link')}`];
}
function renderSupport() {
  renderChat();
  const log = $('#chat-log');
  chat.forEach((entry,index) => {
    if (entry[2]) {
      const anchor = document.createElement('a');
      anchor.className='text-link';
      anchor.href='#'+entry[2];
      anchor.textContent=entry[3] || C('查看关联教程','Ver guia relacionado');
      log.children[index+1].append(' ',anchor);
    }
  });
  log.scrollTop = log.scrollHeight;
}
function answer(message,index) {
  const copy = t();
  const query = message.toLowerCase();
  const personal = [
    [C(/余额|积分记录|积分明细/,/saldo de pontos|extrato/),'wallet',C('查看积分钱包','Ver carteira')],
    [C(/订单|物流|兑换记录/,/pedido|entrega|histórico de troca/),'orders',C('查看商城兑换记录','Ver histórico de trocas')],
    [C(/提现进度|提现状态|提现记录/,/status do saque|histórico de saque/),'wheel',C('查看提现记录','Ver saques')]
  ].find(([pattern]) => pattern.test(query));
  const keys = C(['绑定','积分','保障','轮盘','提现'],['vincul','pont','prote','roleta','saque']);
  const matched = index ?? keys.findIndex(key => query.includes(key));
  const topic = matched===4 ? 3 : matched;
  const answerRow = personal ? [C('请到对应记录页查询个人状态。','Consulte o seu status na página de histórico.'),false,personal[1],personal[2]] :
    copy.steps[topic] ? [copy.steps[topic].join(' '),false,'tutorial/'+topic] :
      [C('这条问题暂时没有匹配的答案，可以联系人工客服。','Não encontrei uma resposta. Você pode falar com o atendimento humano.'),false];
  chat.push([message,true],answerRow);
  renderSupport();
  if (!personal && !copy.steps[topic]) humanSupport();
}
function humanSupport() {
  const contact = 'suporte@example.com';
  dialog(C('联系人工客服','Atendimento humano'),`${demoNote()}
    ${fields([['E-mail',contact]])}
    ${group([button('copy-contact',C('复制联系方式','Copiar contato')),button('contact-preview',C('查看站外入口','Ver canal externo'),'primary')])}`);
}
function missing() {
  return [C('页面暂不可用','Página indisponível'),empty(C('没有找到相应记录。','Registro não encontrado.')) + link('home',t().nav[0],'primary')];
}
function pageView(route,id) {
  switch (route) {
    case 'platforms': return platformList();
    case 'detail': return detailView(id);
    case 'terms': return termsView(id);
    case 'review': return reviewView(id);
    case 'bind': case 'redeem': return accountFormView(route,id);
    case 'select': return selectorView();
    case 'shop': return shopView();
    case 'orders': return orderList();
    case 'order': return orderDetail(id);
    case 'wallet': return walletView();
    case 'ledger': return ledgerDetail(id);
    case 'account': return profileView();
    case 'address': return addressView();
    case 'address-edit': return addressEdit();
    case 'bindings': return bindingList();
    case 'binding': return bindingDetail(id);
    case 'pix': return pixView();
    case 'pix-edit': return pixEdit();
    case 'protection': return protectionView(id);
    case 'claim': return claimView(id);
    case 'claim-detail': return claimDetail(id);
    case 'wheel': return wheelView();
    case 'wheel-rules': return wheelRules();
    case 'invites': return inviteView();
    case 'withdraw': return withdrawView();
    case 'withdrawal': return withdrawalDetail(id);
    case 'login': case 'register': case 'reset': case 'password': return authView(route);
    case 'help': return helpView();
    case 'tutorial': return tutorialView(id);
    case 'chat': return chatView(id);
    default: return missing();
  }
}
const navParents = {
  detail:'platforms', review:'platforms', terms:'platforms', order:'shop', orders:'shop',
  withdraw:'wheel', withdrawal:'wheel', 'wheel-rules':'wheel', invites:'wheel',
  wallet:'account', ledger:'account', address:'account','address-edit':'account',pix:'account',
  'pix-edit':'account',bindings:'account',binding:'account',protection:'account',claim:'account',
  'claim-detail':'account',password:'account',login:'account',register:'account',reset:'account'
};
const authPages = new Set(['login','register','reset']);
function renderRoute(keepScroll=false) {
  const next = routeOf();
  const [route,id] = next.split('/');
  if (!signedIn && (privateViews.has(route) || route==='review' || route==='address-edit' || route==='pix-edit')) {
    loginTarget=next;
    go('login',{replace:true});
    return;
  }
  const changed = next!==currentRoute;
  if (changed && currentRoute) {
    routeScroll.set(currentRoute,window.scrollY);
    if (modal.open) modal.close();
  }
  if (changed && route!=='select' && route!=='redeem') result=null;
  if (changed && next==='register/invite') authWasInvite=true;
  if (changed && !['login','register','reset','chat'].includes(route)) authWasInvite=false;
  currentRoute = next;
  const home = route==='home';
  $('#top').hidden = !home;
  $('#home').hidden = !home;
  $('#secondary').hidden = home;
  $('#nav').hidden = authPages.has(route);
  $('#nav').setAttribute('aria-label',C('全站导航','Menu principal'));
  const active = isTop(route) ? route : navParents[route] || 'home';
  $('#nav').innerHTML = navRoutes.map((key,i) => `<a href="#${key}" ${active===key?'aria-current="page"':''}>
    ${icon(key)}${t().nav[i]}</a>`).join('');
  if (!home) {
    const [title,body] = pageView(route,id);
    const showBack = !isTop(route) || history.state?.ccParent;
    $('#secondary').innerHTML = `<div class="secondary-head">${showBack ?
      button('back',icon('back'),'back',`aria-label="${t().back}"`) : ''}<h1 tabindex="-1">${title}</h1></div>
      <section class="panel page-${safe(route)}">${body}</section>`;
    if (route==='platforms') renderList();
    if (route==='help') renderHelp();
    if (route==='chat') renderSupport();
    if (route==='select') renderPicker();
    if (route==='shop') renderShop();
    if (route==='wheel') renderActivity();
    if (route==='redeem') renderQuote();
    if (authPages.has(route)) {
      const password = $('#secondary input[type=password]');
      if (password && authSecrets.has(next)) password.value = authSecrets.get(next);
    }
    if (changed) $('#secondary h1').focus({preventScroll:true});
  }
  if (changed && !keepScroll) window.scrollTo(0,routeScroll.get(next) || 0);
  if (changed && route==='shop' && pendingOrder?.awaiting) {
    const reopen = pendingOrder.returning;
    if (reopen) {
      pendingOrder.returning=false;
      pendingOrder.awaiting=false;
      checkout();
    } else pendingOrder=null;
  }
}
function bindPlatform(id,account) {
  if (!platforms[id] || demo.bindings[id] || !account.trim()) return false;
  demo.bindings[id] = {account:mask(account.trim()),since:now(),points:0,count:0,deposits:0,
    remainder:0,status:['verified','pending','inactive'][id%3]};
  return true;
}
function commitQuote(quote) {
  const binding = demo.bindings[quote?.id];
  if (!binding || quote.success || quote.bet<quote.needed || quote.points<=0 ||
    quote.from!==(binding.cutoff || binding.since)) return false;
  binding.points += quote.points;
  binding.count++;
  binding.deposits += quote.deposit;
  binding.remainder = quote.remainder;
  binding.cutoff = quote.to;
  binding.last = now();
  credit(quote.points,'redeem',platforms[quote.id].name,'',Number(quote.id));
  result = {success:true,points:quote.points};
  return true;
}
function completeOrder(order,amount) {
  const goods = order.kind==='goods';
  const item = goods ? byId(productList,order.id) : platforms[order.id];
  const destination = goods ? demo.address && addressText(demo.address) : demo.bindings[order.id]?.account;
  const points = goods ? item.points : amount;
  if (!destination || !Number.isSafeInteger(points) || points<1) return 'invalid';
  if (goods && stock(item)<=0) return 'stock';
  if (points>demo.balance) return 'balance';
  const record = {id:recordId(),kind:order.kind,item:order.id,name:goods?item.name():item.name,points,
    destination,status:goods?'pending':'paid',at:now()};
  demo.orders.unshift(record);
  credit(-points,record.kind,record.name,record.id,goods?null:Number(order.id));
  return record;
}
let sequence = 0;
const recordId = () => Date.now()+'-'+(++sequence);
function pickTab(key) {
  if (key==='favorites' && !requireMember('home:favorites')) return;
  tab=key;
  renderFeatured();
  $('#tab-'+key).focus({preventScroll:true});
}
function returnToStart(destination,depth) {
  const delta=(history.state?.ccDepth || 0)-depth;
  if (delta>0) history.go(-delta);
  else go(destination,{replace:true});
}
function startOrder(kind,id) {
  if (!requireMember('shop:'+kind+':'+id)) return;
  pendingOrder={kind,id,amount:1,depth:history.state?.ccDepth || 0};
  checkout();
}
function inviteLink() {
  return location.href.split('#')[0]+'#register/invite';
}
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(C('已复制','Copiado'));
  } catch {
    dialog(C('复制内容','Copiar conteúdo'),input('copy',C('可选中下方内容手动复制','Selecione o conteúdo para copiar'),
      {value,required:false,attributes:'readonly'}));
    modal.querySelector('input').select();
  }
}
function addInvite() {
  if (!demo.wheel || demo.wheel.withdrawn) return false;
  const cents = [575,275,86,410][demo.invites.length%4];
  demo.wheel.cents += cents;
  demo.invites.unshift({name:'am••••'+String(demo.invites.length+11),cents,at:now()});
  return true;
}
function spin() {
  if (spinPending || demo.wheel || !requireMember('wheel')) return;
  spinPending=true;
  const graphic=$('#prize-wheel');
  graphic.classList.add('spinning');
  $('[data-act="spin"]').disabled=true;
  setTimeout(() => {
    spinPending=false;
    demo.wheel={cents:initialPrize,withdrawn:false};
    save();
    if (routeOf()==='wheel') renderRoute(true);
    showToast(C('初始红包到账','Prêmio inicial recebido')+' · '+money(initialPrize/100));
  },matchMedia('(prefers-reduced-motion: reduce)').matches?0:1150);
}

const authSecrets = new Map();
let authWasInvite = false;
function finishAuth() {
  const target = loginTarget;
  loginTarget='account';
  authSecrets.clear();
  renderFeatured();
  if (target==='home:favorites') {
    tab='favorites';
    renderFeatured();
    if (history.state?.ccParent==='home') back();
    else go('home',{replace:true});
    return;
  }
  if (target.startsWith('shop:')) {
    const [,kind,id] = target.split(':');
    go('shop',{replace:true});
    startOrder(kind,id);
    return;
  }
  if (history.state?.ccParent===target) back();
  else go(target,{replace:true});
}
function submitAuth(route,values,form) {
  const digits = String(values.phone || '').replace(/\D/g,'');
  if (digits.length<8) return formStatus(form,C('请输入有效的示例手机号。','Informe um telefone de exemplo válido.'));
  if (route!=='login' && values.code!=='123456')
    return formStatus(form,C('演示验证码为 123456，请重新填写。','O código de demonstração é 123456.'));
  if (route==='password' && digits!==demo.phone)
    return formStatus(form,C('请输入当前演示账号的手机号。','Informe o telefone da conta atual.'));
  if (route==='reset' || route==='password') {
    forms.delete(currentRoute);
    authSecrets.clear();
    if (route==='password') {
      signedIn=false; demo.member=null; tab='recommended'; save(); renderFeatured();
    }
    showToast(C('演示密码修改成功','Alteração simulada concluída'));
    go('login',{replace:true});
    return;
  }
  signedIn=true;
  demo.member=mask(digits);
  demo.phone=digits;
  if (route==='register' && (authWasInvite || currentRoute==='register/invite')) {
    addInvite();
    authWasInvite=false;
  }
  if (!demo.ledger.length) demo.ledger.push({id:recordId(),change:demo.balance,kind:'opening',name:'',at:now()});
  forms.delete(currentRoute);
  save();
  showToast(route==='register'?C('演示注册成功','Cadastro de teste concluído'):C('已登录演示账号','Sessão de teste iniciada'));
  finishAuth();
}
function selectPlatform(id) {
  if (!platforms[id] || !pickTarget) return;
  const draft = {platform:pickTarget.split('/')[1],...forms.get(pickTarget)};
  if (draft.platform!==id) delete draft.account;
  draft.platform=id;
  forms.set(pickTarget,draft);
  result=null;
  back(pickTarget);
}
function submitAccount(route,values,form) {
  const preset=currentRoute.split('/')[1];
  const id=(forms.get(currentRoute) || {}).platform ?? preset;
  if (!platforms[id]) return formStatus(form,C('请先选择平台。','Selecione uma plataforma.'));
  const binding=demo.bindings[id];
  const account=String(values.account || '').trim();
  if (!binding && !account) return formStatus(form,C('请填写平台账号。','Informe a conta da plataforma.'));
  if (route==='bind') {
    if (!requireMember(currentRoute)) return;
    if (!bindPlatform(id,account)) return formStatus(form,C('绑定失败，请核对账号后重试。','Não foi possível vincular. Verifique a conta.'));
    forms.delete(currentRoute);
    save();
    showToast(C('绑定成功','Conta vinculada'));
    if (pendingOrder?.kind==='funds' && pendingOrder.awaiting && pendingOrder.id===id) {
      pendingOrder.returning=true;
      returnToStart('shop',pendingOrder.depth);
    } else if (history.state?.ccParent && /^(review|redeem)(\/|$)/.test(history.state.ccParent)) {
      back();
    } else renderRoute(true);
    return;
  }
  result=makeQuote(id,binding,binding?.account || mask(account));
  renderQuote();
}
function submitPage(form) {
  const [task,id] = form.dataset.form.split('/');
  const values = Object.fromEntries(new FormData(form).entries());
  switch (task) {
    case 'auth': submitAuth(id,values,form); break;
    case 'bind': case 'redeem': submitAccount(task,values,form); break;
    case 'review': {
      if (!signedIn || !demo.bindings[id] || !values.body.trim()) return;
      (demo.reviews[id] ||= []).unshift({stars:Number(values.stars),author:demo.member,body:values.body.trim(),at:now()});
      reviewTab.set(id,0);
      forms.delete(currentRoute);
      save();
      showToast(C('评价已提交','Avaliação enviada'));
      if (history.state?.ccParent==='detail/'+id) back();
      else go('detail/'+id,{replace:true});
      break;
    }
    case 'checkout': {
      if (!signedIn || !pendingOrder) return;
      const record=completeOrder(pendingOrder,Number(values.amount));
      if (typeof record==='string') {
        formStatus(form,record==='balance'?C('可用积分不足。','Pontos insuficientes.'):
          C('请核对兑换信息或库存后重试。','Confira os dados ou o estoque e tente novamente.'));
        return;
      }
      pendingOrder=null;
      modal.close();
      save();
      renderRoute(true);
      showToast(C('兑换申请已提交','Troca enviada'));
      dialog(C('兑换已提交','Troca enviada'),group([link('orders',C('查看兑换记录','Ver histórico'),'primary')]));
      break;
    }
    case 'address': {
      if (!signedIn) return;
      const data=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.trim()]));
      if (!data.recipient || !/^[0-9-]{8,9}$/.test(data.postcode) || !data.street)
        return formStatus(form,C('请核对收件人、CEP 和街道后保存。','Confira destinatário, CEP e rua.'));
      demo.address=data;
      forms.delete(currentRoute);
      save();
      showToast(C('地址已保存','Endereço salvo'));
      if (pendingOrder?.kind==='goods' && pendingOrder.awaiting) {
        pendingOrder.returning=true;
        returnToStart('shop',pendingOrder.depth);
      } else if (history.state?.ccParent==='address') back();
      else go('address',{replace:true});
      break;
    }
    case 'pix': {
      if (!signedIn) return;
      const cpf=values.cpf.replace(/\D/g,'');
      if (cpf.length!==11) return formStatus(form,C('请输入 11 位示例 CPF。','Informe 11 dígitos fictícios.'));
      demo.pix=mask(cpf);
      forms.delete(currentRoute);
      save();
      showToast(C('Pix 已保存','Pix salvo'));
      if (pendingWithdrawal) {
        pendingWithdrawal=false;
        backToWithdrawal=true;
        returnToStart('wheel',withdrawDepth);
      } else if (history.state?.ccParent==='pix') back();
      else go('pix',{replace:true});
      break;
    }
    case 'claim': {
      if (!signedIn || !demo.bindings[id] || !values.body.trim()) return;
      const images=[...form.elements.attachments.files];
      if (images.some(file=>!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) || images.length>4)
        return formStatus(form,C('请选择最多 4 张 PNG、JPG、WebP 或 GIF 截图。','Escolha até 4 imagens PNG, JPG, WebP ou GIF.'));
      const attachments=images.map(file=>file.name);
      const claim={id:recordId(),platform:id,account:demo.bindings[id].account,amount:Number(values.amount),
        requested:values.requested,body:values.body.trim(),attachments,at:now(),status:'review'};
      attachmentPreviews.set(claim.id,images.map(file=>({name:file.name,url:URL.createObjectURL(file)})));
      demo.claims.unshift(claim);
      forms.delete(currentRoute);
      protectionTab='claims';
      save();
      showToast(C('申诉已提交','Solicitação enviada'));
      go('claim-detail/'+claim.id,{replace:true});
      break;
    }
    case 'chat':
      if (values.message.trim()) { answer(values.message.trim()); form.reset(); }
      break;
  }
}
let withdrawDepth=0;
let backToWithdrawal=false;
function action(name,target) {
  const [key,id,extra] = name.split('/');
  switch (key) {
    case 'back': if (currentRoute==='select') back(pickTarget || 'home'); else back(navParents[currentRoute.split('/')[0]] || 'home'); break;
    case 'detail-tab': reviewTab.set(id,Number(extra)); renderRoute(true); break;
    case 'favorite':
      if (requireMember(currentRoute)) {
        if (favorites.has(Number(id))) favorites.delete(Number(id)); else favorites.add(Number(id));
        save(); renderFeatured(); renderRoute(true);
      }
      break;
    case 'official': case 'partner': case 'platform-chat':
      dialog(key==='partner' ? C('通过本站注册','Cadastro pela CASH CLUB') :
        key==='platform-chat' ? C('平台客服','Suporte da plataforma') : C('平台官网','Site da plataforma'),
        `<p>${C('平台外链由运营配置。演示环境暂无站外地址。','Os links são configurados pela operação. A demonstração não possui endereço externo.')}</p>`);
      break;
    case 'pick':
      pickTarget=currentRoute;
      go('select');
      break;
    case 'choose': selectPlatform(id); break;
    case 'confirm-redeem':
      if (signedIn && result && commitQuote(result)) {save(); renderQuote();}
      break;
    case 'product': startOrder('goods',id); break;
    case 'fund': startOrder('funds',id); break;
    case 'cancel-order': pendingOrder=null; modal.close(); break;
    case 'order-filter': orderFilter=id; renderRoute(true); break;
    case 'wallet-filter': walletFilter.kind=id; renderRoute(true); break;
    case 'wallet-platform': walletFilter.platform=Number(id); walletFilter.kind='all'; go('wallet'); break;
    case 'wallet-all': delete walletFilter.platform; renderRoute(true); break;
    case 'protection-tab': protectionTab=id; renderRoute(true); break;
    case 'checkin':
      if (!signedIn || demo.checkin===new Date().toDateString()) return;
      demo.checkin=new Date().toDateString(); save(); renderRoute(true);
      showToast(C('签到成功','Check-in concluído')); break;
    case 'spin': spin(); break;
    case 'share':
      dialog(C('邀请好友','Convidar amigos'),`<p>${C('将邀请链接发给好友，好友完成注册后可计入有效邀请。','Compartilhe o convite. O cadastro concluído conta como convite válido.')}</p>
        ${group([button('copy-invite',C('复制链接','Copiar link'),'primary'),link('invites',C('邀请明细','Histórico'))])}`);
      break;
    case 'copy-invite': copyText(inviteLink()); break;
    case 'sample-invite':
      if (signedIn && addInvite()) { save(); renderRoute(true); showToast(C('已新增一条演示邀请','Convite de demonstração adicionado')); }
      break;
    case 'withdraw-start':
      if (!requireMember('wheel') || !demo.wheel || demo.wheel.cents<wheelGoal || demo.wheel.withdrawn) return;
      if (demo.pix) go('withdraw');
      else {pendingWithdrawal=true; withdrawDepth=history.state?.ccDepth || 0; go('pix');}
      break;
    case 'withdraw-confirm':
      if (!signedIn || !demo.pix || !demo.wheel || demo.wheel.withdrawn || demo.wheel.cents<wheelGoal) return;
      demo.wheel.withdrawn=true;
      demo.withdrawals.unshift({id:recordId(),cents:wheelGoal,pix:demo.pix,at:now(),status:'pending'});
      save();
      showToast(C('提现申请已提交','Solicitação de saque enviada'));
      if (history.state?.ccParent==='wheel') back();
      else go('wheel',{replace:true});
      break;
    case 'sms':
      formStatus(target.closest('form'),C('演示验证码为 123456，未发送短信。','Código de demonstração: 123456. Nenhum SMS enviado.'));
      break;
    case 'logout':
      signedIn=false; demo.member=null; tab='recommended'; loginTarget='account';
      forms.clear(); authSecrets.clear(); save(); renderFeatured(); renderRoute(true); break;
    case 'attachment': {
      const file=attachmentPreviews.get(id)?.[Number(extra)];
      if (file) dialog(C('申诉截图','Comprovante'),`<img class="attachment-large" src="${file.url}" alt="${safe(file.name)}">`);
      break;
    }
    case 'zoom': dialog(C('步骤示意图','Ilustração da etapa'),tutorialPreview(Number(id),Number(extra))); break;
    case 'question': answer(t().questions[id],Number(id)); break;
    case 'human': humanSupport(); break;
    case 'copy-contact': copyText('suporte@example.com'); break;
    case 'contact-preview':
      dialog(C('站外客服','Canal externo'),`<p>${C('此邮箱为占位示例。正式上线后可跳转到启用的客服渠道。','Este e-mail é fictício. O canal real será disponibilizado após configuração.')}</p>`);
      break;
  }
}
function navigate() {
  renderRoute();
  if (currentRoute==='wheel' && backToWithdrawal) {
    backToWithdrawal=false;
    go('withdraw');
  } else if (currentRoute==='wheel') pendingWithdrawal=false;
}
document.addEventListener('click',event => {
  const target=event.target.closest('a,button');
  if (!target || target.disabled) return;
  if (target.tagName==='A' && target.getAttribute('href')?.startsWith('#')) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const destination=target.getAttribute('href').slice(1);
    if (modal.open && pendingOrder && /^(address|bind\/)/.test(destination)) pendingOrder.awaiting=true;
    if (destination==='register/invite') authWasInvite=true;
    if (destination==='login' && !authPages.has(currentRoute.split('/')[0])) loginTarget='account';
    if (destination==='wallet' && currentRoute!=='ledger') {
      delete walletFilter.platform; walletFilter.kind='all';
    }
    if (destination.startsWith('protection/')) protectionTab='eligibility';
    go(destination);
    return;
  }
  if (target.id==='notice') $('#announcement').showModal();
  if (target.id==='carousel-playback') {
    carouselPaused = !carouselPaused;
    renderHero();
    $('#carousel-playback').focus({preventScroll:true});
  }
  if (target.hasAttribute('data-slide')) changeSlide(Number(target.dataset.slide),true);
  if (target.dataset.tab) pickTab(target.dataset.tab);
  if (target.dataset.act) action(target.dataset.act,target);
});
document.addEventListener('submit',event => {
  if (!event.target.dataset.form) return;
  event.preventDefault();
  submitPage(event.target);
});
document.addEventListener('input',event => {
  const target=event.target;
  switch (target.id) {
    case 'list-search': listQuery=target.value; renderList(); return;
    case 'help-search': helpQuery=target.value; renderHelp(); return;
    case 'shop-search': shopQuery=target.value; renderShop(); return;
    case 'pick-search':
      forms.set('select',{query:target.value}); renderPicker(); return;
  }
  if (target.form?.dataset.form==='checkout' && target.name==='amount') {
    pendingOrder.amount=target.value;
    $('#order-total').textContent=pointText(target.value || 0);
    formStatus(target.form,'');
    return;
  }
  if (!target.form?.dataset.form || !target.name || ['code','message','attachments'].includes(target.name)) return;
  if (target.name==='password') { authSecrets.set(currentRoute,target.value); return; }
  const draft=forms.get(currentRoute) || {};
  draft[target.name]=target.value;
  forms.set(currentRoute,draft);
  if (currentRoute.startsWith('redeem')) {result=null; renderQuote();}
});
document.addEventListener('change',event => {
  if (event.target.id!=='language') return;
  lang=event.target.value;
  save();
  renderHome();
  renderRoute(true);
  $('#language').focus({preventScroll:true});
});
document.addEventListener('keydown',event => {
  if (event.target.matches('.featured [role="tab"]') && ['ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault();
    pickTab(tab==='recommended'?'favorites':'recommended');
  }
});
function changeSlide(index,focus=false) {
  slide=(index+t().banners.length)%t().banners.length;
  renderHero();
  if (focus) $('#hero [aria-current="true"]').focus({preventScroll:true});
}
const carousel=$('#hero');
carousel.addEventListener('touchstart',event => { dragStart=event.changedTouches[0].clientX; },{passive:true});
carousel.addEventListener('touchend',event => {
  const delta=event.changedTouches[0].clientX-dragStart;
  if (Math.abs(delta)>45) changeSlide(slide+(delta<0?1:-1));
},{passive:true});
history.scrollRestoration='manual';
if (!history.state?.ccDepth) history.replaceState({ccDepth:0},'');
window.addEventListener('popstate',navigate);
window.addEventListener('hashchange',() => { if (routeOf()!==currentRoute) navigate(); });
renderHome();
renderRoute();
setInterval(() => {
  if (currentRoute==='home' && !carouselPaused && !document.hidden && !$('#announcement').open &&
    !carousel.matches(':hover, :focus-within') && !matchMedia('(prefers-reduced-motion: reduce)').matches) changeSlide(slide+1);
},6500);
setInterval(renderActivity,4200);
