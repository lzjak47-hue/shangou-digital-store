export type Product = {
  id: string; name: string; category: string; description: string;
  price: string; priceCents: number; originalCents: number; icon: string;
  active: boolean; deliveryType: 'card' | 'manual'; stock: number;
  variants: ProductVariant[];
};

export type ProductVariant = { id:string; name:string; price:string; priceCents:number; originalCents:number; active:boolean; stock:number };

export type Order = {
  id: string; email: string; nickname: string; status: string; paymentStatus: string;
  total: string; totalCents: number; discountCents: number; createdAt: string; paymentMethod?: string;
  paymentQr?: string | null; paymentExpiresAt?: string | null;
  contact?: string; ipAddress?: string;
  created_at?: string;
  items: Array<{ product_id: string; product_name: string; variant_id?:string; variant_name?:string; quantity: number; unit_price_cents: number; unitPrice: string; delivery_type?: 'card'|'manual' }>;
  cards: string[];
};

export const API_BASE = (import.meta as any).env?.DEV ? `${location.protocol}//${location.hostname}:8002` : '';
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include', ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败，请稍后再试');
  return data as T;
}
export const money = (value: number | string) => `¥${Number(value || 0).toFixed(2)}`;
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]!));
