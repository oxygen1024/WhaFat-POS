import { parseMoney, calculateTotals, makeSale, csvCell } from './pos-core.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = cents => 'HK$' + (Number(cents) / 100).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortMoney = cents => '$' + (Number(cents) / 100).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTime = value => new Date(value).toLocaleString('zh-HK', { timeZone:'Asia/Hong_Kong', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
const CART_KEY = 'wahfat-pos-cart-v1';
const ORDERS_KEY = 'wahfat-pos-orders-v1';
const PAYMENT_NAMES = { cash:'現金', fps:'轉數快', payme:'PayMe', card:'信用卡', octopus:'八達通' };
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
  print:'<path d="M6 8V2h12v6M6 17H3V8h18v9h-3M6 13h12v9H6zM17 10h1"/>'
};
function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.grid}</svg>`; }
function paintIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
function safeUrl(value) { try { const url = new URL(value, location.href); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function imageMarkup(url, alt, className = '') { const safe = safeUrl(url); return safe ? `<img src="${esc(safe)}" alt="${esc(alt)}" class="${esc(className)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="no-image">${icon('image')}暫無圖片</span>`; }
function newId() { return `WF-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomUUID ? crypto.randomUUID().slice(0,8).toUpperCase() : Math.random().toString(36).slice(2,10).toUpperCase()}`; }
function freshCart() { return { id:newId(), items:[], discount:{ type:'fixed', value:0 } }; }
const state = { catalog:null, products:[], collections:[], search:'', category:'', vendor:'', availableOnly:false, pageLimit:48, cart:freshCart(), orders:[], currentProduct:null, selectedVariant:null, selectedQuantity:1, modal:null, paymentMethod:'cash', paymentTendered:'', paymentConfirmed:false, processing:false, lastFocus:null, storageOk:true, lastSale:null };
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
function selectCategory(id) { state.category=String(id);state.pageLimit=48;renderCategories();renderProducts();$('.catalog-main').scrollTo({top:0,behavior:'smooth'}); }
function filteredProducts() {
  const query=state.search.trim().toLocaleLowerCase();
  return state.products.filter(product => (!state.category || product.collectionIds?.some(id=>String(id)===state.category)) && (!state.vendor || product.vendor===state.vendor) && (!state.availableOnly || product.variants.some(isSaleable)) && (!query || product._search.includes(query)));
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
}
function addToCart(product,variant,quantity) {
  if (!isSaleable(variant)) {toast('此款式暫不可加入，請先確認供應及價格。');return;}
  const existing=state.cart.items.find(item=>String(item.variantId)===String(variant.id));
  if ((existing?.quantity || 0)+quantity>999) {toast('每款商品最多可加入 999 件。');return;}
  if (existing) existing.quantity+=quantity;else state.cart.items.push(toCartItem(product,variant,quantity));
  persistCart();renderCart();closeModal();toast(`已加入 ${quantity} 件商品`);
}
function openModal(title,content,{wide=false,footer='',kind='generic',refocus=true}={}) {
  if (!state.modal) state.lastFocus=document.activeElement;
  state.modal=kind;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="eyebrow">WAH FAT · 本機試用</span><h2 id="modal-title">${esc(title)}</h2></div><button class="icon-button" data-action="close-modal" aria-label="關閉">${icon('close')}</button></header><div class="modal-body">${content}</div>${footer?`<footer class="modal-footer">${footer}</footer>`:''}</section></div>`;
  if (refocus) $('#modal-root [data-action="close-modal"]').focus({preventScroll:true});
}
function closeModal() { if (state.processing) return;$('#modal-root').innerHTML='';state.modal=null;state.lastFocus?.focus?.({preventScroll:true}); }
function openProduct(product) {state.currentProduct=product;state.selectedVariant=product.variants.find(isSaleable) || product.variants[0];state.selectedQuantity=1;renderProductModal();}
function renderProductModal(refocus=true) {
  const product=state.currentProduct,selected=state.selectedVariant;if(!product || !selected)return;
  const optionFields=(product.options || []).filter(option=>option.name!=='Title' || product.variants.length>1).map((option,index)=>{
    const key=`option${index+1}`;const values=[...new Set(product.variants.map(v=>v[key]).filter(value=>value!==null && value!==undefined))];
    if(!values.length)return '';
    const validFor=value=>product.variants.some(v=>v[key]===value && isSaleable(v) && Array.from({length:index},(_,j)=>v[`option${j+1}`]===selected[`option${j+1}`]).every(Boolean));
    const choices=values.map(value=>({value,valid:validFor(value),active:selected[key]===value}));
    return `<div class="field"><span>${esc(option.name)}</span>${values.length>8?`<select data-option="${index}" aria-label="${esc(option.name)}">${choices.map(choice=>`<option value="${esc(choice.value)}" ${choice.active?'selected':''} ${choice.valid?'':'disabled'}>${esc(choice.value)}${choice.valid?'':' · 暫不可售'}</option>`).join('')}</select>`:`<div class="variant-options">${choices.map(choice=>`<button class="variant-choice ${choice.active?'active':''}" data-option="${index}" data-option-value="${esc(choice.value)}" ${choice.valid?'':'disabled'} aria-pressed="${choice.active}">${esc(choice.value)}</button>`).join('')}</div>`}</div>`;
  }).join('');
  const good=isSaleable(selected);
  const status=selected.priceReviewReason || (selected.priceCents<=0?'網站售價未確認，暫不能加入訂單。':selected.available?'網站標示可售 · 實際庫存需另行確認':'網站標示暫不可售');
  openModal('商品款式',`<div class="product-modal-intro">${imageMarkup(selected.imageUrl || product.images?.[0]?.src,product.title,'product-modal-image')}<div class="product-modal-copy"><span class="product-vendor">${esc(product.vendor)}</span><h3>${esc(product.title)}</h3><div class="product-price">${selected.priceCents>0?money(selected.priceCents):'需確認價格'}</div><a href="${esc(safeUrl(product.sourceUrl))}" target="_blank" rel="noopener noreferrer">查看網站商品 ↗</a></div></div>${optionFields}${!optionFields && product.variants.length>1?`<label class="field"><span>款式</span><select id="variant-select">${product.variants.map(v=>`<option value="${esc(v.id)}" ${String(v.id)===String(selected.id)?'selected':''} ${isSaleable(v)?'':'disabled'}>${esc(variantLabel(v))} · ${money(v.priceCents)}${isSaleable(v)?'':' · 暫不可售'}</option>`).join('')}</select></label>`:''}<div class="variant-status ${good?'':'warning'}"><span>${esc(status)}</span>${selected.sku?`<span>貨號 ${esc(selected.sku)}</span>`:''}</div><div class="modal-actions"><div class="quantity-control"><button data-action="product-minus" aria-label="減少數量" ${state.selectedQuantity<=1?'disabled':''}>−</button><span id="product-quantity">${state.selectedQuantity}</span><button data-action="product-plus" aria-label="增加數量" ${state.selectedQuantity>=999?'disabled':''}>+</button></div><button class="primary-button" id="add-product" data-action="add-product" ${good?'':'disabled'}>${good?`加入訂單 · ${money(selected.priceCents*state.selectedQuantity)}`:'需確認後才可出售'}</button></div>`,{kind:'product',refocus});
}
function chooseOption(index,value) {
  const product=state.currentProduct,current=state.selectedVariant,key=`option${index+1}`;
  const candidates=product.variants.filter(v=>v[key]===value && isSaleable(v) && Array.from({length:index},(_,i)=>v[`option${i+1}`]===current[`option${i+1}`]).every(Boolean));
  state.selectedVariant=candidates.find(v=>Array.from({length:2-index},(_,j)=>v[`option${index+j+2}`]===current[`option${index+j+2}`]).every(Boolean)) || candidates[0] || current;renderProductModal(false);
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
  if(state.processing || !state.storageOk)return;
  state.processing=true;const button=$('#complete-sale');if(button){button.disabled=true;button.textContent='正在保存記錄…';}
  const finish=()=>{
    const existing=readStorage(ORDERS_KEY,[]);if(!state.storageOk)throw new Error('本機記錄未能讀取，尚未完成交易。');
    const orders=readableOrders(existing);if(!state.storageOk)throw new Error('本機記錄格式不正確，尚未完成交易。');
    const duplicate=orders.find(order=>order.id===state.cart.id);
    if(duplicate){state.lastSale=duplicate;state.orders=orders;state.cart=freshCart();persistCart();return duplicate;}
    for(const item of state.cart.items){const product=state.products.find(p=>String(p.id)===String(item.productId));const variant=product&&getVariant(product,item.variantId);if(!variant || !isSaleable(variant) || variant.priceCents!==item.priceCents)throw new Error('有商品的價格或供應狀態需要重新確認。請重新加入商品。');}
    const sale=makeSale({items:state.cart.items,discount:state.cart.discount,paymentMethod:state.paymentMethod,tenderedCents:state.paymentMethod==='cash'?parseMoney(state.paymentTendered):undefined,confirmed:state.paymentConfirmed,id:state.cart.id});
    const next=[sale,...orders];if(!writeStorage(ORDERS_KEY,next))throw new Error('記錄未能保存，交易尚未完成。請先備份資料及檢查裝置空間。');
    state.orders=next;state.lastSale=sale;state.cart=freshCart();persistCart();return sale;
  };
  try { const sale=navigator.locks?await navigator.locks.request('wahfat-pos-checkout',finish):finish();state.processing=false;renderCart();$('#cart-panel').classList.remove('open');showSuccess(sale); }
  catch(error){state.processing=false;const el=$('#payment-error');if(el){el.textContent=error.message;el.hidden=false;}if(button){button.disabled=!state.storageOk;button.textContent='完成本機試用記錄';}}
}
function showSuccess(sale) {
  openModal('記錄已儲存',`<div class="success-body"><div class="success-icon">${icon('check')}</div><h3>這張訂單完成了</h3><p>已保存至本機 · 試用交易</p><div class="success-amount">${money(sale.totalCents)}</div><p>${esc(PAYMENT_NAMES[sale.paymentMethod])}${sale.paymentMethod==='cash'?` · 找續 ${money(sale.changeCents)}`:''}</p><p style="font-size:10px;margin-top:7px">${esc(sale.id)}</p><div class="success-actions"><button class="secondary-button" data-action="print-last">${icon('print')} 列印試用收據</button><button class="primary-button" data-action="close-modal">開始下一張訂單 →</button></div></div>`,{kind:'success'});
}
function receiptMarkup(order) {
  return `<div class="receipt"><div class="receipt-heading"><h3>華發</h3><p>華發科技有限公司 · 本機試用收據</p><p>試用記錄 · 並非實際付款憑證</p></div><div class="receipt-meta">${esc(order.id)}<br>${esc(dateTime(order.createdAt))}<br>付款記錄：${esc(PAYMENT_NAMES[order.paymentMethod] || order.paymentMethod)}</div>${order.items.map(item=>`<div class="receipt-line"><div>${esc(item.title)}<small>${esc(item.variantTitle)} · ${item.quantity} × ${money(item.priceCents)}</small></div><span>${money(item.quantity*item.priceCents)}</span></div>`).join('')}<div class="receipt-totals"><div class="receipt-line"><span>商品小計</span><span>${money(order.subtotalCents)}</span></div>${order.discountCents?`<div class="receipt-line"><span>訂單折扣</span><span>−${money(order.discountCents)}</span></div>`:''}<div class="receipt-line receipt-total"><span>應收總額</span><span>${money(order.totalCents)}</span></div>${order.paymentMethod==='cash'?`<div class="receipt-line"><span>實收現金</span><span>${money(order.tenderedCents)}</span></div><div class="receipt-line"><span>找續</span><span>${money(order.changeCents)}</span></div>`:''}</div><div class="receipt-bottom">本記錄只保存在這部裝置。<br>此系統未接駁支付平台或網站庫存。</div></div>`;
}
function printReceipt(order) {if(!order)return;$('#print-receipt').innerHTML=receiptMarkup(order);window.print();}
function openHistory() {
  state.orders=readableOrders(readStorage(ORDERS_KEY,[]));const total=state.orders.reduce((sum,o)=>sum+o.totalCents,0);
  openModal('交易記錄',`<p class="info-note">以下全部為這部裝置保存的試用交易。其他 iPad 或瀏覽器不會自動同步。</p><div class="history-summary"><div><strong>${state.orders.length}</strong><span>本機試用訂單</span></div><div><strong>${money(total)}</strong><span>已記錄金額</span></div></div><div class="order-list">${state.orders.length?state.orders.map(order=>`<button class="order-row" data-order="${esc(order.id)}"><div><strong>${esc(order.id)}</strong><small>${esc(dateTime(order.createdAt))} · ${esc(PAYMENT_NAMES[order.paymentMethod] || order.paymentMethod)} · ${order.itemCount} 件</small></div><span class="order-amount">${money(order.totalCents)}<small>查看收據 ↗</small></span></button>`).join(''):'<div class="empty-results"><h2>還未有交易記錄</h2><p>完成第一張訂單後，即可在此查看及列印收據。</p></div>'}</div>`,{wide:true,kind:'history',footer:'<button class="secondary-button" data-action="export-json">匯出備份 JSON</button><button class="secondary-button" data-action="export-csv">匯出銷售 CSV</button>'});
}
function openReceipt(order) {state.lastSale=order;openModal('試用收據',receiptMarkup(order),{kind:'receipt',footer:'<button class="secondary-button" data-action="history">返回交易記錄</button><button class="primary-button" data-action="print-last">列印收據</button>'});}
function downloadFile(name,content,type) {const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportJson() {
  const orders=readableOrders(readStorage(ORDERS_KEY,state.orders));
  let backup={app:'wahfat-pos',schemaVersion:1,exportedAt:new Date().toISOString(),localOnly:true,orders};
  if (!state.storageOk) {
    try { backup={...backup,recovery:true,rawOrders:localStorage.getItem(ORDERS_KEY),rawCart:localStorage.getItem(CART_KEY)}; }
    catch { backup={...backup,recovery:true,note:'Browser storage inaccessible; only current session data is included.',orders:state.orders,cart:state.cart}; }
  }
  downloadFile(`wahfat-pos-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2),'application/json');toast('備份檔案已準備下載。');
}
function exportCsv() {
  const headers=['訂單編號','香港時間','記錄類型','付款方式','商品名稱','款式','貨號','單價 HKD','數量','商品金額 HKD','訂單小計 HKD','訂單折扣 HKD','訂單總額 HKD','實收 HKD','找續 HKD'];
  const rows=state.orders.flatMap(order=>order.items.map((item,index)=>[order.id,dateTime(order.createdAt),'本機試用',PAYMENT_NAMES[order.paymentMethod] || order.paymentMethod,item.title,item.variantTitle,item.sku,(item.priceCents/100).toFixed(2),item.quantity,(item.priceCents*item.quantity/100).toFixed(2),index?'':(order.subtotalCents/100).toFixed(2),index?'':(order.discountCents/100).toFixed(2),index?'':(order.totalCents/100).toFixed(2),index?'':(order.tenderedCents/100).toFixed(2),index?'':(order.changeCents/100).toFixed(2)]));
  downloadFile(`wahfat-pos-sales-${new Date().toISOString().slice(0,10)}.csv`,'\uFEFF'+[headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');toast('銷售明細已準備下載。');
}
function openInfo() {
  const catalog=state.catalog, summary=catalog?.summary || {};const variants=state.products.flatMap(p=>p.variants);
  const needsReview=variants.filter(v=>v.priceReviewReason || v.priceCents<=0).length;
  openModal('商品資料與備份',`<p>商品名稱、款式、售價及圖片來自 <a href="https://whafat-hk.com/" target="_blank" rel="noopener noreferrer">華發科技有限公司網站 ↗</a>。</p><div class="info-grid"><div class="info-stat"><strong>${state.products.length}</strong><span>網站商品</span></div><div class="info-stat"><strong>${variants.length.toLocaleString()}</strong><span>商品款式</span></div></div><p>資料擷取：${catalog?.importedAt?esc(dateTime(catalog.importedAt)):'尚未載入'}</p><ul class="info-list"><li>目前使用網站資料快照，價格及可售狀態不會自動更新。結帳前請確認實際價格與存貨。</li><li>${needsReview} 款網站價格需要確認，已暫停加入訂單；其他網站標示不可售的款式亦不可加入。</li><li>沒有連接網站庫存、會員或支付服務。轉數快、PayMe、信用卡及八達通只作付款方式記錄。</li><li>圖片直接取自網站。首次載入完成、且瀏覽器支援離線儲存後，已載入的目錄可離線使用；未看過的圖片仍可能需要網絡。缺少原圖的商品會顯示「暫無圖片」。</li><li>目前網站商品資料沒有條碼；搜尋可使用商品名稱、款式或已提供的貨號。</li><li>交易只儲存在目前瀏覽器。清除網站資料、私密瀏覽或更換裝置可能令記錄遺失，請定期備份。</li></ul><h3 class="section-title">備份本機交易</h3><p style="margin-bottom:13px">JSON 保留完整訂單；CSV 適合在試算表查看銷售明細。</p><div class="backup-actions"><button class="secondary-button" data-action="export-json">下載完整備份</button><button class="secondary-button" data-action="export-csv">下載銷售 CSV</button></div><h3 class="section-title">在 iPad 使用</h3><p>用 Safari 開啟本頁，點選「分享」→「加入主畫面」。建議固定使用同一部裝置及同一個瀏覽器保存試用交易。</p>`,{kind:'info'});
}
function resetFilters() {state.search='';state.category='';state.vendor='';state.availableOnly=false;state.pageLimit=48;$('#search').value='';$('#vendor-filter').value='';renderCategories();renderProducts();}

function bindEvents() {
  $('#search').addEventListener('input',event=>{state.search=event.target.value;state.pageLimit=48;renderProducts();});
  $('#vendor-filter').addEventListener('change',event=>{state.vendor=event.target.value;state.pageLimit=48;renderProducts();});
  $('#available-filter').addEventListener('click',()=>{state.availableOnly=!state.availableOnly;state.pageLimit=48;renderProducts();});
  $('#all-products').addEventListener('click',()=>selectCategory(''));
  $('#categories').addEventListener('click',event=>{const el=event.target.closest('[data-category]');if(el)selectCategory(el.dataset.category);});
  $('#product-grid').addEventListener('click',event=>{const card=event.target.closest('[data-product]');if(card)openProduct(state.products.find(p=>String(p.id)===card.dataset.product));if(event.target.closest('[data-action="reset-filters"]'))resetFilters();});
  $('#load-more').addEventListener('click',()=>{state.pageLimit+=48;renderProducts();});
  $('#reset-filters').addEventListener('click',resetFilters);
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
    const method=event.target.closest('[data-payment]');if(method){state.paymentMethod=method.dataset.payment;state.paymentConfirmed=false;openPayment(false);return;}
    const tender=event.target.closest('[data-tender]');if(tender){state.paymentTendered=(Number(tender.dataset.tender)/100).toFixed(2);$('#tendered').value=state.paymentTendered;updateChange();return;}
    const order=event.target.closest('[data-order]');if(order){const record=state.orders.find(o=>o.id===order.dataset.order);if(record)openReceipt(record);return;}
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(action==='close-modal')closeModal();
    else if(action==='add-product')addToCart(state.currentProduct,state.selectedVariant,state.selectedQuantity);
    else if(action==='product-plus'){state.selectedQuantity=Math.min(999,state.selectedQuantity+1);renderProductModal(false);}
    else if(action==='product-minus'){state.selectedQuantity=Math.max(1,state.selectedQuantity-1);renderProductModal(false);}
    else if(action==='confirm-clear'){state.cart=freshCart();persistCart();renderCart();closeModal();toast('目前訂單已清空。');}
    else if(action==='history')openHistory();
    else if(action==='print-last')printReceipt(state.lastSale);
    else if(action==='export-json')exportJson();
    else if(action==='export-csv')exportCsv();
  });
  $('#modal-root').addEventListener('change',event=>{if(event.target.matches('select[data-option]'))chooseOption(Number(event.target.dataset.option),event.target.value);if(event.target.id==='variant-select'){state.selectedVariant=getVariant(state.currentProduct,event.target.value);renderProductModal(false);}if(event.target.id==='payment-confirmed')state.paymentConfirmed=event.target.checked;});
  $('#modal-root').addEventListener('input',event=>{if(event.target.id==='tendered'){state.paymentTendered=event.target.value;updateChange();}});
  $('#modal-root').addEventListener('submit',event=>{
    event.preventDefault();
    if(event.target.id==='payment-form'){completeSale();return;}
    if(event.target.id==='discount-form'){
      const type=$('#discount-type').value,text=$('#discount-value').value.trim();let value=type==='fixed'?parseMoney(text):(/^\d+(?:\.\d{1,2})?$/.test(text)?Number(text):null);
      try {if(value===null)throw new Error('請輸入正確數值，最多兩位小數。');calculateTotals(state.cart.items,{type,value});state.cart.discount={type,value};persistCart();renderCart();closeModal();}
      catch(error){$('#discount-error').textContent=error.message;$('#discount-error').hidden=false;}
    }
  });
  document.addEventListener('keydown',event=>{
    if(!state.modal)return;if(event.key==='Escape'){event.preventDefault();closeModal();}
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
    state.orders=readableOrders(readStorage(ORDERS_KEY,[]));state.cart=normalizeCart(readStorage(CART_KEY,null));persistCart();
    const vendors=[...new Set(state.products.map(p=>p.vendor).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-Hant'));
    $('#vendor-filter').innerHTML='<option value="">全部品牌</option>'+vendors.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    $('#import-label').textContent=`網站資料 · ${new Date(catalog.importedAt).toLocaleDateString('zh-HK',{timeZone:'Asia/Hong_Kong'})}`;
    renderCategories();renderProducts();renderCart();
  } catch(error) {$('#product-grid').innerHTML=`<div class="empty-results"><h2>未能載入商品目錄</h2><p>${esc(error.message)}<br>請確認網絡後重新整理頁面。</p><button class="secondary-button" onclick="location.reload()" style="margin-top:20px">重新載入</button></div>`;$('#result-count').textContent='商品目錄未就緒';}
}
init();
