import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ArrowRight, Check, Headphones, LogOut, Menu, PackageCheck, ShieldCheck, ShoppingBag, Sparkles, User, X } from 'lucide-react';
import { api, money, type Product, type ProductVariant } from './api';

export type CartLine = { product: Product; variant: ProductVariant; quantity: number };
type CheckoutRequest = { mode:'direct'|'cart'; direct?:CartLine; key:number } | null;
type CartContextValue = { lines: CartLine[]; add: (product: Product, variant?:ProductVariant, quantity?:number) => void; setQuantity: (id: string, variantId:string, quantity: number) => void; remove: (id: string, variantId:string) => void; clear: () => void; count: number; totalCents: number; checkout:CheckoutRequest; openCheckout:(product?:Product,variant?:ProductVariant,quantity?:number)=>void; closeCheckout:()=>void };
const CartContext = createContext<CartContextValue | null>(null);
export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => { try { const saved=JSON.parse(localStorage.getItem('shangouCartLines')||'[]');return saved.filter((line:Partial<CartLine>)=>line.product&&line.variant&&line.quantity); } catch { return []; } });
  const [checkout,setCheckout]=useState<CheckoutRequest>(null);
  useEffect(() => { localStorage.setItem('shangouCartLines', JSON.stringify(lines)); localStorage.setItem('shangouCartItems', JSON.stringify(Object.fromEntries(lines.map(line => [line.product.id, line.quantity])))); }, [lines]);
  const value = useMemo<CartContextValue>(() => ({
    lines,
    add: (product,variant=product.variants[0],quantity=1) => {if(!variant)return;setLines(current => { const found=current.find(line=>line.product.id===product.id&&line.variant.id===variant.id);const cap=product.deliveryType==='manual'?25:Math.max(1,Math.min(25,variant.stock)); return found?current.map(line=>line.product.id===product.id&&line.variant.id===variant.id?{...line,product,variant,quantity:Math.min(cap,line.quantity+quantity)}:line):[...current,{product,variant,quantity:Math.min(cap,Math.max(1,quantity))}]; });},
    setQuantity: (id,variantId, quantity) => setLines(current=>current.map(line=>{if(line.product.id!==id||line.variant.id!==variantId)return line;const cap=line.product.deliveryType==='manual'?25:Math.max(1,Math.min(25,line.variant.stock));return {...line,quantity:Math.max(1,Math.min(cap,quantity))};})),
    remove: (id,variantId) => setLines(current=>current.filter(line=>line.product.id!==id||line.variant.id!==variantId)),
    clear: () => setLines([]), count:lines.reduce((sum,line)=>sum+line.quantity,0),
    totalCents:lines.reduce((sum,line)=>sum+line.variant.priceCents*line.quantity,0),
    checkout,openCheckout:(product,variant,quantity=1)=>setCheckout({mode:product?'direct':'cart',direct:product&&variant?{product,variant,quantity:Math.min(25,Math.max(1,quantity))}:undefined,key:Date.now()}),closeCheckout:()=>setCheckout(null),
  }),[lines,checkout]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export const useCart = () => { const context=useContext(CartContext); if(!context)throw new Error('CartProvider missing'); return context; };

type AuthContextValue = { customer: string | null; refresh: () => Promise<void>; logout: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<string | null>(null);
  const refresh = async () => { try { const me = await api<{ customer: string | null }>('/api/auth/me'); setCustomer(me.customer); } catch { setCustomer(null); } };
  useEffect(() => { refresh(); }, []);
  const logout = async () => { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ kind: 'customer' }) }); } catch {} setCustomer(null); };
  const value = useMemo(() => ({ customer, refresh, logout }), [customer]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => { const context = useContext(AuthContext); if (!context) throw new Error('AuthProvider missing'); return context; };

export function StoreLayout({ children }: { children: ReactNode }) {
  const { count }=useCart(); const { customer, logout }=useAuth(); const [open,setOpen]=useState(false);
  const nav=[['首页','/'],['全部商品','/products'],['帮助中心','/help']] as [string,string][];
  return <div className="store-app"><div className="announcement"><Sparkles size={14}/> 新客首单立减 ¥5 <span>·</span> 正品保障 <span>·</span> 支付成功后自动发货</div>
    <header className="store-header"><div className="store-nav-wrap"><Link className="brand" to="/"><span className="brand-mark">闪</span><span>闪购卡券<small>SHANGOU DIGITAL</small></span></Link>
      <nav className={open?'store-nav open':'store-nav'}>{nav.map(([label,to])=><NavLink key={to} to={to} end={to==='/'} onClick={()=>setOpen(false)}>{label}</NavLink>)}</nav>
      <div className="header-actions">
        {customer
          ? <><Link to="/orders" className="auth-link"><ShoppingBag size={16}/><span>我的订单</span></Link><Link to="/account" className="auth-link" title={customer||''}><User size={16}/><span className="auth-name">{customer}</span></Link><button className="auth-link auth-logout" onClick={()=>logout()} title="退出登录"><LogOut size={16}/></button></>
          : <><Link to="/orders" className="auth-link"><ShoppingBag size={16}/><span>我的订单</span></Link><Link to="/login" className="auth-link">登录</Link><Link to="/register" className="auth-link auth-register">注册</Link></>}
        <Link to="/cart" className="cart-pill"><ShoppingBag size={17}/> <span>购物车</span><b>{count}</b></Link>
        <button className="icon-button mobile-menu" aria-label="打开菜单" onClick={()=>setOpen(!open)}>{open?<X/>:<Menu/>}</button>
      </div>
    </div></header>
    <main>{children}</main>
    <footer className="store-footer"><div className="container footer-main"><Link className="brand footer-brand" to="/"><span className="brand-mark">闪</span><span>闪购卡券<small>轻松兑换 · 即时到账</small></span></Link><p>精选数字权益，让日常消费更简单。</p><div className="footer-links">{customer?<><Link to="/help">帮助中心</Link><Link to="/orders">我的订单</Link><Link to="/account">我的账户</Link></>:<><Link to="/help">帮助中心</Link><Link to="/orders">我的订单</Link><Link to="/login">登录</Link><Link to="/register">注册</Link></>}</div></div><div className="container footer-bottom"><span>© 2026 闪购卡券</span><span>安全支付 · 自动发货 · 用心服务</span></div></footer>
  </div>;
}

export function PageIntro({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-intro"><div><span className="eyebrow">{eyebrow || 'SHANGOU STORE'}</span><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="intro-actions">{actions}</div>}</div>;
}

export function ProductCard({ product }: { product: Product }) {
  const { add,openCheckout }=useCart();
  return <article className="product-card"><Link to={`/product/${encodeURIComponent(product.id)}`} className={`product-art art-${Math.abs(product.id.split('').reduce((a,c)=>a+c.charCodeAt(0),0))%5}`}><span className="product-symbol">{product.icon}</span><span className="art-label">DIGITAL ACCESS</span></Link>
    <div className="product-card-body"><div className="product-tags"><span className="tag">{product.category}</span><span className={product.stock>0?'stock':'stock sold-out'}>{product.stock>0?`库存 ${product.stock}`:'暂时售罄'}</span></div><Link className="product-name" to={`/product/${encodeURIComponent(product.id)}`}>{product.name}</Link><p className="product-description">{product.description}</p><div className="product-card-foot"><strong>{product.variants.length>1?'起 '+money(product.price):money(product.price)}</strong><button className="add-round" disabled={!product.stock} aria-label="加入购物车" onClick={()=>{add(product,product.variants[0]);}}><ShoppingBag size={17}/></button><button className="quick-buy" disabled={!product.stock} onClick={()=>openCheckout(product,product.variants[0])}>立即购买<ArrowRight size={14}/></button></div></div>
  </article>;
}

export function ProductGrid({ products, empty = '暂时没有找到符合条件的商品' }: { products: Product[]; empty?: string }) {
  return products.length?<div className="product-grid">{products.map(product=><ProductCard key={product.id} product={product}/>)}</div>:<div className="empty-state"><ShoppingBag size={28}/><b>{empty}</b><span>试试其他关键词或分类</span></div>;
}

export function Benefits() {
  return <div className="benefits"><div><span><ShieldCheck/></span><b>安全可靠</b><small>正规渠道，安心兑换</small></div><div><span><PackageCheck/></span><b>极速发货</b><small>支付成功后自动发放</small></div><div><span><Headphones/></span><b>贴心客服</b><small>遇到问题及时为你处理</small></div><div><span><Check/></span><b>售后保障</b><small>每一笔订单都可追溯</small></div></div>;
}

export function Toast({ message }: { message: string }) { return message?<div className="toast-message" role="status">{message}</div>:null; }

export function useProducts() {
  const [products,setProducts]=useState<Product[]>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  useEffect(()=>{api<{products:Product[]}>('/api/products').then(data=>setProducts(data.products)).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  return {products,loading,error};
}
