import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Copy, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { api, money, type Order, type ProductVariant } from './api';
import { useCart, type CartLine } from './shared';
import { PaymentQr } from './payment-qr';

type DraftLine = CartLine;
type PaymentMethod = 'alipay'|'wechat'|'demo';
type CheckoutResult = { order:Order; lookupToken:string; simulated:boolean; payment?:{qrUrl:string;expiresAt:string}|null };
type Methods = Record<PaymentMethod,boolean>;

const methodLabel:Record<PaymentMethod,string>={alipay:'支付宝当面付',wechat:'微信 Native 扫码',demo:'本地演示支付'};

export function CheckoutModal(){
  const {lines,checkout,closeCheckout,clear}=useCart();
  const [drafts,setDrafts]=useState<DraftLine[]>([]);
  const [contact,setContact]=useState('');
  const [methods,setMethods]=useState<Methods>({alipay:true,wechat:true,demo:true});
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod>('demo');
  const [result,setResult]=useState<CheckoutResult|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [copied,setCopied]=useState(false);
  const available=(['alipay','wechat','demo'] as const).filter(key=>methods[key]);

  useEffect(()=>{
    if(!checkout)return;
    const initial=checkout.mode==='direct'&&checkout.direct?[checkout.direct]:lines;
    setDrafts(initial);
    setContact(localStorage.getItem('shangouContact')||localStorage.getItem('shangouEmail')||'');setError('');setResult(null);setCopied(false);
    api<{methods:Methods}>('/api/payment-methods').then(payment=>{
      setMethods(payment.methods);
      const first=(['alipay','wechat','demo'] as const).find(key=>payment.methods[key]);if(first)setPaymentMethod(first);
    }).catch(e=>setError((e as Error).message));
  // The key changes for each open; cart changes made before opening are captured above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[checkout?.key]);

  useEffect(()=>{
    if(!result||result.simulated||result.order.paymentStatus==='paid')return;
    const id=result.order.id,token=result.lookupToken;
    const timer=window.setInterval(()=>{
      api<{order:Order}>(`/api/orders/${encodeURIComponent(id)}/payment-status?token=${encodeURIComponent(token)}`).then(({order})=>{
        if(order.paymentStatus==='paid')setResult(current=>current?{...current,order}:current);
      }).catch(()=>{});
    },4000);
    return()=>window.clearInterval(timer);
  },[result?.order.id,result?.order.paymentStatus,result?.simulated]);

  const totalCents=useMemo(()=>drafts.reduce((sum,line)=>sum+line.variant.priceCents*line.quantity,0),[drafts]);
  function updateLine(index:number,patch:Partial<DraftLine>){setDrafts(current=>current.map((line,i)=>i===index?{...line,...patch}:line));}
  function chooseVariant(index:number,variantId:string){const line=drafts[index],variant=line.product.variants.find(item=>item.id===variantId);if(variant){const max=line.product.deliveryType==='manual'?25:Math.max(1,Math.min(25,variant.stock));updateLine(index,{variant,quantity:Math.min(line.quantity,max)});}}
  async function copy(value:string){try{await navigator.clipboard.writeText(value);setCopied(true);window.setTimeout(()=>setCopied(false),1600);}catch{setError('复制失败，请手动选择内容复制。')}}
  async function submit(e:FormEvent){
    e.preventDefault();setError('');
    if(!drafts.length)return setError('请先选择商品。');
    setBusy(true);
    try{
      const response=await api<CheckoutResult>('/api/orders/checkout',{method:'POST',body:JSON.stringify({
        contact:contact.trim(),paymentMethod,
        items:drafts.map(line=>({productId:line.product.id,variantId:line.variant.id,quantity:line.quantity})),
      })});
      const saved:Record<string,string>=JSON.parse(localStorage.getItem('shangouOrderAccess')||'{}');saved[response.order.id]=response.lookupToken;
      localStorage.setItem('shangouOrderAccess',JSON.stringify(saved));localStorage.setItem('shangouContact',contact.trim());
      if(checkout?.mode==='cart')clear();setResult(response);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false)}
  }
  if(!checkout)return null;
  return <div className="checkout-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeCheckout();}}>
    <section className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-modal-title">
      <header className="checkout-modal-header"><div><span className="eyebrow">QUICK CHECKOUT</span><h2 id="checkout-modal-title">{result?(result.simulated||result.order.paymentStatus==='paid'?'下单成功':'等待支付'):'确认购买'}</h2><p>{result?(result.simulated?'本地演示支付已完成；订单和卡密已准备好。':result.order.paymentStatus==='paid'?'支付已确认，订单已更新。':'请使用对应的支付 App 扫描二维码，支付后本页会自动更新。'):'填写邮箱或手机号，选择规格与数量，一次完成下单。'}</p></div><button className="checkout-modal-close" aria-label="关闭结算窗口" onClick={closeCheckout}><X size={20}/></button></header>
      {result?<div className="checkout-success">
        {result.simulated||result.order.paymentStatus==='paid'?<div className="checkout-success-mark"><CheckCircle2 size={28}/></div>:<div className="checkout-wait-mark"><RefreshCw size={25}/></div>}
        <span className="eyebrow">{result.simulated?'LOCAL DEMO PAYMENT':result.order.paymentStatus==='paid'?'PAYMENT CONFIRMED':'SCAN TO PAY'}</span>
        <h3>{result.simulated?'演示支付完成':result.order.paymentStatus==='paid'?'支付成功':'请扫码完成支付'}</h3>
        <p>{result.simulated?'没有发生真实扣款。':result.order.paymentStatus==='paid'?'已收到支付平台确认，正在为你准备订单内容。':'请用手机扫描下方二维码；支付成功后页面会自动刷新状态。'}</p>
        <div className="success-order-id"><span>订单编号</span><b>{result.order.id}</b><button type="button" onClick={()=>copy(result.order.id)} aria-label="复制订单编号"><Copy size={15}/></button></div>
        <div className="success-items">{result.order.items.map((item,index)=><div key={`${item.product_id}-${index}`}><span>{item.product_name} · {item.variant_name} × {item.quantity}</span><b>{money(Number(item.unit_price_cents)*item.quantity/100)}</b></div>)}</div>
        <div className="success-total"><span>实付金额</span><b>{money(result.order.total)}</b></div>
        {!result.simulated&&result.order.paymentStatus!=='paid'&&<div className="payment-wait-panel"><PaymentQr value={result.payment?.qrUrl||result.order.paymentQr||''}/><b>打开{result.order.paymentMethod==='alipay'?'支付宝':'微信'}扫码支付</b><small>支付状态每 4 秒自动检查一次。关闭窗口后，也可从订单详情继续查看二维码。</small><a className="button button-secondary" href={result.payment?.qrUrl||result.order.paymentQr||'#'}>在本机打开支付<ArrowRight size={15}/></a></div>}
        {(result.simulated||result.order.paymentStatus==='paid')&&<div className="success-codes"><div><b>发货卡密</b><small>订单凭证已保存在当前浏览器，可在订单查询中继续查看。</small></div>{result.order.cards?.length?result.order.cards.map((code,index)=><div className="success-code-row" key={`${index}-${code}`}><code>{code}</code><button type="button" onClick={()=>copy(code)} aria-label="复制卡密"><Copy size={15}/></button></div>):<div className="notice-box">支付已确认；如为手动发货商品，商家会在后台完成交付。</div>}</div>}
        {copied&&<div className="copy-hint">已复制</div>}<button className="button full-button" onClick={closeCheckout}>{result.order.paymentStatus==='paid'||result.simulated?'完成':'稍后支付，查看订单'}<ArrowRight size={16}/></button>
      </div>:<form className="checkout-modal-body" onSubmit={submit}>
        <div className="checkout-modal-products">{drafts.map((line,index)=>{
          const variants=line.product.variants.filter(variant=>variant.active);
          const max=line.product.deliveryType==='manual'?25:Math.max(1,Math.min(25,line.variant.stock));
          return <article className="checkout-modal-product" key={`${line.product.id}-${line.variant.id}-${index}`}>
            <div className="checkout-product-top"><span className="checkout-product-icon">{line.product.icon}</span><div><b>{line.product.name}</b><small>{line.product.category} · {line.product.deliveryType==='manual'?'商家发货':'自动发货'}</small></div><strong>{money(line.variant.priceCents*line.quantity/100)}</strong></div>
            <div className="checkout-product-controls"><label>商品规格<select value={line.variant.id} onChange={e=>chooseVariant(index,e.target.value)}>{variants.map(variant=><option key={variant.id} value={variant.id} disabled={line.product.deliveryType==='card'&&variant.stock<1}>{variant.name}{line.product.deliveryType==='card'?` · 库存 ${variant.stock}`:''}</option>)}</select></label><label className="checkout-quantity-field">购买数量<div><button type="button" aria-label="减少数量" disabled={line.quantity<=1} onClick={()=>updateLine(index,{quantity:line.quantity-1})}>−</button><input type="number" min="1" max={max} value={line.quantity} onChange={e=>updateLine(index,{quantity:Math.max(1,Math.min(max,Number(e.target.value)||1))})}/><button type="button" aria-label="增加数量" disabled={line.quantity>=max} onClick={()=>updateLine(index,{quantity:Math.min(max,line.quantity+1)})}>＋</button></div></label></div>
          </article>;
        })}</div>
        <div className="checkout-modal-fields"><label className="checkout-modal-label">邮箱或手机号<input type="text" autoComplete="off" required maxLength={254} value={contact} onChange={e=>setContact(e.target.value)} placeholder="可填邮箱，也可填手机号"/><small>不校验联系方式、不发送验证码；包含 @ 时发邮件，其他内容按手机号发送短信。</small></label>
        </div>
        <div className="checkout-modal-payment"><div className="checkout-modal-section-title"><b>支付方式</b><small>真实支付扫码收款 · 演示支付不扣款</small></div><div className="checkout-modal-methods">{available.map(key=><label className={paymentMethod===key?'checkout-modal-method selected':'checkout-modal-method'} key={key}><input type="radio" name="quick-payment" checked={paymentMethod===key} onChange={()=>setPaymentMethod(key)}/><span className={`payment-logo ${key}`}>{key==='alipay'?'支':key==='wechat'?'微':'演'}</span><b>{methodLabel[key]}</b><i/></label>)}</div>{!available.length&&<p className="form-error">店铺目前没有开放的支付方式。</p>}</div>
        <div className="checkout-modal-total"><span>应付金额</span><b>{money(totalCents/100)}</b></div>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <button className="button full-button checkout-modal-submit" disabled={busy||!drafts.length||!available.length||drafts.some(line=>line.product.deliveryType==='card'&&line.variant.stock<line.quantity)}>{busy?'正在创建订单…':paymentMethod==='demo'?'确认下单并演示支付':'确认下单并生成支付码'}<ArrowRight size={16}/></button>
        <p className="checkout-modal-note"><ShieldCheck size={14}/> 邮箱或手机号仅用于订单识别。本地演示不会扣款，支付宝和微信会向商户真实收款。</p>
      </form>}
    </section>
  </div>;
}
