import { useEffect, useState, type FormEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { Check, CircleAlert, CircleCheck, CreditCard, ShieldCheck } from 'lucide-react';
import { api } from './api';

type PaymentSettings={
  alipay:boolean;wechat:boolean;demo:boolean;timeoutMinutes:number;minimumCents:number;provider?:string;publicBaseUrl?:string;
  alipayAppId?:string;alipayGateway?:string;alipayNotifyUrl?:string;alipayPrivateKey?:string;alipayPublicKey?:string;
  wechatAppId?:string;wechatMchId?:string;wechatMchSerialNo?:string;wechatMchPrivateKey?:string;wechatApiV3Key?:string;
  wechatPlatformCert?:string;wechatPlatformPublicKey?:string;wechatPlatformSerialNo?:string;wechatApiBase?:string;wechatNotifyUrl?:string;
};
type ProviderStatus={ready:boolean;missing:string[]};
type PaymentStatus={alipay:ProviderStatus;wechat:ProviderStatus};
const links=[['基本信息','/settings'],['支付设置','/settings/payment'],['发货设置','/settings/shipping'],['通知设置','/settings/notifications'],['邮箱设置','/settings/mail'],['短信设置','/settings/sms'],['安全设置','/settings/security']];
const emptyForm:PaymentSettings={alipay:true,wechat:true,demo:true,timeoutMinutes:15,minimumCents:100,publicBaseUrl:'',alipayAppId:'',alipayGateway:'',alipayNotifyUrl:'',alipayPrivateKey:'',alipayPublicKey:'',wechatAppId:'',wechatMchId:'',wechatMchSerialNo:'',wechatMchPrivateKey:'',wechatApiV3Key:'',wechatPlatformCert:'',wechatPlatformPublicKey:'',wechatPlatformSerialNo:'',wechatApiBase:'',wechatNotifyUrl:''};

function PaymentToggle({label,hint,checked,onChange}:{label:string;hint:string;checked:boolean;onChange:(v:boolean)=>void}){
  return <label className="switch-row"><span><b>{label}</b><small>{hint}</small></span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/></label>;
}
function Field({label,value,onChange,placeholder,textarea=false}:{label:string;value:string;onChange:(v:string)=>void;placeholder?:string;textarea?:boolean}){
  return <label>{label}{textarea?<textarea rows={4} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} spellCheck={false}/>:<input autoComplete="off" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/>}</label>;
}

export function PaymentSettingsPage(){
  const [data,setData]=useState<PaymentSettings>(emptyForm);
  const [status,setStatus]=useState<PaymentStatus|null>(null);
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
  async function load(){
    const [settings,configured]=await Promise.all([api<{settings:PaymentSettings}>('/api/admin/settings/payment'),api<{configured:PaymentStatus}>('/api/admin/payment-status')]);
    setData({...emptyForm,...settings.settings,demo:settings.settings.demo!==false});setStatus(configured.configured);
  }
  useEffect(()=>{load().catch(e=>setError((e as Error).message)).finally(()=>setLoading(false));},[]);
  function change(key:keyof PaymentSettings,value:boolean|number|string){setData(x=>({...x,[key]:value}));}
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');try{await api('/api/admin/settings/payment',{method:'PUT',body:JSON.stringify(data)});await load();setNotice('支付设置已保存。真实支付会在配置完整且启用后显示在结算页。');}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const readinessCard=(name:string,provider?:ProviderStatus)=>provider&&<div className={`payment-ready-card ${provider.ready?'is-ready':'is-pending'}`}><span>{provider.ready?<CircleCheck size={19}/>:<CircleAlert size={19}/>}</span><div><b>{name}：{provider.ready?'配置完整':'等待补充参数'}</b>{provider.missing.length>0&&<small>缺少：{provider.missing.join('、')}</small>}</div></div>;
  return <><div className="admin-heading"><div><span className="eyebrow">STORE SETTINGS</span><h1>支付设置</h1><p>参数直接保存在数据库中，可随时修改。接入支付宝当面付、微信 Native 扫码支付，并保留本地演示支付。</p></div></div>
    {error&&<div className="admin-error" role="alert">{error}</div>}{notice&&<div className="admin-success"><Check size={16}/>{notice}</div>}
    <div className="settings-layout"><nav className="settings-nav">{links.map(([label,to])=><NavLink end={to==='/settings'} key={to} to={to}>{label}</NavLink>)}</nav>
      <section className="admin-panel settings-panel"><div className="panel-heading"><div><h2>支付渠道与收款规则</h2><p>未配置完整的真实支付渠道不会出现在顾客的结算页。</p></div></div>
        {loading?<div className="admin-loading-inline">正在读取支付配置…</div>:<form className="settings-form" onSubmit={save}>
          <div className="settings-callout"><CreditCard/><div><b>真实支付参数入库</b><p>支付宝/微信的商户参数与密钥均保存在数据库（密钥字段加密存储）。服务端收到并验签确认支付成功通知后才会发卡。</p></div></div>
          <div className="payment-ready-grid">{readinessCard('支付宝当面付',status?.alipay)}{readinessCard('微信 Native 支付',status?.wechat)}</div>
          <label>公网 HTTPS 商城地址<input type="url" value={data.publicBaseUrl||''} onChange={e=>change('publicBaseUrl',e.target.value)} placeholder="https://shop.example.com"/><small className="form-hint">用于生成 /api/payments/alipay/notify 和 /api/payments/wechat/notify 回调地址。支付平台需要能从公网访问。</small></label>
          <PaymentToggle label="启用支付宝当面付" hint="支付宝扫码收款。" checked={Boolean(data.alipay)} onChange={v=>change('alipay',v)}/>
          <PaymentToggle label="启用微信 Native 扫码支付" hint="用户使用微信扫描二维码完成支付。" checked={Boolean(data.wechat)} onChange={v=>change('wechat',v)}/>
          <PaymentToggle label="保留本地演示支付" hint="用于开发环境演示订单和自动发货，不会真实扣款；生产环境服务端会强制关闭。" checked={data.demo!==false} onChange={v=>change('demo',v)}/>
          <div className="panel-heading"><div><h2>支付宝当面付参数</h2><p>小程序/应用对应的应用 ID，以及商户私钥与支付宝公钥（PEM 文本）。</p></div></div>
          <div className="form-grid">
            <Field label="支付宝应用 ID" value={data.alipayAppId||''} onChange={v=>change('alipayAppId',v)} placeholder="例如：2021001xxxxxxx"/>
            <Field label="支付宝网关（可选）" value={data.alipayGateway||''} onChange={v=>change('alipayGateway',v)} placeholder="留空使用支付宝正式网关"/>
            <Field label="回调通知地址（可选）" value={data.alipayNotifyUrl||''} onChange={v=>change('alipayNotifyUrl',v)} placeholder="留空使用公网域名拼接 /api/payments/alipay/notify"/>
          </div>
          <Field label="支付宝商户私钥（PEM）" textarea value={data.alipayPrivateKey||''} onChange={v=>change('alipayPrivateKey',v)} placeholder={"-----BEGIN PRIVATE KEY-----\n..."}/>
          <Field label="支付宝公钥（PEM）" textarea value={data.alipayPublicKey||''} onChange={v=>change('alipayPublicKey',v)} placeholder={"-----BEGIN PUBLIC KEY-----\n..."}/>
          <div className="panel-heading"><div><h2>微信 Native 支付参数（API v3）</h2><p>需要 AppID、商户号、商户证书序列号、商户私钥、API v3 密钥以及平台证书/公钥。</p></div></div>
          <div className="form-grid">
            <Field label="微信 AppID" value={data.wechatAppId||''} onChange={v=>change('wechatAppId',v)} placeholder="wx 开头的应用 AppID"/>
            <Field label="微信商户号" value={data.wechatMchId||''} onChange={v=>change('wechatMchId',v)} placeholder="10 位商户号"/>
            <Field label="商户证书序列号" value={data.wechatMchSerialNo||''} onChange={v=>change('wechatMchSerialNo',v)} placeholder="商户证书序列号"/>
            <Field label="API v3 密钥（32 字符）" value={data.wechatApiV3Key||''} onChange={v=>change('wechatApiV3Key',v)} placeholder="32 位 API v3 密钥"/>
            <Field label="平台公钥 ID（可选）" value={data.wechatPlatformSerialNo||''} onChange={v=>change('wechatPlatformSerialNo',v)} placeholder="使用平台公钥时填写公钥 ID"/>
            <Field label="微信 API 地址（可选）" value={data.wechatApiBase||''} onChange={v=>change('wechatApiBase',v)} placeholder="留空使用微信支付正式网关"/>
            <Field label="回调通知地址（可选）" value={data.wechatNotifyUrl||''} onChange={v=>change('wechatNotifyUrl',v)} placeholder="留空使用公网域名拼接 /api/payments/wechat/notify"/>
          </div>
          <Field label="微信商户私钥（PEM）" textarea value={data.wechatMchPrivateKey||''} onChange={v=>change('wechatMchPrivateKey',v)} placeholder={"-----BEGIN PRIVATE KEY-----\n..."}/>
          <Field label="微信支付平台证书（PEM，可选）" textarea value={data.wechatPlatformCert||''} onChange={v=>change('wechatPlatformCert',v)} placeholder={"-----BEGIN CERTIFICATE-----\n..."}/>
          <Field label="微信支付平台公钥（PEM，可选）" textarea value={data.wechatPlatformPublicKey||''} onChange={v=>change('wechatPlatformPublicKey',v)} placeholder={"-----BEGIN PUBLIC KEY-----\n..."}/>
          <div className="settings-callout subtle-callout"><ShieldCheck/><div><b>密钥加密存储</b><p>商户私钥与 API v3 密钥在数据库中以 AES-GCM 加密保存（密钥来自 .env 的 SECRET_KEY，自动生成）。平台证书/公钥为非机密信息。不要泄露数据库中的加密字段或 SECRET_KEY。</p></div></div>
          <div className="form-grid">
            <label>待支付订单超时（分钟）<input type="number" min="1" max="1440" value={data.timeoutMinutes??15} onChange={e=>change('timeoutMinutes',Number(e.target.value))}/></label>
            <label>最低订单金额（分）<input type="number" min="1" value={data.minimumCents??100} onChange={e=>change('minimumCents',Number(e.target.value))}/></label>
          </div>
          <div className="settings-actions"><button className="button" disabled={busy}>{busy?'保存中…':'保存支付设置'}<Check size={15}/></button></div>
        </form>}
      </section>
    </div>
  </>;
}