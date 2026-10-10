import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { api } from './api';

export function UsernameAdminLogin(){
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [logged,setLogged]=useState<boolean|null>(null);
  const navigate=useNavigate();
  useEffect(()=>{api<{admin:boolean}>('/api/auth/me').then(x=>setLogged(x.admin)).catch(()=>setLogged(false));},[]);
  useEffect(()=>{if(logged)navigate('/',{replace:true});},[logged,navigate]);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{await api('/api/auth/admin',{method:'POST',body:JSON.stringify({username:username.trim(),password})});setLogged(true);}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <div className="admin-login-page"><div className="login-decoration decor-one"/><div className="login-decoration decor-two"/>
    <Link to="/" className="admin-brand login-brand"><span className="brand-mark">闪</span><span>闪购卡券<small>MERCHANT CONSOLE</small></span></Link>
    <div className="admin-login-card"><div className="login-icon"><ShieldCheck/></div><span className="eyebrow">MERCHANT SIGN IN</span><h1>欢迎回来</h1><p>使用管理员账号登录，管理商品、订单与店铺经营。</p>
      <form onSubmit={submit}>
        <label>管理员用户名<input type="text" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} placeholder="请输入用户名" required/></label>
        <label>管理员密码<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="请输入密码" required/></label>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <button className="button full-button" disabled={busy}>{busy?'正在登录…':'安全登录'}<ArrowRight size={16}/></button>
      </form><div className="login-safe"><ShieldCheck size={15}/> 用户名与密码双重验证 · 管理操作全程记录</div>
    </div><span className="login-copyright">© 2026 闪购卡券 · 商家管理系统</span>
  </div>;
}
