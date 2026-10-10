import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, LogIn, LogOut, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import { api, money } from './api';
import { PageIntro, useAuth } from './shared';

type AccountOrder={id:string;status:string;payment_status?:string;total:string;created_at:string;items?:string};
type GuestOrder=AccountOrder&{items:string};
type Captcha={id:string;code:string};
const statusText=(status:string)=>({completed:'已完成',pending_payment:'待支付',paid_pending_delivery:'待发货',cancelled:'已取消',refunded:'已退款'} as Record<string,string>)[status]||status;

function readOrderAccess(){try{return JSON.parse(localStorage.getItem('shangouOrderAccess')||'{}') as Record<string,string>}catch{return {}}}
async function loadGuestOrders():Promise<GuestOrder[]>{
  const entries=Object.entries(readOrderAccess());
  const rows=await Promise.all(entries.map(async([id,token])=>{try{const {order}=await api<{order:{id:string;status:string;total:string;createdAt?:string;created_at?:string;items:Array<{product_name:string;variant_name?:string}>}}>(`/api/orders/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);return{id:order.id,status:order.status,total:order.total,created_at:order.created_at||order.createdAt||'',items:order.items.map(item=>`${item.product_name} · ${item.variant_name||'默认规格'}`).join('、')};}catch{return null;}}));
  return rows.filter((row):row is GuestOrder=>Boolean(row));
}
function mergeOrders(account:AccountOrder[],guest:GuestOrder[]){const all=new Map<string,AccountOrder>();for(const row of guest)all.set(row.id,row);for(const row of account)all.set(row.id,row);return [...all.values()].sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());}

function useCaptcha(){
  const [captcha,setCaptcha]=useState<Captcha|null>(null);
  const [input,setInput]=useState('');
  const refresh=()=>{setInput('');api<Captcha>('/api/captcha').then(setCaptcha).catch(()=>setCaptcha(null));};
  useEffect(()=>{refresh();},[]);
  return {captcha,input,setInput,refresh};
}
function CaptchaRow({captcha,input,setInput,refresh}:{captcha:Captcha|null;input:string;setInput:(v:string)=>void;refresh:()=>void}){
  return <div className="checkout-captcha-row"><label className="checkout-modal-label">验证码<input inputMode="numeric" autoComplete="off" maxLength={4} pattern="[0-9]{4}" required value={input} onChange={e=>setInput(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="输入右侧 4 位数字"/></label><button type="button" className="captcha-display" onClick={refresh} title="刷新验证码" disabled={!captcha}><span>{captcha?.code||'····'}</span><small>换一组</small></button></div>;
}

export function LoginPage(){
  const [account,setAccount]=useState(()=>localStorage.getItem('shangouContact')||'');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const {captcha,input,setInput,refresh}=useCaptcha();
  const {refresh:refreshAuth}=useAuth();
  const navigate=useNavigate();
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      await api('/api/auth/login',{method:'POST',body:JSON.stringify({account:account.trim(),password,captchaId:captcha?.id||'',captchaCode:input})});
      localStorage.setItem('shangouContact',account.trim());
      await refreshAuth();
      navigate('/account',{replace:true});
    }catch(err){setError((err as Error).message);refresh();}
    finally{setBusy(false)}
  }
  return <div className="container page-shell">
    <PageIntro eyebrow="SIGN IN" title="登录账户" description="用注册时填写的邮箱或手机号登录，查看同一账号下的订单。"/>
    <section className="login-panel account-login-panel"><div className="login-illustration"><span><Mail size={24}/></span><h2>登录后找回你的订单</h2><p>同一邮箱或手机号下的订单会自动同步到这里。你仍然可以随时免登录购买。</p><div><ShieldCheck size={15}/> 密码加密存储</div></div>
      <form className="login-form" onSubmit={submit}><span className="eyebrow">ACCOUNT LOGIN</span><h2>欢迎回来</h2>
        <label>账号（邮箱或手机号）<input type="text" required autoComplete="username" value={account} onChange={e=>setAccount(e.target.value)} placeholder="name@example.com 或 13800138000"/></label>
        <label>密码<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="输入密码"/></label>
        <CaptchaRow captcha={captcha} input={input} setInput={setInput} refresh={refresh}/>
        {error&&<p className="account-form-error" role="alert">{error}</p>}
        <button className="button full-button" disabled={busy||!captcha||!account.trim()||!password}>{busy?'正在登录…':'登录'}<LogIn size={16}/></button>
        <small>还没有账户？<Link to="/register">去注册</Link>。未登录也可以直接下单购买。</small>
      </form>
    </section>
  </div>;
}

export function RegisterPage(){
  const [account,setAccount]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const {captcha,input,setInput,refresh}=useCaptcha();
  const {refresh:refreshAuth}=useAuth();
  const navigate=useNavigate();
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      await api('/api/auth/register',{method:'POST',body:JSON.stringify({account:account.trim(),password,captchaId:captcha?.id||'',captchaCode:input})});
      localStorage.setItem('shangouContact',account.trim());
      await refreshAuth();
      navigate('/account',{replace:true});
    }catch(err){setError((err as Error).message);refresh();}
    finally{setBusy(false)}
  }
  return <div className="container page-shell">
    <PageIntro eyebrow="CREATE ACCOUNT" title="注册账户" description="一个邮箱或手机号即可注册，无需短信或邮件验证码。"/>
    <section className="login-panel account-login-panel"><div className="login-illustration"><span><Mail size={24}/></span><h2>注册后跨设备查看订单</h2><p>游客购买时填写相同邮箱或手机号，订单会自动归入此账户。购买无需登录。</p><div><ShieldCheck size={15}/> 密码加密存储</div></div>
      <form className="login-form" onSubmit={submit}><span className="eyebrow">ACCOUNT REGISTER</span><h2>创建新账户</h2>
        <label>账号（邮箱或手机号）<input type="text" required autoComplete="username" value={account} onChange={e=>setAccount(e.target.value)} placeholder="name@example.com 或 13800138000"/></label>
        <label>密码（6 到 128 位）<input type="password" required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="设置登录密码"/></label>
        <CaptchaRow captcha={captcha} input={input} setInput={setInput} refresh={refresh}/>
        {error&&<p className="account-form-error" role="alert">{error}</p>}
        <button className="button full-button" disabled={busy||!captcha||!account.trim()||password.length<6}>{busy?'正在注册…':'注册并登录'}<UserPlus size={16}/></button>
        <small>已有账户？<Link to="/login">去登录</Link>。未登录也可以直接下单购买。</small>
      </form>
    </section>
  </div>;
}

export function AccountPage(){
  const [orders,setOrders]=useState<AccountOrder[]>([]);
  const [guestOrders,setGuestOrders]=useState<GuestOrder[]>([]);
  const [customerIdentifier,setCustomerIdentifier]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const {refresh:refreshAuth}=useAuth();
  useEffect(()=>{let live=true;async function init(){const guest=await loadGuestOrders();if(!live)return;setGuestOrders(guest);try{const me=await api<{customer:string|null}>('/api/auth/me');if(me.customer){const data=await api<{orders:AccountOrder[]}>('/api/orders');if(live){setCustomerIdentifier(me.customer);setOrders(data.orders);}}}catch(e){if(live)setError((e as Error).message)}finally{if(live)setLoading(false)}}init();return()=>{live=false};},[]);
  async function logout(){setBusy(true);await api('/api/auth/logout',{method:'POST',body:JSON.stringify({kind:'customer'})}).catch(()=>{});setCustomerIdentifier('');setOrders([]);setNotice('已退出账户；当前设备保存的游客订单仍可查看。');await refreshAuth();setBusy(false)}
  const visibleOrders=mergeOrders(orders,guestOrders);
  return <div className="container page-shell">
    <PageIntro eyebrow="ACCOUNT & ORDERS" title="我的账户与订单" description="购买可以不登录；注册或登录后，可在不同设备查询同一邮箱或手机号下的订单。" actions={<Link className="button button-secondary" to="/products">继续购物<ArrowRight size={15}/></Link>}/>
    {customerIdentifier?<section className="panel account-card account-card-signed"><span className="account-avatar"><Check size={20}/></span><div><span className="eyebrow">已登录账户</span><h2>{customerIdentifier}</h2><p>此联系方式下的订单会自动同步；游客下单时填写相同邮箱或手机号即可归入此账户。</p></div><button className="button button-secondary" onClick={logout} disabled={busy}><LogOut size={16}/>退出登录</button></section>:<section className="panel account-card"><span className="account-avatar"><LogIn size={18}/></span><div><span className="eyebrow">未登录</span><h2>登录后跨设备同步订单</h2><p>注册或登录不需要短信/邮件验证码；也可以继续免登录购买。</p></div><div className="intro-actions"><Link className="button button-secondary" to="/register">注册<ArrowRight size={15}/></Link><Link className="button" to="/login">登录<ArrowRight size={15}/></Link></div></section>}
    {notice&&<p className="account-form-notice account-notice-banner" role="status">{notice}</p>}
    {error&&<p className="account-form-error" role="alert">{error}</p>}
    {loading?<div className="loading-state">正在加载订单…</div>:visibleOrders.length?<section className="panel account-orders"><div className="section-heading compact"><div><span className="eyebrow">ORDER HISTORY</span><h2>{customerIdentifier?'全部订单':'本设备的游客订单'}</h2></div><span className="account-order-count">{visibleOrders.length} 笔</span></div>{visibleOrders.map(order=><Link className="order-row" key={order.id} to={`/orders/${encodeURIComponent(order.id)}`}><span><b>{order.items||order.id}</b><small>{order.id} · {order.created_at?new Date(order.created_at).toLocaleString('zh-CN'):'时间未知'}</small></span><span className="order-row-total">{money(order.total)}<small className={`order-status st-${order.status}`}>{statusText(order.status)}</small></span><ChevronRight size={18}/></Link>)}</section>:<div className="empty-state account-empty"><span className="empty-icon">✦</span><b>{customerIdentifier?'这个账户下还没有订单':'当前设备没有游客订单'}</b><span>{customerIdentifier?'游客购买时填写此邮箱或手机号后，订单会自动出现在这里。':'免登录购买后，订单凭证会保存在当前浏览器。登录后也能跨设备查询同邮箱或手机号的订单。'}</span><Link className="button" to="/products">前往商城</Link></div>}
  </div>;
}