import { makeCloudClient } from './cloud-api.js';
import { parseMoney, calculateTotals, makeSale, csvCell, sanitizeCustomer, sanitizeNote, voidSale, orderStatus, validateVoidFields, validateContactFields, hkDateKey, shiftDateKey, summarizeDay, searchTokens, matchesTokens, LIMITS } from './pos-core.js?v=__BUILD__';

const $ = selector => document.querySelector(selector);
const cloud = makeCloudClient();
let cloudReady = false;
let pendingSale = null;
async function cloudOrdersRefresh() {
  const rows = await cloud.orders();
  state.orders = readableOrders(rows.filter(row => row.receipt_json).map(row => ({...row.receipt_json, status:row.status, localOnly:true})));
}
async function requireCloudLogin() {
  if (cloud.isSignedIn) {
    try { await cloud.ensureSession(); await cloudOrdersRefresh(); cloudReady=true; return; }
    catch (error) { console.warn('Cloud session needs login',error); }
  }
  const cover=document.createElement('div');
  cover.id='cloud-login-cover';
  cover.style.cssText='position:fixed;inset:0;background:#f7f7f7;z-index:99999;display:grid;place-items:center;padding:20px';
  cover.innerHTML='<form id="cloud-login-form" style="background:white;border:1px solid #ddd;border-radius:16px;padding:28px;width:min(400px,100%);display:grid;gap:14px"><h2>華發 POS · 店舖登入</h2><p>請使用已授權嘅共用 POS 帳戶。未登入無法收銀。</p><label>電郵<input name="email" type="email" autocomplete="username" required style="width:100%;padding:12px"></label><label>密碼<input name="password" type="password" autocomplete="current-password" required style="width:100%;padding:12px"></label><p id="cloud-login-error" role="alert" style="color:#b00020"></p><button type="submit" style="padding:14px;background:#e9c22c;border:0;border-radius:8px;font-weight:bold">登入 POS</button></form>';
  document.body.appendChild(cover);
  cover.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('button'),error=form.querySelector('#cloud-login-error');
    button.disabled=true;error.textContent='';
    try { await cloud.login(form.elements.email.value,form.elements.password.value);await cloudOrdersRefresh();cloudReady=true;cover.remove(); }
    catch(e) { error.textContent='登入或讀取交易失敗：'+e.message; }
    finally { button.disabled=false; }
  });
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = cents => 'HK$' + (Number(cents) / 100).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortMoney = cents => '$' + (Number(cents) / 100).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTime = value => new Date(value).toLocaleString('zh-HK', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
const CART_KEY = 'wahfat-pos-cart-v1';
const ORDERS_KEY = 'wahfat-pos-orders-v1';
const BUILD = '__BUILD__';
const HELD_KEY = 'wahfat-pos-held-v1';
const FAVORITES_KEY = 'wahfat-pos-favorites-v1';
const MAX_HELD = 20;
const MAX_FAVORITES = 24;
const PAYMENT_NAMES = { cash:'現金', fps:'轉數快', payme:'PayMe', card:'信用卡', octopus:'八達通' };
const STATUS_NAMES = { voided:'已作廢', refunded:'已退款' };
const VARIANT_KEYWORDS = ['單位','一位','兩位','三位','四位','單控','雙控','LED','13A','USB','光暗','蘇','TV','電話','Cat6','燈曲','Fuse'];
const icons = {
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 6M3 5v6h6M12 7v5l3 2"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  tablet:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M11 18h2"/>',
  trash:'<path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v6M14 10v6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  bag:'<path d="M5 7h14l2 14H3L5 7ZM8 8V6a4 4 0 0 1 8 0v2"/>',
  tag:'<path d="m3 3 8 .2 10 10-7.8 7.8-10-10L3 3Z"/><circle cx="7.5" cy="7.5" r="1"/>',
  wallet:'<path d="M20 8V4H4a2 2 0 0 0 0 4h17v12H4a2 2 0 0 1-2-2V6M21 12h-6v4h6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  cash:'<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M5 9h1M18 15h1"/>',
  phone:'<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  card:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 15h4"/>',
  print:'<path d="M6 8V2h12v6M6 17H3V8h18v9h-3M6 13h12v9H6zM17 10h1"/>',
  star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>',
  chart:'<path d="M4 20h16M7 20v-7M12 20V5M17 20v-10"/>',
  pause:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  note:'<path d="M5 3h10l4 4v14H5V3ZM14 3v5h5M8 13h8M8 17h6"/>',
  inbox:'<path d="M3 13l3-8h12l3 8v6H3v-6ZM3 13h5l1 3h6l1-3h5"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`; }
function paintIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
function safeUrl(value) { try { const url = new URL(value, location.href); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function imageMarkup(url, alt, className = '') { const safe = safeUrl(url); return safe ? `<img src="${esc(safe)}" alt="${esc(alt)}" class="${esc(className)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="no-image">${icon('image')}暫無圖片</span>`; }
function newId() { return `WF-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomUUID ? crypto.randomUUID().slice(0,8).toUpperCase() : Math.random().toString(36).slice(2,10).toUpperCase()}`; }
function freshCart() { return { id:newId(), items:[], discount:{ type:'fixed', value:0 }, customer:{ name:'', phone:'' }, note:'' }; }
const state = { catalog:null, products:[], collections:[], search:'', category:'', vendor:'', availableOnly:false, pageLimit:48, cart:freshCart(), orders:[], currentProduct:null, selectedVariant:null, selectedQuantity:1, modal:null, paymentMethod:'cash', paymentTendered:'', paymentConfirmed:false, processing:false, lastFocus:null, storageOk:true, lastSale:null, variantQuery:'', favorites:[], variants:new Map(), reportDate:'' };
let toastTimer;
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(() => $('#toast').classList.remove('visible'),2700); }
function storageProblem(text) { state.storageOk=false; const el=$('#storage-warning');el.hidden=false;el.textContent=text || '這個瀏覽器未能保存資料。請先匯出現有記錄，再使用一般瀏覽模式或騰出裝置空間。收款已暫停，避免遺失訂單。'; }
function readStorage(key, fallback) { try { const raw=localStorage.getItem(key);return raw ? JSON.parse(raw) : fallback; } catch { storageProblem('本機資料無法讀取。為免覆蓋現有記錄，收款暫時停用。請先查看瀏覽器儲存設定。');return fallback; } }
function writeStorage(key, value) { if (!state.storageOk) return false;try { localStorage.setItem(key,JSON.stringify(value));return true; } catch { storageProblem();return false; } }
function persistCart() { return writeStorage(CART_KEY,state.cart); }
function isSaleable(variant) { return variant.available === true && Number.isSafeInteger(variant.priceCents) && variant.priceCents > 0 && !variant.priceReviewReason; }
function variantLabel(variant) { return variant.title && variant.title !== 'Default Title' ? variant.title : '標準款式'; }
function getVariant(product, id) { return product.variants.find(variant => String(variant.id) === String(id)); }
function toCartItem(product, variant, quantity=1) { return { productId:product.id, variantId:variant.id, title:product.title, variantTitle:variantLabel(variant), sku:variant.sku || '', priceCents:variant.priceCents, priceReviewReason:variant.priceReviewReason || '', quantity, imageUrl:variant.imageUrl || product.images?.[0]?.src || '', sourceUrl:product.sourceUrl }; }
function normalizeCart(raw) {
  const restored=freshCart();
  if (!raw || !Array.isArray(raw.items) || typeof raw.id !== 'string') return restored;
  if (state.orders.some(order => order.id === raw.id)) return restored;
  restored.id=raw.id;
  let changed=false;
  for (const item of raw.items) {
    const product=state.products.find(product => String(product.id)===String(item.productId));
    const variant=product && getVariant(product,item.variantId);
    if (!variant || !isSaleable(variant) || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>999 || restored.items.some(existing => String(existing.variantId)===String(item.variantId))) { changed=true;continue; }
    if (variant.priceCents!==item.priceCents) changed=true;
    restored.items.push(toCartItem(product,variant,item.quantity));
  }
  try { if (!raw.discount || typeof raw.discount !== 'object') throw new Error('Missing discount'); calculateTotals(restored.items,raw.discount);restored.discount={...raw.discount}; } catch { changed=true; }
  restored.customer=sanitizeCustomer(raw.customer);restored.note=sanitizeNote(raw.note);
  if (changed) setTimeout(() => toast('已按目前商品目錄更新購物車及價格。'),400);
  return restored;
}
function readableOrders(raw) {
  try {
    if (!Array.isArray(raw)) throw new Error('Invalid order list');
    const ids=new Set();
    for (const order of raw) {
      if (!order || order.test!==true || order.localOnly!==true || order.currency!=='HKD' || typeof order.createdAt!=='string' || typeof order.id!=='string' || ids.has(order.id)) throw new Error('Invalid order');
      if (!Array.isArray(order.items) || order.items.some(item=>!item || typeof item.title!=='string' || typeof item.variantTitle!=='string')) throw new Error('Invalid item');
      validateVoidFields(order);validateContactFields(order);
      const verified=makeSale({...order,confirmed:true});
      for (const key of ['subtotalCents','discountCents','totalCents','itemCount','tenderedCents','changeCents']) if (order[key]!==verified[key]) throw new Error('Invalid totals');
      ids.add(order.id);
    }
    return raw;
  } catch {
    storageProblem('本機交易記錄格式不正確。原有資料已保留，收款及儲存暫停；請使用「下載完整備份」保留原始資料。');
    return [];
  }
}
function renderCategories() {
  $('#all-count').textContent=state.products.length;
  $('#all-products').classList.toggle('active',!state.category);
  $('#categories').innerHTML=state.collections.map(collection => `<button class="category-button ${String(collection.id)===state.category?'active':''}" data-category="${esc(collection.id)}"><span>${esc(collection.title)}</span><b>${esc(collection.productCount ?? collection.productIds?.length ?? '')}</b></button>`).join('');
  if (!$('#mobile-category')) {
    const select=document.createElement('select');select.id='mobile-category';select.className='mobile-category';select.setAttribute('aria-label','商品分類');$('.filter-bar').append(select);
    select.addEventListener('change',event=>selectCategory(event.target.value));
  }
  $('#mobile-category').innerHTML='<option value="">所有分類</option>'+state.collections.map(collection=>`<option value="${esc(collection.id)}">${esc(collection.title)}</option>`).join('');
  $('#mobile-category').value=state.category;
}
function selectCategory(id) { state.category=String(id);state.search='';$('#search').value='';$('#search-clear').hidden=true;state.pageLimit=48;renderCategories();renderProducts();$('.catalog-main').scrollTo({top:0,behavior:'smooth'}); }
function filteredProducts() {
  const tokens=searchTokens(state.search);
  return state.products.filter(product => (!state.category || product.collectionIds?.some(id=>String(id)===state.category)) && (!state.vendor || product.vendor===state.vendor) && (!state.availableOnly || product.variants.some(isSaleable)) && matchesTokens(product._search,tokens));
}
function renderProducts() {
  const matches=filteredProducts();const category=state.collections.find(c=>String(c.id)===state.category);
  $('#category-title').textContent=category?.title || '所有商品';
  $('#catalog-description').textContent=state.category ? '瀏覽分類商品，輕觸查看款式及價格。' : '揀選商品，開始一張新訂單。';
  $('#product-count').textContent=matches.length;
  $('#result-count').textContent=`顯示 ${Math.min(matches.length,state.pageLimit)} / ${matches.length} 款商品`;
  $('#reset-filters').hidden=!(state.search || state.category || state.vendor || state.availableOnly);
  $('#available-filter').setAttribute('aria-pressed',String(state.availableOnly));
  $('#product-grid').innerHTML=matches.length ? matches.slice(0,state.pageLimit).map(product=>{
    const saleable=product.variants.filter(isSaleable);const prices=saleable.map(v=>v.priceCents);const min=prices.length?Math.min(...prices):null;
    const priceText=min===null ? (product.variants.some(v=>v.priceReviewReason || v.priceCents===0)?'需確認價格':'暫不可售') : shortMoney(min);
    const hasRange=prices.some(price=>price!==min);
    const image=product.images?.[0]?.src || '';
    return `<button class="product-card" data-product="${esc(product.id)}" aria-label="${esc(product.title)}，${esc(priceText)}${hasRange?'起':''}"><div class="product-image">${imageMarkup(image,product.title)}${product.variants.length>1?`<span class="variant-badge">${product.variants.length} 款選擇</span>`:''}${saleable.length?'':`<span class="unavailable-badge">${esc(priceText)}</span>`}</div><div class="product-details"><span class="product-vendor">${esc(product.vendor || '華發科技有限公司')}</span><h2 class="product-title">${esc(product.title)}</h2><div class="product-price-line"><span class="product-price" ${min===null?'style="font-size:12px"':''}>${esc(priceText)}${hasRange?'<small>起</small>':''}</span><span class="product-add" aria-hidden="true">${saleable.length?'+':'↗'}</span></div></div></button>`;
  }).join('') : `<div class="empty-results">${icon('search')}<h2>未找到相符商品</h2><p>試試其他名稱、貨號，或清除目前篩選。</p><button class="text-button" data-action="reset-filters">清除篩選</button></div>`;
  $('#load-more').hidden=state.pageLimit>=matches.length;
}
function renderCart() {
  const totals=calculateTotals(state.cart.items,state.cart.discount);
  $('#cart-count').textContent=totals.itemCount;$('#mobile-cart-count').textContent=totals.itemCount;
  $('#subtotal').textContent=money(totals.subtotalCents);$('#discount-total').textContent='−'+money(totals.discountCents);$('#total').textContent=shortMoney(totals.totalCents);$('#mobile-cart-total').textContent=money(totals.totalCents);
  $('#discount-total-row').hidden=!totals.discountCents;$('#remove-discount').hidden=!state.cart.discount.value;
  $('#discount-button').innerHTML=icon('tag')+(state.cart.discount.value ? (state.cart.discount.type==='percent'?`${state.cart.discount.value}% 訂單折扣`:`訂單折扣 ${money(state.cart.discount.value)}`) : '加入訂單折扣');
  $('#clear-cart').disabled=!state.cart.items.length;$('#checkout-button').disabled=!state.cart.items.length || !state.storageOk;
  $('#cart-items').innerHTML=state.cart.items.length ? state.cart.items.map(item=>`<div class="cart-item">${imageMarkup(item.imageUrl,item.title,'cart-item-image')}<div><h3>${esc(item.title)}</h3><p class="cart-item-variant">${esc(item.variantTitle)}</p><div class="cart-item-footer"><div class="quantity-control" aria-label="${esc(item.title)}數量"><button data-cart-minus="${esc(item.variantId)}" aria-label="減少一件">−</button><span>${item.quantity}</span><button data-cart-plus="${esc(item.variantId)}" aria-label="增加一件" ${item.quantity>=999?'disabled':''}>+</button></div><span class="cart-item-price">${money(item.priceCents*item.quantity)}</span></div></div><button class="cart-remove" data-cart-remove="${esc(item.variantId)}" aria-label="移除${esc(item.title)}">${icon('close')}</button></div>`).join('') : `<div class="empty-cart"><span class="empty-cart-icon">${icon('bag')}</span><h3>準備好開始了</h3><p>輕觸左邊的商品，<br>為這張訂單加入第一件貨品。</p></div>`;
  const {customer={},note=''}=state.cart,memo=[customer.name,customer.phone,note].filter(Boolean).join(' · ');
  $('#held-count').textContent=readHeld().length;$('#hold-button').disabled=!state.cart.items.length;
  $('#note-label').textContent=memo?'備註／客戶 ✓':'備註／客戶';$('#cart-memo').hidden=!memo;$('#cart-memo').textContent=memo;
}
function addToCart(product,variant,quantity) {
  if (!isSaleable(variant)) {toast('此款式暫不可加入，請先確認供應及價格。');return false;}
  const existing=state.cart.items.find(item=>String(item.variantId)===String(variant.id));
  if ((existing?.quantity || 0)+quantity>999) {toast('每款商品最多可加入 999 件。');return false;}
  if (existing) existing.quantity+=quantity;else state.cart.items.push(toCartItem(product,variant,quantity));
  persistCart();renderCart();return true;
}
function openModal(title,content,{wide=false,footer='',kind='generic',refocus=true}={}) {
  if (!state.modal) state.lastFocus=document.activeElement;
  state.modal=kind;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="eyebrow">WAH FAT · 本機試用</span><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" data-action="close-modal" aria-label="關閉">${icon('close')}</button></header><div class="modal-body">${content}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;
  if (refocus) $('#modal-root [data-action="close-modal"]').focus({preventScroll:true});
}
function closeModal() { if (state.processing) return;$('#modal-root').innerHTML='';state.modal=null;state.lastFocus?.focus?.({preventScroll:true}); }
function productOptions(product) {
  return (product.options || []).filter(option=>option.name!=='Title' || product.variants.length>1).map((option,index)=>{
    const key=`option${index+1}`;
    return {name:option.name,index,key,values:[...new Set(product.variants.map(v=>v[key]).filter(value=>value!==null && value!==undefined))]};
  }).filter(option=>option.values.length);
}
function variantFor(product,current,index,value) {
  const key=`option${index+1}`;
  const same=product.variants.filter(v=>v[key]===value && Array.from({length:index},(_,i)=>v[`option${i+1}`]===current[`option${i+1}`]).every(Boolean));
  const saleable=same.filter(isSaleable),pool=saleable.length?saleable:same;
  return {valid:saleable.length>0,variant:pool.find(v=>Array.from({length:2-index},(_,j)=>v[`option${index+j+2}`]===current[`option${index+j+2}`]).every(Boolean)) || pool[0]};
}
function highlight(text,tokens) {
  if (!tokens.length) return esc(text);
  const pattern=new RegExp(`(${tokens.map(token=>token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'gi');
  return String(text).split(pattern).map((part,index)=>index%2?`<mark>${esc(part)}</mark>`:esc(part)).join('');
}
function pickerShell(option) {
  return `<div class="variant-picker"><div class="vp-head"><span>${esc(option.name)}</span><small id="vp-count"></small></div><div class="vp-search">${icon('search')}<input id="vp-search" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" placeholder="搜尋款式，例如：雙控 LED" value="${esc(state.variantQuery)}" aria-label="搜尋${esc(option.name)}"><button class="search-clear" id="vp-clear" type="button" aria-label="清除款式搜尋" hidden>${icon('close')}</button></div><div class="vp-tags" id="vp-tags"></div><div class="vp-list" id="vp-list" role="list"></div></div>`;
}
function openProduct(product) {
  state.currentProduct=product;state.selectedVariant=product.variants.find(isSaleable) || product.variants[0];state.selectedQuantity=1;state.variantQuery='';
  const picker=productOptions(product).find(option=>option.values.length>8);
  if (picker) {
    const own=[product.title,product.vendor,product.productType,...(product.tags || [])].filter(Boolean).join(' ').toLocaleLowerCase();
    const words=searchTokens(state.search).filter(word=>!own.includes(word) && picker.values.some(value=>value.toLocaleLowerCase().includes(word)));
    const matches=picker.values.filter(value=>matchesTokens(value.toLocaleLowerCase(),words));
    if (words.length && matches.length) {
      state.variantQuery=words.join(' ')+' ';
      const first=matches.map(value=>variantFor(product,state.selectedVariant,picker.index,value)).find(choice=>choice.valid);
      if (first) state.selectedVariant=first.variant;
    }
  }
  openModal('商品款式',`<div id="pm-intro"></div><div id="pm-options"></div>${picker?pickerShell(picker):''}<div id="pm-status"></div><div id="pm-actions"></div>`,{kind:'product'});
  updateProductModal({reveal:true});
}
function optionField(product,selected,option) {
  const choices=option.values.map(value=>({value,...variantFor(product,selected,option.index,value),active:selected[option.key]===value}));
  return `<div class="field"><span>${esc(option.name)}</span>${option.values.length>8?`<select data-option="${option.index}" aria-label="${esc(option.name)}">${choices.map(choice=>`<option value="${esc(choice.value)}" ${choice.active?'selected':''} ${choice.valid?'':'disabled'}>${esc(choice.value)}${choice.valid?'':' · 暫不可售'}</option>`).join('')}</select>`:`<div class="variant-options">${choices.map(choice=>`<button class="variant-choice ${choice.active?'active':''}" data-option="${option.index}" data-option-value="${esc(choice.value)}" ${choice.valid?'':'disabled'} aria-pressed="${choice.active}">${esc(choice.value)}</button>`).join('')}</div>`}</div>`;
}
function updatePicker(product,selected,option,reveal) {
  const list=$('#vp-list'),tokens=searchTokens(state.variantQuery),top=list.scrollTop;
  const rows=option.values.map(value=>({value,...variantFor(product,selected,option.index,value),active:selected[option.key]===value})).filter(row=>matchesTokens(row.value.toLocaleLowerCase(),tokens));
  list.innerHTML=rows.length ? rows.map(row=>{
    const favorite=row.valid && isFavorite(row.variant.id);
    return `<div class="variant-row ${row.active?'active':''} ${row.valid?'':'off'}" role="listitem"><button type="button" class="variant-row-main" data-option="${option.index}" data-option-value="${esc(row.value)}" ${row.valid?'':'disabled'} aria-pressed="${row.active}"><span class="vr-name">${highlight(row.value,tokens)}</span><span class="vr-price">${row.valid?money(row.variant.priceCents):'暫不可售'}</span></button>${row.valid?`<button type="button" class="fav-toggle ${favorite?'on':''}" data-fav-variant="${esc(row.variant.id)}" aria-pressed="${favorite}" aria-label="${favorite?'移除常用款式':'設為常用款式'}：${esc(row.value)}">${icon('star')}</button>`:''}</div>`;
  }).join('') : `<div class="vp-empty">沒有相符的款式。<button type="button" class="text-button" id="vp-clear-empty">清除搜尋</button></div>`;
  list.scrollTop=top;
  $('#vp-count').textContent=tokens.length?`${rows.length} / ${option.values.length} 款`:`共 ${option.values.length} 款`;
  $('#vp-clear').hidden=!state.variantQuery;
  const lowered=option.values.map(value=>value.toLocaleLowerCase());
  $('#vp-tags').innerHTML=VARIANT_KEYWORDS.map(word=>({word,count:lowered.filter(value=>value.includes(word.toLocaleLowerCase())).length})).filter(tag=>tag.count>0 && tag.count<option.values.length).slice(0,14).map(tag=>{
    const active=tokens.includes(tag.word.toLocaleLowerCase());
    return `<button type="button" class="vp-tag ${active?'active':''}" data-vp-tag="${esc(tag.word)}" aria-pressed="${active}">${esc(tag.word)}<small>${tag.count}</small></button>`;
  }).join('');
  if (reveal) {const row=list.querySelector('.variant-row.active');if (row) list.scrollTop=Math.max(0,row.offsetTop-list.clientHeight/2+row.offsetHeight/2);}
}
function updateProductModal({reveal=false}={}) {
  const product=state.currentProduct,selected=state.selectedVariant;if (state.modal!=='product' || !product || !selected) return;
  const active=document.activeElement,inModal=$('#modal-root').contains(active);
  const restore=!inModal?'':active.dataset.action?`[data-action="${active.dataset.action}"]`:active.dataset.optionValue!==undefined?`[data-option="${active.dataset.option}"][data-option-value="${CSS.escape(active.dataset.optionValue)}"]`:active.dataset.favVariant?`[data-fav-variant="${active.dataset.favVariant}"]`:'';
  const options=productOptions(product),picker=options.find(option=>option.values.length>8);
  const good=isSaleable(selected),multi=product.variants.length>1,favorite=isFavorite(selected.id);
  const status=selected.priceReviewReason || (selected.priceCents<=0?'網站售價未確認，暫不能加入訂單。':selected.available?'網站標示可售 · 實際庫存需另行確認':'網站標示暫不可售');
  $('#pm-intro').innerHTML=`<div class="product-modal-intro">${imageMarkup(selected.imageUrl || product.images?.[0]?.src,product.title,'product-modal-image')}<div class="product-modal-copy"><span class="product-vendor">${esc(product.vendor)}</span><h3>${esc(product.title)}</h3><div class="product-price">${selected.priceCents>0?money(selected.priceCents):'需確認價格'}</div>${multi?`<div class="selected-variant">已選：<b>${esc(variantLabel(selected))}</b></div>`:''}<div class="pm-links"><a href="${esc(safeUrl(product.sourceUrl))}" target="_blank" rel="noopener noreferrer">查看網站商品 ↗</a>${good||favorite?`<button type="button" class="fav-link ${favorite?'on':''}" data-action="toggle-fav" aria-pressed="${favorite}">${icon('star')}<span>${favorite?'已設為常用':'設為常用款式'}</span></button>`:''}</div></div></div>`;
  $('#pm-options').innerHTML=options.filter(option=>option!==picker).map(option=>optionField(product,selected,option)).join('')+(!options.length && multi?`<label class="field"><span>款式</span><select id="variant-select">${product.variants.map(v=>`<option value="${esc(v.id)}" ${String(v.id)===String(selected.id)?'selected':''} ${isSaleable(v)?'':'disabled'}>${esc(variantLabel(v))} · ${money(v.priceCents)}${isSaleable(v)?'':' · 暫不可售'}</option>`).join('')}</select></label>`:'');
  if (picker) updatePicker(product,selected,picker,reveal);
  $('#pm-status').innerHTML=`<div class="variant-status ${good?'':'warning'}"><span>${esc(status)}</span>${selected.sku?`<span>貨號 ${esc(selected.sku)}</span>`:''}</div>`;
  $('#pm-actions').innerHTML=`<div class="modal-actions"><div class="quantity-control"><button data-action="product-minus" aria-label="減少數量" ${state.selectedQuantity<=1?'disabled':''}>−</button><span id="product-quantity">${state.selectedQuantity}</span><button data-action="product-plus" aria-label="增加數量" ${state.selectedQuantity>=999?'disabled':''}>+</button></div><button class="primary-button" id="add-product" data-action="add-product" ${good?'':'disabled'}>${good?`加入訂單 · ${money(selected.priceCents*state.selectedQuantity)}`:'需確認後才可出售'}</button></div>${multi?`<button type="button" class="secondary-button keep-open" data-action="add-keep" ${good?'':'disabled'}>加入後繼續揀款式</button>`:''}`;
  if (restore) $('#modal-root').querySelector(restore)?.focus({preventScroll:true});
}
function chooseOption(index,value) {
  const choice=variantFor(state.currentProduct,state.selectedVariant,index,value);
  if (choice.valid) state.selectedVariant=choice.variant;
  updateProductModal();
}
function toggleVariantTag(word) {
  const key=word.toLocaleLowerCase(),words=state.variantQuery.split(/\s+/).filter(Boolean);
  const next=words.some(token=>token.toLocaleLowerCase()===key)?words.filter(token=>token.toLocaleLowerCase()!==key):[...words,word];
  setVariantQuery(next.length?next.join(' ')+' ':'');
}
function setVariantQuery(value,{syncInput=true}={}) {
  state.variantQuery=value;if (syncInput) $('#vp-search').value=value;
  updateProductModal();$('#vp-list').scrollTop=0;
}
function openDiscount() {
  const d=state.cart.discount;
  openModal('訂單折扣',`<p style="margin-bottom:20px">折扣會套用到整張訂單，應收金額最低為 HK$0.00。</p><form id="discount-form"><label class="field"><span>折扣方式</span><select id="discount-type"><option value="fixed" ${d.type==='fixed'?'selected':''}>固定金額（HK$）</option><option value="percent" ${d.type==='percent'?'selected':''}>減免百分比（%）</option></select></label><label class="field"><span>折扣數值</span><input id="discount-value" inputmode="decimal" value="${d.value?(d.type==='fixed'?(d.value/100).toFixed(2):d.value):''}" placeholder="0" autocomplete="off" required></label><p id="discount-error" class="form-error" hidden></p><button class="primary-button" style="width:100%;margin-top:20px" type="submit">套用折扣</button></form>`,{kind:'discount'});
}
function paymentContent() {
  const totals=calculateTotals(state.cart.items,state.cart.discount);
  const methods=Object.entries(PAYMENT_NAMES).map(([key,name])=>`<button type="button" class="payment-method ${state.paymentMethod===key?'active':''}" data-payment="${key}" aria-pressed="${state.paymentMethod===key}">${icon(key==='cash'?'cash':key==='fps'||key==='payme'?'phone':'card')}${name}</button>`).join('');
  const cash=state.paymentMethod==='cash';
  return `<form id="payment-form"><div class="payment-total"><span>${totals.itemCount} 件商品 · 應收金額</span><strong>${money(totals.totalCents)}</strong></div><div class="payment-methods">${methods}</div>${cash?`<label class="field"><span>實收現金（HK$）</span><input id="tendered" class="cash-input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(state.paymentTendered)}"><div class="quick-cash">${[...new Set([totals.totalCents,10000,50000,100000].filter(c=>c>=totals.totalCents))].map((amount,index)=>`<button type="button" data-tender="${amount}">${index===0?'剛好':money(amount)}</button>`).join('')}</div></label><div class="change-row"><span>找續</span><strong id="change-amount">—</strong></div>`:`<p class="payment-notice">請在外部收款設備或相應 App 完成 ${esc(PAYMENT_NAMES[state.paymentMethod])} 收款。本頁只記錄付款方式，沒有連接支付服務。</p><label class="payment-confirm"><input id="payment-confirmed" type="checkbox" ${state.paymentConfirmed?'checked':''}><span>我已在外部確認收款成功，現在建立本機試用記錄。</span></label>`}<p class="payment-notice">試用記錄只會保存在目前瀏覽器；不會向顧客實際扣款，亦不會更新網站庫存。</p><p id="payment-error" class="form-error" role="alert" hidden></p><button type="submit" id="complete-sale" class="primary-button" style="width:100%">${icon('check')}完成本機試用記錄</button></form>`;
}
function openPayment(reset=true) {
  if (!state.cart.items.length || !state.storageOk)return;
  if(reset){state.paymentMethod='cash';state.paymentTendered='';state.paymentConfirmed=false;}
  openModal('收款',paymentContent(),{kind:'payment',refocus:reset});updateChange();
}
function updateChange() { if(!$('#change-amount'))return;const amount=parseMoney($('#tendered').value);const total=calculateTotals(state.cart.items,state.cart.discount).totalCents;$('#change-amount').textContent=amount!==null && amount>=total?money(amount-total):'—'; }
async function completeSale() {
  if (state.processing || !state.storageOk) return;
  if (!cloudReady || !navigator.onLine) { toast('雲端未連線，暫停收銀，避免遺失交易。'); return; }
  state.processing=true;
  const button=$('#complete-sale');
  if (button) { button.disabled=true;button.textContent='正在儲存雲端交易…'; }
  try {
    for (const item of state.cart.items) {
      const product=state.products.find(p=>String(p.id)===String(item.productId));
      const variant=product&&getVariant(product,item.variantId);
      if (!variant || !isSaleable(variant) || variant.priceCents!==item.priceCents) throw new Error('有商品的價格或供應狀態需要重新確認。');
    }
    const sale=pendingSale?.id===state.cart.id ? pendingSale : makeSale({items:state.cart.items,discount:state.cart.discount,paymentMethod:state.paymentMethod,tenderedCents:state.paymentMethod==='cash'?parseMoney(state.paymentTendered):undefined,confirmed:state.paymentConfirmed,id:state.cart.id,customer:state.cart.customer,note:state.cart.note});
    pendingSale=sale;
    // Cloud write is the source of truth. Never mark a sale successful based only on local storage.
    await cloud.saveSale(sale);
    await cloudOrdersRefresh();
    state.lastSale={...sale,localOnly:false};
    state.cart=freshCart();pendingSale=null;persistCart();
    renderCart();$('#cart-panel').classList.remove('open');showSuccess(state.lastSale);
  } catch(error) {
    const el=$('#payment-error');
    if(el){el.textContent=error.message+'。如網絡中斷，請先檢查交易記錄，勿另開新單重收。';el.hidden=false;}
    if(button){button.disabled=false;button.textContent='重試儲存雲端交易';}
  } finally {state.processing=false;}
}
function showSuccess(sale) {
  openModal('記錄已儲存',`<div class="success-body"><div class="success-icon">${icon('check')}</div><h3>這張訂單完成了</h3><p>已儲存至雲端</p><div class="success-amount">${money(sale.totalCents)}</div><p>${esc(PAYMENT_NAMES[sale.paymentMethod])}${sale.paymentMethod==='cash'?` · 找續 ${money(sale.changeCents)}`:''}</p><p style="font-size:10px;margin-top:7px">${esc(sale.id)}</p><div class="success-actions"><button class="secondary-button" data-action="print-last">${icon('print')} 列印收據</button><button class="primary-button" data-action="close-modal">開始下一張訂單 →</button></div></div>`,{kind:'success'});
}
function receiptVoid(order) { const status=orderStatus(order);return status==='completed'?'':`<div class="receipt-void"><strong>${STATUS_NAMES[status]}</strong><br>${esc(dateTime(order.voidedAt))}<br>原因：${esc(order.voidReason)}</div>`; }
function receiptContact(order) { return (order.customer?`<div class="receipt-meta">客戶：${esc(order.customer.name || '—')}${order.customer.phone?`<br>電話：${esc(order.customer.phone)}`:''}</div>`:'')+(order.note?`<div class="receipt-meta receipt-note">備註：${esc(order.note)}</div>`:''); }
function receiptMarkup(order) {
  return `<div class="receipt"><div class="receipt-heading"><h3>華發</h3><p>華發科技有限公司 · 雲端交易收據</p><p>試用記錄 · 並非實際付款憑證</p></div>${receiptVoid(order)}<div class="receipt-meta">${esc(order.id)}<br>${esc(dateTime(order.createdAt))}<br>付款記錄：${esc(PAYMENT_NAMES[order.paymentMethod] || order.paymentMethod)}</div>${receiptContact(order)}${order.items.map(item=>`<div class="receipt-line"><div>${esc(item.title)}<small>${esc(item.variantTitle)} · ${item.quantity} × ${money(item.priceCents)}</small></div><span>${money(item.quantity*item.priceCents)}</span></div>`).join('')}<div class="receipt-totals"><div class="receipt-line"><span>商品小計</span><span>${money(order.subtotalCents)}</span></div>${order.discountCents?`<div class="receipt-line"><span>訂單折扣</span><span>−${money(order.discountCents)}</span></div>`:''}<div class="receipt-line receipt-total"><span>應收總額</span><span>${money(order.totalCents)}</span></div>${order.paymentMethod==='cash'?`<div class="receipt-line"><span>實收現金</span><span>${money(order.tenderedCents)}</span></div><div class="receipt-line"><span>找續</span><span>${money(order.changeCents)}</span></div>`:''}</div><div class="receipt-bottom">交易紀錄儲存於雲端。<br>此系統未接駁支付平台或網站庫存。</div></div>`;
}
function printReceipt(order) {if(!order)return;$('#print-receipt').innerHTML=receiptMarkup(order);window.print();}
function openHistory() {
  const valid=state.orders.filter(order=>orderStatus(order)==='completed'),total=valid.reduce((sum,o)=>sum+o.totalCents,0),voided=state.orders.length-valid.length;
  openModal('交易記錄',`<p class="info-note">以下為雲端交易記錄；重新開啟可更新資料。</p><div class="history-summary"><div><strong>${valid.length}</strong><span>雲端訂單</span></div><div><strong>${money(total)}</strong><span>已記錄金額</span></div>${voided?`<div><strong>${voided}</strong><span>已作廢／退款</span></div>`:''}</div><div class="order-list">${state.orders.length?state.orders.map(order=>{const status=orderStatus(order);return `<button class="order-row ${status==='completed'?'':'is-void'}" data-order="${esc(order.id)}"><div><strong>${esc(order.id)}${status==='completed'?'':` <span class="status-badge">${STATUS_NAMES[status]}</span>`}</strong><small>${esc(dateTime(order.createdAt))} · ${esc(PAYMENT_NAMES[order.paymentMethod] || order.paymentMethod)} · ${order.itemCount} 件${order.customer?.name?` · ${esc(order.customer.name)}`:''}</small></div><span class="order-amount">${money(order.totalCents)}<small>查看收據 ↗</small></span></button>`;}).join(''):'<div class="empty-results"><h2>還未有交易記錄</h2><p>完成第一張訂單後，即可在此查看及列印收據。</p></div>'}</div>`,{wide:true,kind:'history',footer:'<button class="secondary-button" data-action="export-json">匯出備份 JSON</button><button class="secondary-button" data-action="export-csv">匯出銷售 CSV</button>'});
}
function openReceipt(order) {state.lastSale=order;openModal('交易收據',receiptMarkup(order),{kind:'receipt',footer:`<button class="secondary-button" data-action="history">返回交易記錄</button>${orderStatus(order)==='completed'?`<button class="secondary-button danger" data-void-order="${esc(order.id)}">作廢／退款</button>`:''}<button class="primary-button" data-action="print-last">列印收據</button>`});}
function downloadFile(name,content,type) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportJson() {
  const orders=state.orders;
  let backup={app:'wahfat-pos',schemaVersion:2,exportedAt:new Date().toISOString(),source:'cloud',orders};
  if (!state.storageOk) {
    try { backup={...backup,recovery:true,rawOrders:localStorage.getItem(ORDERS_KEY),rawCart:localStorage.getItem(CART_KEY)}; }
    catch { backup={...backup,recovery:true,note:'Browser storage inaccessible; only current session data is included.',orders:state.orders,cart:state.cart}; }
  }
  downloadFile(`wahfat-pos-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2),'application/json');toast('備份檔案已準備下載。');
}
function exportCsv() {
  const headers=['訂單編號','香港時間','記錄類型','付款方式','商品名稱','款式','貨號','單價 HKD','數量','商品金額 HKD','訂單小計 HKD','訂單折扣 HKD','訂單總額 HKD','實收 HKD','找續 HKD','訂單狀態','客戶名稱','聯絡電話','訂單備註','作廢／退款時間','作廢／退款原因'];
  const rows=state.orders.flatMap(order=>order.items.map((item,index)=>{
    const status=orderStatus(order);
    return [order.id,dateTime(order.createdAt),'本機試用',PAYMENT_NAMES[order.paymentMethod] || order.paymentMethod,item.title,item.variantTitle,item.sku,(item.priceCents/100).toFixed(2),item.quantity,(item.priceCents*item.quantity/100).toFixed(2),index?'':(order.subtotalCents/100).toFixed(2),index?'':(order.discountCents/100).toFixed(2),index?'':(order.totalCents/100).toFixed(2),index?'':(order.tenderedCents/100).toFixed(2),index?'':(order.changeCents/100).toFixed(2),STATUS_NAMES[status] || '有效',index?'':order.customer?.name || '',index?'':order.customer?.phone || '',index?'':order.note || '',index||status==='completed'?'':dateTime(order.voidedAt),index?'':order.voidReason || ''];
  }));
  downloadFile(`wahfat-pos-sales-${new Date().toISOString().slice(0,10)}.csv`,'﻿'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('銷售明細已準備下載。');
}
function openInfo() {
  const catalog=state.catalog, summary=catalog?.summary || {};const variants=state.products.flatMap(p=>p.variants);
  const needsReview=variants.filter(v=>v.priceReviewReason || v.priceCents<=0).length;
  openModal('商品資料與備份',`<p>商品名稱、款式、售價及圖片來自 <a href="https://whafat-hk.com/" target="_blank" rel="noopener noreferrer">華發科技有限公司網站 ↗</a>。</p><div class="info-grid"><div class="info-stat"><strong>${state.products.length}</strong><span>網站商品</span></div><div class="info-stat"><strong>${variants.length.toLocaleString()}</strong><span>商品款式</span></div></div><p>資料擷取：${catalog?.importedAt?esc(dateTime(catalog.importedAt)):'尚未載入'}</p><p>程式版本：${BUILD.startsWith('__')?'本機測試版':esc(BUILD)}</p><ul class="info-list"><li>目前使用網站資料快照，價格及可售狀態不會自動更新。結帳前請確認實際價格與存貨。</li><li>${needsReview} 款網站價格需要確認，已暫停加入訂單；其他網站標示不可售的款式亦不可加入。</li><li>沒有連接網站庫存、會員或支付服務。轉數快、PayMe、信用卡及八達通只作付款方式記錄。</li><li>圖片直接取自網站。首次載入完成、且瀏覽器支援離線儲存後，已載入的目錄可離線使用；未看過的圖片仍可能需要網絡。缺少原圖的商品會顯示「暫無圖片」。</li><li>目前網站商品資料沒有條碼；搜尋可使用商品名稱、款式或已提供的貨號。</li><li>交易只儲存在目前瀏覽器。清除網站資料、私密瀏覽或更換裝置可能令記錄遺失，請定期備份。</li><li>客戶名稱、電話及備註只保存在這部裝置，並會出現在收據、交易記錄及備份檔案內；請只輸入有需要的資料，並妥善保管備份。</li></ul><h3 class="section-title">備份本機交易</h3><p style="margin-bottom:13px">JSON 保留完整訂單；CSV 適合在試算表查看銷售明細。</p><div class="backup-actions"><button class="secondary-button" data-action="export-json">下載完整備份</button><button class="secondary-button" data-action="export-csv">下載銷售 CSV</button></div><h3 class="section-title">在 iPad 使用</h3><p>用 Safari 開啟本頁，點選「分享」→「加入主畫面」。建議固定使用同一部裝置及同一個瀏覽器保存試用交易。</p>`,{kind:'info'});
}
function setSearch(value,{focus=false}={}) {
  state.search=value;state.pageLimit=48;$('#search').value=value;$('#search-clear').hidden=!value;renderProducts();
  if (focus) $('#search').focus();
}
function resetFilters() {state.category='';state.vendor='';state.availableOnly=false;$('#vendor-filter').value='';renderCategories();setSearch('');}

function readFavorites() { try { const raw=JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');return Array.isArray(raw)?raw.filter(id=>Number.isSafeInteger(id)).slice(0,MAX_FAVORITES):[]; } catch { return []; } }
function writeFavorites() { if (!state.storageOk) return;try { localStorage.setItem(FAVORITES_KEY,JSON.stringify(state.favorites)); } catch { toast('常用款式未能保存，請檢查裝置空間。'); } }
function isFavorite(id) { return state.favorites.includes(Number(id)); }
function toggleFavorite(id) {
  id=Number(id);
  if (isFavorite(id)) state.favorites=state.favorites.filter(favorite=>favorite!==id);
  else {if (state.favorites.length>=MAX_FAVORITES) {toast(`常用款式最多 ${MAX_FAVORITES} 個，請先移除一個。`);return;}state.favorites=[id,...state.favorites];}
  writeFavorites();renderFavorites();
}
function renderFavorites() {
  const entries=state.favorites.map(id=>state.variants.get(id)).filter(Boolean),bar=$('#favorites-bar');
  bar.hidden=!entries.length;
  bar.innerHTML=entries.length?`<span class="favorites-label">${icon('star')}常用款式</span><div class="favorites-list">${entries.map(({product,variant})=>{
    const ok=isSaleable(variant),image=safeUrl(variant.imageUrl || product.images?.[0]?.src);
    return `<div class="fav-chip ${ok?'':'off'}"><button type="button" class="fav-chip-main" data-fav-add="${esc(variant.id)}" ${ok?'':'disabled'} aria-label="加入 ${esc(product.title)} ${esc(variantLabel(variant))} 到訂單">${image?`<img src="${esc(image)}" alt="" class="fav-chip-image" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}<span class="fav-chip-text"><b>${esc(product.title)}</b><small>${esc(variantLabel(variant))} · ${ok?shortMoney(variant.priceCents):'暫不可售'}</small></span></button><button type="button" class="fav-chip-x" data-fav-remove="${esc(variant.id)}" aria-label="移除常用款式">${icon('close')}</button></div>`;
  }).join('')}</div>`:'';
}

function readHeld() { try { const raw=JSON.parse(localStorage.getItem(HELD_KEY) || '[]');return Array.isArray(raw)?raw.filter(entry=>entry && typeof entry.id==='string' && Array.isArray(entry.items)):[]; } catch { return []; } }
function writeHeld(list) { if (!state.storageOk) return false;try { localStorage.setItem(HELD_KEY,JSON.stringify(list));return true; } catch { toast('暫存訂單未能保存，請檢查裝置空間。');return false; } }
function holdCurrent() {
  if (!state.cart.items.length) return;
  const held=readHeld();if (held.length>=MAX_HELD) {toast(`最多暫存 ${MAX_HELD} 張訂單，請先取回或刪除。`);return;}
  if (!writeHeld([{...state.cart,savedAt:new Date().toISOString()},...held])) return;
  state.cart=freshCart();persistCart();renderCart();$('#cart-panel').classList.remove('open');toast('訂單已暫存，可按「取回」繼續。');
}
function heldTotals(entry) { try { return calculateTotals(entry.items,entry.discount); } catch { return {totalCents:0,itemCount:entry.items.length}; } }
function openHeld() {
  const held=readHeld();
  openModal('暫存訂單',held.length?`<p class="info-note">暫存訂單只保存在這部裝置。取回時會按目前商品目錄重新核對價格及供應。</p><div class="order-list">${held.map(entry=>{const totals=heldTotals(entry);return `<div class="order-row held-row"><div><strong>${esc(entry.customer?.name || entry.items[0]?.title || '暫存訂單')}</strong><small>${esc(dateTime(entry.savedAt))} · ${totals.itemCount} 件${entry.note?` · ${esc(String(entry.note).slice(0,30))}`:''}</small></div><div class="held-actions"><span class="order-amount">${money(totals.totalCents)}</span><button type="button" class="secondary-button" data-held-resume="${esc(entry.id)}">取回</button><button type="button" class="secondary-button danger" data-held-delete="${esc(entry.id)}">刪除</button></div></div>`;}).join('')}</div>`:'<div class="empty-results"><h2>未有暫存訂單</h2><p>在購物車按「暫存」，可以先服務下一位客戶。</p></div>',{kind:'held'});
}
function resumeHeld(id) {
  const held=readHeld(),entry=held.find(item=>item.id===id);if (!entry) return;
  const rest=held.filter(item=>item.id!==id),restored=normalizeCart(entry);
  if (!restored.items.length) {toast('這張暫存訂單未能取回：商品已不可出售，或訂單已完成。');return;}
  if (state.cart.items.length) {
    if (rest.length>=MAX_HELD) {toast(`最多暫存 ${MAX_HELD} 張訂單，請先刪除一張。`);return;}
    rest.unshift({...state.cart,savedAt:new Date().toISOString()});
  }
  if (!writeHeld(rest)) return;
  state.cart=restored;persistCart();renderCart();closeModal();toast('已取回暫存訂單。');
}
function deleteHeld(id) { if (writeHeld(readHeld().filter(item=>item.id!==id))) {renderCart();openHeld();} }

function openNote() {
  const {customer={name:'',phone:''},note=''}=state.cart;
  openModal('備註／客戶資料',`<form id="note-form"><p class="info-note">客戶資料只保存在這部裝置，並會出現在收據、交易記錄及備份檔案內。請只輸入有需要的資料。</p><label class="field"><span>客戶名稱（選填）</span><input id="customer-name" maxlength="${LIMITS.name}" value="${esc(customer.name)}" autocomplete="off"></label><label class="field"><span>聯絡電話（選填）</span><input id="customer-phone" type="tel" inputmode="tel" maxlength="${LIMITS.phone}" value="${esc(customer.phone)}" autocomplete="off"></label><label class="field"><span>訂單備註（選填）</span><textarea id="order-note" rows="4" maxlength="${LIMITS.note}" placeholder="例如：星期五送貨、預留貨品">${esc(note)}</textarea></label><div class="form-actions"><button type="button" class="secondary-button" data-action="clear-note">清除</button><button type="submit" class="primary-button">儲存</button></div></form>`,{kind:'note'});
}
function saveNote(clear=false) {
  state.cart.customer=clear?{name:'',phone:''}:sanitizeCustomer({name:$('#customer-name').value,phone:$('#customer-phone').value});
  state.cart.note=clear?'':sanitizeNote($('#order-note').value);
  persistCart();renderCart();closeModal();
}

function openVoid(order) {
  openModal('作廢／退款',`<form id="void-form" data-void-for="${esc(order.id)}"><p class="info-note">${esc(order.id)} · ${money(order.totalCents)} · ${esc(PAYMENT_NAMES[order.paymentMethod] || order.paymentMethod)}。此操作會將整張訂單標記為已作廢或已退款，並計入當日報表的扣減。記錄不可還原；實際退還現金或款項需自行處理，本系統不會連接支付服務。</p><div class="field"><span>處理方式</span><div class="variant-options"><label class="radio-chip"><input type="radio" name="void-type" value="void" checked><span>作廢（輸入錯誤／取消）</span></label><label class="radio-chip"><input type="radio" name="void-type" value="refund"><span>退款（顧客退貨）</span></label></div></div><label class="field"><span>原因（必填）</span><input id="void-reason" maxlength="${LIMITS.reason}" required placeholder="例如：輸入錯誤、顧客取消、貨品有問題" autocomplete="off"></label><label class="payment-confirm"><input id="void-confirm" type="checkbox"><span>我確認要處理這張訂單，並明白此操作不可還原。</span></label><p id="void-error" class="form-error" role="alert" hidden></p><button type="submit" class="primary-button danger-fill" style="width:100%">確認處理</button></form>`,{kind:'void'});
}
async function submitVoid(orderId) {
  const fail=message=>{const el=$('#void-error');if(el){el.textContent=message;el.hidden=false;}};
  if (!$('#void-confirm').checked) {fail('請先剔選確認。');return;}
  if(state.processing || !cloudReady || !navigator.onLine){fail('雲端未連線，暫時無法作廢／退款。');return;}
  const type=document.querySelector('input[name="void-type"]:checked')?.value,reason=$('#void-reason').value;
  state.processing=true;
  try {
    await cloud.voidSale(orderId,type,reason);
    await cloudOrdersRefresh();
    const updated=state.orders.find(order=>order.id===orderId);
    if(updated)openReceipt(updated);
    toast('訂單已於雲端更新。');
  } catch(error) {fail(error.message);} finally {state.processing=false;}
}

const netMoney = cents => cents<0 ? '−'+money(-cents) : money(cents);
function reportBody(day) {
  if (!day.orderCount && !day.voidCount) return '<div class="empty-results"><h2>這一日未有交易記錄</h2><p>可以按左右箭咀轉日，或揀其他日期。</p></div>';
  const tile=(value,label,main='')=>`<div class="report-tile ${main}"><strong>${value}</strong><span>${label}</span></div>`;
  return `<div class="report-tiles">${tile(netMoney(day.netCents),'淨銷售額','main')}${tile(day.orderCount,'銷售單數')}${tile(money(day.salesCents),'銷售額')}${tile(money(day.discountCents),'訂單折扣')}${tile(`${day.voidCount} 張 · ${money(day.voidCents)}`,'作廢／退款')}</div>
  <h3 class="section-title">付款方式</h3><div class="table-wrap"><table class="report-table"><thead><tr><th>付款方式</th><th>單數</th><th>銷售</th><th>作廢／退款</th><th>淨額</th></tr></thead><tbody>${day.methods.map(m=>`<tr><td>${esc(PAYMENT_NAMES[m.method] || m.method)}</td><td>${m.count}</td><td>${money(m.salesCents)}</td><td>${m.voidCents?'−'+money(m.voidCents):'—'}</td><td><b>${netMoney(m.netCents)}</b></td></tr>`).join('')}</tbody></table></div>
  ${day.items.length?`<h3 class="section-title">銷售商品</h3><div class="table-wrap"><table class="report-table"><thead><tr><th>商品／款式</th><th>數量</th><th>金額</th></tr></thead><tbody>${day.items.slice(0,30).map(row=>`<tr><td>${esc(row.title)}<small>${esc(row.variantTitle)}${row.sku?` · ${esc(row.sku)}`:''}</small></td><td>${row.quantity}</td><td>${money(row.amountCents)}</td></tr>`).join('')}</tbody></table></div>${day.items.length>30?`<p class="report-note">只顯示銷量最多的 30 款，其餘 ${day.items.length-30} 款請下載 CSV 查看。</p>`:''}`:''}
  ${day.voids.length?`<h3 class="section-title">作廢／退款</h3><ul class="report-voids">${day.voids.map(v=>`<li><b>${esc(v.id)}</b> · ${STATUS_NAMES[v.status]} · ${money(v.totalCents)} · ${esc(PAYMENT_NAMES[v.paymentMethod] || v.paymentMethod)}<small>${esc(dateTime(v.voidedAt))} · 原因：${esc(v.reason)}</small></li>`).join('')}</ul>`:''}
  <p class="report-note">銷售按訂單日期計算；作廢及退款按處理日期扣除。商品金額未扣除訂單折扣，並只包括目前仍然有效的訂單。這是本機試用記錄，不包括開市備用金或外部收款核對。</p>`;
}
function renderReport() { $('#report-body').innerHTML=reportBody(summarizeDay(state.orders,state.reportDate)); }
function openReport(dateKey=hkDateKey(new Date().toISOString())) {
  state.reportDate=dateKey;
  openModal('日結報表',`<div class="report-nav"><button class="icon-button" data-report-shift="-1" aria-label="前一日">‹</button><input id="report-date" type="date" value="${esc(dateKey)}" aria-label="報表日期"><button class="icon-button" data-report-shift="1" aria-label="後一日">›</button><button class="text-button" data-report-today>今日</button></div><div id="report-body"></div>`,{wide:true,kind:'report',footer:'<button class="secondary-button" data-action="report-csv">下載報表 CSV</button><button class="primary-button" data-action="report-print">列印報表</button>'});
  renderReport();
}
function setReportDate(dateKey) { if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey||'')) return;state.reportDate=dateKey;$('#report-date').value=dateKey;renderReport(); }
function printReport() {
  const day=summarizeDay(state.orders,state.reportDate);
  $('#print-receipt').innerHTML=`<div class="receipt report-print"><div class="receipt-heading"><h3>華發 · 日結報表</h3><p>${esc(day.date)} · 本機試用記錄</p></div>${reportBody(day)}</div>`;window.print();
}
function exportReportCsv() {
  const day=summarizeDay(state.orders,state.reportDate),num=cents=>({n:(cents/100).toFixed(2)});
  const rows=[['日結報表',day.date],['淨銷售額 HKD',num(day.netCents)],['銷售單數',day.orderCount],['銷售額 HKD',num(day.salesCents)],['訂單折扣 HKD',num(day.discountCents)],['作廢／退款單數',day.voidCount],['作廢／退款金額 HKD',num(day.voidCents)],[],
    ['付款方式','單數','銷售 HKD','作廢／退款單數','作廢／退款 HKD','淨額 HKD'],...day.methods.map(m=>[PAYMENT_NAMES[m.method] || m.method,m.count,num(m.salesCents),m.voidCount,num(m.voidCents),num(m.netCents)]),[],
    ['商品','款式','貨號','數量','金額 HKD（未扣訂單折扣）'],...day.items.map(row=>[row.title,row.variantTitle,row.sku,row.quantity,num(row.amountCents)]),[],
    ['作廢／退款訂單','類型','原因','金額 HKD','處理時間'],...day.voids.map(v=>[v.id,STATUS_NAMES[v.status],v.reason,num(v.totalCents),dateTime(v.voidedAt)])];
  const cell=value=>typeof value==='object'?value.n:typeof value==='number'?String(value):csvCell(value);
  downloadFile(`wahfat-pos-daily-${day.date}.csv`,'﻿'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('日結報表已準備下載。');
}
function bindEvents() {
  $('#search').addEventListener('input',event=>{state.search=event.target.value;state.pageLimit=48;$('#search-clear').hidden=!state.search;renderProducts();});
  $('#search').addEventListener('keydown',event=>{if (event.key==='Escape' && state.search) {event.preventDefault();setSearch('');}});
  $('#search-clear').addEventListener('mousedown',event=>event.preventDefault());
  $('#search-clear').addEventListener('click',()=>setSearch('',{focus:true}));
  $('#vendor-filter').addEventListener('change',event=>{state.vendor=event.target.value;state.pageLimit=48;renderProducts();});
  $('#available-filter').addEventListener('click',()=>{state.availableOnly=!state.availableOnly;state.pageLimit=48;renderProducts();});
  $('#all-products').addEventListener('click',()=>selectCategory(''));
  $('#categories').addEventListener('click',event=>{const el=event.target.closest('[data-category]');if(el)selectCategory(el.dataset.category);});
  $('#product-grid').addEventListener('click',event=>{const card=event.target.closest('[data-product]');if(card)openProduct(state.products.find(p=>String(p.id)===card.dataset.product));if(event.target.closest('[data-action="reset-filters"]'))resetFilters();});
  $('#load-more').addEventListener('click',()=>{state.pageLimit+=48;renderProducts();});
  $('#reset-filters').addEventListener('click',resetFilters);
  $('#report-button').addEventListener('click',()=>openReport());
  $('#note-button').addEventListener('click',openNote);
  $('#hold-button').addEventListener('click',holdCurrent);
  $('#held-button').addEventListener('click',openHeld);
  $('#favorites-bar').addEventListener('click',event=>{
    const add=event.target.closest('[data-fav-add]'),remove=event.target.closest('[data-fav-remove]');
    if (add) {const entry=state.variants.get(Number(add.dataset.favAdd));if (entry && addToCart(entry.product,entry.variant,1)) toast(`已加入：${entry.product.title} · ${variantLabel(entry.variant)}`);}
    else if (remove) toggleFavorite(remove.dataset.favRemove);
  });
  $('#discount-button').addEventListener('click',openDiscount);
  $('#remove-discount').addEventListener('click',()=>{state.cart.discount={type:'fixed',value:0};persistCart();renderCart();});
  $('#checkout-button').addEventListener('click',()=>openPayment());
  $('#history-button').addEventListener('click',openHistory);
  $('#info-button').addEventListener('click',openInfo);$('#source-info').addEventListener('click',openInfo);
  $('#clear-cart').addEventListener('click',()=>openModal('清空目前訂單',`<p>移除這張尚未結帳訂單的全部商品及折扣。</p>`,{kind:'clear',footer:'<button class="secondary-button" data-action="close-modal">保留訂單</button><button class="primary-button" data-action="confirm-clear">清空訂單</button>'}));
  $('#mobile-cart-button').addEventListener('click',()=>$('#cart-panel').classList.add('open'));
  $('#close-mobile-cart').addEventListener('click',()=>$('#cart-panel').classList.remove('open'));
  $('#cart-items').addEventListener('click',event=>{const button=event.target.closest('[data-cart-plus],[data-cart-minus],[data-cart-remove]');if(!button)return;const id=button.dataset.cartPlus || button.dataset.cartMinus || button.dataset.cartRemove;const item=state.cart.items.find(i=>String(i.variantId)===id);if(!item)return;if(button.dataset.cartRemove){state.cart.items=state.cart.items.filter(i=>i!==item);}else{item.quantity+=button.dataset.cartPlus?1:-1;if(item.quantity<=0)state.cart.items=state.cart.items.filter(i=>i!==item);if(item.quantity>999)item.quantity=999;}persistCart();renderCart();});
  $('#modal-root').addEventListener('click',event=>{
    if(event.target.classList.contains('modal-backdrop')){closeModal();return;}
    const option=event.target.closest('button[data-option]');if(option){chooseOption(Number(option.dataset.option),option.dataset.optionValue);return;}
    const tag=event.target.closest('[data-vp-tag]');if(tag){toggleVariantTag(tag.dataset.vpTag);return;}
    if(event.target.closest('#vp-clear,#vp-clear-empty')){setVariantQuery('');$('#vp-search').focus();return;}
    const star=event.target.closest('[data-fav-variant]');if(star){toggleFavorite(star.dataset.favVariant);updateProductModal();return;}
    const resume=event.target.closest('[data-held-resume]');if(resume){resumeHeld(resume.dataset.heldResume);return;}
    const discard=event.target.closest('[data-held-delete]');if(discard){if(discard.dataset.armed)deleteHeld(discard.dataset.heldDelete);else{discard.dataset.armed='1';discard.textContent='確定刪除？';}return;}
    const shift=event.target.closest('[data-report-shift]');if(shift){setReportDate(shiftDateKey(state.reportDate,Number(shift.dataset.reportShift)));return;}
    if(event.target.closest('[data-report-today]')){setReportDate(hkDateKey(new Date().toISOString()));return;}
    const voidOrder=event.target.closest('[data-void-order]');if(voidOrder){const record=state.orders.find(o=>o.id===voidOrder.dataset.voidOrder);if(record)openVoid(record);return;}
    const method=event.target.closest('[data-payment]');if(method){state.paymentMethod=method.dataset.payment;state.paymentConfirmed=false;openPayment(false);return;}
    const tender=event.target.closest('[data-tender]');if(tender){state.paymentTendered=(Number(tender.dataset.tender)/100).toFixed(2);$('#tendered').value=state.paymentTendered;updateChange();return;}
    const order=event.target.closest('[data-order]');if(order){const record=state.orders.find(o=>o.id===order.dataset.order);if(record)openReceipt(record);return;}
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(action==='close-modal')closeModal();
    else if(action==='add-product'){const quantity=state.selectedQuantity;if(addToCart(state.currentProduct,state.selectedVariant,quantity)){closeModal();toast(`已加入 ${quantity} 件商品`);}}
    else if(action==='add-keep'){const quantity=state.selectedQuantity;if(addToCart(state.currentProduct,state.selectedVariant,quantity)){state.selectedQuantity=1;updateProductModal();toast(`已加入 ${quantity} 件 · ${variantLabel(state.selectedVariant)}`);}}
    else if(action==='toggle-fav'){toggleFavorite(state.selectedVariant.id);updateProductModal();}
    else if(action==='clear-note')saveNote(true);
    else if(action==='report-csv')exportReportCsv();
    else if(action==='report-print')printReport();
    else if(action==='product-plus'){state.selectedQuantity=Math.min(999,state.selectedQuantity+1);updateProductModal();}
    else if(action==='product-minus'){state.selectedQuantity=Math.max(1,state.selectedQuantity-1);updateProductModal();}
    else if(action==='confirm-clear'){state.cart=freshCart();persistCart();renderCart();closeModal();toast('目前訂單已清空。');}
    else if(action==='history')openHistory();
    else if(action==='print-last')printReceipt(state.lastSale);
    else if(action==='export-json')exportJson();
    else if(action==='export-csv')exportCsv();
  });
  $('#modal-root').addEventListener('change',event=>{if(event.target.matches('select[data-option]'))chooseOption(Number(event.target.dataset.option),event.target.value);if(event.target.id==='variant-select'){state.selectedVariant=getVariant(state.currentProduct,event.target.value);updateProductModal();}if(event.target.id==='payment-confirmed')state.paymentConfirmed=event.target.checked;if(event.target.id==='report-date')setReportDate(event.target.value);});
  $('#modal-root').addEventListener('input',event=>{if(event.target.id==='tendered'){state.paymentTendered=event.target.value;updateChange();}if(event.target.id==='vp-search')setVariantQuery(event.target.value,{syncInput:false});});
  $('#modal-root').addEventListener('submit',event=>{
    event.preventDefault();
    if(event.target.id==='payment-form'){completeSale();return;}
    if(event.target.id==='note-form'){saveNote();return;}
    if(event.target.id==='void-form'){submitVoid(event.target.dataset.voidFor);return;}
    if(event.target.id==='discount-form'){
      const type=$('#discount-type').value,text=$('#discount-value').value.trim();let value=type==='fixed'?parseMoney(text):(/^\d+(?:\.\d{1,2})?$/.test(text)?Number(text):null);
      try {if(value===null)throw new Error('請輸入正確數值，最多兩位小數。');calculateTotals(state.cart.items,{type,value});state.cart.discount={type,value};persistCart();renderCart();closeModal();}
      catch(error){$('#discount-error').textContent=error.message;$('#discount-error').hidden=false;}
    }
  });
  document.addEventListener('keydown',event=>{
    if(!state.modal)return;if(event.key==='Escape'){event.preventDefault();if(document.activeElement?.id==='vp-search' && state.variantQuery)setVariantQuery('');else closeModal();}
    if(event.key==='Tab'){const focusables=[...$('#modal-root').querySelectorAll('button:not([disabled]),a[href],input,select')].filter(el=>el.offsetParent!==null);const first=focusables[0],last=focusables.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  document.addEventListener('error',event=>{const img=event.target;if(img.tagName==='IMG'){const placeholder=document.createElement('span');placeholder.className='no-image';placeholder.innerHTML=icon('image')+'圖片暫未載入';img.replaceWith(placeholder);}},true);
  window.addEventListener('storage',event=>{if(event.key===ORDERS_KEY){state.orders=readableOrders(readStorage(ORDERS_KEY,[]));if(state.orders.some(o=>o.id===state.cart.id)){state.cart=freshCart();persistCart();renderCart();closeModal();toast('這張訂單已在另一個分頁完成。');}}});
}
async function init() {
  paintIcons();bindEvents();$('#today-label').textContent=new Date().toLocaleDateString('zh-HK',{timeZone:'Asia/Hong_Kong',month:'long',day:'numeric',weekday:'short'});
  try {localStorage.setItem('wahfat-pos-storage-test','1');localStorage.removeItem('wahfat-pos-storage-test');}catch{storageProblem();}
  try {
    const response=await fetch('./data/catalog.json');if(!response.ok)throw new Error('商品目錄暫時未能載入。');const catalog=await response.json();if(!Array.isArray(catalog.products))throw new Error('商品目錄格式不正確。');
    state.catalog=catalog;state.products=catalog.products.map(product=>({...product,_search:[product.title,product.vendor,product.productType,...(product.tags || []),...product.variants.flatMap(v=>[v.title,v.sku,v.barcode])].filter(Boolean).join(' ').toLocaleLowerCase()}));
    state.collections=(catalog.collections || []).filter(c=>c.productCount>0 || c.productIds?.length);
    state.variants=new Map(state.products.flatMap(product=>product.variants.map(variant=>[Number(variant.id),{product,variant}])));state.favorites=readFavorites();
    state.cart=normalizeCart(readStorage(CART_KEY,null));persistCart();
    const vendors=[...new Set(state.products.map(p=>p.vendor).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
    $('#vendor-filter').innerHTML='<option value="">全部品牌</option>'+vendors.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('#import-label').textContent=`網站資料 · ${new Date(catalog.importedAt).toLocaleDateString('zh-HK',{timeZone:'Asia/Hong_Kong'})}`;
    renderCategories();renderProducts();renderFavorites();renderCart();
  } catch(error) {$('#product-grid').innerHTML=`<div class="empty-results"><h2>未能載入商品目錄</h2><p>${esc(error.message)}<br>請確認網絡後重新整理頁面。</p><button class="secondary-button" onclick="location.reload()" style="margin-top:20px">重新載入</button></div>`;$('#result-count').textContent='商品目錄未就緒';}
}
init().then(requireCloudLogin);
document.addEventListener('visibilitychange',async()=>{
  if(document.visibilityState==='visible' && cloudReady) {
    try { await cloudOrdersRefresh(); } catch(e) { console.warn('Cloud refresh failed',e); }
  }
});
setInterval(async()=>{
  if(!cloudReady || !navigator.onLine || document.visibilityState!=='visible')return;
  try { await cloudOrdersRefresh(); } catch(e) { console.warn('Cloud refresh failed',e); }
},30000);
