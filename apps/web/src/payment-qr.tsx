import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export function PaymentQr({value,label='支付二维码'}:{value:string;label?:string}){
  const [src,setSrc]=useState('');
  useEffect(()=>{let live=true;setSrc('');QRCode.toDataURL(value,{width:240,margin:2,errorCorrectionLevel:'M',color:{dark:'#211b36',light:'#ffffff'}}).then(data=>{if(live)setSrc(data)}).catch(()=>{if(live)setSrc('')});return()=>{live=false}},[value]);
  return <div className="payment-qr-image">{src?<img src={src} alt={label}/>:<span className="spinner" aria-label="正在生成支付二维码"/>}</div>;
}
